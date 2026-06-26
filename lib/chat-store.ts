"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_AI_PARTICIPANTS,
  type AiParticipant,
  type ChatMode,
  type ChatRecruitment,
  type ChatSession,
  type FactionScoreDelta,
  type FactionScoreEvent,
  type InventoryItem,
  type NpcCreationMessage,
  type NpcCreationSession,
  type NpcCreationStatus,
  type NpcProgressionMessage,
  type NpcProgressionSession,
  type NpcProgressionStatus,
  type NpcTask,
  type RecruitmentEvent,
  type RoleplayTopicProfile,
  type StoredMessageRow,
  type Topic,
} from "@/lib/chat-types";
import { createCharacterAttributes } from "@/lib/attribute-templates";
import {
  DEFAULT_AI_PROVIDER,
  DEFAULT_OPENROUTER_MODEL_ID,
  DEFAULT_OPENROUTER_MODEL_NAME,
} from "@/lib/ai-providers";

type WorkspaceState = {
  topics: Record<string, Topic>;
  ais: Record<string, AiParticipant>;
  chats: Record<string, ChatSession>;
  npcCreationSessions: Record<string, NpcCreationSession>;
  npcProgressionSessions: Record<string, NpcProgressionSession>;
  messages: Record<string, StoredMessageRow[]>;
  activeTopicId: string;
  activeChatId: string;
  createRoleplayTopic: (input: {
    title: string;
    description: string;
    roleplay: RoleplayTopicProfile;
    groupTitle: string;
    personaTemplates: string[];
  }) => { topicId: string; chatId: string; sessionIds: string[] };
  createTopic: (title?: string) => string;
  renameTopic: (topicId: string, title: string) => void;
  deleteTopic: (topicId: string) => void;
  createAi: (topicId: string, input?: AiParticipantInput) => string;
  updateAi: (aiId: string, input: AiParticipantInput) => void;
  deleteAi: (aiId: string) => void;
  createChat: (
    topicId: string,
    mode: ChatMode,
    title?: string,
    participantIds?: string[],
  ) => string;
  renameChat: (chatId: string, title: string) => void;
  deleteChat: (chatId: string) => void;
  createAiAndJoinChat: (topicId: string, chatId: string, input: AiParticipantInput) => string;
  appendRecruitmentEvent: (
    chatId: string,
    event: Pick<RecruitmentEvent, "message" | "status" | "sessionId">,
  ) => void;
  appendNpcCreationMessage: (
    sessionId: string,
    message: Pick<NpcCreationMessage, "role" | "name" | "content">,
  ) => void;
  setNpcCreationStatus: (sessionId: string, status: NpcCreationStatus, error?: string) => void;
  incrementNpcCreationRevision: (sessionId: string) => void;
  completeNpcCreationSession: (sessionId: string, input: AiParticipantInput) => string;
  failNpcCreationSession: (sessionId: string, error: string) => void;
  appendNpcProgressionMessage: (
    sessionId: string,
    message: Pick<NpcProgressionMessage, "role" | "name" | "content">,
  ) => void;
  setNpcProgressionStatus: (
    sessionId: string,
    status: NpcProgressionStatus,
    error?: string,
  ) => void;
  completeNpcProgressionSession: (
    sessionId: string,
    input: { tasks: NpcTask[]; personalGoal: string },
  ) => void;
  failNpcProgressionSession: (sessionId: string, error: string) => void;
  completeNpcTask: (aiId: string, taskId: string) => void;
  enhanceNpcAttribute: (aiId: string, attributeId: string) => void;
  buyNpcShopItem: (aiId: string, item: Pick<InventoryItem, "name" | "description">) => void;
  applyFactionScoreEvent: (
    chatId: string,
    input: {
      sourceMessageCount: number;
      summary: string;
      deltas: FactionScoreDelta[];
      winningFactionId?: string;
    },
  ) => void;
  setActiveTopic: (topicId: string) => void;
  setActiveChat: (chatId: string) => void;
  setChatMessages: (chatId: string, rows: StoredMessageRow[]) => void;
  upsertChatMessage: (chatId: string, row: StoredMessageRow) => void;
  deleteChatMessages: (chatId: string, ids: string[]) => void;
};

type AiParticipantInput = Partial<
  Pick<
    AiParticipant,
    | "name"
    | "role"
    | "faction"
    | "realWorldPersona"
    | "gamePersona"
    | "points"
    | "status"
    | "attributes"
    | "tasks"
    | "personalGoal"
    | "inventory"
    | "progressionSessionId"
    | "systemPrompt"
    | "modelId"
    | "modelName"
  >
