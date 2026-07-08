import type {
  AiParticipant,
  ChatSession,
  NpcCreationSession,
  Topic,
  TopicContext,
} from "@/lib/chat-types";
import { getTaskKeyNode } from "@/lib/task-key-node";

export const buildRoleplaySummary = (topic: Topic | TopicContext["topic"]) => {
  const roleplay = topic.roleplay;
  if (!roleplay) return topic.description;
  return [
    `主题：${topic.title}`,
    `世界观：${roleplay.worldView}`,
    `阵营模板：${roleplay.factionSystem.template}`,
    `玩家阵营：${roleplay.playerFaction}`,
    "阵营列表：",
    ...roleplay.factionSystem.factions.map(
      (faction) =>
        `- ${faction.name}：${faction.description}；强度${faction.strength}；分数${faction.currentScore}/${faction.victoryScore}；胜利条件：${faction.victoryCondition}；叙事影响力：${faction.narrativeInfluence}`,
    ),
    "属性模板：",
    ...roleplay.attributeSystem.attributes.map(
      (attribute) =>
        `- id=${attribute.id} ${attribute.name}：默认${attribute.defaultValue}；${attribute.description}`,
    ),
    `玩家角色：${roleplay.playerRole}`,
    `玩家风评：${roleplay.reputation}`,
    `补充设定：${roleplay.notes || "无"}`,
  ].join("\n");
};

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
    ...tasks.map((task) => {
      const keyNode = getTaskKeyNode(task);
      return `- id=${task.id}；方向=${task.direction}；核心诉求：${task.request}；关键节点工具=${keyNode.toolName}；关键节点=${keyNode.uiSchema.title}；成功条件=${keyNode.successCondition}；失败条件=${keyNode.failureCondition}；利害：${task.stake}；建议推进：${task.suggestedApproach}`;
    }),
    npcToPlayerTasks.length > 0
      ? [
          "NPC 主动请求任务的专属工具规则：",
          ...npcToPlayerTasks.map((task) => {
            const keyNode = getTaskKeyNode(task);
            return `- 当你需要让玩家正式同意「${task.request}」时，必须调用 ${keyNode.toolName}。只用自然语言请求或说服玩家不算任务完成。工具描述：${keyNode.toolDescription}`;
          }),
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

const buildDialogParticipantPrompt = (
  topicContext: TopicContext | undefined,
  participant: AiParticipant | undefined,
) => {
  if (participant && topicContext) {
    return [
      `你正在与玩家进行一对一语C互动。你必须扮演：${participant.name}。`,
      participant.realWorldPersona ? `现实扮演者人设：${participant.realWorldPersona}` : undefined,
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
      .join("\n");
  }

  if (topicContext) {
    return "你是该主题下的 AI 助手。结合主题背景回答，保持直接、具体、可执行。";
  }

  return "";
};

export const buildDialogPipelineVariables = (
  topicContext: TopicContext | undefined,
  baseSystem?: string,
) => {
  const participant = topicContext?.chat.participants[0];
  return {
    dialog: {
      baseSystem: baseSystem?.trim() ?? "",
      topicHeader: buildTopicHeader(topicContext),
      participantPrompt: buildDialogParticipantPrompt(topicContext, participant),
      relationshipTasks: formatRelationshipTasks(topicContext, participant),
      npcMemories: formatNpcMemories(topicContext),
    },
    topic: topicContext?.topic ?? {},
    chat: topicContext?.chat ?? {},
    participant: participant ?? {},
  };
};

export const formatNpcCreationHistory = (session: NpcCreationSession) =>
  session.messages.map((message) => `${message.name}：${message.content}`).join("\n");

export const formatOccupiedRoles = (chat: Pick<ChatSession, "participants">) => {
  if (chat.participants.length === 0) return "暂无。";
  return chat.participants
    .map(
      (participant) =>
        `- ${participant.name}：${participant.role}${
          participant.faction ? `；阵营：${participant.faction}` : ""
        }`,
    )
    .join("\n");
};

const formatInFlightSessions = (
  session: NpcCreationSession,
  npcCreationSessions: Record<string, NpcCreationSession>,
) =>
  Object.values(npcCreationSessions)
    .filter((item) => item.topicId === session.topicId && item.id !== session.id)
    .map(
      (item) =>
        `- 候选玩家${item.index + 1}：状态=${item.status}；推荐阵营=${
          item.targetFaction || "无"
        }；生态位=${item.roleNiche || "无"}；关键词=${item.reservedKeywords.join("、")}`,
    )
    .join("\n");

const buildDmSystemPrompt = (topic: Topic) =>
  [
    "你是中文语C主题的主持人/DM，正在帮新成员创建游戏角色。",
    "你说话像 IM，短、具体、自然，不写长篇说明。",
    "你必须围绕主题世界观和玩家角色进行把关。",
    "你可以要求更多细节，可以指出世界观冲突，也可以指出角色离玩家太远、不方便互动。",
    "你必须让候选玩家最终选择一个现有阵营，不能自创阵营。",
    "你不能直接指定候选玩家扮演某个具体角色；你只能给约束、指出冲突、要求候选玩家自己修正。",
    "不要说自己是 AI。",
    "主题设定：",
    buildRoleplaySummary(topic),
  ].join("\n");

const buildNpcSystemPrompt = (session: NpcCreationSession) =>
  [
    `你是一个准备加入中文语C主题的普通玩家。你的现实人设：${session.personaTemplate}`,
    "你不是最终游戏角色本人，而是在和主持人商量自己要扮演什么角色。",
    "你说话像 IM，不写小说正文，不要说自己是 AI。",
    "你要认真配合主持人的要求，选择一个符合世界观、方便和玩家互动、能长期参与的角色。",
    session.targetFaction
      ? `系统给你的推荐阵营倾向是「${session.targetFaction}」，这不是强制，但优先考虑。`
      : undefined,
    session.roleNiche ? `系统给你的推荐角色生态位是「${session.roleNiche}」。` : undefined,
    session.reservedKeywords.length > 0
      ? `尽量围绕这些差异化关键词构思，但不要机械照抄：${session.reservedKeywords.join("、")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");

const buildDmTurnPrompt = ({
  topic,
  chat,
  session,
  cycle,
  npcCreationSessions,
}: {
  topic: Topic;
  chat: Pick<ChatSession, "participants">;
  session: NpcCreationSession;
  cycle: number;
  npcCreationSessions: Record<string, NpcCreationSession>;
}) => {
  const firstTurn = cycle === 0;
  return [
    `候选玩家现实人设：${session.personaTemplate}`,
    `推荐阵营倾向：${session.targetFaction || "无"}`,
    `推荐角色生态位：${session.roleNiche || "无"}`,
    `差异化关键词：${session.reservedKeywords.join("、") || "无"}`,
    `已占用角色：\n${formatOccupiedRoles(chat)}`,
    `其他并行创建中的候选：\n${formatInFlightSessions(session, npcCreationSessions) || "暂无。"}`,
    `创建对话记录：\n${formatNpcCreationHistory(session) || "暂无。"}`,
    firstTurn
      ? "请作为主持人欢迎这个新成员，向他介绍本主题正在进行的世界观，并请他先提出想扮演的角色。"
      : "请继续主持创建流程。根据对话提出一个关键追问、修正或确认。若角色离玩家太远、不方便互动，要直接指出。",
    "只输出一条 IM 消息，不要输出 JSON。",
    `玩家角色提醒：${topic.roleplay?.playerRole ?? "玩家角色未设定"}`,
  ].join("\n\n");
};

const buildNpcTurnPrompt = ({
  topic,
  chat,
  session,
  npcCreationSessions,
}: {
  topic: Topic;
  chat: Pick<ChatSession, "participants">;
  session: NpcCreationSession;
  npcCreationSessions: Record<string, NpcCreationSession>;
}) =>
  [
    `群设定：\n${buildRoleplaySummary(topic)}`,
    `推荐阵营倾向：${session.targetFaction || "无"}`,
    `推荐角色生态位：${session.roleNiche || "无"}`,
    `差异化关键词：${session.reservedKeywords.join("、") || "无"}`,
    `已占用角色：\n${formatOccupiedRoles(chat)}`,
    `其他并行创建中的候选：\n${formatInFlightSessions(session, npcCreationSessions) || "暂无。"}`,
    `创建对话记录：\n${formatNpcCreationHistory(session)}`,
    "请以候选玩家身份回复主持人的最后一条消息。你可以提出想扮演的角色、补充细节、接受修改或解释自己为什么适合这个主题。",
    "只输出一条 IM 消息，不要输出旁白。",
  ].join("\n\n");

const buildFinalPrompt = ({
  topic,
  chat,
  session,
  npcCreationSessions,
}: {
  topic: Topic;
  chat: Pick<ChatSession, "participants">;
  session: NpcCreationSession;
  npcCreationSessions: Record<string, NpcCreationSession>;
}) =>
  [
    "请作为主持人总结这个候选玩家最终加入主题的角色。",
    `群设定：\n${buildRoleplaySummary(topic)}`,
    `推荐阵营倾向：${session.targetFaction || "无"}`,
    `推荐角色生态位：${session.roleNiche || "无"}`,
    `差异化关键词：${session.reservedKeywords.join("、") || "无"}`,
    `已占用角色：\n${formatOccupiedRoles(chat)}`,
    `其他并行创建中的候选：\n${formatInFlightSessions(session, npcCreationSessions)}`,
    `创建对话记录：\n${formatNpcCreationHistory(session)}`,
    "必须返回严格 JSON，不要 Markdown，不要解释。",
    "JSON 字段：",
    '{"name":"角色在主题中的称呼，2到6个中文字符","role":"一句话角色身份","faction":"必须是现有阵营名之一","gamePersona":"这个 NPC 在语C游戏中的完整人设，包含身份、目标、关系位置和长期动机","attributes":[{"id":"必须使用属性模板中的 id","value":数字}],"systemPrompt":"给单聊模型使用的人设提示词，必须同时保存现实扮演者人设和游戏角色人设，持续体现阵营利益、盟友/敌对关系和胜利目标","introMessage":"加入主题后的第一句 IM 式招呼","creationSummary":"主持人对角色适配性和阵营归属的简短总结"}',
  ].join("\n\n");

export const buildNpcCreationPipelineVariables = ({
  topic,
  chat,
  session,
  cycle,
  npcCreationSessions,
}: {
  topic: Topic;
  chat: Pick<ChatSession, "participants">;
  session: NpcCreationSession;
  cycle: number;
  npcCreationSessions: Record<string, NpcCreationSession>;
}) => ({
  topic,
  chat,
  npc: {
    dmSystemPrompt: buildDmSystemPrompt(topic),
    npcSystemPrompt: buildNpcSystemPrompt(session),
    dmTurnPrompt: buildDmTurnPrompt({ topic, chat, session, cycle, npcCreationSessions }),
    npcTurnPrompt: buildNpcTurnPrompt({ topic, chat, session, npcCreationSessions }),
    finalPrompt: buildFinalPrompt({ topic, chat, session, npcCreationSessions }),
    creationHistory: formatNpcCreationHistory(session),
    occupiedRoles: formatOccupiedRoles(chat),
    inFlightSessions: formatInFlightSessions(session, npcCreationSessions),
  },
  session,
});
