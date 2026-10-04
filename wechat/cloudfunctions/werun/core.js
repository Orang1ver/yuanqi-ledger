const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const DAY = 86400000;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const dateOf = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
class PublicError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function normalizeSteps(data, now) {
  if (!data || !Array.isArray(data.stepInfoList) || data.stepInfoList.length > 31) {
    throw new PublicError("未获取到有效微信步数，请重新同步");
  }
  const seen = new Set();
  return data.stepInfoList.map((row) => {
    if (!row || !Number.isSafeInteger(row.timestamp) || row.timestamp < 0 || row.timestamp * 1000 > now
      || !Number.isSafeInteger(row.step) || row.step < 0 || row.step > 100000) throw new PublicError("微信步数数据不完整，请重试");
    const date = dateOf(row.timestamp * 1000);
    if (date < dateOf(now - 30 * DAY) || seen.has(date)) throw new PublicError("微信步数日期不正确，请重试");
    seen.add(date);
    return { date, steps: row.step };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** 依赖注入使测试运行真实鉴权与请求逻辑，不接触生产云环境。 */
function createService({ store, getContext, getOpenData, appId, origins, now = Date.now }) {
  async function read(token) {
    const match = /^YQW1\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(token || "");
    if (!match) throw new PublicError("连接码无效", 401);
    const [, id, secret] = match;
    const binding = await store.get("werun_bindings", id);
    if (!binding || !Number.isSafeInteger(binding.expiresAt) || binding.expiresAt <= now()
      || !/^[a-f0-9]{64}$/.test(binding.secretHash || "")
      || !timingSafeEqual(Buffer.from(binding.secretHash, "hex"), Buffer.from(hash(secret), "hex"))) {
      throw new PublicError("连接码已失效", 401);
    }
    const data = await store.get("werun_steps", id);
    if (!data) throw new PublicError("请先在小程序同步步数", 404);
    // 过期的每日记录不再对外返回；定期清理见部署文档。
    return { days: data.days.filter((day) => day.date >= dateOf(now() - 30 * DAY)), syncedAt: data.syncedAt };
  }

  async function http(event) {
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const origin = headers.origin;
    const allowed = typeof origin === "string" && origins.includes(origin);
    const response = (statusCode, data) => ({
      statusCode, isBase64Encoded: false,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin",
        ...(allowed ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization", "Access-Control-Max-Age": "600" } : {}) },
      body: statusCode === 204 ? "" : JSON.stringify(data),
    });
    if (origin && !allowed) return response(403, { message: "来源未获允许" });
    if (event.httpMethod === "OPTIONS") return response(204, null);
    if (event.httpMethod !== "GET") return response(405, { message: "仅支持读取" });
    try {
      if (typeof headers.authorization !== "string" || !headers.authorization.startsWith("Bearer ")) throw new PublicError("缺少连接码", 401);
      return response(200, await read(headers.authorization.slice(7)));
    } catch (error) {
      return response(error instanceof PublicError ? error.status : 503,
        { message: error instanceof PublicError ? error.message : "服务暂不可用" });
    }
  }

  return async function main(event = {}) {
    // HTTP body 无论包含什么 action / OPENID，都不进入小程序写入通道。
    if (event.httpMethod) return http(event);
    try {
      const context = getContext();
      if (!appId || context.APPID !== appId || !context.OPENID) throw new PublicError("请从微信小程序使用此功能", 401);
      const id = hash(`${appId}:${context.OPENID}`);
      if (event.action === "sync") {
        if (typeof event.cloudID !== "string" || !event.cloudID || event.cloudID.length > 2048) throw new PublicError("请重新获取微信步数");
        // 只接受由微信服务端换取的开放数据，绝不相信客户端传来的明文步数。
        const result = await getOpenData(event.cloudID);
        const item = result.list?.[0];
        if (!item || item.cloudID !== event.cloudID || item.data?.watermark?.appid !== appId) throw new PublicError("微信步数校验失败，请重试");
        const syncedAt = now();
        const days = normalizeSteps(item.data, syncedAt);
        await store.set("werun_steps", id, { days, syncedAt });
        return { ok: true, days, syncedAt };
      }
      if (event.action === "connect") {
        if (!await store.get("werun_steps", id)) throw new PublicError("请先同步微信步数");
        const secret = randomBytes(32).toString("hex");
        const expiresAt = now() + 90 * DAY;
        await store.set("werun_bindings", id, { secretHash: hash(secret), expiresAt });
        return { ok: true, token: `YQW1.${id}.${secret}`, expiresAt };
      }
      if (event.action === "revoke") {
        await store.remove("werun_bindings", id);
        await store.remove("werun_steps", id);
        return { ok: true };
      }
      throw new PublicError("不支持的操作");
    } catch (error) {
      return { ok: false, message: error instanceof PublicError ? error.message : "服务暂不可用，请稍后重试" };
    }
  };
}
module.exports = { createService, normalizeSteps };
