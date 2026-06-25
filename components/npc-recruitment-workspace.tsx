"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BotIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  MessageCircleIcon,
  XCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatSession, NpcCreationSession, Topic } from "@/lib/chat-types";

type NpcRecruitmentWorkspaceProps = {
  topic: Topic;
  chat: ChatSession;
  sessions: NpcCreationSession[];
  groupChat: ReactNode;
};

export function NpcRecruitmentWorkspace({
  topic,
  chat,
  sessions,
  groupChat,
}: NpcRecruitmentWorkspaceProps) {
  const [selectedId, setSelectedId] = useState<string>("group");
  const selectedSession = sessions.find((session) => session.id === selectedId);
  const recruitment = chat.recruitment;
  const canOpenGroup = chat.participants.length > 0;

  useEffect(() => {
    if (!canOpenGroup && selectedId === "group") {
      setSelectedId(sessions[0]?.id ?? "group");
    }
  }, [canOpenGroup, selectedId, sessions]);

  const title = useMemo(() => {
    if (selectedId === "group") return chat.title;
    return selectedSession ? `候选玩家 ${selectedSession.index + 1}` : "候选玩家";
  }, [chat.title, selectedId, selectedSession]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="bg-muted/25 hidden w-72 shrink-0 border-r md:flex md:flex-col">
        <div className="border-b px-4 py-3">
          <div className="truncate text-sm font-semibold">正在寻找其他玩家</div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {recruitment
              ? `${recruitment.completedCount}/${recruitment.targetCount} 已入群`
              : "等待中"}
          </div>
        </div>
        <div className="grid gap-1 p-2">
          <Button
            type="button"
            variant={selectedId === "group" ? "secondary" : "ghost"}
            className="h-auto justify-start gap-2 rounded-md px-2 py-2"
            onClick={() => setSelectedId("group")}
            disabled={!canOpenGroup}
          >
            <MessageCircleIcon className="size-4" />
            <span className="min-w-0 flex-1 truncate text-left">群聊</span>
            <span className="text-muted-foreground text-xs">{chat.participants.length}</span>
          </Button>
          {sessions.map((session) => (
            <Button
              key={session.id}
              type="button"
              variant={selectedId === session.id ? "secondary" : "ghost"}
              className="h-auto justify-start gap-2 rounded-md px-2 py-2"
              onClick={() => setSelectedId(session.id)}
            >
              <SessionStatusIcon status={session.status} />
              <span className="min-w-0 flex-1 truncate text-left">
                候选玩家 {session.index + 1}
              </span>
              <span className="text-muted-foreground text-xs">
                {session.status === "completed"
                  ? "已入群"
                  : session.status === "failed"
                    ? "失败"
                    : session.status === "running"
                      ? "创建中"
                      : "排队"}
              </span>
            </Button>
          ))}
        </div>
        <div className="mt-auto border-t p-3">
          <div className="text-muted-foreground max-h-40 overflow-y-auto text-xs leading-relaxed">
            {(recruitment?.events ?? []).map((event) => (
              <div key={event.id} className="mb-2 last:mb-0">
                <span
                  className={cn(
                    event.status === "success" && "text-emerald-600",
                    event.status === "error" && "text-destructive",
                  )}
                >
                  {event.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-12 shrink-0 items-center gap-2 border-b px-4 md:hidden">
          <select
            className="border-input bg-background h-8 min-w-0 flex-1 rounded-md border px-2 text-sm"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="group" disabled={!canOpenGroup}>
              群聊
            </option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                候选玩家 {session.index + 1}
              </option>
            ))}
          </select>
        </div>
        <div className="hidden h-12 shrink-0 items-center justify-between border-b px-4 md:flex">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{title}</div>
            <div className="text-muted-foreground truncate text-xs">{topic.title}</div>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {selectedId === "group" ? (
            canOpenGroup ? (
              groupChat
            ) : (
              <WaitingRoom chat={chat} />
            )
          ) : selectedSession ? (
            <NpcCreationChat session={selectedSession} />
          ) : (
            <WaitingRoom chat={chat} />
          )}
        </div>
      </section>
    </div>
  );
}

function WaitingRoom({ chat }: { chat: ChatSession }) {
  const events = chat.recruitment?.events ?? [];
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center gap-4 px-4">
      <div className="text-center">
        <div className="text-lg font-semibold">群聊已创建，正在寻找其他玩家</div>
        <div className="text-muted-foreground mt-1 text-sm">
          NPC 完成创建后会自动入群。你可以先查看每个候选玩家的创建 chat。
        </div>
      </div>
      <div className="border-border bg-muted/30 mx-auto grid max-h-72 w-full max-w-xl gap-3 overflow-y-auto rounded-lg border p-4">
        {events.map((event) => (
          <div key={event.id} className="flex gap-2 text-sm">
            <SessionEventDot status={event.status} />
            <span className="min-w-0 flex-1">{event.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NpcCreationChat({ session }: { session: NpcCreationSession }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <BotIcon className="text-muted-foreground size-4" />
          <span className="font-medium">{session.personaTemplate}</span>
        </div>
        <div className="grid gap-4">
          {session.messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex",
                message.role === "npc"
                  ? "justify-end"
                  : message.role === "system"
                    ? "justify-center"
                    : "justify-start",
              )}
            >
              {message.role === "system" ? (
                <div className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs">
                  {message.content}
                </div>
              ) : (
                <div
                  className={cn(
                    "max-w-[82%] rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-line",
                    message.role === "npc"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  <div className="mb-1 text-xs opacity-70">{message.name}</div>
                  {message.content}
                </div>
              )}
            </div>
          ))}
          {session.status === "running" ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 text-xs">
              <CircleDashedIcon className="size-3.5 animate-spin" />
              创建对话进行中
            </div>
          ) : null}
          {session.status === "failed" ? (
            <div className="text-destructive flex items-center justify-center gap-2 text-xs">
              <XCircleIcon className="size-3.5" />
              {session.error ?? "创建失败"}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SessionStatusIcon({ status }: { status: NpcCreationSession["status"] }) {
  if (status === "completed") return <CheckCircle2Icon className="size-4 text-emerald-600" />;
  if (status === "failed") return <XCircleIcon className="text-destructive size-4" />;
  return <CircleDashedIcon className={cn("size-4", status === "running" && "animate-spin")} />;
}

function SessionEventDot({ status }: { status: "info" | "success" | "error" }) {
  return (
    <span
      className={cn(
        "mt-1 size-2 shrink-0 rounded-full",
        status === "info" && "bg-muted-foreground",
        status === "success" && "bg-emerald-600",
        status === "error" && "bg-destructive",
      )}
    />
  );
}
