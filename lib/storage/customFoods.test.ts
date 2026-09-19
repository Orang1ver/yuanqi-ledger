/**
 * 「我的食物库」数据层的单元测试。
 *
 * 数据层依赖 localStorage，先挂一个内存替身（照 `diet.test.ts` 的先例）。
 *
 * 重点覆盖几条**会静默出错**的约定：
 *   1. id 必须带 `user-` 前缀 —— 数据层面就能看出"这是用户自己加的"
 *   2. 撞名时**不覆盖**，而是把既有那条报回去让 UI 决定
 *   3. 「覆盖」要**保留原 id**（否则已记的账会指不过来）
 *   4. 到上限要**报错**，不能悄悄丢掉最旧的一条
 *   5. 存不进去要**报错** —— `writeJSON` 是静默失败的，静默失败在这里最坏
 */

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

class MemoryStorage {
  private m = new Map<string, string>();
  /** 设成 true 后所有写入都不生效，用来模拟 quota 满 / 隐私模式 */
  public failWrites = false;
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) return; // 静默失败 —— 与真实浏览器的行为一致
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;

import { KEYS } from "./keys";
import {
  CUSTOM_FOODS_LIMIT,
  CustomFoodStorageError,
  addCustomFood,
  customFoodById,
  customFoodCount,
  loadCustomFoods,
  overwriteCustomFood,
  removeCustomFood,
  updateCustomFood,
} from "./customFoods";
import type { FoodItem } from "../nutrition/types";

/** 造一条"拍照读出来的"食物 */
function shot(over: Partial<Omit<FoodItem, "id">> = {}): Omit<FoodItem, "id"> {
  return {
    name: "统一双萃鸭屎香风味柠檬茶",
    alias: ["鸭屎香柠檬茶", "柠檬茶"],
    category: "drink",
    unit: "ml",
    kcal: 36.6,
    protein: 0,
    fat: 0,
    carb: 9.0,
    sodium: 10,
    source: "拍照读取（包装营养成分表，2026-09-19）",
    ...over,
  };
}

beforeEach(() => {
  storage.clear();
  storage.failWrites = false;
});

describe("读", () => {
  it("没存过时读出空表（升级用户首次进入就是这种情况）", () => {
    assert.deepEqual(loadCustomFoods(), []);
    assert.equal(customFoodCount(), 0);
  });

  it("读取用 customFoods 键", () => {
    addCustomFood(shot());
    assert.equal(KEYS.customFoods, "recipe.customFoods.v1");
  });
});

describe("加", () => {
  it("id 自动带 user- 前缀", () => {
    const { added } = addCustomFood(shot());
    assert.ok(added.id.startsWith("user-"), `id 应带前缀，实得 ${added.id}`);
    assert.equal(loadCustomFoods().length, 1);
  });

  it("显式给了 id 就用给的（给 `user-` 前缀的机会留给调用方自己把握）", () => {
    const { added } = addCustomFood({ ...shot(), id: "user-fixed-1" });
    assert.equal(added.id, "user-fixed-1");
  });

  it("数值原样落库，36.6 / 9.0 不被折成整数", () => {
    addCustomFood(shot());
    const f = loadCustomFoods()[0];
    assert.equal(f.kcal, 36.6);
    assert.equal(f.carb, 9.0);
  });

  it("钠是 10 就存 10；没读到钠时存 undefined —— 不是 0（地雷 11）", () => {
    addCustomFood(shot());
    assert.equal(loadCustomFoods()[0].sodium, 10);

    const { added } = addCustomFood(shot({ name: "第二种饮料", alias: [], sodium: undefined }));
    assert.equal(added.sodium, undefined);
    // 序列化后这个字段应当**不存在**，而不是 null 或 0
    const raw = localStorage.getItem(KEYS.customFoods) as string;
    assert.doesNotMatch(raw, /"sodium":\s*(0|null)/);
  });
});

describe("查重", () => {
  it("名字归一化后撞上 → 返回 duplicate，且**没写进去**", () => {
    addCustomFood(shot());
    const r = addCustomFood(shot({ kcal: 99 }));
    assert.ok(r.duplicate, "应报撞名");
    assert.equal(r.duplicate?.kcal, 36.6, "duplicate 应是**既有**那条");
    assert.equal(loadCustomFoods().length, 1, "撞名不该新增");
  });

  it("归一化忽略空白与大小写（全角空格也算）", () => {
    addCustomFood(shot({ name: "Coke Zero", alias: [] }));
    const r = addCustomFood(shot({ name: " coke\u3000zero ", alias: [] }));
    assert.ok(r.duplicate, "「coke zero」与「Coke Zero」应视为同一个");
  });

  it("别名撞上也算重复", () => {
    addCustomFood(shot());
    // 新条目正式名不同，但别名「柠檬茶」是既有条目的别名
    const r = addCustomFood(shot({ name: "某某柠檬茶（新品）", alias: ["柠檬茶"] }));
    assert.ok(r.duplicate, "别名撞车也该被拦住");
  });

  it("名字完全不同 → 正常新增", () => {
    addCustomFood(shot());
    const r = addCustomFood(shot({ name: "全麦吐司", alias: [] }));
    assert.equal(r.duplicate, undefined);
    assert.equal(loadCustomFoods().length, 2);
  });
});

describe("覆盖", () => {
  it("保留原 id（否则已记的账会指不过来）", () => {
    const { added } = addCustomFood(shot());
    const originalId = added.id;

    const next = overwriteCustomFood(shot({ kcal: 40 }), originalId);
    assert.equal(next.length, 1);
    assert.equal(next[0].id, originalId, "id 必须保持不变");
    assert.equal(next[0].kcal, 40, "数值应被覆盖");
  });
});

describe("改与删", () => {
  it("update 改字段但**不动 id**（即使 patch 里带了 id）", () => {
    const { added } = addCustomFood(shot());
    const next = updateCustomFood(added.id, { kcal: 50, id: "想抢改的id" } as Partial<FoodItem>);
    assert.equal(next[0].id, added.id);
    assert.equal(next[0].kcal, 50);
  });

  it("remove 按 id 删", () => {
    const a = addCustomFood(shot()).added;
    addCustomFood(shot({ name: "全麦吐司", alias: [] }));
    const next = removeCustomFood(a.id);
    assert.equal(next.length, 1);
    assert.equal(next[0].name, "全麦吐司");
  });

  it("customFoodById 找得到 / 找不到返回 undefined", () => {
    const a = addCustomFood(shot()).added;
    assert.equal(customFoodById(a.id)?.name, shot().name);
    assert.equal(customFoodById("user-不存在"), undefined);
  });
});

describe("上限与存储失败（这两条必须报错，不能静默）", () => {
  it("到上限继续加 → 抛 CustomFoodStorageError", () => {
    for (let i = 0; i < CUSTOM_FOODS_LIMIT; i++) {
      addCustomFood(shot({ name: `食物${i}`, alias: [] }));
    }
    assert.equal(customFoodCount(), CUSTOM_FOODS_LIMIT);
    assert.throws(
      () => addCustomFood(shot({ name: "再来一条", alias: [] })),
      (e: unknown) => e instanceof CustomFoodStorageError && /最多放/.test((e as Error).message),
    );
    assert.equal(customFoodCount(), CUSTOM_FOODS_LIMIT, "报错后条数不变");
  });

  it("写不进去 → 抛错（不许静默失败）", () => {
    storage.failWrites = true;
    assert.throws(
      () => addCustomFood(shot()),
      (e: unknown) => e instanceof CustomFoodStorageError && /没能存进本机/.test((e as Error).message),
    );
  });
});
