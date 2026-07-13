import { z } from "zod";
import { afterEach, expect, test, vi } from "vitest";
import { INVALID_SERVER_RESPONSE_MESSAGE } from "@/config/constants";
import { apiGet, apiStream } from "./api";

afterEach(() => vi.unstubAllGlobals());

function response(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

test.each([
  ["malformed JSON", "{", 200],
  ["non-object envelope", "[]", 200],
  ["invalid success", JSON.stringify({ success: "yes" }), 200],
  ["missing failure error", JSON.stringify({ success: false }), 400],
])("rejects %s as an invalid server response", async (_name, body, status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body as string, { status: status as number })));
  await expect(apiGet("/test")).rejects.toThrow(INVALID_SERVER_RESPONSE_MESSAGE);
});

test("validates schema-bound success data", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const schema = z.object({ id: z.string() });

  fetchMock.mockResolvedValueOnce(response(JSON.stringify({ success: true, data: { id: 1 } })));
  await expect(apiGet("/test", schema)).rejects.toThrow(INVALID_SERVER_RESPONSE_MESSAGE);

  fetchMock.mockResolvedValueOnce(response(JSON.stringify({ success: true, data: { id: "ok" } })));
  await expect(apiGet("/test", schema)).resolves.toEqual({
    success: true,
    data: { id: "ok" },
  });
});

function sseResponse(data: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(data));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("malformed SSE JSON never reaches the consumer", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse("data: {\n\n")));
  const onEvent = vi.fn();
  await expect(apiStream("/stream", {}, onEvent)).rejects.toThrow(
    INVALID_SERVER_RESPONSE_MESSAGE,
  );
  expect(onEvent).not.toHaveBeenCalled();
});

test("schema-invalid SSE events never reach the consumer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      sseResponse(`data: ${JSON.stringify({ type: "final", data: 1 })}\n\n`),
    ),
  );
  const onEvent = vi.fn();
  const eventSchema = z.object({ type: z.literal("final"), data: z.string() });
  await expect(apiStream("/stream", {}, onEvent, undefined, eventSchema)).rejects.toThrow(
    INVALID_SERVER_RESPONSE_MESSAGE,
  );
  expect(onEvent).not.toHaveBeenCalled();
});

test("valid SSE server error events are delivered for consumer policy", async () => {
  const serverError = { type: "error" as const, message: "safe failure" };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      sseResponse(`event: error\ndata: ${JSON.stringify(serverError)}\n\n`),
    ),
  );
  const onEvent = vi.fn();
  const eventSchema = z.object({
    type: z.literal("error"),
    message: z.string(),
  });
  await apiStream("/stream", {}, onEvent, undefined, eventSchema);
  expect(onEvent).toHaveBeenCalledWith(serverError);
});
