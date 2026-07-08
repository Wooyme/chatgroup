import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  convertToModelMessages,
  generateText,
  type JSONSchema7,
  type ModelMessage,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { DEFAULT_OPENROUTER_MODEL_ID } from "@/lib/ai-providers";
import { compileContextPipeline, type ContextPipelineTarget } from "@/lib/context-pipeline";
import { ensureContextPipeline } from "@/lib/context-pipeline-defaults";
import { buildDialogPipelineVariables } from "@/lib/context-pipeline-runtime";
import type { AiParticipant, TopicContext } from "@/lib/chat-types";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const getParticipantModelId = (participant: AiParticipant | undefined) =>
  participant?.modelId?.trim() || DEFAULT_OPENROUTER_MODEL_ID;

const toModelMessages = (
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): ModelMessage[] => messages.map((message) => ({ role: message.role, content: message.content }));

const compileDialogContext = (system: string | undefined, topicContext: TopicContext | undefined) =>
  compileContextPipeline({
    pipeline: ensureContextPipeline(topicContext?.topic.contextPipeline),
    target: "dialog",
    variables: buildDialogPipelineVariables(topicContext, system),
  });

const makeTools = (tools: Record<string, { description?: string; parameters: JSONSchema7 }>) => ({
  ...frontendTools(tools),
});

const streamDialog = async ({
  messages,
  system,
  tools,
  topicContext,
}: {
  messages: ModelMessage[];
  system?: string;
  tools: Record<string, { description?: string; parameters: JSONSchema7 }>;
  topicContext?: TopicContext;
}) => {
  const participant = topicContext?.chat.participants[0];
  const compiled = compileDialogContext(system, topicContext);
  const result = streamText({
    model: openrouter.chat(getParticipantModelId(participant)),
    messages: [...toModelMessages(compiled.chatSegments), ...messages],
    system: compiled.system,
    tools: makeTools(tools),
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
};

export async function POST(req: Request) {
  const {
    messages,
    prompt,
    system,
    tools = {},
    topicContext,
    responseMode,
    modelId,
    contextPipeline,
    pipelineTarget,
    pipelineVariables,
  }: {
    messages?: UIMessage[];
    prompt?: string;
    system?: string;
    tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
    topicContext?: TopicContext;
    responseMode?: "stream" | "text";
    modelId?: string;
    contextPipeline?: ReturnType<typeof ensureContextPipeline>;
    pipelineTarget?: ContextPipelineTarget;
    pipelineVariables?: Record<string, unknown>;
  } = await req.json();
  if (responseMode === "text") {
    if (contextPipeline && pipelineTarget) {
      const compiled = compileContextPipeline({
        pipeline: contextPipeline,
        target: pipelineTarget,
        variables: pipelineVariables ?? {},
      });
      const pipelineMessages = toModelMessages(compiled.chatSegments);
      const result = await generateText({
        model: openrouter.chat(modelId?.trim() || DEFAULT_OPENROUTER_MODEL_ID),
        system: compiled.system ?? system,
        ...(pipelineMessages.length > 0
          ? {
              messages: prompt
                ? [...pipelineMessages, { role: "user" as const, content: prompt }]
                : pipelineMessages,
            }
          : { prompt: prompt ?? "" }),
      });
      return Response.json({ text: result.text, warnings: compiled.warnings });
    }

    const result = await generateText({
      model: openrouter.chat(modelId?.trim() || DEFAULT_OPENROUTER_MODEL_ID),
      system,
      prompt: prompt ?? "",
    });
    return Response.json({ text: result.text });
  }

  if (!messages) {
    return Response.json({ error: "messages are required for stream responses" }, { status: 400 });
  }
  const modelMessages = await convertToModelMessages(messages);

  return streamDialog({
    messages: modelMessages,
    system,
    tools,
    topicContext,
  });
}
