"use client";

import { ClipboardListIcon, SwordsIcon, UserRoundIcon } from "lucide-react";
import { FactionScorePanel } from "@/components/faction-score-panel";
import type { CharacterAttribute, RelationshipTask, Topic } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

export function TopicWelcomePage({ topic }: { topic: Topic }) {
  const roleplay = topic.roleplay;
  const tasks = topic.relationshipTasks ?? [];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-5">
        <section className="grid gap-1">
          <div className="text-xl font-semibold">{topic.title}</div>
          <div className="text-muted-foreground max-w-3xl text-sm leading-relaxed">
            {topic.description || roleplay?.worldView || "这个主题还没有详细说明。"}
          </div>
        </section>

        {roleplay?.factionSystem ? (
          <div className="overflow-hidden rounded-md border">
            <FactionScorePanel factionSystem={roleplay.factionSystem} />
          </div>
        ) : null}

        {roleplay ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.75fr)_minmax(0,1.5fr)]">
            <section className="rounded-md border p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <UserRoundIcon className="size-4" />
                {roleplay.playerRole} · 玩家属性
              </div>
              <AttributeList attributes={roleplay.playerAttributes} />
            </section>

            <section className="rounded-md border p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <ClipboardListIcon className="size-4" />
                任务列表
              </div>
              <TaskList tasks={tasks} />
            </section>
          </div>
        ) : null}

        {roleplay ? (
          <section className="rounded-md border p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <SwordsIcon className="size-4" />
              玩家设定
            </div>
            <div className="grid gap-2 text-sm leading-relaxed md:grid-cols-2">
              <InfoLine label="阵营" value={roleplay.playerFaction} />
              <InfoLine label="风评" value={roleplay.reputation} />
              <InfoLine label="世界观" value={roleplay.worldView} wide />
              <InfoLine label="补充" value={roleplay.notes || "无"} wide />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function AttributeList({ attributes }: { attributes: CharacterAttribute[] }) {
  if (attributes.length === 0) {
    return <div className="text-muted-foreground mt-3 text-sm">暂无属性。</div>;
  }
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {attributes.map((attribute) => (
        <div
          key={attribute.id}
          className="bg-muted/40 flex min-w-0 items-center gap-2 rounded px-2 py-2 text-xs"
          title={attribute.description}
        >
          <span className="min-w-0 flex-1 truncate">{attribute.name}</span>
          <span className="font-medium">{attribute.value}</span>
        </div>
      ))}
    </div>
  );
}

function TaskList({ tasks }: { tasks: RelationshipTask[] }) {
  if (tasks.length === 0) {
    return <div className="text-muted-foreground text-sm">DM 还没有派发任务。</div>;
  }
  return (
    <div className="grid gap-2">
      {tasks.map((task) => {
        const hiddenNpcRequest = task.direction === "npc_to_player";
        return (
          <div key={task.id} className="rounded-md border bg-muted/20 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{task.npcName}</span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-xs",
                  task.status === "open"
                    ? "bg-muted text-muted-foreground"
                    : task.status === "completed"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-destructive/10 text-destructive",
                )}
              >
                {task.status === "open" ? "进行中" : task.status === "completed" ? "完成" : "失败"}
              </span>
              <span className="text-muted-foreground text-xs">
                {hiddenNpcRequest ? "对方有事" : "玩家请求 NPC"}
              </span>
            </div>
            <div className="mt-1 text-sm">
              {hiddenNpcRequest
                ? task.visibleHint || `${task.npcName}似乎有什么事想和你谈。`
                : `让 ${task.npcName} 同意：${task.request}`}
            </div>
            <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {hiddenNpcRequest ? task.lore : `${task.stake} · ${task.suggestedApproach}`}
            </div>
            {task.resolution ? (
              <div className="text-muted-foreground mt-1 text-xs">结果：{task.resolution}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function InfoLine({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("grid gap-1", wide && "md:col-span-2")}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
