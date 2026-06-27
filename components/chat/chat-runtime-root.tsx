"use client";

import { useMemo } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { UIMessage } from "ai";
import { Thread } from "@/components/assistant-ui/thread";
import { useFactionScoreRunner } from "@/hooks/use-faction-score-runner";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { TopicContext } from "@/lib/chat-types";
import { ChatRoundLockRuntime } from "./chat-round-lock-runtime";
import {
  EMPTY_STORED_MESSAGES,
  makeHistoryAdapter,
  restoreInitialMessages,
  RuntimeMessageStoreSync,
  usePersistHydrated,
} from "./message-persistence";
import { PlayerTaskActionShelf, RelationshipTools } from "./relationship-tools";
import { SceneSetupGate } from "./scene-setup-gate";

export function ChatRuntime({ topicContext }: { topicContext: TopicContext }) {
  const hydrated = usePersistHydrated();

  if (!hydrated) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm text-neutral-500">
        正在恢复对话...
      </div>
    );
  }

  return <HydratedChatRuntime topicContext={topicContext} />;
}

function HydratedChatRuntime({ topicContext }: { topicContext: TopicContext }) {
  const storedRows = useChatWorkspaceStore(
    (state) => state.messages[topicContext.chat.id] ?? EMPTY_STORED_MESSAGES,
  );
  const initialMessages = useMemo(() => restoreInitialMessages(storedRows), [storedRows]);
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
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport,
    adapters: { history: historyAdapter },
  });

  const participantNames = topicContext.chat.participants
    .map((participant) => participant.name)
    .join("、");

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RuntimeMessageStoreSync chatId={topicContext.chat.id} initialRowCount={storedRows.length} />
      <FactionScoreRuntime topicContext={topicContext} />
      <RelationshipTools topicContext={topicContext} />
      <ChatRoundLockRuntime topicContext={topicContext} />
      <SceneSetupGate topicContext={topicContext}>
        <div className="flex h-full min-h-0 flex-col">
          <PlayerTaskActionShelf topicContext={topicContext} />
          <div className="min-h-0 flex-1">
            <Thread
              welcomeTitle={`与 ${participantNames || "AI"} 开始语C`}
              composerPlaceholder="向角色发送消息..."
            />
          </div>
        </div>
      </SceneSetupGate>
    </AssistantRuntimeProvider>
  );
}

function FactionScoreRuntime({ topicContext }: { topicContext: TopicContext }) {
  useFactionScoreRunner(topicContext);
  return null;
}
