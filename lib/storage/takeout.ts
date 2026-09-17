/**
 * 外卖 / 菜单库。
 *
 * ⚠️ 播种逻辑是本项目最容易写崩用户数据的地方，历史上真踩过：
 * 早先的写法是 `if (loadTakeoutDishes().length > 0) return;` —— 只要库为空就重新灌示例，
 * 于是用户把商家全删光后一刷新，示例菜又回来了，看起来像"删不掉"。
 *
 * 现在改成**一次性标记**控制，三个分支的顺序不能动：
 *   ① 已有标记            → 直接返回
 *   ② 库里已有数据（老用户）→ 只补标记，**绝不动数据**
 *   ③ 真正的首次运行       → 写示例库 + 写标记
 * 顺序写错（先判断空库再判断标记）就会覆盖老用户的数据。
 */

import { v4 as uuid } from "uuid";
import type { TakeoutDish } from "../types";
import { KEYS } from "./keys";
import { readJSON, writeJSON } from "./io";
// 相对导入而非 `@/` 别名：`lib/` 是不依赖打包器的领域层，
// 保持相对路径才能被纯 Node 脚本直接跑（数据延续自检就靠这个）。
import takeoutSeed from "../../data/takeoutSeed.json";

export type TakeoutUndo = {
  reason: string;
  at: number;
  dishes: TakeoutDish[];
};

export function loadTakeoutDishes(): TakeoutDish[] {
  return readJSON<TakeoutDish[]>(KEYS.takeoutMock, []);
}

export function saveTakeoutDishes(dishes: TakeoutDish[]): void {
  writeJSON(KEYS.takeoutMock, dishes);
}

export function seedTakeoutMockIfEmpty(): void {
  if (readJSON<boolean>(KEYS.takeoutSeeded, false)) return;
  if (loadTakeoutDishes().length > 0) {
    writeJSON(KEYS.takeoutSeeded, true);
    return;
  }
  writeJSON(KEYS.takeoutMock, takeoutSeed as TakeoutDish[]);
  writeJSON(KEYS.takeoutSeeded, true);
}

/** 库内菜品的主键：同商家同名视为同一道菜 */
function dishKey(d: Pick<TakeoutDish, "restaurant" | "name">): string {
  return `${d.restaurant}::${d.name}`;
}

/**
 * 导入菜品。默认跳过已存在的同商家同名菜；`overwriteSameName` 时用新数据覆盖。
 *
 * 覆盖时的三个要点：
 * - **复用旧 id**：否则 React 的 key 会变，用户正开着的编辑弹窗会指向已消失的行
 * - 同一批里出现同名时**后者覆盖前者**（模型输出顺序不可靠，靠后的通常信息更全）
 * - `priceRange` 取新数据的原值（可能是 undefined），即"以新数据为准"
 */
export function addTakeoutDishes(
  incoming: Omit<TakeoutDish, "id">[],
  opts?: { overwriteSameName?: boolean },
): { list: TakeoutDish[]; added: number; updated: number } {
  const overwrite = !!opts?.overwriteSameName;
  const list = loadTakeoutDishes();
  const indexOf = new Map(list.map((d, i) => [dishKey(d), i]));

  let added = 0;
  let updated = 0;

  for (const d of incoming) {
    if (!d.name?.trim()) continue;
    const key = dishKey(d);
    const at = indexOf.get(key);
    if (at === undefined) {
      list.push({ ...d, id: uuid() });
      indexOf.set(key, list.length - 1);
      added++;
    } else if (overwrite) {
      list[at] = { ...d, id: list[at].id };
      updated++;
    }
    // 未开启覆盖且已存在 → 跳过
  }

  saveTakeoutDishes(list);
  return { list, added, updated };
}

export function removeTakeoutDish(id: string): void {
  saveTakeoutDishes(loadTakeoutDishes().filter((d) => d.id !== id));
}

/** 删除整个商家，返回删除后的列表 */
export function removeTakeoutMerchant(restaurant: string): TakeoutDish[] {
  const next = loadTakeoutDishes().filter((d) => d.restaurant !== restaurant);
  saveTakeoutDishes(next);
  return next;
}

/**
 * 给整个商家改名：名下所有菜一起换到新店名。
 * 顺带处理改名后可能出现的重名：若目标店名已存在，两家菜品会合并，
 * 此时按「店名 + 菜名」去重（保留先出现的），并把合并条数如实返回。
 * —— 这正是修掉"杨国福麻辣烫"与"杨国福麻辣烫(五道口店)"这类重复商家的手段。
 */
