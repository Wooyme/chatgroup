"use client";

import { useMemo, useState } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  Dice5Icon,
  GavelIcon,
  LogOutIcon,
  PanelsTopLeftIcon,
  XIcon,
} from "lucide-react";
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

type WorkspaceModalApi = {
  confirm: (options: {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }) => Promise<boolean>;
};

type PanelFormState = {
  taskId: string;
  mode: "judge" | "dice";
};

export function NpcStatusPanel({
  topic,
  chat,
  modal,
}: {
  topic: Topic;
  chat: ChatSession;
  modal: WorkspaceModalApi;
}) {
  const resolveConsentRequest = useChatWorkspaceStore((state) => state.resolveConsentRequest);
  const resolveRelationshipTask = useChatWorkspaceStore((state) => state.resolveRelationshipTask);
  const addDiceCheck = useChatWorkspaceStore((state) => state.addDiceCheck);
  const chatLock = useChatWorkspaceStore((state) => state.chatLocks[chat.id]);
  const chatMessages = useChatWorkspaceStore((state) => state.messages[chat.id] ?? []);
  const leaveRequests = useChatWorkspaceStore((state) => state.chatLeaveRequests[chat.id] ?? []);
  const requestNaturalExit = useChatWorkspaceStore((state) => state.requestNaturalExit);
  const requestForcedExit = useChatWorkspaceStore((state) => state.requestForcedExit);
  const setChatLockStatus = useChatWorkspaceStore((state) => state.setChatLockStatus);
  const resolveLeaveRequest = useChatWorkspaceStore((state) => state.resolveLeaveRequest);
  const playerAttributes = topic.roleplay?.playerAttributes ?? [];
  const participant = chat.participants[0];
  const tasks = (topic.relationshipTasks ?? []).filter((task) => task.npcId === participant?.id);
  const pendingRequests =
    topic.consentRequests?.filter(
      (request) => request.status === "pending" && request.npcId === participant?.id,
    ) ?? [];
  const [activeForm, setActiveForm] = useState<PanelFormState | undefined>();
  const [text, setText] = useState("");
  const [playerAttributeId, setPlayerAttributeId] = useState(playerAttributes[0]?.id ?? "");
  const [npcAttributeByTask, setNpcAttributeByTask] = useState<Record<string, string>>({});
  const [busyTaskId, setBusyTaskId] = useState("");
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveReactions, setLeaveReactions] = useState<Record<string, string>>({});
  const [requestReactions, setRequestReactions] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(true);
  const finalScene = chat.sceneSetup?.finalScene;
  const pendingLeaveRequests = leaveRequests.filter(
    (request) => request.status === "pending_player" && request.npcId === participant?.id,
  );

  const npcById = useMemo(
    () => new Map(chat.participants.map((participant) => [participant.id, participant])),
    [chat.participants],
  );

  if (!topic.roleplay || !participant) {
    return null;
  }

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

  const handlePlayerLeave = async () => {
    if (!participant || leaveBusy || !finalScene) return;
    setLeaveBusy(true);
    setChatLockStatus(chat.id, { status: "player_leave_reviewing", exitInitiator: "player" });
    try {
      const review = await requestDmLeaveReview(topic, chat, participant, chatMessages);
      if (review.canLeave) {
        requestNaturalExit(chat.id, {
          exitInitiator: "player",
          exitReason: review.reason,
          exitClosing: review.closing,
        });
        return;
      }
      setChatLockStatus(chat.id, { status: "active" });
      const confirmed = await modal.confirm({
        title: "DM 不建议现在离场",
        description: `${review.reason || "DM 认为当前双方还没有达成自然离场。"}\n\n如果仍要离场，将由 DM 接管强制离场流程，NPC 会明显不愉快。`,
        confirmLabel: "强制离场",
        cancelLabel: "继续对话",
        destructive: true,
      });
      if (confirmed) {
        requestForcedExit(chat.id, "player", review.reason || "玩家在 DM 不建议时仍选择离场。");
      }
    } catch {
      setChatLockStatus(chat.id, { status: "active" });
      const confirmed = await modal.confirm({
        title: "DM 审核失败",
        description: "无法完成自然离场审核。是否改为强制离场？",
        confirmLabel: "强制离场",
        cancelLabel: "继续对话",
        destructive: true,
      });
      if (confirmed) requestForcedExit(chat.id, "player", "DM 审核失败后玩家选择强制离场。");
    } finally {
      setLeaveBusy(false);
    }
  };

  const approveNpcLeave = (requestId: string) => {
    const request = pendingLeaveRequests.find((item) => item.id === requestId);
    if (!request) return;
    const reaction = leaveReactions[requestId] || "我同意你离开。";
    resolveLeaveRequest(chat.id, requestId, "approved", reaction);
    requestNaturalExit(chat.id, {
      exitInitiator: "npc",
      exitReason: request.reason,
      exitClosing: `DM确认玩家同意 ${request.npcName} 离场。${request.npcName} 可以在当前场景中自然退场。`,
    });
  };

  const rejectNpcLeave = (requestId: string) => {
    const reaction = leaveReactions[requestId] || "我不同意你现在离开。";
    resolveLeaveRequest(chat.id, requestId, "rejected", reaction);
    setChatLockStatus(chat.id, { status: "active" });
  };

  return (
    <div className="border-b bg-background">
      {expanded ? (
        <div className="overflow-hidden bg-background">
          <div className="flex h-10 items-center justify-between gap-2 border-b px-3">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <PanelsTopLeftIcon className="size-4 shrink-0" />
              <span className="truncate">场景与任务</span>
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                {pendingRequests.length +
                  pendingLeaveRequests.length +
                  tasks.filter((task) => task.status === "open").length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                disabled={
                  leaveBusy ||
                  !finalScene ||
                  chatLock?.status === "closing" ||
                  chatLock?.status === "finalizing" ||
                  chatLock?.status === "forced_exit_requested" ||
                  chatLock?.status === "natural_exit_requested"
                }
                onClick={() => void handlePlayerLeave()}
              >
                <LogOutIcon className="size-3.5" />
                {leaveBusy || chatLock?.status === "player_leave_reviewing" ? "DM审核中" : "离场"}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => setExpanded(false)}
                aria-label="收起场景与任务面板"
              >
                <ChevronUpIcon className="size-4" />
              </Button>
            </div>
          </div>
          <div className="grid max-h-[min(34rem,calc(100vh-9rem))] gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(190px,0.7fr)_minmax(0,2fr)]">
            {finalScene ? (
              <div className="border-border rounded-md border bg-muted/20 p-3 lg:col-span-2">
                <div className="text-sm font-semibold">DM 场景</div>
                <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {finalScene}
                </div>
              </div>
            ) : null}
            <div className="border-border rounded-md border p-3">
              <div className="text-sm font-semibold">{topic.roleplay.playerRole} · 玩家属性</div>
              <AttributeList attributes={playerAttributes} />
            </div>
            <div className="grid gap-2">
              {pendingLeaveRequests.map((request) => (
                <div
                  key={request.id}
                  className="border-amber-300 bg-amber-50/70 rounded-md border p-3 text-amber-950"
                >
                  <div className="text-sm font-semibold">{request.npcName} 想要离场</div>
                  <div className="mt-1 text-sm">{request.reason}</div>
                  <textarea
                    className="border-input bg-background mt-2 min-h-16 w-full resize-y rounded-md border px-2 py-1.5 text-xs text-foreground outline-none"
                    placeholder="写一段玩家的语C反应..."
                    value={leaveReactions[request.id] ?? ""}
                    onChange={(event) =>
                      setLeaveReactions((current) => ({
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
                      onClick={() => approveNpcLeave(request.id)}
                    >
                      同意离场
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => rejectNpcLeave(request.id)}
                    >
                      不同意
                    </Button>
                  </div>
                </div>
              ))}
              {pendingRequests.map((request) => (
                <div
                  key={request.id}
                  className="border-primary/30 bg-primary/5 rounded-md border p-3"
                >
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
                const hiddenNpcRequest = task.direction === "npc_to_player";
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
                            ? "对方有事"
                            : "玩家请求 NPC"
                          : task.status === "completed"
                            ? "已完成"
                            : "失败"}
                      </span>
                    </div>
                    <div className="mt-1 text-sm">
                      {hiddenNpcRequest
                        ? task.visibleHint || `${task.npcName}似乎有什么事想和你谈。`
                        : `同意：${task.request}`}
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
                      {hiddenNpcRequest ? task.lore : `${task.stake} · ${task.suggestedApproach}`}
                    </div>
                    {task.resolution ? (
                      <div className="text-muted-foreground mt-2 text-xs">
                        结果：{task.resolution}
                      </div>
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
                        {task.direction === "player_to_npc" ? (
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
                        ) : null}
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
              {topic.diceChecks
                ?.filter((check) => check.npcId === participant.id)
                .slice(-3)
                .map((check) => (
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
      ) : (
        <div className="flex min-h-10 items-center gap-3 px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            {finalScene ? (
              <div className="truncate">
                <span className="font-medium">DM 场景：</span>
                <span className="text-muted-foreground">{finalScene}</span>
              </div>
            ) : (
              <div className="font-medium">场景与任务</div>
            )}
          </div>
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5">
            {pendingRequests.length +
              pendingLeaveRequests.length +
              tasks.filter((task) => task.status === "open").length}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            disabled={
              leaveBusy ||
              !finalScene ||
              chatLock?.status === "closing" ||
              chatLock?.status === "finalizing" ||
              chatLock?.status === "forced_exit_requested" ||
              chatLock?.status === "natural_exit_requested"
            }
            onClick={() => void handlePlayerLeave()}
          >
            <LogOutIcon className="size-3.5" />
            离场
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={() => setExpanded(true)}
            aria-label="展开场景与任务面板"
          >
            <ChevronDownIcon className="size-4" />
          </Button>
        </div>
      )}
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

async function requestDmLeaveReview(
  topic: Topic,
  chat: ChatSession,
  npc: AiParticipant,
  rows: ReturnType<typeof useChatWorkspaceStore.getState>["messages"][string],
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseMode: "text",
      system:
        "你是中文语C群的 DM。玩家请求离开当前一对一场景，你要判断双方是否都适合自然离场。必须返回严格 JSON。",
      prompt: [
        `主题：${topic.title}`,
        `世界观：${topic.roleplay?.worldView ?? topic.description}`,
        `玩家角色：${topic.roleplay?.playerRole ?? "玩家"}`,
        `NPC：${npc.name}（${npc.role}）`,
        chat.sceneSetup?.finalScene ? `当前场景：${chat.sceneSetup.finalScene}` : undefined,
        "当前开放任务：",
        ...((topic.relationshipTasks ?? [])
          .filter((task) => task.npcId === npc.id && task.status === "open")
          .map((task) => `- ${task.direction}：${task.request}；${task.stake}`) ?? []),
        `对话摘要材料：${formatStoredRowsForDm(rows) || "暂无可用对话。"}`,
        "判断标准：如果双方在语境中都能接受暂时结束，或继续对话并非必要，则 canLeave=true。若一方明显还在追问、挽留、冲突升级，或离场会显得突兀，则 canLeave=false。",
        '返回格式：{"canLeave":true或false,"reason":"简短审核理由","closing":"若自然离场，DM可见收场描述"}',
      ]
        .filter(Boolean)
        .join("\n\n"),
    }),
  });
  if (!response.ok) throw new Error("DM 离场审核失败");
  const payload = (await response.json()) as { text?: string };
  const parsed = parseJsonObject(payload.text ?? "");
  return {
    canLeave: parsed.canLeave === true,
    reason: getString(parsed.reason),
    closing: getString(parsed.closing) || "DM确认双方暂时结束这次对话，场景自然收束。",
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

function formatStoredRowsForDm(
  rows: ReturnType<typeof useChatWorkspaceStore.getState>["messages"][string],
) {
  return rows
    .slice(-12)
    .map((row, index) => {
      const text = extractText(row.content);
      return text ? `${index + 1}. ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if ("content" in record) return extractText(record.content);
  if ("parts" in record) return extractText(record.parts);
  if ("messages" in record) return extractText(record.messages);
  return "";
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
