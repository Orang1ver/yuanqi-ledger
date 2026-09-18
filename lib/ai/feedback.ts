/**
 * 「这个数不对？」—— 把用户的质疑交给模型做**归因**。
 *
 * ⚠️ 红线（与「帮我挑」同一条）：**它一个营养数字都不产生。**
 * 模型只做两件事：
 *   1) 判断这个质疑能不能用**已有信息**解释清楚（份量按什么算的、数值来源是什么、口径写没写）；
 *   2) 解释不了时，写一段**能直接贴到 GitHub issue 的反馈文本**。
 * 屏幕上所有数字仍由本地算（`lib/nutrition/`），模型说的话只是措辞。
 *
 * ⚠️ 第二件事是刻意的：这个 App 是**纯前端、没有服务端**，
 * 所以根本没有"把反馈传回开发者"这条路。能做的是**把上下文整理成人能贴的一段话**，
 * 让用户自己去开 issue。与其假装有个上传按钮，不如把这段文本写清楚。
 */

import { chatJSON, type ChatMessage } from "./deepseek";

/** 反馈入口的地址。仓库是公开的，issue 谁都能开。 */
export const ISSUE_URL = "https://github.com/Orang1ver/yuanqi-ledger/issues/new";

/**
 * 喂给模型的这一笔上下文。
 *
 * ⚠️ **刻意不带健康档案、也不带其它记录** —— 质疑的是**这一笔**，
 * 而多带一份数据就多一份离开这台设备的隐私。脱敏从类型上就定死。
 *
 * ⚠️ 用户的疑问（`doubt`）**不在这个类型里**：它是用户当场写的，
 * 与"这一笔的事实"不是一类东西，所以由调用方单独传（见 `analyzeFeedback`）。
 */
export type FeedbackContext = {
  foodName: string;
  /** 份量说法，如「15 个」 */
  portion: string;
  grams: number;
  kcal: number;
  sodium?: number;
  /** 命中的份量规则 */
  ruleLabel: string;
  ruleGrams: number;
  /** 那条规则有没有写明口径（生重/熟重/干重） */
  ruleNote?: string;
  /** 数值来源。没有出处的（「通用成分值」这类）正是最可能出问题的地方 */
  source: string;
  /**
   * 这个量词下有几档、当时用的是哪档、都有哪些档。
   * `options` 是**给白名单用的**：模型只能在真实存在的档位里建议（见 `parseVerdict`）。
   */
  tier?: { label: string; total: number; options: string[] };
};

export type FeedbackVerdict =
  | {
      verdict: "explained";
      explanation: string;
      /**
       * 如果症结在**档位**上，给一个可点的建议。
       * ⚠️ 必须落在这条记录真实的档位里（见 `parseVerdict` 的白名单），
       * 否则模型编一个「超大」出来，界面就会显示一个点了没反应的按钮。
       */
      suggestTier?: string;
    }
  | {
      verdict: "unexplained";
      explanation: string;
      /** 能直接贴到 GitHub issue 的文本 */
      issueText: string;
    };

/** 把这一笔摊平成给模型看的几行。**只给事实，不给结论** */
export function describeContext(ctx: FeedbackContext): string {
  const lines = [
    `食物：${ctx.foodName}`,
    `份量：${ctx.portion} = ${Math.round(ctx.grams)}g`,
    `算出来：${Math.round(ctx.kcal)} kcal${ctx.sodium === undefined ? "（钠无数据）" : ` · 钠 ${Math.round(ctx.sodium)}mg`}`,
    `命中的份量规则：「${ctx.ruleLabel}」= ${ctx.ruleGrams}g`,
    ctx.ruleNote ? `那条规则的口径说明：${ctx.ruleNote}` : "那条规则**没写口径**（没说生重还是熟重）",
    `数值来源：${ctx.source}`,
  ];
  if (ctx.tier) {
    lines.push(`这个量词下一共有 ${ctx.tier.total} 档，这一笔按「${ctx.tier.label}」算的`);
  }
  return lines.join("\n");
}

