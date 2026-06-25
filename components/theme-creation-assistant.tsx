"use client";

import { useMemo, useState } from "react";
import { CheckIcon, SendIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { RoleplayTopicProfile } from "@/lib/chat-types";

type BuilderMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

type ThemeCreationAssistantProps = {
  onCancel: () => void;
  onCreated: (chatId: string) => void;
};

const WORLD_OPTIONS = [
  {
    value: "宫廷奇幻",
    description: "王权、贵族、法师、边境战争与古老盟约交织。",
  },
  {
    value: "现代王室",
    description: "媒体、议会、财阀、外交危机与王室私生活都在聚光灯下。",
  },
  {
    value: "末日王国",
    description: "灾变后的城邦秩序，资源、军队、信仰和幸存者互相牵制。",
  },
  {
    value: "星际帝国",
    description: "舰队、殖民星、贵族院、AI 政务与星际叛乱构成权力舞台。",
  },
  {
    value: "架空权谋",
    description: "低魔或无魔的架空大陆，宫廷派系、密探和诸侯同台博弈。",
  },
];

const REPUTATION_OPTIONS = [
  { value: "严肃的女王", description: "威严克制，讲秩序和责任，臣民敬畏多于亲近。" },
  { value: "风流的女王", description: "魅力强、绯闻多，善用情感和社交作为权力工具。" },
  { value: "暴君女王", description: "手段强硬，敌人畏惧，追随者相信只有你能保住王国。" },
  { value: "改革者女王", description: "挑战旧贵族和旧制度，被年轻人拥护，也被保守派仇视。" },
  { value: "神秘的女王", description: "很少公开露面，传闻、仪式和秘密组织围绕着你。" },
  { value: "丑闻缠身的女王", description: "继位、血统、私情或旧案不断被人拿出来攻击。" },
];

const NPC_PERSONA_TEMPLATES = [
  "独身大学生，晚上活跃，语C经验不多但很愿意配合群规。",
  "经常上网的中年大叔，爱看历史和权谋贴，说话直接但不油腻。",
  "夜班社畜，碎片时间很多，喜欢扮演有压力但能办事的角色。",
  "同人写手，擅长补细节和关系张力，偏爱戏剧冲突。",
  "手游重度玩家，熟悉阵营、养成和战斗设定，喜欢有明确目标的角色。",
  "潜水多年群友，话不多但观察细，倾向选择能长期埋线的角色。",
  "跑团主持人，重视世界观自洽，喜欢选择能推动事件的角色。",
  "古风圈老玩家，熟悉宫廷礼仪和派系暗线，喜欢细腻互动。",
];

const NPC_COUNT_OPTIONS = [1, 3, 5, 8];

const makeId = () => Math.random().toString(36).slice(2, 10);

const makeAssistantMessage = (content: string): BuilderMessage => ({
  id: makeId(),
  role: "assistant",
  content,
});

const makeUserMessage = (content: string): BuilderMessage => ({
  id: makeId(),
  role: "user",
  content,
});

const pickPersonaTemplates = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => NPC_PERSONA_TEMPLATES[index % NPC_PERSONA_TEMPLATES.length]!,
  );

