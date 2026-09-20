#!/usr/bin/env node
/**
 * 一次性验证脚本：确认 DeepSeek 视觉这条路**真的能走**。
 *
 * ⚠️ 这是**取数/探针工具，不是闸门** —— 它要联网、要 Key，所以**不进**
 * `npm test` 与闸门链（照 `scripts/fetch-food-table.mjs` 的先例）。
 *
 * 为什么非写不可：官方文档有三件事**没写明**，而它们直接决定 T1.3 的写法。
 * 文档 §T1.4 记的就是这三条：
 *
 *   1. `response_format: { type: "json_object" }` 与**图片**能否同时用？
 *      （JSON 模式和视觉是两个独立特性，同时开会不会被拒？）
 *   2. `deepseek-flash` **默认 thinking 模式**，怎么关？
 *      （指南页没给现成请求体，字段名得试）
 *   3. `deepseek-chat` **是否仍可用**？
 *      （`lib/ai/deepseek.ts` 里写死了它，万一已退役，文字路径就全挂了）
 *
 * 用法：
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/probe-vision.mjs
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/probe-vision.mjs --label "能量 153 千焦\n..."
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/probe-vision.mjs --keep   # 留下样本图
 *
 * 样本图是**现画**的（Python + Pillow 画一张模拟营养成分表），不依赖仓库里
 * 存一张图 —— 那样会被 gzip/压缩搞失真，也说不清样本到底是什么。
 *
 * 退出码：0 = 三项未知全部有答案；1 = 有硬失败（连不上 / Key 不对）；2 = 用法错。
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const BASE = "https://api.deepseek.com";
const OUT_DIR = resolve(process.cwd(), ".tmp-probe-vision");
const IMG_PATH = join(OUT_DIR, "label.png");

/**
 * 找 python。系统 `python` 在这台机器上是 Microsoft Store 的 stub（跑起来只会弹商店），
 * 所以优先用 WorkBuddy 自带的 3.13 + 那个装了 Pillow 的 venv。
 * 找不到就退回 `python3`，让它在 PATH 里自己撞。
 */
function findPython() {
  const candidates = [
    join(homedir(), ".workbuddy", "binaries", "python", "envs", "default", "Scripts", "python.exe"),
    join(homedir(), ".workbuddy", "binaries", "python", "versions", "3.13.12", "python.exe"),
    "python3",
    "python",
  ];
  for (const c of candidates) {
    if (c.includes("\\") || c.includes("/")) {
      if (!existsSync(c)) continue;
    }
    try {
      execFileSync(c, ["-c", "import PIL"], { stdio: "ignore" });
      return c;
    } catch {
      /* 这个候选没有 Pillow，换下一个 */
    }
  }
  return null;
}

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const labelIdx = argv.indexOf("--label");
const customLabel = labelIdx >= 0 ? argv[labelIdx + 1] : null;
const onlyDraw = argv.includes("--draw-only");

