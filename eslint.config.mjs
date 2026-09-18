import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 发布脚本生成的中间产物
    "public/sw.js",
    // npm run check:data 编译出的 CommonJS 产物（不是手写源码，不必 lint）
    ".tmp-check/**",
    // 安卓壳。它里面**有一份拷贝的 Web 构建产物**
    // （android/app/src/main/assets/public，由 cap sync 铺进去），
    // 不排除的话 lint 会去爬那几千个生成文件 —— 基线立刻从 0 错变成 20+ 错。
    // 我们手写的只有 MainActivity.java 那几个文件，它们不归这套规则管。
    "android/**",
    // 打好的 APK（构建输出）
    "dist/**",
  ]),
]);

export default eslintConfig;
