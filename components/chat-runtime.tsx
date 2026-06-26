"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantRuntimeProvider, useAssistantTool, useAui } from "@assistant-ui/react";
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
import { Button } from "@/components/ui/button";
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

  const participantNames = topicContext.chat.participants
    .map((participant) => participant.name)
    .join("、");

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <FactionScoreRuntime topicContext={topicContext} />
      <RelationshipTools topicContext={topicContext} />
      <SceneSetupGate topicContext={topicContext}>
        <Thread
          welcomeTitle={`与 ${participantNames || "AI"} 开始语C`}
          composerPlaceholder="向角色发送消息..."
        />
      </SceneSetupGate>
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
    let active = true;
    setBusy(true);
    setError("");
    void requestSceneProposal(topicContext, participant, task)
      .then((scene) => {
        if (!active) return;
        setSceneSetup(topicContext.chat.id, {
          ...setup,
          status: "proposed",
          dmScene: scene,
        });
      })
      .catch((sceneError: unknown) => {
        if (active) {
          sceneRequestKeyRef.current = "";
          setError(sceneError instanceof Error ? sceneError.message : "DM 场景生成失败");
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
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
  const setup = useChatWorkspaceStore(
    (state) => state.chats[topicContext.chat.id]?.sceneSetup ?? topicContext.chat.sceneSetup,
  );
  const setSceneSetup = useChatWorkspaceStore((state) => state.setSceneSetup);
  const participant = topicContext.chat.participants[0];
  const task = setup?.taskId
    ? topicContext.topic.relationshipTasks?.find((item) => item.id === setup.taskId)
    : undefined;

  useEffect(() => {
    if (
      !setup ||
      setup.status !== "final" ||
      setup.npcStarted ||
      started.current ||
      task?.direction !== "npc_to_player" ||
      !participant
    ) {
      return;
    }
    started.current = true;
    setSceneSetup(topicContext.chat.id, { ...setup, npcStarted: true });
    void requestNpcOpening(topicContext, participant, task, setup.finalScene || setup.dmScene || "")
      .then((text) => {
        api.thread().append({
          role: "assistant",
          content: [{ type: "text", text }],
        });
      })
      .catch(() => {
        api.thread().append({
          role: "assistant",
          content: [{ type: "text", text: `${participant.name}看向你，像是有话要说。` }],
        });
      });
  }, [api, participant, setSceneSetup, setup, task, topicContext.chat.id]);

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

async function requestNpcOpening(
  topicContext: TopicContext,
  participant: TopicContext["chat"]["participants"][number],
  task: NonNullable<TopicContext["topic"]["relationshipTasks"]>[number],
  scene: string,
) {
  return requestPlainText(
    [
      `你必须扮演：${participant.name}。`,
      participant.realWorldPersona ? `现实扮演者人设：${participant.realWorldPersona}` : undefined,
      `角色定位：${participant.role}`,
      participant.gamePersona ? `游戏内人设：${participant.gamePersona}` : undefined,
      participant.faction ? `所属阵营：${participant.faction}` : undefined,
      `角色提示词：${participant.systemPrompt}`,
      "你正在进行一对一中文语C私聊。只输出一条自然 IM 消息，不要旁白解释，不要替玩家发言。",
    ]
      .filter(Boolean)
      .join("\n"),
    [
      `主题：${topicContext.topic.title}`,
      `玩家角色：${topicContext.topic.roleplay?.playerRole ?? "玩家"}`,
      `DM 场景：${scene}`,
      `你的隐藏任务诉求：让玩家同意「${task.request}」`,
      `利害：${task.stake}`,
      `推进建议：${task.suggestedApproach}`,
      "请你先开口。第一句可以铺垫，不必立刻摊牌，但要让玩家感觉你确实有事相求。",
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