export function renameTakeoutMerchant(
  oldName: string,
  newName: string,
): { list: TakeoutDish[]; renamed: number; merged: number } {
  const target = newName.trim();
  const list = loadTakeoutDishes();
  const renamed = list.filter((d) => d.restaurant === oldName).length;
  if (!target || target === oldName || renamed === 0) {
    return { list, renamed: 0, merged: 0 };
  }

  const seen = new Set<string>();
  const deduped: TakeoutDish[] = [];
  let merged = 0;
  for (const d of list.map((x) => (x.restaurant === oldName ? { ...x, restaurant: target } : x))) {
    const key = dishKey(d);
    if (seen.has(key)) {
      merged++;
      continue;
    }
    seen.add(key);
    deduped.push(d);
  }

  saveTakeoutDishes(deduped);
  return { list: deduped, renamed, merged };
}

export function clearTakeoutDishes(): TakeoutDish[] {
  saveTakeoutDishes([]);
  return [];
}

/**
 * 导入菜品（可选先清空全库）。把"清空 + 写入"合成一次写操作，
 * 避免中间出现"库为空"的短暂状态（那会被种子逻辑撞上）。
 */
export function importTakeoutDishes(
  incoming: Omit<TakeoutDish, "id">[],
  opts: { overwriteSameName?: boolean; clearFirst?: boolean },
): { list: TakeoutDish[]; added: number; updated: number } {
  if (opts.clearFirst) saveTakeoutDishes([]);
  return addTakeoutDishes(incoming, { overwriteSameName: opts.overwriteSameName });
}

/**
 * 批量**只改品类**：一次读一次写，菜名/商家/价格/口味/忌口全部原样保留。
 * 给"让 AI 重新整理分类"用。写之前由调用方 pushTakeoutUndo 存快照，所以这里不负责撤销；
 * 传入里没提到的菜（例如模型漏答的）保持原样，不会被清成空。
 */
export function applyTakeoutCategories(pairs: { id: string; category: string }[]): TakeoutDish[] {
  const map = new Map(pairs.map((p) => [p.id, p.category]));
  const next = loadTakeoutDishes().map((d) => (map.has(d.id) ? { ...d, category: map.get(d.id) as string } : d));
  saveTakeoutDishes(next);
  return next;
}

/** 改一道菜；改完与同商家别的菜撞名时拒绝（保持库内不重复） */
export function updateTakeoutDish(id: string, patch: Partial<Omit<TakeoutDish, "id">>): boolean {
  const list = loadTakeoutDishes();
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0) return false;
  const merged = { ...list[idx], ...patch };
  if (!merged.name?.trim()) return false;
  if (list.some((d) => d.id !== id && d.restaurant === merged.restaurant && d.name === merged.name)) return false;
  list[idx] = merged;
  saveTakeoutDishes(list);
  return true;
}

/** 清空并恢复示例库 —— **唯一允许重新播种的入口**（同时补上标记） */
export function resetTakeoutDishes(): void {
  writeJSON(KEYS.takeoutMock, takeoutSeed as TakeoutDish[]);
  writeJSON(KEYS.takeoutSeeded, true);
}

// ---------- 单槽撤销快照 ----------

/**
 * 只保留最近一次破坏性操作前的菜单库。
 *
 * 为什么是单槽而不是栈：快照存的是整份菜单库（几十条），多份会让备份明显膨胀，
 * 而实际需要的就是"哎我刚删错了"这一次。键带 `recipe.` 前缀，
 * 因此会被备份导出带上、也会被「清空全部数据」一并清掉（语义一致）。
 */
export function pushTakeoutUndo(reason: string, dishes: TakeoutDish[]): void {
  writeJSON<TakeoutUndo>(KEYS.takeoutUndo, { reason, at: Date.now(), dishes });
}

export function peekTakeoutUndo(): TakeoutUndo | null {
  const snap = readJSON<TakeoutUndo | null>(KEYS.takeoutUndo, null);
  return snap && Array.isArray(snap.dishes) ? snap : null;
}

/** 恢复快照并清空槽位（只能撤销一次） */
export function popTakeoutUndo(): TakeoutDish[] | null {
  const snap = peekTakeoutUndo();
  if (!snap) return null;
  saveTakeoutDishes(snap.dishes);
  writeJSON(KEYS.takeoutUndo, null);
  return snap.dishes;
}

/** 商家列表（去重，按库中首次出现顺序） */
export function takeoutMerchants(dishes: TakeoutDish[]): string[] {
  return [...new Set(dishes.map((d) => d.restaurant))];
}
