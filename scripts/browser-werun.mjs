import { writeFileSync } from "node:fs";

/** 隔离浏览器中的批量同步检查，模拟接口不访问生产步数。 */
export async function checkWeRun(page, baseUrl, failures, { goto, evaluate, sleep, screenshotPath }) {
  await goto(page, `${baseUrl}/?werun-smoke=${Date.now()}`);
  const enabled = await evaluate(page, `!![...document.querySelectorAll('summary')].find(e => e.textContent === '微信步数')`);
  if (!enabled) { console.log('· 微信步数：未配置接口，跳过交互检查'); return; }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(page, `(() => {
    const dates = [...document.querySelector('section select').options].map(o => o.value);
    const rows = Object.fromEntries(dates.slice(0, 3).map((date, i) => [date,
      { date, steps: 1111 + i, waterMl: 750, sleepHours: 7.5, mood: '好', updatedAt: 1 }]));
    localStorage.setItem('recipe.dailyCheckins.v1', JSON.stringify(rows));
    localStorage.removeItem('recipe.werunConnection.v1');
    localStorage.removeItem('recipe.healthProfile.v1');
  })()`);
  await goto(page, `${baseUrl}/?werun-smoke=${Date.now()}`);
  await evaluate(page, `(() => {
    const select = document.querySelector('section select');
    const dates = [...select.options].map(o => o.value);
    const old = new Date(dates[0]+'T12:00:00+08:00'); old.setUTCDate(old.getUTCDate()-20);
    const historical = old.toISOString().slice(0,10);
    window.__werunTest = { dates, historical, days: [
      {date:dates[0],steps:3210}, {date:dates[1],steps:5432}, {date:historical,steps:0}
    ], status:200, requests:0, safe:true };
    window.__werunOriginalFetch = window.fetch;
    window.fetch = async (url, options) => {
      if (!String(url).endsWith('/werun')) return window.__werunOriginalFetch(url, options);
      const t=window.__werunTest; t.requests++;
      t.safe &&= options.method==='GET' && options.credentials==='omit' && options.cache==='no-store'
        && options.redirect==='error' && /^Bearer YQW1\\.[a-f0-9]{64}\\.[a-f0-9]{64}$/.test(options.headers.Authorization)
        && !String(url).includes('YQW1');
      if(t.networkError) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({days:t.days,syncedAt:Date.now()}),{status:t.status});
    };
    select.value=dates[1]; select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await sleep(100);
  const click = async label => {
    const ok = await evaluate(page, `(() => {
      const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});
      if(!b || b.disabled) return false; b.click(); return true;
    })()`);
    if(!ok) throw new Error(`微信检查找不到可点击的「${label}」`);
    await sleep(150);
  };
  const read = () => evaluate(page, `JSON.parse(localStorage.getItem('recipe.dailyCheckins.v1'))`);
  const expect = (ok,label) => { if(!ok) failures.push(`微信步数：${label}`); };
  const hasConfirm = () => evaluate(page, `!![...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('确认替换 '))`);
  const initialFailures=failures.length;
  try {
    await evaluate(page, `(() => {
      [...document.querySelectorAll('summary')].find(e=>e.textContent==='微信步数').click();
      const input=document.querySelector('[aria-label="微信步数连接码"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'YQW1.'+'a'.repeat(64)+'.'+'b'.repeat(64));
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await sleep(100);
    const before=await read();
    const {dates,historical}=await evaluate(page, '({dates:window.__werunTest.dates,historical:window.__werunTest.historical})');
    const selected=dates[1];
    await click('连接并读取');
    expect(JSON.stringify(await read())===JSON.stringify(before),'读取只预览不写入');
    expect(await evaluate(page, `document.querySelector('[aria-label="微信步数批量预览"] tbody').rows.length===3`),'预览全部返回日期');
    expect(await evaluate(page, `document.body.innerText.includes('未记录') && document.body.innerText.includes('${historical}')`),'未记录的历史日期也进入预览');
    // 只替换隔离测试页的剪贴板，检查实际点击传参；不碰用户系统剪贴板。
    await evaluate(page, `(() => {
      window.__werunClipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{
        if(window.__werunRejectCopy) throw new Error('denied');
        window.__werunCopiedName=value;
      }}});
    })()`);
    try {
      await click('复制名称去微信搜索');
      expect(await evaluate(page, `(() => {
        const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='复制名称去微信搜索');
        return window.__werunCopiedName===b.parentElement.previousElementSibling.textContent
          && !window.__werunCopiedName.includes('YQW1') && b.getBoundingClientRect().height>=44
          && document.body.innerText.includes('已复制名称');
      })()`),'入口复制助手名称且触控区域足够');
      expect(await hasConfirm() && JSON.stringify(await read())===JSON.stringify(before),'点击助手入口保留预览与原始记录');
      await evaluate(page,'window.__werunRejectCopy=true');
      await click('复制名称去微信搜索');
      expect(await evaluate(page,`document.body.innerText.includes('无法自动复制，请长按上方名称复制')`),'复制被拒绝时提供手动复制提示');
      const hasLink=await evaluate(page,`!![...document.querySelectorAll('button')].find(b=>b.textContent==='打开步数助手')`);
      if(hasLink) {
        await evaluate(page,`window.__werunOriginalOpen=window.open; window.open=(...args)=>{window.__werunOpened=args;return null};`);
        try {
          await click('打开步数助手');
          expect(await evaluate(page,`(() => {
            const [value,target,features]=window.__werunOpened;
            const url=new URL(value);
            return ['wxaurl.cn','wxmpurl.cn'].includes(url.hostname) && url.protocol==='https:'
              && !url.search && !url.hash && !value.includes('YQW1')
              && target==='_blank' && features==='noopener,noreferrer';
          })()`),'官方打开链接不带连接码且保留当前页面');
          expect(await hasConfirm() && JSON.stringify(await read())===JSON.stringify(before),'跳转不清除预览或更改记录');
        } finally {
          await evaluate(page,'window.open=window.__werunOriginalOpen;delete window.__werunOriginalOpen;delete window.__werunOpened;');
        }
      } else {
        expect(await evaluate(page,`document.body.innerText.includes('打开微信，搜索上方名称')`),'未配置链接时显示真实搜索指引');
      }
    } finally {
      await evaluate(page,`(() => {
        const descriptor=window.__werunClipboardDescriptor;
        if(descriptor) Object.defineProperty(navigator,'clipboard',descriptor); else delete navigator.clipboard;
        delete window.__werunClipboardDescriptor; delete window.__werunCopiedName; delete window.__werunRejectCopy;
      })()`);
    }
    if(screenshotPath) {
      await evaluate(page, `[...document.querySelectorAll('summary')].find(e=>e.textContent==='微信步数').closest('details').scrollIntoView({block:'center'})`);
      const shot=await page.send('Page.captureScreenshot',{format:'png'});
      writeFileSync(screenshotPath,Buffer.from(shot.data,'base64'));
    }
    await click('取消预览');
    expect(JSON.stringify(await read())===JSON.stringify(before) && !await hasConfirm(),'取消预览不改记录');
    await click('读取最新步数');
    await click('确认替换 3 天的步数');
    let rows=await read();
    expect(rows[selected].steps===5432 && rows[dates[0]].steps===3210 && rows[historical]?.steps===0,'一次确认同步全部日期，包含补录窗口之外及零步');
    expect(JSON.stringify(rows[dates[2]])===JSON.stringify(before[dates[2]]),'缺失日期完全不变');
    expect(dates.slice(0,2).every(d=>rows[d].waterMl===750 && rows[d].sleepHours===7.5 && rows[d].mood==='好'),'原有喝水睡眠心情保留');
    expect(await evaluate(page, `document.querySelector('section select').closest('section').innerText.includes('5432') && document.body.innerText.includes('已同步 3 天的步数')`),'所选日期卡片立即刷新并反馈同步天数');
    await click('读取最新步数'); await click('确认替换 3 天的步数');
    rows=await read();
    expect(rows[selected].steps===5432 && rows[dates[0]].steps===3210,'重复批量同步不累加');
    await evaluate(page, `window.__werunTest.days=[{date:'${selected}',steps:0}]`);
    await click('读取最新步数'); await click('确认替换 1 天的步数');
    expect((await read())[selected].steps===0,'真实零步替换已有非零值');
    const stable=JSON.stringify(await read());
    await evaluate(page, `window.__werunTest.days=[]`);
    await click('读取最新步数');
    expect(!await hasConfirm() && JSON.stringify(await read())===stable,'空快照不提供确认也不写入');
    await evaluate(page, `window.__werunTest.days=[{date:'${selected}',steps:1234}]`);
    await click('读取最新步数');
    await evaluate(page, `(() => { const s=document.querySelector('section select'); s.value=window.__werunTest.dates[0]; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await sleep(100);
    expect(!await hasConfirm(),'切换日期丢弃未确认的批量预览');
    await evaluate(page, `[...document.querySelectorAll('summary')].find(e=>e.textContent==='微信步数').click(); window.__werunTest.status=401;`);
    await click('读取最新步数');
    expect(await evaluate(page, `document.body.innerText.includes('连接码已失效')`),'失效凭证提示重新连接');
    await evaluate(page, `window.__werunTest.status=200;window.__werunTest.networkError=true;`);
    await click('读取最新步数');
    expect(JSON.stringify(await read())===stable,'断网不改变数据');
    await evaluate(page, `window.__werunTest.networkError=false;window.__werunTest.days=[{date:'${selected}',steps:-1}]`);
    await click('读取最新步数');
    expect(!await hasConfirm() && JSON.stringify(await read())===stable,'无效数据整批拒绝');
    // 31 天与最大合法步数也必须能在手机显示，不依赖当天日期或人工补录窗口。
    await evaluate(page, `window.__werunTest.days=Array.from({length:31},(_,i)=>{
      const d=new Date(window.__werunTest.dates[0]+'T12:00:00+08:00'); d.setUTCDate(d.getUTCDate()-i);
      return {date:d.toISOString().slice(0,10),steps:i===0?100000:i};
    })`);
    await click('读取最新步数');
    expect(await evaluate(page, `document.querySelector('[aria-label="微信步数批量预览"] tbody').rows.length===31 && document.documentElement.scrollWidth<=390`),'31 天手机预览无横向溢出');
    await click('取消预览');
    expect(JSON.stringify(await read())===stable,'取消 31 天预览不改变记录');
    expect(await evaluate(page, `window.__werunTest.safe && window.__werunTest.requests>=8`),'凭证仅在请求头传输且禁止缓存');
    // 三天一起达标也须逐日结算，重复同步不能重复庆祝或授徽章。
    await evaluate(page, `(() => {
      const t=window.__werunTest;
      const rows=JSON.parse(localStorage.getItem('recipe.dailyCheckins.v1'));
      for(const d of t.dates.slice(0,3)) rows[d].waterMl=3500;
      localStorage.setItem('recipe.dailyCheckins.v1',JSON.stringify(rows));
      localStorage.setItem('recipe.rewards.v1',JSON.stringify({days:{},badges:{},celebrated:[]}));
      localStorage.setItem('recipe.healthProfile.v1',JSON.stringify({sex:'男',age:30,heightCm:172,weightKg:60,
        activityLevel:'久坐少动',goal:'维持健康',allergies:'',conditions:'',updatedAt:1}));
      window.dispatchEvent(new Event('yq:data-changed'));
      t.days=t.dates.slice(0,3).map(date=>({date,steps:6500}));
    })()`);
    await sleep(150);
    await click('读取最新步数'); await click('确认替换 3 天的步数');
    const rewards=await evaluate(page, `JSON.parse(localStorage.getItem('recipe.rewards.v1'))`);
    expect(dates.slice(0,3).every(d=>rewards.days[d]) && rewards.celebrated.length===3 && !!rewards.badges['streak-3'],'批量三天达标按日期结算并授予连续徽章');
    await click('继续');
    await click('读取最新步数'); await click('确认替换 3 天的步数');
    expect(await evaluate(page, `JSON.stringify(JSON.parse(localStorage.getItem('recipe.rewards.v1')))`)===JSON.stringify(rewards),'重复同步不重复结算奖励');
    expect(await evaluate(page, `![...document.querySelectorAll('h2')].some(e=>e.textContent==='今天两个目标都达成了')`),'重复同步不再次庆祝');
    const afterRewards=JSON.stringify(await read());
    await click('移除本机连接');
    expect(await evaluate(page, `!localStorage.getItem('recipe.werunConnection.v1')`),'移除本机凭证');
    expect(JSON.stringify(await read())===afterRewards,'移除连接保留全部记录');
    console.log((failures.length===initialFailures?'✓':'✗')+' 微信步数：助手入口复制/失败提示与预览保留、全日期预览与确认、取消、零步、重复不累加、缺失日期/其他字段保留、即时刷新、奖励去重、失效/断网及31天手机布局');
  } finally {
    await evaluate(page, `window.fetch=window.__werunOriginalFetch;delete window.__werunTest;delete window.__werunOriginalFetch;`);
    await page.send('Emulation.clearDeviceMetricsOverride');
  }
}
