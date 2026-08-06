import { ChatOpenRouter } from "@langchain/openrouter";
import { AI_MODELS } from "../../config/ai-models.js";
import { ENV_KEYS, OPENROUTER_CONFIG } from "../../config/app.js";

export function createAssistantChatModel() {
  const apiKey = process.env[ENV_KEYS.openRouterApiKey];
  if (!apiKey || apiKey === OPENROUTER_CONFIG.apiKeyPlaceholder) {
    throw new Error(
      `${ENV_KEYS.openRouterApiKey} not configured. Set it in .env file.`,
    );
  }

  return new ChatOpenRouter({
    apiKey,
    model: AI_MODELS.assistantChat,
    temperature: 0,
    // Dependent finance mutations must not race.
    modelKwargs: {
      parallel_tool_calls: false,
    },
  });
}
