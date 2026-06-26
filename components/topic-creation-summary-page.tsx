"use client";

import { CheckCircle2Icon } from "lucide-react";
import { FactionScorePanel } from "@/components/faction-score-panel";
import type { Topic } from "@/lib/chat-types";

export function TopicCreationSummaryPage({ topic }: { topic: Topic }) {
  const roleplay = topic.roleplay;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-6">
        <section className="grid gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2Icon className="size-4" />
            主题创建助手
          </div>
          <div className="text-2xl font-semibold">{topic.title}</div>
          <div className="text-muted-foreground whitespace-pre-line text-sm leading-relaxed">
            {topic.description || "这个主题创建时没有额外摘要。"}
          </div>
        </section>

        {roleplay ? (
          <>
            <section className="grid gap-3 rounded-md border p-4">
              <div className="text-sm font-semibold">玩家角色</div>
              <Info label="扮演" value={roleplay.playerRole} />
              <Info label="世界观" value={roleplay.worldView} />
              <Info label="风评" value={roleplay.reputation} />
              <Info label="补充" value={roleplay.notes || "无"} />
            </section>

            <section className="overflow-hidden rounded-md border">
              <FactionScorePanel factionSystem={roleplay.factionSystem} />
            </section>

            <section className="grid gap-2 rounded-md border p-4">
              <div className="text-sm font-semibold">属性模板</div>
              <div className="text-muted-foreground text-xs">
                {roleplay.attributeSystem.templates.join("、")}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {roleplay.attributeSystem.attributes.map((attribute) => (
                  <div key={attribute.id} className="rounded border bg-muted/20 px-3 py-2 text-sm">
                    <div className="font-medium">{attribute.name}</div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      默认 {attribute.defaultValue} · {attribute.description}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm leading-relaxed">{value}</div>
    </div>
  );
}
