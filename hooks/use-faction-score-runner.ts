"use client";

import { useRef } from "react";
import { useAuiEvent } from "@assistant-ui/react";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { FactionScoreDelta, TopicContext } from "@/lib/chat-types";

type FactionScoreResponse = {
  summary: string;
  deltas: FactionScoreDelta[];
  winningFactionId?: string;
};

export function useFactionScoreRunner(topicContext: TopicContext) {
  const running = useRef(false);

  useAuiEvent("thread.runEnd", () => {
    if (running.current) return;
    if (topicContext.chat.mode !== "group") return;
    if (!topicContext.topic.roleplay?.factionSystem) return;
    if (topicContext.topic.roleplay.factionSystem.winningFactionId) return;

    running.current = true;
    void scoreFactionProgress(topicContext).finally(() => {
      running.current = false;
    });
  });
}

async function scoreFactionProgress(topicContext: TopicContext) {
  const state = useChatWorkspaceStore.getState();
  const chat = state.chats[topicContext.chat.id];
  const topic = state.topics[topicContext.topic.id];
  const factionSystem = topic?.roleplay?.factionSystem;
  if (!chat || !topic?.roleplay || !factionSystem) return;

  const rows = state.messages[chat.id] ?? [];
  const sourceMessageCount = rows.length;
  const lastEvent = chat.factionScoreEvents?.at(-1);
  if (lastEvent && lastEvent.sourceMessageCount >= sourceMessageCount) return;
  if (sourceMessageCount === 0) return;

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseMode: "text",
      system: [
        "你是语C群的主持人/DM，负责根据刚结束的一轮群聊更新阵营分数。",
        "你只能基于实际聊天内容、阵营胜利条件和关键节点给分。",
        "每个阵营本轮分数变化建议在 -5 到 10 之间，除非明确触发重大关键节点。",
        "如果没有任何阵营推进，返回空 deltas。",
        "必须返回严格 JSON，不要 Markdown，不要解释。",
      ].join("\n"),
      prompt: [
        `主题：${topic.title}`,
        `群主角色：${topic.roleplay.playerRole}`,
        `玩家阵营：${topic.roleplay.playerFaction}`,
        "阵营状态：",
        ...factionSystem.factions.map(
          (faction) =>
            `- id=${faction.id} name=${faction.name} score=${faction.currentScore}/${faction.victoryScore} strength=${faction.strength} victory=${faction.victoryCondition} future=${faction.futureMilestones.join("、")}`,
        ),
        "群聊角色：",
        ...chat.participants.map(
          (participant) =>
            `- ${participant.name}：${participant.role}${
              participant.faction ? `；阵营=${participant.faction}` : ""
            }`,
        ),
        "最近消息快照：",
        JSON.stringify(rows.slice(-8).map((row) => row.content)),
        '返回格式：{"summary":"本轮阵营变化总结","deltas":[{"factionId":"...","factionName":"...","delta":数字,"reason":"原因","milestone":"可选，触发/推进的关键节点"}],"winningFactionId":"可选，达到胜利分数的阵营 id"}',
      ].join("\n\n"),
    }),
  });
  if (!response.ok) return;
  const payload = (await response.json()) as { text?: string };
  const result = normalizeScoreResponse(payload.text ?? "", factionSystem.factions);
  if (result.deltas.length === 0 && !result.winningFactionId) return;

  useChatWorkspaceStore.getState().applyFactionScoreEvent(chat.id, {
    sourceMessageCount,
    summary: result.summary,
    deltas: result.deltas,
    ...(result.winningFactionId && { winningFactionId: result.winningFactionId }),
  });
}

function normalizeScoreResponse(
  text: string,
  factions: Array<{ id: string; name: string; victoryScore: number; currentScore: number }>,
): FactionScoreResponse {
  const parsed = parseJsonObject(text);
  const rawDeltas = Array.isArray(parsed.deltas) ? parsed.deltas : [];
  const deltas = rawDeltas
    .map((raw): FactionScoreDelta | undefined => {
      const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const factionId = getString(item.factionId);
      const factionName = getString(item.factionName);
      const faction =
        factions.find((candidate) => candidate.id === factionId) ||
        factions.find((candidate) => candidate.name === factionName);
      if (!faction) return undefined;
      const delta = clampNumber(item.delta, -20, 30, 0);
      if (delta === 0) return undefined;
      return {
        factionId: faction.id,
        factionName: faction.name,
        delta,
        reason: getString(item.reason) || "本轮群聊推进了阵营目标。",
        ...(getString(item.milestone) && { milestone: getString(item.milestone) }),
      };
    })
    .filter((delta): delta is FactionScoreDelta => Boolean(delta));

  const parsedWinner = getString(parsed.winningFactionId);
  const winningFactionId = factions.some((faction) => faction.id === parsedWinner)
    ? parsedWinner
    : undefined;

  return {
    summary: getString(parsed.summary) || "本轮阵营局势更新。",
    deltas,
    ...(winningFactionId && { winningFactionId }),
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("missing json");
  const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("invalid json");
  return parsed as Record<string, unknown>;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
