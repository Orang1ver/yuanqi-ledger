const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createService, normalizeSteps } = require("./core");
const NOW = Date.parse("2026-10-03T02:00:00+08:00");
const TIMESTAMP = Date.parse("2026-10-03T00:00:00+08:00") / 1000;

function fixture() {
  const records = new Map();
  let context = { OPENID: "alice", APPID: "wx-test" };
  let clock = NOW;
  let data = { watermark: { appid: "wx-test" }, stepInfoList: [{ timestamp: TIMESTAMP, step: 1234 }] };
  const main = createService({ appId: "wx-test", origins: ["https://orang1ver.github.io"], now: () => clock,
    getContext: () => context,
    getOpenData: async (cloudID) => ({ list: [{ cloudID, data }] }),
    store: {
      get: async (collection, id) => records.get(`${collection}/${id}`) || null,
      set: async (collection, id, value) => records.set(`${collection}/${id}`, structuredClone(value)),
      remove: async (collection, id) => records.delete(`${collection}/${id}`),
    },
  });
  const read = (token, extra = {}) => main({ httpMethod: "GET", headers: { Authorization: `Bearer ${token}`, Origin: "https://orang1ver.github.io" }, ...extra });
  return { main, read, records, setContext: (v) => { context = v; }, setData: (v) => { data = v; }, setClock: (v) => { clock = v; } };
}

test("微信午夜按北京时间归日，零步不当成缺失，非法或重复数据拒绝", () => {
  assert.deepEqual(normalizeSteps({ stepInfoList: [{ timestamp: TIMESTAMP, step: 0 }] }, NOW), [{ date: "2026-10-03", steps: 0 }]);
  for (const step of [-1, 1.5, NaN, 100001, "123"]) assert.throws(() => normalizeSteps({ stepInfoList: [{ timestamp: TIMESTAMP, step }] }, NOW));
  assert.throws(() => normalizeSteps({ stepInfoList: [{ timestamp: NOW / 1000 + 1, step: 1 }] }, NOW));
  assert.throws(() => normalizeSteps({ stepInfoList: Array(2).fill({ timestamp: TIMESTAMP, step: 1 }) }, NOW));
});

test("真实流程：同步、连接、HTTP 读取、更新、轮换、撤销", async () => {
  const f = fixture();
  assert.equal((await f.main({ action: "connect" })).ok, false);
  assert.equal((await f.main({ action: "sync", cloudID: "cloud-1", days: [{ steps: 99999 }] })).ok, true);
  const { token } = await f.main({ action: "connect" });
  assert.match(token, /^YQW1\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify([...f.records.values()]).includes(token.split(".")[2]));
  const response = await f.read(token);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "https://orang1ver.github.io");
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(response.body), { days: [{ date: "2026-10-03", steps: 1234 }], syncedAt: NOW });
  f.setData({ watermark: { appid: "wx-test" }, stepInfoList: [{ timestamp: TIMESTAMP, step: 2222 }] });
  await f.main({ action: "sync", cloudID: "cloud-2" });
  assert.equal(JSON.parse((await f.read(token)).body).days[0].steps, 2222);
  const second = await f.main({ action: "connect" });
  assert.equal((await f.read(token)).statusCode, 401);
  assert.equal((await f.read(second.token)).statusCode, 200);
  await f.main({ action: "revoke" });
  assert.equal((await f.read(second.token)).statusCode, 401);
  assert.equal(f.records.size, 0);
});

test("HTTP 不能伪造微信用户或写入步数；拒绝越权与无效连接码", async () => {
  const f = fixture();
  await f.main({ action: "sync", cloudID: "cloud-1" });
  const { token } = await f.main({ action: "connect" });
  assert.equal((await f.main({ httpMethod: "POST", action: "revoke", body: JSON.stringify({ action: "sync", OPENID: "alice" }) })).statusCode, 405);
  assert.equal((await f.read(token, { headers: { origin: "https://evil.example" } })).statusCode, 403);
  assert.equal((await f.read(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"))).statusCode, 401);
  assert.equal((await f.read("bad")).statusCode, 401);
  f.setContext({ OPENID: "bob", APPID: "wx-test" });
  assert.equal((await f.main({ action: "connect", OPENID: "alice" })).ok, false);
  await f.main({ action: "revoke", OPENID: "alice" });
  assert.equal((await f.read(token)).statusCode, 200);
  f.setContext({ APPID: "wx-test" });
  assert.equal((await f.main({ action: "sync", cloudID: "cloud-1", OPENID: "alice" })).ok, false);
});

test("连接码过期、跨小程序水印、缺少开放数据均失败", async () => {
  const f = fixture();
  await f.main({ action: "sync", cloudID: "cloud-1" });
  const { token } = await f.main({ action: "connect" });
  f.setClock(NOW + 90 * 86400000);
  assert.equal((await f.read(token)).statusCode, 401);
  f.setData({ watermark: { appid: "other-app" }, stepInfoList: [] });
  assert.equal((await f.main({ action: "sync", cloudID: "cloud-1" })).ok, false);
  assert.equal((await f.main({ action: "sync", days: [] })).ok, false);
});

test("CORS 预检可用且不泄露数据", async () => {
  const f = fixture();
  const res = await f.main({ httpMethod: "OPTIONS", headers: { Origin: "https://orang1ver.github.io" } });
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, "");
  assert.equal(res.headers["Access-Control-Allow-Headers"], "Authorization");
});