export function ThemeCreationAssistant({ onCancel, onCreated }: ThemeCreationAssistantProps) {
  const createRoleplayTopic = useChatWorkspaceStore((state) => state.createRoleplayTopic);
  const [messages, setMessages] = useState<BuilderMessage[]>([
    makeAssistantMessage("你想开一个什么语C群？先告诉我你想扮演谁。比如：我想扮演女王。"),
  ]);
  const [step, setStep] = useState<"role" | "world" | "reputation" | "notes" | "review">("role");
  const [input, setInput] = useState("");
  const [npcCount, setNpcCount] = useState(3);
  const [profile, setProfile] = useState<RoleplayTopicProfile>({
    playerRole: "",
    worldView: "",
    reputation: "",
    notes: "",
  });

  const summary = useMemo(() => {
    const title = `${profile.playerRole || "玩家角色"}的${profile.worldView || "语C"}群`;
    const description = [
      `世界观：${profile.worldView}`,
      `群主角色：${profile.playerRole}`,
      `群主风评：${profile.reputation}`,
      profile.notes ? `补充设定：${profile.notes}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");

    return { title, description, groupTitle: title };
  }, [profile]);

  const append = (...nextMessages: BuilderMessage[]) => {
    setMessages((current) => [...current, ...nextMessages]);
  };

  const submitRole = () => {
    const value = input.trim();
    if (!value) return;
    setInput("");
    setProfile((current) => ({ ...current, playerRole: value }));
    append(
      makeUserMessage(value),
      makeAssistantMessage("这个世界是什么样的？你可以直接选一个方向，后面还能补充细节。"),
    );
    setStep("world");
  };

  const chooseWorld = (value: string) => {
    setProfile((current) => ({ ...current, worldView: value }));
    append(
      makeUserMessage(`我选择${value}`),
      makeAssistantMessage("你的风评怎么样？这会影响其他玩家靠近你的方式。"),
    );
    setStep("reputation");
  };

  const chooseReputation = (value: string) => {
    setProfile((current) => ({ ...current, reputation: value }));
    append(makeUserMessage(`我选择${value}`), makeAssistantMessage("还有其他想补充的吗？"));
    setStep("notes");
  };

  const submitNotes = () => {
    const value = input.trim();
    setInput("");
    const nextProfile = { ...profile, notes: value || "没有额外补充。" };
    setProfile(nextProfile);
    append(
      makeUserMessage(value || "没有额外补充。"),
      makeAssistantMessage("我先总结成群设定。你审核一下，确认后我会创建群聊并开始找其他玩家。"),
    );
    setStep("review");
  };

  const approve = () => {
    const result = createRoleplayTopic({
      title: summary.title,
      description: summary.description,
      roleplay: profile,
      groupTitle: summary.groupTitle,
      personaTemplates: pickPersonaTemplates(npcCount),
    });
    onCreated(result.chatId);
  };

  return (
    <div className="bg-background flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">主题创建助手</div>
          <div className="text-muted-foreground truncate text-xs">像开群一样创建语C世界</div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="关闭">
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[82%] rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-line",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {message.content}
              </div>
            </div>
          ))}

          {step === "world" ? <OptionGrid options={WORLD_OPTIONS} onChoose={chooseWorld} /> : null}
          {step === "reputation" ? (
            <OptionGrid options={REPUTATION_OPTIONS} onChoose={chooseReputation} />
          ) : null}
          {step === "review" ? (
            <div className="border-border bg-muted/40 grid gap-4 rounded-lg border p-4">
              <div className="grid gap-1">
                <div className="text-sm font-semibold">{summary.title}</div>
                <div className="text-muted-foreground whitespace-pre-line text-sm">
                  {summary.description}
                </div>
              </div>
              <div className="grid gap-2">
                <div className="text-sm font-medium">寻找其他玩家数量</div>
                <div className="flex flex-wrap gap-2">
                  {NPC_COUNT_OPTIONS.map((count) => (
                    <Button
                      key={count}
                      type="button"
                      size="sm"
                      variant={npcCount === count ? "default" : "outline"}
                      onClick={() => setNpcCount(count)}
                    >
                      {count} 位
                    </Button>
                  ))}
                </div>
              </div>
              <Button type="button" className="w-fit gap-2" onClick={approve}>
                <CheckIcon className="size-4" />
                同意并创建群聊
              </Button>
            </div>
          ) : null}
        </div>

        {(step === "role" || step === "notes") && (
          <form
            className="border-t p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (step === "role") submitRole();
              if (step === "notes") submitNotes();
            }}
          >
            <div className="bg-muted/60 border-border flex items-end gap-2 rounded-2xl border p-2">
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={step === "role" ? "我想扮演..." : "补充设定，或留空发送"}
                className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                autoFocus
              />
              <Button type="submit" size="icon" className="shrink-0 rounded-full">
                <SendIcon className="size-4" />
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function OptionGrid({
  options,
  onChoose,
}: {
  options: Array<{ value: string; description: string }>;
  onChoose: (value: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChoose(option.value)}
          className="border-border hover:bg-accent/70 grid gap-1 rounded-lg border px-3 py-2 text-left transition-colors"
        >
          <span className="text-sm font-medium">{option.value}</span>
          <span className="text-muted-foreground text-xs leading-relaxed">
            {option.description}
          </span>
        </button>
      ))}
    </div>
  );
}
