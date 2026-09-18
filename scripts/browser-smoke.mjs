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

/**
 * 删临时浏览器目录：**删不掉不算失败**。
 *
 * Edge/Chrome 在 Windows 上关掉之后还会攥着 profile 里的 SQLite 一小会儿，
 * `rmSync` 直接抛 EBUSY —— 那会把一次**断言全过的绿色运行**变成非零退出码（实测撞到过）。
 * 一个"偶尔无故变红"的闸门比没有闸门更糟：人会学会忽略它。所以退避重试，最后仍失败只警告。
 */
async function removeProfileDir(dir) {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await sleep(300 * (i + 1));
    }
  }
  console.warn(`⚠ 临时浏览器目录没删掉（不影响本次结果，可手动清理）：${dir}`);
}

/**
 * 定向检查：**进度环第一次点击就该有动画**。
 *
 * 这条 bug 只能靠"时间"看出来 —— 静态截图毫无用处：首次挂载时元素已经处于最终值，
 * 截图和"动画播完了"长得一模一样。所以判据取两条，缺一不可：
 *
 * 1) **进度为 0 时那根弧线必须已经在 DOM 里。**
 *    原实现是 `{safe > 0 && <circle/>}`：0% 时压根没有这个元素，
 *    第一次点击才让它首次挂载 —— 而 CSS transition 不会在挂载时播放，
 *    于是表现为"第一次点没动画，第二次之后才有"。
 * 2) **点一下之后立刻连采样，必须出现过中间值。**
 *    中间值存在 ⇒ 它在过渡；只有首尾两值 ⇒ 直接跳过去了。
 *
 * 定位只用 `aria-label`（读屏本来就要用的东西），不碰 class 名，样式重构不会误伤它。
 */
async function checkRingAnimates(page, baseUrl, failures) {
  const RING = '[aria-label^="喝水已完成"]';
  const sel = JSON.stringify(RING);
  await goto(page, `${baseUrl}/?ring=${Date.now()}`);

  const r = await evaluate(
    page,
    `(async () => {
      const parse = (el) => parseFloat(getComputedStyle(el).strokeDashoffset);
      const ring = () => document.querySelector(${sel});
      if (!ring()) return { ok: false, why: "页面上找不到喝水进度环" };
      const arcs = () => {
        const c = ring().querySelectorAll("svg circle");
        return c[c.length - 1];
      };
      const find = (text) => [...document.querySelectorAll("button")].find((b) => b.innerText.includes(text));
      const tick = () => new Promise((res) => requestAnimationFrame(res));

      /*
       * ⚠️ 前提要自己造，不能假设数据。
       * 样例备份里"今天"的水可能本来就是满的（实测 100%），此时 offset 已经在终点，
       * 再点「＋1 杯」什么都不会变 —— 检查会以"点击没生效"的名义误报。
       * 所以先一路减到 0，再开始测"第一次点击"。
       */
      const minus = find("－1 杯");
      if (!minus) return { ok: false, why: "找不到「－1 杯」按钮" };
      for (let i = 0; i < 60 && !minus.disabled; i++) {
        minus.click();
        await tick();
      }
      await new Promise((res) => setTimeout(res, 700)); // 等过渡收尾，免得读到上一段的插值

      const label0 = ring().getAttribute("aria-label");
      const circles = ring().querySelectorAll("svg circle").length;
      const start = parse(arcs());

      const plus = find("＋1 杯");
      if (!plus) return { ok: false, why: "找不到「＋1 杯」按钮", label0, circles, start };
      if (plus.disabled) return { ok: false, why: "水减到 0 之后「＋1 杯」还是禁用的", label0, circles, start };

      plus.click();
      // 连采一整个过渡窗口（0.45s），拿到的是插值序列
      const seen = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 460) {
        await tick();
        seen.push(parse(arcs()));
      }
      await new Promise((res) => setTimeout(res, 350));
      return { ok: true, label0, circles, start, end: parse(arcs()), seen };
    })()`,
  );

  if (!r.ok) {
    failures.push(`进度环动画：${r.why}`);
    console.log(`✗ 进度环动画检查没跑成：${r.why}`);
    return;
  }

  const label = (r.label0 ?? "").replace(/喝水已完成\s*/, "");
  const between = r.seen.filter((v) => v !== r.start && v !== r.end);
  const ok = r.circles >= 2 && r.end !== r.start && between.length > 0;

  console.log(
    `${ok ? "✓" : "✗"} 进度环首次点击就有动画（起点 ${label}，弧线元素 ${r.circles} 个，` +
      `offset ${r.start.toFixed(1)} → ${r.end.toFixed(1)}，采到 ${between.length} 个中间值）`,
  );
  if (r.circles < 2) {
    failures.push(
      `进度环在 ${r.label0} 时只有 ${r.circles} 个 circle —— 弧线没挂载，「第一次点击」永远不可能有动画`,
    );
  } else if (r.end === r.start) {
    failures.push(`进度环点了「＋1 杯」之后 offset 没变（${r.start}）—— 点击没生效或环没跟着走`);
  } else if (between.length === 0) {
    failures.push(
      `进度环 offset 从 ${r.start.toFixed(1)} 一步跳到 ${r.end.toFixed(1)}，没采到中间值 —— 过渡没生效`,
    );
  }
}

// ---------- 餐次是不是真的能指定 ----------

/**
 * 「记到某一餐」要真的落到那一餐里，而不是靠时间凑巧猜对。
 *
 * 为什么非得过一遍真实 DOM：餐次要穿过
 * QuickAddCard 的 state → `recordDietEntry` → localStorage → 读取时的兜底
 * （`mealSlot ?? mealSlotFromTime(time)`）→ 分组渲染 ——
 * 中间任何一环把 slot 丢了，最后都表现成「记到别的餐去了」，
 * 而单测可以全绿（单测直接调 `recordDietEntry`，不经过界面那一层）。
 *
 * ⚠️ **不能写死「记到午餐」**：`recordDietEntry` 有按时间兜底的逻辑，
 * 而冒烟可能在中午跑 —— 那时兜底恰好也得出「午餐」，检查会变成一句空话
 * （实测：把 `mealSlot: slot` 改成 `undefined` 之后这个检查依然全绿）。
 * 所以这里**先读默认选中项（那就是按时间猜的那个）**，再刻意选一个**别的**餐次，
 * 这样只要餐次没跟着走，记录就会落在默认那一组里，计数对比立刻能看出来。
 *
 * ⚠️ **也不许假设样例数据里没有鸡蛋**：改成前后**计数对比**，
 * 无论本来有没有同类记录结论都成立（同 checkRingAnimates 先造前置条件的思路）。
 *
 * 定位用 role + aria-label（读屏本来就要用的东西），不碰 class 名。
 */
