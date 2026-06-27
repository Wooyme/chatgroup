import type { RelationshipTask, TopicContext } from "@/lib/chat-types";
import { getTaskKeyNode } from "@/lib/task-key-node";
import { getToolString, parseJsonObject } from "./runtime-utils";

export async function requestDmDiceResult(
  topicContext: TopicContext,
  participant: NonNullable<TopicContext["chat"]["participants"][number]>,
  taskRequest: string,
  check: {
    playerTotal: number;
    npcTotal: number;
    winner: "player" | "npc";
    initiator: "player" | "npc";
    reason: string;
  },
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseMode: "text",
      system: "你是中文语C群的 DM。根据属性检定结果写出成功或失败的剧情结果。只输出一段简短中文。",
      prompt: [
        `主题：${topicContext.topic.title}`,
        `玩家角色：${topicContext.topic.roleplay?.playerRole ?? "玩家"}`,
        `NPC：${participant.name}（${participant.role}）`,
        `任务诉求：${taskRequest}`,
        `发起方：${check.initiator === "player" ? "玩家" : "NPC"}`,
        `发起理由：${check.reason || "请求通过属性检定推进任务。"}`,
        `玩家总值：${check.playerTotal}`,
        `NPC 总值：${check.npcTotal}`,
        `胜者：${check.winner === "npc" ? "NPC" : "玩家"}`,
        "请说明任务是否被强行推进成功，或失败方受到什么惩罚。",
      ].join("\n\n"),
    }),
  });
  if (!response.ok) throw new Error("DM 检定结果失败");
  const payload = (await response.json()) as { text?: string };
  return payload.text?.trim() || "DM 没有给出结果。";
}

export async function requestPlayerTaskJudgement(
  topicContext: TopicContext,
  participant: NonNullable<TopicContext["chat"]["participants"][number]>,
  task: RelationshipTask,
  playerText: string,
) {
  const payloadText = await requestPlainText(
    "你是中文语C群的 DM。玩家提交了一个需要 NPC 同意的关键节点。你要判断 NPC 是否同意，并返回严格 JSON。",
    [
      `主题：${topicContext.topic.title}`,
      `世界观：${topicContext.topic.roleplay?.worldView ?? topicContext.topic.description}`,
      `玩家角色：${topicContext.topic.roleplay?.playerRole ?? "玩家"}`,
      `NPC：${participant.name}（${participant.role}）`,
      `NPC 人设：${participant.gamePersona || participant.systemPrompt}`,
      `任务：玩家需要 NPC 同意「${task.request}」`,
      `关键节点：${getTaskKeyNode(task).uiSchema.title}`,
      `利害：${task.stake}`,
      `玩家提交：${playerText || "玩家请求 NPC 同意任务诉求。"}`,
      '返回格式：{"approved":true或false,"npcReaction":"NPC 的语C式反应","reason":"简短理由"}',
    ].join("\n\n"),
  );
  const parsed = parseJsonObject(payloadText);
  return {
    approved: parsed.approved === true,
    npcReaction: getToolString(parsed.npcReaction),
    reason: getToolString(parsed.reason),
  };
}

export async function requestDialogueSummaries(
  topicContext: TopicContext,
  participant: NonNullable<TopicContext["chat"]["participants"][number]>,
  transcript: string,
  trigger: "natural_exit" | "forced_exit",
) {
  const dmSummary = await requestPlainText(
    "你是中文语C游戏的 DM。你要从第三方视角概述刚结束的一轮玩家-NPC单聊。只输出一段对玩家可见的中文总结。",
    [
      `主题：${topicContext.topic.title}`,
      `玩家角色：${topicContext.topic.roleplay?.playerRole ?? "玩家"}`,
      `NPC：${participant.name}（${participant.role}）`,
      `离场方式：${trigger === "forced_exit" ? "强制离场" : "自然离场"}`,
      `对话记录：\n${transcript}`,
      "请概述本轮发生了什么、双方关系有什么变化、哪些任务或冲突被推进。不要泄露 NPC 现实身份总结。",
    ].join("\n\n"),
  );
  const privateText = await requestPlainText(
    [
      "你是一个语C玩家。现在请以现实世界扮演者身份，而不是游戏内角色身份，复盘刚才和玩家的一轮对话。",
      "必须返回严格 JSON，不要输出其他文字。",
    ].join("\n"),
    [
      participant.realWorldPersona
        ? `你的现实扮演者人设：${participant.realWorldPersona}`
        : "你的现实扮演者人设：普通语C玩家，重视互动质量。",
      `你在游戏中扮演：${participant.name}（${participant.role}）`,
      `对话记录：\n${transcript}`,
      '返回格式：{"npcPrivateSummary":"你对本轮对话的复盘","playerImpression":"你对玩家的印象","importantPoints":["之后互动要记住的点1","点2"]}',
    ].join("\n\n"),
  );
  const parsed = parseJsonObject(privateText);
  return {
    dmSummary,
    npcPrivateSummary: getToolString(parsed.npcPrivateSummary) || privateText,
    playerImpression: getToolString(parsed.playerImpression),
    importantPoints: Array.isArray(parsed.importantPoints)
      ? parsed.importantPoints.map(getToolString).filter(Boolean)
      : [],
  };
}

export async function requestSceneProposal(
  topicContext: TopicContext,
  participant: TopicContext["chat"]["participants"][number] | undefined,
  task: NonNullable<TopicContext["topic"]["relationshipTasks"]>[number] | undefined,
) {
  const prompt = [
    `主题：${topicContext.topic.title}`,
    `世界观：${topicContext.topic.roleplay?.worldView ?? topicContext.topic.description}`,
    `玩家角色：${topicContext.topic.roleplay?.playerRole ?? "玩家"}`,
    participant ? `NPC：${participant.name}（${participant.role}）` : undefined,
    participant?.faction ? `NPC 阵营：${participant.faction}` : undefined,
    task
      ? [
          `任务方向：${task.direction}`,
          task.direction === "npc_to_player"
            ? `玩家可见提示：${task.visibleHint || `${task.npcName}似乎有什么事想和你谈。`}`
            : `玩家目标：让 ${task.npcName} 同意「${task.request}」`,
          `相关世界观：${task.lore}`,
          "如果任务方向是 npc_to_player，不要在场景提案中泄露 NPC 的真实诉求，只营造其有事相求的气氛。",
        ].join("\n")
      : undefined,
    "请作为 DM 提出一个适合开启这次一对一语C的具体场景。",
    "只输出一段中文，包含地点、当前局势、双方进入场景的理由和第一眼能感知到的细节。不要替玩家或 NPC 发言。",
  ]
    .filter(Boolean)
    .join("\n\n");
  return requestPlainText(
    "你是中文语C游戏的 DM。你的场景说明要短、具体、有画面感，并保持 IM 对话前的开场语气。",
    prompt,
  );
}

export async function requestSceneRevision(
  topicContext: TopicContext,
  proposedScene: string,
  objection: string,
) {
  return requestPlainText(
    "你是中文语C游戏的 DM。玩家可以对场景提出一次异议，但最终由你裁定并输出最终场景。",
    [
      `主题：${topicContext.topic.title}`,
      `原场景：${proposedScene}`,
      `玩家异议：${objection}`,
      "请综合玩家异议后输出最终场景。可以部分采纳或拒绝，但必须给出可直接开始对话的一段中文场景。不要解释裁定过程。",
    ].join("\n\n"),
  );
}

async function requestPlainText(system: string, prompt: string) {
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