const apiKey = (process.env.DEEPSEEK_API_KEY ?? "").trim();
if (!apiKey && !onlyDraw) {
  console.error("缺 Key。用法：DEEPSEEK_API_KEY=sk-xxx node scripts/probe-vision.mjs");
  console.error("（只想先看看样本图长什么样：node scripts/probe-vision.mjs --draw-only）");
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * 1. 造一张模拟营养成分表
 * ------------------------------------------------------------------ */

/**
 * 默认样本照抄 T0 那条饮料的真实标示，并带上 NRV 列。
 * 选它是因为**数值已经过用户确认**（文档 §5.4），拿它当标准答案不会自欺。
 */
const DEFAULT_LABEL = [
  "营养成分表",
  "Nutrition Information",
  "项目            每100毫升    营养素参考值%",
  "能量            153千焦          2%",
  "蛋白质          0克              0%",
  "脂肪            0克              0%",
  "碳水化合物      9.0克            3%",
  "钠              10毫克           1%",
];

function makeLabelPng(lines) {
  mkdirSync(OUT_DIR, { recursive: true });
  const pyBin = findPython();
  if (!pyBin) {
    throw new Error(
      "找不到带 Pillow 的 python。装一下：\n" +
        '  python -m pip install Pillow\n' +
        "或直接把一张真的营养成分表照片放到 " + IMG_PATH + "，再用 --skip-draw 重跑。",
    );
  }
  // 用 python 现画。字号刻意画得小一点，逼近真实包装上的排版 ——
  // 大字号会掩盖"模型到底能不能读清小字"这个问题。
  const py = `
import sys
from PIL import Image, ImageDraw, ImageFont

lines = ${JSON.stringify(lines)}
W, H = 900, 470
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)

def font(size):
    for p in [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyhbd.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()

# 外框：真实包装的营养成分表都有个黑框
d.rectangle([20, 20, W - 20, H - 20], outline="black", width=3)

y = 40
for i, line in enumerate(lines):
    if i == 0:
        f, step = font(36), 54
    elif i == 1:
        f, step = font(18), 36
    elif i == 2:
        f, step = font(22), 48
    else:
        f, step = font(28), 54
    d.text((48, y), line, fill="black", font=f)
    y += step

# 表头下画条分隔线
d.line([40, 205, W - 40, 205], fill="black", width=2)

img.save(sys.argv[1], "PNG")
print("画好了：", sys.argv[1])
`;
  writeFileSync(join(OUT_DIR, "_mkpng.py"), py, "utf8");
  execFileSync(pyBin, [join(OUT_DIR, "_mkpng.py"), IMG_PATH], { stdio: "inherit" });
  if (!existsSync(IMG_PATH)) throw new Error("样本图没生成出来");
}

/* ------------------------------------------------------------------ *
 * 2. 调一次接口
 * ------------------------------------------------------------------ */

function dataUrl(path) {
  return "data:image/png;base64," + readFileSync(path).toString("base64");
}

async function call(body, label) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, err: `网络层失败：${e.message}`, label };
  }
  const ms = Date.now() - t0;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 留 null，下面按原文报 */
  }
  return { ok: res.ok, status: res.status, ms, json, text, label };
}

const show = (r) => {
  const head = `${r.ok ? "✓" : "✗"} ${r.label}  HTTP ${r.status}  ${r.ms}ms`;
  if (!r.ok) {
    console.log(`  ${head}`);
    console.log(`     报错：${(r.err ?? r.json?.error?.message ?? r.text ?? "").slice(0, 300)}`);
    return head;
  }
  const msg = r.json?.choices?.[0]?.message ?? {};
  const content = msg.content ?? "";
  const reasoning = msg.reasoning_content ?? msg.reasoning ?? "";
  console.log(`  ${head}`);
  console.log(`     用量：${JSON.stringify(r.json?.usage ?? {})}`);
  if (reasoning) {
    // thinking 开着的铁证：返回里多了思维链，而且耗时通常明显变长
    console.log(`     ⚠️ 返回里带了 thinking（reasoning 字段，${reasoning.length} 字）：`);
    console.log(`        ${reasoning.replace(/\s+/g, " ").slice(0, 200)}…`);
  } else {
    console.log("     没有 thinking 字段");
  }
  console.log(`     正文：${content.replace(/\s+/g, " ").slice(0, 400)}`);
  return head;
};

/* ------------------------------------------------------------------ *
 * 3. 主流程
 * ------------------------------------------------------------------ */

const ask = "这张图里是不是营养成分表？把能量、碳水化合物、钠三项的数字读出来，用 JSON 回。";

console.log("=".repeat(72));
console.log("DeepSeek 视觉能力探针");
console.log("=".repeat(72));

