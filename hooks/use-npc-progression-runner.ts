"use client";

import { useEffect, useRef } from "react";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type {
  AiParticipant,
  ChatSession,
  NpcProgressionSession,
  NpcTask,
  Topic,
} from "@/lib/chat-types";

type ProgressionFinalResult = {
  tasks: NpcTask[];
  personalGoal: string;
};

const PROGRESSION_MAX_MESSAGES = 10;
const NORMAL_REWARD = 2;
const KEY_REWARD = 5;

export function useNpcProgressionRunner(
  npcProgressionSessions: Record<string, NpcProgressionSession>,
) {
  const runningSessions = useRef(new Set<string>());

  useEffect(() => {
    Object.values(npcProgressionSessions).forEach((session) => {
      if (
        (session.status === "queued" || session.status === "running") &&
        !runningSessions.current.has(session.id)
      ) {
        runningSessions.current.add(session.id);
        void runNpcProgressionSession(session.id).finally(() => {
          runningSessions.current.delete(session.id);
        });
      }
    });
  }, [npcProgressionSessions]);
}

async function requestText(system: string, prompt: string) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseMode: "text",
      system,
      prompt,
    }),
  });

  if (!response.ok) throw new Error(`模型请求失败：${response.status}`);
  const payload = (await response.json()) as { text?: string };
  const text = payload.text?.trim();
  if (!text) throw new Error("模型返回为空");
  return text;
}

