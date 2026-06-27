"use client";

import { useState } from "react";
import { useAssistantTool, useAui } from "@assistant-ui/react";
import { Button } from "@/components/ui/button";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type {
  AiParticipant,
  CharacterAttribute,
  RelationshipTask,
  TaskKeyNode,
  TopicContext,
} from "@/lib/chat-types";
import { getTaskKeyNode } from "@/lib/task-key-node";
import { requestDmDiceResult, requestPlayerTaskJudgement } from "./dm-requests";
import {
  formatPayloadValue,
  getPayloadString,
  getToolString,
  isRecord,
  rollOpposedCheck,
} from "./runtime-utils";

export function RelationshipTools({ topicContext }: { topicContext: TopicContext }) {
  const isDialog = topicContext.chat.mode === "dialog";
  const participant = topicContext.chat.participants[0];
  const openTasks =
    topicContext.topic.relationshipTasks?.filter(
      (task) => participant && task.npcId === participant.id && task.status === "open",
    ) ?? [];

  return (
    <>
      {isDialog && participant
        ? openTasks
            .filter((task) => task.direction === "npc_to_player")
            .map((task) => (
              <DynamicTaskTool
                key={task.id}
                topicContext={topicContext}
                participant={participant}
                task={task}
              />
            ))
        : null}
      <ConversationLifecycleTools
        topicContext={topicContext}
        isDialog={isDialog}
        participant={participant}
      />
    </>
  );
}

function DynamicTaskTool({
  topicContext,
  participant,
  task,
}: {
  topicContext: TopicContext;
  participant: AiParticipant;
  task: RelationshipTask;
}) {
  const keyNode = getTaskKeyNode(task);

  useAssistantTool({
    toolName: keyNode.toolName,
    type: "frontend",
    description: [
      keyNode.toolDescription,
      `任务：${task.request}`,
      `关键节点：${keyNode.uiSchema.title}`,
      `成功条件：${keyNode.successCondition}`,
      "调用后会在 chat 中向玩家展示关键节点卡片，由玩家同意或拒绝。",
    ].join("\n"),
    parameters: keyNode.inputSchema,
    disabled: topicContext.chat.mode !== "dialog" || task.status !== "open",
    execute: async (args) => {
      const count = useChatWorkspaceStore
        .getState()
        .incrementToolCallCount(topicContext.chat.id, participant.id);
      if (count > 3) {
        return {
          accepted: false,
          exhausted: true,
          reason:
            "本次单聊的三次关键节点机会已经用完。请等待 DM 介入，选择其他路径或结束本次对话。",
        };
      }
      const payload = isRecord(args) ? args : {};
      const request = useChatWorkspaceStore
        .getState()
        .createTaskKeyNodeRequest(topicContext.chat.id, {
          taskId: task.id,
          npcId: participant.id,
          npcName: participant.name,
          toolName: keyNode.toolName,
          payload,
          title: getPayloadString(payload.title) || keyNode.uiSchema.title,
          body:
            getPayloadString(payload.body) ||
            getPayloadString(payload.documentBody) ||
            keyNode.uiSchema.documentBody ||
            keyNode.uiSchema.body,
        });
      return {
        accepted: Boolean(request),
        requestId: request?.id,
        remainingAttempts: Math.max(0, 3 - count),
      };
    },
    render: ({ args, result, status }) => (
      <TaskKeyNodeToolCard
        chatId={topicContext.chat.id}
        keyNode={keyNode}
        args={isRecord(args) ? args : {}}
        result={result}
        statusType={status.type}
      />
    ),
  });

  return null;
}

