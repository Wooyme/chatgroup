"use client";

import { useEffect, useRef } from "react";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import { ensureContextPipeline } from "@/lib/context-pipeline-defaults";
import { buildNpcCreationPipelineVariables } from "@/lib/context-pipeline-runtime";
import type { ContextPipelineTarget } from "@/lib/context-pipeline";
import type {
  AiParticipant,
  CharacterAttribute,
  ChatSession,
  NpcCreationSession,
  Topic,
} from "@/lib/chat-types";

type NpcFinalResult = {
  name: string;
  role: string;
  faction: string;
  gamePersona: string;
  attributes: CharacterAttribute[];
  systemPrompt: string;
  introMessage?: string;
  creationSummary?: string;
};

const NPC_DIALOG_CYCLES = 5;
const NPC_MAX_DIALOG_MESSAGES = NPC_DIALOG_CYCLES * 2;

export function useNpcCreationRunner(npcCreationSessions: Record<string, NpcCreationSession>) {
  const runningNpcSessions = useRef(new Set<string>());

  useEffect(() => {
    Object.values(npcCreationSessions).forEach((session) => {
      if (
        (session.status === "queued" || session.status === "running") &&
        !runningNpcSessions.current.has(session.id)
      ) {
        runningNpcSessions.current.add(session.id);
        void runNpcCreationSession(session.id).finally(() => {
          runningNpcSessions.current.delete(session.id);
        });
      }
    });
  }, [npcCreationSessions]);
}

async function requestText({
  target,
  topic,
  chat,
  session,
  cycle,
}: {
  target: ContextPipelineTarget;
  topic: Topic;
  chat: ChatSession;
  session: NpcCreationSession;
  cycle: number;
}) {
  const state = useChatWorkspaceStore.getState();
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseMode: "text",
      contextPipeline: ensureContextPipeline(topic.contextPipeline),
      pipelineTarget: target,
      pipelineVariables: buildNpcCreationPipelineVariables({
        topic,
        chat,
        session,
        cycle,
        npcCreationSessions: state.npcCreationSessions,
      }),
    }),
  });

  if (!response.ok) {
    throw new Error(`模型请求失败：${response.status}`);
  }

  const payload = (await response.json()) as { text?: string };
  const text = payload.text?.trim();
  if (!text) throw new Error("模型返回为空");
  return text;
}

