/**
 * App 内展示的更新日志。
 *
 * ⚠️ 发版时必须同步维护，且 **最新的放在数组最前面**。
 * scripts/deploy.mjs 会校验这里是否包含 package.json 的版本号，漏了就不让发布 ——
 * 因为 App 里的"更新了什么"是用户唯一能看到的说明，缺了它用户不知道要不要更新。
 *
 * 与 CHANGELOG.md 的分工：这里是给用户看的短句，CHANGELOG.md 是完整的开发记录。
 */

export type ChangelogEntry = {
  version: string;
  date: string;
  /** 给用户看的一句话概要 */
  highlights: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.1.0",
    date: "2026-09-17",
    highlights: [
      "元气账本上线：吃喝动睡一屏记完，数据都只存在你自己的设备上",
      "全新的视觉：宣纸白 + 竹青，深浅两套主题",
      "健康小屋：档案、喝水、步数、睡眠、心情、体重、运动",
      "成就系统：打卡徽章 + 运动里程碑两套独立的奖励",
      "菜单库支持改商家名、批量删除与一次撤销",
      "周报：打卡达标率、运动统计、体重变化",
      "设置里可导出/导入备份，支持覆盖导入",
    ],
  },
];

/** 最近 n 条，用于设置面板里的"更新了什么" */
export function recentChanges(n = 3): ChangelogEntry[] {
  return CHANGELOG.slice(0, n);
}
