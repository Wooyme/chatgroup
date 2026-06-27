import type { RelationshipTask, TaskKeyNode } from "@/lib/chat-types";

const MAX_TOOL_NAME_LENGTH = 64;

export const sanitizeTaskToolNamePart = (value: string) => {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return safe || "action";
};

export const makeTaskToolName = (taskId: string, rawName?: string) => {
  const taskPart = sanitizeTaskToolNamePart(taskId);
  const actionPart = sanitizeTaskToolNamePart(rawName || "submit_key_node");
  return `task_${taskPart}_${actionPart}`.slice(0, MAX_TOOL_NAME_LENGTH);
};

export const createFallbackKeyNode = (
  taskId: string,
  task: Pick<RelationshipTask, "direction" | "request" | "stake" | "npcName">,
): TaskKeyNode => {
  const isNpcRequest = task.direction === "npc_to_player";
  return {
    toolName: makeTaskToolName(taskId, isNpcRequest ? "present_agreement" : "player_request"),
    toolDescription: isNpcRequest
      ? `当你需要玩家正式同意「${task.request}」时调用。`
      : `玩家请求 ${task.npcName} 正式同意「${task.request}」时使用。`,
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "关键节点卡片标题。",
        },
        body: {
          type: "string",
          description: "关键节点的正文内容，保持当前语C场景口吻。",
        },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
    uiSchema: {
      title: isNpcRequest ? "待玩家确认的关键节点" : "玩家行动关键节点",
      body: task.stake,
      documentTitle: isNpcRequest ? "待确认事项" : "玩家请求事项",
      documentBody: task.request,
      confirmLabel: isNpcRequest ? "同意" : "提交给 DM 判断",
      rejectLabel: isNpcRequest ? "拒绝" : "取消",
      reactionPlaceholder: "写一段玩家的语C反应...",
    },
    successCondition: `对方正式同意：${task.request}`,
    failureCondition: `对方拒绝：${task.request}`,
    actor: task.direction,
  };
};

export const getTaskKeyNode = (task: RelationshipTask): TaskKeyNode =>
  task.keyNode ?? createFallbackKeyNode(task.id, task);
