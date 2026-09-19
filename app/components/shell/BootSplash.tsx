"use client";

import { useEffect } from "react";

/**
 * 把服务端渲染的那层启动遮罩收掉。
 *
 * ⚠️ **它自己不画任何东西** —— 遮罩的标记在 `app/layout.tsx` 里，
 * 因为必须**先于 React** 出现在 HTML 中：放客户端组件里就晚了，
 * 那时候白屏已经闪过去了，而这一层存在的唯一理由就是盖住那段白屏。
 *
 * 三个出口，缺一个都可能让用户被装饰挡住：
 *  1) 正常：水合完成 ~420ms 后收掉（留一点最短时间，否则会像"闪了一下"）；
 *  2) 着急：用户点一下/按一下立刻收掉 —— 装饰不该拦人；
 *  3) 兜底：`layout.tsx` 里那段内联脚本 4 秒后无条件收掉（React 万一没起来）。
 */
export function BootSplash() {
  useEffect(() => {
    const root = document.documentElement;
    let done = false;
    let timer = 0;

    const finish = () => {
      if (done) return;
      done = true;
      root.dataset.boot = "done";
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", finish);
      document.removeEventListener("keydown", finish);
    };

    // 最短展示时间：水合往往几十毫秒就完了，不留一点时间会像"闪了一下"
    timer = window.setTimeout(finish, 420);
    // 等不及就点一下
    document.addEventListener("pointerdown", finish);
    document.addEventListener("keydown", finish);
    return finish;
  }, []);

  return null;
}
