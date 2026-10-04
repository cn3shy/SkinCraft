#!/usr/bin/env node
/**
 * 生成用于开发与压测的样例皮肤（64×64 合法 PNG）。
 *
 * 这些是纯代码画出来的方块图，只用于验证 3D 渲染、卡片池化和 WebGL 上下文回收，
 * 不是真实皮肤作品，不要提交进生产目录。
 *
 * 用法:
 *   node scripts/gen-sample-skins.mjs             # 生成 1 张，ID 00000001
 *   node scripts/gen-sample-skins.mjs 50          # 生成 50 张
 *   node scripts/gen-sample-skins.mjs 50 100      # 从 ID 00000064（十进制的 100）开始
 *   node scripts/gen-sample-skins.mjs 50 1 --force  # 覆盖已存在的文件
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from './lib/png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIN_DIR = join(ROOT, 'public', 's')

const SIZE = 64
const ID_PATTERN = /^[0-9a-f]{8}$/

// ---------------------------------------------------------------- 皮肤绘制

/** 用 HSL 生成一组区分度明显的配色。 */
function palette(index) {
  const hue = (index * 137.508) % 360 // 黄金角散布，相邻皮肤颜色不会接近
  const hsl = (h, s, l) => {
    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = l - c / 2
    const [r, g, b] =
      h < 60 ? [c, x, 0]
      : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c]
      : h < 300 ? [x, 0, c]
      : [c, 0, x]
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
  }
  return {
    shirt: hsl(hue, 0.65, 0.5),
    pants: hsl((hue + 180) % 360, 0.35, 0.28),
    skin: hsl(28, 0.42, 0.66),
    ink: [24, 24, 32],
  }
}

/**
 * 按 Minecraft 64×64 皮肤布局画一张可辨认的测试皮肤：
 * 头部在 (0,0)-(31,15)，身体在 (16,16)-(39,31)，手臂与腿各自成区。
 */
function makeSkin(index) {
  const px = new Uint8Array(SIZE * SIZE * 4)
  const { shirt, pants, skin, ink } = palette(index)

  const set = (x, y, [r, g, b], a = 255) => {
    const o = (y * SIZE + x) * 4
    px[o] = r
    px[o + 1] = g
    px[o + 2] = b
    px[o + 3] = a
  }
  const fill = (x0, y0, x1, y1, color) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, color)
  }

  fill(0, 0, SIZE - 1, SIZE - 1, shirt)

  // 头部六面
  fill(0, 0, 31, 15, skin)
  // 右腿 (0,16)-(15,31) 与左腿 (16,48)-(31,63)
  fill(0, 16, 15, 31, pants)
  fill(16, 48, 31, 63, pants)

  // 脸部正面在 (8,8)-(15,15)：画一对眼睛和一张嘴，便于肉眼确认渲染朝向正确
  fill(9, 12, 10, 12, ink)
  fill(13, 12, 14, 12, ink)
  fill(11, 14, 12, 14, (ink.map((v) => Math.round(v * 0.7 + skin[0] * 0.3))))

  return px
}

// ---------------------------------------------------------------- 入口

const args = process.argv.slice(2)
const force = args.includes('--force')
const positional = args.filter((a) => !a.startsWith('--'))
const count = Number(positional[0] ?? 1)
const startId = Number(positional[1] ?? 1)

if (!Number.isInteger(count) || count < 1) {
  console.error('数量必须是正整数')
  process.exit(1)
}
if (!Number.isInteger(startId) || startId < 1) {
  console.error('起始 ID 必须是正整数')
  process.exit(1)
}
if (startId + count - 1 > 0xffffffff) {
  console.error('超出 8 位十六进制 ID 上限 ffffffff')
  process.exit(1)
}

mkdirSync(SKIN_DIR, { recursive: true })

let written = 0
let skipped = 0

for (let i = 0; i < count; i++) {
  const numericId = startId + i
  const id = numericId.toString(16).padStart(8, '0')
  if (!ID_PATTERN.test(id)) {
    console.error(`生成的 ID 不合法: ${id}`)
    process.exit(1)
  }

  const path = join(SKIN_DIR, `${id}.png`)
  if (existsSync(path) && !force) {
    skipped++
    continue
  }

  writeFileSync(path, encodePng(SIZE, SIZE, makeSkin(numericId)))
  written++
}

console.log(`已生成 ${written} 张样例皮肤到 public/s/`)
if (skipped > 0) console.log(`跳过 ${skipped} 张已存在的文件（加 --force 可覆盖）`)
console.log(`ID 范围: ${startId.toString(16).padStart(8, '0')} ~ ${(startId + count - 1).toString(16).padStart(8, '0')}`)
