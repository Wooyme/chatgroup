import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  convertToModelMessages,
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
        "属性模板：",
        ...(roleplay.attributeSystem?.attributes ?? []).map(
          (attribute) =>
            `- ${attribute.name}：默认${attribute.defaultValue}；${attribute.description}`,
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

const formatParticipantProgression = (participant: AiParticipant) =>
  [
    participant.status === "left" ? "状态：已离群" : undefined,
    participant.attributes?.length
      ? `属性：${participant.attributes
          .map((attribute) => `${attribute.name}${attribute.value}`)
          .join("、")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");

const formatRelationshipTasks = (
  topicContext: TopicContext | undefined,
  participant: AiParticipant | undefined,
) => {
  if (!topicContext || !participant) return "";
  const tasks =
    topicContext.topic.relationshipTasks?.filter(
      (task) => task.npcId === participant.id && task.status === "open",
    ) ?? [];
  const pendingRequests =
    topicContext.topic.consentRequests?.filter(
      (request) => request.npcId === participant.id && request.status === "pending",
    ) ?? [];
  const attempts = topicContext.chat.toolCallCounts?.[participant.id] ?? 0;
  return [
    `本次单聊 NPC 申请工具次数：${attempts}/3`,
    tasks.length > 0 ? "当前玩家-NPC 关系任务：" : "当前没有未完成关系任务。",
    ...tasks.map(
      (task) =>
        `- id=${task.id}；方向=${task.direction}；核心诉求：${task.request}；利害：${task.stake}；建议推进：${task.suggestedApproach}`,
    ),
    pendingRequests.length > 0 ? "等待玩家处理的申请：" : undefined,
    ...pendingRequests.map((request) => `- ${request.requestTitle}：${request.requestBody}`),
  ]
    .filter(Boolean)
    .join("\n");
};

const formatNpcMemories = (topicContext: TopicContext | undefined) => {
  const memories = topicContext?.npcMemorySummaries ?? [];
  if (memories.length === 0) return "";
  return [
    "过往你以现实扮演者身份记录的玩家印象与重要记忆：",
    ...memories.map((summary, index) =>
      [
        `${index + 1}. ${summary.npcPrivateSummary ?? "未记录复盘"}`,
        summary.playerImpression ? `玩家印象：${summary.playerImpression}` : undefined,
        summary.importantPoints?.length
          ? `重要点：${summary.importantPoints.join("；")}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  ].join("\n");
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
        participant.realWorldPersona
          ? `现实扮演者人设：${participant.realWorldPersona}`
          : undefined,
        `角色定位：${participant.role}`,
        participant.gamePersona ? `游戏内人设：${participant.gamePersona}` : undefined,
        participant.faction ? `所属阵营：${participant.faction}` : undefined,
        formatParticipantProgression(participant),
        topicContext.chat.sceneSetup?.finalScene
          ? `本次对话 DM 场景：${topicContext.chat.sceneSetup.finalScene}`
          : undefined,
        formatRelationshipTasks(topicContext, participant),
        formatNpcMemories(topicContext),
        `角色提示词：${participant.systemPrompt}`,
        "回复要求：",
        "- 现实扮演者人设只影响你的表达习惯、偏好和参与方式；默认不要主动暴露现实人设。",
        "- 始终保持该角色的口吻、视角和情绪一致性。",
        "- 直接回应玩家，不要跳出角色解释系统设定。",
        "- 可以主动推进互动，但不要替玩家做决定或代替玩家发言。",
        "- 如果当前任务方向是 npc_to_player，你需要在自然互动后调用 request_player_consent，请玩家同意任务诉求；本次单聊最多 3 次。",
        "- 如果你要请求 DM 介入属性对抗，可以调用 request_dm_check。胜出会直接完成任务，失败会导致任务失败并产生惩罚。",
        "- 如果你希望自然结束当前一对一对话，可以调用 request_leave，并等待玩家同意或拒绝。",
        "- 只有当你已经调用 request_leave 且玩家拒绝后，才可以调用 force_leave；这会让 DM 接管强制离场。",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } else if (topicContext) {
    parts.push("你是该主题下的 AI 助手。结合主题背景回答，保持直接、具体、可执行。");
  }

  return parts.join("\n\n") || undefined;
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

  return streamDialog({
    messages: modelMessages,
    system,
    tools,
    topicContext,
  });
}
