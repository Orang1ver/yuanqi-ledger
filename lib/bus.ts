/**
 * 极简的事件总线 —— 让卡片之间可以互相通知，而不用把状态提到页面里。
 *
 * 为什么需要：健康档案会改变热量/喝水/步数目标，而"档案卡"与"打卡卡"是两张独立组件
 * （这是刻意的，见 AGENTS.md 地雷 7）。保存档案后如果不通知，打卡卡还按旧目标显示，
 * 用户会以为没生效。同理，打完卡后徽章墙、体重记完后图表，都需要知道"数据变了"。
 *
 * 方案：一个 window 事件，而不是 Context —— 卡片数量少、关系浅，
 * 引入 Context 会把"状态自管"的纪律又拉回页面层。
 *
 * ⚠️ 订阅方只应**重新读一次存储**并 setState，**不要**在订阅回调里再 emit，
 * 否则会形成广播风暴。
 */

export const DATA_CHANGED = "yq:data-changed";

/** 广播"本地数据变了"。不带 payload —— 订阅方各自知道自己关心哪些键。 */
export function emitDataChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DATA_CHANGED));
}

/** 返回取消订阅的函数（可直接当 useEffect 的清理函数） */
export function onDataChanged(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DATA_CHANGED, fn);
  return () => window.removeEventListener(DATA_CHANGED, fn);
}
