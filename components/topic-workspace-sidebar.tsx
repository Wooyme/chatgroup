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
import {
  DEFAULT_OPENROUTER_MODEL_ID,
  DEFAULT_OPENROUTER_MODEL_NAME,
  getModelDisplayName,
} from "@/lib/ai-providers";
import type { AiParticipant, ChatMode } from "@/lib/chat-types";

const describeAiChoices = (ais: AiParticipant[]) =>
  ais.map((ai) => `${ai.name}（${ai.role}）`).join("\n");

const getFormText = (values: Record<string, string | string[]>, name: string) => {
  const value = values[name];
  return typeof value === "string" ? value : "";
};

const getFormArray = (values: Record<string, string | string[]>, name: string) => {
  const value = values[name];
  return Array.isArray(value) ? value : [];
};

type WorkspaceModalApi = {
  alert: (options: { title: string; description?: string }) => Promise<void>;
  confirm: (options: {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }) => Promise<boolean>;
  prompt: (options: {
    title: string;
    description?: string;
    defaultValue?: string;
    placeholder?: string;
    multiline?: boolean;
  }) => Promise<string | null>;
  form: (options: {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    fields: Array<{
      name: string;
      label: string;
      defaultValue?: string;
      defaultValues?: string[];
      placeholder?: string;
      multiline?: boolean;
      type?: "text" | "choice" | "model";
      choiceMode?: "single" | "multiple";
      modelNameField?: string;
      options?: Array<{
        value: string;
        label: string;
        description?: string;
      }>;
    }>;
  }) => Promise<Record<string, string | string[]> | null>;
};

type TopicWorkspaceSidebarProps = React.ComponentProps<typeof Sidebar> & {
  modal: WorkspaceModalApi;
};

export function TopicWorkspaceSidebar({ modal, ...props }: TopicWorkspaceSidebarProps) {
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

  const addTopic = async () => {
    const title = await modal.prompt({ title: "主题名称", defaultValue: "新主题" });
    if (title !== null) createTopic(title);
  };

  const editTopic = async (topicId: string, currentTitle: string) => {
    const title = await modal.prompt({
      title: "重命名主题",
      defaultValue: currentTitle,
    });
    if (title !== null) renameTopic(topicId, title);
  };

  const removeTopic = async (topicId: string, title: string) => {
    const confirmed = await modal.confirm({
      title: `删除主题「${title}」？`,
      description: "此操作会同时删除该主题下的全部 AI 和会话。",
      confirmLabel: "删除",
      destructive: true,
    });
    if (confirmed) {
      deleteTopic(topicId);
    }
  };

  const addAi = async () => {
    if (!activeTopic) return;
    const values = await modal.form({
      title: "创建 AI",
      fields: [
        { name: "name", label: "AI 名称", defaultValue: "新角色" },
        { name: "role", label: "角色人设", defaultValue: "待设定的人设" },
        {
          name: "systemPrompt",
          label: "角色提示词",
          defaultValue: "按照人设进行语C互动，保持角色口吻，主动回应玩家。",
          multiline: true,
        },
        {
          name: "modelId",
          label: "模型",
          type: "model",
          choiceMode: "single",
          defaultValues: [DEFAULT_OPENROUTER_MODEL_ID],
          modelNameField: "modelName",
        },
      ],
    });
    if (!values) return;
    const modelId = getFormArray(values, "modelId")[0] ?? DEFAULT_OPENROUTER_MODEL_ID;
    createAi(activeTopic.id, {
      name: getFormText(values, "name"),
      role: getFormText(values, "role"),
      systemPrompt: getFormText(values, "systemPrompt"),
      modelId,
      modelName: getFormText(values, "modelName") || DEFAULT_OPENROUTER_MODEL_NAME,
    });
  };

  const editAi = async (ai: AiParticipant) => {
    const values = await modal.form({
      title: `编辑 AI「${ai.name}」`,
      fields: [
        { name: "name", label: "AI 名称", defaultValue: ai.name },
        { name: "role", label: "角色人设", defaultValue: ai.role },
        {
          name: "systemPrompt",
          label: "角色提示词",
          defaultValue: ai.systemPrompt,
          multiline: true,
        },
        {
          name: "modelId",
          label: "模型",
          type: "model",
          choiceMode: "single",
          defaultValues: [ai.modelId || DEFAULT_OPENROUTER_MODEL_ID],
          modelNameField: "modelName",
        },
      ],
    });
    if (!values) return;
    const modelId = getFormArray(values, "modelId")[0] ?? ai.modelId ?? DEFAULT_OPENROUTER_MODEL_ID;
    updateAi(ai.id, {
      name: getFormText(values, "name"),
      role: getFormText(values, "role"),
      systemPrompt: getFormText(values, "systemPrompt"),
      modelId,
      modelName: getFormText(values, "modelName") || ai.modelName || modelId,
    });
  };

  const removeAi = async (ai: AiParticipant) => {
    const confirmed = await modal.confirm({
      title: `删除 AI「${ai.name}」？`,
      description: "已有会话会保留创建时的人设快照。",
      confirmLabel: "删除",
      destructive: true,
    });
    if (confirmed) {
      deleteAi(ai.id);
    }
  };

  const addChat = async (mode: ChatMode) => {
    if (!activeTopic || aiList.length === 0) return;
    const values = await modal.form({
      title: mode === "group" ? "创建群聊" : "创建单聊",
      fields: [
        {
          name: "participantIds",
          label: mode === "group" ? "选择群聊 AI" : "选择单聊 AI",
          type: "choice",
          choiceMode: mode === "group" ? "multiple" : "single",
          defaultValues: mode === "group" ? aiList.map((ai) => ai.id) : [aiList[0]!.id],
          options: aiList.map((ai) => ({
            value: ai.id,
            label: ai.name,
            description: ai.role,
          })),
        },
        {
          name: "title",
          label: "会话名称",
          placeholder: "留空自动生成",
        },
      ],
    });
    if (!values) return;
    const participantIds = getFormArray(values, "participantIds");
    if (participantIds.length === 0) {
      await modal.alert({
        title: "请选择 AI",
        description: describeAiChoices(aiList),
      });
      return;
    }
    createChat(activeTopic.id, mode, getFormText(values, "title"), participantIds);
  };

  const editChat = async (chatId: string, currentTitle: string) => {
    const title = await modal.prompt({
      title: "重命名会话",
      defaultValue: currentTitle,
    });
    if (title !== null) renameChat(chatId, title);
  };

  const removeChat = async (chatId: string, title: string) => {
    const confirmed = await modal.confirm({
      title: `删除会话「${title}」？`,
      confirmLabel: "删除",
      destructive: true,
    });
    if (confirmed) {
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
                  <SidebarMenuButton
                    tooltip={`${ai.name}：${ai.role}\n${getModelDisplayName(ai.modelId, ai.modelName)}`}
                  >
                    <span className={cn("size-2.5 rounded-full", ai.color)} />
                    <span>{ai.name}</span>
                    <span className="text-muted-foreground ms-auto grid min-w-0 justify-items-end text-[10px]">
                      <span className="max-w-20 truncate">{ai.role}</span>
                      <span className="max-w-20 truncate">
                        {getModelDisplayName(ai.modelId, ai.modelName)}
                      </span>
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
