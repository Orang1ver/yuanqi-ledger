/**
 * 真实浏览器冒烟测试（零依赖）。
 *
 * 为什么要有它：
 * `npm run check:data` 只能证明**数据层**读得出来旧数据；它证明不了
 * 界面真的把数据画到了屏幕上 —— 中间还隔着 hydration、日期上下文、
 * 卡片订阅、条件渲染一堆环节，任何一环断了用户看到的都是空白。
 * 这个脚本用真实浏览器打开构建产物、写入早期版本数据、读回**屏幕上的文字**，
 * 才算把"老数据在新版里能用"这句话验证到底。
 *
 * 刻意不装 Playwright：
 * 本机已经有 Edge，直接用它的 DevTools Protocol 就够了，
 * 不必为了跑一次冒烟去下一个 500MB 的 Chromium。
 *
 * 前置：先带 BASE_PATH 构建，并起好预览服务
 *   BASE_PATH=/yuanqi-ledger npm run build
 *   node scripts/preview.mjs --port 4177
 *
 * 用法：
 *   node scripts/browser-smoke.mjs
 *   node scripts/browser-smoke.mjs --base http://127.0.0.1:4177/yuanqi-ledger --dump
 *   node scripts/browser-smoke.mjs --data .tmp-demo/元气账本-样例数据.json   # 换成备份文件当数据源
 *
 * 退出码 0 = 界面确实显示了旧数据；1 = 有断言没过。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const BASE_URL = arg("base", "http://127.0.0.1:4177/yuanqi-ledger").replace(/\/+$/, "");
const DEBUG_PORT = Number(arg("port", "9333"));
const DUMP = hasFlag("dump");
const OUT_DIR = join(ROOT, ".tmp-smoke");
const APP_DIR = join(ROOT, "app");

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 极简 CDP 客户端 ----------

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const waiters = new Map();

  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", () => rej(new Error("无法连接调试端口（WebSocket 打开失败）")));
  });

  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m.result);
      return;
    }
    const list = waiters.get(m.method);
    if (list && list.length) list.shift()(m.params);
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  function once(method, ms = 20000) {
    return new Promise((resolve, reject) => {
      const list = waiters.get(method) ?? [];
      const cb = (p) => {
        clearTimeout(timer);
        resolve(p);
      };
      list.push(cb);
      waiters.set(method, list);
      const timer = setTimeout(() => {
        const cur = waiters.get(method) ?? [];
        const i = cur.indexOf(cb);
        if (i >= 0) cur.splice(i, 1);
        reject(new Error(`等待 ${method} 超时`));
      }, ms);
    });
  }

  return { ready, send, once, close: () => ws.close() };
}

async function evaluate(page, expression) {
  const r = await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error("页面内脚本报错：" + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  }
  return r.result.value;
}

/**
 * 读"屏幕上的东西"。
 *
 * 两个坑，踩过才知道：
 * 1) `innerText` **不包含 <input> 的 value** —— 健康档案的身高体重都在输入框里，
 *    只读 innerText 会误判成"旧数据没显示出来"。
 * 2) 日期下拉的几十个 <option> 会被算进 innerText，把真正的正文淹掉。
 *    所以先把下拉的当前值记下来，再把 <select> 摘掉，剩下的才是人眼看到的内容。
 */
async function probe(page) {
  return evaluate(
    page,
    `(() => {
      const inputs = [...document.querySelectorAll("input")]
        .map((i) => (i.placeholder || i.type) + "=" + i.value)
        .join(" | ");
      const selects = [...document.querySelectorAll("select")].map((s) => s.value).join(" | ");
      const on = [...document.querySelectorAll('[data-on="true"]')]
        .map((e) => e.innerText.trim())
        .join(" | ");
      document.querySelectorAll("select").forEach((s) => s.remove());
      return (
        document.body.innerText +
        "\\n[[input]] " + inputs +
        "\\n[[select]] " + selects +
        "\\n[[选中项]] " + on
      );
    })()`,
  );
}

async function goto(page, url) {
  const loaded = page.once("Page.loadEventFired", 25000).catch(() => null);
  await page.send("Page.navigate", { url });
  await loaded;
  // 等 hydration：Next 的客户端组件要挂载完，卡片才会把 localStorage 画出来
  for (let i = 0; i < 40; i++) {
    const len = await evaluate(page, "document.body.innerText.length").catch(() => 0);
    if (len > 200) break;
    await sleep(250);
  }
  await sleep(400);
}

// ---------- 按需拉起预览服务 ----------
//
// 冒烟测试依赖一个静态服务把 out/ 挂在子路径下。要求人先手动起服务，
// 这个"闸门"迟早会因为忘记而起不来 —— 所以这里自己按需拉起、跑完关掉。

let previewProc = null;

