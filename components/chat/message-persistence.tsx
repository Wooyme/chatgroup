"use client";

import { useEffect, useRef, useState } from "react";
import { useThreadRuntime } from "@assistant-ui/react";
import type {
  GenericThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatRepository,
  MessageStorageEntry,
  ThreadHistoryAdapter,
} from "@assistant-ui/core";
import type { UIMessage } from "ai";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { StoredMessageRow } from "@/lib/chat-types";
import { isRecord } from "./runtime-utils";

type StorageContent = Record<string, unknown>;
type UiMessageRepository = MessageFormatRepository<UIMessage>;

const AI_SDK_STORAGE_FORMAT = "ai-sdk/v6";

export const EMPTY_STORED_MESSAGES: StoredMessageRow[] = [];

const isUiMessage = (value: unknown): value is UIMessage =>
  isRecord(value) && typeof value.id === "string" && typeof value.role === "string";

const toStoredMessageRow = (
  message: UIMessage,
  parentId: string | null,
  index: number,
): StoredMessageRow => {
  const { id, ...content } = message;
  return {
    id,
    parent_id: parentId,
    format: AI_SDK_STORAGE_FORMAT,
    content: content as StorageContent,
    createdAt: Date.now() + index,
  };
};

export const restoreInitialMessages = (rows: StoredMessageRow[]): UIMessage[] =>
  rows.flatMap((row) => {
    if (row.format !== AI_SDK_STORAGE_FORMAT || !isRecord(row.content)) return [];
    return [{ id: row.id, ...row.content } as UIMessage];
  });

const rowsFromRuntimeExternalState = (externalState: unknown): StoredMessageRow[] => {
  if (Array.isArray(externalState)) {
    return externalState.flatMap((message, index) => {
      if (!isUiMessage(message)) return [];
      const previous = externalState[index - 1];
      return [toStoredMessageRow(message, isUiMessage(previous) ? previous.id : null, index)];
    });
  }

  if (!isRecord(externalState) || !Array.isArray(externalState.messages)) return [];
  const repository = externalState as Partial<UiMessageRepository>;
  return (repository.messages ?? []).flatMap((item, index) => {
    if (!isUiMessage(item.message)) return [];
    return [toStoredMessageRow(item.message, item.parentId ?? null, index)];
  });
};

const rowsSnapshot = (rows: StoredMessageRow[]) =>
  JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      parent_id: row.parent_id,
      format: row.format,
      content: row.content,
    })),
  );

const hasWorkspaceStoreHydrated = () => {
  const persistApi = useChatWorkspaceStore.persist;
  return typeof persistApi?.hasHydrated === "function" ? persistApi.hasHydrated() : true;
};

export function usePersistHydrated() {
  const [hydrated, setHydrated] = useState(hasWorkspaceStoreHydrated);

  useEffect(() => {
    const persistApi = useChatWorkspaceStore.persist;
    if (typeof persistApi?.hasHydrated !== "function") {
      setHydrated(true);
      return undefined;
    }
    if (persistApi.hasHydrated()) {
      setHydrated(true);
      return undefined;
    }
    return persistApi.onFinishHydration(() => setHydrated(true));
  }, []);

  return hydrated;
}

export const makeHistoryAdapter = (chatId: string): ThreadHistoryAdapter => ({
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

export function RuntimeMessageStoreSync({
  chatId,
  initialRowCount,
}: {
  chatId: string;
  initialRowCount: number;
}) {
  const threadRuntime = useThreadRuntime();
  const setChatMessages = useChatWorkspaceStore((state) => state.setChatMessages);
  const lastSnapshotRef = useRef("");
  const skipFirstEmptyRef = useRef(initialRowCount > 0);

  useEffect(() => {
    const syncMessages = () => {
      const rows = rowsFromRuntimeExternalState(threadRuntime.exportExternalState());
      if (rows.length === 0 && skipFirstEmptyRef.current) {
        skipFirstEmptyRef.current = false;
        return;
      }
      skipFirstEmptyRef.current = false;

      const nextSnapshot = rowsSnapshot(rows);
      if (nextSnapshot === lastSnapshotRef.current) return;
      lastSnapshotRef.current = nextSnapshot;
      setChatMessages(chatId, rows);
    };

    syncMessages();
    return threadRuntime.subscribe(syncMessages);
  }, [chatId, setChatMessages, threadRuntime]);

  return null;
}
