/**
 * 让模型**读**一张食物照片，把上面的数字抄下来。
 *
 * 这一层只做两件事：拼提示词、把返回值收拾干净。真正的联网在 `deepseek.ts`。
 *
 * 三条刻意的选择：
 *
 * 1) **模型只负责转录，不负责估计。** 这是整个功能的**权力边界**（AGENTS 地雷 10）：
 *    营养数字要么来自正式库、要么来自用户自己输入，**绝不能由模型产生**。
 *    所以提示词里写死了"看不清就留空，不要推测" —— 宁可让用户手输，
 *    也不能让一个编出来的数字混进账本。数值的合理性另由
 *    `lib/nutrition/verify.ts`（T2）兜底校验。
 *
 * 2) **返回值全部过一遍白名单。** 模型理论上会按 JSON 模式回，但字段可能是
 *    `"9.0"`（字符串）、`"约 9"`（带字）、或者压根没有。这里把每个数字字段
 *    单独 `toNum` 一次，非有限数一律当**没有**（undefined），而不是当 0 ——
 *    "没有数据"和"数据是 0"是两回事（地雷 11，钠尤其明显）。
 *
 * 3) **图片只放 `user` 消息。** 放进 `system` 会直接 400（官方 vision 文档明写）。
 */

import { chatJSON, VISION_MODEL, type ContentBlock } from "./deepseek";
import { ImageDecodeError } from "./imageInput";

export type FoodReading = {
  /** label = 包装上的营养成分表；dish = 一道菜；unknown = 都认不出来 */
  kind: "label" | "dish" | "unknown";
  /** 模型读到的名字（包装上的品名 / 菜名）。读不出来就是空串 */
  name: string;
  /** 数字是以什么为基准的 */
  basis: "per100ml" | "per100g" | "per_serving";
  energy_kj?: number;
  energy_kcal?: number;
  protein_g?: number;
  fat_g?: number;
  carb_g?: number;
  sodium_mg?: number;
  nrv?: { energy?: number; protein?: number; fat?: number; carb?: number; sodium?: number };
  /** 每份多少克/毫升。只有包装上标了"每份"时才有 */
  serving_grams?: number;
  /** 图上的字到底能不能看清 —— 模型自己判断，用来决定要不要让用户重拍 */
  readable: boolean;
  notes?: string;
};

/**
 * 提示词。**照抄不要软化** —— 每一句都在堵一个具体的坑：
 * 「不要推测」堵编数，「看不清留空」堵硬猜，「没有营养成分表就填 dish 且不填数值」
 * 堵模型把一道菜硬凑成一张成分表。
 */
const SYSTEM_PROMPT = `你是食物营养信息的**转录员**，不是估算器。

你的唯一任务：把图片上**确实印着**的文字与数字抄下来，整理成 JSON。

硬性规则（违反即为错误）：
1. 只填你在图上**确实看到**的数字。看不清、被遮挡、反光、模糊导致不确定的字段，
   一律**留空**，不要推测、不要补全、不要用常识或相似产品去填。
2. 如果图里**没有营养成分表**（比如只是一盘菜、一个水果、一杯饮料的照片），
   把 kind 填 "dish"，并且**不要填任何数值字段**（energy_*/protein_g/fat_g/carb_g/sodium_mg/nrv 全部省略）。
3. 数值一律填**纯数字**，不要带单位、不要带"约"、"左右"、"≈"等字。
4. 单位换算只做**图上明写的可见换算**：
   - 若图上写的是千焦（kJ），填 energy_kj；如果同时能看到千卡（kcal）就一并填 energy_kcal。
     看不到千卡时**不要自己换算**，把 energy_kcal 留空。
   - 钠的单位如果是克（g），换算成毫克（mg）填（1g = 1000mg）；这是单位换算不是猜测。
5. basis 按图上标的基准填：
   - "每 100 毫升" / "per 100ml" → "per100ml"
   - "每 100 克" / "per 100g" → "per100g"
   - "每份" / "per serving" → "per_serving"
   三者都看不出来时，填 "per100g"（最常见的默认）。
6. readable：整张图的文字**能不能看清**。能看清填 true；模糊/反光/缺角导致读不全填 false。
7. name 要**尽量读出来，别轻易留空** —— 用户最不想做的就是自己打字。按优先级找：
   ① 包装上的**商品名 / 品名**（常印在成分表附近或包装正面，如「统一双萃鸭屎香风味柠檬茶」）；
   ② 品牌与品名分开印时，拼成一个完整的名字；
   ③ 图里只有一盘菜、没有包装时，填**菜名**（如「西红柿炒鸡蛋」）。
   写成完整通顺的名字；**别只写「柠檬茶」这种丢掉品牌与规格的短名**。
   一个字都看不到时才填空字符串 ""；**绝对不要编造品牌、口味或规格**。

只回一个 JSON 对象，结构如下（没有的字段直接省略，不要写 null）：
{
  "kind": "label" | "dish" | "unknown",
  "name": "…",
  "basis": "per100ml" | "per100g" | "per_serving",
  "energy_kj": 数字, "energy_kcal": 数字,
  "protein_g": 数字, "fat_g": 数字, "carb_g": 数字, "sodium_mg": 数字,
  "nrv": { "energy": 数字, "protein": 数字, "fat": 数字, "carb": 数字, "sodium": 数字 },
  "serving_grams": 数字,
  "readable": true | false,
  "notes": "有什么需要提醒用户注意的（比如某几项没印、字迹不清）"
}`;

