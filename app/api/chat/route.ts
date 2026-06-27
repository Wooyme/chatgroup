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
import type { AiParticipant, TopicContext } from "@/lib/chat-types";
import { getTaskKeyNode } from "@/lib/task-key-node";

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
    topicContext.topic.taskKeyNodeRequests?.filter(
      (request) => request.npcId === participant.id && request.status === "pending",
    ) ?? [];
  const attempts = topicContext.chat.toolCallCounts?.[participant.id] ?? 0;
  const npcToPlayerTasks = tasks.filter((task) => task.direction === "npc_to_player");
  const playerToNpcTasks = tasks.filter((task) => task.direction === "player_to_npc");
  return [
    `本次单聊 NPC 申请工具次数：${attempts}/3`,
    tasks.length > 0 ? "当前玩家-NPC 关系任务：" : "当前没有未完成关系任务。",
    ...tasks.map(
      (task) => {
        const keyNode = getTaskKeyNode(task);
        return `- id=${task.id}；方向=${task.direction}；核心诉求：${task.request}；关键节点工具=${keyNode.toolName}；关键节点=${keyNode.uiSchema.title}；成功条件=${keyNode.successCondition}；失败条件=${keyNode.failureCondition}；利害：${task.stake}；建议推进：${task.suggestedApproach}`;
      },
    ),
    npcToPlayerTasks.length > 0
      ? [
          "NPC 主动请求任务的专属工具规则：",
          ...npcToPlayerTasks.map(
            (task) => {
              const keyNode = getTaskKeyNode(task);
              return `- 当你需要让玩家正式同意「${task.request}」时，必须调用 ${keyNode.toolName}。只用自然语言请求或说服玩家不算任务完成。工具描述：${keyNode.toolDescription}`;
            },
          ),
        ].join("\n")
      : undefined,
    playerToNpcTasks.length > 0
      ? "玩家主动请求任务由玩家在对话结束后要求 DM 判断；不要替 DM 直接判定结果。"
      : undefined,
    pendingRequests.length > 0 ? "等待玩家处理的申请：" : undefined,
    ...pendingRequests.map((request) => `- ${request.title}：${request.body}`),
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
        "- 工具调用是游戏状态落库的唯一方式。自然语言里的“我请求你同意”“你同意了”“我离开了”“我进行检定”都不会改变任务状态。",
        "- 每个 npc_to_player 任务都有自己的专属关键节点工具。当前任务说明里写着“关键节点工具=xxx”，你必须调用对应的 xxx 工具，不要调用统一申请工具。",
        "- 如果当前任务方向是 npc_to_player，当你已经提出核心诉求、玩家表现出接受/拒绝/需要正式回应，或你准备把关键节点提交给玩家审核时，必须调用该任务的专属关键节点工具。不要只用文字要求玩家同意。",
        "- 调用任务专属工具后，先等待玩家在 chat 卡片中同意或驳回；不要在工具返回前宣称任务完成。",
        "- 如果你希望自然结束当前一对一对话，必须调用 request_leave，并等待玩家同意或拒绝。不要只用文字宣布离场。",
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
