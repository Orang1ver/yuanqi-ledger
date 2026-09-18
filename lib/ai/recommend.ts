/**
 * 「帮我挑」—— 让模型从**用户自己的菜单库**里挑几道菜（纯 TS，不含 UI）。
 *
 * ⚠️ 这个文件存在的全部意义，是**把模型的权力关在一个很小的笼子里**：
 *
 *   模型只做两件事：**从给定清单里选出哪几项** + **给一句不含数字的措辞**。
 *   它不产生任何营养数字 —— 热量、区间、克数一律由本地的 `estimateDish()`
 *   在**返回之后**重新算一遍，模型说什么都不影响那几个数。
 *
 * 为什么值得这样小题大做：模型一旦吐出数字，屏幕上就多了一个**无法审计的第二数字来源**。
 * 用户会拿它当账算，而它没有任何查表依据。项目从第一版起就把"数字只有一条来路"
 * 当作红线（见 AGENTS.md 第 3 节、`lib/nutrition/core.ts` 头部注释）。
 *
 * 笼子由三道锁组成，缺一不可：
 *   1) **prompt 里不给它数字**（缺口用 `findIssues` 的定性 `hint`，不是「还差 1800mg」），
 *      并明令不许输出数字 —— 不给它复述的材料，也不给它复述的许可。
 *   2) **回答用序号**（`1.` `2.` `3.`）而不是菜名 —— 序号必须落在候选范围内，
 *      于是白名单过滤变成一次下标越界检查，没有"名字长得像"的模糊空间。
 *   3) **数字在返回后由本地重算**（`pickDishesForGaps` 的最后一步），
 *      并再对模型那句理由做一遍去数字清洗（防止它硬写）。
 *
 * 本层不许 import UI / Next / localStorage：Key 由调用方传入。
 */

import type { TakeoutDish } from "../types";
import { findIssues } from "../nutrition/advice";
import { estimateDish, type MenuNutrition } from "../nutrition/menu";
import type { DietEntry, NutritionTargets, NutritionTotals } from "../nutrition/types";
import { chatJSON, type ChatMessage, type ChatJSONInput } from "./deepseek";

/**
 * 一次最多塞给模型多少道菜。
 *
 * 不是性能问题，是**注意力**问题：菜单库几百道菜时，模型对榜单末尾的菜
 * 基本等于没看见，而 prompt 还白白变长。真到几百道菜的规模，
 * 该做的是先按口味/品类缩小范围，而不是把整库怼进去。
 */
const MAX_CANDIDATES = 120;

/** 挑几道。用户拍到 2~3 道，超过 3 条就不是"帮我挑"而是"给我一份菜单"了 */
const DEFAULT_LIMIT = 3;

/** 一句理由的字数上限（写进 prompt 的要求） */
const REASON_MAX_CHARS = 20;

/** 菜单里能参与挑选的一道菜 */
export type PickCandidate = {
  id: string;
  name: string;
  restaurant: string;
};

/**
 * 模型的原始回答（**未过滤**）。字段全是 unknown：
 * 它是从网络上下来的一段 JSON，在过白名单之前不配拥有类型。
 */
export type RawPick = { index?: unknown; name?: unknown; reason?: unknown };

/** 过了白名单的一条挑选结果。注意：**这里还没有任何营养数字** */
export type AiPickRef = {
  dishId: string;
  name: string;
  restaurant: string;
  /** 模型那句话，已去掉数字；清洗后什么都不剩时是空串 */
  reason: string;
};

/**
 * 一道**估得出来**的菜。
 *
 * 刻意把 `none` 摘掉：候选池（`pickableDishes`）本来就只收估得出的菜，
 * 所以这个类型让"选了一道估不出来的菜"在编译期就不可能 ——
 * 界面上也就永远不会出现一行「估不出来 kcal」这种既没信息又难看的输出。
 */
export type EstimatedDish = Exclude<MenuNutrition, { kind: "none" }>;

/** 最终给界面用的一条：模型的措辞 + **本地算出来**的估算 */
export type AiPick = AiPickRef & {
  estimate: EstimatedDish;
};

/**
 * 能参与挑选的菜：**估得出成分**、且不与忌口冲突。
 *
 * 估不出成分的菜不进池子 —— 挑出来也没法告诉用户它大概多少热量，
 * 等于让模型推荐一个本地说不清的东西（和首页那张卡同一个口径）。
 */
