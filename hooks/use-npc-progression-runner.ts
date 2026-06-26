"use client";

import { useEffect, useRef } from "react";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type {
  AiParticipant,
  NpcProgressionSession,
  RelationshipTask,
  RelationshipTaskDirection,
  Topic,
} from "@/lib/chat-types";

type TaskDraft = {
  npcId: string;
  npcName: string;
  direction: RelationshipTaskDirection;
  request: string;
  stake: string;
  lore: string;
  visibleHint: string;
  suggestedApproach: string;
};

const ACTIVE_STATUSES = new Set(["queued", "running"]);

export function useNpcProgressionRunner(
  npcProgressionSessions: Record<string, NpcProgressionSession>,
) {
  const runningSessions = useRef(new Set<string>());

  useEffect(() => {
    Object.values(npcProgressionSessions).forEach((session) => {
      if (ACTIVE_STATUSES.has(session.status) && !runningSessions.current.has(session.id)) {
        runningSessions.current.add(session.id);
        void runTaskAssignmentSession(session.id).finally(() => {
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

async function runTaskAssignmentSession(sessionId: string) {
  const context = getAssignmentContext(sessionId);
  if (!context) return;
  useChatWorkspaceStore.getState().setNpcProgressionStatus(sessionId, "running");

  try {
    const text = await requestText(
      buildDmSystemPrompt(context.topic),
      buildAssignmentPrompt(context.topic, context.participants, context.session),
    );
    const tasks = normalizeTasks(text, context.topic, context.participants, context.session);
    useChatWorkspaceStore.getState().appendNpcProgressionMessage(sessionId, {
      role: "dm",
      name: "主持人",
      content: [
        context.session.purpose === "initial_tasks" ? "第一轮任务已派发。" : "新任务已补发。",
        ...tasks.map(
          (task) =>
            `- ${task.npcName}：${
              task.direction === "npc_to_player" ? "NPC 请求玩家" : "玩家请求 NPC"
            }同意「${task.request}」`,
        ),
      ].join("\n"),
    });
    useChatWorkspaceStore.getState().completeNpcProgressionSession(sessionId, { tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    useChatWorkspaceStore.getState().failNpcProgressionSession(sessionId, message);
  }
}

function getAssignmentContext(sessionId: string):
  | {
      session: NpcProgressionSession;
      topic: Topic;
      participants: AiParticipant[];
    }
  | undefined {
  const state = useChatWorkspaceStore.getState();
  const session = state.npcProgressionSessions[sessionId];
  if (!session) return undefined;
  const topic = state.topics[session.topicId];
  if (!topic) return undefined;
  const participants = topic.aiIds
    .map((aiId) => state.ais[aiId])
    .filter((ai): ai is AiParticipant => Boolean(ai) && ai.status !== "left");
  if (participants.length === 0) return undefined;
  return { session, topic, participants };
}

function buildTopicSummary(topic: Topic) {
  const roleplay = topic.roleplay;
  if (!roleplay) return topic.description;
  return [
    `主题：${topic.title}`,
    `世界观：${roleplay.worldView}`,
    `玩家角色：${roleplay.playerRole}`,
    `玩家阵营：${roleplay.playerFaction}`,
    `玩家风评：${roleplay.reputation}`,
    "阵营：",
    ...roleplay.factionSystem.factions.map(
      (faction) =>
        `- ${faction.name}：${faction.description}；胜利条件：${faction.victoryCondition}`,
    ),
    "属性：",
    ...roleplay.attributeSystem.attributes.map(
      (attribute) => `- ${attribute.name}：${attribute.description}`,
    ),
  ].join("\n");
}

function buildDmSystemPrompt(topic: Topic) {
  return [
    "你是中文语C群的主持人/DM，负责给玩家和 NPC 设计双向关系任务。",
    "每个任务的核心都必须是：一方需要另一方同意某事。",
    "任务要适合语C互动，不要写成抽象目标，也不要要求替玩家发言。",
    "任务方向只有两种：npc_to_player 表示 NPC 需要玩家同意；player_to_npc 表示玩家需要 NPC 同意。",
    "不要说自己是 AI。",
    "群设定：",
    buildTopicSummary(topic),
  ].join("\n");
}

function formatNpc(ai: AiParticipant) {
  return [
    `id=${ai.id}`,
    `name=${ai.name}`,
    `role=${ai.role}`,
    ai.faction ? `faction=${ai.faction}` : undefined,
    ai.gamePersona ? `persona=${ai.gamePersona}` : undefined,
    ai.attributes?.length
      ? `attributes=${ai.attributes.map((attribute) => `${attribute.name}${attribute.value}`).join("、")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("；");
}

function buildAssignmentPrompt(
  topic: Topic,
  participants: AiParticipant[],
  session: NpcProgressionSession,
) {
  const openTasks = topic.relationshipTasks?.filter((task) => task.status === "open") ?? [];
  const focusNpc = session.focusNpcId
    ? participants.find((participant) => participant.id === session.focusNpcId)
    : undefined;

  return [
    `群设定：\n${buildTopicSummary(topic)}`,
    "NPC 列表：",
    ...(focusNpc ? [formatNpc(focusNpc)] : participants.map(formatNpc)),
    openTasks.length > 0 ? "当前未完成任务：" : undefined,
    ...openTasks.map(
      (task) => `- ${task.npcName}：${task.direction}；诉求=${task.request}；利害=${task.stake}`,
    ),
    session.reason ? `补发原因：${session.reason}` : undefined,
    session.purpose === "initial_tasks"
      ? "请派发第一轮任务，必须覆盖每个 NPC。每个 NPC 至少一条任务，方向可以 npc_to_player 或 player_to_npc，但整体要有双向关系。"
      : "请只给指定 NPC 补发一条新任务，不要重复当前未完成任务。",
    "每个任务必须附带一段能帮助带入的世界观/lore。npc_to_player 的 visibleHint 必须隐晦，不能暴露 NPC 的真实诉求；player_to_npc 可以直接说明玩家目标。",
    "必须返回严格 JSON，不要 Markdown，不要解释。",
    '返回格式：{"tasks":[{"npcId":"必须使用 NPC id","npcName":"NPC 名称","direction":"npc_to_player 或 player_to_npc","request":"需要对方同意的具体事项","stake":"为什么这件事重要/失败代价","lore":"与任务相关的一段世界观说明","visibleHint":"展示给玩家的任务提示","suggestedApproach":"建议如何在语C中推进"}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeTasks(
  text: string,
  topic: Topic,
  participants: AiParticipant[],
  session: NpcProgressionSession,
): RelationshipTask[] {
  const parsed = parseJsonObject(text);
  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const participantsById = new Map(
    participants.map((participant) => [participant.id, participant]),
  );
  const existingByNpc = new Set(
    (topic.relationshipTasks ?? [])
      .filter((task) => task.status === "open")
      .map((task) => `${task.npcId}:${task.request}`),
  );
  const drafts = rawTasks
    .map((raw): TaskDraft | undefined => {
      const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const npcId = getString(item.npcId);
      const npc = participantsById.get(npcId);
      if (!npc) return undefined;
      if (session.focusNpcId && npc.id !== session.focusNpcId) return undefined;
      const direction =
        getString(item.direction) === "player_to_npc" ? "player_to_npc" : "npc_to_player";
      const request = getString(item.request) || "同意一次关键互动安排";
      const key = `${npc.id}:${request}`;
      if (existingByNpc.has(key)) return undefined;
      return {
        npcId: npc.id,
        npcName: npc.name,
        direction,
        request,
        stake: getString(item.stake) || "这会影响双方关系和后续剧情。",
        lore:
          getString(item.lore) ||
          `${npc.name} 的处境与「${topic.title}」的局势纠缠在一起，这次互动会改变双方在局内的位置。`,
        visibleHint:
          getString(item.visibleHint) ||
          (direction === "npc_to_player"
            ? `${npc.name}似乎有什么事想和你谈。`
            : `你需要让${npc.name}同意：${request}`),
        suggestedApproach: getString(item.suggestedApproach) || "通过一次直接的语C互动推进。",
      };
    })
    .filter((task): task is TaskDraft => Boolean(task));

  const neededParticipants = session.focusNpcId
    ? participants.filter((participant) => participant.id === session.focusNpcId)
    : participants;
  for (const participant of neededParticipants) {
    if (drafts.some((task) => task.npcId === participant.id)) continue;
    drafts.push({
      npcId: participant.id,
      npcName: participant.name,
      direction: "npc_to_player",
      request: "同意进行一次私下会面",
      stake: "这会决定双方是否能建立直接关系。",
      lore: `${participant.name} 所在阵营最近在「${topic.title}」中承受压力，需要借一次私下会面判断玩家的真实立场。`,
      visibleHint: `${participant.name}似乎有什么事想和你谈。`,
      suggestedApproach: "让 NPC 在单聊中提出具体理由和交换条件。",
    });
  }

  return drafts.map((draft) => ({
    id: `rel_task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ...draft,
    status: "open",
    createdAt: Date.now(),
  }));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("任务派发不是 JSON");
  const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("任务派发 JSON 格式错误");
  }
  return parsed as Record<string, unknown>;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
