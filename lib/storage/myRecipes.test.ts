/**
 * 「我的菜谱」数据层的单元测试。
 *
 * 数据层依赖 localStorage，先挂一个内存替身（照 `customFoods.test.ts` / `diet.test.ts` 的先例）。
 *
 * 重点覆盖几条**会静默出错**的约定：
 *   1. id 必须带 `recipe-` 前缀 —— 数据层面就能看出"这是自做饭菜"，与食物条目的 `user-` 区分开
 *   2. **同名不查重** —— 同名菜谱是正常的（少放糖、多放蛋就是另一张配方），不许拦
 *   3. 改的时候**不许动 `id` 与 `createdAt`** —— 改了会让已记的账指不过来 / 丢时间
 *   4. 到上限要**报错**，不能悄悄丢掉最旧的一条
 *   5. 存不进去要**报错** —— `writeJSON` 是静默失败的，静默失败在这里最坏
 *   6. 形状与 `data/foodRecipes.json` 同形（`parts: [{ foodId, grams }]`），落库不被改写
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
  MY_RECIPES_LIMIT,
  MyRecipeStorageError,
  addMyRecipe,
  loadMyRecipes,
  myRecipeById,
  removeMyRecipe,
  updateMyRecipe,
} from "./myRecipes";
import type { MyRecipe } from "./myRecipes";

/** 造一张"自做饭菜"的配方 */
function recipe(over: Partial<Omit<MyRecipe, "id" | "createdAt">> = {}): Omit<MyRecipe, "id" | "createdAt"> {
  return {
    name: "西红柿炒鸡蛋",
    yieldG: 400,
    parts: [
      { foodId: "tomato", grams: 200 },
      { foodId: "jidan", grams: 100 },
      { foodId: "youtiao", grams: 10 },
    ],
    ...over,
  };
}

beforeEach(() => {
  storage.clear();
  storage.failWrites = false;
});

describe("读", () => {
  it("没存过时读出空表（升级用户首次进入就是这种情况）", () => {
    assert.deepEqual(loadMyRecipes(), []);
  });

  it("读取用 myRecipes 键，且与 customFoods 是两个键", () => {
    addMyRecipe(recipe());
    assert.equal(KEYS.myRecipes, "recipe.myRecipes.v1");
    assert.notEqual(KEYS.myRecipes, KEYS.customFoods);
  });
});

describe("加", () => {
  it("id 自动带 recipe- 前缀（数据层面就看得出是自做饭菜）", () => {
    const { added } = addMyRecipe(recipe());
    assert.ok(added.id.startsWith("recipe-"), `id 应带前缀，实得 ${added.id}`);
    assert.equal(loadMyRecipes().length, 1);
  });

  it("显式给了 id 与 createdAt 就用给的（测试可重复）", () => {
    const { added } = addMyRecipe({ ...recipe(), id: "recipe-fixed", createdAt: 123 });
    assert.equal(added.id, "recipe-fixed");
    assert.equal(added.createdAt, 123);
  });

  it("配方原样落库：parts 的 foodId 与克数不被改写，yieldG 不被折算", () => {
    addMyRecipe(recipe({ yieldG: 437 }));
    const r = loadMyRecipes()[0];
    assert.equal(r.yieldG, 437);
    assert.deepEqual(r.parts, [
      { foodId: "tomato", grams: 200 },
      { foodId: "jidan", grams: 100 },
      { foodId: "youtiao", grams: 10 },
    ]);
  });

  it("⚠ 同名**不**查重：改一版配方就是另一份菜谱，不该被拦下", () => {
    addMyRecipe(recipe());
    const r = addMyRecipe(recipe({ yieldG: 380, parts: [{ foodId: "tomato", grams: 200 }] }));
    assert.equal(loadMyRecipes().length, 2);
    assert.equal(r.added.name, "西红柿炒鸡蛋");
  });
});

describe("改与删", () => {
  it("update 改字段但**不动 id 与 createdAt**（即使 patch 里带了）", () => {
    addMyRecipe({ ...recipe(), id: "recipe-a", createdAt: 999 });
    const next = updateMyRecipe("recipe-a", {
      name: "西红柿炒鸡蛋（少油）",
      yieldG: 380,
      id: "想抢改的id",
      createdAt: 0,
    } as Partial<MyRecipe>);
    assert.equal(next[0].id, "recipe-a");
    assert.equal(next[0].createdAt, 999);
    assert.equal(next[0].name, "西红柿炒鸡蛋（少油）");
    assert.equal(next[0].yieldG, 380);
  });

  it("update 改不存在的 id：不新增、不抛错，原表不动", () => {
    addMyRecipe({ ...recipe(), id: "recipe-a", createdAt: 1 });
    const next = updateMyRecipe("recipe-不存在", { name: "改不到" });
    assert.equal(next.length, 1);
    assert.equal(next[0].name, "西红柿炒鸡蛋");
  });

  it("remove 按 id 删", () => {
    addMyRecipe({ ...recipe(), id: "recipe-a" });
    addMyRecipe({ ...recipe(), id: "recipe-b", name: "青椒肉丝" });
    const next = removeMyRecipe("recipe-a");
    assert.equal(next.length, 1);
    assert.equal(next[0].name, "青椒肉丝");
  });

  it("myRecipeById 找得到 / 找不到返回 undefined", () => {
    addMyRecipe({ ...recipe(), id: "recipe-a" });
    assert.equal(myRecipeById("recipe-a")?.name, "西红柿炒鸡蛋");
    assert.equal(myRecipeById("recipe-不存在"), undefined);
  });
});

describe("上限与存储失败（这两条必须报错，不能静默）", () => {
  it("到上限继续加 → 抛 MyRecipeStorageError，且条数不变", () => {
    for (let i = 0; i < MY_RECIPES_LIMIT; i++) {
      addMyRecipe({ ...recipe(), id: `recipe-${i}`, name: `菜${i}` });
    }
    assert.equal(loadMyRecipes().length, MY_RECIPES_LIMIT);
    assert.throws(
      () => addMyRecipe(recipe({ name: "再来一道" })),
      (e: unknown) => e instanceof MyRecipeStorageError && /最多放/.test((e as Error).message),
    );
    assert.equal(loadMyRecipes().length, MY_RECIPES_LIMIT, "报错后条数不变");
  });

  it("写不进去 → 抛错（不许静默失败，否则关掉再打开就没了）", () => {
    storage.failWrites = true;
    assert.throws(
      () => addMyRecipe(recipe()),
      (e: unknown) => e instanceof MyRecipeStorageError && /没能存进本机/.test((e as Error).message),
    );
    // 确认它真没进去 —— 报错之后用户不会再以为自己存上了
    assert.equal(loadMyRecipes().length, 0);
  });

  it("改与删写不进去也抛错（不是只有新增才检查）", () => {
    const { added } = addMyRecipe({ ...recipe(), id: "recipe-a" });
    storage.failWrites = true;
    assert.throws(() => updateMyRecipe(added.id, { name: "改不动" }), (e: unknown) => e instanceof MyRecipeStorageError);
    assert.throws(() => removeMyRecipe(added.id), (e: unknown) => e instanceof MyRecipeStorageError);
  });
});
