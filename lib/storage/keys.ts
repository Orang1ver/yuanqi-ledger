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
  /** 更新提示是否已关闭 */
  updateBannerDismissed: "recipe.updateBannerDismissed.v1",
  /** 饮食日记（元气账本新增） */
  dietLog: "recipe.dietLog.v1",
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];