async function checkMealSlot(page, baseUrl, failures) {
  await goto(page, `${baseUrl}/diet/?meal=${Date.now()}`);

  const r = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const box = (slot) => document.querySelector('[role="group"][aria-label="' + slot + '的记录"]');
      const food = "鸡蛋";
      const countIn = (slot) => { const b = box(slot); return b ? (b.innerText.match(new RegExp(food, "g")) || []).length : -1; };
      const chips = () => {
        const g = document.querySelector('[role="group"][aria-label="记到哪一餐"]');
        return g ? [...g.querySelectorAll("button")] : [];
      };

      const group = document.querySelector('[role="group"][aria-label="记到哪一餐"]');
      if (!group) return { ok: false, why: "找不到餐次选择（aria-label=记到哪一餐）" };

      // 默认选中的那个就是「按当前时间猜」的结果 —— 我们要刻意避开它
      const all = chips();
      const picked = all.find((b) => b.getAttribute("aria-pressed") === "true");
      if (!picked) return { ok: false, why: "四个餐次里没有默认选中项 —— 默认值没生效" };
      const guess = picked.innerText.trim();
      const target = all.map((b) => b.innerText.trim()).find((s) => s && s !== guess);
      if (!target) return { ok: false, why: "找不到一个和默认不同的餐次可选" };

      const targetBox = box(target);
      if (!targetBox) return { ok: false, why: "找不到「" + target + "」那一组" };
      const before = { [target]: countIn(target), [guess]: countIn(guess) };

      const chip = all.find((b) => b.innerText.trim() === target);
      chip.click();
      await sleep(60);
      if (chip.getAttribute("aria-pressed") !== "true" || picked.getAttribute("aria-pressed") !== "false") {
        return { ok: false, why: "点了「" + target + "」但选中态没有转移过去", guess, target, before };
      }

      const ta = document.querySelector("textarea");
      if (!ta) return { ok: false, why: "找不到「记一笔」的输入框", guess, target, before };
      // React 的受控输入框：直接改 .value 不会触发 onChange，要用原型上的 setter + input 事件
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "两个鸡蛋");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(60);

      const parseBtn = [...document.querySelectorAll("button")].find((b) => b.innerText.includes("看看算成什么"));
      if (!parseBtn || parseBtn.disabled) return { ok: false, why: "「看看算成什么」按钮不可用", guess, target, before };
      parseBtn.click();
      await sleep(350);

      const saveBtn = [...document.querySelectorAll("button")].find((b) => b.innerText.includes("记到" + target));
      if (!saveBtn) return { ok: false, why: "解析之后没出现写着「记到" + target + "」的保存按钮", guess, target, before };
      const label = saveBtn.innerText;
      if (saveBtn.disabled) return { ok: false, why: "「记到" + target + "」是禁用的（没解析出可记的条目）", guess, target, before, label };
      saveBtn.click();
      await sleep(350);

      return { ok: true, guess, target, label, before, after: { [target]: countIn(target), [guess]: countIn(guess) } };
    })()`,
  );

  if (!r.ok) {
    failures.push(`餐次检查：${r.why}`);
    console.log(`✗ 餐次检查没跑成：${r.why}`);
    return;
  }

  // 再刷一次，确认是**存下来了**而不是只活在内存里
  await goto(page, `${baseUrl}/diet/?meal2=${Date.now()}`);
  const after = await evaluate(
    page,
    `(() => {
      const count = (slot) => {
        const b = document.querySelector('[role="group"][aria-label="' + slot + '的记录"]');
        return b ? (b.innerText.match(/鸡蛋/g) || []).length : -1;
      };
      return { [${JSON.stringify(r.target)}]: count(${JSON.stringify(r.target)}), [${JSON.stringify(r.guess)}]: count(${JSON.stringify(r.guess)}) };
    })()`,
  );

  const t0 = r.before[r.target];
  const t1 = r.after[r.target];
  const t2 = after[r.target];
  const g0 = r.before[r.guess];
  const g2 = after[r.guess];
  const ok = t1 === t0 + 1 && t2 === t0 + 1 && g2 === g0;

  console.log(
    `${ok ? "✓" : "✗"} 记到「${r.target}」就落在「${r.target}」（默认按时间猜的是「${r.guess}」，按钮「${r.label}」；` +
      `${r.target} ${t0} → 内存 ${t1} / 刷新后 ${t2}，${r.guess} ${g0} → ${g2}）`,
  );

  if (t1 !== t0 + 1) {
    failures.push(
      `选了「${r.target}」后记下，那一组的条目没有增加（${t0} → ${t1}）—— 餐次没跟着走（多半落到了默认的「${r.guess}」）`,
    );
  } else if (t2 !== t0 + 1) {
    failures.push(`「${r.target}」那一组刷新后条目数对不上（记之前 ${t0}，刷新后 ${t2}）—— 餐次没被持久化`);
  }
  if (g2 !== g0) {
    failures.push(
      `「${r.guess}」那一组凭空多出了记录（${g0} → ${g2}）—— 餐次落到了别处，说明用户选的餐次被忽略了`,
    );
  }
}

// ---------- 「一顿饭」预设能不能真落多条 ----------

/**
 * 点「一顿饭 → 两菜一汤」，验证一次落 4 条到选中的餐次。
 *
 * 为什么要单独过一遍真实 DOM：预设展开 → rowsFromPreset → saveAll(批量)
 * → recordDietEntries → 分组渲染，中间任何一环把「批量」丢了（比如退化成逐条
 * 或只记了第一条），最后都表现成「这一顿只落了一条」，单测直接调数据层是发现不了的。
 *
 * 计数标记用「红烧肉」——它是「两菜一汤」预设独有的食物，且不会被
 * checkMealSlot 记的「鸡蛋」或其它文本解析误伤，前后计数对比才稳。
 *
 * ⚠️ 自证口径与 checkMealSlot 一致：先读默认选中餐次、再刻意选一个不同的，
 * 避免「按时间兜底」把丢餐次的 bug 救回来。
 */
async function checkMealPreset(page, baseUrl, failures) {
  await goto(page, `${baseUrl}/diet/?preset=${Date.now()}`);

  const r = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const box = (slot) => document.querySelector('[role="group"][aria-label="' + slot + '的记录"]');
      const mark = "红烧肉";
      const countIn = (slot) => { const b = box(slot); return b ? (b.innerText.match(new RegExp(mark, "g")) || []).length : -1; };
      const chips = () => {
        const g = document.querySelector('[role="group"][aria-label="记到哪一餐"]');
        return g ? [...g.querySelectorAll("button")] : [];
      };

      const group = document.querySelector('[role="group"][aria-label="记到哪一餐"]');
      if (!group) return { ok: false, why: "找不到餐次选择" };
      const all = chips();
      const picked = all.find((b) => b.getAttribute("aria-pressed") === "true");
      if (!picked) return { ok: false, why: "没有默认选中餐次" };
      const guess = picked.innerText.trim();
      const target = all.map((b) => b.innerText.trim()).find((s) => s && s !== guess);
      if (!target) return { ok: false, why: "找不到与默认不同的餐次" };
      const targetBox = box(target);
      if (!targetBox) return { ok: false, why: "找不到「" + target + "」分组" };
      const before = { [target]: countIn(target), [guess]: countIn(guess) };

      // 选目标餐次
      const chip = all.find((b) => b.innerText.trim() === target);
      chip.click();
      await sleep(60);

      // 点「一顿饭」展开预设面板
      const mealBtn = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "一顿饭");
      if (!mealBtn) return { ok: false, why: "找不到「一顿饭」按钮" };
      mealBtn.click();
      await sleep(80);

      // 点「两菜一汤」
      const presetBtn = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "两菜一汤");
      if (!presetBtn) return { ok: false, why: "找不到「两菜一汤」预设" };
      presetBtn.click();
      await sleep(200);

      // 保存按钮应写着「记到<餐次>· 4 条」
      const saveBtn = [...document.querySelectorAll("button")].find((b) => b.innerText.includes("记到" + target) && b.innerText.includes("4 条"));
      if (!saveBtn) return { ok: false, why: "没出现写着「记到" + target + "· 4 条」的保存按钮", guess, target, before };
      if (saveBtn.disabled) return { ok: false, why: "「记到" + target + "· 4 条」被禁用（预设没展开成 4 条）", guess, target, before };
      const label = saveBtn.innerText;
      saveBtn.click();
      await sleep(350);

      return { ok: true, guess, target, label, before, after: { [target]: countIn(target), [guess]: countIn(guess) } };
    })()`,
  );

  if (!r.ok) {
    failures.push(`一顿饭预设：${r.why}`);
    console.log(`✗ 一顿饭预设检查没跑成：${r.why}`);
    return;
  }

  // 刷新确认持久化
  await goto(page, `${baseUrl}/diet/?preset2=${Date.now()}`);
  const after = await evaluate(
    page,
    `(() => {
      const count = (slot) => {
        const b = document.querySelector('[role="group"][aria-label="' + slot + '的记录"]');
        return b ? (b.innerText.match(/红烧肉/g) || []).length : -1;
      };
      return { [${JSON.stringify(r.target)}]: count(${JSON.stringify(r.target)}), [${JSON.stringify(r.guess)}]: count(${JSON.stringify(r.guess)}) };
    })()`,
  );

  const t0 = r.before[r.target];
  const t1 = r.after[r.target];
  const t2 = after[r.target];
  const g0 = r.before[r.guess];
  const g2 = after[r.guess];
  const ok = t1 === t0 + 1 && t2 === t0 + 1 && g2 === g0;

  console.log(
    `${ok ? "✓" : "✗"} 「一顿饭·两菜一汤」一次落下含「红烧肉」的那批到「${r.target}」（按钮「${r.label}」；` +
      `${r.target} ${t0} → 内存 ${t1} / 刷新后 ${t2}，${r.guess} ${g0} → ${g2}）`,
  );

  if (t1 !== t0 + 1) {
    failures.push(`点「两菜一汤」记下后，「${r.target}」组里没新增红烧肉（${t0} → ${t1}）—— 预设没落库或落错了餐次`);
  } else if (t2 !== t0 + 1) {
    failures.push(`「${r.target}」组刷新后红烧肉对不上（${t0} → ${t2}）—— 预设批量落库没被持久化`);
  }
  if (g2 !== g0) {
    failures.push(`「${g.guess}」组凭空多了红烧肉（${g0} → ${g2}）—— 用户选的餐次被忽略`);
  }
}

