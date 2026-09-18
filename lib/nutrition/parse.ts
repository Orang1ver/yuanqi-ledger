/**
 * 中文口语的**浅解析**。
 *
 * 只做一件事：把「晚上吃了一包薯片」这样的片段，切成
 * `{ 数量, 量词, 食物名 }` 三个可直接查表的部分。
 *
 * 刻意不做的事（留给 LLM 层）：歧义消解、跨句指代、单位换算的常识推理。
 * 这里的规则是**零成本、可离线**的第一层，覆盖「数量 + 量词 + 食物名」这一高频形态即可。
 *
 * ⚠️ 这里是纯字符串处理，**不产生任何营养数字**。数字只能由 core.ts 从库里算出来。
 *
 * ⚠️ 三条踩过的坑，改这个文件前先读（都会导致**静默算错**，而不是报错）：
 *
 * 1. **「数量 + 量词」与「明确克数」可以同时出现。**
 *    「一包 70g 的薯片」里 `70g` 被当成唯一的份量依据、`一包` 被留进食物名，
 *    于是查库失败 → 退化成按分类兜底的拍脑袋克数。
 *    现在这种形态拆成 `{ amount: 1, unit: "包", perUnitGrams: 70 }`，两个信息都用上。
 *
 * 2. **空白会把一个片段切碎。**
 *    `splitFragments` 原本按空白切，于是「薯片 70 克」变成
 *    `["薯片", "70", "克"]` 三段 —— 第一段「薯片」没有份量、走兜底，
 *    后两段又凑不出食物名。`parseFragment` 明明支持这种写法，却永远轮不到它。
 *    所以切段之前先 `glueMeasures()` 把「数量/克数/单位」之间的空白粘掉。
 *
 * 3. **正则回溯会在食物名里留下量词残渣。**
 *    「一包」这种只有量词没有食物的输入，正则会把 `包` 留作食物名，
 *    而模糊检索会把它配成**任意一个含该字的食物**（实测命中「肉包」200g）。
 *    用户嘴里的一包薯片，账本上记成 200g 肉包 —— 全错且没有任何提示。
 *    所以：量词残渣一律归位成 `unit`，食物名留空；单字不做模糊检索（见 quickadd）。
 */

/** 与 data/foodPortions.json 的 unit 保持一致的量词表 */
export const PORTION_UNITS = [
  "包", "袋", "盒", "杯", "瓶", "罐", "听", "碗", "盘", "份",
  "个", "根", "只", "片", "块", "勺", "串", "把", "条", "扎", "桶",
];

/** 量词集合：用来识别「名字其实是个量词」这种被正则回溯切出来的残渣 */
const PORTION_UNIT_SET = new Set(PORTION_UNITS);
const UNIT_CLASS = PORTION_UNITS.join("");

/** 数量词：中文数字 + 「半」。「两」比「二」在口语里常见得多，两个都要认 */
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5,
};

const NUM = "[0-9]+(?:\\.[0-9]+)?";

/**
 * 中文数量词的**词形**（不是单字字符类）。
 *
 * ⚠️ 这里必须整词匹配，不能再退回 `[一二两三四五六七八九十半]` 那种单字类：
 * 单字类匹配「十五个饺子」时只吃下「十」，剩下的「五」被当成食物名的一部分 ——
 * 实测结果是把 **15 个饺子算成 10 份（2000g）**，比真实值大六倍多，而且**一声不吭**。
 * 静默算错是这个模块最不能犯的错（见文件头）。
 *
 * 刻意**只认到两位数**（十 / 十五 / 二十 / 二十五）：
 * 「两三」「三四」这类约数连写是另一个语义（取中值还是保守值要单独定），
 * 让它在这里被含糊地加起来（「两三」→ 5）不如不认 —— 那是 P5.4 的事。
 */
const CN_NUM_WORD = "(?:[一二两三四五六七八九]?十[一二两三四五六七八九]?|[一二两三四五六七八九半])";

/**
 * 中文数量词 → 数字。认不出来返回 null（**绝不猜**）。
 *
 * 认不出来时必须返回 null 而不是 0 或 NaN：调用方据此退回「整串当食物名」，
 * 而 NaN 会一路写进 `DietEntry.amount`，变成账本里一个谁也解释不了的数。
 */
function cnToNumber(word: string): number | null {
  if (word === "半") return 0.5;
  const at = word.indexOf("十");
  if (at === -1) {
    // 没有「十」时只认单字：「两三」这种连写落在这里，返回 null 而不是 5
    return word.length === 1 ? (CN_NUM[word] ?? null) : null;
  }
  const head = word.slice(0, at);
  const tail = word.slice(at + 1);
  const tens = head === "" ? 1 : (CN_NUM[head] ?? null);
  const ones = tail === "" ? 0 : (CN_NUM[tail] ?? null);
  if (tens === null || ones === null) return null;
  return tens * 10 + ones;
}

/** 数量词统一入口：阿拉伯数字直接转，中文走 cnToNumber */
function amountOf(token: string): number {
  const n = cnToNumber(token);
  return n ?? Number(token);
}

