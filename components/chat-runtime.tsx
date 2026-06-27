"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  useAssistantTool,
  useAui,
  useAuiEvent,
  useAuiState,
  useThreadRuntime,
} from "@assistant-ui/react";
import type {
  GenericThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatRepository,
  MessageStorageEntry,
  ThreadHistoryAdapter,
} from "@assistant-ui/core";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { UIMessage } from "ai";
import { Thread } from "@/components/assistant-ui/thread";
import { Button } from "@/components/ui/button";
import { useFactionScoreRunner } from "@/hooks/use-faction-score-runner";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { StoredMessageRow, TopicContext } from "@/lib/chat-types";

type StorageContent = Record<string, unknown>;
type UiMessageRepository = MessageFormatRepository<UIMessage>;

const AI_SDK_STORAGE_FORMAT = "ai-sdk/v6";
const EMPTY_STORED_MESSAGES: StoredMessageRow[] = [];

const isUiMessage = (value: unknown): value is UIMessage =>
  isRecord(value) && typeof value.id === "string" && typeof value.role === "string";

const toStoredMessageRow = (
  message: UIMessage,
  parentId: string | null,
  index: number,
): StoredMessageRow => {
  const { id, ...content } = message;
  return {
    id,
    parent_id: parentId,
    format: AI_SDK_STORAGE_FORMAT,
    content: content as StorageContent,
    createdAt: Date.now() + index,
  };
};

const restoreInitialMessages = (rows: StoredMessageRow[]): UIMessage[] =>
  rows.flatMap((row) => {
    if (row.format !== AI_SDK_STORAGE_FORMAT || !isRecord(row.content)) return [];
    return [{ id: row.id, ...row.content } as UIMessage];
  });

const rowsFromRuntimeExternalState = (externalState: unknown): StoredMessageRow[] => {
  if (Array.isArray(externalState)) {
    return externalState.flatMap((message, index) => {
      if (!isUiMessage(message)) return [];
      const previous = externalState[index - 1];
      return [toStoredMessageRow(message, isUiMessage(previous) ? previous.id : null, index)];
    });
  }

  if (!isRecord(externalState) || !Array.isArray(externalState.messages)) return [];
  const repository = externalState as Partial<UiMessageRepository>;
  return (repository.messages ?? []).flatMap((item, index) => {
    if (!isUiMessage(item.message)) return [];
    return [toStoredMessageRow(item.message, item.parentId ?? null, index)];
  });
};

const rowsSnapshot = (rows: StoredMessageRow[]) =>
  JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      parent_id: row.parent_id,
      format: row.format,
      content: row.content,
    })),
  );

const hasWorkspaceStoreHydrated = () => {
  const persistApi = useChatWorkspaceStore.persist;
  return typeof persistApi?.hasHydrated === "function" ? persistApi.hasHydrated() : true;
};

function usePersistHydrated() {
  const [hydrated, setHydrated] = useState(hasWorkspaceStoreHydrated);

  useEffect(() => {
    const persistApi = useChatWorkspaceStore.persist;
    if (typeof persistApi?.hasHydrated !== "function") {
      setHydrated(true);
      return undefined;
    }
    if (persistApi.hasHydrated()) {
      setHydrated(true);
      return undefined;
    }
    return persistApi.onFinishHydration(() => setHydrated(true));
  }, []);

  return hydrated;
}

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
  const hydrated = usePersistHydrated();

  if (!hydrated) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm text-neutral-500">
        正在恢复对话...
      </div>
    );
  }

  return <HydratedChatRuntime topicContext={topicContext} />;
}