// ---------- 份量档位：点一下真的改了克数，而且改的是落库那个数 ----------

/**
 * 「记一笔」解析出的每条，克数旁有一排档位（「一包 · 70g」「大包 · 135g」）。
 *
 * 为什么要过一遍真实 DOM：解析层算的克数 → chips 的选项 → 点击后的 setState
 * → 落库的 `grams`，中间任何一环把克数丢了，最后都表现成"点了没反应"或者
 * "界面变了但存下去的还是旧值"。单测直接调 `resolveText` 是发现不了的。
 *
 * ⚠️ **必须先读默认克数、再点一个别的档位**（地雷 22）。
 * 输入「一包薯片」时默认就是「一包 70g」；如果直接断言"点完是 70"，
 * 那么在 `onPick` 压根没接上时这个检查**照样全绿**。
 * 所以这里先读默认值，再刻意点「大包」——只有它真的变了才算过。
 * 期望值从 chip 文本里解析（「大包 · 135g」→135），不写死数字，
 * 免得以后调份量表时这里莫名其妙地红。
 *
 * 定位用 `aria-label="克数"`（读屏本来就要用的东西），不碰 class 名。
 */
async function checkPortionChip(page, baseUrl, failures) {
  await goto(page, `${baseUrl}/diet/?portion=${Date.now()}`);

  const r = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const btn = (text) => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === text);

      const ta = [...document.querySelectorAll("textarea")].find((t) => (t.placeholder || "").includes("说一句就行"));
      if (!ta) return { ok: false, why: "找不到「记一笔」的输入框" };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "一包薯片");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(80);

      const parseBtn = [...document.querySelectorAll("button")].find((b) => b.innerText.includes("看看算成什么"));
      if (!parseBtn) return { ok: false, why: "找不到「看看算成什么」按钮" };
      parseBtn.click();
      await sleep(320);

      const gramsEl = () => document.querySelector('input[aria-label="克数"]');
      if (!gramsEl()) return { ok: false, why: "解析结果里没有克数输入框（aria-label=克数）" };
      const before = gramsEl().value;

      const chips = [...document.querySelectorAll("button")].filter((b) => /·\\s*\\d+g$/.test(b.innerText.trim()));
      if (!chips.length) return { ok: false, why: "克数旁没有出现份量档位", before };
      const target = chips.find((b) => b.innerText.includes("大包"));
      if (!target) return { ok: false, why: "档位里没有「大包」", chips: chips.map((b) => b.innerText.trim()), before };

      const expected = Number((target.innerText.match(/(\\d+)g/) || [])[1]);
      if (!expected) return { ok: false, why: "从档位文本里读不出克数：" + target.innerText, before };
      if (String(expected) === before) {
        return { ok: false, why: "要点的档位和默认克数一样（都是 " + before + "），测不出差别", before };
      }

      target.click();
      await sleep(150);
      const after = gramsEl().value;

      const saveBtn = [...document.querySelectorAll("button")].find((b) => b.innerText.includes("记到") && b.innerText.includes("条"));
      if (!saveBtn) return { ok: false, why: "找不到保存按钮", before, after, expected };
      saveBtn.click();
      await sleep(380);

      const log = JSON.parse(localStorage.getItem("recipe.dietLog.v1") || "[]");
      const hit = log.filter((e) => e && e.name === "薯片").sort((a, b) => b.createdAt - a.createdAt)[0];
      return { ok: true, before, after, expected, saved: hit ? hit.grams : null, chip: target.innerText.trim() };
    })()`,
  );

  if (!r.ok) {
    failures.push(`份量档位：${r.why}`);
    console.log(`✗ 份量档位检查没跑成：${r.why}`);
    return;
  }

  const changed = r.after === String(r.expected) && r.after !== r.before;
  const persisted = r.saved === r.expected;
  const ok = changed && persisted;

  console.log(
    `${ok ? "✓" : "✗"} 点份量档位「${r.chip}」后克数 ${r.before} → ${r.after}（期望 ${r.expected}），` +
      `落库 ${r.saved}g`,
  );
  if (!changed) {
    failures.push(`点了「${r.chip}」但界面克数没跟着变（${r.before} → ${r.after}）—— 档位没接上克数那一格`);
  } else if (!persisted) {
    failures.push(
      `界面显示 ${r.after}g，落库却是 ${r.saved}g —— 点档位改的只是显示，没进保存那一步`,
    );
  }
}

// ---------- 已落库那条记录：档位能换 + 「这个数不对？」 ----------

/**
 * 0.12.0 加在**已落库记录**上的两件事（不是「记一笔」预览框里那排档位）：
 *   ① 这条当时按哪一档算的，当场能点着换；
 *   ② 觉得数字不对时写一句质疑 —— **没配 Key 也要能拿到一段可贴的文本**。
 *
 * 三件事必须一起钉住：
 *   1) **换档改的是落库的克数**，不只改屏幕。和 `checkPortionChip` 同一个理由，
 *      只是对象换成了历史记录（走 `editDietEntry`，营养快照要跟着重算）。
 *   2) **没填 Key 时入口照样在。** 少了这条路，没配 Key 的用户连「这个数不对」都说不出来。
 *   3) **那段文本只含这一笔。** 这是脱敏的最后一环：上下文里要是混进健康档案
 *      或同一顿饭的别的记录，用户一点「复制」就全贴到公开 issue 上了，而屏幕上完全看不出来。
 *
 * ⚠️ 前置自己造（地雷 18），而且**故意留一条别的记录 + 一份健康档案**在那儿：
 * 哪天 `buildIssueText` 顺手把当天汇总也带上，那两样会立刻出现在文本里 ——
 * 只断言「文本里有饺子」的话，一个把整页 innerText 当反馈文本的实现照样全绿。
 *
 * ⚠️ 断言里那两个档案数字是**挑过的**：172 / 61.5 不是这一笔任何数字（15、450、1080、
 * 1860、30）的子串，所以「文本里出现了 172」只可能是档案真的漏了（地雷 23 的同款顾虑）。
 */
async function checkEntryFeedback(page, baseUrl, failures) {
  const LEAK_NAME = "另一笔不该出现的记录";
  const LEAK_ALLERGY = "冒烟过敏原XYZ";
  const LEAK_CONDITION = "冒烟病史XYZ";
  const LEAK_HEIGHT = 172;
  const LEAK_WEIGHT = 61.5;
  const DOUBT = "15 个饺子不该这么多钠";

  await goto(page, `${baseUrl}/diet/?entryfb=${Date.now()}`);

  // ---- 1) 造前置：饺子 15 个（按中号 20g 落库）+ 一条别的记录 + 一份档案，并且先不放 Key ----
  await evaluate(
    page,
    `(() => {
      const d = new Date();
      const pad = (n) => (n < 10 ? "0" + n : String(n));
      const today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      const at = Date.now();
      localStorage.setItem("recipe.dietLog.v1", JSON.stringify([
        { id: "smoke-fb-jiaozi", date: today, time: "12:10", mealSlot: "午餐", foodId: "dumpling-pork",
          name: "饺子", category: "staple", amount: 15, unitLabel: "个", grams: 300,
          nutrition: { kcal: 720, protein: 24, fat: 30, carb: 84, sodium: 1860, fiber: 4.5 },
          source: "db", createdAt: at },
        { id: "smoke-fb-other", date: today, time: "12:11", mealSlot: "午餐",
          name: ${JSON.stringify(LEAK_NAME)}, amount: 1, unitLabel: "份", grams: 100,
          nutrition: { kcal: 200, protein: 5, fat: 5, carb: 30, sodium: 100 },
          source: "custom", createdAt: at + 1 }
      ]));
      localStorage.setItem("recipe.healthProfile.v1", JSON.stringify({
        sex: "男", age: 33, heightCm: ${LEAK_HEIGHT}, weightKg: ${LEAK_WEIGHT},
        activityLevel: "久坐少动", goal: "维持健康",
        allergies: ${JSON.stringify(LEAK_ALLERGY)}, conditions: ${JSON.stringify(LEAK_CONDITION)},
        updatedAt: at
      }));
      localStorage.removeItem("recipe.apikeys.v1");
      window.dispatchEvent(new Event("yq:data-changed"));
      return today;
    })()`,
  );

  // 重新进页面，让服务端渲染出来的就是这份数据（不依赖广播时序）
  await goto(page, `${baseUrl}/diet/?entryfb2=${Date.now()}`);

  const r = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const tierBoxes = () => [...document.querySelectorAll('[data-yq="entry-tier"]')];
      const jiaozi = () => JSON.parse(localStorage.getItem("recipe.dietLog.v1") || "[]").find((e) => e.id === "smoke-fb-jiaozi");

      for (let i = 0; i < 30 && !tierBoxes().length; i++) await sleep(100);
      if (!tierBoxes().length) return { ok: false, why: "饺子的那条记录没出现档位行（data-yq=entry-tier）" };
      if (tierBoxes().length !== 1) {
        return { ok: false, why: "档位行出现了 " + tierBoxes().length + " 个 —— 只有多档食物才该有这一行",
                 boxes: tierBoxes().map((b) => b.innerText.trim()) };
      }
      const box = tierBoxes()[0];
      const tierText = box.innerText;
      const chips = [...box.querySelectorAll("button")].filter((b) => /·\\s*\\d+g\\s*$/.test(b.innerText.trim()));
      const big = chips.find((b) => b.innerText.includes("大"));
      if (!big) return { ok: false, why: "档位里没有「大」", chips: chips.map((b) => b.innerText.trim()), tierText };
      const perUnit = Number((big.innerText.match(/(\\d+)g/) || [])[1]);

      const beforeGrams = jiaozi().grams;
      const beforeKcal = jiaozi().nutrition.kcal;

      big.click();
      await sleep(400);
      const after = jiaozi();
      const tierTextAfter = tierBoxes().length ? tierBoxes()[0].innerText : "";

      // ---- 「这个数不对？」：没填 Key，应当直接给反馈文本 ----
      const doubtBtn = document.querySelector('[data-yq="entry-doubt"]');
      if (!doubtBtn) return { ok: false, why: "记录旁边没有「这个数不对？」入口" };
      doubtBtn.click();
      await sleep(200);
      const panel = document.querySelector('[data-yq="entry-feedback"]');
      if (!panel) return { ok: false, why: "点了入口没出现写质疑的面板（data-yq=entry-feedback）" };
      const ta = panel.querySelector('textarea[aria-label="你觉得哪里不对"]');
      if (!ta) return { ok: false, why: "面板里没有写质疑的输入框" };

      const btnByLabel = () => [...panel.querySelectorAll("button")].find((b) => /生成反馈文本|让它分析一下/.test(b.innerText));
      const noKeyLabel = btnByLabel() ? btnByLabel().innerText.trim() : "";

      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, ${JSON.stringify(DOUBT)});
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(120);

      const submitBtn = btnByLabel();
      if (!submitBtn) return { ok: false, why: "面板里找不到提交按钮", noKeyLabel };
      if (submitBtn.disabled) return { ok: false, why: "写完质疑了，提交按钮还是禁用的", noKeyLabel };
      submitBtn.click();
      await sleep(500);

      const pres = [...panel.querySelectorAll("pre")].map((p) => p.innerText);
      const issue = pres.length ? pres[pres.length - 1] : "";
      const copyBtn = [...panel.querySelectorAll("button")].find((b) => /复制这段|已复制/.test(b.innerText));
      const ghLink = [...panel.querySelectorAll("a")].find((a) => (a.href || "").includes("github.com"));

      // 「复制」点下去必须有反应：要么变成「已复制」，要么明说复制不了。
      // ⚠️ 这里**不去读剪贴板内容** —— 无头浏览器没焦点时 writeText 本来就常被拒，
      // 断言真内容会让检查随机变红。要钉的是「不会静默什么都不做」。
      let copyState = "(没有复制按钮)";
      if (copyBtn) {
        copyBtn.click();
        await sleep(350);
        const txt = (document.querySelector('[data-yq="entry-feedback"]') || panel).innerText;
        copyState = txt.includes("已复制") ? "已复制" : (txt.includes("复制不了") ? "明确报错" : "(点了没反应)");
      }

      return {
        ok: true, tierText, tierTextAfter, chip: big.innerText.trim(), perUnit,
        beforeGrams, afterGrams: after.grams, beforeKcal, afterKcal: after.nutrition.kcal,
        noKeyLabel, issue, copyState, hasLink: !!ghLink,
        linkHref: ghLink ? ghLink.href : "", panelText: panel.innerText,
      };
    })()`,
  );

  if (!r.ok) {
    failures.push(`已落库记录的档位与质疑入口：${r.why}`);
    console.log(`✗ 已落库记录的档位与质疑入口没跑成：${r.why}`);
    if (r.boxes) console.log(`   实际出现的档位行：${JSON.stringify(r.boxes)}`);
    if (r.chips) console.log(`   实际出现的档位：${JSON.stringify(r.chips)}`);
    return;
  }

  const expectedGrams = Math.round(r.perUnit * 15 * 10) / 10;
  const saidTier = r.tierText.includes("按「中」算的") && r.tierText.includes("3 档");
  const tierReflected = r.tierTextAfter.includes("按「大」算的");
  const gramsChanged = r.afterGrams === expectedGrams && r.afterGrams !== r.beforeGrams;
  // 换档后营养快照要跟着重算：每克口径不变、总量变大
  const perGramBefore = r.beforeKcal / r.beforeGrams;
  const perGramAfter = r.afterKcal / r.afterGrams;
  const kcalRecalc = Math.abs(perGramAfter - perGramBefore) < 0.005 && r.afterKcal > r.beforeKcal;
  const noKeyPath = r.noKeyLabel === "生成反馈文本";
  const hasFacts = r.issue.includes("饺子") && r.issue.includes("15 个") && r.issue.includes(DOUBT);
  const hasUrl = r.issue.includes("github.com/Orang1ver/yuanqi-ledger/issues");
  const copyWorks = r.copyState === "已复制" || r.copyState === "明确报错";

  const leaks = [
    [LEAK_NAME, "同一顿饭里另一条记录的名字"],
    [LEAK_ALLERGY, "健康档案里的过敏项"],
    [LEAK_CONDITION, "健康档案里的身体状况"],
    [String(LEAK_HEIGHT), "健康档案里的身高"],
    [String(LEAK_WEIGHT), "健康档案里的体重"],
    ["身高", "健康档案的字段名"],
    ["体重", "健康档案的字段名"],
    ["BMI", "健康档案的字段名"],
  ].filter(([needle]) => r.issue.includes(needle));

  const ok =
    saidTier && tierReflected && gramsChanged && kcalRecalc && noKeyPath &&
    hasFacts && hasUrl && copyWorks && leaks.length === 0 && r.hasLink;

  console.log(
    `${ok ? "✓" : "✗"} 已落库记录：档位写「${saidTier ? "中" : "?"}」→ 点「${r.chip}」后 ` +
      `克数 ${r.beforeGrams}→${r.afterGrams}（期望 ${expectedGrams}）、` +
      `热量快照 ${r.beforeKcal}→${r.afterKcal}；质疑入口无 Key 时按钮写「${r.noKeyLabel}」，` +
      `反馈文本 ${r.issue.length} 字、复制反馈「${r.copyState}」、档案泄漏 ${leaks.length} 处`,
  );

  if (!saidTier) failures.push(`档位行没写明「按「中」算的」/「3 档」：${r.tierText.replace(/\n/g, " / ")}`);
  if (!gramsChanged) {
    failures.push(
      `点档位后落库克数是 ${r.afterGrams}，期望 ${expectedGrams}（改前 ${r.beforeGrams}）—— 换档没改到落库那个数`,
    );
  }
  if (!kcalRecalc) {
    failures.push(
      `换档后热量快照没跟着重算：${r.beforeGrams}g/${r.beforeKcal}kcal → ${r.afterGrams}g/${r.afterKcal}kcal`,
    );
  }
  if (!tierReflected) failures.push("换了档位，说明文字还写着原来那一档 —— 反推没跟上");
  if (!noKeyPath) {
    failures.push(`没填 Key 时按钮写的是「${r.noKeyLabel}」—— 没配 Key 的用户该能直接拿到反馈文本`);
  }
  if (!hasFacts) failures.push(`反馈文本里缺事实或用户的疑问（${r.issue.length} 字）`);
  if (!hasUrl) failures.push("反馈文本里没有 GitHub issue 地址，用户不知道往哪贴");
  if (!copyWorks) failures.push(`点了「复制这段」${r.copyState} —— 复制要么成功、要么明说不行`);
  if (!r.hasLink) failures.push("反馈文本旁边没有「去 GitHub 提」的链接");
  for (const [needle, what] of leaks) {
    failures.push(`反馈文本里漏出了${what}「${needle}」—— 这段是要贴到公开 issue 的`);
  }
}

