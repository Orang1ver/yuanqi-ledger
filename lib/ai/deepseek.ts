/**
 * DeepSeek 的调用封装（纯 TS，浏览器直连）。
 *
 * 三条刻意的选择：
 *
 * 1) **用 `fetch` 而不是 `openai` SDK。** 依赖里确实躺着 `openai`（当初预留在
 *    package.json 里没接线），但它是 9.6MB / 1.29MB JS 的一坨，而这里真正需要的
 *    只是"一次 POST，读一个 JSON 字段"。为了省下百来 KB 也为了少一层
 *    打包器与 Node 内建模块的纠缠，直接用 `fetch`。
 *
 * 2) **不在这里读 localStorage。** Key 由调用方传进来 —— 这一层要能在 Node 里
 *    被单测、被脚本直接跑，碰了 localStorage 就废了（见 AGENTS.md 第 4 节第 10 条
 *    对 `lib/nutrition/` 的同款要求）。
 *
 * 3) **报错要能照做。** 模型接口的报错五花八门，用户看不懂 "Failed to fetch"，
 *    也分不清"我没网"和"我 Key 填错了" —— 而这两件事该做的动作完全不同。
 *    所以这里把状态码与异常统一翻成一句中文，并说清下一步做什么。
 */

export type ChatMessage = { role: "system" | "user"; content: string };

const BASE_URL = "https://api.deepseek.com";

/**
 * 模型名。刻意写死常量而不是 `process.env.NEXT_PUBLIC_*` ——
 * 这是个纯静态导出（`output: "export"`），环境变量在构建期就被烘死了，
 * 留个"可配置"的假象只会让人以为改了环境变量就生效。
 */
export const DEEPSEEK_MODEL = "deepseek-chat";

/** 挑菜不需要创意，需要稳。温度高了它会开始编菜单里没有的菜 */
const DEFAULT_TEMPERATURE = 0.2;

/** 一次调用的上限。超时不是"失败"，是"这次别等了，退回本地推荐" */
const DEFAULT_TIMEOUT_MS = 25000;

export type ChatJSONInput = {
  apiKey: string;
  messages: readonly ChatMessage[];
  temperature?: number;
  timeoutMs?: number;
  /**
   * 仅供测试注入。生产路径不传，走全局 `fetch`。
   * 注意默认值取的是**调用时**的全局 fetch，这样冒烟里替换 `window.fetch` 才有用。
   */
  fetchImpl?: typeof fetch;
};

/**
 * 网络层失败（DNS 解析不了 / 连不上 / 被代理或插件拦了 / 设备离线）时，
 * 浏览器抛的是 TypeError：Chrome 说 "Failed to fetch"、Safari 说 "Load failed"。
 * 这些说法用户看不懂，所以统一翻成一句能照做的话。
 *
 * ⚠️ 只在**网络层**失败时替换；接口返回的 4xx/5xx 有自己的说法，别覆盖。
 */
function friendlyFetchError(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|load failed|networkerror|network request failed|fetch failed|err_/i.test(raw)) {
    return new Error(
      "连不上 api.deepseek.com（浏览器报「" +
        raw +
        "」）。常见原因：① 这台设备当前没网；② 开着 Steam++ / Watt Toolkit 之类的网络加速或代理；③ 浏览器插件把它拦了。",
    );
  }
  return e instanceof Error ? e : new Error(raw);
}

/** 按状态码给一句能照做的话 */
function messageForStatus(status: number): string {
  if (status === 401 || status === 403) return "DeepSeek Key 不对（或没有这个模型的权限），到「设置 → AI 接口 Key」里重新粘贴一次。";
  if (status === 402) return "DeepSeek 账户余额不足，去官网充值后再试。";
  if (status === 429) return "调用太频繁了，等一会儿再点。";
  if (status >= 500) return `DeepSeek 服务暂时不可用（${status}），过一会儿再试。`;
  return `DeepSeek 请求失败（${status}）。`;
}

/**
 * 发一次对话请求，把返回的正文按 JSON 解析出来。
 *
 * 失败一律**抛错**（带中文说明），由调用方决定怎么降级 ——
 * 这里返回 null 之类的"软失败"会让上层分不清"模型没挑出来"和"请求根本没发出去"。
 */
export async function chatJSON<T>(input: ChatJSONInput): Promise<T> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("没填 DeepSeek Key。");

  const doFetch = input.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await doFetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: input.messages,
        temperature: input.temperature ?? DEFAULT_TEMPERATURE,
        // JSON 模式：让它只可能吐出一个对象，省掉"从一段闲聊里抠 JSON"的脆弱解析。
        // 注意它不是 schema 校验 —— 字段对不对仍然要靠下面的白名单过滤。
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("等 DeepSeek 回话超时了，再点一次试试。");
    }
    throw friendlyFetchError(e);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(messageForStatus(res.status));

  let raw: string;
  try {
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    raw = data.choices?.[0]?.message?.content ?? "";
  } catch {
    throw new Error("DeepSeek 的返回读不出来（不是合法 JSON）。");
  }
  if (!raw.trim()) throw new Error("DeepSeek 这次没返回内容。");

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("DeepSeek 返回的内容不是合法 JSON。");
  }
}
