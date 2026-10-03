import { writeFileSync } from "node:fs";

/** 微信步数的真实浏览器交互检查；仅使用隔离浏览器与模拟接口，不访问生产步数。 */
export async function checkWeRun(page, baseUrl, failures, { goto, evaluate, sleep, screenshotPath }) {
  await goto(page, `${baseUrl}/?werun-smoke=${Date.now()}`);
  const enabled = await evaluate(page, `!![...document.querySelectorAll('summary')].find(e => e.textContent === '微信步数')`);
  if (!enabled) {
    console.log('· 微信步数：未配置接口，跳过交互检查');
    return;
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  // 刻意先造数据再重载，避免依赖运行日期、历史样例或当前组件状态。
  await evaluate(page, `(() => {
    const select = document.querySelector('section select');
    const dates = [...select.options].map(o => o.value);
    const rows = Object.fromEntries(dates.slice(0, 2).map((date, i) => [date,
      { date, steps: 1111 + i, waterMl: 750, sleepHours: 7.5, mood: '好', updatedAt: 1 }]));
    localStorage.setItem('recipe.dailyCheckins.v1', JSON.stringify(rows));
    localStorage.removeItem('recipe.werunConnection.v1');
    localStorage.removeItem('recipe.healthProfile.v1');
  })()`);
  await goto(page, `${baseUrl}/?werun-smoke=${Date.now()}`);
  await evaluate(page, `(() => {
    const select = document.querySelector('section select');
    const dates = [...select.options].map(o => o.value);
    window.__werunTest = { dates, days: [{date: dates[1], steps: 5432}], status: 200, requests: 0, safe: true };
    const original = window.fetch;
    window.__werunOriginalFetch = original;
    window.fetch = async (url, options) => {
      if (!String(url).endsWith('/werun')) return original(url, options);
      const t = window.__werunTest;
      t.requests++;
      t.safe &&= options.method === 'GET' && options.credentials === 'omit' && options.cache === 'no-store'
        && options.redirect === 'error' && /^Bearer YQW1\\.[a-f0-9]{64}\\.[a-f0-9]{64}$/.test(options.headers.Authorization)
        && !String(url).includes('YQW1');
      if (t.networkError) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({days: t.days, syncedAt: Date.now()}), {status: t.status});
    };
    document.querySelector('section select').value = dates[1];
    document.querySelector('section select').dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await sleep(100);
  const click = async (label) => {
    const found = await evaluate(page, `(() => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)});
      if (!button || button.disabled) return false;
      button.click(); return true;
    })()`);
    if (!found) throw new Error(`微信检查找不到可点击的「${label}」`);
    await sleep(150);
  };
  const read = () => evaluate(page, `JSON.parse(localStorage.getItem('recipe.dailyCheckins.v1'))`);
  const expect = (ok, label) => { if (!ok) failures.push(`微信步数：${label}`); };
  const initialFailures = failures.length;
  try {
    await evaluate(page, `(() => {
      [...document.querySelectorAll('summary')].find(e => e.textContent === '微信步数').click();
      const input = document.querySelector('[aria-label="微信步数连接码"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'YQW1.'+'a'.repeat(64)+'.'+'b'.repeat(64));
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await sleep(100);
    const before = await read();
    const dates = await evaluate(page, 'window.__werunTest.dates');
    const selected = dates[1];
    await click('连接并读取');
    expect(JSON.stringify(await read()) === JSON.stringify(before), '读取预览不能写入');
    expect(await evaluate(page, `document.body.innerText.includes('${selected}：5432 步')`), '显示所选日期的步数预览');
    expect(await evaluate(page, `!!localStorage.getItem('recipe.werunConnection.v1')`), '成功后保存本机连接');
    if (screenshotPath && await evaluate(page, 'window.__werunTest.requests === 1')) {
      await evaluate(page, `[...document.querySelectorAll('summary')].find(e => e.textContent === '微信步数').closest('details').scrollIntoView({block:'center'})`);
      const shot = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
    }
    await click('替换这一天的步数');
    let rows = await read();
    expect(rows[selected].steps === 5432, '确认后替换所选日期');
    expect(JSON.stringify(rows[dates[0]]) === JSON.stringify(before[dates[0]]), '其他日期完全不变');
    expect(rows[selected].waterMl === 750 && rows[selected].sleepHours === 7.5 && rows[selected].mood === '好', '喝水睡眠心情保留');
    await click('读取最新步数');

    await click('替换这一天的步数');
    expect((await read())[selected].steps === 5432, '重复同步不累加');
    await evaluate(page, `window.__werunTest.days = [{date: '${selected}', steps: 0}]`);
    await click('读取最新步数');

    await click('替换这一天的步数');
    expect((await read())[selected].steps === 0, '真实零步可替换');
    const zeroRows = JSON.stringify(await read());
    await evaluate(page, `window.__werunTest.days = []`);
    await click('读取最新步数');
    expect(await evaluate(page, `document.body.innerText.includes('没有微信步数记录') && ![...document.querySelectorAll('button')].some(b=>b.textContent==='替换这一天的步数')`), '缺失日期不给替换入口');
    expect(JSON.stringify(await read()) === zeroRows, '缺失日期不覆盖');
    await evaluate(page, `window.__werunTest.days = [{date:'${selected}',steps:1234}]`);
    await click('读取最新步数');
    await evaluate(page, `(() => { const select=document.querySelector('section select'); select.value=window.__werunTest.dates[0]; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await sleep(100);
    expect(await evaluate(page, `![...document.querySelectorAll('button')].some(b=>b.textContent==='替换这一天的步数')`), '切换日期丢弃旧预览');
    await evaluate(page, `[...document.querySelectorAll('summary')].find(e => e.textContent === '微信步数').click()`);
    await evaluate(page, `window.__werunTest.status=401`);
    await click('读取最新步数');
    expect(await evaluate(page, `document.body.innerText.includes('连接码已失效')`), '失效凭证给出重新连接提示');
    await evaluate(page, `window.__werunTest.status=200; window.__werunTest.networkError=true`);
    await click('读取最新步数');
    expect(JSON.stringify(await read()) === zeroRows, '断网不能改变记录');
    await evaluate(page, `window.__werunTest.networkError=false; window.__werunTest.days=[{date:window.__werunTest.dates[0],steps:-1}]`);
    await click('读取最新步数');
    expect(await evaluate(page, `document.body.innerText.includes('步数数据格式不正确')`), '拒绝无效步数');
    expect(await evaluate(page, `window.__werunTest.safe && window.__werunTest.requests >= 8`), '凭证仅在请求头传输且禁止缓存');
    await click('移除本机连接');
    expect(await evaluate(page, `!localStorage.getItem('recipe.werunConnection.v1')`), '移除本机凭证');
    expect(JSON.stringify(await read()) === zeroRows, '移除连接保留记录');
    expect(await evaluate(page, `document.documentElement.scrollWidth <= 390`), '手机视口无横向溢出');
    const mark = failures.length === initialFailures ? '✓' : '✗';
    console.log(mark + ' 微信步数：预览、选定日期替换、重复同步、零步、缺失日期、切换日期、失效/断网、字段保留与移除连接');
  } finally {
    await evaluate(page, `window.fetch=window.__werunOriginalFetch; delete window.__werunTest; delete window.__werunOriginalFetch;`);
    await page.send('Emulation.clearDeviceMetricsOverride');
  }
}