// ---------- 周报的睡眠与心情：没记录时不许显示 0 ----------

/**
 * 周报页新加的「睡眠与心情」卡。
 *
 * 这里真正要钉住的只有一件事：**「没有记录」不是 0**（地雷 11/17）。
 * 一晚都没记时如果平均算成 0，屏幕上会理直气壮地写「平均睡 0 小时」——
 * 那是个吓人的假结论，而它看起来和真数据一模一样。
 *
 * 所以检查分两半：
 *   ① 样例数据本来有睡眠记录 → 必须出现「平均睡」；此时不该出现「平均睡 0 小时」；
 *   ② 把 dailyCheckins 里的 sleepHours/mood 全删掉、重新进页面 →
 *      必须出现「这周没记」，而且**依然不许**出现「0 小时」。
 * 只做 ① 的话，`avgSleep` 写成 0 时照样能过 —— 所以 ② 才是关键那一半。
 */
async function checkWellness(page, baseUrl, failures) {
  await goto(page, `${baseUrl}/weekly/?wellness=${Date.now()}`);

  const withData = await evaluate(
    page,
    `(() => {
      const t = document.body.innerText;
      return { hasCard: t.includes("睡眠与心情"), hasAvg: t.includes("平均睡"), zero: /平均睡\\s*0\\s*小时/.test(t) };
    })()`,
  );

  // 把**睡眠**从打卡记录里抹掉，但**保留心情**。
  //
  // ⚠️ 这一步的前置是精心挑的（地雷 23 的教训）：两张都抹掉的话，卡片会走
  // 「这周没记睡眠和心情」的空态，`avgSleep` 是 null 还是 0 根本露不出来 ——
  // 第一版就是这么写的，把 `null` 改成 `0` 之后检查照样全绿。
  // 留着心情，卡片就必须走有数据那一支，这时「没有睡眠记录却显示平均睡 0 小时」
  // 才会真的画到屏幕上。
  const wiped = await evaluate(
    page,
    `(() => {
      const raw = localStorage.getItem("recipe.dailyCheckins.v1");
      if (!raw) return false;
      const obj = JSON.parse(raw);
      for (const k of Object.keys(obj)) {
        if (obj[k] && typeof obj[k] === "object") delete obj[k].sleepHours;
      }
      localStorage.setItem("recipe.dailyCheckins.v1", JSON.stringify(obj));
      return true;
    })()`,
  );

  if (!wiped) {
    failures.push("睡眠与心情：样例数据里没有 recipe.dailyCheckins.v1，检查的前置没成立");
    console.log("✗ 睡眠与心情：没有打卡数据可清，检查没跑成");
    return;
  }

  await goto(page, `${baseUrl}/weekly/?wellness2=${Date.now()}`);
  const withoutData = await evaluate(
    page,
    `(() => {
      const t = document.body.innerText;
      return {
        stillHasMood: t.includes("状态不错") || t.includes("比较累"),
        hasAvg: t.includes("平均睡"),
        zero: /平均睡\\s*0\\s*小时/.test(t),
      };
    })()`,
  );

  const ok =
    withData.hasCard &&
    withData.hasAvg &&
    withoutData.stillHasMood &&
    !withoutData.hasAvg &&
    !withData.zero &&
    !withoutData.zero;

  console.log(
    `${ok ? "✓" : "✗"} 周报「睡眠与心情」：有记录时显示平均睡眠；只抹掉睡眠后仍显示心情、` +
      `但不再谈平均睡眠（0 小时出现次数：有数据 ${withData.zero ? 1 : 0} / 无睡眠 ${withoutData.zero ? 1 : 0}）`,
  );

  if (!withData.hasCard) failures.push("周报页没有「睡眠与心情」这张卡 —— 睡眠和心情的字段一直没人用");
  else if (!withData.hasAvg) failures.push("样例数据里有睡眠记录，周报却没显示「平均睡」");
  else if (!withoutData.stillHasMood) failures.push("心情记录还在，卡片却整个退成了空态 —— 有数据的那一支没走到");
  else if (withoutData.hasAvg) failures.push("一晚睡眠都没记，周报却还在显示「平均睡」");
  if (withData.zero || withoutData.zero) {
    failures.push("周报出现了「平均睡 0 小时」—— 那是把「没记」说成了「睡了 0 小时」");
  }
}

