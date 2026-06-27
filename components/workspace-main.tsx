"use client";

import { ChatRuntime } from "@/components/chat-runtime";
import { NpcRecruitmentWorkspace } from "@/components/npc-recruitment-workspace";
import { NpcStatusPanel } from "@/components/npc-status-panel";
import { ThemeCreationAssistant } from "@/components/theme-creation-assistant";
import { TopicCreationSummaryPage } from "@/components/topic-creation-summary-page";
import { TopicWelcomePage } from "@/components/topic-welcome-page";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import { parseTopicSystemPanelId } from "@/lib/topic-system-panels";
import type { ChatSession, DialogueSummary, NpcCreationSession, Topic } from "@/lib/chat-types";

type WorkspaceModalApi = {
  confirm: (options: {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }) => Promise<boolean>;
};

export function WorkspaceMain({
  topic,
  chat,
  modal,
  creatingTopic,
  onCloseTopicCreator,
}: {
  topic: Topic | undefined;
  chat: ChatSession | undefined;
  modal: WorkspaceModalApi;
  creatingTopic: boolean;
  onCloseTopicCreator: () => void;
}) {
  const npcCreationSessions = useChatWorkspaceStore((state) => state.npcCreationSessions);
  const npcProgressionSessions = useChatWorkspaceStore((state) => state.npcProgressionSessions);
  const dialogueSummaries = useChatWorkspaceStore((state) => state.dialogueSummaries);
  const activeChatId = useChatWorkspaceStore((state) => state.activeChatId);
  const setActiveChat = useChatWorkspaceStore((state) => state.setActiveChat);
  const systemPanel = parseTopicSystemPanelId(activeChatId);

  if (creatingTopic) {
    return (
      <ThemeCreationAssistant
        onCancel={onCloseTopicCreator}
        onCreated={(chatId) => {
          onCloseTopicCreator();
          if (chatId) setActiveChat(chatId);
        }}
      />
    );
  }

  if (topic && systemPanel?.topicId === topic.id && systemPanel.panel === "welcome") {
    return <TopicWelcomePage topic={topic} />;
  }

  if (topic && systemPanel?.topicId === topic.id && systemPanel.panel === "topic-creation") {
    return <TopicCreationSummaryPage topic={topic} />;
  }

  if (
    topic?.recruitment &&
    systemPanel?.topicId === topic.id &&
    systemPanel.panel === "recruitment"
  ) {
    return (
      <NpcRecruitmentWorkspace
        topic={topic}
        sessions={topic.recruitment.sessionIds
          .map((sessionId) => npcCreationSessions[sessionId])
          .filter((session): session is NpcCreationSession => Boolean(session))}
        progressionSessions={Object.values(npcProgressionSessions).filter(
          (session) => session.topicId === topic.id,
        )}
      />
    );
  }

  if (topic && chat) {
    return (
      <TopicChatRuntime
        topic={topic}
        chat={chat}
        modal={modal}
        dialogueSummaries={dialogueSummaries}
      />
    );
  }

  if (topic) {
    return <TopicWelcomePage topic={topic} />;
  }

  return null;
}

function TopicChatRuntime({
  topic,
  chat,
  modal,
  dialogueSummaries,
}: {
  topic: Topic;
  chat: ChatSession;
  modal: WorkspaceModalApi;
  dialogueSummaries: Record<string, DialogueSummary>;
}) {
  const participant = chat.participants[0];
  const npcMemorySummaries = Object.values(dialogueSummaries)
    .filter(
      (summary) =>
        summary.status === "completed" &&
        summary.topicId === topic.id &&
        summary.npcId === participant?.id,
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {topic.roleplay ? <NpcStatusPanel topic={topic} chat={chat} modal={modal} /> : null}
      <div className="min-h-0 flex-1">
        <ChatRuntime
          key={chat.id}
          topicContext={{
            topic: {
              id: topic.id,
              title: topic.title,
              description: topic.description,
              roleplay: topic.roleplay,
              relationshipTasks: topic.relationshipTasks,
              taskKeyNodeRequests: topic.taskKeyNodeRequests,
              consentRequests: topic.consentRequests,
              diceChecks: topic.diceChecks,
            },
            npcMemorySummaries,
            chat: {
              id: chat.id,
              title: chat.title,
              mode: chat.mode,
              participants: chat.participants,
              toolCallCounts: chat.toolCallCounts,
              sceneSetup: chat.sceneSetup,
            },
          }}
        />
      </div>
    </div>
  );
}
