"use client";

import { useMemo, useState } from "react";
import type { TakeoutDish } from "@/lib/types";
import {
  addTakeoutDishes,
  loadTakeoutDishes,
  peekTakeoutUndo,
  popTakeoutUndo,
  pushTakeoutUndo,
  removeTakeoutDish,
  removeTakeoutMerchant,
  renameTakeoutMerchant,
  updateTakeoutDish,
} from "@/lib/storage/takeout";
import { AVOID_TAGS, FLAVOR_TAGS } from "@/lib/tags";
import { estimateDish, sumEstimates } from "@/lib/nutrition/menu";
import { DishNutrition } from "./DishNutrition";

/**
 * 菜单库。
 *
 * 这是「推荐吃什么」的数据底座 —— 库里有什么，才可能推荐什么。
 * 所以这里的编辑体验要顺手：加菜、改价、按商家批量改名/删除，都得不费劲。
 *
 * 破坏性操作（删商家、改名合并、批量导入）之前一律先 `pushTakeoutUndo` 存快照，
 * 提供**一次**撤销。单槽而不是栈：快照是整份库，多份会让备份文件明显膨胀，
 * 而用户真正需要的只是"哎我刚删错了"这一次。
 *
 * ⚠️ 不做「库为空就重新灌示例」——那会让用户删光后一刷新示例又回来。
 * 恢复示例库只能走显式的按钮，并且会覆盖当前内容（所以也要存快照）。
 */
