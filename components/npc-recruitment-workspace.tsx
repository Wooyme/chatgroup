"use client";

import { useMemo, useState } from "react";
import { BotIcon, CheckCircle2Icon, CircleDashedIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import { cn } from "@/lib/utils";
import type { NpcCreationSession, NpcProgressionSession, Topic } from "@/lib/chat-types";

type NpcRecruitmentWorkspaceProps = {
  topic: Topic;
  sessions: NpcCreationSession[];
  progressionSessions: NpcProgressionSession[];
};

export function NpcRecruitmentWorkspace({
  topic,
  sessions,
  progressionSessions,
}: NpcRecruitmentWorkspaceProps) {
  const ais = useChatWorkspaceStore((state) => state.ais);
  const [selectedId, setSelectedId] = useState<string>("waiting");
  const selectedSession = sessions.find((session) => session.id === selectedId);
  const selectedProgressionSession = progressionSessions.find(
    (session) => `progression:${session.id}` === selectedId,
  );
  const recruitment = topic.recruitment;

  const title = useMemo(() => {
    if (selectedId === "waiting") return topic.title;
    if (selectedProgressionSession) return "DM 派发任务";
    return selectedSession ? `候选玩家 ${selectedSession.index + 1}` : "候选玩家";
  }, [topic.title, selectedId, selectedProgressionSession, selectedSession]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="bg-muted/25 hidden w-72 shrink-0 border-r md:flex md:flex-col">
        <div className="border-b px-4 py-3">
          <div className="truncate text-sm font-semibold">正在寻找其他玩家</div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {recruitment
              ? `${recruitment.completedCount}/${recruitment.targetCount} 已加入主题`
              : "等待中"}
          </div>
        </div>
        <div className="grid gap-1 p-2">
          <Button
            type="button"
            variant={selectedId === "waiting" ? "secondary" : "ghost"}
            className="h-auto justify-start gap-2 rounded-md px-2 py-2"
            onClick={() => setSelectedId("waiting")}
          >
            <CircleDashedIcon className="size-4" />
            <span className="min-w-0 flex-1 truncate text-left">创建进度</span>
            <span className="text-muted-foreground text-xs">{topic.aiIds.length}</span>
          </Button>
          {sessions.map((session) => {
            const participant = session.resultAiId ? ais[session.resultAiId] : undefined;
            return (
              <div key={session.id} className="grid gap-1">
                <Button
                  type="button"
                  variant={selectedId === session.id ? "secondary" : "ghost"}
                  className="h-auto justify-start gap-2 rounded-md px-2 py-2"
                  onClick={() => setSelectedId(session.id)}
                >
                  <SessionStatusIcon status={session.status} />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {participant?.faction
                      ? `${participant.faction}｜${participant.name}`
                      : `${session.targetFaction || "待定"}｜${session.roleNiche || `候选玩家 ${session.index + 1}`}`}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {session.status === "completed"
                      ? "已加入"
                      : session.status === "failed"
                        ? "失败"
                        : session.status === "running"
                          ? "创建中"
                          : "排队"}
                  </span>
                </Button>
              </div>
            );
          })}
          {progressionSessions.map((session) => (
            <Button
              key={session.id}
              type="button"
              variant={selectedId === `progression:${session.id}` ? "secondary" : "ghost"}
              className="h-auto justify-start gap-2 rounded-md px-2 py-2"
              onClick={() => setSelectedId(`progression:${session.id}`)}
            >
              <SessionStatusIcon status={session.status} />
              <span className="min-w-0 flex-1 truncate text-left">
                {session.purpose === "initial_tasks" ? "第一轮任务" : "补发任务"}
              </span>
              <span className="text-muted-foreground text-xs">
                {session.status === "completed"
                  ? "完成"
                  : session.status === "failed"
                    ? "失败"
                    : session.status === "running"
                      ? "进行中"
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
            <option value="waiting">创建进度</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                候选玩家 {session.index + 1}
              </option>
            ))}
            {progressionSessions.map((session) => (
              <option key={session.id} value={`progression:${session.id}`}>
                {session.purpose === "initial_tasks" ? "第一轮任务" : "补发任务"}
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
          {selectedId === "waiting" ? (
            <WaitingRoom topic={topic} />
          ) : selectedSession ? (
            <NpcCreationChat session={selectedSession} />
          ) : selectedProgressionSession ? (
            <NpcProgressionChat session={selectedProgressionSession} />
          ) : (
            <WaitingRoom topic={topic} />
          )}
        </div>
      </section>
    </div>
  );
}

function WaitingRoom({ topic }: { topic: Topic }) {
  const events = topic.recruitment?.events ?? [];
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center gap-4 px-4">
      <div className="text-center">
        <div className="text-lg font-semibold">主题已创建，正在寻找其他玩家</div>
        <div className="text-muted-foreground mt-1 text-sm">
          NPC 完成创建后会自动加入主题。你可以切换查看每个候选玩家的创建 chat。
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
        <div className="border-border bg-muted/30 mb-4 grid gap-1 rounded-md border px-3 py-2 text-xs">
          <div>
            <span className="text-muted-foreground">推荐阵营：</span>
            {session.targetFaction || "无"}
          </div>
          <div>
            <span className="text-muted-foreground">角色生态位：</span>
            {session.roleNiche || "无"}
          </div>
          <div>
            <span className="text-muted-foreground">差异化关键词：</span>
            {session.reservedKeywords.join("、") || "无"}
          </div>
          <div className="text-muted-foreground">推荐方向是软约束，候选玩家仍需自己提出角色。</div>
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

function NpcProgressionChat({ session }: { session: NpcProgressionSession }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <BotIcon className="text-muted-foreground size-4" />
          <span className="font-medium">
            {session.purpose === "initial_tasks" ? "第一轮任务派发" : "补发关系任务"}
          </span>
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
              任务协商进行中
            </div>
          ) : null}
          {session.status === "failed" ? (
            <div className="text-destructive flex items-center justify-center gap-2 text-xs">
              <XCircleIcon className="size-3.5" />
              {session.error ?? "任务派发失败"}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SessionStatusIcon({
  status,
}: {
  status: NpcCreationSession["status"] | NpcProgressionSession["status"];
}) {
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