// ---------- 「帮我挑」：无 Key 隐藏 / 有 Key 走通 / 模型数字不上屏 ----------

/**
 * 首页推荐卡的「✨ 帮我挑」。
 *
 * 这条检查要同时钉住四件事，任何一件松掉都该立刻变红：
 *
 * 1) **没填 Key 时按钮不出现。** 一个点了只会报错的按钮比没有按钮更烦人。
 *    所以先删掉 `recipe.apikeys.v1`，断言页面上找不到这个按钮。
 * 2) **填了 Key 就立刻出现，不用刷新。** 写完 Key 后只 dispatch 一次
 *    `yq:data-changed`（这正是 SettingsDialog 保存 Key 后做的事）——
 *    少了这次广播，用户粘完 Key 回首页什么也不会发生，他会以为没生效。
 * 3) **白名单说了算，不是模型说了算。** 拦截器故意回一道菜单里根本没有的菜，
 *    它**不许**出现在屏幕上。
 * 4) **模型嘴里的数字不上屏。** 回包里塞 `kcal: 99999`、理由里硬写「大约 12345 kcal」，
 *    两者都不许出现在屏幕文字里；而本地算出来的热量必须照常画出来。
 *
 * ⚠️ 前置状态**自己造**，不依赖 fixtures：样本库里的「拌面」在食物库里查不到，
 * `estimateDish` 会判成「估不出来」而不进候选池 —— 拿它当断言词会测了个寂寞。
 * 所以这里写一份自己知道成分的菜单（番茄蛋汤 / 红烧肉 / 清炒时蔬 / 蛋炒饭，
 * 四道在库里都能整名命中），再写一顿钠超标的午饭把缺口坐实。
 *
 * ⚠️ 断言用**请求真的发出去了**（calls/auth/prompt 里有没有那道菜）来兜底：
 * 只断言"屏幕上出现了菜名"的话，本地推荐那一路也可能恰好推出同一道菜，
 * 检查会在接口根本没被调用的情况下全绿。
 */

// ---------- 久未备份提醒 ----------

/**
 * 「久未备份」横幅。
 *
 * 数据只在这台设备的 localStorage 里，清一次缓存就真没了 ——
 * 导出能力早就写在设置页，但**用户不会主动去点一个他没理由点的按钮**。
 *
 * 这条检查钉的是「该出现的出现，不该出现的别出现」：
 *  - 刚打开（样例数据刚导入）时**不许**出现；
 *  - 自己把「第一次打开」推到 60 天前之后**必须**出现，并带上天数；
 *  - 点「稍后」后消失，且静默期真的写进了 localStorage；
 *  - 点「导出备份」后消失，且「上次备份时间」真的落了库。
 *
 * ⚠️ 前置状态**自己造**（地雷 18）：样例数据刚导入时 `firstSeenAt` 就是"今天"，
 * 拿它当"超期"的对照，前半段会绿，后半段永远测不到。
 *
 * ⚠️ 定位用 `[data-yq="backup-reminder"]`，**不靠按钮文案**：
 * 设置页里也有一个「导出备份」按钮，靠文本子串定位迟早被别处的文案救活（地雷 24）。
 */
