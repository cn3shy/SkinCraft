import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodePng, parsePngHeader } from '../scripts/lib/png.mjs'

/** 造一张纯色皮肤，用于往返测试。 */
function solidPng(width = 64, height = 64, rgba = [255, 0, 0, 255]) {
  const px = new Uint8Array(width * height * 4)
  for (let i = 0; i < px.length; i += 4) px.set(rgba, i)
  return encodePng(width, height, px)
}

test('parsePngHeader 读出宽高与像素格式', () => {
  const header = parsePngHeader(solidPng(64, 64))
  assert.deepEqual(header, { width: 64, height: 64, bitDepth: 8, colorType: 6 })
})

test('parsePngHeader 支持旧版 64×32 皮肤的尺寸', () => {
  const header = parsePngHeader(solidPng(64, 32))
  assert.equal(header.width, 64)
  assert.equal(header.height, 32)
})

test('parsePngHeader 拒绝魔数不对的数据', () => {
  const notPng = Buffer.from('this is definitely not a png file at all')
  assert.throws(() => parsePngHeader(notPng), /不是有效的 PNG|magic/i)
})

test('parsePngHeader 拒绝被截断的数据', () => {
  const truncated = solidPng(64, 64).subarray(0, 16)
  assert.throws(() => parsePngHeader(truncated), /截断|不完整|too short/i)
})

test('parsePngHeader 拒绝 IHDR 位置不对的数据', () => {
  const corrupted = solidPng(64, 64)
  corrupted.write('XXXX', 12, 'latin1')
  assert.throws(() => parsePngHeader(corrupted), /IHDR/)
})

test('encodePng 产出以 IEND 结尾的完整 PNG', () => {
  const buf = solidPng(64, 64)
  assert.deepEqual(
    [...buf.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  )
  assert.equal(buf.toString('latin1', buf.length - 8, buf.length - 4), 'IEND')
})
