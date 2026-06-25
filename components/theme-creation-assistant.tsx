"use client";

import { useMemo, useState } from "react";
import { CheckIcon, SendIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useChatWorkspaceStore } from "@/lib/chat-store";
import type { FactionSystem, RoleplayTopicProfile } from "@/lib/chat-types";

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
  { value: "宫廷奇幻", description: "王权、贵族、法师、边境战争与古老盟约交织。" },
  { value: "现代王室", description: "媒体、议会、财阀、外交危机与王室私生活都在聚光灯下。" },
  { value: "末日王国", description: "灾变后的城邦秩序，资源、军队、信仰和幸存者互相牵制。" },
  { value: "星际帝国", description: "舰队、殖民星、贵族院、AI 政务与星际叛乱构成权力舞台。" },
  { value: "架空权谋", description: "低魔或无魔的架空大陆，宫廷派系、密探和诸侯同台博弈。" },
];

const FACTION_TEMPLATES = [
  {
    value: "善良邪恶对立",
    description: "光明盟约、暗影阵线和中立者围绕秩序、诱惑与牺牲对抗。",
  },
  {
    value: "多个政治立场的斗争",
    description: "王权派、议会派、军方派、改革派围绕制度和权力重分配博弈。",
  },
  {
    value: "种族/物种间的斗争",
    description: "不同族群、边境共同体和排外势力争夺生存空间与话语权。",
  },
  {
    value: "多神的代理战争",
    description: "不同神系通过信徒、圣物、神谕和战争代理人争夺时代走向。",
  },
  {
    value: "阶级与资源冲突",
    description: "贵族/资本、平民组织、黑市网络和技术官僚争夺资源分配。",
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

const EMPTY_FACTION_SYSTEM: FactionSystem = {
  template: "",
  description: "",
  factions: [],
};

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
  const [step, setStep] = useState<
    | "role"
    | "world"
    | "factionTemplate"
    | "factionDraft"
    | "playerFaction"
    | "reputation"
    | "notes"
    | "review"
  >("role");
  const [input, setInput] = useState("");
  const [factionNote, setFactionNote] = useState("");
  const [isGeneratingFaction, setIsGeneratingFaction] = useState(false);
  const [npcCount, setNpcCount] = useState(3);
  const [profile, setProfile] = useState<RoleplayTopicProfile>({
    playerRole: "",
    worldView: "",
    playerFaction: "",
    factionSystem: EMPTY_FACTION_SYSTEM,
    reputation: "",
    notes: "",
  });

  const summary = useMemo(() => {
    const title = `${profile.playerRole || "玩家角色"}的${profile.worldView || "语C"}群`;
    const description = [
      `世界观：${profile.worldView}`,
      `阵营模板：${profile.factionSystem.template}`,
      `玩家阵营：${profile.playerFaction}`,
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
      makeAssistantMessage(
        "这个群的阵营冲突是什么类型？选一个模板后，我会拟一版强度、胜利条件和关键节点。",
      ),
    );
    setStep("factionTemplate");
  };

  const chooseFactionTemplate = async (value: string) => {
    append(makeUserMessage(`阵营模板选${value}`), makeAssistantMessage("我先拟一版阵营草案。"));
    setStep("factionDraft");
    await updateFactionDraft(value, "");
  };

  const updateFactionDraft = async (template: string, note: string) => {
    setIsGeneratingFaction(true);
    try {
      const factionSystem = await generateFactionSystem({
        playerRole: profile.playerRole,
        worldView: profile.worldView,
        template,
        note,
        current: profile.factionSystem.factions.length > 0 ? profile.factionSystem : undefined,
      });
      setProfile((current) => ({ ...current, factionSystem }));
      append(
        makeAssistantMessage(
          `阵营草案已更新。\n${formatFactionSystemBrief(factionSystem)}\n\n你可以继续补充，也可以使用这版。`,
        ),
      );
    } catch {
      const fallback = makeFallbackFactionSystem(template);
      setProfile((current) => ({ ...current, factionSystem: fallback }));
      append(
        makeAssistantMessage(
          `模型生成失败，我先给一版可编辑草案。\n${formatFactionSystemBrief(fallback)}`,
        ),
      );
    } finally {
      setIsGeneratingFaction(false);
      setFactionNote("");
    }
  };

  const acceptFactionDraft = () => {
    append(
      makeUserMessage("阵营草案确认"),
      makeAssistantMessage("你的角色属于哪个阵营？这会影响 NPC 和主群冲突关系。"),
    );
    setStep("playerFaction");
  };

  const choosePlayerFaction = (value: string) => {
    setProfile((current) => ({ ...current, playerFaction: value }));
    append(
      makeUserMessage(`我的阵营是${value}`),
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
          {step === "factionTemplate" ? (
            <OptionGrid options={FACTION_TEMPLATES} onChoose={chooseFactionTemplate} />
          ) : null}
          {step === "factionDraft" ? (
            <div className="border-border bg-muted/40 grid gap-4 rounded-lg border p-4">
              <FactionSystemSummary factionSystem={profile.factionSystem} />
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="faction-note">
                  补充或修改阵营设定
                </label>
                <textarea
                  id="faction-note"
                  className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:ring-[3px]"
                  value={factionNote}
                  placeholder="例如：暗影阵线已经夺取北境圣物；王权派开局强度更高；胜利条件改成控制三座要塞。"
                  onChange={(event) => setFactionNote(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isGeneratingFaction || !profile.factionSystem.template}
                  onClick={() =>
                    updateFactionDraft(profile.factionSystem.template, factionNote.trim())
                  }
                >
                  {isGeneratingFaction ? "DM 正在更新..." : "让 DM 更新草案"}
                </Button>
                <Button
                  type="button"
                  disabled={isGeneratingFaction || profile.factionSystem.factions.length === 0}
                  onClick={acceptFactionDraft}
                >
                  使用这版阵营
                </Button>
              </div>
            </div>
          ) : null}
          {step === "playerFaction" ? (
            <OptionGrid
              options={profile.factionSystem.factions.map((faction) => ({
                value: faction.name,
                description: `${faction.description} 当前 ${faction.currentScore}/${faction.victoryScore}`,
              }))}
              onChoose={choosePlayerFaction}
            />
          ) : null}
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
              <FactionSystemSummary factionSystem={profile.factionSystem} />
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

function FactionSystemSummary({ factionSystem }: { factionSystem: FactionSystem }) {
  if (factionSystem.factions.length === 0) {
    return (
      <div className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
        阵营草案尚未生成。
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <div className="text-sm font-semibold">{factionSystem.template}</div>
        <div className="text-muted-foreground text-sm">{factionSystem.description}</div>
      </div>
      <div className="grid gap-2">
        {factionSystem.factions.map((faction) => (
          <div key={faction.id} className="border-border bg-background rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{faction.name}</span>
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                强度 {faction.strength}
              </span>
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                {faction.currentScore}/{faction.victoryScore}
              </span>
            </div>
            <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {faction.description}
            </div>
            <div className="mt-2 text-xs leading-relaxed">
              <span className="font-medium">胜利条件：</span>
              {faction.victoryCondition}
            </div>
            <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
              已发生：{faction.pastMilestones.join("、") || "无"}；关键节点：
              {faction.futureMilestones.join("、") || "待定"}
            </div>
          </div>
        ))}
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

async function generateFactionSystem({
  playerRole,
  worldView,
  template,
  note,
  current,
}: {
  playerRole: string;
  worldView: string;
  template: string;
  note: string;
  current?: FactionSystem;
}) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseMode: "text",
      system: [
        "你是语C群的主持人/DM，正在和群主创建阵营系统。",
        "你要提出阵营强度、初始分数、叙事影响力、胜利条件、已发生关键节点和未来关键节点。",
        "强度是 1-5 的整数，同时影响初始分数和叙事地位。",
        "必须返回严格 JSON，不要 Markdown，不要解释。",
      ].join("\n"),
      prompt: [
        `群主角色：${playerRole}`,
        `世界观：${worldView}`,
        `阵营模板：${template}`,
        current ? `当前草案：${JSON.stringify(current)}` : undefined,
        note ? `玩家补充/修改：${note}` : undefined,
        "请生成 3-5 个阵营。每个阵营字段：id、name、description、strength、initialScore、currentScore、victoryScore、victoryCondition、pastMilestones、futureMilestones、narrativeInfluence。",
        "currentScore 必须等于 initialScore。victoryScore 默认 100，除非设定需要可在 80-150 之间调整。",
        '返回格式：{"template":"...","description":"...","factions":[...]}',
      ]
        .filter(Boolean)
        .join("\n\n"),
    }),
  });
  if (!response.ok) throw new Error("faction generation failed");
  const payload = (await response.json()) as { text?: string };
  return normalizeFactionSystem(payload.text ?? "", template);
}

function normalizeFactionSystem(text: string, fallbackTemplate: string): FactionSystem {
  const parsed = parseJsonObject(text);
  const factions = Array.isArray(parsed.factions) ? parsed.factions : [];
  if (factions.length === 0) throw new Error("missing factions");
  return {
    template: getString(parsed.template) || fallbackTemplate,
    description: getString(parsed.description) || `${fallbackTemplate}阵营冲突。`,
    factions: factions.slice(0, 5).map((raw, index) => {
      const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const strength = clampNumber(item.strength, 1, 5, 3);
      const initialScore = clampNumber(item.initialScore, 0, 100, strength * 10);
      return {
        id: getString(item.id) || `faction_${index + 1}`,
        name: getString(item.name) || `阵营${index + 1}`,
        description: getString(item.description) || "待补充。",
        strength,
        initialScore,
        currentScore: clampNumber(item.currentScore, 0, 150, initialScore),
        victoryScore: clampNumber(item.victoryScore, 50, 200, 100),
        victoryCondition: getString(item.victoryCondition) || "率先完成核心目标。",
        pastMilestones: getStringArray(item.pastMilestones),
        futureMilestones: getStringArray(item.futureMilestones),
        narrativeInfluence: getString(item.narrativeInfluence) || "影响力普通。",
      };
    }),
  };
}

function makeFallbackFactionSystem(template: string): FactionSystem {
  const names =
    template === "善良邪恶对立"
      ? ["光明盟约", "暗影阵线", "中立调停者"]
      : template === "多个政治立场的斗争"
        ? ["王权派", "议会派", "军方派", "民间改革派"]
        : template === "种族/物种间的斗争"
          ? ["人类诸国", "异族联盟", "边境共同体", "排外派"]
          : template === "多神的代理战争"
            ? ["秩序神系", "丰饶神系", "战争神系", "虚无神系"]
            : ["贵族资本集团", "工会平民组织", "黑市网络", "技术官僚"];
  return {
    template,
    description: `${template}下的多方阵营正在争夺局势主导权。`,
    factions: names.map((name, index) => ({
      id: `faction_${index + 1}`,
      name,
      description: `${name}正在寻找扩大影响力的机会。`,
      strength: 3,
      initialScore: 30,
      currentScore: 30,
      victoryScore: 100,
      victoryCondition: "率先完成核心目标并取得局势主导权。",
      pastMilestones: ["局势已经进入公开竞争阶段"],
      futureMilestones: ["争取关键盟友", "控制关键资源", "赢得公开事件"],
      narrativeInfluence: "拥有中等资源、声望和行动能力。",
    })),
  };
}

function formatFactionSystemBrief(factionSystem: FactionSystem) {
  return factionSystem.factions
    .map(
      (faction) =>
        `${faction.name}：强度${faction.strength}，${faction.currentScore}/${faction.victoryScore}。胜利条件：${faction.victoryCondition}`,
    )
    .join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("missing json");
  const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("invalid json");
  return parsed as Record<string, unknown>;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim())
    : [];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