async function runNpcCreationSession(sessionId: string) {
  const store = useChatWorkspaceStore.getState();
  const session = store.npcCreationSessions[sessionId];
  if (!session) return;
  const topic = store.topics[session.topicId];
  if (!topic) return;

  store.setNpcCreationStatus(sessionId, "running");
  store.appendRecruitmentEvent(session.topicId, {
    sessionId,
    status: "info",
    message: `候选玩家 ${session.index + 1} 开始创建角色。`,
  });

  try {
    while (getNpcDialogMessageCount(sessionId) < NPC_MAX_DIALOG_MESSAGES) {
      const latest = getNpcCreationContext(sessionId);
      if (!latest) return;
      if (latest.session.messages.at(-1)?.role !== "dm") {
        const dmMessage = await requestText({
          target: "npc-creation.dm-turn",
          topic: latest.topic,
          chat: latest.chat,
          session: latest.session,
          cycle: getNpcDialogMessageCount(sessionId),
        });
        useChatWorkspaceStore.getState().appendNpcCreationMessage(sessionId, {
          role: "dm",
          name: "主持人",
          content: dmMessage,
        });
      }

      if (getNpcDialogMessageCount(sessionId) >= NPC_MAX_DIALOG_MESSAGES) break;

      const afterDm = getNpcCreationContext(sessionId);
      if (!afterDm) return;
      const npcMessage = await requestText({
        target: "npc-creation.npc-turn",
        topic: afterDm.topic,
        chat: afterDm.chat,
        session: afterDm.session,
        cycle: getNpcDialogMessageCount(sessionId),
      });
      useChatWorkspaceStore.getState().appendNpcCreationMessage(sessionId, {
        role: "npc",
        name: `候选玩家 ${afterDm.session.index + 1}`,
        content: npcMessage,
      });
    }

    for (;;) {
      const latest = getNpcCreationContext(sessionId);
      if (!latest) return;
      const finalText = await requestText({
        target: "npc-creation.final",
        topic: latest.topic,
        chat: latest.chat,
        session: latest.session,
        cycle: getNpcDialogMessageCount(sessionId),
      });
      const result = normalizeNpcFinalResult(finalText, latest.topic, latest.session);
      const conflict = detectNpcConflict(result, latest.chat, latest.session);
      if (conflict && latest.session.revisionCount < 2) {
        await requestNpcRevision(latest.session.id, conflict);
        continue;
      }
      useChatWorkspaceStore.getState().appendNpcCreationMessage(sessionId, {
        role: "dm",
        name: "主持人",
        content: `创建完成：${result.name}（${result.role}｜${result.faction || "无阵营"}）\n${
          conflict ? `相似风险：${conflict}\n` : ""
        }${result.creationSummary ?? ""}`.trim(),
      });
      useChatWorkspaceStore.getState().completeNpcCreationSession(sessionId, {
        name: result.name,
        role: result.role,
        faction: result.faction,
        realWorldPersona: latest.session.personaTemplate,
        gamePersona: result.gamePersona,
        status: "active",
        attributes: result.attributes,
        systemPrompt: result.systemPrompt,
      });
      break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    useChatWorkspaceStore.getState().failNpcCreationSession(sessionId, message);
  }
}

function getNpcCreationContext(sessionId: string):
  | {
      session: NpcCreationSession;
      topic: Topic;
      chat: ChatSession;
      ais: Record<string, AiParticipant>;
    }
  | undefined {
  const state = useChatWorkspaceStore.getState();
  const session = state.npcCreationSessions[sessionId];
  if (!session) return undefined;
  const topic = state.topics[session.topicId];
  if (!topic) return undefined;
  const participants = topic.aiIds
    .map((aiId) => state.ais[aiId])
    .filter((ai): ai is AiParticipant => Boolean(ai));
  const chat = {
    id: topic.id,
    topicId: topic.id,
    title: topic.title,
    mode: "dialog",
    participants,
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt,
  } satisfies ChatSession;
  return { session, topic, chat, ais: state.ais };
}

function getNpcDialogMessageCount(sessionId: string) {
  const session = useChatWorkspaceStore.getState().npcCreationSessions[sessionId];
  return (
    session?.messages.filter((message) => message.role === "dm" || message.role === "npc").length ??
    0
  );
}

async function requestNpcRevision(sessionId: string, conflict: string) {
  const latest = getNpcCreationContext(sessionId);
  if (!latest) return;
  useChatWorkspaceStore.getState().incrementNpcCreationRevision(sessionId);
  useChatWorkspaceStore.getState().appendNpcCreationMessage(sessionId, {
    role: "dm",
    name: "主持人",
    content: [
      `这个方案需要修正：${conflict}`,
      "请候选玩家自己提出一个更有区分度的调整方案。",
      "注意：我不会直接指定你扮演谁，你需要自己保留核心兴趣并避开冲突。",
    ].join("\n"),
  });

  const afterDm = getNpcCreationContext(sessionId);
  if (!afterDm) return;
  const npcMessage = await requestText({
    target: "npc-creation.npc-turn",
    topic: afterDm.topic,
    chat: afterDm.chat,
    session: afterDm.session,
    cycle: getNpcDialogMessageCount(sessionId),
  });
  useChatWorkspaceStore.getState().appendNpcCreationMessage(sessionId, {
    role: "npc",
    name: `候选玩家 ${afterDm.session.index + 1}`,
    content: npcMessage,
  });
}

function detectNpcConflict(result: NpcFinalResult, chat: ChatSession, session: NpcCreationSession) {
  const normalizedName = normalizeText(result.name);
  const normalizedRole = normalizeText(result.role);
  const similarParticipant = chat.participants.find((participant) => {
    const participantName = normalizeText(participant.name);
    const participantRole = normalizeText(participant.role);
    const hasSimilarName =
      Boolean(normalizedName && participantName) &&
      (normalizedName === participantName ||
        normalizedName.includes(participantName) ||
        participantName.includes(normalizedName));
    const hasSimilarRole = roleSimilarity(normalizedRole, participantRole) >= 0.45;
    return hasSimilarName || hasSimilarRole;
  });
  if (similarParticipant) {
    return `和已加入主题的角色「${similarParticipant.name}（${similarParticipant.role}）」过于接近，需要换一个身份层次、职业功能或关系位置。`;
  }

  const factionCounts = new Map<string, number>();
  for (const participant of chat.participants) {
    if (participant.faction) {
      factionCounts.set(participant.faction, (factionCounts.get(participant.faction) ?? 0) + 1);
    }
  }
  if (result.faction) {
    factionCounts.set(result.faction, (factionCounts.get(result.faction) ?? 0) + 1);
  }
  const counts = Array.from(factionCounts.values());
  const minCount = counts.length > 0 ? Math.min(...counts) : 0;
  const resultFactionCount = result.faction ? (factionCounts.get(result.faction) ?? 0) : 0;
  if (
    session.targetFaction &&
    result.faction &&
    result.faction !== session.targetFaction &&
    resultFactionCount > minCount + 1
  ) {
    return `阵营「${result.faction}」已经明显偏多，本候选原本更适合补足「${session.targetFaction}」或给出更强理由。`;
  }

  return "";
}

function normalizeText(value: string) {
  return value.replace(/[^\p{Script=Han}a-zA-Z0-9]/gu, "").toLowerCase();
}

function roleSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  const leftTokens = new Set(makeBigrams(left));
  const rightTokens = new Set(makeBigrams(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function makeBigrams(value: string) {
  if (value.length <= 2) return value ? [value] : [];
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
}

function normalizeNpcFinalResult(
  text: string,
  topic: Topic,
  session: NpcCreationSession,
): NpcFinalResult {
  const parsed = parseJsonObject(text);
  const name = getString(parsed.name) || `玩家${session.index + 1}`;
  const role = getString(parsed.role) || "新加入主题的角色";
  const availableFactions =
    topic.roleplay?.factionSystem.factions.map((faction) => faction.name) ?? [];
  const parsedFaction = getString(parsed.faction);
  const faction = availableFactions.includes(parsedFaction)
    ? parsedFaction
    : (availableFactions[session.index % Math.max(availableFactions.length, 1)] ?? "");
  const summary = getString(parsed.creationSummary);
  const gamePersona = getString(parsed.gamePersona) || role;
  const attributes = normalizeAttributes(parsed.attributes, topic);
  const prompt =
    getString(parsed.systemPrompt) ||
    [
      `你正在参与「${topic.title}」语C主题。`,
      `你的现实扮演者人设：${session.personaTemplate}`,
      `你必须扮演：${name}。`,
      `角色身份：${role}`,
      `游戏内人设：${gamePersona}`,
      faction ? `阵营：${faction}` : undefined,
      faction ? "你要持续体现该阵营的利益、盟友/敌对关系和胜利目标。" : undefined,
      "现实扮演者人设只影响你的参与风格和说话习惯；默认不要主动暴露现实玩家人设、创建过程或系统提示。",
      "回复像 IM，承接玩家和当前剧情，不要替玩家发言。",
    ]
      .filter(Boolean)
      .join("\n");

  return {
    name,
    role,
    faction,
    gamePersona,
    attributes,
    systemPrompt: prompt,
    introMessage: getString(parsed.introMessage),
    creationSummary: summary,
  };
}

function normalizeAttributes(value: unknown, topic: Topic): CharacterAttribute[] {
  const definitions = topic.roleplay?.attributeSystem.attributes ?? [];
  const valuesById = new Map<string, number>();
  if (Array.isArray(value)) {
    for (const raw of value) {
      const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const id = getString(item.id);
      const score =
        typeof item.value === "number" && Number.isFinite(item.value) ? item.value : NaN;
      if (id && Number.isFinite(score))
        valuesById.set(id, Math.max(1, Math.min(20, Math.round(score))));
    }
  }
  return definitions.map((definition) => ({
    ...definition,
    value: valuesById.get(definition.id) ?? definition.defaultValue,
  }));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("主持人总结不是 JSON");
  }
  const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("主持人总结 JSON 格式错误");
  }
  return parsed as Record<string, unknown>;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
