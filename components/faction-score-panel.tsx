"use client";

import { TrophyIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatSession, FactionSystem } from "@/lib/chat-types";

export function FactionScorePanel({
  factionSystem,
  chat,
}: {
  factionSystem: FactionSystem;
  chat?: ChatSession;
}) {
  const winningFaction = factionSystem.winningFactionId
    ? factionSystem.factions.find((faction) => faction.id === factionSystem.winningFactionId)
    : undefined;
  const latestEvent = chat?.factionScoreEvents?.at(-1);

  return (
    <section className="border-b bg-background px-3 py-2">
      <div className="mx-auto grid w-full max-w-5xl gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              阵营进度 · {factionSystem.template}
            </div>
            <div className="text-muted-foreground truncate text-xs">
              {winningFaction ? `${winningFaction.name} 已胜出` : factionSystem.description}
            </div>
          </div>
          {winningFaction ? (
            <div className="text-primary flex items-center gap-1 text-xs font-medium">
              <TrophyIcon className="size-3.5" />
              {winningFaction.name}
            </div>
          ) : null}
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {factionSystem.factions.map((faction) => {
            const progress = Math.min(100, (faction.currentScore / faction.victoryScore) * 100);
            const isWinner = faction.id === factionSystem.winningFactionId;
            return (
              <div key={faction.id} className="border-border rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-medium">{faction.name}</div>
                  <div
                    className={cn("text-xs", isWinner ? "text-primary" : "text-muted-foreground")}
                  >
                    {faction.currentScore}/{faction.victoryScore}
                  </div>
                </div>
                <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
                  <div
                    className={cn("h-full rounded-full", isWinner ? "bg-primary" : "bg-foreground")}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                  强度 {faction.strength} · {faction.victoryCondition}
                </div>
              </div>
            );
          })}
        </div>
        {latestEvent ? (
          <div className="text-muted-foreground truncate text-xs">
            最近判定：{latestEvent.summary}
          </div>
        ) : null}
      </div>
    </section>
  );
}
