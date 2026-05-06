export const AI_MODELS = {
  transactionCategorization: "google/gemini-3.1-flash-lite-preview",
  assistantChat: "google/gemini-3.1-flash-lite-preview",
} as const;

export type AIModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];
