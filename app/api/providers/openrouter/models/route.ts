import type { ProviderModel } from "@/lib/ai-providers";

type OpenRouterModel = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  architecture?: {
    output_modalities?: unknown;
  };
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
  };
};

const isTextOutputModel = (model: OpenRouterModel) => {
  const outputModalities = model.architecture?.output_modalities;
  return Array.isArray(outputModalities) ? outputModalities.includes("text") : true;
};

const toProviderModel = (model: OpenRouterModel): ProviderModel | null => {
  if (typeof model.id !== "string" || !model.id.trim()) return null;
  if (!isTextOutputModel(model)) return null;

  return {
    id: model.id,
    name: typeof model.name === "string" && model.name.trim() ? model.name : model.id,
    contextLength: typeof model.context_length === "number" ? model.context_length : undefined,
    description:
      typeof model.description === "string" && model.description.trim()
        ? model.description
        : undefined,
    pricing: {
      prompt: typeof model.pricing?.prompt === "string" ? model.pricing.prompt : undefined,
      completion:
        typeof model.pricing?.completion === "string" ? model.pricing.completion : undefined,
    },
  };
};

export async function GET() {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: process.env.OPENROUTER_API_KEY
      ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
      : undefined,
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    return Response.json(
      { error: `OpenRouter models request failed with ${response.status}` },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as { data?: unknown };
  const models = Array.isArray(payload.data)
    ? payload.data
        .map((model) => toProviderModel(model as OpenRouterModel))
        .filter((model): model is ProviderModel => Boolean(model))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return Response.json({ models });
}
