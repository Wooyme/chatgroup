"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import type { ProviderModel } from "@/lib/ai-providers";
import type { StoredMessageRow, TopicContext } from "@/lib/chat-types";

type StorageContent = Record<string, unknown>;

type ModalBaseOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PromptOptions = ModalBaseOptions & {
  defaultValue?: string;
  placeholder?: string;
  multiline?: boolean;
};

type ModalFormValue = string | string[];

type ModalChoiceOption = {
  value: string;
  label: string;
  description?: string;
};

type ModalField = {
  name: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  multiline?: boolean;
  type?: "text" | "choice" | "model";
  choiceMode?: "single" | "multiple";
  options?: ModalChoiceOption[];
  defaultValues?: string[];
  modelNameField?: string;
};

type FormOptions = ModalBaseOptions & {
  fields: Array<ModalField & { label: string }>;
};

type WorkspaceModalApi = {
  alert: (options: ModalBaseOptions) => Promise<void>;
  confirm: (options: ModalBaseOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  form: (options: FormOptions) => Promise<Record<string, ModalFormValue> | null>;
};

type AlertRequest = ModalBaseOptions & {
  kind: "alert";
  resolve: () => void;
};

type ConfirmRequest = ModalBaseOptions & {
  kind: "confirm";
  resolve: (confirmed: boolean) => void;
};

type PromptRequest = PromptOptions & {
  kind: "prompt";
  resolve: (value: string | null) => void;
};

type FormRequest = FormOptions & {
  kind: "form";
  resolve: (values: Record<string, ModalFormValue> | null) => void;
};

type ModalRequest = AlertRequest | ConfirmRequest | PromptRequest | FormRequest;

const getInitialFormValues = (fields: ModalField[]) =>
  Object.fromEntries(
    fields.map((field) => [
      field.name,
      field.type === "choice" || field.type === "model"
        ? (field.defaultValues ?? [])
        : (field.defaultValue ?? ""),
    ]),
  );

function useWorkspaceModal(): {
  api: WorkspaceModalApi;
  request: ModalRequest | null;
  values: Record<string, ModalFormValue>;
  setFieldValue: (name: string, value: ModalFormValue) => void;
  close: () => void;
  submit: () => void;
} {
  const [request, setRequest] = useState<ModalRequest | null>(null);
  const [values, setValues] = useState<Record<string, ModalFormValue>>({});

  const alert = useCallback(
    (options: ModalBaseOptions) =>
      new Promise<void>((resolve) => {
        setValues({});
        setRequest({ ...options, kind: "alert", resolve });
      }),
    [],
  );

  const confirm = useCallback(
    (options: ModalBaseOptions) =>
      new Promise<boolean>((resolve) => {
        setValues({});
        setRequest({ ...options, kind: "confirm", resolve });
      }),
    [],
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValues({ value: options.defaultValue ?? "" });
        setRequest({ ...options, kind: "prompt", resolve });
      }),
    [],
  );

  const form = useCallback(
    (options: FormOptions) =>
      new Promise<Record<string, ModalFormValue> | null>((resolve) => {
        setValues(getInitialFormValues(options.fields));
        setRequest({ ...options, kind: "form", resolve });
      }),
    [],
  );

  const setFieldValue = useCallback((name: string, value: ModalFormValue) => {
    setValues((current) => ({ ...current, [name]: value }));
  }, []);

  const close = useCallback(() => {
    if (!request) return;
    if (request.kind === "alert") request.resolve();
    if (request.kind === "confirm") request.resolve(false);
    if (request.kind === "prompt") request.resolve(null);
    if (request.kind === "form") request.resolve(null);
    setRequest(null);
    setValues({});
  }, [request]);

  const submit = useCallback(() => {
    if (!request) return;
    if (request.kind === "alert") request.resolve();
    if (request.kind === "confirm") request.resolve(true);
    if (request.kind === "prompt") {
      request.resolve(typeof values.value === "string" ? values.value : "");
    }
    if (request.kind === "form") request.resolve(values);
    setRequest(null);
    setValues({});
  }, [request, values]);

  const api = useMemo(() => ({ alert, confirm, prompt, form }), [alert, confirm, prompt, form]);

  return { api, request, values, setFieldValue, close, submit };
}