async function checkBackupReminder(page, baseUrl, failures) {
  const KEY = "recipe.backupReminder.v1";

  // ① 刚打开：什么都没超期，横幅不许出现
  await goto(page, `${baseUrl}/?backup0=${Date.now()}`);
  const fresh = await evaluate(
    page,
    `(() => ({
      shown: !!document.querySelector('[data-yq="backup-reminder"]'),
      stored: localStorage.getItem("${KEY}") !== null,
    }))()`,
  );

  // ② 造前置：把「第一次打开」推到 60 天前
  const aged = await evaluate(
    page,
    `(() => {
      const raw = localStorage.getItem("${KEY}");
      if (!raw) return false;
      const o = JSON.parse(raw);
      o.firstSeenAt = new Date(Date.now() - 60 * 86400000).toISOString();
      o.lastBackupAt = null;
      o.snoozedUntil = null;
      localStorage.setItem("${KEY}", JSON.stringify(o));
      return true;
    })()`,
  );

  if (!aged) {
    failures.push(`久未备份提醒：第一次打开时没有写下 ${KEY} —— 状态没初始化，这条检查没跑成`);
    console.log("✗ 久未备份提醒：状态键没被初始化，检查没跑成");
    return;
  }

  // ③ 超期了：横幅必须出现，并带上真实天数
  await goto(page, `${baseUrl}/?backup1=${Date.now()}`);
  const overdue = await evaluate(
    page,
    `(() => {
      const el = document.querySelector('[data-yq="backup-reminder"]');
      if (!el) return { shown: false };
      const m = el.innerText.match(/已经\\s*(\\d+)\\s*天/);
      return { shown: true, days: m ? Number(m[1]) : null, hasLater: !!el.innerText.includes("稍后") };
    })()`,
  );

  // ④ 点「稍后」：横幅消失，静默期写进库
  const snoozed = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const el = document.querySelector('[data-yq="backup-reminder"]');
      if (!el) return { clicked: false };
      const later = [...el.querySelectorAll("button")].find((b) => b.innerText.includes("稍后"));
      if (!later) return { clicked: false };
      later.click();
      await sleep(350);
      const o = JSON.parse(localStorage.getItem("${KEY}") || "{}");
      return {
        clicked: true,
        gone: !document.querySelector('[data-yq="backup-reminder"]'),
        snoozeAt: o.snoozedUntil ?? null,
      };
    })()`,
  );

  // ⑤ 解除静默让它回来，再点「导出备份」
  await evaluate(
    page,
    `(() => {
      const o = JSON.parse(localStorage.getItem("${KEY}") || "{}");
      o.snoozedUntil = null;
      localStorage.setItem("${KEY}", JSON.stringify(o));
      return true;
    })()`,
  );
  await goto(page, `${baseUrl}/?backup2=${Date.now()}`);
  const exported = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const el = document.querySelector('[data-yq="backup-reminder"]');
      if (!el) return { clicked: false };
      const btn = [...el.querySelectorAll("button")].find((b) => b.innerText.includes("导出备份"));
      if (!btn) return { clicked: false };
      btn.click();
      await sleep(350);
      const o = JSON.parse(localStorage.getItem("${KEY}") || "{}");
      return {
        clicked: true,
        gone: !document.querySelector('[data-yq="backup-reminder"]'),
        lastBackupAt: o.lastBackupAt ?? null,
      };
    })()`,
  );

  const problems = [];
  if (!fresh.stored) problems.push("第一次打开时没有写下备份提醒的状态键");
  if (fresh.shown) problems.push("刚打开就在提醒备份 —— 提醒太早，用户会学会无视它");
  if (!overdue.shown) problems.push("「第一次打开」在 60 天前，横幅却没出现");
  else if (overdue.days === null || overdue.days < 30) {
    problems.push(`横幅出现了，天数却读不出来或不合理（读到 ${overdue.days}）`);
  }
  if (overdue.shown && !overdue.hasLater) problems.push("超期横幅上没有「稍后」按钮");
  else if (snoozed.clicked && !snoozed.gone) problems.push("点了「稍后」，横幅没消失");
  else if (snoozed.clicked && !snoozed.snoozeAt) problems.push("点了「稍后」，静默期没写进 localStorage");
  if (exported.clicked && !exported.gone) problems.push("点了「导出备份」，横幅没消失");
  if (exported.clicked && !exported.lastBackupAt) {
    problems.push("点了「导出备份」，「上次备份时间」没落库 —— 下次打开还会接着提醒");
  }

  const ok = problems.length === 0;
  console.log(
    `${ok ? "✓" : "✗"} 久未备份提醒：刚打开${fresh.shown ? "出现了（不该）" : "不打扰"}；` +
      `推到 60 天前 → ${overdue.shown ? `出现，读到 ${overdue.days} 天` : "没出现"}；` +
      `点「稍后」${snoozed.clicked ? (snoozed.gone ? "消失" : "没消失") : "按钮没找到"}；` +
      `点「导出备份」${exported.clicked ? (exported.lastBackupAt ? "记下了备份时间" : "没记下时间") : "按钮没找到"}`,
  );
  failures.push(...problems.map((p) => `久未备份提醒：${p}`));
}

// ---------- 导入预览与「整份覆盖」的撤销 ----------

/**
 * 打开设置面板。
 *
 * 它按需动态 import（见 SettingsButton），点完要等它真的挂上来 ——
 * 直接 sleep 一个拍脑袋的毫秒数在慢机器上会偶发失败。
 */
async function openSettings(page) {
  const clicked = await evaluate(
    page,
    `(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("设置"));
      if (!b) return false;
      b.click();
      return true;
    })()`,
  );
  if (!clicked) return false;
  for (let i = 0; i < 25; i++) {
    const ready = await evaluate(page, `!!document.querySelector('input[type="file"]')`).catch(() => false);
    if (ready) return true;
    await sleep(200);
  }
  return false;
}

/**
 * 导入这条路的安全网。
 *
 * 换掉的是原来那串嵌套 `window.confirm`：它在用户**还没看到这份备份里有什么**之前，
 * 就让他做一个不可逆的选择（「整份覆盖」），而且没有快照、没有撤销。
 *
 * 四条断言：
 *  ① 选定文件后出现预览面板，且**一次原生弹窗都没弹**；
 *  ② 面板数出来的条数与备份内容一致；
 *  ③ 「整份覆盖」要再确认一次，点了之后数据真的被替换、快照也真的落库；
 *  ④ 撤销之后数据回到导入前的样子。
 *
 * ⚠️ 文件是用 `DataTransfer` 在页内造出来再派发 change 的 ——
 * 不走 CDP 的 setFileInputFiles，因为那要求先往磁盘写一份临时文件。
 * ⚠️ 前置状态**自己造**（地雷 18）：先塞一条 id 为 before 的记录，撤销时才认得出它。
 */
