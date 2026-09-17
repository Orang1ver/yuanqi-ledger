"use client";

import { useState } from "react";

/**
 * 设置入口。
 *
 * 单独抽成一个客户端组件，是为了让页面本身可以保持为服务端组件骨架 ——
 * 只有真正需要交互的这一小块被标记成 "use client"。
 */
export function SettingsButton({ label = "⚙ 设置" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const [Dialog, setDialog] = useState<null | React.ComponentType<{ onClose: () => void }>>(null);

  async function openDialog() {
    // 按需加载：设置面板不常开，没必要进首屏包
    const mod = await import("./SettingsDialog");
    setDialog(() => mod.SettingsDialog);
    setOpen(true);
  }

  return (
    <>
      <button className="yq-btn yq-btn-sm" onClick={openDialog}>
        {label}
      </button>
      {open && Dialog && <Dialog onClose={() => setOpen(false)} />}
    </>
  );
}
