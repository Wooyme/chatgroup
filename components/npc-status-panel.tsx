"use client";

import { useMemo, useState } from "react";
import { Dice5Icon, GavelIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type {
  AiParticipant,
  CharacterAttribute,
  ChatSession,
  RelationshipTask,
  Topic,
} from "@/lib/chat-types";
import { cn } from "@/lib/utils";

type PanelFormState = {
  taskId: string;
  mode: "judge" | "dice";
};

export function NpcStatusPanel({ topic, chat }: { topic: Topic; chat: ChatSession }) {
  const resolveConsentRequest = useChatWorkspaceStore((state) => state.resolveConsentRequest);
  const resolveRelationshipTask = useChatWorkspaceStore((state) => state.resolveRelationshipTask);
  const addDiceCheck = useChatWorkspaceStore((state) => state.addDiceCheck);
  const playerAttributes = topic.roleplay?.playerAttributes ?? [];
  const tasks = chat.relationshipTasks ?? [];
  const pendingRequests =
    chat.consentRequests?.filter((request) => request.status === "pending") ?? [];
  const [activeForm, setActiveForm] = useState<PanelFormState | undefined>();
  const [text, setText] = useState("");
  const [playerAttributeId, setPlayerAttributeId] = useState(playerAttributes[0]?.id ?? "");
  const [npcAttributeByTask, setNpcAttributeByTask] = useState<Record<string, string>>({});
  const [busyTaskId, setBusyTaskId] = useState("");
  const [requestReactions, setRequestReactions] = useState<Record<string, string>>({});

  const npcById = useMemo(
    () => new Map(chat.participants.map((participant) => [participant.id, participant])),
    [chat.participants],
  );

  if (!topic.roleplay || (tasks.length === 0 && playerAttributes.length === 0)) return null;

  const judgePlayerRequest = async (task: RelationshipTask) => {
    const npc = npcById.get(task.npcId);
    if (!npc) return;
    setBusyTaskId(task.id);
    try {
      const result = await requestDmJudgement(topic, chat, npc, task, text);
      resolveRelationshipTask(
        chat.id,
        task.id,
        result.approved ? "completed" : "failed",
        `${result.approved ? "NPC 同意" : "NPC 拒绝"}：${result.npcReaction || result.reason}`,
      );
      setActiveForm(undefined);
      setText("");
    } finally {
      setBusyTaskId("");
    }
  };

  const runPlayerDiceCheck = async (task: RelationshipTask) => {
    const npc = npcById.get(task.npcId);
    const playerAttribute = playerAttributes.find(
      (attribute) => attribute.id === playerAttributeId,
    );
    const npcAttribute = npc?.attributes?.find(
      (attribute) => attribute.id === (npcAttributeByTask[task.id] || npc.attributes?.[0]?.id),
    );
    if (!npc || !playerAttribute || !npcAttribute) return;
    setBusyTaskId(task.id);
    try {
      const result = rollOpposedCheck(playerAttribute, npcAttribute);
      const dmResult = await requestDmDiceResult(topic, chat, npc, task, "player", result);
      addDiceCheck(chat.id, {
        taskId: task.id,
        npcId: npc.id,
        npcName: npc.name,
        initiator: "player",
        playerAttributeId: playerAttribute.id,
        playerAttributeName: playerAttribute.name,
        playerAttributeValue: playerAttribute.value,
        npcAttributeId: npcAttribute.id,
        npcAttributeName: npcAttribute.name,
        npcAttributeValue: npcAttribute.value,
        playerRoll: result.playerRoll,
        npcRoll: result.npcRoll,
        playerTotal: result.playerTotal,
        npcTotal: result.npcTotal,
        winner: result.winner,
        dmResult,
      });
      resolveRelationshipTask(
        chat.id,
        task.id,
        result.winner === "player" ? "completed" : "failed",
        dmResult,
      );
      setActiveForm(undefined);
    } finally {
      setBusyTaskId("");
    }
  };

  return (
    <div className="border-b bg-background">
      <div className="grid max-h-80 gap-3 overflow-y-auto px-4 py-3 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,2fr)]">
        <div className="border-border rounded-md border p-3">
          <div className="text-sm font-semibold">{topic.roleplay.playerRole} · 玩家属性</div>
          <AttributeList attributes={playerAttributes} />
        </div>
        <div className="grid gap-2">
          {pendingRequests.map((request) => (
            <div key={request.id} className="border-primary/30 bg-primary/5 rounded-md border p-3">
              <div className="text-sm font-semibold">{request.npcName} 的申请</div>
              <div className="mt-1 text-sm">{request.requestTitle}</div>
              <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {request.requestBody}
              </div>
              <textarea
                className="border-input bg-background mt-2 min-h-16 w-full resize-y rounded-md border px-2 py-1.5 text-xs outline-none"
                placeholder="写一段玩家的语C反应..."
                value={requestReactions[request.id] ?? ""}
                onChange={(event) =>
                  setRequestReactions((current) => ({
                    ...current,
                    [request.id]: event.target.value,
                  }))
                }
              />
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    resolveConsentRequest(
                      chat.id,
                      request.id,
                      true,
                      requestReactions[request.id] || "我同意。",
                    )
                  }
                >
                  同意
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() =>
                    resolveConsentRequest(
                      chat.id,
                      request.id,
                      false,
                      requestReactions[request.id] || "我拒绝。",
                    )
                  }
                >
                  驳回
                </Button>
              </div>
            </div>
          ))}
          {tasks.map((task) => {
            const npc = npcById.get(task.npcId);
            const formOpen = activeForm?.taskId === task.id;
            return (
              <div key={task.id} className="border-border rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{task.npcName}</span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs",
                      task.status === "open"
                        ? "bg-muted text-muted-foreground"
                        : task.status === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {task.status === "open"
                      ? task.direction === "npc_to_player"
                        ? "NPC 请求玩家"
                        : "玩家请求 NPC"
                      : task.status === "completed"
                        ? "已完成"
                        : "失败"}
                  </span>
                </div>
                <div className="mt-1 text-sm">同意：{task.request}</div>
                <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {task.stake} · {task.suggestedApproach}
                </div>
                {task.resolution ? (
                  <div className="text-muted-foreground mt-2 text-xs">结果：{task.resolution}</div>
                ) : null}
                {task.status === "open" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {task.direction === "player_to_npc" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() => {
                          setActiveForm({ taskId: task.id, mode: "judge" });
                          setText("");
                        }}
                      >
                        <GavelIcon className="size-3.5" />
                        请求 DM 判断
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      disabled={!npc?.attributes?.length || playerAttributes.length === 0}
                      onClick={() => {
                        setActiveForm({ taskId: task.id, mode: "dice" });
                        setNpcAttributeByTask((current) => ({
                          ...current,
                          [task.id]: npc?.attributes?.[0]?.id ?? "",
                        }));
                      }}
                    >
                      <Dice5Icon className="size-3.5" />
                      属性检定
                    </Button>
                  </div>
                ) : null}
                {formOpen && activeForm?.mode === "judge" ? (
                  <div className="bg-muted/40 mt-3 grid gap-2 rounded-md p-2">
                    <textarea
                      className="border-input bg-background min-h-20 w-full resize-y rounded-md border px-2 py-1.5 text-xs outline-none"
                      placeholder="写下玩家提出的要求、对话依据和语C反应..."
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={busyTaskId === task.id}
                        onClick={() => judgePlayerRequest(task)}
                      >
                        {busyTaskId === task.id ? "DM 判断中..." : "提交"}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => setActiveForm(undefined)}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : null}
                {formOpen && activeForm?.mode === "dice" && npc?.attributes?.length ? (
                  <div className="bg-muted/40 mt-3 grid gap-2 rounded-md p-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <AttributeSelect
                        label="玩家属性"
                        attributes={playerAttributes}
                        value={playerAttributeId}
                        onChange={setPlayerAttributeId}
                      />
                      <AttributeSelect
                        label={`${npc.name} 属性`}
                        attributes={npc.attributes}
                        value={npcAttributeByTask[task.id] || npc.attributes[0]!.id}
                        onChange={(value) =>
                          setNpcAttributeByTask((current) => ({ ...current, [task.id]: value }))
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={busyTaskId === task.id}
                        onClick={() => runPlayerDiceCheck(task)}
                      >
                        {busyTaskId === task.id ? "检定中..." : "投骰"}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => setActiveForm(undefined)}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {chat.diceChecks?.slice(-3).map((check) => (
            <div
              key={check.id}
              className="text-muted-foreground rounded-md border px-3 py-2 text-xs"
            >
              {check.npcName} 检定：玩家 {check.playerAttributeName} {check.playerRoll}+
              {check.playerAttributeValue}={check.playerTotal}；NPC {check.npcAttributeName}{" "}
              {check.npcRoll}+{check.npcAttributeValue}={check.npcTotal}。{check.dmResult}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AttributeList({ attributes }: { attributes: CharacterAttribute[] }) {
  return (
    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
      {attributes.map((attribute) => (
        <div
          key={attribute.id}
          className="bg-muted/40 flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-xs"
          title={attribute.description}
        >
          <span className="min-w-0 flex-1 truncate">{attribute.name}</span>
          <span className="font-medium">{attribute.value}</span>
        </div>
      ))}
    </div>
  );
}

function AttributeSelect({
  label,
  attributes,
  value,
  onChange,
}: {
  label: string;
  attributes: CharacterAttribute[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        className="border-input bg-background h-8 rounded-md border px-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {attributes.map((attribute) => (
          <option key={attribute.id} value={attribute.id}>
            {attribute.name} {attribute.value}
          </option>
        ))}
      </select>
    </label>
  );
}

async function requestDmJudgement(
  topic: Topic,
  chat: ChatSession,
  npc: AiParticipant,
  task: RelationshipTask,
  playerText: string,
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseMode: "text",
      system:
        "你是中文语C群的 DM。你根据玩家与 NPC 的当前关系任务判断 NPC 是否同意玩家的请求。必须返回严格 JSON。",
      prompt: [
        `主题：${topic.title}`,
        `玩家角色：${topic.roleplay?.playerRole ?? "玩家"}`,
        `NPC：${npc.name}（${npc.role}）`,
        `NPC 人设：${npc.gamePersona || npc.systemPrompt}`,
        `任务：玩家需要 NPC 同意「${task.request}」`,
        `利害：${task.stake}`,
        `玩家提交：${playerText || "玩家请求 NPC 同意任务诉求。"}`,
        '返回格式：{"approved":true或false,"npcReaction":"NPC 的语C式反应","reason":"简短理由"}',
      ].join("\n\n"),
    }),
  });
  if (!response.ok) throw new Error("DM 判断失败");
  const payload = (await response.json()) as { text?: string };
  const parsed = parseJsonObject(payload.text ?? "");
  return {
    approved: parsed.approved === true,
    npcReaction: getString(parsed.npcReaction),
    reason: getString(parsed.reason),
  };
}

async function requestDmDiceResult(
  topic: Topic,
  chat: ChatSession,
  npc: AiParticipant,
  task: RelationshipTask,
  initiator: "npc" | "player",
  result: ReturnType<typeof rollOpposedCheck>,
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseMode: "text",
      system: "你是中文语C群的 DM。根据属性检定结果写出成功或失败的剧情结果。只输出一段简短中文。",
      prompt: [
        `主题：${topic.title}`,
        `会话：${chat.title}`,
        `NPC：${npc.name}（${npc.role}）`,
        `任务诉求：${task.request}`,
        `发起方：${initiator === "player" ? "玩家" : "NPC"}`,
        `玩家总值：${result.playerTotal}`,
        `NPC 总值：${result.npcTotal}`,
        `胜者：${result.winner === "player" ? "玩家" : "NPC"}`,
        "请说明任务是否被强行推进成功，或失败方受到什么惩罚。",
      ].join("\n\n"),
    }),
  });
  if (!response.ok) throw new Error("DM 检定结果失败");
  const payload = (await response.json()) as { text?: string };
  return payload.text?.trim() || "DM 没有给出结果。";
}

function rollOpposedCheck(playerAttribute: CharacterAttribute, npcAttribute: CharacterAttribute) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const playerRoll = rollD20();
    const npcRoll = rollD20();
    const playerTotal = playerRoll + playerAttribute.value;
    const npcTotal = npcRoll + npcAttribute.value;
    if (playerTotal !== npcTotal || attempt === 1) {
      return {
        playerRoll,
        npcRoll,
        playerTotal,
        npcTotal,
        winner: playerTotal >= npcTotal ? "player" : "npc",
      } as const;
    }
  }
  throw new Error("unreachable");
}

function rollD20() {
  return Math.floor(Math.random() * 20) + 1;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