/**
 * 「自己称过」的单位。
 * ⚠️ 必须**长词在前**：否则 `kg` 会被 `k` + `g` 吃成「克」，`毫升` 会被单字截断。
 */
const MEASURE_ALT = "千克|公斤|毫升|克|kg|KG|Kg|ML|mL|ml|g|G";

/**
 * 句子开头的噪音：时间词、主语、动词、模糊限定词。
 *
 * 不剥掉它们，`一包薯片` 前面挂个「晚上吃了」就会整段匹配失败，
 * 最后退化成按分类兜底的一个拍脑袋克数 —— 而用户明明把份量说清楚了。
 *
 * ⚠️ 顺序有意义：长词必须排在短词前面（「吃了」要在「吃」之前），
 * 否则「吃了」会被剥成「了」。
 *
 * ⚠️ **绝不能把量词写进噪音词。** 这里曾经有「吃了个」「喝了个」三条，
 * 本意是处理「吃了个苹果」，结果**把量词「个」一起剥掉了**：
 * 「吃了个苹果」→「苹果」→ 解析成"没写份量"→ 按分类兜底 200g 并标成「份」。
 * 而份量表里明明有 `个[苹果] = 200g`。
 * 后果是**克数碰巧对、单位是错的**（界面显示「200 份」），而且被标成估算 ——
 * 这种"看起来对"的错最难发现。
 * 正确做法是只剥动词：「吃了」+「个苹果」，量词留给 `FRAGMENT_RE` 去认。
 */
const LEAD_NOISE = [
  "早上", "早晨", "上午", "中午", "下午", "傍晚", "晚上", "夜里", "夜宵", "凌晨",
  "今天", "昨天", "刚刚", "刚才", "然后", "后来",
  "我", "吃了", "喝了", "来了", "点了", "买了",
  "吃", "喝",
  "大概", "差不多", "约",
];

const FRAGMENT_RE = new RegExp(
  `^(${NUM}|${CN_NUM_WORD})?\\s*([${UNIT_CLASS}])?\\s*(.+)$`,
);

/**
 * 「数量 + 量词 + 明确克数 + 食物名」：一包70g的薯片 / 两包70g薯片 / 1袋100克的薯片
 *
 * ⚠️ 「数量 + 量词」必须是**成对出现、且不可省略**的一组，不能两边各自可选。
 * 各自可选时 `70克薯片` 会走这条路并被回溯成「数量 7 + 克数 0」——不报错，直接算出 0g。
 * 而如果只把"成对"做成可选组，`70克薯片` 又会掉进来被解释成「1 × 70g」，
 * `amount` 从 70 变成 1 —— 语义上等价，但记录里会显示成「1 克 · 70g」，读起来是错的。
 * 所以这条路**只在真的说了份量时才走**；纯克数的形态交给下面 WEIGHT_RE / TRAILING_RE。
 */
const COMBINED_RE = new RegExp(
  `^(${NUM}|${CN_NUM_WORD})\\s*([${UNIT_CLASS}])\\s*(${NUM})\\s*(?:${MEASURE_ALT})\\s*的?\\s*(.+)$`,
);

/** 「食物名 + 尾随克数」：薯片70克 / 薯片 70 克 */
const TRAILING_RE = new RegExp(`^(.+?)\\s*(${NUM})\\s*(?:${MEASURE_ALT})\\s*$`);

/** 明确写了重量/体积：用户自己称过，优先级最高 */
const WEIGHT_RE = /([0-9]+(?:\.[0-9]+)?)\s*(克|g|G|ml|mL|ML|毫升)/;

/**
 * 把「数量 / 克数 / 单位」之间的空白粘掉，免得切段时被切散。
 *
 * 只处理**带数量词的那几种组合** —— 纯中文量词之间不动，
 * 这样「一包薯片 一杯奶茶」仍然能按空白切成两段（用户确实是这么写的）。
 */
export function glueMeasures(text: string): string {
  return (
    text
      // 「70 克」→「70克」
      .replace(new RegExp(`(${NUM})\\s+(${MEASURE_ALT})`, "g"), "$1$2")
      // 「15 个饺子」→「15个饺子」。
      // ⚠️ 这一条是补上来的：上面那条只认**度量单位**（克/g/ml），不认**量词**（个/包/杯），
      // 于是「15 个饺子」被空白切成 ["15", "个饺子"] 两段 ——
      // 前一段解析出一个叫「5」的食物（界面上就是「「5」· 库里没有」），
      // 后一段只剩「1 个饺子」。用户明明说了 15 个，账本上记成 20g。
      .replace(new RegExp(`(${NUM}|${CN_NUM_WORD})\\s+(?=[${UNIT_CLASS}])`, "g"), "$1")
      // 「一包 70g」→「一包70g」
      .replace(new RegExp(`((?:${NUM}|${CN_NUM_WORD})[${UNIT_CLASS}])\\s+(?=${NUM})`, "g"), "$1")
      // 「70g 的薯片」→「70g的薯片」
      .replace(new RegExp(`(${NUM}(?:${MEASURE_ALT}))\\s+(?=的)`, "g"), "$1")
      // 「薯片 70克」→「薯片70克」；「500ml 奶茶」→「500ml奶茶」
      .replace(new RegExp(`([\\u4e00-\\u9fa5])\\s+(?=${NUM}(?:${MEASURE_ALT}))`, "g"), "$1")
      .replace(new RegExp(`(${NUM}(?:${MEASURE_ALT}))\\s+(?=[\\u4e00-\\u9fa5])`, "g"), "$1")
  );
}

