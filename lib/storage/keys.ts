/**
 * localStorage 键名总表 —— **数据契约的核心**。
 *
 * ⚠️ 这些字符串是对外契约：用户设备里存的就是这些键，改动等于让那部分数据读不出来。
 * 改任何一个键名 = 对应的数据在用户眼里"消失"。新增键时注意两件事：
 *
 * 1) 必须带 `recipe.` 前缀，否则不会被备份导出/导入/清空覆盖。
 * 2) **不得与既有键产生子串重叠**。备份预览用的是子串匹配
 *    （见 backup.ts 的 describeBackup），例如叫 `recipe.takeoutMock.snapshot.v1`
 *    会被 `has("takeoutMock")` 误判成菜单库。
 */

export const KEYS = {
  /** 常用食材清单 */
  ingredients: "recipe.commonIngredients.v1",
  /** 一餐饭的记录 */
  meals: "recipe.mealRecords.v1",
  /** 每周分析（按 weekStart 索引的缓存） */
  weeklyInsight: "recipe.weeklyInsight.v1",
  /** 用户饮食习惯笔记（AI 会读它） */
  userProfile: "recipe.userProfile.v1",
  /** 外卖/菜单库 */
  takeoutMock: "recipe.takeoutMock.v2",
  /** 健康档案（身高体重等） */
  healthProfile: "recipe.healthProfile.v1",
  /** 每日打卡：喝水/步数/睡眠/心情，按日期索引 */
  dailyCheckins: "recipe.dailyCheckins.v1",
  /** 打卡奖励（连续天数 + 徽章） */
  rewards: "recipe.rewards.v1",
  /** 体重记录，按日期索引 */
  weights: "recipe.weights.v1",
  /** 运动记录（数组） */
  exercises: "recipe.exercises.v1",
  /** 运动里程碑，独立于打卡徽章 */
  exerciseAwards: "recipe.exerciseAwards.v1",
  /** 菜单库是否播过种（一次性标记，防止删光后示例又回来） */
  takeoutSeeded: "recipe.takeoutSeeded.v1",
  /** 菜单库破坏性操作前的单槽快照（撤销用） */
  takeoutUndo: "recipe.takeoutUndo.v1",
  /** AI 接口 Key */
  apikeys: "recipe.apikeys.v1",
  /** 应用偏好：我的杯子容量 + 界面主题 */
  prefs: "recipe.prefs.v1",
  /** iOS 安装提示是否已关闭 */
  iosInstallHintDismissed: "recipe.iosInstallHintDismissed.v1",
  /**
   * 安卓「装到桌面」提示是否已关闭。
   * 与 iOS 那个同一个性质：**应用元数据**，不进 `describeBackup` 的导入预览。
   */
  androidInstallHintDismissed: "recipe.androidInstallHintDismissed.v1",
  /** 更新提示是否已关闭（老键：布尔。新代码改用下面那个记版本号的键） */
  updateBannerDismissed: "recipe.updateBannerDismissed.v1",
  /**
   * 「这次先不更新」记的是**哪一个版本**，不是一个布尔。
   *
   * ⚠️ 为什么不用布尔：布尔只有"永远不再提示"这一种语义 ——
   * 用户点了一次「稍后」，以后**任何**新版本都不会再告诉他，
   * 那这个"应用内更新"就等于只有第一次有效。记版本号之后，
   * 「稍后」只对**这一个版本**生效，出下一个版本照样提示。
   *
   * 与 `updateBannerDismissed` 同一个性质：**应用元数据**，不进导入预览。
   */
  updateDeferredVersion: "recipe.updateDeferredVersion.v1",
  /** 饮食日记（元气账本新增） */
  dietLog: "recipe.dietLog.v1",
  /**
   * 用户自己加的食物（拍照识别 / 手输）。
   *
   * ⚠️ 与内置库**分开存**：内置库是构建期资产（`data/foods.zh.json`），打进
   * bundle 里的，运行时改不了。用户加的东西必须住在一个能在运行时写的地方。
   *
   * 检索时两者会合并（见 `lib/nutrition/lookup.ts`），但存储上永远是两份 ——
   * 这样"清空我的食物库"不会碰到内置库，升级版本也不会把用户的东西冲掉。
   *
   * 已核对：`customFoods` 与既有全部键**无子串重叠**
   * （不会被 `describeBackup` 的 `has(...)` 误判成别的分组）。
   */
  customFoods: "recipe.customFoods.v1",
  /**
   * 久未备份提醒的状态：第一次打开 / 上次导出备份 / 静默期。
   * ⚠️ 这是**应用元数据**，不是用户记录 —— 所以刻意**不进** `describeBackup`
   * 的导入预览（同 `iosInstallHintDismissed` / `updateBannerDismissed`）。
   * 键名与既有键无子串重叠，不会被 `has(...)` 误判。
   */
  backupReminder: "recipe.backupReminder.v1",
  /**
   * 「整份覆盖」导入之前的一份快照，给用户一次撤销的机会。
   *
   * ⚠️ 与 `takeoutUndo` 同一个设计：**单槽**而不是栈 —— 快照是整份数据，
   * 多留几份会让备份文件明显变大，而用户真正需要的只是「哎我刚点错了」这一次。
   * 同样按 `takeoutUndo` 的先例**不进** `describeBackup`（它是快照，不是用户记录）。
   */
  importUndo: "recipe.importUndo.v1",
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];