export function buildFeedbackMessages(ctx: FeedbackContext, doubt: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "你在帮一个饮食账本 App 回应用户的质疑：他觉得某一笔算出来的数字不对。",
        "",
        "**绝对不能给出任何营养数值**（热量、钠、克数、百分比…）。数值一律由 App 本地算，",
        "你说了就是编的。也不要断言「数据错了」，只能说「可能」「看起来」。",
        "",
        "你能做两件事：",
        "① 如果这个数**能用给定信息解释**（份量怎么折算的、数值来源是什么、口径写没写），",
        "   就用一两句人话解释清楚，判 explained。",
        "② 如果**确实解释不了**（比如数值来源本身没有出处、或档位差异足以改变结论、",
        "   或规则明显套错了），就如实说解释不了，判 unexplained，并写一段反馈文本。",
        "",
        "倾向：**先尽力解释**。解释不了才判 unexplained —— 动不动就说「解释不了」",
        "会让这个入口变成噪音。",
        "",
        "如果症结在**档位**上（比如用户说的其实是大号饺子），可以在 suggestTier 里给出",
        "建议的那一档；只能在给定的档位里选，没有就把这个字段设为 null。",
        "",
        "输出一个 JSON 对象，字段：",
        '  verdict: "explained" 或 "unexplained"',
        "  explanation: 给用户看的解释（一两句，中文，不要出现任何数字性结论）",
        "  suggestTier: 建议的档位标签，或 null",
        "  issueText: verdict 为 unexplained 时必填 —— 给开发者看的反馈文本，",
        "             包含上面那些事实 + 用户的疑问 + 你认为可疑的地方；",
        "             两三句话，不要客套，不要重复整份上下文。",
      ].join("\n"),
    },
    {
      role: "user",
      content: `这一笔记录：\n${describeContext(ctx)}\n\n用户的疑问：${doubt}`,
    },
  ];
}

type RawVerdict = {
  verdict?: unknown;
  explanation?: unknown;
  suggestTier?: unknown;
  issueText?: unknown;
};

/**
 * 校验模型返回的东西。
 *
 * ⚠️ `suggestTier` 走**白名单**：只在 `ctx.tier` 给的标签里收。
 * 不这么做的话，模型编一个「超大」出来，界面上就会出现一个**点了没反应**的按钮 ——
 * 那种坏法比不给建议更让人困惑（同「帮我挑」对菜名做白名单的理由）。
 *
 * 校验不过时**退回 `unexplained` 而不是抛错**：用户点了按钮就该得到一句回复，
 * 不能因为模型话说得不对就白屏。
 */
export function parseVerdict(raw: unknown, ctx: FeedbackContext, doubt: string): FeedbackVerdict {
  const r = (raw ?? {}) as RawVerdict;
  const explanation =
    typeof r.explanation === "string" && r.explanation.trim() ? r.explanation.trim() : "";

  // 白名单：模型只能建议**这个量词下真实存在的**档位
  const allowed = ctx.tier ? ctx.tier.options : [];
  const suggested =
    typeof r.suggestTier === "string" && allowed.includes(r.suggestTier) ? r.suggestTier : undefined;

  if (r.verdict === "explained" && explanation) {
    return { verdict: "explained", explanation, suggestTier: suggested };
  }

  // 其余一律当「解释不了」—— 包括模型判了 explained 却没给解释
  const issueText =
    typeof r.issueText === "string" && r.issueText.trim()
      ? r.issueText.trim()
      : `用户觉得这一笔不对：${doubt}`;

  return {
    verdict: "unexplained",
    explanation: explanation || "这次没分析出个所以然。",
    issueText,
  };
}

/** 拼一段能直接贴进 GitHub issue 的完整文本（模型那几句 + 事实） */
export function buildIssueText(ctx: FeedbackContext, doubt: string, modelNote: string): string {
  return [
    `【元气账本 · 数值疑问】`,
    "",
    describeContext(ctx),
    "",
    `我的疑问：${doubt}`,
    `模型分析：${modelNote}`,
    "",
    `（这段可以原样贴到 ${ISSUE_URL}）`,
  ].join("\n");
}

export async function analyzeFeedback(
  ctx: FeedbackContext,
  doubt: string,
  apiKey: string,
  fetchImpl?: typeof fetch,
): Promise<FeedbackVerdict> {
  const raw = await chatJSON<unknown>({
    apiKey,
    messages: buildFeedbackMessages(ctx, doubt),
    fetchImpl,
  });
  return parseVerdict(raw, ctx, doubt);
}