>;

const AI_COLORS = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
];

const ROLE_NICHES = [
  { name: "外交", keywords: ["使节", "谈判", "盟约", "外务"] },
  { name: "军事", keywords: ["军官", "骑士", "将领", "护卫"] },
  { name: "宗教", keywords: ["祭司", "神官", "信徒", "圣职"] },
  { name: "情报", keywords: ["密探", "间谍", "线人", "调查"] },
  { name: "商业", keywords: ["商人", "财团", "贸易", "行会"] },
  { name: "学术", keywords: ["学者", "法师", "研究", "档案"] },
  { name: "民间", keywords: ["平民", "工匠", "记者", "组织者"] },
  { name: "边境", keywords: ["边境", "游侠", "流亡", "佣兵"] },
  { name: "反叛", keywords: ["叛军", "革命", "地下", "异见"] },
  { name: "宫廷", keywords: ["贵族", "侍从", "顾问", "内廷"] },
];

const NPC_INITIAL_POINTS = 10;
const NPC_DIALOG_COST = 2;
const NPC_ATTRIBUTE_UPGRADE_COST = 5;
const NPC_SHOP_ITEM_COST = 3;

const makeId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const now = () => Date.now();

const cloneDefaultAis = () => {
  const timestamp = Date.now().toString(36);
  return DEFAULT_AI_PARTICIPANTS.map((ai) => ({
    ...ai,
    id: `${ai.id}_${timestamp}_${Math.random().toString(36).slice(2, 6)}`,
  }));
};

const createAiParticipant = (input?: AiParticipantInput, index = 0): AiParticipant => ({
  id: makeId("ai"),
  name: input?.name?.trim() || "新角色",
  role: input?.role?.trim() || "待设定的人设",
  ...(input?.faction?.trim() && { faction: input.faction.trim() }),
  ...(input?.realWorldPersona?.trim() && { realWorldPersona: input.realWorldPersona.trim() }),
  ...(input?.gamePersona?.trim() && { gamePersona: input.gamePersona.trim() }),
  ...(typeof input?.points === "number" && { points: input.points }),
  ...(input?.status && { status: input.status }),
  ...(input?.attributes && { attributes: input.attributes }),
  ...(input?.tasks && { tasks: input.tasks }),
  ...(input?.personalGoal?.trim() && { personalGoal: input.personalGoal.trim() }),
  ...(input?.inventory && { inventory: input.inventory }),
  ...(input?.progressionSessionId && { progressionSessionId: input.progressionSessionId }),
  systemPrompt: input?.systemPrompt?.trim() || "按照人设进行语C互动，保持角色口吻，主动回应玩家。",
  color: AI_COLORS[index % AI_COLORS.length]!,
  provider: DEFAULT_AI_PROVIDER,
  modelId: input?.modelId?.trim() || DEFAULT_OPENROUTER_MODEL_ID,
  modelName:
    input?.modelName?.trim() ||
    (input?.modelId?.trim() === DEFAULT_OPENROUTER_MODEL_ID
      ? DEFAULT_OPENROUTER_MODEL_NAME
      : undefined),
});

const isActiveParticipant = (participant: AiParticipant) => participant.status !== "left";

const withPointDelta = (participant: AiParticipant, delta: number): AiParticipant => {
  if (typeof participant.points !== "number") return participant;
  const points = Math.max(0, participant.points + delta);
  return {
    ...participant,
    points,
    status: points === 0 ? "left" : (participant.status ?? "active"),
  };
};

const updateParticipantEverywhere = (
  chats: Record<string, ChatSession>,
  participant: AiParticipant,
) =>
  Object.fromEntries(
    Object.entries(chats).map(([chatId, chat]) => [
      chatId,
      {
        ...chat,
        participants: chat.participants.map((item) =>
          item.id === participant.id ? { ...participant } : item,
        ),
      },
    ]),
  );

