"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, LogOutIcon, PanelsTopLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type {
  CharacterAttribute,
  ChatLeaveRequest,
  ChatSession,
  RelationshipTask,
  StoredMessageRow,
  Topic,
} from "@/lib/chat-types";
import { getTaskKeyNode } from "@/lib/task-key-node";
import { cn } from "@/lib/utils";

const EMPTY_MESSAGES: StoredMessageRow[] = [];
const EMPTY_LEAVE_REQUESTS: ChatLeaveRequest[] = [];

type WorkspaceModalApi = {
  confirm: (options: {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }) => Promise<boolean>;
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
  const chatLock = useChatWorkspaceStore((state) => state.chatLocks[chat.id]);
  const chatMessages = useChatWorkspaceStore((state) => state.messages[chat.id] ?? EMPTY_MESSAGES);
  const leaveRequests = useChatWorkspaceStore(
    (state) => state.chatLeaveRequests[chat.id] ?? EMPTY_LEAVE_REQUESTS,
  );
  const requestNaturalExit = useChatWorkspaceStore((state) => state.requestNaturalExit);
  const requestForcedExit = useChatWorkspaceStore((state) => state.requestForcedExit);
  const setChatLockStatus = useChatWorkspaceStore((state) => state.setChatLockStatus);
  const resolveLeaveRequest = useChatWorkspaceStore((state) => state.resolveLeaveRequest);
  const [expanded, setExpanded] = useState(true);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveReactions, setLeaveReactions] = useState<Record<string, string>>({});

  const roleplay = topic.roleplay;
  const participant = chat.participants[0];
  const finalScene = chat.sceneSetup?.finalScene;
  const playerAttributes = roleplay?.playerAttributes ?? [];
  const tasks = useMemo(
    () => (topic.relationshipTasks ?? []).filter((task) => task.npcId === participant?.id),
    [participant?.id, topic.relationshipTasks],
  );
  const pendingLeaveRequests = leaveRequests.filter(
    (request) => request.status === "pending_player" && request.npcId === participant?.id,
  );

  if (!roleplay || !participant) return null;

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

  const approveNpcLeave = (request: ChatLeaveRequest) => {
    const reaction = leaveReactions[request.id] || "我同意你离开。";
    resolveLeaveRequest(chat.id, request.id, "approved", reaction);
    requestNaturalExit(chat.id, {
      exitInitiator: "npc",
      exitReason: request.reason,
      exitClosing: `DM确认玩家同意 ${request.npcName} 离场。${request.npcName} 可以在当前场景中自然退场。`,
    });
  };

  const rejectNpcLeave = (request: ChatLeaveRequest) => {
    const reaction = leaveReactions[request.id] || "我不同意你现在离开。";
    resolveLeaveRequest(chat.id, request.id, "rejected", reaction);
    setChatLockStatus(chat.id, { status: "active" });
  };

  const actionCount =
    pendingLeaveRequests.length + tasks.filter((task) => task.status === "open").length;

  return (
    <div className="border-b bg-background">
      {expanded ? (
        <div className="overflow-hidden bg-background">
          <div className="flex h-10 items-center justify-between gap-2 border-b px-3">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <PanelsTopLeftIcon className="size-4 shrink-0" />
              <span className="truncate">场景与状态</span>
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                {actionCount}
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
                aria-label="收起场景与状态面板"
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
              <div className="text-sm font-semibold">{roleplay.playerRole} · 玩家属性</div>
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
                      onClick={() => approveNpcLeave(request)}
                    >
                      同意离场
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => rejectNpcLeave(request)}
                    >
                      不同意
                    </Button>
                  </div>
                </div>
              ))}
              {tasks.map((task) => (
                <ReadOnlyTaskCard key={task.id} task={task} />
              ))}
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
              <div className="font-medium">场景与状态</div>
            )}
          </div>
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5">
            {actionCount}
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
            aria-label="展开场景与状态面板"
          >
            <ChevronDownIcon className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function ReadOnlyTaskCard({ task }: { task: RelationshipTask }) {
  const hiddenNpcRequest = task.direction === "npc_to_player";
  const keyNode = getTaskKeyNode(task);
  return (
    <div className="border-border rounded-md border p-3">
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
            ? hiddenNpcRequest
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
      <div className="text-muted-foreground mt-2 text-xs">关键节点：{keyNode.uiSchema.title}</div>
      {task.resolution ? (
        <div className="text-muted-foreground mt-2 text-xs">结果：{task.resolution}</div>
      ) : null}
    </div>
  );
}

function AttributeList({ attributes }: { attributes: CharacterAttribute[] }) {
  if (attributes.length === 0) {
    return <div className="text-muted-foreground mt-2 text-xs">暂无属性。</div>;
  }
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

async function requestDmLeaveReview(
  topic: Topic,
  chat: ChatSession,
  npc: ChatSession["participants"][number],
  rows: StoredMessageRow[],
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

function formatStoredRowsForDm(rows: StoredMessageRow[]) {
  return rows
    .slice(-12)
    .map((row) => {
      const text = extractText(row.content);
      if (!text) return "";
      return `${row.id}：${text}`;
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
  if ("parts" in record) return extractText(record.parts);
  if ("content" in record) return extractText(record.content);
  return "";
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