export function TakeoutLibrary() {
  const [dishes, setDishes] = useState<TakeoutDish[]>(() => loadTakeoutDishes());
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [undo, setUndo] = useState(() => peekTakeoutUndo());
  const [msg, setMsg] = useState("");

  // 新增表单
  const [showAdd, setShowAdd] = useState(false);
  const [newRestaurant, setNewRestaurant] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newFlavor, setNewFlavor] = useState<string[]>([]);
  const [newAvoid, setNewAvoid] = useState<string[]>([]);

  // 编辑中
  const [editing, setEditing] = useState<TakeoutDish | null>(null);
  // 改商家名
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const categories = useMemo(() => [...new Set(dishes.map((d) => d.category))].sort(), [dishes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dishes.filter(
      (d) =>
        (!category || d.category === category) &&
        (!q || d.name.toLowerCase().includes(q) || d.restaurant.toLowerCase().includes(q)),
    );
  }, [dishes, query, category]);

  /** 按商家分组，商家的顺序按它第一道菜在库里的位置 —— 保持用户添加的先后感 */
  const groups = useMemo(() => {
    const map = new Map<string, TakeoutDish[]>();
    for (const d of filtered) {
      const arr = map.get(d.restaurant);
      if (arr) arr.push(d);
      else map.set(d.restaurant, [d]);
    }
    return [...map.entries()];
  }, [filtered]);

  function snapshot(reason: string) {
    pushTakeoutUndo(reason, dishes);
    setUndo(peekTakeoutUndo());
  }

  function add() {
    if (!newName.trim()) {
      setMsg("菜名不能为空");
      return;
    }
    const restaurant = newRestaurant.trim() || "未分类商家";
    const r = addTakeoutDishes(
      [
        {
          restaurant,
          name: newName.trim(),
          category: newCategory.trim() || "未分类",
          priceRange: newPrice.trim() || undefined,
          flavorTags: newFlavor,
          avoidConflicts: newAvoid,
        },
      ],
      { overwriteSameName: false },
    );
    setDishes(r.list);
    setMsg(r.added ? `已加入「${restaurant} · ${newName.trim()}」` : "这家店里已经有同名菜了，没重复添加");
    setNewName("");
    setNewPrice("");
    setNewFlavor([]);
    setNewAvoid([]);
  }

  function toggle(list: string[], set: (v: string[]) => void, v: string) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  return (
    <>
      {/* 搜索 + 筛选 */}
      <section className="yq-card yq-card-flat" style={{ marginBottom: 14 }}>
        <input
          className="yq-input"
          placeholder="搜菜名或商家"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {categories.length > 1 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            <button className="yq-chip" data-on={category === ""} onClick={() => setCategory("")}>
              全部（{dishes.length}）
            </button>
            {categories.map((c) => (
              <button key={c} className="yq-chip" data-on={category === c} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 操作区 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <button className="yq-btn yq-btn-sm yq-btn-primary" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "收起" : "＋ 加一道菜"}
        </button>
        {undo && (
          <button
            className="yq-btn yq-btn-sm"
            onClick={() => {
              const restored = popTakeoutUndo();
              if (restored) {
                setDishes(restored);
                setUndo(null);
                setMsg(`已撤销「${undo.reason}」`);
              }
            }}
          >
            ↩ 撤销「{undo.reason}」
          </button>
        )}
      </div>

      {showAdd && (
        <section className="yq-card" style={{ marginBottom: 14 }}>
          <div className="yq-section-title">
            <span>加一道菜</span>
          </div>
          <input
            className="yq-input"
            placeholder="商家（如：沙县小吃）"
            value={newRestaurant}
            onChange={(e) => setNewRestaurant(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <input
            className="yq-input"
            placeholder="菜名（如：番茄鸡蛋米线）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              className="yq-input"
              placeholder="品类（如：粉面米线）"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            />
            <input
              className="yq-input"
              placeholder="价格（如 ¥18-22）"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
            />
          </div>

          <p className="yq-label" style={{ marginBottom: 6 }}>
            口味
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {FLAVOR_TAGS.map((t) => (
              <button
                key={t.label}
                className="yq-chip"
                data-on={newFlavor.includes(t.label)}
                onClick={() => toggle(newFlavor, setNewFlavor, t.label)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <p className="yq-label" style={{ marginBottom: 6 }}>
            这道菜与哪些忌口冲突（勾上的会被推荐时避开）
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {AVOID_TAGS.map((t) => (
              <button
                key={t.label}
                className="yq-chip"
                data-on={newAvoid.includes(t.label)}
                onClick={() => toggle(newAvoid, setNewAvoid, t.label)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button className="yq-btn yq-btn-primary" onClick={add}>
            加入菜单库
          </button>
        </section>
      )}

      {msg && (
        <p className="yq-hint" style={{ marginBottom: 12, color: "var(--yq-primary-ink)" }}>
          {msg}
        </p>
      )}

      {/* 列表 */}
      {groups.length === 0 ? (
        <div className="yq-card">
          <div className="yq-empty">
            {dishes.length === 0 ? "菜单库是空的" : "没有匹配的菜"}
            <br />
            {dishes.length === 0 && "点上面的「＋ 加一道菜」，把你常点的店录进去"}
          </div>
        </div>
      ) : (
        groups.map(([restaurant, list]) => {
          const est = sumEstimates(list.map((d) => estimateDish(d)));
          return (
          <section key={restaurant} className="yq-card" style={{ marginBottom: 14 }}>
            <div className="yq-section-title">
              {renaming === restaurant ? (
                <div style={{ display: "flex", gap: 6, flex: 1 }}>
                  <input
                    className="yq-input"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    style={{ minHeight: 34, fontSize: 14 }}
                  />
                  <button
                    className="yq-btn yq-btn-sm yq-btn-primary"
                    onClick={() => {
                      snapshot(`改商家名「${restaurant}」`);
                      const r = renameTakeoutMerchant(restaurant, renameDraft);
                      setDishes(r.list);
                      setMsg(
                        r.merged > 0
                          ? `已改名为「${renameDraft.trim()}」，与同名的店合并，去重 ${r.merged} 道`
                          : `已改名为「${renameDraft.trim()}」`,
                      );
                      setRenaming(null);
                    }}
                  >
                    确定
                  </button>
                  <button className="yq-btn yq-btn-sm" onClick={() => setRenaming(null)}>
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <span>
                    {restaurant} <span className="yq-hint">（{list.length}）</span>
                  </span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <button
                      className="yq-btn yq-btn-sm yq-btn-ghost"
                      onClick={() => {
                        setRenaming(restaurant);
                        setRenameDraft(restaurant);
                      }}
                    >
                      改名
                    </button>
                    <button
                      className="yq-btn yq-btn-sm yq-btn-ghost"
                      onClick={() => {
                        if (!window.confirm(`删除「${restaurant}」及其 ${list.length} 道菜？可以用撤销恢复。`)) return;
                        snapshot(`删除商家「${restaurant}」`);
                        setDishes(removeTakeoutMerchant(restaurant));
                        setMsg(`已删除「${restaurant}」`);
                      }}
                    >
                      删除
                    </button>
                  </span>
                </>
              )}
            </div>

            <p className="yq-hint" style={{ marginBottom: 8 }}>
              这一组 {list.length} 道菜合计约 {est.loKcal}~{est.hiKcal} kcal
              {est.unknown ? `，另有 ${est.unknown} 道估不出来（关联一下就能算）` : ""}
            </p>

            {list.map((d) =>
              editing?.id === d.id ? (
                <DishEditor
                  key={d.id}
                  dish={d}
                  onCancel={() => setEditing(null)}
                  onSave={(patch) => {
                    const ok = updateTakeoutDish(d.id, patch);
                    if (!ok) {
                      setMsg("保存失败：菜名不能为空，也不能与同商家别的菜重名");
                      return;
                    }
                    setDishes(loadTakeoutDishes());
                    setEditing(null);
                    setMsg("已保存");
                  }}
                />
              ) : (
                <div key={d.id} className="yq-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{d.name}</div>
                    <div className="yq-hint">
                      {d.category}
                      {d.priceRange ? ` · ${d.priceRange}` : ""}
                      {d.flavorTags.length ? ` · ${d.flavorTags.join("/")}` : ""}
                    </div>
                    <DishNutrition
                      dish={d}
                      onLink={(patch) => {
                        updateTakeoutDish(d.id, patch);
                        setDishes(loadTakeoutDishes());
                      }}
                    />
                  </div>
                  <span style={{ display: "flex", gap: 4, flex: "0 0 auto" }}>
                    <button className="yq-btn yq-btn-sm yq-btn-ghost" onClick={() => setEditing(d)}>
                      改
                    </button>
                    <button
                      className="yq-btn yq-btn-sm yq-btn-ghost"
                      onClick={() => {
                        snapshot(`删除「${d.name}」`);
                        removeTakeoutDish(d.id);
                        setDishes(loadTakeoutDishes());
                        setMsg(`已删除「${d.name}」`);
                      }}
                    >
                      删
                    </button>
                  </span>
                </div>
              ),
            )}
          </section>
          );
        })
      )}

      {dishes.length > 0 && (
        <p className="yq-hint" style={{ textAlign: "center" }}>
          共 {dishes.length} 道菜 · {[...new Set(dishes.map((d) => d.restaurant))].length} 个商家。
          这些数据只在你本地，建议定期「设置 → 导出备份」。
        </p>
      )}
    </>
  );
}

/** 单道菜的内联编辑（改完原地收起来，不弹层，移动端更省事） */
function DishEditor({
  dish,
  onSave,
  onCancel,
}: {
  dish: TakeoutDish;
  onSave: (patch: Partial<Omit<TakeoutDish, "id">>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(dish.name);
  const [category, setCategory] = useState(dish.category);
  const [price, setPrice] = useState(dish.priceRange ?? "");
  const [flavor, setFlavor] = useState<string[]>(dish.flavorTags);
  const [avoid, setAvoid] = useState<string[]>(dish.avoidConflicts);

  function toggle(list: string[], set: (v: string[]) => void, v: string) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--yq-line)" }}>
      <input className="yq-input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 8 }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input className="yq-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="品类" />
        <input className="yq-input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="价格" />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {FLAVOR_TAGS.map((t) => (
          <button key={t.label} className="yq-chip" data-on={flavor.includes(t.label)} onClick={() => toggle(flavor, setFlavor, t.label)}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {AVOID_TAGS.map((t) => (
          <button key={t.label} className="yq-chip" data-on={avoid.includes(t.label)} onClick={() => toggle(avoid, setAvoid, t.label)}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="yq-btn yq-btn-sm yq-btn-primary"
          onClick={() =>
            onSave({
              name: name.trim(),
              category: category.trim() || "未分类",
              priceRange: price.trim() || undefined,
              flavorTags: flavor,
              avoidConflicts: avoid,
            })
          }
        >
          保存
        </button>
        <button className="yq-btn yq-btn-sm" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
