import type { ContextPipeline } from "@/lib/context-pipeline";

const now = () => Date.now();

export const createDefaultContextPipeline = (): ContextPipeline => ({
  id: "default-context-pipeline",
  name: "默认 Context Pipeline",
  version: 1,
  updatedAt: now(),
  nodes: [
    {
      id: "dialog-system",
      title: "普通聊天 System Prompt",
      type: "system-prompt",
      enabled: true,
      targets: ["dialog"],
      order: 0,
      formatter: {
        kind: "template",
        template: "{{dialog.baseSystem}}\n\n{{dialog.topicHeader}}\n\n{{dialog.participantPrompt}}",
      },
    },
    {
      id: "npc-dm-system",
      title: "NPC 创建 DM System Prompt",
      type: "system-prompt",
      enabled: true,
      targets: ["npc-creation.dm-turn", "npc-creation.final"],
      order: 1,
      formatter: {
        kind: "template",
        template: "{{npc.dmSystemPrompt}}",
      },
    },
    {
      id: "npc-dm-turn",
      title: "NPC 创建 DM 回合",
      type: "chat-segment",
      enabled: true,
      targets: ["npc-creation.dm-turn"],
      order: 2,
      formatter: {
        kind: "chat-segment",
        segments: [
          {
            id: "npc-dm-turn-user",
            role: "user",
            contentTemplate: "{{npc.dmTurnPrompt}}",
          },
        ],
      },
    },
    {
      id: "npc-candidate-system",
      title: "候选玩家 System Prompt",
      type: "system-prompt",
      enabled: true,
      targets: ["npc-creation.npc-turn"],
      order: 3,
      formatter: {
        kind: "template",
        template: "{{npc.npcSystemPrompt}}",
      },
    },
    {
      id: "npc-candidate-turn",
      title: "候选玩家回合",
      type: "chat-segment",
      enabled: true,
      targets: ["npc-creation.npc-turn"],
      order: 4,
      formatter: {
        kind: "chat-segment",
        segments: [
          {
            id: "npc-candidate-turn-user",
            role: "user",
            contentTemplate: "{{npc.npcTurnPrompt}}",
          },
        ],
      },
    },
    {
      id: "npc-final",
      title: "NPC 创建最终总结",
      type: "chat-segment",
      enabled: true,
      targets: ["npc-creation.final"],
      order: 5,
      formatter: {
        kind: "chat-segment",
        segments: [
          {
            id: "npc-final-user",
            role: "user",
            contentTemplate: "{{npc.finalPrompt}}",
          },
        ],
      },
    },
  ],
});

export const ensureContextPipeline = (pipeline: ContextPipeline | undefined) =>
  pipeline ?? createDefaultContextPipeline();