function WorkspaceModal({
  request,
  values,
  setFieldValue,
  close,
  submit,
}: {
  request: ModalRequest | null;
  values: Record<string, ModalFormValue>;
  setFieldValue: (name: string, value: ModalFormValue) => void;
  close: () => void;
  submit: () => void;
}) {
  const [modelQuery, setModelQuery] = useState("");
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [modelsStatus, setModelsStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const isPrompt = request?.kind === "prompt";
  const isForm = request?.kind === "form";
  const isAlert = request?.kind === "alert";
  const confirmLabel = request?.confirmLabel ?? (request?.kind === "confirm" ? "确认" : "确定");
  const cancelLabel = request?.cancelLabel ?? "取消";
  const fields: ModalField[] = isPrompt
    ? [
        {
          name: "value",
          defaultValue: request.defaultValue,
          placeholder: request.placeholder,
          multiline: request.multiline,
        },
      ]
    : isForm
      ? request.fields
      : [];

  const hasModelField = fields.some((field) => field.type === "model");

  const loadModels = useCallback(async () => {
    setModelsStatus("loading");
    try {
      const response = await fetch("/api/providers/openrouter/models");
      if (!response.ok) throw new Error(`Failed to load models: ${response.status}`);
      const payload = (await response.json()) as { models?: ProviderModel[] };
      setModels(payload.models ?? []);
      setModelsStatus("loaded");
    } catch {
      setModelsStatus("error");
    }
  }, []);

  useEffect(() => {
    setModelQuery("");
  }, [request]);

  useEffect(() => {
    if (hasModelField && modelsStatus === "idle") {
      void loadModels();
    }
  }, [hasModelField, loadModels, modelsStatus]);

  const renderField = (field: ModalField, index: number) => {
    const id = `workspace-modal-${field.name}`;
    const labelId = `${id}-label`;
    const rawValue = values[field.name];
    const textValue = typeof rawValue === "string" ? rawValue : "";
    const choiceValues = Array.isArray(rawValue) ? rawValue : [];
    const modelOptions = models.filter((model) => {
      const query = modelQuery.trim().toLowerCase();
      if (!query) return true;
      return (
        model.id.toLowerCase().includes(query) ||
        model.name.toLowerCase().includes(query) ||
        model.description?.toLowerCase().includes(query)
      );
    });
    const input =
      field.type === "model" ? (
        <div className="grid gap-2">
          <Input
            placeholder="搜索 OpenRouter 模型..."
            value={modelQuery}
            onChange={(event) => setModelQuery(event.target.value)}
          />
          <div
            id={id}
            className="grid max-h-64 gap-2 overflow-y-auto pr-1"
            role="radiogroup"
            aria-labelledby={field.label ? labelId : undefined}
          >
            {modelsStatus === "loading" ? (
              <div className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
                正在加载模型...
              </div>
            ) : modelsStatus === "error" ? (
              <div className="grid gap-2 rounded-md border px-3 py-2">
                <div className="text-sm font-medium">模型列表加载失败</div>
                <Button type="button" variant="outline" size="sm" onClick={loadModels}>
                  重试
                </Button>
              </div>
            ) : modelOptions.length === 0 ? (
              <div className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
                没有匹配的模型
              </div>
            ) : (
              modelOptions.slice(0, 80).map((model) => {
                const selected = choiceValues.includes(model.id);
                return (
                  <label
                    key={model.id}
                    className="border-input hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-accent flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors"
                  >
                    <input
                      type="radio"
                      name={field.name}
                      className="mt-1"
                      checked={selected}
                      onChange={() => {
                        setFieldValue(field.name, [model.id]);
                        setFieldValue(field.modelNameField ?? `${field.name}Name`, model.name);
                      }}
                    />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate text-sm font-medium">{model.name}</span>
                      <span className="text-muted-foreground truncate text-xs">{model.id}</span>
                      {model.contextLength ? (
                        <span className="text-muted-foreground text-xs">
                          上下文 {model.contextLength.toLocaleString()} tokens
                        </span>
                      ) : null}
                      {model.description ? (
                        <span className="text-muted-foreground line-clamp-2 text-xs">
                          {model.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      ) : field.type === "choice" ? (
        <div
          id={id}
          className="grid gap-2"
          role={field.choiceMode === "single" ? "radiogroup" : "group"}
          aria-labelledby={field.label ? labelId : undefined}
        >
          {(field.options ?? []).map((option) => {
            const selected = choiceValues.includes(option.value);
            return (
              <label
                key={option.value}
                className="border-input hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-accent flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors"
              >
                <input
                  type={field.choiceMode === "single" ? "radio" : "checkbox"}
                  name={field.name}
                  className="mt-1"
                  checked={selected}
                  onChange={() => {
                    if (field.choiceMode === "single") {
                      setFieldValue(field.name, [option.value]);
                      return;
                    }
                    setFieldValue(
                      field.name,
                      selected
                        ? choiceValues.filter((value) => value !== option.value)
                        : [...choiceValues, option.value],
                    );
                  }}
                />
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-sm font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="text-muted-foreground line-clamp-2 text-xs">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : field.multiline ? (
        <textarea
          id={id}
          autoFocus={index === 0}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:ring-[3px]"
          placeholder={field.placeholder}
          value={textValue}
          onChange={(event) => setFieldValue(field.name, event.target.value)}
        />
      ) : (
        <Input
          id={id}
          autoFocus={index === 0}
          placeholder={field.placeholder}
          value={textValue}
          onChange={(event) => setFieldValue(field.name, event.target.value)}
        />
      );

    return (
      <div key={field.name} className="grid gap-2">
        {field.label && field.type === "choice" ? (
          <span id={labelId} className="text-sm font-medium leading-none">
            {field.label}
          </span>
        ) : field.label ? (
          <label className="text-sm font-medium leading-none" htmlFor={id}>
            {field.label}
          </label>
        ) : null}
        {input}
      </div>
    );
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        {request ? (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
              {request.description ? (
                <DialogDescription className="whitespace-pre-line">
                  {request.description}
                </DialogDescription>
              ) : null}
            </DialogHeader>
            {isPrompt || isForm ? (
              <div className="grid max-h-[55vh] gap-4 overflow-y-auto pr-1">
                {fields.map(renderField)}
              </div>
            ) : null}
            <DialogFooter>
              {!isAlert ? (
                <Button type="button" variant="outline" onClick={close}>
                  {cancelLabel}
                </Button>
              ) : null}
              <Button type="submit" variant={request.destructive ? "destructive" : "default"}>
                {confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

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
  const modal = useWorkspaceModal();

  return (
    <SidebarProvider>
      <div className="flex h-dvh w-full pr-0.5">
        <TopicWorkspaceSidebar modal={modal.api} />
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
