"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BracesIcon,
  GripVerticalIcon,
  MessageSquareIcon,
  PlusIcon,
  RotateCcwIcon,
  TrashIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import {
  compileContextPipeline,
  normalizeContextPipelineOrders,
  sortContextPipelineNodes,
  type ChatSegmentPipelineNode,
  type ContextPipeline,
  type ContextPipelineNode,
  type ContextPipelineTarget,
  type SystemPromptPipelineNode,
} from "@/lib/context-pipeline";
import { ensureContextPipeline } from "@/lib/context-pipeline-defaults";
import {
  buildDialogPipelineVariables,
  buildNpcCreationPipelineVariables,
} from "@/lib/context-pipeline-runtime";
import { cn } from "@/lib/utils";
import type { AiParticipant, ChatSession, NpcCreationSession, Topic } from "@/lib/chat-types";

type ContextPipelineManagerProps = {
  topic: Topic;
  confirmReset: (options: {
    title: string;
    description?: string;
    confirmLabel?: string;
    destructive?: boolean;
  }) => Promise<boolean>;
};

const TARGETS: Array<{ value: ContextPipelineTarget; label: string }> = [
  { value: "dialog", label: "普通聊天" },
  { value: "npc-creation.dm-turn", label: "NPC 创建 DM 回合" },
  { value: "npc-creation.npc-turn", label: "候选玩家回合" },
  { value: "npc-creation.final", label: "NPC 最终总结" },
];

const makeId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const makeSystemNode = (order: number): SystemPromptPipelineNode => ({
  id: makeId("pipeline_system"),
  title: "System Prompt 节点",
  type: "system-prompt",
  enabled: true,
  targets: ["dialog"],
  order,
  formatter: {
    kind: "template",
    template: "在这里输入 {{变量路径}} 模板。",
  },
});

const makeChatNode = (order: number): ChatSegmentPipelineNode => ({
  id: makeId("pipeline_chat"),
  title: "Chat Segment 节点",
  type: "chat-segment",
  enabled: true,
  targets: ["dialog"],
  order,
  formatter: {
    kind: "chat-segment",
    segments: [
      {
        id: makeId("segment"),
        role: "user",
        contentTemplate: "在这里输入 {{变量路径}} 模板。",
      },
    ],
  },
});

