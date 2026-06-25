import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  type JSONSchema7,
  type ModelMessage,
  streamText,
  type UIMessage,
} from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { DEFAULT_OPENROUTER_MODEL_ID } from "@/lib/ai-providers";
import type { AiParticipant, TopicContext } from "@/lib/chat-types";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const getParticipantModelId = (participant: AiParticipant | undefined) =>
  participant?.modelId?.trim() || DEFAULT_OPENROUTER_MODEL_ID;

const buildTopicHeader = (topicContext: TopicContext | undefined) => {
  if (!topicContext) return "";
  const topicDescription = topicContext.topic.description.trim();
  const roleplay = topicContext.topic.roleplay;
  const factionSystem = roleplay?.factionSystem;
  const factionLines = factionSystem
    ? [
        `阵营模板：${factionSystem.template}`,
        `玩家阵营：${roleplay.playerFaction}`,
        factionSystem.winningFactionId
          ? `已胜出阵营：${
              factionSystem.factions.find(
                (faction) => faction.id === factionSystem.winningFactionId,
              )?.name ?? factionSystem.winningFactionId
            }`
          : undefined,
        "阵营分数：",
        ...factionSystem.factions.map(
          (faction) =>
            `- ${faction.name}：${faction.currentScore}/${faction.victoryScore}；胜利条件：${faction.victoryCondition}；影响力：${faction.narrativeInfluence}`,
        ),
      ]
        .filter(Boolean)
        .join("\n")
    : undefined;
  return [
    `当前主题：${topicContext.topic.title}`,
    topicDescription ? `主题说明：${topicDescription}` : undefined,
    factionLines,
    `当前会话：${topicContext.chat.title}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildDialogSystemPrompt = (
  baseSystem: string | undefined,
  topicContext: TopicContext | undefined,
) => {
  const parts = [baseSystem?.trim(), buildTopicHeader(topicContext)].filter(Boolean) as string[];
  const participant = topicContext?.chat.participants[0];

  if (participant) {
    parts.push(
      [
        `你正在与玩家进行一对一语C互动。你必须扮演：${participant.name}。`,
        `角色定位：${participant.role}`,
        participant.faction ? `所属阵营：${participant.faction}` : undefined,
        `角色提示词：${participant.systemPrompt}`,
        "回复要求：",
        "- 始终保持该角色的口吻、视角和情绪一致性。",
        "- 直接回应玩家，不要跳出角色解释系统设定。",
        "- 可以主动推进互动，但不要替玩家做决定或代替玩家发言。",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } else if (topicContext) {
    parts.push("你是该主题下的 AI 助手。结合主题背景回答，保持直接、具体、可执行。");
  }

  return parts.join("\n\n") || undefined;
};

const buildGroupSystemPrompt = (
  baseSystem: string | undefined,
  topicContext: TopicContext,
  participant: AiParticipant,
  priorReplies: string[],
) => {
  const roster = topicContext.chat.participants
    .map(
      (ai, index) =>
        `${index + 1}. ${ai.name}（${ai.role}${ai.faction ? `｜${ai.faction}` : ""}）：${
          ai.systemPrompt
        }`,
    )
    .join("\n");
  const parts = [baseSystem?.trim(), buildTopicHeader(topicContext)].filter(Boolean) as string[];

  parts.push(
    [
      "你正在参与一个多 AI 角色群聊，所有角色都与玩家进行语C互动。",
      "本次只输出你当前角色的一段回复，不要替其他角色发言。",
      `当前轮到你扮演：${participant.name}。`,
      `你的角色定位：${participant.role}`,
      participant.faction ? `你的阵营：${participant.faction}` : undefined,
      `你的角色提示词：${participant.systemPrompt}`,
      "群聊角色顺序：",
      roster,
      priorReplies.length > 0 ? "本轮前序角色回复：" : undefined,
      priorReplies.length > 0 ? priorReplies.join("\n\n") : undefined,
      "输出要求：",
      `- 必须使用 \`**${participant.name}**\` 开头。`,
      "- 只回复一段，观点要承接玩家和前序角色。",
      "- 始终保持你自己的口吻、视角和情绪一致性。",
      "- 如果你有阵营，发言要体现阵营利益、胜利目标、盟友/敌对关系和当前分数压力。",
      "- 不要解释你在模拟群聊，不要替玩家发言。",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return parts.join("\n\n");
};

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
  const result = streamText({
    model: openrouter.chat(getParticipantModelId(participant)),
    messages,
    system: buildDialogSystemPrompt(system, topicContext),
    tools: makeTools(tools),
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
};

const streamGroup = ({
  messages,
  system,
  tools,
  topicContext,
  originalMessages,
}: {
  messages: ModelMessage[];
  system?: string;
  tools: Record<string, { description?: string; parameters: JSONSchema7 }>;
  topicContext: TopicContext;
  originalMessages: UIMessage[];
}) => {
  const stream = createUIMessageStream<UIMessage>({
    originalMessages,
    async execute({ writer }) {
      const priorReplies: string[] = [];

      for (const participant of topicContext.chat.participants) {
        let reply = "";
        const result = streamText({
          model: openrouter.chat(getParticipantModelId(participant)),
          messages,
          system: buildGroupSystemPrompt(system, topicContext, participant, priorReplies),
          tools: makeTools(tools),
          onChunk({ chunk }) {
            if (chunk.type === "text-delta") reply += chunk.text;
          },
        });

        for await (const chunk of result.toUIMessageStream({
          sendReasoning: true,
          sendStart: priorReplies.length === 0,
          sendFinish: false,
        })) {
          writer.write(chunk);
        }
        if (reply.trim()) priorReplies.push(reply.trim());
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
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
  }: {
    messages?: UIMessage[];
    prompt?: string;
    system?: string;
    tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
    topicContext?: TopicContext;
    responseMode?: "stream" | "text";
    modelId?: string;
  } = await req.json();
  if (responseMode === "text") {
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

  if (topicContext?.chat.mode === "group" && topicContext.chat.participants.length > 0) {
    return streamGroup({
      messages: modelMessages,
      system,
      tools,
      topicContext,
      originalMessages: messages,
    });
  }

  return streamDialog({
    messages: modelMessages,
    system,
    tools,
    topicContext,
  });
}
