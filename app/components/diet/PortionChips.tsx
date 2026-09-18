"use client";

/**
 * 份量档位 chips（「一包 · 70g」「大包 · 135g」这种）。
 *
 * 为什么单独抽出来：它有两处要用 —— 搜索添加流程（`PortionPicker`）与
 * 一句话记账里解析出的每条记录（`QuickAddCard`）。抄两份的话两边迟早长得不一样，
 * 而"点档位改份量"恰恰是用户最常做的动作，一处变了另一处没变会被当成坏了。
 *
 * ⚠️ 选中判据**只比克数**，不比量词标签。两边传进来的量词口径本来就不同：
 * `parseFragment` 给的是纯量词（「包」），而份量表的档位标签带数量（「一包」）。
 * 拿标签对比会导致"明明就是这个档，却一个都不亮"。
 */

export type PortionOption = { unit: string; label: string; grams: number };

export function PortionChips({
  options,
  currentGrams,
  onPick,
  max = 8,
}: {
  options: readonly PortionOption[];
  /** 当前克数，用来决定哪个档位点亮的 */
  currentGrams?: number;
  onPick: (o: PortionOption) => void;
  max?: number;
}) {
  const list = options.slice(0, max);
  if (!list.length) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {list.map((o) => {
        const on = currentGrams !== undefined && o.grams === currentGrams;
        return (
          <button
            key={`${o.unit}-${o.label}-${o.grams}`}
            type="button"
            className="yq-chip"
            data-on={on}
            onClick={() => onPick(o)}
          >
            {o.label} · {o.grams}g
          </button>
        );
      })}
    </div>
  );
}
