"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceMain } from "@/components/workspace-main";
import { WorkspaceModal, useWorkspaceModal } from "@/components/workspace-modal";
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
import { useNpcCreationRunner } from "@/hooks/use-npc-creation-runner";
import { useNpcProgressionRunner } from "@/hooks/use-npc-progression-runner";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import { parseTopicSystemPanelId } from "@/lib/topic-system-panels";

export const Assistant = () => {
  const activeTopicId = useChatWorkspaceStore((state) => state.activeTopicId);
  const activeChatId = useChatWorkspaceStore((state) => state.activeChatId);
  const topic = useChatWorkspaceStore((state) => state.topics[activeTopicId]);
  const chat = useChatWorkspaceStore((state) => state.chats[activeChatId]);
  const chatLock = useChatWorkspaceStore((state) => (chat ? state.chatLocks[chat.id] : undefined));
  const requestForcedExit = useChatWorkspaceStore((state) => state.requestForcedExit);
  const npcCreationSessions = useChatWorkspaceStore((state) => state.npcCreationSessions);
  const npcProgressionSessions = useChatWorkspaceStore((state) => state.npcProgressionSessions);
  const modal = useWorkspaceModal();
  const [creatingTopic, setCreatingTopic] = useState(false);
  const pendingSidebarActionRef = useRef<(() => void | Promise<void>) | null>(null);
  const systemPanel = parseTopicSystemPanelId(activeChatId);
  const activePageTitle =
    systemPanel?.panel === "welcome"
      ? "Welcome"
      : systemPanel?.panel === "topic-creation"
        ? "主题创建助手"
        : systemPanel?.panel === "recruitment"
          ? "DM 招募群成员"
          : systemPanel?.panel === "context-pipeline"
            ? "Context Pipeline"
            : chat
              ? `${chat.title} · ${chat.participants.map((ai) => ai.name).join("、")}`
              : "会话";

  useNpcCreationRunner(npcCreationSessions);
  useNpcProgressionRunner(npcProgressionSessions);

  const guardSidebarAction = useCallback(
    async (action: () => void | Promise<void>) => {
      if (!chat || !chatLock) {
        await action();
        return;
      }

      if (
        chatLock.status === "forced_exit_requested" ||
        chatLock.status === "natural_exit_requested" ||
        chatLock.status === "player_leave_reviewing" ||
        chatLock.status === "closing" ||
        chatLock.status === "finalizing"
      ) {
        await modal.api.alert({
          title: "DM 正在收场",
          description: "当前对话正在处理强制离场，请等待 DM 与 NPC 完成收场后再切换。",
        });
        return;
      }

      const participantName = chat.participants[0]?.name ?? "NPC";
      const confirmed = await modal.api.confirm({
        title: "强制离场？",
        description: `当前与 ${participantName} 的对话还没有收场。继续操作会被视为强制离场，DM 将接管离场过程；${participantName} 会明显不愉快。`,
        confirmLabel: "仍要离场",
        cancelLabel: "继续对话",
        destructive: true,
      });
      if (!confirmed) return;

      pendingSidebarActionRef.current = action;
      requestForcedExit(chat.id, "player", "玩家试图通过切换侧边栏强制离开当前对话。");
    },
    [chat, chatLock, modal.api, requestForcedExit],
  );

  useEffect(() => {
    if (chatLock || !pendingSidebarActionRef.current) return;
    const action = pendingSidebarActionRef.current;
    pendingSidebarActionRef.current = null;
    void action();
  }, [chatLock]);

  return (
    <SidebarProvider>
      <div className="flex h-dvh w-full pr-0.5">
        <TopicWorkspaceSidebar
          modal={modal.api}
          guardAction={guardSidebarAction}
          actionLocked={Boolean(chatLock)}
          onCreateTopicAssistant={() => setCreatingTopic(true)}
        />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden min-w-0 md:block">
                  <BreadcrumbPage className="max-w-48 truncate">
                    {creatingTopic ? "创建主题" : (topic?.title ?? "主题")}
                  </BreadcrumbPage>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="max-w-56 truncate">
                    {creatingTopic ? "主题创建助手" : activePageTitle}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </header>
          <div className="flex-1 overflow-hidden">
            <WorkspaceMain
              topic={topic}
              chat={chat}
              modal={modal.api}
              creatingTopic={creatingTopic}
              onCloseTopicCreator={() => setCreatingTopic(false)}
            />
          </div>
        </SidebarInset>
      </div>
      <WorkspaceModal
        request={modal.request}
        values={modal.values}
        setFieldValue={modal.setFieldValue}
        close={modal.close}
        submit={modal.submit}
      />
    </SidebarProvider>
  );
};