function HydratedChatRuntime({ topicContext }: { topicContext: TopicContext }) {
  const storedRows = useChatWorkspaceStore(
    (state) => state.messages[topicContext.chat.id] ?? EMPTY_STORED_MESSAGES,
  );
  const initialMessages = useMemo(() => restoreInitialMessages(storedRows), [storedRows]);
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
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport,
    adapters: { history: historyAdapter },
  });

  const participantNames = topicContext.chat.participants
    .map((participant) => participant.name)
    .join("、");

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RuntimeMessageStoreSync
        chatId={topicContext.chat.id}
        initialRowCount={storedRows.length}
      />
      <FactionScoreRuntime topicContext={topicContext} />
      <RelationshipTools topicContext={topicContext} />
      <ChatRoundLockRuntime topicContext={topicContext} />
      <SceneSetupGate topicContext={topicContext}>
        <Thread
          welcomeTitle={`与 ${participantNames || "AI"} 开始语C`}
          composerPlaceholder="向角色发送消息..."
        />
      </SceneSetupGate>
    </AssistantRuntimeProvider>
  );
}

function RuntimeMessageStoreSync({
  chatId,
  initialRowCount,
}: {
  chatId: string;
  initialRowCount: number;
}) {
  const threadRuntime = useThreadRuntime();
  const setChatMessages = useChatWorkspaceStore((state) => state.setChatMessages);
  const lastSnapshotRef = useRef("");
  const skipFirstEmptyRef = useRef(initialRowCount > 0);

  useEffect(() => {
    const syncMessages = () => {
      const rows = rowsFromRuntimeExternalState(threadRuntime.exportExternalState());
      if (rows.length === 0 && skipFirstEmptyRef.current) {
        skipFirstEmptyRef.current = false;
        return;
      }
      skipFirstEmptyRef.current = false;

      const nextSnapshot = rowsSnapshot(rows);
      if (nextSnapshot === lastSnapshotRef.current) return;
      lastSnapshotRef.current = nextSnapshot;
      setChatMessages(chatId, rows);
    };

    syncMessages();
    return threadRuntime.subscribe(syncMessages);
  }, [chatId, setChatMessages, threadRuntime]);

  return null;
}

function FactionScoreRuntime({ topicContext }: { topicContext: TopicContext }) {
  useFactionScoreRunner(topicContext);
  return null;
}

