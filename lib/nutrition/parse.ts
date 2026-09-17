/**
 * 中文口语的**浅解析**（P1 范围）。
 *
 * 只做一件事：把「晚上吃了一包薯片」这样的片段，切成
 * `{ 数量, 量词, 食物名 }` 三个可直接查表的部分。
 *
 * 刻意不做的事（P2 才做）：歧义消解、跨句指代、LLM 兜底、单位换算的常识推理。
 * 这里的规则是**零成本、可离线**的第一层，覆盖「数量 + 量词 + 食物名」这一高频形态即可。
 *
 * ⚠️ 这里是纯字符串处理，**不产生任何营养数字**。数字只能由 core.ts 从库里算出来。
 */

/** 与 data/foodPortions.json 的 unit 保持一致的量词表 */
export const PORTION_UNITS = [
  "包", "袋", "盒", "杯", "瓶", "罐", "听", "碗", "盘", "份",
  "个", "根", "只", "片", "块", "勺", "串", "把", "条", "扎", "桶",
];

/** 数量词：中文数字 + 「半」。「两」比「二」在口语里常见得多，两个都要认 */
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5,
};

/**
 * 句子开头的噪音：时间词、主语、动词、模糊限定词。
 *
 * 不剥掉它们，`一包薯片` 前面挂个「晚上吃了」就会整段匹配失败，
 * 最后退化成按分类兜底的一个拍脑袋克数 —— 而用户明明把份量说清楚了。
 *
 * ⚠️ 顺序有意义：长词必须排在短词前面（「吃了」要在「吃」之前），
 * 否则「吃了」会被剥成「了」。
 */
const LEAD_NOISE = [
  "早上", "早晨", "上午", "中午", "下午", "傍晚", "晚上", "夜里", "夜宵", "凌晨",
  "今天", "昨天", "刚刚", "刚才", "然后", "后来",
  "我", "吃了个", "喝了个", "吃了", "喝了", "来了个", "点了", "买了", "来了",
  "吃", "喝",
  "大概", "差不多", "约",
];

const FRAGMENT_RE = new RegExp(
  `^([0-9]+(?:\\.[0-9]+)?|[一二两三四五六七八九十半])?\\s*([${PORTION_UNITS.join("")}])?\\s*(.+)$`,
);

/** 明确写了重量/体积：用户自己称过，优先级最高 */
const WEIGHT_RE = /([0-9]+(?:\.[0-9]+)?)\s*(克|g|G|ml|mL|ML|毫升)/;

/** 按中英文逗号、顿号、分号、空白切段 */
export function splitFragments(text: string): string[] {
  return text
    .split(/[，,、;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 反复剥掉开头的噪音词，直到没有可剥的为止（「晚上吃了」要剥两次） */
export function stripLeadNoise(fragment: string): string {
  let out = fragment.trim();
  for (let guard = 0; guard < 10; guard += 1) {
    const hit = LEAD_NOISE.find((t) => out.startsWith(t));
    if (!hit) break;
    out = out.slice(hit.length).trim();
  }
  return out;
}

export type ParsedFragment = {
  /** 原文 */
  raw: string;
  /** 剥掉噪音后、真正用来匹配的部分。展示给用户看，便于解释「为什么这样算」 */
  cleaned: string;
  amount: number;
  unit?: string;
  name: string;
};

/**
 * 解析一个片段。**只认第一个量词出现的形态**，不做更复杂的组合。
 *
 * 例：
 *   「晚上吃了一包薯片」 → { amount: 1, unit: "包", name: "薯片" }
 *   「两个鸡蛋」         → { amount: 2, unit: "个", name: "鸡蛋" }
 *   「薯片 70 克」       → { amount: 70, unit: "克", name: "薯片" }
 *   「奶茶」             → { amount: 1, unit: undefined, name: "奶茶" }
 */
export function parseFragment(raw: string): ParsedFragment {
  const cleaned = stripLeadNoise(raw);

  const weight = cleaned.match(WEIGHT_RE);
  if (weight) {
    return {
      raw,
      cleaned,
      amount: Number(weight[1]),
      unit: "克",
      name: cleaned.replace(weight[0], "").trim(),
    };
  }

  const m = cleaned.match(FRAGMENT_RE);
  if (m) {
    const [, numToken, unit, name] = m;
    return {
      raw,
      cleaned,
      amount: numToken ? (CN_NUM[numToken] ?? Number(numToken)) : 1,
      unit: unit || undefined,
      name: (name ?? "").trim(),
    };
  }

  return { raw, cleaned, amount: 1, name: cleaned };
}
