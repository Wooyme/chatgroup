"use client";

import { useMemo } from "react";
import { AssistantRuntimeProvider, useAssistantTool } from "@assistant-ui/react";
import type {
  GenericThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageStorageEntry,
  ThreadHistoryAdapter,
} from "@assistant-ui/core";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { UIMessage } from "ai";
import { Thread } from "@/components/assistant-ui/thread";
import { useFactionScoreRunner } from "@/hooks/use-faction-score-runner";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { StoredMessageRow, TopicContext } from "@/lib/chat-types";

type StorageContent = Record<string, unknown>;

const makeHistoryAdapter = (chatId: string): ThreadHistoryAdapter => ({
  async load() {
    return { messages: [], headId: null };
  },
  async append() {},
  withFormat<TMessage, TStorageFormat extends StorageContent>(
    formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
  ) {
    const adapter: GenericThreadHistoryAdapter<TMessage> = {
      async load() {
        const rows = useChatWorkspaceStore.getState().messages[chatId] ?? [];
        const compatibleRows = rows.filter(
          (row) => row.format === formatAdapter.format,
        ) as StoredMessageRow<TStorageFormat>[];

        return {
          headId: compatibleRows.at(-1)?.id ?? null,
          messages: compatibleRows.map((row) =>
            formatAdapter.decode({
              id: row.id,
              parent_id: row.parent_id,
              format: row.format,
              content: row.content,
            } satisfies MessageStorageEntry<TStorageFormat>),
          ),
        };
      },
      async append(item) {
        const content = formatAdapter.encode(item);
        const id = formatAdapter.getId(item.message);
        useChatWorkspaceStore.getState().upsertChatMessage(chatId, {
          id,
          parent_id: item.parentId,
          format: formatAdapter.format,
          content,
          createdAt: Date.now(),
        });
      },
      async update(item, localMessageId) {
        const content = formatAdapter.encode(item);
        useChatWorkspaceStore.getState().upsertChatMessage(chatId, {
          id: formatAdapter.getId(item.message) || localMessageId,
          parent_id: item.parentId,
          format: formatAdapter.format,
          content,
          createdAt: Date.now(),
        });
      },
      async delete(items) {
        const ids = items.map((item) => formatAdapter.getId(item.message));
        useChatWorkspaceStore.getState().deleteChatMessages(chatId, ids);
      },
    };
    return adapter;
  },
});

export function ChatRuntime({ topicContext }: { topicContext: TopicContext }) {
  const historyAdapter = useMemo(
    () => makeHistoryAdapter(topicContext.chat.id),
    [topicContext.chat.id],
  );
  const transport = useMemo(
    () =>
      new AssistantChatTransport<UIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: async (options) => ({
          body: {
            ...options.body,
            id: options.id,
            messages: options.messages,
            trigger: options.trigger,
            messageId: options.messageId,
            metadata: options.requestMetadata,
            topicContext,
          },
        }),
      }),
    [topicContext],
  );
  const runtime = useChatRuntime({
    id: topicContext.chat.id,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport,
    adapters: { history: historyAdapter },
  });

  const isGroup = topicContext.chat.mode === "group";
  const participantNames = topicContext.chat.participants
    .map((participant) => participant.name)
    .join("、");

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <FactionScoreRuntime topicContext={topicContext} />
      <RelationshipTools topicContext={topicContext} />
      <Thread
        welcomeTitle={
          isGroup ? `向 ${participantNames} 发起群组互动` : `与 ${participantNames || "AI"} 开始语C`
        }
        composerPlaceholder={isGroup ? "向群聊发送消息..." : "向角色发送消息..."}
      />
    </AssistantRuntimeProvider>
  );
}

function FactionScoreRuntime({ topicContext }: { topicContext: TopicContext }) {
  useFactionScoreRunner(topicContext);
  return null;
}

