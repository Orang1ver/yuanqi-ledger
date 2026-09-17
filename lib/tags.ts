/**
 * 口味 / 忌口 / 做法 / 份量 / 餐次 的标签体系。
 *
 * ⚠️ 分两部分看待：
 *
 * 1) `label` 与 `key` 是**数据契约**。它们会被写进用户记录里
 *    （`MealRecord.flavorTags` / `avoidTags` / `methodTags` / `portionPreset`），
 *    改动等于把老数据变成读不出来的垃圾。除非同时做数据迁移，否则不要动。
 *
 * 2) `description` 与 `promptHint` 是**文案**，不落库。
 *    `description` 给用户看，`promptHint` 是喂给模型的指令片段 ——
 *    两者分开，改文案就不会顺带动摇模型行为。
 */

export type TagDef = {
  /** 标签本身。会被写进用户记录，属于数据契约，不要改 */
  label: string;
  /** 给用户看的一句话解释，不落库 */
  description: string;
  /** 喂给模型的指令片段，不落库。改它会影响模型行为，改 description 不会 */
  promptHint: string;
};

export const FLAVOR_TAGS: TagDef[] = [
  { label: "清淡", description: "调味很轻，吃的是食材本身", promptHint: "做法以白灼、清蒸、水煮为主，油和盐都收着放，别用重味酱料" },
  { label: "麻辣", description: "川渝那一口，麻和辣都要有", promptHint: "花椒与辣椒可以一起用，麻和辣两种感觉都得吃出来，不能只剩辣" },
  { label: "微辣", description: "想有点辣味，但别上头", promptHint: "少量辣椒或胡椒提个味即可，辣不能成为主调" },
  { label: "酸辣", description: "酸味和辣味一起上来，开胃", promptHint: "醋、泡椒、柠檬这类酸味食材，配少量辣味调料" },
  { label: "甜口", description: "偏南方家常的甜", promptHint: "适当放糖，或者挑南瓜、玉米、番茄这类自带甜味的食材" },
  { label: "咸鲜", description: "咸味打底，鲜要够", promptHint: "用生抽、蚝油、菌菇提鲜，咸度别过头" },
  { label: "少油", description: "油要少放", promptHint: "蒸、煮、烤优先，尽量不煎不炸" },
  { label: "少盐", description: "盐要收着放", promptHint: "少用酱料，靠食材本味和天然香辛料来调味" },
];

export const AVOID_TAGS: TagDef[] = [
  { label: "不吃香菜", description: "有香菜就不吃", promptHint: "菜名、做法和摆盘里都不能出现香菜，香菜末这类碎料也不行" },
  { label: "不吃葱姜蒜", description: "葱姜蒜一律不要", promptHint: "蒜末、姜丝、葱花这类藏在配料表里的也要排除，不能漏" },
  { label: "不吃辣", description: "一点辣都不吃", promptHint: "辣椒花椒全都不要用；与麻辣/微辣/酸辣三个口味互斥，不能同时选" },
  { label: "无乳制品", description: "牛奶、奶酪、黄油都不行", promptHint: "需要用奶的地方换成植物奶或橄榄油，换不了的菜直接不做" },
  { label: "无麸质", description: "小麦、大麦、黑麦都要避开", promptHint: "面粉、面条、面包不能出现，主食换成米饭、米粉或杂粮" },
  { label: "素食", description: "不吃肉，也不吃海鲜", promptHint: "肉类、海鲜、禽类都排除；蛋和奶是否可吃以用户备注为准，没写就按蛋奶素处理" },
];

export const METHOD_TAGS: TagDef[] = [
  {
    label: "火锅",
    description: "边涮边吃，配锅底和蘸料",
    promptHint: "围着一口锅吃，清汤或麻辣都合适；天一冷就很合适，也适合把冰箱里零散的食材一次用掉",
  },
  { label: "香煎", description: "少油煎到两面金黄，把汁水锁住", promptHint: "适合肉、豆腐、煎蛋；口味偏西式，可以搭海盐黑胡椒或椒盐" },
  { label: "清蒸", description: "原味为主，营养和清淡口感都留得住", promptHint: "适合鱼、蔬菜、蛋羹；油盐都低，身体不太舒服的时候也吃得下" },
  { label: "凉拌", description: "生吃或焯过水再冷调味", promptHint: "天热时或赶时间时好用，不用开火，吃起来清爽" },
  { label: "炖煮", description: "小火慢慢炖透", promptHint: "适合根茎类蔬菜和带骨肉，汤头会更浓；暖胃，天冷时合适" },
  { label: "烧烤", description: "明火或烤箱烤，外焦里嫩", promptHint: "适合肉类，以及一部分耐烤的蔬菜" },
  { label: "快炒", description: "大火快翻，脆嫩不丢", promptHint: "适合绿叶菜和嫩肉片，出餐快，是日常最常用的做法" },
  { label: "烘焙", description: "烤箱里烤出来的点心", promptHint: "适合面点和甜品" },
  { label: "不限", description: "不指定做法", promptHint: "由 AI 结合食材、当前场景和历史饮食习惯自己决定" },
];

