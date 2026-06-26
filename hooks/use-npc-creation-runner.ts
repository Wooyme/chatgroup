"use client";

import { useEffect, useRef } from "react";
import { useChatWorkspaceStore } from "@/lib/chat-store";
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

    for (;;) {
      const latest = getNpcCreationContext(sessionId);
      if (!latest) return;
      const finalText = await requestText(
        buildDmSystemPrompt(latest.topic),
        buildFinalPrompt(latest.topic, latest.chat, latest.session),
      );
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

function buildRoleplaySummary(topic: Topic) {
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

function formatInFlightSessions(session: NpcCreationSession) {
  const state = useChatWorkspaceStore.getState();
  return Object.values(state.npcCreationSessions)
    .filter((item) => item.topicId === session.topicId && item.id !== session.id)
    .map(
      (item) =>
        `- 候选玩家${item.index + 1}：状态=${item.status}；推荐阵营=${
          item.targetFaction || "无"
        }；生态位=${item.roleNiche || "无"}；关键词=${item.reservedKeywords.join("、")}`,
    )
    .join("\n");
}

function buildDmSystemPrompt(topic: Topic) {
  return [
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
}

function buildNpcSystemPrompt(session: NpcCreationSession) {
  return [
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
    `推荐阵营倾向：${session.targetFaction || "无"}`,
    `推荐角色生态位：${session.roleNiche || "无"}`,
    `差异化关键词：${session.reservedKeywords.join("、") || "无"}`,
    `已占用角色：\n${formatOccupiedRoles(chat)}`,
    `其他并行创建中的候选：\n${formatInFlightSessions(session) || "暂无。"}`,
    `创建对话记录：\n${formatNpcCreationHistory(session) || "暂无。"}`,
    firstTurn
      ? "请作为主持人欢迎这个新成员，向他介绍本主题正在进行的世界观，并请他先提出想扮演的角色。"
      : "请继续主持创建流程。根据对话提出一个关键追问、修正或确认。若角色离玩家太远、不方便互动，要直接指出。",
    "只输出一条 IM 消息，不要输出 JSON。",
    `玩家角色提醒：${topic.roleplay?.playerRole ?? "玩家角色未设定"}`,
  ].join("\n\n");
}

function buildNpcTurnPrompt(topic: Topic, chat: ChatSession, session: NpcCreationSession) {
  return [
    `群设定：\n${buildRoleplaySummary(topic)}`,
    `推荐阵营倾向：${session.targetFaction || "无"}`,
    `推荐角色生态位：${session.roleNiche || "无"}`,
    `差异化关键词：${session.reservedKeywords.join("、") || "无"}`,
    `已占用角色：\n${formatOccupiedRoles(chat)}`,
    `其他并行创建中的候选：\n${formatInFlightSessions(session) || "暂无。"}`,
    `创建对话记录：\n${formatNpcCreationHistory(session)}`,
    "请以候选玩家身份回复主持人的最后一条消息。你可以提出想扮演的角色、补充细节、接受修改或解释自己为什么适合这个主题。",
    "只输出一条 IM 消息，不要输出旁白。",
  ].join("\n\n");
}

function buildFinalPrompt(topic: Topic, chat: ChatSession, session: NpcCreationSession) {
  return [
    "请作为主持人总结这个候选玩家最终加入主题的角色。",
    `群设定：\n${buildRoleplaySummary(topic)}`,
    `推荐阵营倾向：${session.targetFaction || "无"}`,
    `推荐角色生态位：${session.roleNiche || "无"}`,
    `差异化关键词：${session.reservedKeywords.join("、") || "无"}`,
    `已占用角色：\n${formatOccupiedRoles(chat)}`,
    `其他并行创建中的候选：\n${formatInFlightSessions(session) || "暂无。"}`,
    `创建对话记录：\n${formatNpcCreationHistory(session)}`,
    "必须返回严格 JSON，不要 Markdown，不要解释。",
    "JSON 字段：",
    '{"name":"角色在主题中的称呼，2到6个中文字符","role":"一句话角色身份","faction":"必须是现有阵营名之一","gamePersona":"这个 NPC 在语C游戏中的完整人设，包含身份、目标、关系位置和长期动机","attributes":[{"id":"必须使用属性模板中的 id","value":数字}],"systemPrompt":"给单聊模型使用的人设提示词，必须同时保存现实扮演者人设和游戏角色人设，持续体现阵营利益、盟友/敌对关系和胜利目标","introMessage":"加入主题后的第一句 IM 式招呼","creationSummary":"主持人对角色适配性和阵营归属的简短总结"}',
  ].join("\n\n");
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
