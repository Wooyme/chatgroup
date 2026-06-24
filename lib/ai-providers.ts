export const DEFAULT_AI_PROVIDER = "openrouter" as const;
export const DEFAULT_OPENROUTER_MODEL_ID = "x-ai/grok-4.3";
export const DEFAULT_OPENROUTER_MODEL_NAME = "Grok 4.3";

export type AiProvider = typeof DEFAULT_AI_PROVIDER;

export type ProviderModel = {
  id: string;
  name: string;
  contextLength?: number;
  description?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
};

export const getModelDisplayName = (modelId: string, modelName?: string) =>
  modelName?.trim() || modelId;
