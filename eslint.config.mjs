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
  ]),
]);

export default eslintConfig;