function ConversationLifecycleTools({
  topicContext,
  isDialog,
  participant,
}: {
  topicContext: TopicContext;
  isDialog: boolean;
  participant: AiParticipant | undefined;
}) {
  useAssistantTool({
    toolName: "request_leave",
    type: "frontend",
    description:
      "当 NPC 希望结束当前一对一语C对话并自然离场时必须调用。玩家会看到离场申请，可以同意或不同意；不要只用自然语言宣布离场。",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "NPC 以角色内视角给出的离场理由。",
        },
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
        reason: {
          type: "string",
          description: "NPC 坚持强制离场的理由，保持角色内表达。",
        },
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

  return null;
}

function TaskKeyNodeToolCard({
  chatId,
  keyNode,
  args,
  result,
  statusType,
}: {
  chatId: string;
  keyNode: TaskKeyNode;
  args: Record<string, unknown>;
  result: unknown;
  statusType: string;
}) {
  const api = useAui();
  const requestId = isRecord(result) ? getToolString(result.requestId) : "";
  const resolvedRequest = useChatWorkspaceStore((state) =>
    requestId
      ? Object.values(state.topics)
          .flatMap((topic) => topic.taskKeyNodeRequests ?? [])
          .find((item) => item.id === requestId)
      : undefined,
  );
  const resolveTaskKeyNodeRequest = useChatWorkspaceStore(
    (state) => state.resolveTaskKeyNodeRequest,
  );
  const [reaction, setReaction] = useState("");
  const busy = statusType === "running";
  const exhausted = isRecord(result) && result.exhausted === true;

  const resolve = (approved: boolean) => {
    if (!resolvedRequest || resolvedRequest.status !== "pending") return;
    const playerReaction =
      reaction.trim() ||
      (approved ? `我${keyNode.uiSchema.confirmLabel}。` : `我${keyNode.uiSchema.rejectLabel}。`);
    resolveTaskKeyNodeRequest(chatId, resolvedRequest.id, approved, playerReaction);
    api.thread().append({
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `【关键节点回应：${keyNode.uiSchema.title}】`,
            approved
              ? `玩家选择：${keyNode.uiSchema.confirmLabel}`
              : `玩家选择：${keyNode.uiSchema.rejectLabel}`,
            `玩家反应：${playerReaction}`,
          ].join("\n"),
        },
      ],
    });
  };

  return (
    <div className="border-border bg-background my-2 overflow-hidden rounded-md border text-sm shadow-sm">
      <div className="border-b bg-muted/30 px-3 py-2">
        <div className="font-medium">{getPayloadString(args.title) || keyNode.uiSchema.title}</div>
        <div className="text-muted-foreground mt-1 text-xs">{keyNode.uiSchema.body}</div>
      </div>
      <div className="grid gap-3 p-3">
        {keyNode.uiSchema.documentTitle || keyNode.uiSchema.documentBody ? (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="text-xs font-semibold">
              {getPayloadString(args.documentTitle) ||
                getPayloadString(args.title) ||
                keyNode.uiSchema.documentTitle ||
                "关键文件"}
            </div>
            <div className="text-muted-foreground mt-2 whitespace-pre-wrap text-xs leading-relaxed">
              {getPayloadString(args.documentBody) ||
                getPayloadString(args.body) ||
                keyNode.uiSchema.documentBody}
            </div>
          </div>
        ) : null}
        <div className="grid gap-1.5 sm:grid-cols-2">
          {keyNode.uiSchema.fields?.map((field) => (
            <div key={`${field.label}:${field.value}`} className="rounded bg-muted/30 px-2 py-1.5">
              <div className="text-muted-foreground text-[11px]">{field.label}</div>
              <div className="text-xs">{field.value}</div>
            </div>
          ))}
          {Object.entries(args)
            .filter(([key]) => !["title", "body", "documentTitle", "documentBody"].includes(key))
            .map(([key, value]) => (
              <div key={key} className="rounded bg-muted/30 px-2 py-1.5">
                <div className="text-muted-foreground text-[11px]">{key}</div>
                <div className="text-xs">{formatPayloadValue(value)}</div>
              </div>
            ))}
        </div>
        {busy ? (
          <div className="text-muted-foreground text-xs">关键节点生成中...</div>
        ) : exhausted ? (
          <div className="text-destructive text-xs">三次关键节点机会已用尽，等待 DM 介入。</div>
        ) : resolvedRequest?.status === "pending" ? (
          <div className="grid gap-2">
            <textarea
              className="border-input bg-background min-h-20 resize-y rounded-md border px-2 py-1.5 text-xs outline-none"
              placeholder={keyNode.uiSchema.reactionPlaceholder}
              value={reaction}
              onChange={(event) => setReaction(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" className="h-7 text-xs" onClick={() => resolve(true)}>
                {keyNode.uiSchema.confirmLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => resolve(false)}
              >
                {keyNode.uiSchema.rejectLabel}
              </Button>
            </div>
          </div>
        ) : resolvedRequest ? (
          <div className="text-muted-foreground text-xs">
            玩家已{resolvedRequest.status === "approved" ? "同意" : "拒绝"}：
            {resolvedRequest.playerReaction}
          </div>
        ) : (
          <div className="text-muted-foreground text-xs">关键节点已提交。</div>
        )}
      </div>
    </div>
  );
}

export function PlayerTaskActionShelf({ topicContext }: { topicContext: TopicContext }) {
  const api = useAui();
  const participant = topicContext.chat.participants[0];
  const resolveRelationshipTask = useChatWorkspaceStore((state) => state.resolveRelationshipTask);
  const addDiceCheck = useChatWorkspaceStore((state) => state.addDiceCheck);
  const playerAttributes = topicContext.topic.roleplay?.playerAttributes ?? [];
  const tasks =
    topicContext.topic.relationshipTasks?.filter(
      (task) =>
        participant &&
        task.npcId === participant.id &&
        task.direction === "player_to_npc" &&
        task.status === "open",
    ) ?? [];
  const [activeTaskId, setActiveTaskId] = useState("");
  const [reaction, setReaction] = useState("");
  const [busyTaskId, setBusyTaskId] = useState("");
  const [playerAttributeId, setPlayerAttributeId] = useState(playerAttributes[0]?.id ?? "");
  const [npcAttributeByTask, setNpcAttributeByTask] = useState<Record<string, string>>({});

  if (!participant || tasks.length === 0) return null;

  const submitJudgement = async (task: RelationshipTask) => {
    setBusyTaskId(task.id);
    try {
      const judgement = await requestPlayerTaskJudgement(topicContext, participant, task, reaction);
      const resolution = `${judgement.approved ? "NPC 同意" : "NPC 拒绝"}：${
        judgement.npcReaction || judgement.reason
      }`;
      resolveRelationshipTask(
        topicContext.chat.id,
        task.id,
        judgement.approved ? "completed" : "failed",
        resolution,
      );
      api.thread().append({
        role: "assistant",
        content: [{ type: "text", text: `【DM判断】\n${resolution}` }],
      });
      setActiveTaskId("");
      setReaction("");
    } finally {
      setBusyTaskId("");
    }
  };

  const submitDice = async (task: RelationshipTask) => {
    const playerAttribute = playerAttributes.find(
      (attribute) => attribute.id === playerAttributeId,
    );
    const npcAttribute = participant.attributes?.find(
      (attribute) =>
        attribute.id === (npcAttributeByTask[task.id] || participant.attributes?.[0]?.id),
    );
    if (!playerAttribute || !npcAttribute) return;
    setBusyTaskId(task.id);
    try {
      const check = rollOpposedCheck(playerAttribute.value, npcAttribute.value);
      const dmResult = await requestDmDiceResult(topicContext, participant, task.request, {
        ...check,
        initiator: "player",
        reason: reaction || "玩家请求通过属性检定推进关键节点。",
      });
      addDiceCheck(topicContext.chat.id, {
        taskId: task.id,
        npcId: participant.id,
        npcName: participant.name,
        initiator: "player",
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
      resolveRelationshipTask(
        topicContext.chat.id,
        task.id,
        check.winner === "player" ? "completed" : "failed",
        dmResult,
      );
      api.thread().append({
        role: "assistant",
        content: [{ type: "text", text: `【DM属性检定】\n${dmResult}` }],
      });
      setActiveTaskId("");
      setReaction("");
    } finally {
      setBusyTaskId("");
    }
  };

  return (
    <div className="border-b bg-muted/20 px-3 py-2">
      <div className="grid gap-2">
        {tasks.map((task) => {
          const keyNode = getTaskKeyNode(task);
          const active = activeTaskId === task.id;
          return (
            <div key={task.id} className="rounded-md border bg-background p-3 text-sm">
              <div className="font-medium">{keyNode.uiSchema.title}</div>
              <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {keyNode.uiSchema.body || `你需要让 ${task.npcName} 同意：${task.request}`}
              </div>
              {active ? (
                <div className="mt-3 grid gap-2">
                  <textarea
                    className="border-input bg-background min-h-20 resize-y rounded-md border px-2 py-1.5 text-xs outline-none"
                    placeholder={keyNode.uiSchema.reactionPlaceholder}
                    value={reaction}
                    onChange={(event) => setReaction(event.target.value)}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <AttributePicker
                      label="玩家属性"
                      attributes={playerAttributes}
                      value={playerAttributeId}
                      onChange={setPlayerAttributeId}
                    />
                    <AttributePicker
                      label={`${participant.name} 属性`}
                      attributes={participant.attributes ?? []}
                      value={npcAttributeByTask[task.id] || participant.attributes?.[0]?.id || ""}
                      onChange={(value) =>
                        setNpcAttributeByTask((current) => ({ ...current, [task.id]: value }))
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={busyTaskId === task.id}
                      onClick={() => void submitJudgement(task)}
                    >
                      {busyTaskId === task.id ? "DM判断中..." : keyNode.uiSchema.confirmLabel}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={
                        busyTaskId === task.id ||
                        playerAttributes.length === 0 ||
                        !participant.attributes?.length
                      }
                      onClick={() => void submitDice(task)}
                    >
                      属性检定
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setActiveTaskId("")}
                    >
                      收起
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-xs"
                  onClick={() => {
                    setActiveTaskId(task.id);
                    setReaction("");
                    setNpcAttributeByTask((current) => ({
                      ...current,
                      [task.id]: participant.attributes?.[0]?.id ?? "",
                    }));
                  }}
                >
                  展开关键节点
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttributePicker({
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
        disabled={attributes.length === 0}
      >
        {attributes.length === 0 ? <option value="">暂无属性</option> : null}
        {attributes.map((attribute) => (
          <option key={attribute.id} value={attribute.id}>
            {attribute.name} {attribute.value}
          </option>
        ))}
      </select>
    </label>
  );
}