console.log("\n[1/3] 造样本图 →", IMG_PATH);
const labelLines = customLabel ? customLabel.split("\\n") : DEFAULT_LABEL;
makeLabelPng(labelLines);
console.log("      样本行数：", labelLines.length);

if (onlyDraw) {
  console.log("\n--draw-only：只画图、不调接口。看一眼 .tmp-probe-vision/label.png 对不对。");
  process.exit(0);
}

const results = {};

console.log("\n--- 未知 ①：json_object + 图片 能否同时用 ---");
results.jsonVision = await call(
  {
    model: "deepseek-flash",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: ask },
          { type: "image_url", image_url: { url: dataUrl(IMG_PATH), detail: "high" } },
        ],
      },
    ],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
  },
  "flash + 图片 + json_object + thinking关闭",
);
show(results.jsonVision);
if (!results.jsonVision.ok) {
  console.log("     ↳ 很可能就是 json_object 与图片不能同时用。下面单独试纯图片：");
  results.jsonVisionNoFmt = await call(
    {
      model: "deepseek-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: ask },
            { type: "image_url", image_url: { url: dataUrl(IMG_PATH), detail: "high" } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    },
    "flash + 图片（不带 json_object）",
  );
  show(results.jsonVisionNoFmt);
}

console.log("\n--- 未知 ②：deepseek-flash 的 thinking 怎么关 ---");
// 故意**不带** thinking 字段，看默认行为到底是不是 thinking
results.flashDefault = await call(
  {
    model: "deepseek-flash",
    messages: [{ role: "user", content: "说一句「收到」就行。" }],
  },
  "flash 不带 thinking 字段（看默认）",
);
show(results.flashDefault);

console.log("\n--- 未知 ③：deepseek-chat 是否仍可用 ---");
results.chat = await call(
  {
    model: "deepseek-chat",
    messages: [{ role: "user", content: "回一个 JSON：{\"ok\":true}" }],
    response_format: { type: "json_object" },
  },
  "deepseek-chat + json_object",
);
show(results.chat);

/* ---------------------------- 汇总 ---------------------------- */

console.log("\n" + "=".repeat(72));
console.log("结论");
console.log("=".repeat(72));

const conclusion = [];
conclusion.push(
  results.jsonVision.ok
    ? "① json_object 与图片**可以同时用** —— T1.3 照原设计走。"
    : "① json_object 与图片**不能同时用** —— T1.3 必须去掉 response_format，改成「提示词要 JSON + 手动抠 JSON」。",
);
conclusion.push(
  results.flashDefault.json?.choices?.[0]?.message?.reasoning_content ||
    results.flashDefault.json?.choices?.[0]?.message?.reasoning
    ? "② flash **默认开 thinking** —— 已确认必须显式传 thinking:{type:'disabled'} 关掉。"
    : "② flash 默认**没有** thinking（或返回里看不出来）—— 关掉那步可能可以省，但保留更稳。",
);
conclusion.push(
  results.chat.ok
    ? "③ deepseek-chat **仍可用** —— lib/ai/deepseek.ts 的 DEEPSEEK_MODEL 不用改。"
    : "③ deepseek-chat **已不可用** —— 必须改 DEEPSEEK_MODEL，并跑 lib/ai/recommend.test.ts / feedback.test.ts 确认仍过。",
);
for (const c of conclusion) console.log("  " + c);

// 逐字段核对样本图的三项标准答案
const body = results.jsonVision.json?.choices?.[0]?.message?.content ?? "";
console.log("\n样本图标准答案（应与读数一致）：能量 153kJ / 碳水 9.0g / 钠 10mg");
console.log("模型原文：", body.replace(/\s+/g, " ").slice(0, 500));

if (!keep) {
  rmSync(join(OUT_DIR, "_mkpng.py"), { force: true });
  console.log("\n（样本图留在 .tmp-probe-vision/，加 --keep 会连脚本一起留）");
}

process.exit(results.chat.ok || results.jsonVision.ok ? 0 : 1);