async function checkImportPreview(page, baseUrl, failures) {
  const KEY_DIET = "recipe.dietLog.v1";
  const KEY_UNDO = "recipe.importUndo.v1";
  const BACKUP = JSON.stringify({
    app: "元气账本",
    version: 1,
    exportedAt: "2026-09-01T10:00:00.000Z",
    includesApiKey: false,
    data: {
      [KEY_DIET]: JSON.stringify([{ id: "imp1" }, { id: "imp2" }]),
      "recipe.healthProfile.v1": JSON.stringify({ height: 170, weight: 60 }),
    },
  });

  const problems = [];

  await goto(page, `${baseUrl}/health/?imp0=${Date.now()}`);
  await evaluate(
    page,
    `(() => {
      localStorage.setItem("${KEY_DIET}", JSON.stringify([{ id: "before" }]));
      localStorage.removeItem("${KEY_UNDO}");
      // 数一数有没有人弹原生 confirm —— 这条直接钉住「不再用 window.confirm」
      window.__confirmCalls = 0;
      const orig = window.confirm;
      window.confirm = function (...a) { window.__confirmCalls++; return orig.apply(window, a); };
      return true;
    })()`,
  );

  if (!(await openSettings(page))) {
    failures.push("导入预览：打不开设置面板，「设置」按钮没找到或面板没挂上");
    console.log("✗ 导入预览：打不开设置面板，检查没跑成");
    return;
  }

  // ---------- ①② 选定文件 → 面板 ----------
  const injected = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const input = document.querySelector('input[type="file"]');
      if (!input) return { fatal: "找不到文件选择框" };
      const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(BACKUP)}], "backup.json", { type: "application/json" }));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(450);
      const el = document.querySelector('[data-yq="import-preview"]');
      return { shown: !!el, text: el ? el.innerText : "", confirms: window.__confirmCalls ?? -1 };
    })()`,
  );

  if (injected?.fatal) problems.push(`导入预览：${injected.fatal}`);
  else {
    if (!injected.shown) problems.push("选定备份后没有出现预览面板");
    if (injected.confirms !== 0) {
      problems.push(`导入过程弹了 ${injected.confirms} 次原生 confirm —— 那正是这次要换掉的东西`);
    }
    if (injected.shown) {
      if (!injected.text.includes("饮食日记")) problems.push("面板没列出「饮食日记」");
      if (!injected.text.includes("2 条")) problems.push("面板没数出饮食日记的 2 条（预览条数必须与实际一致）");
      if (!injected.text.includes("健康档案")) problems.push("面板没列出「健康档案」");
      if (!injected.text.includes("2026-09-01")) problems.push("面板没显示导出时间");
    }
  }

  // ---------- ③ 整份覆盖：二次确认 + 数据替换 + 快照 ----------
  const overwrite = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const find = (kw) => {
        const el = document.querySelector('[data-yq="import-preview"]');
        return el ? [...el.querySelectorAll("button")].find((b) => b.innerText.includes(kw)) : null;
      };
      const first = find("整份覆盖");
      if (!first) return { clicked: false };
      first.click();
      await sleep(300);
      const second = find("确认覆盖");
      if (!second) return { clicked: true, hasSecond: false };
      second.click();
      await sleep(500);
      const diet = JSON.parse(localStorage.getItem("${KEY_DIET}") || "[]");
      return {
        clicked: true,
        hasSecond: true,
        diet: diet.map((e) => e.id),
        snap: localStorage.getItem("${KEY_UNDO}") !== null,
      };
    })()`,
  );

  if (!overwrite?.clicked) problems.push("面板上没有「整份覆盖」按钮");
  else {
    if (!overwrite.hasSecond) problems.push("「整份覆盖」没有二次确认 —— 点一下就直接替换全部数据");
    else {
      if (overwrite.diet.join(",") !== "imp1,imp2") {
        problems.push(`覆盖导入之后饮食记录是 [${overwrite.diet}]，期望 [imp1,imp2]`);
      }
      if (!overwrite.snap) problems.push("覆盖导入没有留下快照 —— 用户没有退路");
    }
  }

  // ---------- ④ 撤销 ----------
  await sleep(1800); // 覆盖之后会 reload，等它落地
  await goto(page, `${baseUrl}/health/?imp1=${Date.now()}`);

  const openedAgain = await openSettings(page);
  const undone = openedAgain
    ? await evaluate(
        page,
        `(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const wrap = document.querySelector('[data-yq="import-undo"]');
          if (!wrap) return { found: false };
          const b = wrap.querySelector("button");
          if (!b) return { found: false };
          b.click();
          await sleep(500);
          const diet = JSON.parse(localStorage.getItem("${KEY_DIET}") || "[]");
          return {
            found: true,
            diet: diet.map((e) => e.id),
            snapGone: localStorage.getItem("${KEY_UNDO}") === null,
          };
        })()`,
      )
    : { found: false };

  if (!openedAgain) problems.push("撤销那一步打不开设置面板");
  else if (!undone.found) problems.push("覆盖导入之后没有出现「撤销这次导入」");
  else {
    if (undone.diet.join(",") !== "before") {
      problems.push(`撤销之后饮食记录是 [${undone.diet}]，期望回到 [before]`);
    }
    if (!undone.snapGone) problems.push("撤销之后快照还在 —— 应当只能撤一次");
  }

  const ok = problems.length === 0;
  console.log(
    `${ok ? "✓" : "✗"} 导入预览：选定文件后${injected?.shown ? "出现面板" : "没出现面板"}` +
      `（原生弹窗 ${injected?.confirms ?? "?"} 次）；整份覆盖${overwrite?.hasSecond ? "要二次确认" : "没有二次确认"}` +
      `，数据变成 [${overwrite?.diet ?? "?"}]、快照${overwrite?.snap ? "有" : "没有"}；` +
      `撤销后回到 [${undone?.diet ?? "?"}]`,
  );
  failures.push(...problems.map((p) => (p.startsWith("导入预览") ? p : `导入预览：${p}`)));
}

// ---------- 安卓「装到桌面」提示 ----------

/**
 * Chrome 76 起不再自动弹安装提示（mini-infobar 被移除），`beforeinstallprompt`
 * 也不再自带任何 UI —— 所以这条提示是**应用唯一的机会**，不做就等于没有。
 *
 * 四条断言：
 *  ① 浏览器说「可安装」时，引导条出现；
 *  ② 点「安装」**真的调了 `prompt()`** —— 这条最要紧：
 *     就算 `onClick` 里漏掉 `prompt()`，引导条照样会消失，检查会**假绿**（地雷 23 的同类）；
 *  ③ 点「不用了」→ 消失，且**永久**关闭；
 *  ④ 重载后（再给一次可安装信号）不再出现。
 *
 * ⚠️ `beforeinstallprompt` 由浏览器自己决定何时触发，测试里等不到它自然发生，
 * 所以这里**伪造一个**派发进去 —— 验的是「我们收到它会怎么做」，
 * 而不是「浏览器会不会发它」（后者不归应用管）。
 */
async function checkAndroidInstallHint(page, baseUrl, failures) {
  const KEY = "recipe.androidInstallHintDismissed.v1";
  const problems = [];

  /** 页内伪造一次「可安装」信号 */
  const fakePrompt = `(() => {
    const e = new Event("beforeinstallprompt");
    e.prompt = () => { window.__promptCalled = true; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(e);
    return true;
  })()`;

  await goto(page, `${baseUrl}/?install0=${Date.now()}`);
  await evaluate(page, `(() => { localStorage.removeItem("${KEY}"); return true; })()`);

  // ① 引导条出现
  const shown = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__promptCalled = false;
      ${fakePrompt};
      await sleep(300);
      return !!document.querySelector('[data-yq="android-install-hint"]');
    })()`,
  );
  if (!shown) problems.push("浏览器说可安装，引导条却没出现");

  // ② 点「安装」→ 必须真的调 prompt()
  const installed = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const el = document.querySelector('[data-yq="android-install-hint"]');
      if (!el) return { clicked: false };
      const b = [...el.querySelectorAll("button")].find((x) => x.innerText.includes("安装"));
      if (!b) return { clicked: false };
      b.click();
      await sleep(300);
      return {
        clicked: true,
        promptCalled: window.__promptCalled === true,
        gone: !document.querySelector('[data-yq="android-install-hint"]'),
      };
    })()`,
  );
  if (!installed.clicked) problems.push("引导条上没有「安装」按钮");
  else if (!installed.promptCalled) problems.push("点了「安装」却没调 prompt() —— 那按钮是个摆设");
  else if (!installed.gone) problems.push("点了「安装」之后引导条没收起来");

  // ③ 再给一次信号（点「安装」不该永久关掉它），这次点「不用了」
  const dismissed = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      ${fakePrompt};
      await sleep(300);
      const el = document.querySelector('[data-yq="android-install-hint"]');
      if (!el) return { shown: false };
      const b = [...el.querySelectorAll("button")].find((x) => x.innerText.includes("不用了"));
      if (!b) return { shown: true, clicked: false };
      b.click();
      await sleep(300);
      return {
        shown: true,
        clicked: true,
        gone: !document.querySelector('[data-yq="android-install-hint"]'),
        stored: localStorage.getItem("${KEY}") !== null,
      };
    })()`,
  );
  if (!dismissed.shown) problems.push("第二次可安装信号之后引导条没再出现（点「安装」不该永久关掉它）");
  else if (!dismissed.clicked) problems.push("引导条上没有「不用了」按钮");
  else {
    if (!dismissed.gone) problems.push("点了「不用了」引导条没消失");
    if (!dismissed.stored) problems.push("点了「不用了」没写进 localStorage —— 下次打开还会来烦一次");
  }

  // ④ 重载后再给一次信号，不该再出现
  await goto(page, `${baseUrl}/?install1=${Date.now()}`);
  const afterReload = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      ${fakePrompt};
      await sleep(300);
      return !!document.querySelector('[data-yq="android-install-hint"]');
    })()`,
  );
  if (afterReload) problems.push("说过「不用了」之后重载，引导条又出现了");

  const ok = problems.length === 0;
  console.log(
    `${ok ? "✓" : "✗"} 安卓装到桌面：可安装信号 → ${shown ? "出现引导条" : "没出现"}；` +
      `点「安装」${installed.promptCalled ? "真的调起了系统安装" : "没调 prompt"}` +
      `（${installed.gone ? "并收起" : "没收起"}）；` +
      `点「不用了」${dismissed.gone ? "消失且重载后不再出现" : "没关掉"}`,
  );
  failures.push(...problems.map((p) => (p.startsWith("安卓") ? p : `安卓装到桌面：${p}`)));
}

