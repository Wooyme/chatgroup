"use client";

import { useState } from "react";
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
import { useChatWorkspaceStore } from "@/lib/chat-store";

export const Assistant = () => {
  const activeTopicId = useChatWorkspaceStore((state) => state.activeTopicId);
  const activeChatId = useChatWorkspaceStore((state) => state.activeChatId);
  const topic = useChatWorkspaceStore((state) => state.topics[activeTopicId]);
  const chat = useChatWorkspaceStore((state) => state.chats[activeChatId]);
  const npcCreationSessions = useChatWorkspaceStore((state) => state.npcCreationSessions);
  const modal = useWorkspaceModal();
  const [creatingTopic, setCreatingTopic] = useState(false);

  useNpcCreationRunner(npcCreationSessions);

  return (
    <SidebarProvider>
      <div className="flex h-dvh w-full pr-0.5">
        <TopicWorkspaceSidebar
          modal={modal.api}
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
                    {creatingTopic
                      ? "主题创建助手"
                      : `${chat?.title ?? "会话"}${
                          chat ? ` · ${chat.participants.map((ai) => ai.name).join("、")}` : ""
                        }`}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </header>
          <div className="flex-1 overflow-hidden">
            <WorkspaceMain
              topic={topic}
              chat={chat}
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