async function runNpcProgressionSession(sessionId: string) {
  const store = useChatWorkspaceStore.getState();
  const session = store.npcProgressionSessions[sessionId];
  if (!session) return;

  store.setNpcProgressionStatus(sessionId, "running");

  try {
    while (getProgressionMessageCount(sessionId) < PROGRESSION_MAX_MESSAGES) {
      const latest = getProgressionContext(sessionId);
      if (!latest) return;

      if (latest.session.messages.at(-1)?.role !== "dm") {
        const dmMessage = await requestText(
          buildDmSystemPrompt(latest.topic),
          buildDmTurnPrompt(latest.topic, latest.chat, latest.ai, latest.session),
        );
        useChatWorkspaceStore.getState().appendNpcProgressionMessage(sessionId, {
          role: "dm",
          name: "主持人",
          content: dmMessage,
        });
      }

      if (getProgressionMessageCount(sessionId) >= PROGRESSION_MAX_MESSAGES) break;

      const afterDm = getProgressionContext(sessionId);
      if (!afterDm) return;
      const npcMessage = await requestText(
        buildNpcSystemPrompt(afterDm.ai),
        buildNpcTurnPrompt(afterDm.topic, afterDm.chat, afterDm.ai, afterDm.session),
      );
      useChatWorkspaceStore.getState().appendNpcProgressionMessage(sessionId, {
        role: "npc",
        name: afterDm.ai.name,
        content: npcMessage,
      });
    }

    const latest = getProgressionContext(sessionId);
    if (!latest) return;
    const finalText = await requestText(
      buildDmSystemPrompt(latest.topic),
      buildFinalPrompt(latest.topic, latest.chat, latest.ai, latest.session),
    );
    const result = normalizeFinalResult(finalText);
    useChatWorkspaceStore.getState().appendNpcProgressionMessage(sessionId, {
      role: "dm",
      name: "主持人",
      content: `任务协商完成。\n个人目标：${result.personalGoal}\n${result.tasks
        .map((task) => `- ${task.title}（+${task.rewardPoints}）`)
        .join("\n")}`,
    });
    useChatWorkspaceStore.getState().completeNpcProgressionSession(sessionId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    useChatWorkspaceStore.getState().failNpcProgressionSession(sessionId, message);
  }
}

function getProgressionContext(sessionId: string):
  | {
      session: NpcProgressionSession;
      topic: Topic;
      chat: ChatSession;
      ai: AiParticipant;
    }
  | undefined {
  const state = useChatWorkspaceStore.getState();
  const session = state.npcProgressionSessions[sessionId];
  if (!session) return undefined;
  const topic = state.topics[session.topicId];
  const chat = state.chats[session.groupChatId];
  const ai = state.ais[session.aiId];
  if (!topic || !chat || !ai) return undefined;
  return { session, topic, chat, ai };
}

function getProgressionMessageCount(sessionId: string) {
  const session = useChatWorkspaceStore.getState().npcProgressionSessions[sessionId];
  return (
    session?.messages.filter((message) => message.role === "dm" || message.role === "npc").length ??
    0
  );
}

function buildTopicSummary(topic: Topic) {
  const roleplay = topic.roleplay;
  if (!roleplay) return topic.description;
  return [
    `主题：${topic.title}`,
    `世界观：${roleplay.worldView}`,
    `玩家角色：${roleplay.playerRole}`,
    `玩家阵营：${roleplay.playerFaction}`,
    "阵营：",
    ...roleplay.factionSystem.factions.map(
      (faction) =>
        `- ${faction.name}：${faction.description}；分数${faction.currentScore}/${faction.victoryScore}；胜利条件：${faction.victoryCondition}`,
    ),
    "属性：",
    ...roleplay.attributeSystem.attributes.map(
      (attribute) => `- ${attribute.name}：${attribute.description}`,
    ),
  ].join("\n");
}

function formatHistory(session: NpcProgressionSession) {
  return session.messages.map((message) => `${message.name}：${message.content}`).join("\n");
}

function formatNpcProfile(ai: AiParticipant) {
  return [
    `NPC：${ai.name}`,
    `现实扮演者人设：${ai.realWorldPersona || "未记录"}`,
    `游戏内角色：${ai.gamePersona || ai.role}`,
    `阵营：${ai.faction || "无"}`,
    `积分：${ai.points ?? "无"}`,
    `属性：${ai.attributes?.map((attribute) => `${attribute.name}${attribute.value}`).join("、") || "无"}`,
  ].join("\n");
}

function buildDmSystemPrompt(topic: Topic) {
  return [
    "你是中文语C群的主持人/DM，正在给已入群 NPC 安排阵营任务和个人目标。",
    "你说话像 IM，短、自然、具体。",
    "你可以直接派发阵营任务，但个人目标必须和 NPC 讨论后形成。",
    "任务要能推动阵营胜利条件，也要方便和群主角色产生互动。",
    "普通任务奖励 2 分，关键任务奖励 5 分。",
    "不要说自己是 AI。",
    "群设定：",
    buildTopicSummary(topic),
  ].join("\n");
}

function buildNpcSystemPrompt(ai: AiParticipant) {
  return [
    `你的现实扮演者人设：${ai.realWorldPersona || "普通语C玩家"}`,
    `你在语C游戏中的角色人设：${ai.gamePersona || ai.role}`,
    ai.faction ? `你的阵营：${ai.faction}` : undefined,
    `你的当前积分：${ai.points ?? 0}`,
    "你正在和 DM 讨论你入群后的阵营任务、个人目标和第一个个人任务。",
    "现实扮演者人设影响你的语气和偏好；游戏角色人设决定你的目标、利益和行动边界。",
    "回复像 IM，不写小说正文，不要说自己是 AI。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDmTurnPrompt(
  topic: Topic,
  chat: ChatSession,
  ai: AiParticipant,
  session: NpcProgressionSession,
) {
  const firstTurn = getProgressionMessageCount(session.id) === 0;
  return [
    `群设定：\n${buildTopicSummary(topic)}`,
    `群成员：${chat.participants.map((participant) => participant.name).join("、")}`,
    `NPC 档案：\n${formatNpcProfile(ai)}`,
    `协商记录：\n${formatHistory(session) || "暂无。"}`,
    firstTurn
      ? "请先给这个 NPC 派发 1-2 个阵营任务，然后问他个人想达成什么目标。"
      : "请继续推进协商：确认个人目标，或把个人目标拆成一个可执行的第一个个人任务。",
    "只输出一条 IM 消息，不要输出 JSON。",
  ].join("\n\n");
}

function buildNpcTurnPrompt(
  topic: Topic,
  chat: ChatSession,
  ai: AiParticipant,
  session: NpcProgressionSession,
) {
  return [
    `群设定：\n${buildTopicSummary(topic)}`,
    `群成员：${chat.participants.map((participant) => participant.name).join("、")}`,
    `NPC 档案：\n${formatNpcProfile(ai)}`,
    `协商记录：\n${formatHistory(session)}`,
    "请以这个 NPC 的扮演者身份回复 DM，讨论你愿意承担的阵营任务、个人目标和第一个个人任务。",
    "只输出一条 IM 消息。",
  ].join("\n\n");
}

function buildFinalPrompt(
  topic: Topic,
  chat: ChatSession,
  ai: AiParticipant,
  session: NpcProgressionSession,
) {
  return [
    "请作为 DM 总结这个 NPC 的阵营任务、个人目标和第一个个人任务。",
    `群设定：\n${buildTopicSummary(topic)}`,
    `群成员：${chat.participants.map((participant) => participant.name).join("、")}`,
    `NPC 档案：\n${formatNpcProfile(ai)}`,
    `协商记录：\n${formatHistory(session)}`,
    "必须返回严格 JSON，不要 Markdown，不要解释。",
    "至少 1 个阵营任务，至少 1 个个人任务。",
    '返回格式：{"personalGoal":"...","factionTasks":[{"title":"...","description":"...","rewardKind":"normal 或 key"}],"personalTasks":[{"title":"...","description":"...","rewardKind":"normal 或 key"}]}',
  ].join("\n\n");
}

function normalizeFinalResult(text: string): ProgressionFinalResult {
  const parsed = parseJsonObject(text);
  const personalGoal = getString(parsed.personalGoal) || "在群内稳住自己的位置并推动阵营利益。";
  const factionTasks = normalizeTasks(parsed.factionTasks, "faction");
  const personalTasks = normalizeTasks(parsed.personalTasks, "personal");
  return {
    personalGoal,
    tasks: [...factionTasks, ...personalTasks],
  };
}

function normalizeTasks(value: unknown, type: NpcTask["type"]) {
  const rawTasks = Array.isArray(value) ? value : [];
  const tasks = rawTasks.slice(0, type === "faction" ? 3 : 2).map((raw, index): NpcTask => {
    const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const rewardKind = getString(item.rewardKind) === "key" ? "key" : "normal";
    return {
      id: `task_${type}_${Date.now().toString(36)}_${index}_${Math.random()
        .toString(36)
        .slice(2, 6)}`,
      title: getString(item.title) || (type === "faction" ? "推进阵营目标" : "完成个人目标"),
      description: getString(item.description) || "待在剧情中推进。",
      type,
      rewardKind,
      rewardPoints: rewardKind === "key" ? KEY_REWARD : NORMAL_REWARD,
      status: "open",
    };
  });
  if (tasks.length > 0) return tasks;
  const fallback: NpcTask = {
    id: `task_${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: type === "faction" ? "推进阵营目标" : "建立个人目标",
    description: "在后续剧情中寻找一次明确行动机会。",
    type,
    rewardKind: "normal",
    rewardPoints: NORMAL_REWARD,
    status: "open",
  };
  return [fallback];
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("任务总结不是 JSON");
  const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("任务总结 JSON 格式错误");
  }
  return parsed as Record<string, unknown>;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
