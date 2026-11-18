#!/usr/bin/env node
/**
 * Bundle 体积门禁：构建产物超过阈值就失败（防「不知不觉打包变胖」）。
 *
 * 用法：
 *   npm run build && npm run budget
 *
 * 阈值（可用环境变量覆盖）：
 *   MAX_TOTAL_GZIP_KB   全部 JS 的 gzip 总量上限，默认 1250KB（含按需加载的 SQL 编辑器）
 *   MAX_CHUNK_RAW_KB    单个 chunk 的未压缩体积上限，默认 1250KB
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DIST = path.resolve("dist/assets/js");
const MAX_TOTAL_GZIP_KB = Number(process.env.MAX_TOTAL_GZIP_KB || 1250);
const MAX_CHUNK_RAW_KB = Number(process.env.MAX_CHUNK_RAW_KB || 1250);

if (!fs.existsSync(DIST)) {
  console.error(`✗ 找不到 ${DIST}，先执行 npm run build`);
  process.exit(1);
}

const rows = fs
  .readdirSync(DIST)
  .filter((file) => file.endsWith(".js"))
  .map((file) => {
    const buf = fs.readFileSync(path.join(DIST, file));
    return { file, raw: buf.length, gz: zlib.gzipSync(buf).length };
  })
  .sort((a, b) => b.raw - a.raw);

const totalRaw = rows.reduce((sum, row) => sum + row.raw, 0);
const totalGz = rows.reduce((sum, row) => sum + row.gz, 0);
const kb = (bytes) => `${(bytes / 1024).toFixed(0)}KB`;

console.log(`JS 文件 ${rows.length} 个，总计 ${kb(totalRaw)} raw / ${kb(totalGz)} gzip`);
for (const row of rows.slice(0, 5)) {
  console.log(`  ${row.file.padEnd(44)} ${kb(row.raw).padStart(7)} raw / ${kb(row.gz).padStart(6)} gzip`);
}

const failures = [];
if (totalGz / 1024 > MAX_TOTAL_GZIP_KB) {
  failures.push(`总 gzip ${kb(totalGz)} > 预算 ${MAX_TOTAL_GZIP_KB}KB`);
}
const biggest = rows[0];
if (biggest && biggest.raw / 1024 > MAX_CHUNK_RAW_KB) {
  failures.push(`最大 chunk ${biggest.file} ${kb(biggest.raw)} > 预算 ${MAX_CHUNK_RAW_KB}KB`);
}

if (failures.length) {
  console.error("\n✗ 超出性能预算：");
  for (const message of failures) console.error(`  · ${message}`);
  console.error("  确属必要改动就调大 MAX_TOTAL_GZIP_KB / MAX_CHUNK_RAW_KB，并在更新日志里说明原因。");
  process.exit(1);
}

console.log("\n✓ 在性能预算内");
