"use client";

import { useMemo } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type {
  MessageFormatAdapter,
  GenericThreadHistoryAdapter,
  MessageStorageEntry,
  ThreadHistoryAdapter,
} from "@assistant-ui/core";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { UIMessage } from "ai";
import { Thread } from "@/components/assistant-ui/thread";
import { TopicWorkspaceSidebar } from "@/components/topic-workspace-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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

export const Assistant = () => {
  const activeTopicId = useChatWorkspaceStore((state) => state.activeTopicId);
  const activeChatId = useChatWorkspaceStore((state) => state.activeChatId);
  const topic = useChatWorkspaceStore((state) => state.topics[activeTopicId]);
  const chat = useChatWorkspaceStore((state) => state.chats[activeChatId]);

  return (
    <SidebarProvider>
      <div className="flex h-dvh w-full pr-0.5">
        <TopicWorkspaceSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden min-w-0 md:block">
                  <BreadcrumbPage className="max-w-48 truncate">
                    {topic?.title ?? "主题"}
                  </BreadcrumbPage>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="max-w-56 truncate">
                    {chat?.title ?? "会话"}
                    {chat ? ` · ${chat.participants.map((ai) => ai.name).join("、")}` : ""}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </header>
          <div className="flex-1 overflow-hidden">
            {topic && chat ? (
              <ChatRuntime
                key={chat.id}
                topicContext={{
                  topic: {
                    id: topic.id,
                    title: topic.title,
                    description: topic.description,
                  },
                  chat: {
                    id: chat.id,
                    title: chat.title,
                    mode: chat.mode,
                    participants: chat.participants,
                  },
                }}
              />
            ) : null}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};

function ChatRuntime({ topicContext }: { topicContext: TopicContext }) {
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

  const isGroup = topicContext.chat.mode === "group";
  const participantNames = topicContext.chat.participants
    .map((participant) => participant.name)
    .join("、");

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread
        welcomeTitle={
          isGroup ? `向 ${participantNames} 发起群组互动` : `与 ${participantNames || "AI"} 开始语C`
        }
        composerPlaceholder={isGroup ? "向群聊发送消息..." : "向角色发送消息..."}
      />
    </AssistantRuntimeProvider>
  );
}
