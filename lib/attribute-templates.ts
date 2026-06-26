import type { AttributeDefinition, CharacterAttribute } from "@/lib/chat-types";

export type AttributeTemplate = {
  id: string;
  name: string;
  description: string;
  attributes: AttributeDefinition[];
};

export const ATTRIBUTE_TEMPLATES: AttributeTemplate[] = [
  {
    id: "jrpg",
    name: "传统 JRPG",
    description: "适合职业分工、冒险队伍和成长数值清晰的语C。",
    attributes: [
      makeAttribute("hp", "生命", "承受伤害和维持行动的基础能力。", 12, "传统 JRPG"),
      makeAttribute("mp", "魔力", "施展法术、仪式或特殊能力的资源。", 10, "传统 JRPG"),
      makeAttribute("strength", "力量", "近身对抗、爆发和体能压制。", 8, "传统 JRPG"),
      makeAttribute("agility", "敏捷", "速度、闪避、身法和反应。", 8, "传统 JRPG"),
      makeAttribute("intellect", "智力", "理解复杂信息、研究和推演。", 8, "传统 JRPG"),
      makeAttribute("charm", "魅力", "说服、社交影响和舞台存在感。", 8, "传统 JRPG"),
    ],
  },
  {
    id: "soulslike",
    name: "类魂游戏",
    description: "适合危险世界、代价感、信仰和技巧差异明显的语C。",
    attributes: [
      makeAttribute("vigor", "生命力", "在伤病、诅咒和压力下撑住的能力。", 11, "类魂游戏"),
      makeAttribute("endurance", "耐力", "持续行动、负重和连续对抗能力。", 10, "类魂游戏"),
      makeAttribute("focus", "专注", "维持仪式、战技和精神稳定。", 8, "类魂游戏"),
      makeAttribute("strength", "力量", "重武器、强制突破和肉体压迫。", 9, "类魂游戏"),
      makeAttribute("dexterity", "技巧", "精密操作、轻武器和危险动作。", 9, "类魂游戏"),
      makeAttribute("faith", "信仰", "神术、誓约和超自然庇护。", 8, "类魂游戏"),
      makeAttribute("arcane", "感应", "秘术、异常现象和隐秘联系。", 8, "类魂游戏"),
    ],
  },
  {
    id: "strategy",
    name: "策略类游戏",
    description: "适合阵营对抗、政治博弈、战争调度和长期局势推进。",
    attributes: [
      makeAttribute("command", "统率", "组织队伍、指挥行动和稳定士气。", 10, "策略类游戏"),
      makeAttribute("strategy", "谋略", "布局、识破陷阱和设计反制。", 10, "策略类游戏"),
      makeAttribute("diplomacy", "外交", "谈判、结盟和处理公开关系。", 9, "策略类游戏"),
      makeAttribute("logistics", "后勤", "资源调配、补给和执行效率。", 9, "策略类游戏"),
      makeAttribute("recon", "侦察", "情报搜集、预警和追踪线索。", 8, "策略类游戏"),
      makeAttribute("discipline", "纪律", "服从计划、抗压和减少失误。", 8, "策略类游戏"),
    ],
  },
  {
    id: "management",
    name: "模拟经营游戏",
    description: "适合资源积累、组织经营、人际网络和日常压力管理。",
    attributes: [
      makeAttribute("funds", "资金", "可调动金钱、预算和物资信用。", 10, "模拟经营游戏"),
      makeAttribute("production", "生产", "制造、产出和把资源变成结果。", 9, "模拟经营游戏"),
      makeAttribute("management", "管理", "协调人员、流程和组织秩序。", 10, "模拟经营游戏"),
      makeAttribute("social", "社交", "维护人脉、安抚关系和打开渠道。", 9, "模拟经营游戏"),
      makeAttribute("creativity", "创意", "提出新方案、包装叙事和制造机会。", 8, "模拟经营游戏"),
      makeAttribute("stress", "压力", "当前心理和工作负荷，越高越危险。", 4, "模拟经营游戏"),
    ],
  },
];

export function mergeAttributeTemplates(templateIds: string[]) {
  const selected = ATTRIBUTE_TEMPLATES.filter((template) => templateIds.includes(template.id));
  const merged = new Map<string, AttributeDefinition>();

  for (const template of selected.length > 0 ? selected : [ATTRIBUTE_TEMPLATES[0]!]) {
    for (const attribute of template.attributes) {
      const existing = merged.get(attribute.id);
      if (!existing) {
        merged.set(attribute.id, { ...attribute });
        continue;
      }
      merged.set(attribute.id, {
        ...existing,
        defaultValue: Math.max(existing.defaultValue, attribute.defaultValue),
        description:
          existing.description === attribute.description
            ? existing.description
            : `${existing.description} ${attribute.description}`,
        sourceTemplates: Array.from(
          new Set([...existing.sourceTemplates, ...attribute.sourceTemplates]),
        ),
      });
    }
  }

  return {
    templates: selected.length > 0 ? selected.map((template) => template.name) : ["传统 JRPG"],
    attributes: Array.from(merged.values()),
  };
}

export function createCharacterAttributes(attributes: AttributeDefinition[]): CharacterAttribute[] {
  return attributes.map((attribute) => ({
    ...attribute,
    value: attribute.defaultValue,
  }));
}

function makeAttribute(
  id: string,
  name: string,
  description: string,
  defaultValue: number,
  sourceTemplate: string,
): AttributeDefinition {
  return {
    id,
    name,
    description,
    defaultValue,
    sourceTemplates: [sourceTemplate],
  };
}
