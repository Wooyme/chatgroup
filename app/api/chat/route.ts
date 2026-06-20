import { frontendTools } from "@assistant-ui/react-ai-sdk";
import { convertToModelMessages, type JSONSchema7, streamText, type UIMessage } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { TopicContext } from "@/lib/chat-types";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const buildSystemPrompt = (
  baseSystem: string | undefined,
  topicContext: TopicContext | undefined,
) => {
  const parts = [baseSystem?.trim()].filter(Boolean) as string[];
  if (!topicContext) return parts.join("\n\n") || undefined;

  const topicDescription = topicContext.topic.description.trim();
  parts.push(
    [
      `当前主题：${topicContext.topic.title}`,
      topicDescription ? `主题说明：${topicDescription}` : undefined,
      `当前会话：${topicContext.chat.title}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (topicContext.chat.mode === "group") {
    const participants = topicContext.chat.participants
      .map(
        (participant, index) =>
          `${index + 1}. ${participant.name}（${participant.role}）：${participant.systemPrompt}`,
      )
      .join("\n");

    parts.push(
      [
        "你正在模拟一个多 AI 角色群聊，所有角色都与玩家进行语C互动。",
        "用户每次发言后，按下列角色顺序依次回复。",
        participants,
        "输出要求：",
        "- 每个角色使用 `**角色名**` 开头。",
        "- 每个角色只回复一段，观点要互相承接，避免重复。",
        "- 始终保持每个角色的人设、口吻、视角和情绪一致性。",
        "- 只输出角色发言，不要解释你在模拟群聊，不要替玩家发言。",
      ].join("\n"),
    );
  } else {
    const participant = topicContext.chat.participants[0];
    if (participant) {
      parts.push(
        [
          `你正在与玩家进行一对一语C互动。你必须扮演：${participant.name}。`,
          `角色定位：${participant.role}`,
          `角色提示词：${participant.systemPrompt}`,
          "回复要求：",
          "- 始终保持该角色的口吻、视角和情绪一致性。",
          "- 直接回应玩家，不要跳出角色解释系统设定。",
          "- 可以主动推进互动，但不要替玩家做决定或代替玩家发言。",
        ].join("\n"),
      );
    } else {
      parts.push("你是该主题下的 AI 助手。结合主题背景回答，保持直接、具体、可执行。");
    }
  }

  return parts.join("\n\n");
};

export async function POST(req: Request) {
  const {
    messages,
    system,
    tools,
    topicContext,
  }: {
    messages: UIMessage[];
    system?: string;
    tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
    topicContext?: TopicContext;
  } = await req.json();

  const result = streamText({
    model: openrouter.chat("x-ai/grok-4.3"),
    messages: await convertToModelMessages(messages),
    system: buildSystemPrompt(system, topicContext),
    tools: {
      ...frontendTools(tools ?? {}),
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
}
