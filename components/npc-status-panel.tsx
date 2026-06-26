"use client";

import type { ReactNode } from "react";
import { CheckIcon, PackagePlusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { AiParticipant, CharacterAttribute, Topic } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

const SHOP_ITEMS = [
  { name: "情报筹码", description: "可在剧情中解释为一次情报、人脉或线索资源。" },
  { name: "关系礼物", description: "可用于强化一次社交接近、示好或补偿。" },
  { name: "临时资源", description: "可解释为物资、预算、通行便利或一次行动准备。" },
];

export function NpcStatusPanel({
  topic,
  participants,
}: {
  topic: Topic;
  participants: AiParticipant[];
}) {
  const completeNpcTask = useChatWorkspaceStore((state) => state.completeNpcTask);
  const enhanceNpcAttribute = useChatWorkspaceStore((state) => state.enhanceNpcAttribute);
  const buyNpcShopItem = useChatWorkspaceStore((state) => state.buyNpcShopItem);
  const npcs = participants.filter((participant) => typeof participant.points === "number");
  const playerAttributes = topic.roleplay?.playerAttributes ?? [];

  if (!topic.roleplay || (npcs.length === 0 && playerAttributes.length === 0)) return null;

  return (
    <div className="border-b bg-background">
      <div className="grid max-h-72 gap-3 overflow-y-auto px-4 py-3 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,2fr)]">
        {playerAttributes.length > 0 ? (
          <div className="border-border rounded-md border p-3">
            <div className="text-sm font-semibold">{topic.roleplay.playerRole} · 玩家属性</div>
            <AttributeList attributes={playerAttributes} />
          </div>
        ) : null}
        {npcs.length > 0 ? (
          <div className="grid gap-2">
            {npcs.map((npc) => {
              const points = npc.points ?? 0;
              return (
                <div key={npc.id} className="border-border rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{npc.name}</span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs font-medium",
                        npc.status === "left"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {npc.status === "left" ? "已离群" : `积分 ${points}`}
                    </span>
                    {npc.faction ? (
                      <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                        {npc.faction}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {npc.personalGoal || npc.gamePersona || npc.role}
                  </div>
                  {npc.attributes?.length ? (
                    <div className="mt-3">
                      <AttributeList
                        attributes={npc.attributes}
                        action={(attribute) => (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-6"
                            disabled={points < 5 || npc.status === "left"}
                            onClick={() => enhanceNpcAttribute(npc.id, attribute.id)}
                            title="消耗 5 积分强化"
                          >
                            <PlusIcon className="size-3.5" />
                          </Button>
                        )}
                      />
                    </div>
                  ) : null}
                  {npc.tasks?.length ? (
                    <div className="mt-3 grid gap-1.5">
                      {npc.tasks.map((task) => (
                        <div
                          key={task.id}
                          className="bg-muted/40 flex items-center gap-2 rounded px-2 py-1.5 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {task.type === "faction" ? "阵营" : "个人"} · {task.title}
                          </span>
                          <span className="text-muted-foreground">+{task.rewardPoints}</span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-6"
                            disabled={task.status === "completed" || npc.status === "left"}
                            onClick={() => completeNpcTask(npc.id, task.id)}
                            title="标记完成并发放积分"
                          >
                            <CheckIcon className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {SHOP_ITEMS.map((item) => (
                      <Button
                        key={item.name}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 rounded-md px-2 text-xs"
                        disabled={points < 3 || npc.status === "left"}
                        onClick={() => buyNpcShopItem(npc.id, item)}
                      >
                        <PackagePlusIcon className="size-3.5" />
                        {item.name}
                      </Button>
                    ))}
                    {npc.inventory?.map((item) => (
                      <span
                        key={item.id}
                        className="bg-muted text-muted-foreground rounded px-1.5 py-1 text-xs"
                        title={item.description}
                      >
                        {item.name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AttributeList({
  attributes,
  action,
}: {
  attributes: CharacterAttribute[];
  action?: (attribute: CharacterAttribute) => ReactNode;
}) {
  return (
    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
      {attributes.map((attribute) => (
        <div
          key={attribute.id}
          className="bg-muted/40 flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-xs"
          title={attribute.description}
        >
          <span className="min-w-0 flex-1 truncate">{attribute.name}</span>
          <span className="font-medium">{attribute.value}</span>
          {action?.(attribute)}
        </div>
      ))}
    </div>
  );
}
