export type ContextPipelineTarget =
  | "dialog"
  | "npc-creation.dm-turn"
  | "npc-creation.npc-turn"
  | "npc-creation.final";

export type ContextPipelineChatRole = "user" | "assistant";

export type ContextPipelineChatSegment = {
  id: string;
  role: ContextPipelineChatRole;
  contentTemplate: string;
};

export type ContextPipelineNodeBase = {
  id: string;
  title: string;
  enabled: boolean;
  targets: ContextPipelineTarget[];
  order: number;
};

export type SystemPromptPipelineNode = ContextPipelineNodeBase & {
  type: "system-prompt";
  formatter: {
    kind: "template";
    template: string;
  };
};

export type ChatSegmentPipelineNode = ContextPipelineNodeBase & {
  type: "chat-segment";
  formatter: {
    kind: "chat-segment";
    segments: ContextPipelineChatSegment[];
  };
};

export type ContextPipelineNode = SystemPromptPipelineNode | ChatSegmentPipelineNode;

export type ContextPipeline = {
  id: string;
  name: string;
  version: 1;
  nodes: ContextPipelineNode[];
  updatedAt: number;
};

export type CompiledContextPipelineMessage = {
  role: ContextPipelineChatRole;
  content: string;
};

export type ContextPipelineCompileResult = {
  system: string | undefined;
  chatSegments: CompiledContextPipelineMessage[];
  warnings: string[];
};

const NODE_PRIORITY: Record<ContextPipelineNode["type"], number> = {
  "system-prompt": 0,
  "chat-segment": 1,
};

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_$.[\]-]+)\s*\}\}/g;

export const sortContextPipelineNodes = (nodes: readonly ContextPipelineNode[]) =>
  [...nodes].sort((left, right) => left.order - right.order);

const sortCompileNodes = (nodes: readonly ContextPipelineNode[]) =>
  [...nodes].sort((left, right) => {
    const priorityDelta = NODE_PRIORITY[left.type] - NODE_PRIORITY[right.type];
    return priorityDelta || left.order - right.order;
  });

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getVariableValue = (variables: Record<string, unknown>, path: string) => {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = variables;
  for (const part of parts) {
    if (!part) continue;
    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (isObjectRecord(current)) {
      current = current[part];
    } else {
      current = undefined;
    }
    if (current === undefined || current === null) return undefined;
  }
  return current;
};

const stringifyValue = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
};

export const renderContextTemplate = (
  template: string,
  variables: Record<string, unknown>,
  warnings: string[],
) =>
  template.replace(VARIABLE_PATTERN, (match, rawPath: string) => {
    const value = getVariableValue(variables, rawPath);
    if (value === undefined) {
      warnings.push(`变量 ${rawPath} 未找到。`);
      return "";
    }
    return stringifyValue(value);
  });

export const compileContextPipeline = ({
  pipeline,
  target,
  variables,
}: {
  pipeline: ContextPipeline;
  target: ContextPipelineTarget;
  variables: Record<string, unknown>;
}): ContextPipelineCompileResult => {
  const warnings: string[] = [];
  const nodes = sortCompileNodes(
    pipeline.nodes.filter(
      (node) => node.enabled && (node.targets.length === 0 || node.targets.includes(target)),
    ),
  );
  const systemParts: string[] = [];
  const chatSegments: CompiledContextPipelineMessage[] = [];

  for (const node of nodes) {
    if (node.type === "system-prompt") {
      const content = renderContextTemplate(node.formatter.template, variables, warnings).trim();
      if (content) systemParts.push(content);
      continue;
    }

    for (const segment of node.formatter.segments) {
      const content = renderContextTemplate(segment.contentTemplate, variables, warnings).trim();
      if (content) chatSegments.push({ role: segment.role, content });
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    chatSegments,
    warnings,
  };
};

export const normalizeContextPipelineOrders = (pipeline: ContextPipeline): ContextPipeline => ({
  ...pipeline,
  nodes: pipeline.nodes.map((node, index) => ({
    ...node,
    order: index,
  })),
});