const createPreviewSession = (topic: Topic): NpcCreationSession => ({
  id: "preview-session",
  topicId: topic.id,
  index: 0,
  status: "queued",
  personaTemplate: "预览用候选玩家：语C经验适中，愿意配合主题约束。",
  targetFaction: topic.roleplay?.factionSystem.factions[0]?.name,
  roleNiche: "外交",
  reservedKeywords: ["谈判", "盟约", "外务"],
  revisionCount: 0,
  messages: [
    {
      id: "preview-message",
      role: "system",
      name: "系统",
      content: "预览用创建记录。",
      createdAt: Date.now(),
    },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const createPreviewChat = (
  topic: Topic,
  chats: Record<string, ChatSession>,
  ais: Record<string, AiParticipant>,
): ChatSession => {
  const existing = topic.chatIds.map((chatId) => chats[chatId]).find(Boolean);
  if (existing) return existing;
  const participants = topic.aiIds.map((aiId) => ais[aiId]).filter(Boolean) as AiParticipant[];
  return {
    id: "preview-chat",
    topicId: topic.id,
    title: "预览会话",
    mode: "dialog",
    participants,
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt,
  };
};

export function ContextPipelineManager({ topic, confirmReset }: ContextPipelineManagerProps) {
  const ais = useChatWorkspaceStore((state) => state.ais);
  const chats = useChatWorkspaceStore((state) => state.chats);
  const npcCreationSessions = useChatWorkspaceStore((state) => state.npcCreationSessions);
  const updateTopicContextPipeline = useChatWorkspaceStore(
    (state) => state.updateTopicContextPipeline,
  );
  const resetTopicContextPipeline = useChatWorkspaceStore(
    (state) => state.resetTopicContextPipeline,
  );
  const pipeline = useMemo(() => ensureContextPipeline(topic.contextPipeline), [topic]);
  const nodes = sortContextPipelineNodes(pipeline.nodes);
  const [selectedNodeId, setSelectedNodeId] = useState(nodes[0]?.id ?? "");
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ContextPipelineTarget>("dialog");
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];

  const commitPipeline = (nextPipeline: ContextPipeline) => {
    updateTopicContextPipeline(topic.id, normalizeContextPipelineOrders(nextPipeline));
  };

  const updateNode = (
    nodeId: string,
    updater: (node: ContextPipelineNode) => ContextPipelineNode,
  ) => {
    commitPipeline({
      ...pipeline,
      nodes: pipeline.nodes.map((node) => (node.id === nodeId ? updater(node) : node)),
    });
  };

  const addNode = (type: ContextPipelineNode["type"]) => {
    const node =
      type === "system-prompt" ? makeSystemNode(nodes.length) : makeChatNode(nodes.length);
    commitPipeline({ ...pipeline, nodes: [...nodes, node] });
    setSelectedNodeId(node.id);
  };

  const removeNode = async (nodeId: string) => {
    const confirmed = await confirmReset({
      title: "删除节点？",
      description: "删除后该节点不会再参与上下文编译。",
      confirmLabel: "删除",
      destructive: true,
    });
    if (!confirmed) return;
    const nextNodes = nodes.filter((node) => node.id !== nodeId);
    commitPipeline({ ...pipeline, nodes: nextNodes });
    setSelectedNodeId(nextNodes[0]?.id ?? "");
  };

  const moveNode = (nodeId: string, delta: number) => {
    const index = nodes.findIndex((node) => node.id === nodeId);
    const nextIndex = index + delta;
    if (index === -1 || nextIndex < 0 || nextIndex >= nodes.length) return;
    const nextNodes = [...nodes];
    const [node] = nextNodes.splice(index, 1);
    nextNodes.splice(nextIndex, 0, node!);
    commitPipeline({ ...pipeline, nodes: nextNodes });
  };

  const reorderNode = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const sourceIndex = nodes.findIndex((node) => node.id === sourceId);
    const targetIndex = nodes.findIndex((node) => node.id === targetId);
    if (sourceIndex === -1 || targetIndex === -1) return;
    const nextNodes = [...nodes];
    const [node] = nextNodes.splice(sourceIndex, 1);
    nextNodes.splice(targetIndex, 0, node!);
    commitPipeline({ ...pipeline, nodes: nextNodes });
  };

  const preview = useMemo(() => {
    const previewChat = createPreviewChat(topic, chats, ais);
    const existingSession =
      Object.values(npcCreationSessions).find((session) => session.topicId === topic.id) ??
      createPreviewSession(topic);
    const sessionMap = {
      ...npcCreationSessions,
      [existingSession.id]: existingSession,
    };
    const variables =
      previewTarget === "dialog"
        ? buildDialogPipelineVariables({
            topic,
            chat: previewChat,
          })
        : buildNpcCreationPipelineVariables({
            topic,
            chat: previewChat,
            session: existingSession,
            cycle: 0,
            npcCreationSessions: sessionMap,
          });
    return compileContextPipeline({ pipeline, target: previewTarget, variables });
  }, [ais, chats, npcCreationSessions, pipeline, previewTarget, topic]);

  const resetPipeline = async () => {
    const confirmed = await confirmReset({
      title: "重置 Pipeline？",
      description: "当前主题的 pipeline 会恢复为默认配置。",
      confirmLabel: "重置",
      destructive: true,
    });
    if (!confirmed) return;
    resetTopicContextPipeline(topic.id);
    setSelectedNodeId("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Context Pipeline</div>
          <div className="text-muted-foreground truncate text-xs">{topic.title}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => addNode("system-prompt")}
          >
            <PlusIcon className="size-3.5" />
            System
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => addNode("chat-segment")}>
            <PlusIcon className="size-3.5" />
            Chat
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void resetPipeline()}>
            <RotateCcwIcon className="size-3.5" />
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)_360px]">
        <aside className="min-h-0 border-b md:border-r md:border-b-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
              节点顺序
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {nodes.length === 0 ? (
                <div className="text-muted-foreground px-2 py-8 text-center text-sm">
                  还没有节点。
                </div>
              ) : (
                <div className="grid gap-1">
                  {nodes.map((node, index) => (
                    <button
                      key={node.id}
                      type="button"
                      draggable
                      onDragStart={() => setDraggingNodeId(node.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (draggingNodeId) reorderNode(draggingNodeId, node.id);
                        setDraggingNodeId(null);
                      }}
                      onClick={() => setSelectedNodeId(node.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-sm",
                        selectedNode?.id === node.id
                          ? "border-primary bg-primary/5"
                          : "border-transparent hover:bg-muted",
                        !node.enabled && "opacity-50",
                      )}
                    >
                      <GripVerticalIcon className="text-muted-foreground size-4 shrink-0" />
                      {node.type === "system-prompt" ? (
                        <BracesIcon className="size-4 shrink-0" />
                      ) : (
                        <MessageSquareIcon className="size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{node.title}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {index + 1}. {node.type} ·{" "}
                          {node.targets.length > 0
                            ? node.targets
                                .map(
                                  (target) => TARGETS.find((item) => item.value === target)?.label,
                                )
                                .filter(Boolean)
                                .join("、")
                            : "全部 target"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto border-b p-4 md:border-r md:border-b-0">
          {selectedNode ? (
            <NodeEditor
              node={selectedNode}
              index={nodes.findIndex((node) => node.id === selectedNode.id)}
              total={nodes.length}
              updateNode={updateNode}
              moveNode={moveNode}
              removeNode={removeNode}
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              选择或新增一个节点。
            </div>
          )}
        </main>

        <aside className="min-h-0 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">预览与校验</div>
              <div className="text-muted-foreground text-xs">按当前 target 编译输出</div>
            </div>
            <select
              className="border-input bg-background h-8 rounded-md border px-2 text-xs"
              value={previewTarget}
              onChange={(event) => setPreviewTarget(event.target.value as ContextPipelineTarget)}
            >
              {TARGETS.map((target) => (
                <option key={target.value} value={target.value}>
                  {target.label}
                </option>
              ))}
            </select>
          </div>
          <PreviewBlock title="System Prompt" content={preview.system ?? "无输出"} />
          <PreviewBlock
            title="Chat Segments"
            content={
              preview.chatSegments.length > 0
                ? preview.chatSegments
                    .map((message, index) => `${index + 1}. ${message.role}\n${message.content}`)
                    .join("\n\n")
                : "无输出"
            }
          />
          <PreviewBlock
            title="Warnings"
            content={preview.warnings.length > 0 ? preview.warnings.join("\n") : "无"}
            muted={preview.warnings.length === 0}
          />
        </aside>
      </div>
    </div>
  );
}

function NodeEditor({
  node,
  index,
  total,
  updateNode,
  moveNode,
  removeNode,
}: {
  node: ContextPipelineNode;
  index: number;
  total: number;
  updateNode: (nodeId: string, updater: (node: ContextPipelineNode) => ContextPipelineNode) => void;
  moveNode: (nodeId: string, delta: number) => void;
  removeNode: (nodeId: string) => Promise<void>;
}) {
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">节点编辑</div>
          <div className="text-muted-foreground text-xs">
            {node.type === "system-prompt" ? "System Prompt" : "Chat Segment"} · priority{" "}
            {node.type === "system-prompt" ? "high" : "low"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={index <= 0}
            onClick={() => moveNode(node.id, -1)}
          >
            <ArrowUpIcon className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={index >= total - 1}
            onClick={() => moveNode(node.id, 1)}
          >
            <ArrowDownIcon className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => void removeNode(node.id)}
          >
            <TrashIcon className="size-4" />
          </Button>
        </div>
      </div>

      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">标题</span>
        <Input
          value={node.title}
          onChange={(event) =>
            updateNode(node.id, (current) => ({ ...current, title: event.target.value }))
          }
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={node.enabled}
          onChange={(event) =>
            updateNode(node.id, (current) => ({ ...current, enabled: event.target.checked }))
          }
        />
        启用节点
      </label>

      <div className="grid gap-2">
        <div className="text-sm font-medium">适用 target</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {TARGETS.map((target) => (
            <label key={target.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={node.targets.includes(target.value)}
                onChange={(event) => {
                  updateNode(node.id, (current) => {
                    const targets = event.target.checked
                      ? [...current.targets, target.value]
                      : current.targets.filter((value) => value !== target.value);
                    return { ...current, targets };
                  });
                }}
              />
              {target.label}
            </label>
          ))}
        </div>
        <div className="text-muted-foreground text-xs">全部取消时表示该节点适用于所有 target。</div>
      </div>

      {node.type === "system-prompt" ? (
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">模板</span>
          <textarea
            className="border-input bg-background min-h-80 rounded-md border px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={node.formatter.template}
            onChange={(event) =>
              updateNode(node.id, (current) =>
                current.type === "system-prompt"
                  ? {
                      ...current,
                      formatter: { ...current.formatter, template: event.target.value },
                    }
                  : current,
              )
            }
          />
        </label>
      ) : (
        <ChatSegmentEditor node={node} updateNode={updateNode} />
      )}
    </div>
  );
}

function ChatSegmentEditor({
  node,
  updateNode,
}: {
  node: ChatSegmentPipelineNode;
  updateNode: (nodeId: string, updater: (node: ContextPipelineNode) => ContextPipelineNode) => void;
}) {
  const updateSegments = (
    updater: (
      segments: ChatSegmentPipelineNode["formatter"]["segments"],
    ) => ChatSegmentPipelineNode["formatter"]["segments"],
  ) => {
    updateNode(node.id, (current) =>
      current.type === "chat-segment"
        ? {
            ...current,
            formatter: {
              ...current.formatter,
              segments: updater(current.formatter.segments),
            },
          }
        : current,
    );
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Segments</div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            updateSegments((segments) => [
              ...segments,
              { id: makeId("segment"), role: "user", contentTemplate: "" },
            ])
          }
        >
          <PlusIcon className="size-3.5" />
          Segment
        </Button>
      </div>
      {node.formatter.segments.map((segment, index) => (
        <div key={segment.id} className="grid gap-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-muted-foreground text-xs">Segment {index + 1}</div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() =>
                updateSegments((segments) => segments.filter((item) => item.id !== segment.id))
              }
            >
              <TrashIcon className="size-4" />
            </Button>
          </div>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Role</span>
            <select
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={segment.role}
              onChange={(event) =>
                updateSegments((segments) =>
                  segments.map((item) =>
                    item.id === segment.id
                      ? { ...item, role: event.target.value as "user" | "assistant" }
                      : item,
                  ),
                )
              }
            >
              <option value="user">user</option>
              <option value="assistant">assistant</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Content Template</span>
            <textarea
              className="border-input bg-background min-h-48 rounded-md border px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={segment.contentTemplate}
              onChange={(event) =>
                updateSegments((segments) =>
                  segments.map((item) =>
                    item.id === segment.id
                      ? { ...item, contentTemplate: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
        </div>
      ))}
    </div>
  );
}

function PreviewBlock({
  title,
  content,
  muted,
}: {
  title: string;
  content: string;
  muted?: boolean;
}) {
  return (
    <div className="mb-4 grid gap-1.5">
      <div className="text-xs font-medium">{title}</div>
      <pre
        className={cn(
          "max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap",
          muted && "text-muted-foreground",
        )}
      >
        {content}
      </pre>
    </div>
  );
}
