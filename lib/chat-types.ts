import {
  DEFAULT_AI_PROVIDER,
  DEFAULT_OPENROUTER_MODEL_ID,
  DEFAULT_OPENROUTER_MODEL_NAME,
  type AiProvider,
} from "@/lib/ai-providers";

export type ChatMode = "dialog" | "group";

export type Faction = {
  id: string;
  name: string;
  description: string;
  strength: number;
  initialScore: number;
  currentScore: number;
  victoryScore: number;
  victoryCondition: string;
  pastMilestones: string[];
  futureMilestones: string[];
  narrativeInfluence: string;
};

export type FactionSystem = {
  template: string;
  description: string;
  factions: Faction[];
  winningFactionId?: string;
};

export type FactionScoreDelta = {
  factionId: string;
  factionName: string;
  delta: number;
  reason: string;
  milestone?: string;
};

export type FactionScoreEvent = {
  id: string;
  createdAt: number;
  chatId: string;
  sourceMessageCount: number;
  summary: string;
  deltas: FactionScoreDelta[];
  winningFactionId?: string;
};

export type AttributeDefinition = {
  id: string;
  name: string;
  description: string;
  defaultValue: number;
  sourceTemplates: string[];
};

export type CharacterAttribute = AttributeDefinition & {
  value: number;
};

export type AttributeSystem = {
  templates: string[];
  attributes: AttributeDefinition[];
};

export type RoleplayTopicProfile = {
  playerRole: string;
  worldView: string;
  playerFaction: string;
  factionSystem: FactionSystem;
  attributeSystem: AttributeSystem;
  playerAttributes: CharacterAttribute[];
  reputation: string;
  notes: string;
};

export type RecruitmentEvent = {
  id: string;
  sessionId?: string;
  message: string;
  createdAt: number;
  status: "info" | "success" | "error";
};

export type ChatRecruitment = {
  status: "idle" | "running" | "completed" | "failed";
  targetCount: number;
  completedCount: number;
  failedCount: number;
  sessionIds: string[];
  events: RecruitmentEvent[];
};

export type NpcCreationMessage = {
  id: string;
  role: "dm" | "npc" | "system";
  name: string;
  content: string;
  createdAt: number;
};

export type NpcCreationStatus = "queued" | "running" | "completed" | "failed";

export type NpcCreationSession = {
  id: string;
  topicId: string;
  groupChatId: string;
  index: number;
  status: NpcCreationStatus;
  personaTemplate: string;
  targetFaction?: string;
  roleNiche?: string;
  reservedKeywords: string[];
  revisionCount: number;
  messages: NpcCreationMessage[];
  resultAiId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type NpcProgressionMessage = {
  id: string;
  role: "dm" | "npc" | "system";
  name: string;
  content: string;
  createdAt: number;
};

export type NpcProgressionStatus = "queued" | "running" | "completed" | "failed";

export type RelationshipTaskDirection = "npc_to_player" | "player_to_npc";

export type RelationshipTaskStatus = "open" | "completed" | "failed";

export type RelationshipTask = {
  id: string;
  npcId: string;
  npcName: string;
  direction: RelationshipTaskDirection;
  request: string;
  stake: string;
  suggestedApproach: string;
  status: RelationshipTaskStatus;
  resolution?: string;
  createdAt: number;
  resolvedAt?: number;
};

export type ConsentRequest = {
  id: string;
  chatId: string;
  taskId: string;
  npcId: string;
  npcName: string;
  requestTitle: string;
  requestBody: string;
  npcReactionHint: string;
  status: "pending" | "approved" | "rejected";
  playerReaction?: string;
  createdAt: number;
  resolvedAt?: number;
};

export type DiceCheck = {
  id: string;
  chatId: string;
  taskId: string;
  npcId: string;
  npcName: string;
  initiator: "npc" | "player";
  playerAttributeId: string;
  playerAttributeName: string;
  playerAttributeValue: number;
  npcAttributeId: string;
  npcAttributeName: string;
  npcAttributeValue: number;
  playerRoll: number;
  npcRoll: number;
  playerTotal: number;
  npcTotal: number;
  winner: "player" | "npc";
  dmResult: string;
  createdAt: number;
};

export type NpcProgressionSession = {
  id: string;
  topicId: string;
  groupChatId: string;
  purpose: "initial_tasks" | "replacement_task";
  focusNpcId?: string;
  reason?: string;
  status: NpcProgressionStatus;
  messages: NpcProgressionMessage[];
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type AiParticipant = {
  id: string;
  name: string;
  role: string;
  faction?: string;
  realWorldPersona?: string;
  gamePersona?: string;
  status?: "active" | "left";
  attributes?: CharacterAttribute[];
  systemPrompt: string;
  color: string;
  provider: AiProvider;
  modelId: string;
  modelName?: string;
};

export type Topic = {
  id: string;
  title: string;
  description: string;
  roleplay?: RoleplayTopicProfile;
  aiIds: string[];
  chatIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type ChatSession = {
  id: string;
  topicId: string;
  title: string;
  mode: ChatMode;
  participants: AiParticipant[];
  recruitment?: ChatRecruitment;
  factionScoreEvents?: FactionScoreEvent[];
  relationshipTasks?: RelationshipTask[];
  consentRequests?: ConsentRequest[];
  diceChecks?: DiceCheck[];
  taskAssignmentSessionIds?: string[];
  toolCallCounts?: Record<string, number>;
  createdAt: number;
  updatedAt: number;
};

export type StoredMessageRow<TContent extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  parent_id: string | null;
  format: string;
  content: TContent;
  createdAt: number;
};

export type TopicContext = {
  topic: Pick<Topic, "id" | "title" | "description" | "roleplay">;
  chat: Pick<
    ChatSession,
    | "id"
    | "title"
    | "mode"
    | "participants"
    | "relationshipTasks"
    | "consentRequests"
    | "diceChecks"
    | "toolCallCounts"
  >;
};

export const DEFAULT_AI_PARTICIPANTS: AiParticipant[] = [
  {
    id: "strategist",
    name: "沈策",
    role: "冷静的策略师",
    systemPrompt: "你说话克制、清晰，擅长把目标、约束、风险和下一步拆开。",
    color: "bg-sky-500",
    provider: DEFAULT_AI_PROVIDER,
    modelId: DEFAULT_OPENROUTER_MODEL_ID,
    modelName: DEFAULT_OPENROUTER_MODEL_NAME,
  },
  {
    id: "engineer",
    name: "林工",
    role: "务实的工程师",
    systemPrompt: "你关注实现路径、边界情况、成本和可验证性，说话直接。",
    color: "bg-emerald-500",
    provider: DEFAULT_AI_PROVIDER,
    modelId: DEFAULT_OPENROUTER_MODEL_ID,
    modelName: DEFAULT_OPENROUTER_MODEL_NAME,
  },
  {
    id: "critic",
    name: "许澄",
    role: "敏锐的审阅者",
    systemPrompt: "你负责挑战薄弱假设，指出遗漏，并给出收敛建议。",
    color: "bg-amber-500",
    provider: DEFAULT_AI_PROVIDER,
    modelId: DEFAULT_OPENROUTER_MODEL_ID,
    modelName: DEFAULT_OPENROUTER_MODEL_NAME,
  },
];