/** 按中英文逗号、顿号、分号、空白切段（切之前先把被空白打散的份量粘回来） */
export function splitFragments(text: string): string[] {
  return glueMeasures(text)
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

/** 清掉食物名里残留的连接词与空白：「的薯片」→「薯片」 */
function tidyName(s: string): string {
  return s.replace(/^的/, "").replace(/[\s\u3000]+/g, "").trim();
}

export type ParsedFragment = {
  /** 原文 */
  raw: string;
  /** 剥掉噪音后、真正用来匹配的部分。展示给用户看，便于解释「为什么这样算」 */
  cleaned: string;
  amount: number;
  unit?: string;
  name: string;
  /**
   * 每个单位有多少克 —— 用户既说了份量又说了克数时才给（「一包70g的薯片」）。
   * 有它就意味着**用户自己称过**，不必再查份量表。
   */
  perUnitGrams?: number;
};

/**
 * 解析一个片段。
 *
 * 例：
 *   「晚上吃了一包薯片」   → { amount: 1, unit: "包", name: "薯片" }
 *   「吃了个苹果」         → { amount: 1, unit: "个", name: "苹果" }（「吃了」剥掉，量词留着）
 *   「两个鸡蛋」           → { amount: 2, unit: "个", name: "鸡蛋" }
 *   「一包 70g 的薯片」    → { amount: 1, unit: "包", name: "薯片", perUnitGrams: 70 }
 *   「薯片 70 克」         → { amount: 70, unit: "克", name: "薯片" }
 *   「一包」               → { amount: 1, unit: "包", name: "" }（只有量词，没说是吃什么）
 *   「奶茶」               → { amount: 1, unit: undefined, name: "奶茶" }
 */
export function parseFragment(raw: string): ParsedFragment {
  const cleaned = stripLeadNoise(raw);

  // 1) 数量 + 量词 + 明确克数，三者同时出现：「一包 70g 的薯片」
  const combo = cleaned.match(COMBINED_RE);
  if (combo) {
    const [, cnt, unit, grams, name] = combo;
    const nameOut = tidyName(name ?? "");
    const per = Number(grams);
    // per 必须为正：0 克是"把数字吃掉了"，不是用户的意思，宁可退回下面几条路
    if (nameOut && per > 0) {
      return {
        raw,
        cleaned,
        amount: cnt ? amountOf(cnt) : 1,
        unit: unit || undefined,
        name: nameOut,
        perUnitGrams: per,
      };
    }
  }

  // 2) 食物名 + 尾随克数：「薯片 70 克」
  const trailing = cleaned.match(TRAILING_RE);
  if (trailing) {
    const nameOut = tidyName(trailing[1]);
    if (nameOut) {
      return { raw, cleaned, amount: Number(trailing[2]), unit: "克", name: nameOut };
    }
  }

  // 3) 克数写在前面或中间：「70克薯片」「70g 的薯片」
  const weight = cleaned.match(WEIGHT_RE);
  if (weight) {
    const nameOut = tidyName(cleaned.replace(weight[0], ""));
    if (nameOut) {
      return { raw, cleaned, amount: Number(weight[1]), unit: "克", name: nameOut };
    }
  }

  const m = cleaned.match(FRAGMENT_RE);
  if (m) {
    const [, numToken, unit, name] = m;
    let nameOut = (name ?? "").trim();
    let unitOut = unit || undefined;

    // ⚠️ 正则回溯的残渣：「一包」会被切成 { unit: undefined, name: "包" }，
    // 然后「包」被模糊检索配成任意含该字的食物（实测「肉包」200g）。
    // 量词就该归位成量词，食物名留空让上层说清楚「没读出食物名」。
    if (!unitOut && PORTION_UNIT_SET.has(nameOut) && nameOut.length === 1) {
      unitOut = nameOut;
      nameOut = "";
    }

    return {
      raw,
      cleaned,
      amount: numToken ? amountOf(numToken) : 1,
      unit: unitOut,
      name: nameOut,
    };
  }

  /*
   * 只剩一个光杆量词（「个」「包」）。
   * 上面那条正则的 `(.+)` 要求至少一个字符，所以「个」匹配不上、会掉到这里的最后一行，
   * 把量词本身当成食物名 —— 于是界面上会说「库里没有『个』」，读起来莫名其妙。
   * 量词归位成量词、名字留空，上层就能给出「只有份量、没说是吃什么」这句有用的话。
   */
  if (PORTION_UNIT_SET.has(cleaned) && cleaned.length === 1) {
    return { raw, cleaned, amount: 1, unit: cleaned, name: "" };
  }

  return { raw, cleaned, amount: 1, name: cleaned };
}
