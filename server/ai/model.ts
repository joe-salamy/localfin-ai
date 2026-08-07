import { ChatOpenRouter } from "@langchain/openrouter";
import { getOpenRouterApiKey, type AIModel } from "../config/app.js";

export function createOpenRouterChatModel(
  model: AIModel,
  options: { disableParallelToolCalls?: boolean } = {},
): ChatOpenRouter {
  return new ChatOpenRouter({
    apiKey: getOpenRouterApiKey(),
    model,
    temperature: 0,
    ...(options.disableParallelToolCalls
      ? { modelKwargs: { parallel_tool_calls: false } }
      : {}),
  });
}