/** 把模型返回的任意值收拾成一个有限数；收拾不出来就返回 undefined（**不是 0**） */
function toNum(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    // 去掉千分位逗号与空白、"约/左右/≈/g/ml/mg" 之类的尾巴，再试着解析
    const cleaned = v.replace(/[,\s]/g, "").replace(/^(约|大约|≈|~|>|<)+/, "");
    const m = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!m) return undefined;
    const n = Number.parseFloat(m[0]);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** 只在值确实有定义时挂上去 —— 保持对象干净，方便上层用 `in` 判断"有没有这一项" */
function put<T extends object>(obj: T, key: keyof T, v: unknown): void {
  const n = toNum(v);
  if (n !== undefined) obj[key] = n as T[keyof T];
}

const BASIS_VALUES = new Set(["per100ml", "per100g", "per_serving"]);
const KIND_VALUES = new Set(["label", "dish", "unknown"]);

/** 把模型的原始返回收拾成可信的 `FoodReading`。导出是为了单测。 */
export function parseFoodReading(raw: unknown): FoodReading {
  const r = (raw ?? {}) as Record<string, unknown>;

  const kindRaw = typeof r.kind === "string" ? r.kind.trim() : "";
  const kind: FoodReading["kind"] = KIND_VALUES.has(kindRaw)
    ? (kindRaw as FoodReading["kind"])
    : "unknown";

  const basisRaw = typeof r.basis === "string" ? r.basis.trim() : "";
  const basis: FoodReading["basis"] = BASIS_VALUES.has(basisRaw)
    ? (basisRaw as FoodReading["basis"])
    : "per100g";

  const out: FoodReading = {
    kind,
    name: typeof r.name === "string" ? r.name.trim() : "",
    basis,
    readable: r.readable !== false, // 缺省当作"能看清"，别因为模型漏字段就吓用户
  };

  put(out, "energy_kj", r.energy_kj);
  put(out, "energy_kcal", r.energy_kcal);
  put(out, "protein_g", r.protein_g);
  put(out, "fat_g", r.fat_g);
  put(out, "carb_g", r.carb_g);
  put(out, "sodium_mg", r.sodium_mg);
  put(out, "serving_grams", r.serving_grams);

  if (r.nrv && typeof r.nrv === "object") {
    const n = r.nrv as Record<string, unknown>;
    const nrv: NonNullable<FoodReading["nrv"]> = {};
    put(nrv, "energy", n.energy);
    put(nrv, "protein", n.protein);
    put(nrv, "fat", n.fat);
    put(nrv, "carb", n.carb);
    put(nrv, "sodium", n.sodium);
    if (Object.keys(nrv).length > 0) out.nrv = nrv;
  }

  const notes = typeof r.notes === "string" ? r.notes.trim() : "";
  if (notes) out.notes = notes;

  // 「没有营养成分表就不该有数值」这条规矩在提示词里说了，但模型不一定守。
  // 这里**用代码兜住**：dish 一律抹掉所有数值字段 —— 免得一道菜被当成成分表记账。
  if (out.kind === "dish") {
    delete out.energy_kj;
    delete out.energy_kcal;
    delete out.protein_g;
    delete out.fat_g;
    delete out.carb_g;
    delete out.sodium_mg;
    delete out.nrv;
    delete out.serving_grams;
  }

  return out;
}

/**
 * 读一张食物照片。
 *
 * @param input.imageDataUrl `fileToDataUrl()` 的产物（已压到长边 ≤1600）
 * @param input.hintName 用户在拍照前输入的名字，作为提示词的一部分帮模型找焦点
 * @param input.detail 默认 `"high"`。**绝不用 `"low"`** —— low 会把图缩到 512×512，
 *                     营养成分表的小字必糊（官方文档明写）
 * @throws {Error} Key 不对 / 没网 / 超时 / 返回不是 JSON —— 都是带中文说明的错
 */
export async function readFoodPhoto(input: {
  apiKey: string;
  imageDataUrl: string;
  hintName?: string;
  detail?: "high" | "original";
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<FoodReading> {
  if (!input.imageDataUrl.startsWith("data:image/")) {
    throw new ImageDecodeError("给过来的不是图片数据，读不了。");
  }

  const hint = input.hintName?.trim();
  const askText = [
    "请把这张图上的营养信息转录成 JSON。",
    hint ? `用户说这东西叫「${hint}」，可作参考，但**以图上印的为准**。` : "",
    "记住：只抄确实看到的数字，看不清就留空，不要推测。",
  ]
    .filter(Boolean)
    .join("\n");

  // 图片块**必须**在 user 消息里（官方文档：放 system/assistant 会 400）。
  // text 放前面、图放后面，是 OpenAI 兼容接口的常见推荐顺序。
  const content: ContentBlock[] = [
    { type: "text", text: askText },
    { type: "image_url", image_url: { url: input.imageDataUrl, detail: input.detail ?? "high" } },
  ];

  const raw = await chatJSON<unknown>({
    apiKey: input.apiKey,
    model: VISION_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
    // 读表要稳不要创意。温度调低，避免它"顺手"把数值修成好看的整数。
    temperature: 0,
    // 图片上传比纯文字慢，给宽一点。
    timeoutMs: input.timeoutMs ?? 60000,
    // flash 默认 thinking，必须关：转录不需要推理链，开着白烧 token 又慢。
    disableThinking: true,
    fetchImpl: input.fetchImpl,
  });

  return parseFoodReading(raw);
}
