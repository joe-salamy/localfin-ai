import { ChatOpenRouter } from "@langchain/openrouter";
import { getOpenRouterApiKey, type AIModel } from "../config/app.js";

const MAX_RETRIES = 2;

export function createOpenRouterChatModel(
  model: AIModel,
  options: { disableParallelToolCalls?: boolean } = {},
): ChatOpenRouter {
  return new ChatOpenRouter({
    apiKey: getOpenRouterApiKey(),
    model,
    temperature: 0,
    // Bound retries so a provider outage cannot multiply spend or hang the
    // request for minutes; the overall deadline comes from the AbortSignal
    // the runner attaches (client disconnect or hard timeout).
    maxRetries: MAX_RETRIES,
    ...(options.disableParallelToolCalls
      ? { modelKwargs: { parallel_tool_calls: false } }
      : {}),
  });
}