function ChatRoundLockRuntime({ topicContext }: { topicContext: TopicContext }) {
  const api = useAui();
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const runtimeMessages = useAuiState((state) => state.thread.messages);
  const forcedExitStartedRef = useRef(false);
  const naturalExitStartedRef = useRef(false);
  const finalizingRef = useRef(false);
  const chatId = topicContext.chat.id;
  const participant = topicContext.chat.participants[0];
  const setup = useChatWorkspaceStore(
    (state) => state.chats[chatId]?.sceneSetup ?? topicContext.chat.sceneSetup,
  );
  const lock = useChatWorkspaceStore((state) => state.chatLocks[chatId]);
  const startChatLock = useChatWorkspaceStore((state) => state.startChatLock);
  const setChatLockStatus = useChatWorkspaceStore((state) => state.setChatLockStatus);
  const markForcedExitClosing = useChatWorkspaceStore((state) => state.markForcedExitClosing);
  const clearChatLock = useChatWorkspaceStore((state) => state.clearChatLock);
  const recordDialogueTranscript = useChatWorkspaceStore((state) => state.recordDialogueTranscript);
  const completeDialogueSummary = useChatWorkspaceStore((state) => state.completeDialogueSummary);
  const failDialogueSummary = useChatWorkspaceStore((state) => state.failDialogueSummary);
  const hasDialogueSummary = useChatWorkspaceStore((state) =>
    Object.values(state.dialogueSummaries).some((summary) => summary.chatId === chatId),
  );
  const hasVisibleStoredMessages = useChatWorkspaceStore((state) =>
    (state.messages[chatId] ?? []).some(isVisibleStoredMessageRow),
  );
  const openTasks = (topicContext.topic.relationshipTasks ?? []).filter(
    (task) => participant && task.npcId === participant.id && task.status === "open",
  );

  const finalizeRound = useCallback(
    async (trigger: "natural_exit" | "forced_exit") => {
      if (!participant || finalizingRef.current) return;
      finalizingRef.current = true;
      setChatLockStatus(chatId, {
        status: "finalizing",
        exitInitiator: lock?.exitInitiator,
        exitReason: lock?.exitReason,
      });
      const threadMessages = api.thread().getState().messages ?? runtimeMessages;
      const visibleTranscript = formatRuntimeMessagesForTranscript(threadMessages);
      const naturalClosing =
        trigger === "natural_exit" &&
        lock?.exitClosing &&
        !visibleTranscript.includes(lock.exitClosing)
          ? `DM：${lock.exitClosing}`
          : "";
      const transcriptText = [visibleTranscript, naturalClosing].filter(Boolean).join("\n");
      const messageIds = getRuntimeMessageIds(threadMessages);
      const transcript = recordDialogueTranscript({
        topicId: topicContext.topic.id,
        chatId,
        npcId: participant.id,
        npcName: participant.name,
        trigger,
        messageIds,
        transcript: transcriptText || "本轮对话没有可记录的公开消息。",
      });
      try {
        const summary = await requestDialogueSummaries(
          topicContext,
          participant,
          transcript.transcript,
          trigger,
        );
        api.thread().append({
          role: "assistant",
          content: [{ type: "text", text: `【DM总结】\n${summary.dmSummary}` }],
        });
        completeDialogueSummary({
          transcriptId: transcript.id,
          topicId: topicContext.topic.id,
          chatId,
          npcId: participant.id,
          npcName: participant.name,
          trigger,
          dmSummary: summary.dmSummary,
          npcPrivateSummary: summary.npcPrivateSummary,
          playerImpression: summary.playerImpression,
          importantPoints: summary.importantPoints,
        });
      } catch (error) {
        failDialogueSummary({
          transcriptId: transcript.id,
          topicId: topicContext.topic.id,
          chatId,
          npcId: participant.id,
          npcName: participant.name,
          trigger,
          error: error instanceof Error ? error.message : "对话总结生成失败",
        });
      } finally {
        finalizingRef.current = false;
        naturalExitStartedRef.current = false;
        forcedExitStartedRef.current = false;
        clearChatLock(chatId);
      }
    },
    [
      api,
      chatId,
      clearChatLock,
      completeDialogueSummary,
      failDialogueSummary,
      lock?.exitInitiator,
      lock?.exitReason,
      participant,
      recordDialogueTranscript,
      runtimeMessages,
      setChatLockStatus,
      topicContext,
    ],
  );

  useEffect(() => {
    if (
      !topicContext.topic.roleplay ||
      !participant ||
      setup?.status !== "final" ||
      (hasDialogueSummary && hasVisibleStoredMessages)
    ) {
      return;
    }
    if (!lock) {
      startChatLock(chatId, participant.id);
    }
  }, [
    chatId,
    hasDialogueSummary,
    hasVisibleStoredMessages,
    lock,
    participant,
    setup?.status,
    startChatLock,
    topicContext.topic.roleplay,
  ]);

  useEffect(() => {
    if (
      !lock ||
      lock.status !== "natural_exit_requested" ||
      isRunning ||
      naturalExitStartedRef.current
    ) {
      return;
    }
    naturalExitStartedRef.current = true;
    api.thread().append({
      role: "assistant",
      content: [
        {
          type: "text",
          text: `【DM】\n${lock.exitClosing || "DM确认双方自然结束这次对话，当前场景收束。"}`,
        },
      ],
    });
    void finalizeRound("natural_exit");
  }, [api, finalizeRound, isRunning, lock]);

  useEffect(() => {
    if (
      !lock ||
      lock.status !== "forced_exit_requested" ||
      isRunning ||
      forcedExitStartedRef.current ||
      !participant
    ) {
      return;
    }
    forcedExitStartedRef.current = true;
    markForcedExitClosing(chatId);
    api.thread().append({
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "【系统隐藏消息：强制离场收场】",
            lock.exitInitiator === "npc"
              ? `${participant.name} 在玩家不同意后选择强制离场。请作为 DM 接管离场过程，并让场景自然但带有摩擦地收束。`
              : `玩家试图在本轮对话未收场前离开。请作为 DM 接管离场过程，并让 ${participant.name} 做出不愉快但符合人设的收场反应。`,
            `当前场景：${setup?.finalScene || setup?.dmScene || "未记录具体场景。"}`,
            lock.exitReason ? `离场理由：${lock.exitReason}` : undefined,
            openTasks.length > 0
              ? `未完成诉求：${openTasks
                  .map((task) => `${task.npcName} 需要「${task.request}」`)
                  .join("；")}`
              : "当前没有未完成任务，但离场仍显得突兀。",
            "只输出一段自然的语C收场。不要替玩家继续对话，不要继续推进新任务。",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      metadata: {
        custom: {
          hidden: true,
          kind: "forced_exit_trigger",
        },
      },
    });
  }, [api, chatId, isRunning, lock, markForcedExitClosing, openTasks, participant, setup]);

  useAuiEvent("thread.runEnd", () => {
    const latestLock = useChatWorkspaceStore.getState().chatLocks[chatId];
    if (latestLock?.status !== "closing") return;
    void finalizeRound("forced_exit");
  });

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
    toolName: "request_leave",
    type: "frontend",
    description:
      "当 NPC 希望结束当前一对一语C对话并自然离场时调用。玩家会看到离场申请，可以同意或不同意。",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
      required: ["reason"],
    },
    disabled: !isDialog || !participant,
    execute: async (args) => {
      if (!participant) return { accepted: false, reason: "没有 NPC" };
      const request = useChatWorkspaceStore.getState().createLeaveRequest(topicContext.chat.id, {
        initiator: "npc",
        reason: getToolString(args.reason) || `${participant.name} 想暂时离开当前对话。`,
      });
      return {
        accepted: Boolean(request),
        requestId: request?.id,
        instruction: request
          ? "离场申请已展示给玩家。请等待玩家同意或拒绝，不要自行宣布已经离开。"
          : "离场申请创建失败。",
      };
    },
    render: ({ args, result, status }) => (
      <div className="border-border bg-muted/40 my-2 rounded-md border px-3 py-2 text-sm">
        <div className="font-medium">NPC 请求离场</div>
        <div className="text-muted-foreground mt-1 text-xs">
          {status.type === "running"
            ? "离场申请生成中..."
            : isRecord(result) && result.accepted
              ? "申请已发送到场景面板，等待玩家处理。"
              : getToolString(args.reason) || "NPC 希望结束当前对话。"}
        </div>
      </div>
    ),
  });

  useAssistantTool({
    toolName: "force_leave",
    type: "frontend",
    description: "仅当 NPC 的离场申请被玩家拒绝后调用。调用后 DM 会接管强制离场流程。",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
      required: ["reason"],
    },
    disabled: !isDialog || !participant,
    execute: async (args) => {
      if (!participant) return { accepted: false, reason: "没有 NPC" };
      const state = useChatWorkspaceStore.getState();
      const latestRejected = (state.chatLeaveRequests[topicContext.chat.id] ?? [])
        .filter(
          (request) =>
            request.npcId === participant.id &&
            request.initiator === "npc" &&
            request.status === "rejected",
        )
        .at(-1);
      if (!latestRejected) {
        return {
          accepted: false,
          reason: "你需要先调用 request_leave，并在玩家拒绝后才能强制离场。",
        };
      }
      state.resolveLeaveRequest(
        topicContext.chat.id,
        latestRejected.id,
        "forced",
        latestRejected.playerReaction,
      );
      state.requestForcedExit(
        topicContext.chat.id,
        "npc",
        getToolString(args.reason) || `${participant.name} 在玩家拒绝后仍坚持离场。`,
      );
      return {
        accepted: true,
        instruction: "DM 将接管强制离场流程。不要继续推进任务，等待 DM 收场。",
      };
    },
    render: ({ result, status }) => (
      <div className="border-destructive/30 bg-destructive/5 my-2 rounded-md border px-3 py-2 text-sm">
        <div className="font-medium">NPC 强制离场</div>
        <div className="text-muted-foreground mt-1 text-xs">
          {status.type === "running"
            ? "正在通知 DM..."
            : isRecord(result) && result.accepted
              ? "DM 将接管强制离场流程。"
              : "强制离场未被接受。"}
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
      const task = topicContext.topic.relationshipTasks?.find(
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

function SceneSetupGate({
  topicContext,
  children,
}: {
  topicContext: TopicContext;
  children: ReactNode;
}) {
  const setup = useChatWorkspaceStore(
    (state) => state.chats[topicContext.chat.id]?.sceneSetup ?? topicContext.chat.sceneSetup,
  );
  const setSceneSetup = useChatWorkspaceStore((state) => state.setSceneSetup);
  const participant = topicContext.chat.participants[0];
  const task = setup?.taskId
    ? topicContext.topic.relationshipTasks?.find((item) => item.id === setup.taskId)
    : topicContext.topic.relationshipTasks?.find(
        (item) => participant && item.npcId === participant.id && item.status === "open",
      );
  const [objection, setObjection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sceneRetry, setSceneRetry] = useState(0);
  const sceneRequestKeyRef = useRef("");
  useEffect(() => {
    if (!setup || setup.status !== "pending") return;
    const requestKey = `${topicContext.chat.id}:${setup.npcId}:${setup.taskId ?? "none"}:${sceneRetry}`;
    if (sceneRequestKeyRef.current === requestKey) return;
    sceneRequestKeyRef.current = requestKey;

    setBusy(true);
    setError("");
    void requestSceneProposal(topicContext, participant, task)
      .then((scene) => {
        setSceneSetup(topicContext.chat.id, {
          ...setup,
          status: "proposed",
          dmScene: scene,
        });
      })
      .catch((sceneError: unknown) => {
        sceneRequestKeyRef.current = "";
        setError(sceneError instanceof Error ? sceneError.message : "DM 场景生成失败");
      })
      .finally(() => {
        setBusy(false);
      });
  }, [participant, sceneRetry, setSceneSetup, setup, task, topicContext]);

  if (!setup || setup.status === "final") {
    return (
      <>
        <NpcFirstMessageStarter topicContext={topicContext} />
        {children}
      </>
    );
  }

  const proposedScene = setup.dmScene || "DM 正在准备对话场景...";

  const acceptScene = () => {
    setSceneSetup(topicContext.chat.id, {
      ...setup,
      status: "final",
      finalScene: setup.dmScene || proposedScene,
    });
  };

  const submitObjection = async () => {
    const text = objection.trim();
    if (!text || setup.objectionUsed) return;
    setBusy(true);
    setError("");
    try {
      const finalScene = await requestSceneRevision(topicContext, proposedScene, text);
      setSceneSetup(topicContext.chat.id, {
        ...setup,
        status: "final",
        playerObjection: text,
        finalScene,
        objectionUsed: true,
      });
    } catch (sceneError) {
      setError(sceneError instanceof Error ? sceneError.message : "DM 场景裁定失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center gap-4 px-4">
      <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
        <div className="text-sm font-semibold">DM 正在确认对话场景</div>
        <div className="whitespace-pre-line text-sm leading-relaxed">{proposedScene}</div>
        {task?.lore ? (
          <div className="text-muted-foreground rounded-md border bg-background px-3 py-2 text-xs leading-relaxed">
            {task.lore}
          </div>
        ) : null}
        {error ? <div className="text-destructive text-xs">{error}</div> : null}
        {!setup.objectionUsed ? (
          <textarea
            className="border-input bg-background min-h-20 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none"
            placeholder="你可以提出一次异议，例如想换地点、时间或开场状态..."
            value={objection}
            onChange={(event) => setObjection(event.target.value)}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy || !setup.dmScene} onClick={acceptScene}>
            接受场景
          </Button>
          {error ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                sceneRequestKeyRef.current = "";
                setError("");
                setSceneRetry((current) => current + 1);
              }}
            >
              重新生成
            </Button>
          ) : null}
          {!setup.objectionUsed ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy || !setup.dmScene || !objection.trim()}
              onClick={() => void submitObjection()}
            >
              {busy ? "DM 裁定中..." : "提出异议"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NpcFirstMessageStarter({ topicContext }: { topicContext: TopicContext }) {
  const api = useAui();
  const started = useRef(false);
  const hasVisibleStoredMessages = useChatWorkspaceStore((state) =>
    (state.messages[topicContext.chat.id] ?? []).some(isVisibleStoredMessageRow),
  );
  const setup = useChatWorkspaceStore(
    (state) => state.chats[topicContext.chat.id]?.sceneSetup ?? topicContext.chat.sceneSetup,
  );
  const setSceneSetup = useChatWorkspaceStore((state) => state.setSceneSetup);
  const resetEmptyChatRuntimeState = useChatWorkspaceStore(
    (state) => state.resetEmptyChatRuntimeState,
  );
  const participant = topicContext.chat.participants[0];
  const task = setup?.taskId
    ? topicContext.topic.relationshipTasks?.find((item) => item.id === setup.taskId)
    : undefined;

  useEffect(() => {
    if (
      !setup ||
      setup.status !== "final" ||
      hasVisibleStoredMessages ||
      started.current ||
      task?.direction === "player_to_npc" ||
      !participant
    ) {
      return;
    }
    started.current = true;
    resetEmptyChatRuntimeState(topicContext.chat.id);
    api.thread().append({
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "【系统隐藏消息：NPC开场触发】",
            `DM 场景：${setup.finalScene || setup.dmScene || ""}`,
            `请作为 ${participant.name} 先开口，像正常语C私聊一样自然发起互动。`,
            task ? `你的隐藏任务诉求：让玩家同意「${task.request}」` : undefined,
            task ? `利害：${task.stake}` : undefined,
            task ? `推进建议：${task.suggestedApproach}` : undefined,
            task
              ? "第一句可以铺垫，不必立刻摊牌，但要让玩家感觉你确实有事相求。不要替玩家发言。"
              : "请自然开启对话，说明你进入当前场景的动作或一句开场白。不要替玩家发言。",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      metadata: {
        custom: {
          hidden: true,
          kind: "npc_opening_trigger",
        },
      },
    });
    setSceneSetup(topicContext.chat.id, { ...setup, npcStarted: true });
  }, [
    api,
    hasVisibleStoredMessages,
    participant,
    resetEmptyChatRuntimeState,
    setSceneSetup,
    setup,
    task,
    topicContext.chat.id,
  ]);

  return null;
}

function getToolString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isVisibleStoredMessageRow(row: StoredMessageRow) {
  return !hasHiddenStoredMessageMetadata(row.content);
}

function hasHiddenStoredMessageMetadata(value: unknown, depth = 0): boolean {
  if (depth > 10 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasHiddenStoredMessageMetadata(item, depth + 1));
  }
  const record = value as Record<string, unknown>;
  const metadata = record.metadata;
  if (isRecord(metadata)) {
    const custom = metadata.custom;
    if (isRecord(custom) && custom.hidden === true) return true;
  }
  return Object.values(record).some((item) => hasHiddenStoredMessageMetadata(item, depth + 1));
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

async function requestDialogueSummaries(
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

async function requestSceneProposal(
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

async function requestSceneRevision(
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

function formatRuntimeMessagesForTranscript(messages: readonly unknown[]) {
  return messages
    .filter((message) => !isHiddenRuntimeMessage(message))
    .map((message) => {
      const record = isRecord(message) ? message : {};
      const role = getToolString(record.role) || "message";
      const text = extractRuntimeText(record.content ?? record.parts ?? record);
      if (!text) return "";
      return `${formatRoleName(role)}：${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

function getRuntimeMessageIds(messages: readonly unknown[]) {
  return messages
    .map((message) => (isRecord(message) ? getToolString(message.id) : ""))
    .filter(Boolean);
}

function isHiddenRuntimeMessage(message: unknown) {
  if (!isRecord(message)) return false;
  const metadata = message.metadata;
  if (!isRecord(metadata)) return false;
  const custom = metadata.custom;
  return isRecord(custom) && custom.hidden === true;
}

function extractRuntimeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractRuntimeText).filter(Boolean).join(" ");
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  if ("content" in value) return extractRuntimeText(value.content);
  if ("parts" in value) return extractRuntimeText(value.parts);
  if ("result" in value) return extractRuntimeText(value.result);
  return "";
}

function formatRoleName(role: string) {
  if (role === "user") return "玩家";
  if (role === "assistant") return "NPC/DM";
  if (role === "system") return "系统";
  return role;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