const createChatSession = (
  topicId: string,
  mode: ChatMode,
  participants: AiParticipant[],
  title?: string,
  recruitment?: ChatRecruitment,
): ChatSession => {
  const timestamp = now();
  const fallbackTitle =
    title?.trim() ||
    (mode === "group"
      ? `${participants
          .slice(0, 3)
          .map((ai) => ai.name)
          .join("、")} 群聊`
      : `与 ${participants[0]?.name ?? "AI"} 对话`);

  return {
    id: makeId("chat"),
    topicId,
    title: fallbackTitle,
    mode,
    participants,
    ...(recruitment && { recruitment }),
    factionScoreEvents: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const createFactionScoreEvent = (
  chatId: string,
  input: {
    sourceMessageCount: number;
    summary: string;
    deltas: FactionScoreDelta[];
    winningFactionId?: string;
  },
): FactionScoreEvent => ({
  id: makeId("faction_event"),
  chatId,
  sourceMessageCount: input.sourceMessageCount,
  summary: input.summary,
  deltas: input.deltas,
  ...(input.winningFactionId && { winningFactionId: input.winningFactionId }),
  createdAt: now(),
});

const createRecruitmentEvent = (
  event: Pick<RecruitmentEvent, "message" | "status" | "sessionId">,
): RecruitmentEvent => ({
  id: makeId("event"),
  message: event.message,
  status: event.status,
  ...(event.sessionId && { sessionId: event.sessionId }),
  createdAt: now(),
});

const createNpcCreationSession = (
  topicId: string,
  groupChatId: string,
  index: number,
  personaTemplate: string,
  targetFaction: string | undefined,
  roleNiche: (typeof ROLE_NICHES)[number],
): NpcCreationSession => {
  const timestamp = now();
  return {
    id: makeId("npc_session"),
    topicId,
    groupChatId,
    index,
    status: "queued",
    personaTemplate,
    ...(targetFaction && { targetFaction }),
    roleNiche: roleNiche.name,
    reservedKeywords: roleNiche.keywords,
    revisionCount: 0,
    messages: [
      {
        id: makeId("npc_msg"),
        role: "system",
        name: "系统",
        content: [
          `已为候选玩家 ${index + 1} 分配扮演者人设：${personaTemplate}`,
          targetFaction ? `推荐阵营倾向：${targetFaction}` : undefined,
          `推荐角色生态位：${roleNiche.name}`,
          "这些是软约束，不是指定角色；候选玩家仍需自己提出角色。",
        ]
          .filter(Boolean)
          .join("\n"),
        createdAt: timestamp,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const createNpcProgressionSession = (
  topicId: string,
  groupChatId: string,
  ai: AiParticipant,
): NpcProgressionSession => {
  const timestamp = now();
  return {
    id: makeId("npc_progression"),
    topicId,
    groupChatId,
    aiId: ai.id,
    status: "queued",
    messages: [
      {
        id: makeId("npc_prog_msg"),
        role: "system",
        name: "系统",
        content: `已为 ${ai.name} 开启入群后的阵营任务和个人目标协商。`,
        createdAt: timestamp,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const createInventoryItem = (
  input: Pick<InventoryItem, "name" | "description">,
): InventoryItem => ({
  id: makeId("item"),
  name: input.name,
  description: input.description,
  createdAt: now(),
});

const getNextRecruitment = (
  recruitment: ChatRecruitment,
  completedDelta: number,
  failedDelta: number,
) => {
  const completedCount = recruitment.completedCount + completedDelta;
  const failedCount = recruitment.failedCount + failedDelta;
  const finishedCount = completedCount + failedCount;
  const status =
    finishedCount < recruitment.targetCount
      ? "running"
      : completedCount > 0
        ? "completed"
        : "failed";

  return {
    ...recruitment,
    completedCount,
    failedCount,
    status,
  } satisfies ChatRecruitment;
};

const createInitialState = () => {
  const timestamp = now();
  const topicId = makeId("topic");
  const defaultAis = cloneDefaultAis();
  const chat = createChatSession(topicId, "dialog", [defaultAis[0]!], "AI 对话");
  return {
    topics: {
      [topicId]: {
        id: topicId,
        title: "默认主题",
        description: "用于临时讨论和日常问答。",
        aiIds: defaultAis.map((ai) => ai.id),
        chatIds: [chat.id],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    ais: Object.fromEntries(defaultAis.map((ai) => [ai.id, ai])),
    chats: { [chat.id]: chat },
    messages: { [chat.id]: [] },
    npcCreationSessions: {},
    npcProgressionSessions: {},
    activeTopicId: topicId,
    activeChatId: chat.id,
  };
};

const initialState = createInitialState();

const chooseFirstChat = (
  topics: Record<string, Topic>,
  chats: Record<string, ChatSession>,
  topicId: string,
) => topics[topicId]?.chatIds.find((chatId) => chats[chatId]) ?? "";

const selectParticipants = (
  topic: Topic,
  ais: Record<string, AiParticipant>,
  participantIds: string[] | undefined,
  mode: ChatMode,
) => {
  const ids = participantIds?.length ? participantIds : topic.aiIds;
  const participants = ids
    .map((id) => ais[id])
    .filter((ai): ai is AiParticipant => Boolean(ai) && isActiveParticipant(ai));

  if (mode === "dialog") return participants.slice(0, 1);
  return participants.length > 0 ? participants : topic.aiIds.map((id) => ais[id]).filter(Boolean);
};

export const useChatWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      ...initialState,
      createRoleplayTopic: ({ title, description, roleplay, groupTitle, personaTemplates }) => {
        const timestamp = now();
        const topicId = makeId("topic");
        const chatId = makeId("chat");
        const factionNames = roleplay.factionSystem.factions.map((faction) => faction.name);
        const sessions = personaTemplates.map((persona, index) =>
          createNpcCreationSession(
            topicId,
            chatId,
            index,
            persona,
            factionNames[index % Math.max(factionNames.length, 1)],
            ROLE_NICHES[index % ROLE_NICHES.length]!,
          ),
        );
        const recruitment: ChatRecruitment = {
          status: "running",
          targetCount: sessions.length,
          completedCount: 0,
          failedCount: 0,
          sessionIds: sessions.map((session) => session.id),
          events: [
            createRecruitmentEvent({
              message: `群聊已创建，正在寻找 ${sessions.length} 位其他玩家。`,
              status: "info",
            }),
          ],
        };
        const chat: ChatSession = {
          id: chatId,
          topicId,
          title: groupTitle.trim() || `${title.trim() || "新主题"} 群聊`,
          mode: "group",
          participants: [],
          recruitment,
          factionScoreEvents: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        set((state) => ({
          topics: {
            ...state.topics,
            [topicId]: {
              id: topicId,
              title: title.trim() || "新主题",
              description,
              roleplay,
              aiIds: [],
              chatIds: [chat.id],
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          },
          chats: { ...state.chats, [chat.id]: chat },
          messages: { ...state.messages, [chat.id]: [] },
          npcCreationSessions: {
            ...state.npcCreationSessions,
            ...Object.fromEntries(sessions.map((session) => [session.id, session])),
          },
          activeTopicId: topicId,
          activeChatId: chat.id,
        }));

        return { topicId, chatId: chat.id, sessionIds: sessions.map((session) => session.id) };
      },
      createTopic: (title) => {
        const timestamp = now();
        const topicId = makeId("topic");
        const defaultAis = cloneDefaultAis();
        const chat = createChatSession(topicId, "dialog", [defaultAis[0]!], "AI 对话");
        set((state) => ({
          topics: {
            ...state.topics,
            [topicId]: {
              id: topicId,
              title: title?.trim() || "新主题",
              description: "",
              roleplay: undefined,
              aiIds: defaultAis.map((ai) => ai.id),
              chatIds: [chat.id],
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          },
          ais: {
            ...state.ais,
            ...Object.fromEntries(defaultAis.map((ai) => [ai.id, ai])),
          },
          chats: { ...state.chats, [chat.id]: chat },
          messages: { ...state.messages, [chat.id]: [] },
          activeTopicId: topicId,
          activeChatId: chat.id,
        }));
        return topicId;
      },
      renameTopic: (topicId, title) => {
        const nextTitle = title.trim();
        if (!nextTitle) return;
        set((state) => {
          const topic = state.topics[topicId];
          if (!topic) return state;
          return {
            topics: {
              ...state.topics,
              [topicId]: { ...topic, title: nextTitle, updatedAt: now() },
            },
          };
        });
      },
      deleteTopic: (topicId) => {
        set((state) => {
          const topic = state.topics[topicId];
          if (!topic) return state;
          const topics = { ...state.topics };
          const ais = { ...state.ais };
          const chats = { ...state.chats };
          const messages = { ...state.messages };
          delete topics[topicId];
          for (const aiId of topic.aiIds) delete ais[aiId];
          for (const chatId of topic.chatIds) {
            delete chats[chatId];
            delete messages[chatId];
          }
          const npcCreationSessions = Object.fromEntries(
            Object.entries(state.npcCreationSessions).filter(
              ([, session]) => session.topicId !== topicId,
            ),
          );
          const npcProgressionSessions = Object.fromEntries(
            Object.entries(state.npcProgressionSessions).filter(
              ([, session]) => session.topicId !== topicId,
            ),
          );

          const remainingTopicId = Object.keys(topics)[0];
          if (!remainingTopicId) return createInitialState();
          const activeChatId = chooseFirstChat(topics, chats, remainingTopicId);
          return {
            topics,
            ais,
            chats,
            npcCreationSessions,
            npcProgressionSessions,
            messages,
            activeTopicId: remainingTopicId,
            activeChatId,
          };
        });
      },
      createAi: (topicId, input) => {
        const ai = createAiParticipant(input, get().topics[topicId]?.aiIds.length ?? 0);
        set((state) => {
          const topic = state.topics[topicId];
          if (!topic) return state;
          return {
            ais: { ...state.ais, [ai.id]: ai },
            topics: {
              ...state.topics,
              [topicId]: {
                ...topic,
                aiIds: [...topic.aiIds, ai.id],
                updatedAt: now(),
              },
            },
          };
        });
        return ai.id;
      },
      updateAi: (aiId, input) => {
        set((state) => {
          const ai = state.ais[aiId];
          if (!ai) return state;
          const nextAi = {
            ...ai,
            ...(input.name?.trim() && { name: input.name.trim() }),
            ...(input.role?.trim() && { role: input.role.trim() }),
            ...(input.faction?.trim() && { faction: input.faction.trim() }),
            ...(input.realWorldPersona?.trim() && {
              realWorldPersona: input.realWorldPersona.trim(),
            }),
            ...(input.gamePersona?.trim() && { gamePersona: input.gamePersona.trim() }),
            ...(typeof input.points === "number" && { points: input.points }),
            ...(input.status && { status: input.status }),
            ...(input.attributes && { attributes: input.attributes }),
            ...(input.tasks && { tasks: input.tasks }),
            ...(input.personalGoal?.trim() && { personalGoal: input.personalGoal.trim() }),
            ...(input.inventory && { inventory: input.inventory }),
            ...(input.progressionSessionId && { progressionSessionId: input.progressionSessionId }),
            ...(input.systemPrompt?.trim() && {
              systemPrompt: input.systemPrompt.trim(),
            }),
            ...(input.modelId?.trim() && {
              provider: DEFAULT_AI_PROVIDER,
              modelId: input.modelId.trim(),
              modelName: input.modelName?.trim() || input.modelId.trim(),
            }),
          };
          return {
            ais: { ...state.ais, [aiId]: nextAi },
            chats: updateParticipantEverywhere(state.chats, nextAi),
          };
        });
      },
      deleteAi: (aiId) => {
        set((state) => {
          const ais = { ...state.ais };
          delete ais[aiId];
          const topics = Object.fromEntries(
            Object.entries(state.topics).map(([topicId, topic]) => [
              topicId,
              { ...topic, aiIds: topic.aiIds.filter((id) => id !== aiId) },
            ]),
          );
          return { ais, topics };
        });
      },
      createChat: (topicId, mode, title, participantIds) => {
        const state = get();
        const topic = state.topics[topicId];
        if (!topic) return "";
        let participants = selectParticipants(topic, state.ais, participantIds, mode);
        if (participants.length === 0) return "";
        let nextAis = state.ais;
        let nextChats = state.chats;

        if (mode === "dialog") {
          const participant = participants[0]!;
          if (typeof participant.points === "number" && participant.points < NPC_DIALOG_COST) {
            return "";
          }
          const chargedParticipant = withPointDelta(participant, -NPC_DIALOG_COST);
          participants = [chargedParticipant];
          if (chargedParticipant !== participant) {
            nextAis = { ...state.ais, [chargedParticipant.id]: chargedParticipant };
            nextChats = updateParticipantEverywhere(state.chats, chargedParticipant);
          }
        }

        const chat = createChatSession(topicId, mode, participants, title);
        set((current) => ({
          topics: {
            ...current.topics,
            [topicId]: {
              ...topic,
              chatIds: [chat.id, ...topic.chatIds],
              updatedAt: now(),
            },
          },
          ais: nextAis,
          chats: { ...nextChats, [chat.id]: chat },
          messages: { ...current.messages, [chat.id]: [] },
          activeTopicId: topicId,
          activeChatId: chat.id,
        }));
        return chat.id;
      },
      renameChat: (chatId, title) => {
        const nextTitle = title.trim();
        if (!nextTitle) return;
        set((state) => {
          const chat = state.chats[chatId];
          if (!chat) return state;
          return {
            chats: {
              ...state.chats,
              [chatId]: { ...chat, title: nextTitle, updatedAt: now() },
            },
          };
        });
      },
      deleteChat: (chatId) => {
        set((state) => {
          const chat = state.chats[chatId];
          if (!chat) return state;
          const topic = state.topics[chat.topicId];
          if (!topic) return state;

          const chats = { ...state.chats };
          const messages = { ...state.messages };
          delete chats[chatId];
          delete messages[chatId];

          const nextChatIds = topic.chatIds.filter((id) => id !== chatId);
          if (nextChatIds.length === 0) {
            const participants = selectParticipants(topic, state.ais, undefined, "dialog");
            const replacement = createChatSession(topic.id, "dialog", participants, "AI 对话");
            nextChatIds.push(replacement.id);
            chats[replacement.id] = replacement;
            messages[replacement.id] = [];
          }

          return {
            topics: {
              ...state.topics,
              [topic.id]: {
                ...topic,
                chatIds: nextChatIds,
                updatedAt: now(),
              },
            },
            chats,
            messages,
            activeTopicId: topic.id,
            activeChatId: state.activeChatId === chatId ? nextChatIds[0]! : state.activeChatId,
          };
        });
      },
      createAiAndJoinChat: (topicId, chatId, input) => {
        const state = get();
        const topic = state.topics[topicId];
        const chat = state.chats[chatId];
        if (!topic || !chat) return "";
        const ai = createAiParticipant(input, topic.aiIds.length);
        set((current) => ({
          ais: { ...current.ais, [ai.id]: ai },
          topics: {
            ...current.topics,
            [topicId]: {
              ...topic,
              aiIds: [...topic.aiIds, ai.id],
              updatedAt: now(),
            },
          },
          chats: {
            ...current.chats,
            [chatId]: {
              ...chat,
              participants: [...chat.participants, ai],
              updatedAt: now(),
            },
          },
        }));
        return ai.id;
      },
      appendRecruitmentEvent: (chatId, event) => {
        set((state) => {
          const chat = state.chats[chatId];
          if (!chat?.recruitment) return state;
          return {
            chats: {
              ...state.chats,
              [chatId]: {
                ...chat,
                recruitment: {
                  ...chat.recruitment,
                  events: [...chat.recruitment.events, createRecruitmentEvent(event)],
                },
                updatedAt: now(),
              },
            },
          };
        });
      },
      appendNpcCreationMessage: (sessionId, message) => {
        set((state) => {
          const session = state.npcCreationSessions[sessionId];
          if (!session) return state;
          return {
            npcCreationSessions: {
              ...state.npcCreationSessions,
              [sessionId]: {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: makeId("npc_msg"),
                    role: message.role,
                    name: message.name,
                    content: message.content,
                    createdAt: now(),
                  },
                ],
                updatedAt: now(),
              },
            },
          };
        });
      },
      setNpcCreationStatus: (sessionId, status, error) => {
        set((state) => {
          const session = state.npcCreationSessions[sessionId];
          if (!session) return state;
          return {
            npcCreationSessions: {
              ...state.npcCreationSessions,
              [sessionId]: {
                ...session,
                status,
                ...(error && { error }),
                updatedAt: now(),
              },
            },
          };
        });
      },
      incrementNpcCreationRevision: (sessionId) => {
        set((state) => {
          const session = state.npcCreationSessions[sessionId];
          if (!session) return state;
          return {
            npcCreationSessions: {
              ...state.npcCreationSessions,
              [sessionId]: {
                ...session,
                revisionCount: session.revisionCount + 1,
                updatedAt: now(),
              },
            },
          };
        });
      },
      completeNpcCreationSession: (sessionId, input) => {
        const state = get();
        const session = state.npcCreationSessions[sessionId];
        if (!session || session.status === "completed") return session?.resultAiId ?? "";
        const topic = state.topics[session.topicId];
        const fallbackAttributes = topic?.roleplay
          ? createCharacterAttributes(topic.roleplay.attributeSystem.attributes)
          : undefined;
        const aiId = get().createAiAndJoinChat(session.topicId, session.groupChatId, {
          ...input,
          realWorldPersona: input.realWorldPersona || session.personaTemplate,
          points: typeof input.points === "number" ? input.points : NPC_INITIAL_POINTS,
          status: input.status ?? "active",
          attributes: input.attributes ?? fallbackAttributes,
          tasks: input.tasks ?? [],
          inventory: input.inventory ?? [],
        });
        if (!aiId) return "";
        set((current) => {
          const latestSession = current.npcCreationSessions[sessionId];
          const chat = current.chats[session.groupChatId];
          const ai = current.ais[aiId];
          if (!latestSession || !chat?.recruitment || !ai) return current;
          const progression = createNpcProgressionSession(session.topicId, session.groupChatId, ai);
          const aiWithProgression = { ...ai, progressionSessionId: progression.id };
          const recruitment = getNextRecruitment(chat.recruitment, 1, 0);
          const chatsWithAi = updateParticipantEverywhere(current.chats, aiWithProgression);
          return {
            ais: {
              ...current.ais,
              [aiId]: aiWithProgression,
            },
            npcCreationSessions: {
              ...current.npcCreationSessions,
              [sessionId]: {
                ...latestSession,
                status: "completed",
                resultAiId: aiId,
                updatedAt: now(),
              },
            },
            npcProgressionSessions: {
              ...current.npcProgressionSessions,
              [progression.id]: progression,
            },
            chats: {
              ...chatsWithAi,
              [session.groupChatId]: {
                ...chatsWithAi[session.groupChatId]!,
                recruitment: {
                  ...recruitment,
                  events: [
                    ...recruitment.events,
                    createRecruitmentEvent({
                      sessionId,
                      status: "success",
                      message: `${input.name?.trim() || "新玩家"} 已完成角色创建并加入群聊。`,
                    }),
                  ],
                },
                updatedAt: now(),
              },
            },
          };
        });
        return aiId;
      },
      failNpcCreationSession: (sessionId, error) => {
        set((state) => {
          const session = state.npcCreationSessions[sessionId];
          if (!session || session.status === "failed" || session.status === "completed") {
            return state;
          }
          const chat = state.chats[session.groupChatId];
          if (!chat?.recruitment) return state;
          const recruitment = getNextRecruitment(chat.recruitment, 0, 1);
          return {
            npcCreationSessions: {
              ...state.npcCreationSessions,
              [sessionId]: {
                ...session,
                status: "failed",
                error,
                updatedAt: now(),
              },
            },
            chats: {
              ...state.chats,
              [session.groupChatId]: {
                ...chat,
                recruitment: {
                  ...recruitment,
                  events: [
                    ...recruitment.events,
                    createRecruitmentEvent({
                      sessionId,
                      status: "error",
                      message: `候选玩家 ${session.index + 1} 创建失败：${error}`,
                    }),
                  ],
                },
                updatedAt: now(),
              },
            },
          };
        });
      },
      appendNpcProgressionMessage: (sessionId, message) => {
        set((state) => {
          const session = state.npcProgressionSessions[sessionId];
          if (!session) return state;
          return {
            npcProgressionSessions: {
              ...state.npcProgressionSessions,
              [sessionId]: {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: makeId("npc_prog_msg"),
                    role: message.role,
                    name: message.name,
                    content: message.content,
                    createdAt: now(),
                  },
                ],
                updatedAt: now(),
              },
            },
          };
        });
      },
      setNpcProgressionStatus: (sessionId, status, error) => {
        set((state) => {
          const session = state.npcProgressionSessions[sessionId];
          if (!session) return state;
          return {
            npcProgressionSessions: {
              ...state.npcProgressionSessions,
              [sessionId]: {
                ...session,
                status,
                ...(error && { error }),
                updatedAt: now(),
              },
            },
          };
        });
      },
      completeNpcProgressionSession: (sessionId, input) => {
        set((state) => {
          const session = state.npcProgressionSessions[sessionId];
          if (!session) return state;
          const ai = state.ais[session.aiId];
          if (!ai) return state;
          const nextAi = {
            ...ai,
            tasks: input.tasks,
            personalGoal: input.personalGoal,
          };
          return {
            ais: { ...state.ais, [ai.id]: nextAi },
            chats: updateParticipantEverywhere(state.chats, nextAi),
            npcProgressionSessions: {
              ...state.npcProgressionSessions,
              [sessionId]: {
                ...session,
                status: "completed",
                updatedAt: now(),
              },
            },
          };
        });
      },
      failNpcProgressionSession: (sessionId, error) => {
        set((state) => {
          const session = state.npcProgressionSessions[sessionId];
          if (!session || session.status === "failed" || session.status === "completed") {
            return state;
          }
          return {
            npcProgressionSessions: {
              ...state.npcProgressionSessions,
              [sessionId]: {
                ...session,
                status: "failed",
                error,
                updatedAt: now(),
              },
            },
          };
        });
      },
      completeNpcTask: (aiId, taskId) => {
        set((state) => {
          const ai = state.ais[aiId];
          const task = ai?.tasks?.find((item) => item.id === taskId);
          if (!ai || !task || task.status === "completed") return state;
          const nextAi = withPointDelta(
            {
              ...ai,
              tasks: (ai.tasks ?? []).map((item) =>
                item.id === taskId ? { ...item, status: "completed" as const } : item,
              ),
            },
            task.rewardPoints,
          );
          return {
            ais: { ...state.ais, [aiId]: nextAi },
            chats: updateParticipantEverywhere(state.chats, nextAi),
          };
        });
      },
      enhanceNpcAttribute: (aiId, attributeId) => {
        set((state) => {
          const ai = state.ais[aiId];
          if (!ai?.attributes || typeof ai.points !== "number") return state;
          if (ai.points < NPC_ATTRIBUTE_UPGRADE_COST) return state;
          const nextAi = withPointDelta(
            {
              ...ai,
              attributes: ai.attributes.map((attribute) =>
                attribute.id === attributeId
                  ? { ...attribute, value: attribute.value + 1 }
                  : attribute,
              ),
            },
            -NPC_ATTRIBUTE_UPGRADE_COST,
          );
          return {
            ais: { ...state.ais, [aiId]: nextAi },
            chats: updateParticipantEverywhere(state.chats, nextAi),
          };
        });
      },
      buyNpcShopItem: (aiId, item) => {
        set((state) => {
          const ai = state.ais[aiId];
          if (!ai || typeof ai.points !== "number" || ai.points < NPC_SHOP_ITEM_COST) return state;
          const nextAi = withPointDelta(
            {
              ...ai,
              inventory: [...(ai.inventory ?? []), createInventoryItem(item)],
            },
            -NPC_SHOP_ITEM_COST,
          );
          return {
            ais: { ...state.ais, [aiId]: nextAi },
            chats: updateParticipantEverywhere(state.chats, nextAi),
          };
        });
      },
      applyFactionScoreEvent: (chatId, input) => {
        set((state) => {
          const chat = state.chats[chatId];
          if (!chat) return state;
          const topic = state.topics[chat.topicId];
          const factionSystem = topic?.roleplay?.factionSystem;
          if (!topic || !factionSystem) return state;

          const deltasByFactionId = new Map(
            input.deltas.map((delta) => [delta.factionId, delta.delta]),
          );
          const nextFactions = factionSystem.factions.map((faction) => {
            const nextScore = faction.currentScore + (deltasByFactionId.get(faction.id) ?? 0);
            return { ...faction, currentScore: Math.max(0, nextScore) };
          });
          const winningFaction =
            input.winningFactionId ||
            nextFactions.find((faction) => faction.currentScore >= faction.victoryScore)?.id;
          const event = createFactionScoreEvent(chatId, {
            ...input,
            winningFactionId: winningFaction,
          });

          return {
            topics: {
              ...state.topics,
              [topic.id]: {
                ...topic,
                roleplay: {
                  ...topic.roleplay!,
                  factionSystem: {
                    ...factionSystem,
                    factions: nextFactions,
                    ...(winningFaction && { winningFactionId: winningFaction }),
                  },
                },
                updatedAt: now(),
              },
            },
            chats: {
              ...state.chats,
              [chatId]: {
                ...chat,
                factionScoreEvents: [...(chat.factionScoreEvents ?? []), event],
                updatedAt: now(),
              },
            },
          };
        });
      },
      setActiveTopic: (topicId) => {
        const { topics, chats } = get();
        if (!topics[topicId]) return;
        set({
          activeTopicId: topicId,
          activeChatId: chooseFirstChat(topics, chats, topicId),
        });
      },
      setActiveChat: (chatId) => {
        const chat = get().chats[chatId];
        if (!chat) return;
        set({ activeTopicId: chat.topicId, activeChatId: chatId });
      },
      setChatMessages: (chatId, rows) => {
        set((state) => ({
          messages: { ...state.messages, [chatId]: rows },
        }));
      },
      upsertChatMessage: (chatId, row) => {
        set((state) => {
          const rows = state.messages[chatId] ?? [];
          const existingIndex = rows.findIndex((item) => item.id === row.id);
          const nextRows =
            existingIndex === -1
              ? [...rows, row]
              : rows.map((item, index) => (index === existingIndex ? row : item));
          const chat = state.chats[chatId];
          return {
            messages: { ...state.messages, [chatId]: nextRows },
            ...(chat && {
              chats: {
                ...state.chats,
                [chatId]: { ...chat, updatedAt: now() },
              },
            }),
          };
        });
      },
      deleteChatMessages: (chatId, ids) => {
        const idSet = new Set(ids);
        set((state) => ({
          messages: {
            ...state.messages,
            [chatId]: (state.messages[chatId] ?? []).filter((row) => !idSet.has(row.id)),
          },
        }));
      },
    }),
    {
      name: "simple-simulator-chat-workspace",
      version: 5,
      migrate: (persisted) => {
        const state = persisted as Partial<WorkspaceState>;
        if (state.ais) return createInitialState();
        return createInitialState();
      },
    },
  ),
);

export const getActiveWorkspace = () => {
  const state = useChatWorkspaceStore.getState();
  const topic = state.topics[state.activeTopicId];
  const chat = state.chats[state.activeChatId];
  return { state, topic, chat };
};
