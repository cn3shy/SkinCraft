#!/usr/bin/env node
/**
 * 扫描 public/s/ 下的皮肤 PNG，结合 skins.meta.json 的展示元数据，
 * 生成站点索引 public/skins.json。
 *
 * 该文件是构建产物（已 gitignore），每次构建重新生成，不手工维护。
 * 逻辑本身在 lib/skin-index.mjs 里，这里只做文件系统读写。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex } from './lib/skin-index.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIN_DIR = join(ROOT, 'public', 's')
const META_PATH = join(ROOT, 'skins.meta.json')
const OUT_PATH = join(ROOT, 'public', 'skins.json')

/** 皮肤文件名必须是 8 位小写十六进制 ID，与 8 位十六进制 ID 上限 ffffffff 一致。 */
const ID_FILE_PATTERN = /^([0-9a-f]{8})\.png$/

function readMeta() {
  if (!existsSync(META_PATH)) {
    return { version: 1, nextId: 1, skins: [] }
  }
  const raw = readFileSync(META_PATH, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    // 元数据坏掉时不能当成空 meta 继续：那会让 nextId 退回 1，
    // 之后的上传就会从 00000001 开始覆盖既有皮肤。
    console.error(`✗ 解析 ${META_PATH} 失败，已中止构建：${error.message}`)
    process.exit(1)
  }
}

function readEntries() {
  if (!existsSync(SKIN_DIR)) {
    return { entries: [], warnings: [] }
  }

  const entries = []
  const warnings = []

  for (const name of readdirSync(SKIN_DIR).sort()) {
    const match = ID_FILE_PATTERN.exec(name)
    if (!match) {
      warnings.push(
        `${name} 不符合命名规则（应为 8 位小写十六进制 + .png），已忽略`,
      )
      continue
    }
    entries.push({ id: match[1], buffer: readFileSync(join(SKIN_DIR, name)) })
  }

  return { entries, warnings }
}

const { entries, warnings: scanWarnings } = readEntries()
const { index, warnings, blockers } = buildIndex({
  entries,
  meta: readMeta(),
  generatedAt: new Date().toISOString(),
})

// 撞号属于必须人肉修掉的问题，写完索引再失败会留下一个有问题的产物
if (blockers.length > 0) {
  console.error('✗ 索引未生成：以下问题会让后台上传覆盖既有皮肤，请先修复')
  for (const blocker of blockers) {
    console.error(`  ✗ ${blocker}`)
  }
  process.exit(1)
}

writeFileSync(OUT_PATH, `${JSON.stringify(index, null, 2)}\n`)

const allWarnings = [...scanWarnings, ...warnings]
for (const warning of allWarnings) {
  console.warn(`  ⚠ ${warning}`)
}
if (allWarnings.length > 0) {
  console.warn(`索引已生成: public/skins.json（${index.count} 张皮肤，${allWarnings.length} 条告警）`)
} else {
  console.log(`索引已生成: public/skins.json（${index.count} 张皮肤）`)
}
