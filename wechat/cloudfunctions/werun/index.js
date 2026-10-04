const cloud = require("wx-server-sdk");
const { createService } = require("./core");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
exports.main = createService({
  appId: process.env.WERUN_APP_ID,
  origins: (process.env.WERUN_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  getContext: () => cloud.getWXContext(),
  getOpenData: (id) => cloud.getOpenData({ list: [id] }),
  store: {
    // where 查询的空结果能与数据库故障区分；不能把所有异常当成「没有记录」。
    async get(collection, id) {
      const result = await db.collection(collection).where({ _id: id }).limit(1).get();
      return result.data[0] || null;
    },
    async set(collection, id, value) { await db.collection(collection).doc(id).set({ data: value }); },
    async remove(collection, id) { await db.collection(collection).where({ _id: id }).remove(); },
  },
});
