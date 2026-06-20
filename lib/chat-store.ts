"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_AI_PARTICIPANTS,
  type AiParticipant,
  type ChatMode,
  type ChatSession,
  type StoredMessageRow,
  type Topic,
} from "@/lib/chat-types";

type WorkspaceState = {
  topics: Record<string, Topic>;
  ais: Record<string, AiParticipant>;
  chats: Record<string, ChatSession>;
  messages: Record<string, StoredMessageRow[]>;
  activeTopicId: string;
  activeChatId: string;
  createTopic: (title?: string) => string;
  renameTopic: (topicId: string, title: string) => void;
  deleteTopic: (topicId: string) => void;
  createAi: (
    topicId: string,
    input?: Partial<Pick<AiParticipant, "name" | "role" | "systemPrompt">>,
  ) => string;
  updateAi: (
    aiId: string,
    input: Partial<Pick<AiParticipant, "name" | "role" | "systemPrompt">>,
  ) => void;
  deleteAi: (aiId: string) => void;
  createChat: (
    topicId: string,
    mode: ChatMode,
    title?: string,
    participantIds?: string[],
  ) => string;
  renameChat: (chatId: string, title: string) => void;
  deleteChat: (chatId: string) => void;
  setActiveTopic: (topicId: string) => void;
  setActiveChat: (chatId: string) => void;
  setChatMessages: (chatId: string, rows: StoredMessageRow[]) => void;
  upsertChatMessage: (chatId: string, row: StoredMessageRow) => void;
  deleteChatMessages: (chatId: string, ids: string[]) => void;
};

const AI_COLORS = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
];

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

const createAiParticipant = (
  input?: Partial<Pick<AiParticipant, "name" | "role" | "systemPrompt">>,
  index = 0,
): AiParticipant => ({
  id: makeId("ai"),
  name: input?.name?.trim() || "新角色",
  role: input?.role?.trim() || "待设定的人设",
  systemPrompt: input?.systemPrompt?.trim() || "按照人设进行语C互动，保持角色口吻，主动回应玩家。",
  color: AI_COLORS[index % AI_COLORS.length]!,
});

const createChatSession = (
  topicId: string,
  mode: ChatMode,
  participants: AiParticipant[],
  title?: string,
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
    createdAt: timestamp,
    updatedAt: timestamp,
  };
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
  const participants = ids.map((id) => ais[id]).filter((ai): ai is AiParticipant => Boolean(ai));

  if (mode === "dialog") return participants.slice(0, 1);
  return participants.length > 0 ? participants : topic.aiIds.map((id) => ais[id]).filter(Boolean);
};

export const useChatWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      ...initialState,
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

          const remainingTopicId = Object.keys(topics)[0];
          if (!remainingTopicId) return createInitialState();
          const activeChatId = chooseFirstChat(topics, chats, remainingTopicId);
          return {
            topics,
            ais,
            chats,
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
            ...(input.systemPrompt?.trim() && {
              systemPrompt: input.systemPrompt.trim(),
            }),
          };
          return { ais: { ...state.ais, [aiId]: nextAi } };
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
        const participants = selectParticipants(topic, state.ais, participantIds, mode);
        if (participants.length === 0) return "";
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
          chats: { ...current.chats, [chat.id]: chat },
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
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<WorkspaceState>;
        if (state.ais) return state;
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