async function checkAiPick(page, baseUrl, failures) {
  const DISH_OK = "番茄蛋汤";
  const DISH_FAKE = "凭空捏造的菜";
  const FAKE_KCAL = 99999;
  const FAKE_REASON_NUM = 12345;
  const FAKE_KEY = "sk-smoke-fake";

  await goto(page, `${baseUrl}/?ai=${Date.now()}`);

  // ---- 1) 造前置：自备菜单 + 一顿重口午饭，并且先不放 Key ----
  const seeded = await evaluate(
    page,
    `(() => {
      const dishes = ${JSON.stringify(
        ["番茄蛋汤", "红烧肉", "清炒时蔬", "蛋炒饭"].map((name, i) => ({
          id: `smoke-ai-${i}`,
          restaurant: "冒烟测试店",
          name,
          category: "测试",
          flavorTags: [],
          avoidConflicts: [],
        })),
      )};
      localStorage.setItem("recipe.takeoutMock.v2", JSON.stringify(dishes));
      localStorage.setItem("recipe.takeoutSeeded.v1", "true");

      const d = new Date();
      const pad = (n) => (n < 10 ? "0" + n : String(n));
      const today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      localStorage.setItem("recipe.dietLog.v1", JSON.stringify([{
        id: "smoke-ai-meal",
        date: today,
        time: "12:30",
        mealSlot: "午餐",
        name: "重口的一顿",
        amount: 1,
        unitLabel: "份",
        grams: 500,
        nutrition: { kcal: 1900, protein: 60, fat: 80, carb: 220, sodium: 4800, fiber: 3 },
        source: "custom",
        createdAt: Date.now(),
      }]));

      localStorage.removeItem("recipe.apikeys.v1");
      window.dispatchEvent(new Event("yq:data-changed"));
      return today;
    })()`,
  );

  const findPickButton = `[...document.querySelectorAll("button")].find((b) => b.innerText.includes("帮我挑"))`;

  const withoutKey = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      for (let i = 0; i < 20 && !${findPickButton}; i++) await sleep(100);
      return { hasButton: !!${findPickButton}, text: document.body.innerText };
    })()`,
  );

  if (withoutKey.hasButton) {
    failures.push(
      "没填 DeepSeek Key 时首页仍然显示了「帮我挑」按钮 —— 点下去只会报错，这个入口不该出现",
    );
    console.log("✗ 帮我挑（无 Key）：按钮不该出现却出现了");
  } else if (!withoutKey.text.includes("今天还该吃点啥")) {
    failures.push("首页找不到「今天还该吃点啥」这张卡 —— 检查的前置没成立");
    console.log("✗ 帮我挑：找不到推荐卡");
  } else {
    console.log("✓ 帮我挑：没填 Key 时不显示按钮");
  }

  // ---- 2) 填入 Key（只广播一次，不刷新）→ 按钮必须出现 ----
  await evaluate(
    page,
    `(() => {
      localStorage.setItem("recipe.apikeys.v1", JSON.stringify({ deepseekKey: ${JSON.stringify(FAKE_KEY)} }));
      window.dispatchEvent(new Event("yq:data-changed"));
      return true;
    })()`,
  );

  // ---- 3) 装拦截器 → 点按钮 → 收证据 ----
  const r = await evaluate(
    page,
    `(async () => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const findBtn = () => ${findPickButton};

      for (let i = 0; i < 25 && !findBtn(); i++) await sleep(100);
      if (!findBtn()) return { ok: false, why: "填了 Key 之后按钮还是没出现（data-changed 广播没接上？）" };

      window.__yqAi = { calls: [] };
      const realFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (!url.includes("api.deepseek.com")) return realFetch(input, init);
        const body = init && typeof init.body === "string" ? JSON.parse(init.body) : null;
        const auth = (init && init.headers && init.headers.Authorization) || "";
        window.__yqAi.calls.push({ url, auth, body });
        const content = JSON.stringify({
          picks: [
            { index: 1, reason: "今天菜吃得少，这个清淡；大约 ${FAKE_REASON_NUM} kcal", kcal: ${FAKE_KCAL} },
            { name: ${JSON.stringify(DISH_FAKE)}, reason: "这道不在菜单里，该被挡掉" },
          ],
        });
        return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      };

      findBtn().click();
      // 等到 AI 那一路渲染出来（「换一批」只在 done 状态出现）
      for (let i = 0; i < 40; i++) {
        await sleep(100);
        if ([...document.querySelectorAll("button")].some((b) => b.innerText.includes("换一批"))) break;
      }
      await sleep(150);

      const calls = window.__yqAi.calls;
      const user = calls.length ? (calls[0].body.messages.find((m) => m.role === "user") || {}).content || "" : "";
      return {
        ok: true,
        calls: calls.length,
        auth: calls.length ? calls[0].auth : "",
        promptHasDish: user.includes(${JSON.stringify(DISH_OK)}),
        text: document.body.innerText,
      };
    })()`,
  );

  if (!r.ok) {
    failures.push(`帮我挑：${r.why}`);
    console.log(`✗ 帮我挑检查没跑成：${r.why}`);
    return;
  }

  const shown = (s) => r.text.includes(s);
  const checks = [
    { name: "接口真的被调了一次", pass: r.calls === 1, detail: `calls=${r.calls}` },
    { name: "请求带着设置里的 Key", pass: r.auth === `Bearer ${FAKE_KEY}`, detail: `auth=${r.auth || "(空)"}` },
    { name: "菜单里的菜进了 prompt", pass: r.promptHasDish, detail: "" },
    { name: "1 号菜画到了屏幕上", pass: shown(DISH_OK), detail: "" },
    { name: "本地估的热量画出来了", pass: shown("kcal"), detail: "" },
    { name: "菜单里没有的菜没上屏", pass: !shown(DISH_FAKE), detail: DISH_FAKE },
    { name: "模型编的热量没上屏", pass: !shown(String(FAKE_KCAL)), detail: String(FAKE_KCAL) },
    { name: "模型理由里的数字没上屏", pass: !shown(String(FAKE_REASON_NUM)), detail: String(FAKE_REASON_NUM) },
  ];

  const bad = checks.filter((c) => !c.pass);
  console.log(
    `${bad.length ? "✗" : "✓"} 帮我挑（假 Key；前置数据 ${seeded}，接口调用 ${r.calls} 次）：` +
      checks.map((c) => `${c.pass ? "" : "✗"}${c.name}`).join(" · "),
  );
  for (const c of bad) {
    failures.push(`帮我挑：${c.name}${c.detail ? `（${c.detail}）` : ""}`);
  }
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
    // 「早中晚餐」是饮食页的主结构，无论有没有数据都必须在
    must: dietNames.length ? [...dietNames, "早中晚餐"] : ["今天还没记", "早中晚餐"],
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

  // 页面渲染断言跑完再查动画：这一步会真的点一下「＋1 杯」，会写进 localStorage，
  // 放在前面会污染后面那些"数据还在不在"的断言
  await checkRingAnimates(page, BASE_URL, failures);

  // 同理：这一条会真的往账本里记一条鸡蛋，必须放在所有只读断言之后
  await checkMealSlot(page, BASE_URL, failures);

  // 这一条会真往账本里记一批「两菜一汤」，同样放在只读断言之后
  await checkMealPreset(page, BASE_URL, failures);

  // 这一条会往账本里记一条薯片，同样放在只读断言之后
  await checkPortionChip(page, BASE_URL, failures);

  // 这一条会把打卡记录里的睡眠/心情抹掉，所以必须在所有依赖它们的断言之后
  await checkWellness(page, BASE_URL, failures);

  // 这一条会动备份提醒的状态、并真的触发一次下载，同样放在只读断言之后
  await checkBackupReminder(page, BASE_URL, failures);

  // 这一条会**替换**饮食记录（前置自己造），必须排在所有依赖它的检查之后
  await checkImportPreview(page, BASE_URL, failures);

  // 这一条也会**替换**饮食记录并写一份健康档案（前置自己造），同样排在只读断言之后
  await checkEntryFeedback(page, BASE_URL, failures);

  // 这一条会**永久**写掉「安卓安装提示已关闭」，所以排在别的界面检查之后
  await checkAndroidInstallHint(page, BASE_URL, failures);

  // 这一条会**覆盖**菜单库与饮食记录（前置自己造），必须排在最后
  await checkAiPick(page, BASE_URL, failures);

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
  await removeProfileDir(profile);
}