async function reachable(url) {
  try {
    const r = await fetch(url, { redirect: "manual" });
    return r.status > 0;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable(`${BASE_URL}/`)) {
    console.log(`▶ 复用已有服务：${BASE_URL}`);
    return;
  }
  const u = new URL(BASE_URL);
  const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (!local) throw new Error(`连不上 ${BASE_URL}，且不是本机地址，无法自动起服务`);

  if (!existsSync(join(ROOT, "out", "index.html"))) {
    throw new Error("out/ 里没有构建产物。先在子路径下构建：BASE_PATH=/yuanqi-ledger npm run build");
  }

  const base = u.pathname.replace(/\/+$/, "") || "/";
  const port = u.port || "4177";
  console.log(`▶ ${BASE_URL} 没响应，自动起预览服务（:${port}${base}）`);
  previewProc = spawn(
    process.execPath,
    [join(ROOT, "scripts", "preview.mjs"), "--port", port, "--base", base],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 40; i++) {
    if (await reachable(`${BASE_URL}/`)) return;
    await sleep(250);
  }
  throw new Error("预览服务起不来");
}

// ---------- 找浏览器 ----------

function findBrowser() {
  for (const p of [...EDGE_CANDIDATES, ...CHROME_CANDIDATES]) if (existsSync(p)) return p;
  return null;
}

// ---------- 数据源 ----------
//
// 默认用 scripts/fixtures/legacy-v1.json（原始结构，注入时 JSON.stringify）。
// `--data <文件>` 可以换成一份**备份文件**（`npm run demo:data` 的产物）——
// 备份里的值本身就是字符串，直接原样写入，与真实"导入备份"的写入路径一致。

const DATA_ARG = arg("data", null);
const dataFile = DATA_ARG ? resolve(DATA_ARG) : join(ROOT, "scripts", "fixtures", "legacy-v1.json");
const loaded = JSON.parse(readFileSync(dataFile, "utf8"));
const isBackup = !!loaded && typeof loaded === "object" && !!loaded.data && typeof loaded.data === "object";
const seedData = isBackup ? loaded.data : loaded;
const seedLabel = isBackup ? `备份文件（${Object.keys(seedData).length} 项）` : "早期版本样本（legacy-v1.json）";

/**
 * 真正要验的：界面上的文字里必须出现这些 —— 它们只能来自被注入的数据
 *
 * 饮食页要分两种情况断言，因为这两条路本来就该长得不一样：
 *  - 样本数据里根本没有 `recipe.dietLog.v1` 这个键（早期版本从没写过它，
 *    老用户升级后第一次进来就是这样）→ 必须显示空状态，而不是编出个 0；
 *  - 用 `--data` 传样例备份时里面有记录
 *    → 记录里的食物名必须真的画出来。
 *
 * 挑断言词不能随手拿第一条记录的名字：像「米饭」「奶茶」这种词本身就写在界面
 * 源码里（搜索框的 placeholder，而 placeholder 也会被 probe 抓进文字），
 * 拿它当断言等于白测 —— 数据没加载、界面照样"命中"。
 * 所以这里先把界面源码读一遍，只保留在里面**找不到**的名字，
 * 「这些词只可能来自注入的数据」这句话才是真的被验证了。
 */
const dietSeed = asList(seedData["recipe.dietLog.v1"]);
const dietNames = pickDataOnlyWords(dietSeed.map((e) => e && e.name).filter(Boolean), APP_DIR, 2);
console.log(
  `▶ 饮食页断言词：${dietNames.length ? dietNames.join(" / ") : "（无记录，验空状态）"}` +
    `（饮食记录 ${dietSeed.length} 条）`,
);

/**
 * 首页的「今天还该吃点啥」是缺口驱动的，所以两个方向都要验：
 * 喂了饮食记录 → 不许再说"还没有饮食记录"（证明它真读到了注入的数据）；
 * 没喂记录 → 必须老实说"还没有饮食记录"，而不是装作知道。
 *
 * ⚠️ 别断言具体的缺口名（钠/纤维）—— 哪一项排第一取决于当天数据与目标，
 * 拿它当断言会在换一份样本时莫名其妙地红。
 */
const homeMust = ["今天还该吃点啥", ...(dietSeed.length ? [] : ["还没有饮食记录"])];

const EXPECT = [
  {
    path: "/",
    must: homeMust,
    mustNot: dietSeed.length ? ["还没有饮食记录"] : [],
    label: "今天",
  },
  {
    path: "/diet/",
    must: dietNames.length ? dietNames : ["还没有记录"],
    mustNot: ["NaN", "undefined"],
    label: "饮食",
  },
  { path: "/health/", must: ["165", "56.5", "20.8"], label: "健康小屋" },
  { path: "/takeout/", must: ["沙县小吃", "拌面"], label: "菜单库" },
  { path: "/weekly/", must: [], label: "周报" },
];

/**
 * 取一个「列表型」的种子值。
 *
 * 两种情况都要吃得下：直接喂样本 JSON 时是真数组，喂备份文件时值是被
 * `JSON.stringify` 过一遍的**字符串**（备份就是这么存的，见下面写入 localStorage 那段）。
 * 漏了字符串这一路，断言会静默退化成"测空状态"，测了个寂寞。
 */
function asList(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 把 `app/` 下所有源码拼成一坨，用来判断某个词是不是界面上本来就有的 */
function readAppSource(dir) {
  let out = "";
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    out += ent.isDirectory() ? readAppSource(p) : readFileSync(p, "utf8");
  }
  return out;
}

