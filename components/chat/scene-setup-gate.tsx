"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAui } from "@assistant-ui/react";
import { Button } from "@/components/ui/button";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { TopicContext } from "@/lib/chat-types";
import { requestSceneProposal, requestSceneRevision } from "./dm-requests";
import { isVisibleStoredMessageRow } from "./runtime-utils";

export function SceneSetupGate({
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