function RelationshipTools({ topicContext }: { topicContext: TopicContext }) {
  const isDialog = topicContext.chat.mode === "dialog";
  const participant = topicContext.chat.participants[0];

  useAssistantTool({
    toolName: "request_player_consent",
    type: "frontend",
    description: "当 NPC 需要玩家同意某个关系任务诉求时调用。一次单聊最多调用三次。",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        requestTitle: { type: "string" },
        requestBody: { type: "string" },
        npcReactionHint: { type: "string" },
      },
      required: ["taskId", "requestTitle", "requestBody"],
    },
    disabled: !isDialog || !participant,
    execute: async (args) => {
      if (!participant) return { accepted: false, reason: "没有 NPC" };
      const count = useChatWorkspaceStore
        .getState()
        .incrementToolCallCount(topicContext.chat.id, participant.id);
      if (count > 3) {
        return {
          accepted: false,
          exhausted: true,
          reason: "本次单聊的三次申请机会已经用完。请等待 DM 介入，选择其他路径或结束本次对话。",
        };
      }
      const taskId = getToolString(args.taskId);
      const request = useChatWorkspaceStore.getState().addConsentRequest(topicContext.chat.id, {
        taskId,
        npcId: participant.id,
        npcName: participant.name,
        requestTitle: getToolString(args.requestTitle) || "请求玩家同意",
        requestBody: getToolString(args.requestBody) || "NPC 提出了一个需要玩家同意的请求。",
        npcReactionHint: getToolString(args.npcReactionHint),
      });
      return {
        accepted: Boolean(request),
        requestId: request?.id,
        remainingAttempts: Math.max(0, 3 - count),
      };
    },
    render: ({ args, result, status }) => (
      <div className="border-border bg-muted/40 my-2 rounded-md border px-3 py-2 text-sm">
        <div className="font-medium">{getToolString(args.requestTitle) || "NPC 申请"}</div>
        <div className="text-muted-foreground mt-1 text-xs">
          {status.type === "running"
            ? "申请生成中..."
            : isRecord(result) && result.exhausted
              ? "三次申请机会已用尽，等待 DM 介入。"
              : "申请已发送到任务面板，等待玩家处理。"}
        </div>
      </div>
    ),
  });

  useAssistantTool({
    toolName: "request_dm_check",
    type: "frontend",
    description:
      "当 NPC 想请 DM 介入，选择自身属性和玩家属性进行 d20+属性值 对抗检定时调用。胜出直接完成任务，失败任务失败。",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        npcAttributeId: { type: "string" },
        playerAttributeId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["taskId", "npcAttributeId", "playerAttributeId"],
    },
    disabled: !isDialog || !participant,
    execute: async (args) => {
      if (!participant) return { ok: false, reason: "没有 NPC" };
      const state = useChatWorkspaceStore.getState();
      const task = topicContext.chat.relationshipTasks?.find(
        (item) => item.id === getToolString(args.taskId),
      );
      const npcAttribute = participant.attributes?.find(
        (attribute) => attribute.id === getToolString(args.npcAttributeId),
      );
      const playerAttribute = topicContext.topic.roleplay?.playerAttributes.find(
        (attribute) => attribute.id === getToolString(args.playerAttributeId),
      );
      if (!task || !npcAttribute || !playerAttribute) {
        return { ok: false, reason: "任务或属性不存在" };
      }
      const check = rollOpposedCheck(playerAttribute.value, npcAttribute.value);
      const dmResult = await requestDmDiceResult(topicContext, participant, task.request, {
        ...check,
        reason: getToolString(args.reason),
      });
      state.addDiceCheck(topicContext.chat.id, {
        taskId: task.id,
        npcId: participant.id,
        npcName: participant.name,
        initiator: "npc",
        playerAttributeId: playerAttribute.id,
        playerAttributeName: playerAttribute.name,
        playerAttributeValue: playerAttribute.value,
        npcAttributeId: npcAttribute.id,
        npcAttributeName: npcAttribute.name,
        npcAttributeValue: npcAttribute.value,
        playerRoll: check.playerRoll,
        npcRoll: check.npcRoll,
        playerTotal: check.playerTotal,
        npcTotal: check.npcTotal,
        winner: check.winner,
        dmResult,
      });
      state.resolveRelationshipTask(
        topicContext.chat.id,
        task.id,
        check.winner === "npc" ? "completed" : "failed",
        dmResult,
      );
      return { ok: true, ...check, dmResult };
    },
    render: ({ result, status }) => (
      <div className="border-border bg-muted/40 my-2 rounded-md border px-3 py-2 text-sm">
        <div className="font-medium">DM 属性检定</div>
        <div className="text-muted-foreground mt-1 text-xs">
          {status.type === "running"
            ? "检定中..."
            : isRecord(result) && "playerTotal" in result
              ? `玩家 ${String(result.playerTotal ?? "-")} / NPC ${String(result.npcTotal ?? "-")}`
              : "检定完成"}
        </div>
      </div>
    ),
  });

  return null;
}

function getToolString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function rollOpposedCheck(playerValue: number, npcValue: number) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const playerRoll = Math.floor(Math.random() * 20) + 1;
    const npcRoll = Math.floor(Math.random() * 20) + 1;
    const playerTotal = playerRoll + playerValue;
    const npcTotal = npcRoll + npcValue;
    if (playerTotal !== npcTotal || attempt === 1) {
      return {
        playerRoll,
        npcRoll,
        playerTotal,
        npcTotal,
        winner: npcTotal > playerTotal ? "npc" : "player",
      } as const;
    }
  }
  throw new Error("unreachable");
}

async function requestDmDiceResult(
  topicContext: TopicContext,
  participant: NonNullable<TopicContext["chat"]["participants"][number]>,
  taskRequest: string,
  check: {
    playerTotal: number;
    npcTotal: number;
    winner: "player" | "npc";
    reason: string;
  },
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseMode: "text",
      system:
        "你是中文语C群的 DM。根据 NPC 发起的属性检定结果写出成功或失败的剧情结果。只输出一段简短中文。",
      prompt: [
        `主题：${topicContext.topic.title}`,
        `玩家角色：${topicContext.topic.roleplay?.playerRole ?? "玩家"}`,
        `NPC：${participant.name}（${participant.role}）`,
        `任务诉求：${taskRequest}`,
        `NPC 发起理由：${check.reason || "NPC 请求强行推进任务。"}`,
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
