export const AI_MODELS = {
  transactionCategorization: 'google/gemma-3n-e4b-it',
  assistantChat: 'google/gemini-flash-latest',
} as const;

export type AIModel = typeof AI_MODELS[keyof typeof AI_MODELS];
