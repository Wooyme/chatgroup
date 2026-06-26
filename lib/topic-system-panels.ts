export type TopicSystemPanel = "welcome" | "topic-creation" | "recruitment";

const PREFIX = "system:";

export const getTopicSystemPanelId = (topicId: string, panel: TopicSystemPanel) =>
  `${PREFIX}${topicId}:${panel}`;

export const parseTopicSystemPanelId = (
  id: string,
): { topicId: string; panel: TopicSystemPanel } | undefined => {
  if (!id.startsWith(PREFIX)) return undefined;
  const value = id.slice(PREFIX.length);
  const separatorIndex = value.lastIndexOf(":");
  if (separatorIndex === -1) return undefined;
  const topicId = value.slice(0, separatorIndex);
  const panel = value.slice(separatorIndex + 1);
  if (panel !== "welcome" && panel !== "topic-creation" && panel !== "recruitment") {
    return undefined;
  }
  return { topicId, panel };
};
