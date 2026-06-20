"use client";

import type * as React from "react";
import {
  BotIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { AiParticipant, ChatMode } from "@/lib/chat-types";

const describeAiChoices = (ais: AiParticipant[]) =>
  ais.map((ai, index) => `${index + 1}. ${ai.name}（${ai.role}）`).join("\n");

const parseAiSelection = (input: string, ais: AiParticipant[], mode: ChatMode) => {
  const normalized = input.trim();
  if (!normalized) return mode === "dialog" ? ais.slice(0, 1) : ais;

  const tokens = normalized
    .split(/[，,、\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const selected = tokens
    .map((token) => {
      const index = Number(token);
      if (Number.isInteger(index) && index >= 1) return ais[index - 1];
      return ais.find((ai) => ai.name === token || ai.id === token);
    })
    .filter((ai): ai is AiParticipant => Boolean(ai));

  const unique = Array.from(new Map(selected.map((ai) => [ai.id, ai])).values());
  return mode === "dialog" ? unique.slice(0, 1) : unique;
};

export function TopicWorkspaceSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const topics = useChatWorkspaceStore((state) => state.topics);
  const ais = useChatWorkspaceStore((state) => state.ais);
  const chats = useChatWorkspaceStore((state) => state.chats);
  const activeTopicId = useChatWorkspaceStore((state) => state.activeTopicId);
  const activeChatId = useChatWorkspaceStore((state) => state.activeChatId);
  const createTopic = useChatWorkspaceStore((state) => state.createTopic);
  const renameTopic = useChatWorkspaceStore((state) => state.renameTopic);
  const deleteTopic = useChatWorkspaceStore((state) => state.deleteTopic);
  const createAi = useChatWorkspaceStore((state) => state.createAi);
  const updateAi = useChatWorkspaceStore((state) => state.updateAi);
  const deleteAi = useChatWorkspaceStore((state) => state.deleteAi);
  const createChat = useChatWorkspaceStore((state) => state.createChat);
  const renameChat = useChatWorkspaceStore((state) => state.renameChat);
  const deleteChat = useChatWorkspaceStore((state) => state.deleteChat);
  const setActiveTopic = useChatWorkspaceStore((state) => state.setActiveTopic);
  const setActiveChat = useChatWorkspaceStore((state) => state.setActiveChat);

  const topicList = Object.values(topics).sort((a, b) => b.updatedAt - a.updatedAt);
  const activeTopic = topics[activeTopicId];
  const aiList = (activeTopic?.aiIds ?? [])
    .map((aiId) => ais[aiId])
    .filter((ai): ai is AiParticipant => Boolean(ai));
  const chatList = (activeTopic?.chatIds ?? [])
    .map((chatId) => chats[chatId])
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const addTopic = () => {
    const title = window.prompt("主题名称", "新主题");
    if (title !== null) createTopic(title);
  };

  const editTopic = (topicId: string, currentTitle: string) => {
    const title = window.prompt("重命名主题", currentTitle);
    if (title !== null) renameTopic(topicId, title);
  };

  const removeTopic = (topicId: string, title: string) => {
    if (window.confirm(`删除主题「${title}」及其全部 AI、会话？`)) {
      deleteTopic(topicId);
    }
  };

  const addAi = () => {
    if (!activeTopic) return;
    const name = window.prompt("AI 名称", "新角色");
    if (name === null) return;
    const role = window.prompt("角色人设", "待设定的人设");
    if (role === null) return;
    const systemPrompt = window.prompt(
      "角色提示词",
      "按照人设进行语C互动，保持角色口吻，主动回应玩家。",
    );
    if (systemPrompt === null) return;
    createAi(activeTopic.id, { name, role, systemPrompt });
  };

  const editAi = (ai: AiParticipant) => {
    const name = window.prompt("AI 名称", ai.name);
    if (name === null) return;
    const role = window.prompt("角色人设", ai.role);
    if (role === null) return;
    const systemPrompt = window.prompt("角色提示词", ai.systemPrompt);
    if (systemPrompt === null) return;
    updateAi(ai.id, { name, role, systemPrompt });
  };

  const removeAi = (ai: AiParticipant) => {
    if (window.confirm(`删除 AI「${ai.name}」？已有会话会保留创建时的人设快照。`)) {
      deleteAi(ai.id);
    }
  };

  const addChat = (mode: ChatMode) => {
    if (!activeTopic || aiList.length === 0) return;
    const selection = window.prompt(
      mode === "group"
        ? "选择群聊 AI（输入序号或名称，逗号分隔）"
        : "选择单聊 AI（输入序号或名称）",
      mode === "group" ? aiList.map((_, index) => index + 1).join(",") : "1",
    );
    if (selection === null) return;
    const selectedAis = parseAiSelection(selection, aiList, mode);
    if (selectedAis.length === 0) {
      window.alert("没有匹配到 AI。\n" + describeAiChoices(aiList));
      return;
    }
    const fallback =
      mode === "group"
        ? `${selectedAis.map((ai) => ai.name).join("、")} 群聊`
        : `与 ${selectedAis[0]!.name} 对话`;
    const title = window.prompt("会话名称", fallback);
    if (title !== null) {
      createChat(
        activeTopic.id,
        mode,
        title,
        selectedAis.map((ai) => ai.id),
      );
    }
  };

  const editChat = (chatId: string, currentTitle: string) => {
    const title = window.prompt("重命名会话", currentTitle);
    if (title !== null) renameChat(chatId, title);
  };

  const removeChat = (chatId: string, title: string) => {
    if (window.confirm(`删除会话「${title}」？`)) {
      deleteChat(chatId);
    }
  };

  return (
    <Sidebar {...props}>
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <MessagesSquareIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">语C工作区</div>
            <div className="text-muted-foreground truncate text-xs">主题、AI 与群组对话</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-1">
        <SidebarGroup>
          <SidebarGroupLabel>主题</SidebarGroupLabel>
          <SidebarGroupAction aria-label="创建主题" onClick={addTopic}>
            <PlusIcon />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {topicList.map((topic) => (
                <SidebarMenuItem key={topic.id}>
                  <SidebarMenuButton
                    isActive={topic.id === activeTopicId}
                    onClick={() => setActiveTopic(topic.id)}
                    tooltip={topic.title}
                  >
                    <MessageSquareIcon />
                    <span>{topic.title}</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction
                    aria-label="重命名主题"
                    showOnHover
                    onClick={() => editTopic(topic.id, topic.title)}
                  >
                    <PencilIcon />
                  </SidebarMenuAction>
                  {topicList.length > 1 && (
                    <SidebarMenuAction
                      aria-label="删除主题"
                      showOnHover
                      className="right-7"
                      onClick={() => removeTopic(topic.id, topic.title)}
                    >
                      <TrashIcon />
                    </SidebarMenuAction>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>当前主题 AI</SidebarGroupLabel>
          <SidebarGroupAction aria-label="创建 AI" onClick={addAi}>
            <PlusIcon />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {aiList.map((ai) => (
                <SidebarMenuItem key={ai.id}>
                  <SidebarMenuButton tooltip={`${ai.name}：${ai.role}`}>
                    <span className={cn("size-2.5 rounded-full", ai.color)} />
                    <span>{ai.name}</span>
                    <span className="text-muted-foreground ms-auto truncate text-[10px]">
                      {ai.role}
                    </span>
                  </SidebarMenuButton>
                  <SidebarMenuAction aria-label="编辑 AI" showOnHover onClick={() => editAi(ai)}>
                    <PencilIcon />
                  </SidebarMenuAction>
                  {aiList.length > 1 && (
                    <SidebarMenuAction
                      aria-label="删除 AI"
                      showOnHover
                      className="right-7"
                      onClick={() => removeAi(ai)}
                    >
                      <TrashIcon />
                    </SidebarMenuAction>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="min-h-0 flex-1">
          <SidebarGroupLabel>当前主题会话</SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-1 px-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 justify-start gap-1.5 rounded-md px-2 text-xs"
                onClick={() => addChat("dialog")}
                disabled={!activeTopic || aiList.length === 0}
              >
                <BotIcon className="size-3.5" />
                单聊
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 justify-start gap-1.5 rounded-md px-2 text-xs"
                onClick={() => addChat("group")}
                disabled={!activeTopic || aiList.length === 0}
              >
                <UsersIcon className="size-3.5" />
                群聊
              </Button>
            </div>
            <SidebarMenu>
              {chatList.map((chat) => (
                <SidebarMenuItem key={chat.id}>
                  <SidebarMenuButton
                    isActive={chat.id === activeChatId}
                    onClick={() => setActiveChat(chat.id)}
                    tooltip={`${chat.title} · ${chat.participants.map((ai) => ai.name).join("、")}`}
                  >
                    {chat.mode === "group" ? <UsersIcon /> : <BotIcon />}
                    <span>{chat.title}</span>
                    <span
                      className={cn(
                        "ms-auto rounded px-1.5 py-0.5 text-[10px] font-medium",
                        chat.mode === "group"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {chat.mode === "group" ? "群聊" : (chat.participants[0]?.name ?? "单聊")}
                    </span>
                  </SidebarMenuButton>
                  <SidebarMenuAction
                    aria-label="重命名会话"
                    showOnHover
                    onClick={() => editChat(chat.id, chat.title)}
                  >
                    <PencilIcon />
                  </SidebarMenuAction>
                  <SidebarMenuAction
                    aria-label="删除会话"
                    showOnHover
                    className="right-7"
                    onClick={() => removeChat(chat.id, chat.title)}
                  >
                    <TrashIcon />
                  </SidebarMenuAction>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
