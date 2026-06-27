import type { StoredMessageRow } from "@/lib/chat-types";

export function getToolString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getPayloadString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function formatPayloadValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  return JSON.stringify(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isVisibleStoredMessageRow(row: StoredMessageRow) {
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

export function rollOpposedCheck(playerValue: number, npcValue: number) {
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

export function formatRuntimeMessagesForTranscript(messages: readonly unknown[]) {
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

export function getRuntimeMessageIds(messages: readonly unknown[]) {
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

export function parseJsonObject(text: string): Record<string, unknown> {
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
