"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAui, useAuiEvent, useAuiState } from "@assistant-ui/react";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { TopicContext } from "@/lib/chat-types";
import { requestDialogueSummaries } from "./dm-requests";
import {
  formatRuntimeMessagesForTranscript,
  getRuntimeMessageIds,
  isVisibleStoredMessageRow,
} from "./runtime-utils";

export function ChatRoundLockRuntime({ topicContext }: { topicContext: TopicContext }) {
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
