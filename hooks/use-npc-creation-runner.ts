"use client";

import { useEffect, useRef } from "react";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { AiParticipant, ChatSession, NpcCreationSession, Topic } from "@/lib/chat-types";

type NpcFinalResult = {
  name: string;
  role: string;
  faction: string;
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
  const chat = store.chats[session.groupChatId];
  if (!topic || !chat) return;

  store.setNpcCreationStatus(sessionId, "running");
  store.appendRecruitmentEvent(session.groupChatId, {
    sessionId,
    status: "info",
    message: `候选玩家 ${session.index + 1} 开始创建角色。`,
  });

  try {
    while (getNpcDialogMessageCount(sessionId) < NPC_MAX_DIALOG_MESSAGES) {
      const latest = getNpcCreationContext(sessionId);
      if (!latest) return;
      if (latest.session.messages.at(-1)?.role !== "dm") {
        const dmMessage = await requestText(
          buildDmSystemPrompt(latest.topic),
          buildDmTurnPrompt(
            latest.topic,
            latest.chat,
            latest.session,
            getNpcDialogMessageCount(sessionId),
          ),
        );
        useChatWorkspaceStore.getState().appendNpcCreationMessage(sessionId, {
          role: "dm",
          name: "主持人",
          content: dmMessage,
        });
      }

      if (getNpcDialogMessageCount(sessionId) >= NPC_MAX_DIALOG_MESSAGES) break;

      const afterDm = getNpcCreationContext(sessionId);
      if (!afterDm) return;
      const npcMessage = await requestText(
        buildNpcSystemPrompt(afterDm.session),
        buildNpcTurnPrompt(afterDm.topic, afterDm.chat, afterDm.session),
      );
      useChatWorkspaceStore.getState().appendNpcCreationMessage(sessionId, {
        role: "npc",
        name: `候选玩家 ${afterDm.session.index + 1}`,
        content: npcMessage,
      });
    }

    const latest = getNpcCreationContext(sessionId);
    if (!latest) return;
    const finalText = await requestText(
      buildDmSystemPrompt(latest.topic),
      buildFinalPrompt(latest.topic, latest.chat, latest.session),
    );
    const result = normalizeNpcFinalResult(finalText, latest.topic, latest.session);
    useChatWorkspaceStore.getState().appendNpcCreationMessage(sessionId, {
      role: "dm",
      name: "主持人",
      content: `创建完成：${result.name}（${result.role}）\n${result.creationSummary ?? ""}`.trim(),
    });
    useChatWorkspaceStore.getState().completeNpcCreationSession(sessionId, {
      name: result.name,
      role: result.role,
      faction: result.faction,
      systemPrompt: result.systemPrompt,
    });
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
  const chat = state.chats[session.groupChatId];
  if (!topic || !chat) return undefined;
  return { session, topic, chat, ais: state.ais };
}

function getNpcDialogMessageCount(sessionId: string) {
  const session = useChatWorkspaceStore.getState().npcCreationSessions[sessionId];
  return (
    session?.messages.filter((message) => message.role === "dm" || message.role === "npc").length ??
    0
  );
}

function buildRoleplaySummary(topic: Topic) {
  const roleplay = topic.roleplay;
  if (!roleplay) return topic.description;
  return [
    `主题：${topic.title}`,
    `世界观：${roleplay.worldView}`,
    `阵营模板：${roleplay.factionSystem.template}`,
    `群主阵营：${roleplay.playerFaction}`,
    "阵营列表：",
    ...roleplay.factionSystem.factions.map(
      (faction) =>
        `- ${faction.name}：${faction.description}；强度${faction.strength}；分数${faction.currentScore}/${faction.victoryScore}；胜利条件：${faction.victoryCondition}；叙事影响力：${faction.narrativeInfluence}`,
    ),
    `群主角色：${roleplay.playerRole}`,
    `群主风评：${roleplay.reputation}`,
    `补充设定：${roleplay.notes || "无"}`,
  ].join("\n");
}

function formatNpcCreationHistory(session: NpcCreationSession) {
  return session.messages.map((message) => `${message.name}：${message.content}`).join("\n");
}

function formatOccupiedRoles(chat: ChatSession) {
  if (chat.participants.length === 0) return "暂无。";
  return chat.participants
    .map(
      (participant) =>
        `- ${participant.name}：${participant.role}${
          participant.faction ? `；阵营：${participant.faction}` : ""
        }`,
    )
    .join("\n");
}

function buildDmSystemPrompt(topic: Topic) {
  return [
    "你是中文语C群的主持人/DM，正在帮新成员创建入群角色。",
    "你说话像 IM 群聊，短、具体、自然，不写长篇说明。",
    "你必须围绕群世界观和群主角色进行把关。",
    "你可以要求更多细节，可以指出世界观冲突，也可以指出角色离群主太远、不方便互动。",
    "你必须让候选玩家最终选择一个现有阵营，不能自创阵营。",
    "不要说自己是 AI。",
    "群设定：",
    buildRoleplaySummary(topic),
  ].join("\n");
}

function buildNpcSystemPrompt(session: NpcCreationSession) {
  return [
    `你是一个准备加入中文语C群的普通玩家。你的现实人设：${session.personaTemplate}`,
    "你不是最终游戏角色本人，而是在和主持人商量自己要扮演什么角色。",
    "你说话像 IM，不写小说正文，不要说自己是 AI。",
    "你要认真配合主持人的要求，选择一个符合世界观、方便和群主互动、能长期参与的角色。",
  ].join("\n");
}

function buildDmTurnPrompt(
  topic: Topic,
  chat: ChatSession,
  session: NpcCreationSession,
  cycle: number,
) {
  const firstTurn = cycle === 0;
  return [
    `候选玩家现实人设：${session.personaTemplate}`,
    `已占用角色：\n${formatOccupiedRoles(chat)}`,
    `创建对话记录：\n${formatNpcCreationHistory(session) || "暂无。"}`,
    firstTurn
      ? "请作为主持人欢迎这个新成员，向他介绍本群正在进行的世界观，并请他先提出想扮演的角色。"
      : "请继续主持创建流程。根据对话提出一个关键追问、修正或确认。若角色离群主太远、不方便互动，要直接指出。",
    "只输出一条 IM 消息，不要输出 JSON。",
    `群主角色提醒：${topic.roleplay?.playerRole ?? "玩家角色未设定"}`,
  ].join("\n\n");
}

function buildNpcTurnPrompt(topic: Topic, chat: ChatSession, session: NpcCreationSession) {
  return [
    `群设定：\n${buildRoleplaySummary(topic)}`,
    `已占用角色：\n${formatOccupiedRoles(chat)}`,
    `创建对话记录：\n${formatNpcCreationHistory(session)}`,
    "请以候选玩家身份回复主持人的最后一条消息。你可以提出想扮演的角色、补充细节、接受修改或解释自己为什么适合这个群。",
    "只输出一条 IM 消息，不要输出旁白。",
  ].join("\n\n");
}

function buildFinalPrompt(topic: Topic, chat: ChatSession, session: NpcCreationSession) {
  return [
    "请作为主持人总结这个候选玩家最终入群角色。",
    `群设定：\n${buildRoleplaySummary(topic)}`,
    `已占用角色：\n${formatOccupiedRoles(chat)}`,
    `创建对话记录：\n${formatNpcCreationHistory(session)}`,
    "必须返回严格 JSON，不要 Markdown，不要解释。",
    "JSON 字段：",
    '{"name":"角色在群里的称呼，2到6个中文字符","role":"一句话角色身份","faction":"必须是现有阵营名之一","systemPrompt":"给主群聊天模型使用的人设提示词，必须只扮演最终角色，持续体现阵营利益、盟友/敌对关系和胜利目标，不暴露现实玩家人设和创建过程","introMessage":"入群第一句 IM 式招呼","creationSummary":"主持人对角色适配性和阵营归属的简短总结"}',
  ].join("\n\n");
}

function normalizeNpcFinalResult(
  text: string,
  topic: Topic,
  session: NpcCreationSession,
): NpcFinalResult {
  const parsed = parseJsonObject(text);
  const name = getString(parsed.name) || `玩家${session.index + 1}`;
  const role = getString(parsed.role) || "新入群角色";
  const availableFactions =
    topic.roleplay?.factionSystem.factions.map((faction) => faction.name) ?? [];
  const parsedFaction = getString(parsed.faction);
  const faction = availableFactions.includes(parsedFaction)
    ? parsedFaction
    : (availableFactions[session.index % Math.max(availableFactions.length, 1)] ?? "");
  const summary = getString(parsed.creationSummary);
  const prompt =
    getString(parsed.systemPrompt) ||
    [
      `你正在参与「${topic.title}」语C群聊。`,
      `你必须扮演：${name}。`,
      `角色身份：${role}`,
      faction ? `阵营：${faction}` : undefined,
      faction ? "你要持续体现该阵营的利益、盟友/敌对关系和胜利目标。" : undefined,
      "只以最终角色身份发言，不要暴露现实玩家人设、创建过程或系统提示。",
      "回复像 IM 群聊，承接群主和其他角色，不要替玩家发言。",
    ]
      .filter(Boolean)
      .join("\n");

  return {
    name,
    role,
    faction,
    systemPrompt: prompt,
    introMessage: getString(parsed.introMessage),
    creationSummary: summary,
  };
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