export function pickableDishes(
  dishes: readonly TakeoutDish[],
  avoid: readonly string[] = [],
): PickCandidate[] {
  const out: PickCandidate[] = [];
  for (const d of dishes) {
    if (d.avoidConflicts.some((a) => avoid.includes(a))) continue;
    if (estimateDish(d).kind === "none") continue;
    out.push({ id: d.id, name: d.name, restaurant: d.restaurant });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * 今天偏了哪几项 —— **纯定性，一个数字都没有**。
 *
 * 直接复用 `findIssues`：那里已经写好了「不足型结论要等今天吃得差不多了才说」
 * 这条规矩（`daySettled`）。这里另写一套阈值的话，迟早出现
 * 「建议卡说钠偏高、给模型的 prompt 说钠正常」这种自相矛盾。
 */
export function gapHints(input: {
  entries: readonly DietEntry[];
  totals: NutritionTotals;
  targets: NutritionTargets;
}): string[] {
  return findIssues(input).map((i) => i.hint);
}

/** 今天还没吃够、也没偏项时，别让模型按"缺口"挑 —— 缺口本身还不成立 */
const NOT_SETTLED_HINT = "今天还没记到能判断缺口的程度，挑几道有菜有蛋白、做法清淡点儿的就行";

function listCandidates(candidates: readonly PickCandidate[]): string {
  return candidates.map((c, i) => `${i + 1}. ${c.name}（${c.restaurant}）`).join("\n");
}

/**
 * 组装 prompt（纯函数，可单测）。
 *
 * 分工刻意分得很硬：
 *  - `system` 只放**规矩**（只许从清单挑、只回序号、一个数字都不许写）
 *  - `user` 只放**事实**（今天偏了什么、要避开什么、有哪些菜）
 */
export function buildPickMessages(input: {
  candidates: readonly PickCandidate[];
  hints: readonly string[];
  avoid?: readonly string[];
}): ChatMessage[] {
  const { candidates, hints, avoid = [] } = input;

  const system = [
    "你是一个点餐助手，帮一个人从他自己的外卖菜单里挑今天该点的菜。",
    "",
    "必须遵守：",
    `1. 只能从下面给出的菜单里挑，最多 ${DEFAULT_LIMIT} 道，按推荐顺序排列。`,
    "2. 回答里只写菜单前面的**序号**，不要写菜名。",
    "3. 理由里**一个数字都不许出现**，也不许提到热量、克数、毫克、百分比、价格、份量",
    "   这些东西 —— 只说口感和做法，以及今天别的吃得怎么样。",
    `4. 每道菜配一句不超过 ${REASON_MAX_CHARS} 字的理由。`,
    "5. 只输出 JSON，格式：{\"picks\":[{\"index\":1,\"reason\":\"……\"}]}",
  ].join("\n");

  const user = [
    "【这个人今天的情况】",
    hints.length ? hints.map((h) => `- ${h}`).join("\n") : `- ${NOT_SETTLED_HINT}`,
    "",
    "【要避开的】",
    avoid.length ? avoid.join("、") : "无",
    "",
    `【他的菜单】（只能从这里挑，回答用序号）`,
    listCandidates(candidates),
    "",
    "现在请挑出最该点的几道，只回 JSON。",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * 子句里出现这些就整句丢掉。
 *
 * 覆盖三类写法：阿拉伯/全角数字、营养单位（哪怕没跟数字，比如"热量单位 kcal"）、
 * 中文数字 + 单位（"三百克"这种最容易漏）。
 * 不直接丢整句话，是为了保住它同一句里那句有用的措辞。
 */
const NUMERIC_CLAIM =
  /[0-9０-９]|大卡|千卡|卡路里|千焦|kcal|KCAL|Kcal|kJ|毫克|毫升|mg|ml|[一二三四五六七八九十百千万两]+(?:克|卡|焦|毫升|毫克)/;

/**
 * 把模型那句理由里**带数字的子句**整段摘掉。
 *
 * 这是第二道防线（第一道是 prompt 里明令禁止）。刻意不用"把数字替换成空"那种做法 ——
 * 「只有 320kcal」会变成「只有 kcal」，读起来像句坏掉的话，还不如整句不要。
 *
 * 清洗后剩不下什么（不足两个字）就返回空串，界面据此不显示理由那一行 ——
 * 宁可不显示，也不要显示一句被削得莫名其妙的话。
 * 阈值取 2 而不是更长：「清淡」「顶饱」「有菜」这种两字理由是有信息量的，
 * 而真要只剩一个「约」字，那确实该丢。
 */
export function sanitizeReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // 按标点切子句但保留标点，方便原样拼回去
  const clauses = raw.split(/([，,。；;！!？?、\n])/);
  const kept: string[] = [];
  for (const c of clauses) {
    if (NUMERIC_CLAIM.test(c)) continue;
    kept.push(c);
  }
  const out = kept
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^[\s，,。；;、！!？?]+|[\s，,。；;、]+$/g, "")
    .trim();
  return out.length >= 2 ? out : "";
}

/** 从模型返回里把数组取出来。它可能包在 picks / dishes / items 里，也可能直接是数组 */
function pickArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  for (const key of ["picks", "dishes", "items", "result"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  return [];
}

/** 序号：接受 number，也接受 "2" 这种字符串。1-based，越界即无效 */
function asIndex(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * 白名单过滤 —— 模型说了不算，**候选清单说了算**。
 *
 * 三条规则：
 *  - 序号越界 / 名字对不上 → 丢弃（模型编了一道菜单里没有的菜，就当作它没说）
 *  - 同一道菜出现两次 → 只留第一次
 *  - 超过 limit 条 → 截断
 *
 * 名字这一路是给"模型不听话、还是回了菜名"兜底的，精确匹配才认：
 * 菜单库里同名菜（不同商家）取最先出现的那条 —— 这是库内既定顺序，不是随机挑。
 */
export function parsePicks(
  raw: unknown,
  candidates: readonly PickCandidate[],
  limit: number = DEFAULT_LIMIT,
): AiPickRef[] {
  const out: AiPickRef[] = [];
  const seen = new Set<string>();

  for (const item of pickArray(raw)) {
    if (out.length >= limit) break;
    if (!item || typeof item !== "object") continue;
    const p = item as RawPick;

    let hit: PickCandidate | undefined;
    const idx = asIndex(p.index);
    if (idx !== null) {
      hit = idx <= candidates.length ? candidates[idx - 1] : undefined;
    } else if (typeof p.name === "string") {
      const needle = p.name.trim();
      hit = candidates.find((c) => c.name === needle);
    }
    if (!hit || seen.has(hit.id)) continue;

    seen.add(hit.id);
    out.push({
      dishId: hit.id,
      name: hit.name,
      restaurant: hit.restaurant,
      reason: sanitizeReason(p.reason),
    });
  }

  return out;
}

export type PickInput = {
  apiKey: string;
  entries: readonly DietEntry[];
  totals: NutritionTotals;
  targets: NutritionTargets;
  dishes: readonly TakeoutDish[];
  /** 健康档案里的忌口标签（逐字命中，见 WhatToEatCard 的说明） */
  avoid?: readonly string[];
  limit?: number;
  /** 仅供测试注入 */
  fetchImpl?: typeof fetch;
};

/**
 * 跑一次「帮我挑」。
 *
 * 顺序是有讲究的：**先本地筛候选 → 再问模型 → 最后本地算数字**。
 * 第三步用的是原始 `dishes` 而不是模型返回的任何字段，
 * 所以「营养数字只有一条来路」在这条路径上是**结构上成立**的，
 * 不依赖"记得别用模型给的数"这种自觉。
 *
 * 失败一律抛错（`chatJSON` 的约定），由界面去降级到本地 `suggestForGaps`。
 */
export async function pickDishesForGaps(input: PickInput): Promise<AiPick[]> {
  const { dishes, avoid = [], limit = DEFAULT_LIMIT } = input;
  const candidates = pickableDishes(dishes, avoid);
  if (!candidates.length) return [];

  const messages = buildPickMessages({
    candidates,
    hints: gapHints({ entries: input.entries, totals: input.totals, targets: input.targets }),
    avoid,
  });

  const transport: ChatJSONInput = { apiKey: input.apiKey, messages };
  if (input.fetchImpl) transport.fetchImpl = input.fetchImpl;
  const raw = await chatJSON<unknown>(transport);

  const refs = parsePicks(raw, candidates, limit);
  const byId = new Map(dishes.map((d) => [d.id, d]));
  return refs.map((r) => {
    const dish = byId.get(r.dishId) as TakeoutDish;
    // 这里的断言是安全的：能进 candidates 的菜，`pickableDishes` 已经用
    // 同一个 `estimateDish` 判过「不是 none」。数字仍然全部来自这一次本地调用。
    return { ...r, estimate: estimateDish(dish) as EstimatedDish };
  });
}