/**
 * 从候选词里挑出「界面源码里没有」的若干个，作为只能来自数据的断言词。
 * 长的优先（越长越具体，越不容易撞车）；都不合格时退回最长的那个，
 * 宁可断言弱一点，也不要因为挑不出词就静默不测。
 */
function pickDataOnlyWords(words, appDir, limit) {
  const source = readAppSource(appDir);
  const distinct = [...new Set(words)];
  const clean = distinct.filter((w) => !source.includes(w)).sort((a, b) => b.length - a.length);
  if (clean.length) return clean.slice(0, limit);
  return distinct.sort((a, b) => b.length - a.length).slice(0, 1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.error("✗ 找不到 Edge/Chrome。可用 EDGE_PATH 或 CHROME_PATH 指定可执行文件。");
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
const profile = join(tmpdir(), `yq-smoke-${Date.now()}`);

console.log(`▶ 浏览器：${browserPath}`);
console.log(`▶ 目标：${BASE_URL}`);

try {
  await ensureServer();
} catch (e) {
  console.error("✗ " + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
}

const child = spawn(
  browserPath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--mute-audio",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let browserLevel = null;
let page = null;
const failures = [];

try {
  // 等调试端口就绪
  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) {
        version = await res.json();
        break;
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  if (!version) throw new Error(`调试端口 ${DEBUG_PORT} 没起来`);

  const listRes = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const targets = await listRes.json();
  const target = targets.find((t) => t.type === "page");
  if (!target) throw new Error("没有可用的页面目标");

  page = connect(target.webSocketDebuggerUrl);
  await page.ready;
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Network.setCacheDisabled", { cacheDisabled: true });

  // 先落到同源的静态文件上，只为把 origin 建起来 —— 不跑应用代码，
  // 免得 AppInit 的首次播种先写一遍，干扰"旧数据还在不在"的判断
  await goto(page, `${BASE_URL}/manifest.json`);

  const written = await evaluate(
    page,
    `(() => {
      const raw = ${JSON.stringify(seedData)};
      const asIs = ${isBackup};
      // 备份里的值已经是字符串，再 stringify 一次会写进一层多余的引号
      for (const [k, v] of Object.entries(raw)) localStorage.setItem(k, asIs ? v : JSON.stringify(v));
      return Object.keys(raw).length;
    })()`,
  );
  console.log(`▶ 已写入 ${written} 个键到浏览器 localStorage（来源：${seedLabel}）\n`);

  for (const exp of EXPECT) {
    const url = `${BASE_URL}${exp.path}?smoke=${Date.now()}`;
    await goto(page, url);

    // 先截图：probe 会把 <select> 摘掉，晚了截到的就不是完整页面了
    const shot = await page.send("Page.captureScreenshot", { format: "png" });
    const shotName = (exp.path === "/" ? "today" : exp.path.replaceAll("/", "")) + ".png";
    writeFileSync(join(OUT_DIR, shotName), Buffer.from(shot.data, "base64"));

    const text = await probe(page);

    const missing = (exp.must ?? []).filter((s) => !text.includes(s));
    const leaked = (exp.mustNot ?? []).filter((s) => text.includes(s));
    const bad = missing.length > 0 || leaked.length > 0;
    const status = bad ? "✗" : "✓";
    console.log(`${status} ${exp.label} ${exp.path}（截图 ${shotName}）`);
    if (missing.length) {
      failures.push(`${exp.label} ${exp.path} 缺少：${missing.join(" / ")}`);
      console.log(`    屏幕文字里找不到：${missing.join(" / ")}`);
    }
    if (leaked.length) {
      failures.push(`${exp.label} ${exp.path} 不该出现却出现了：${leaked.join(" / ")}`);
      console.log(`    屏幕文字里不该出现：${leaked.join(" / ")}（多半是数据缺项被当成了值）`);
    }
    if (DUMP || bad) {
      console.log("    ── 页面文字 ──");
      console.log(
        text
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => "    " + l.trim())
          .join("\n"),
      );
      console.log("    ── 结束 ──");
    }
  }

  if (failures.length) {
    console.log(`\n✗ ${failures.length} 个页面没显示出应有的内容（数据来源：${seedLabel}）：`);
    for (const f of failures) console.log("   · " + f);
    process.exitCode = 1;
  } else {
    console.log(`\n✓ ${EXPECT.length} 个页面都渲染出了注入的数据（来源：${seedLabel}）。`);
    console.log(`  截图在 ${OUT_DIR}`);
  }
} catch (e) {
  console.error("\n✗ 冒烟测试自身出错：", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  // 用 CDP 关浏览器，比 kill 干净（Edge/Chrome 会派生一堆子进程）
  try {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).catch(() => null);
    if (res?.ok) {
      const v = await res.json();
      browserLevel = connect(v.webSocketDebuggerUrl);
      await browserLevel.ready;
      await browserLevel.send("Browser.close");
    }
  } catch {
    /* 关不掉就退而求其次 */
    child.kill();
  }
  page?.close();
  browserLevel?.close();
  previewProc?.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
