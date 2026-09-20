/**
 * 申请把「我的食物库」里的一条提交进正式库 —— **只生成文本和 URL，不联网**。
 *
 * 为什么是纯函数：这一层的产出有两条出路（GitHub Issue / 邮件），
 * 而两条出路的**失败方式不同**（URL 太长、没有默认邮件客户端、用户没点 Submit）。
 * 把这些都留给 UI 层处理，这里只负责"把该说的说全"。
 *
 * 三条刻意的选择：
 *
 * 1) **模板里把入库需要的字段一次写全。** 少一个字段开发者就要来回问一轮，
 *    而用户多半不会为了一条食物去回邮件。所以份量、原始 kJ、校验结果都预先填上。
 *
 * 2) **不夹带任何个人数据。** 这份申请里只有食物本身 + app 版本 + 校验结论。
 *    没有饮食记录、没有 Key、没有照片、没有健康档案。
 *    ⚠️ 唯一会离开设备的是**收件邮箱地址**（用户自己提供的），
 *    而它会被写进公开仓库 —— 所以 UI 上必须提示（见 ContributeSheet / T7）。
 *
 * 3) **URL 长度自己先算。** 浏览器和 GitHub 各有上限，超了会**静默截断**
 *    （用户看到的是一个残缺的 Issue 草稿，还以为提交成功了）。
 *    所以这里给出长度，让 UI 能提前降级成"复制文本 + 打开空白页"。
 */

import type { FoodItem } from "../nutrition/types";

/**
 * 各渠道的 URL 长度上限。
 *
 * ⚠️ 三者里**浏览器的最紧**（2000 是业界普遍遵守的老数字）。
 * GitHub 与 MUA 本身容忍度更高，但 URL 终究要过浏览器这一关 ——
 * 所以实际判定用 `min(browser, 渠道自己的上限)`，见 `limitFor`。
 */
export const URL_LIMITS = {
  /** 主流浏览器地址栏的实际上限（IE 时代的老数字，但各家都还守） */
  browser: 2000,
  /** GitHub 的 `?body=` 预填在长文本上会被截断。它自己的容忍度高于浏览器 */
  github: 6000,
  /** mailto 也是 URL，各家 MUA 的容忍度不同 */
  mailto: 1800,
} as const;

/** 某个渠道的**实际**上限 = 渠道上限与浏览器上限的较小者 */
export function limitFor(channel: keyof typeof URL_LIMITS): number {
  return Math.min(URL_LIMITS.browser, URL_LIMITS[channel]);
}

/** 入库申请要带的元信息 */
export type ContributeMeta = {
  /** app 版本（`CHANGELOG[0].version`），方便开发者对口径 */
  appVersion: string;
  /** 校验结论的原文，如「算术闭合 0.4% · NRV 核对通过」 */
  verdict?: string;
  /** 原始标示（照片上是 kJ 时留着，方便对方复核换算） */
  energyKj?: number;
  /** 常见份量（可选，用于补份量表） */
  portion?: string;
  /** 用户自己写的备注 */
  note?: string;
};

/** 数值来源怎么说 —— 必须是这两句之一，不许含糊 */
function originOf(food: FoodItem): string {
  return food.source.includes("AI 估算")
    ? "AI 估算（仅凭外观推测，不可核对）"
    : "包装营养成分表拍照读取";
}

/**
 * 拼出完整的申请文本。
 *
 * 格式照工单预设的模板（已含入库所需的全部字段）。
 * 空字段留空而不是省略 —— 留空本身就是信息（"这项没有"）
 */
export function buildFoodRequest(food: FoodItem, meta: ContributeMeta): string {
  const alias = (food.alias ?? []).join("、");
  const kj = meta.energyKj !== undefined ? `（原始标示 ${meta.energyKj} kJ）` : "";
  // 钠没数据时写成「钠（无数据）」。⚠️ 别用模板换行拼 —— 会多出一个空格，
  // 让下游按 "钠 xxx mg" 去解析的人（包括测试）对不上。
  const sodium = food.sodium === undefined ? "钠（无数据）" : `钠 ${food.sodium} mg`;

  return [
    "【食物入库申请】",
    "",
    `食物名：${food.name}          别名：${alias}`,
    `分类：${food.category}              单位：${food.unit}`,
    `每 100 的数值：热量 ${food.kcal} kcal${kj}、蛋白 ${food.protein} g、脂肪 ${food.fat} g、碳水 ${food.carb} g、${sodium}`,
    `数值来源：${originOf(food)}`,
    `校验结果：${meta.verdict ?? "（未做校验）"}`,
    `常见份量：${meta.portion ?? "（未填）"}`,
    `备注：${meta.note ?? "（无）"}              app 版本：${meta.appVersion}`,
    "",
    "（这条是从「我的食物库」里点「申请进正式库」生成的。提交前请确认上面的数字。）",
  ].join("\n");
}

/**
 * GitHub Issue 新建页，预填标题与正文。**仍需用户亲手点 Submit**。
 *
 * 标题从正文里那行「食物名：xxx」抠出来 —— 比让调用方再传一次名字可靠，
 * 也保证标题与正文不会说不一致的话。
 */
export function githubIssueUrl(req: string): string {
  const line = req.split("\n").find((l) => l.startsWith("食物名：")) ?? "";
  // 去掉前缀，再砍掉后面那截「          别名：…」
  const name = line.replace(/^食物名：/, "").split(/\s{2,}/)[0]?.trim() || "未命名食物";
  return `https://github.com/Orang1ver/yuanqi-ledger/issues/new?title=${encodeURIComponent(
    `【食物入库申请】${name}`,
  )}&body=${encodeURIComponent(req)}`;
}

/**
 * 邮件草稿链接。
 *
 * ⚠️ 它只是**打开邮件草稿**，不会自动发送 —— 用户得自己按发送。
 * UI 上必须说清这件事，否则用户以为点了就发出去了。
 */
export function mailtoUrl(req: string, to: string): string {
  const subject = "【元气账本】食物入库申请";
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(req)}`;
}

/** 这条 URL 会不会被截断 */
export function urlTooLong(url: string, limit: number): boolean {
  return url.length > limit;
}