export type PortionPresetKey =
  | "1人食-盖饭"
  | "1人食-小火锅"
  | "1人食-1菜1汤"
  | "家常-2菜1汤"
  | "丰盛"
  | "自定义";

export const PORTION_PRESETS: { key: PortionPresetKey; label: string; description: string }[] = [
  { key: "1人食-盖饭", label: "1人食·盖饭", description: "一个菜铺在饭上做成盖饭，一人份，最省事" },
  { key: "1人食-小火锅", label: "1人食·小火锅", description: "单人小锅，食材不用多，图个方便和热乎" },
  { key: "1人食-1菜1汤", label: "1人食·1菜1汤", description: "一个主菜配一个汤，一个人吃也不将就" },
  { key: "家常-2菜1汤", label: "家常·2菜1汤", description: "家里饭桌最常见的样子：两个炒菜加一个汤" },
  { key: "丰盛", label: "丰盛", description: "三到四道菜，荤素汤都有，适合聚餐或犒劳自己" },
  { key: "自定义", label: "自定义", description: "自己定做几道" },
];

/** 互斥组：组内任一项被选中，组内其余项在 UI 上禁用 */
export const MUTUAL_EXCLUSION_GROUPS: string[][] = [["不吃辣", "麻辣", "微辣", "酸辣"]];

export const MEAL_SLOTS = ["早餐", "午餐", "晚餐", "加餐"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const DISH_ROLES = ["主菜", "主食", "汤", "甜品", "小菜"] as const;
export type DishRole = (typeof DISH_ROLES)[number];

/** 常用食材的默认清单（首次使用时播种，之后完全由用户掌握） */
export const DEFAULT_INGREDIENTS = ["鸡胸肉", "西兰花", "米饭", "鸡蛋", "番茄", "豆腐", "猪肉", "青菜"];

/**
 * 调料 / 厨房常备清单：默认假设用户家里都有，所以不会出现在购物清单里。
 *
 * 用「包含匹配」而不是精确匹配 —— 模型很可能写成「葱花」「姜丝」「生抽一勺」这类变体。
 * 因此这里的词可以写得宽松些，宁可多匹配一点，也别让"家里明明有的东西"混进购物清单。
 */
export const SEASONING_KEYWORDS = [
  // 基础调味
  "盐", "糖", "白糖", "冰糖", "醋", "酱油", "生抽", "老抽", "蚝油", "料酒", "黄酒", "味精", "鸡精", "鸡粉",
  // 油类
  "油", "食用油", "橄榄油", "香油", "麻油", "猪油", "菜籽油",
  // 香辛料
  "葱", "姜", "蒜", "葱花", "姜丝", "姜片", "蒜末", "蒜蓉", "香菜", "胡椒", "黑胡椒", "白胡椒",
  "花椒", "辣椒粉", "辣椒面", "干辣椒", "八角", "香叶", "桂皮", "孜然", "五香粉", "咖喱粉", "十三香",
  // 酱料
  "豆瓣酱", "甜面酱", "番茄酱", "沙拉酱", "芝麻酱", "辣椒酱", "老干妈", "糖醋汁", "照烧汁", "蒸鱼豉油",
  // 其他增稠 / 点缀
  "淀粉", "生粉", "芝麻", "白芝麻", "熟芝麻", "柠檬", "青柠",
];

export function isSeasoning(label: string): boolean {
  return SEASONING_KEYWORDS.some((kw) => label.includes(kw));
}

export function findTagDef(label: string): TagDef | undefined {
  return [...FLAVOR_TAGS, ...AVOID_TAGS, ...METHOD_TAGS].find((t) => t.label === label);
}
