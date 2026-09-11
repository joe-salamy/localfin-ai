import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import type { Express } from "express";
import { z } from "zod";
import { createApp } from "../app.js";
import { closeDbForTests } from "../db/index.js";

const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});
export type Envelope = z.infer<typeof envelopeSchema>;

export async function useApp(t: TestContext, prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  const previousPath = process.env.LOCALFIN_DB_PATH;
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(directory, "budget.db");
  const app: Express = createApp();
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    closeDbForTests();
    if (previousPath === undefined) delete process.env.LOCALFIN_DB_PATH;
    else process.env.LOCALFIN_DB_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  });
  return baseUrl;
}

export async function expectEnvelope(response: Response): Promise<Envelope> {
  return envelopeSchema.parse(await response.json());
}
