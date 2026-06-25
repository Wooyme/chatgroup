"use client";

import { ChatRuntime } from "@/components/chat-runtime";
import { NpcRecruitmentWorkspace } from "@/components/npc-recruitment-workspace";
import { ThemeCreationAssistant } from "@/components/theme-creation-assistant";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { ChatSession, NpcCreationSession, Topic } from "@/lib/chat-types";

export function WorkspaceMain({
  topic,
  chat,
  creatingTopic,
  onCloseTopicCreator,
}: {
  topic: Topic | undefined;
  chat: ChatSession | undefined;
  creatingTopic: boolean;
  onCloseTopicCreator: () => void;
}) {
  const npcCreationSessions = useChatWorkspaceStore((state) => state.npcCreationSessions);
  const setActiveChat = useChatWorkspaceStore((state) => state.setActiveChat);

  if (creatingTopic) {
    return (
      <ThemeCreationAssistant
        onCancel={onCloseTopicCreator}
        onCreated={(chatId) => {
          onCloseTopicCreator();
          setActiveChat(chatId);
        }}
      />
    );
  }

  if (topic && chat?.recruitment) {
    return (
      <NpcRecruitmentWorkspace
        topic={topic}
        chat={chat}
        sessions={chat.recruitment.sessionIds
          .map((sessionId) => npcCreationSessions[sessionId])
          .filter((session): session is NpcCreationSession => Boolean(session))}
        groupChat={<TopicChatRuntime topic={topic} chat={chat} />}
      />
    );
  }

  if (topic && chat) {
    return <TopicChatRuntime topic={topic} chat={chat} />;
  }

  return null;
}

function TopicChatRuntime({ topic, chat }: { topic: Topic; chat: ChatSession }) {
  return (
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
  );
}
