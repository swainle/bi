#!/usr/bin/env node
/**
 * 配置审计：每个 spec 参数字段必须真的被渲染器/面板消费。
 * 用法：node scripts/audit-config.mjs
 * 判定：字段名出现在 renderers/ 、editor/ 、pieOption.ts 里 = 已接线；否则视为死参数。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

const consumerFiles = [
  ...walk("src/features/components/renderers"),
  ...walk("src/features/components/editor"),
  "src/features/components/skin/pieOption.ts",
];
const consumerCode = consumerFiles.map(read).join("\n");

const SPEC_PY = "/Users/cavan-m4max/MingceBI/backend/app/components/spec.py";
const specPy = readFileSync(SPEC_PY, "utf8");

function fieldsOf(className) {
  const block = specPy.split(`class ${className}`)[1]?.split("\nclass ")[0] ?? "";
  return [...block.matchAll(/^ {4}([a-z_]+)\s*:/gm)].map((m) => m[1]);
}

const groups = {
  ComputeSpec: fieldsOf("ComputeSpec"),
  ChartSpec: fieldsOf("ChartSpec"),
  UiSpec: fieldsOf("UiSpec"),
};

const PASSTHROUGH = new Set(["bucket_size", "bucket_start", "bucket_count"]); // 后端算的
const dead = [];
for (const [group, fields] of Object.entries(groups)) {
  for (const field of fields) {
    if (PASSTHROUGH.has(field)) continue;
    if (!new RegExp(`\\b${field}\\b`).test(consumerCode)) dead.push(`${group}.${field}`);
  }
}

if (dead.length) {
  console.error("✗ 死参数（面板能调但渲染不生效）：");
  dead.forEach((d) => console.error("   -", d));
  process.exit(1);
}
console.log(`✓ 配置审计通过：${Object.entries(groups).map(([k, v]) => `${k}(${v.length})`).join(" / ")} 全部已接线`);
