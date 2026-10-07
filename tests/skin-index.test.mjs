import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { encodePng } from '../scripts/lib/png.mjs'
import { buildIndex } from '../scripts/lib/skin-index.mjs'

const GENERATED_AT = '2026-10-04T12:00:00.000Z'

/** 造一张纯色皮肤 PNG。 */
function skin(width = 64, height = 64) {
  const px = new Uint8Array(width * height * 4)
  for (let i = 0; i < px.length; i += 4) px.set([120, 160, 200, 255], i)
  return encodePng(width, height, px)
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** 默认的空 meta。 */
function meta(skins = [], nextId = 1) {
  return { version: 1, nextId, skins }
}

test('为每个 PNG 生成索引条目，展示字段取自 meta', () => {
  const buffer = skin()
  const { index } = buildIndex({
    entries: [{ id: '00000001', buffer }],
    meta: meta(
      [{ id: '00000001', sha256: sha256(buffer), name: 'Wreeper', uploadedAt: '2026-01-02T00:00:00Z' }],
      2,
    ),
    generatedAt: GENERATED_AT,
  })

  assert.equal(index.count, 1)
  // 索引里没有 name：展示名一律是 ID，meta 的 name 字段不输出到站点
  assert.deepEqual(index.skins[0], {
    id: '00000001',
    path: '/s/00000001.png',
    size: buffer.length,
    uploadedAt: '2026-01-02T00:00:00Z',
  })
})

test('索引里不出现 meta 的 name 字段', () => {
  const buffer = skin()
  const { index } = buildIndex({
    entries: [{ id: '00000001', buffer }],
    meta: meta(
      [{ id: '00000001', sha256: sha256(buffer), name: '不该出现', uploadedAt: null }],
      2,
    ),
    generatedAt: GENERATED_AT,
  })

  assert.equal('name' in index.skins[0], false)
  assert.equal(JSON.stringify(index).includes('不该出现'), false)
})

test('索引里不出现 sha256', () => {
  const buffer = skin()
  const { index } = buildIndex({
    entries: [{ id: '00000001', buffer }],
    meta: meta([{ id: '00000001', sha256: sha256(buffer), name: 'x', uploadedAt: '2026-01-02T00:00:00Z' }], 2),
    generatedAt: GENERATED_AT,
  })

  assert.equal('sha256' in index.skins[0], false)
  assert.equal(JSON.stringify(index).includes(sha256(buffer)), false)
})

test('体积以实际文件为准，忽略 meta 里写错的声明', () => {
  const buffer = skin()
  const { index, warnings } = buildIndex({
    entries: [{ id: '00000001', buffer }],
    meta: meta([{ id: '00000001', sha256: 'deadbeef', name: 'x', size: 999999, uploadedAt: '2026-01-02T00:00:00Z' }], 2),
    generatedAt: GENERATED_AT,
  })

  assert.equal(index.skins[0].size, buffer.length)
  assert.equal(warnings.some((w) => w.includes('sha256')), true)
})

test('meta 里缺失条目时自动收录，uploadedAt 留空并告警', () => {
  const buffer = skin()
  const { index, warnings } = buildIndex({
    entries: [{ id: '00000007', buffer }],
    meta: meta([], 8),
    generatedAt: GENERATED_AT,
  })

  assert.equal(index.count, 1)
  assert.equal(index.skins[0].uploadedAt, null)
  assert.equal(warnings.some((w) => w.includes('00000007')), true)
})

test('meta 有记录但文件缺失时告警，且不进入索引', () => {
  const { index, warnings } = buildIndex({
    entries: [],
    meta: meta([{ id: '00000009', sha256: 'abc', name: '幽灵', uploadedAt: '2026-01-02T00:00:00Z' }], 10),
    generatedAt: GENERATED_AT,
  })

  assert.equal(index.count, 0)
  assert.equal(warnings.some((w) => w.includes('00000009')), true)
})

test('按 uploadedAt 倒序排列，缺时间的排最后', () => {
  const older = skin()
  const newer = skin(64, 32)
  const { index } = buildIndex({
    entries: [
      { id: '00000001', buffer: older },
      { id: '00000002', buffer: newer },
      { id: '00000003', buffer: skin() },
    ],
    meta: meta(
      [
        { id: '00000001', sha256: sha256(older), name: '老', uploadedAt: '2026-01-01T00:00:00Z' },
        { id: '00000002', sha256: sha256(newer), name: '新', uploadedAt: '2026-06-01T00:00:00Z' },
      ],
      4,
    ),
    generatedAt: GENERATED_AT,
  })

  assert.deepEqual(
    index.skins.map((s) => s.id),
    ['00000002', '00000001', '00000003'],
  )
})

test('非 PNG 文件被跳过并告警', () => {
  const { index, warnings } = buildIndex({
    entries: [{ id: '00000005', buffer: Buffer.from('not a png at all, really not one') }],
    meta: meta([], 6),
    generatedAt: GENERATED_AT,
  })

  assert.equal(index.count, 0)
  assert.equal(warnings.some((w) => w.includes('00000005')), true)
})

test('尺寸不是 64×64 或 64×32 时告警，但仍收录', () => {
  const buffer = skin(128, 128)
  const { index, warnings } = buildIndex({
    entries: [{ id: '00000001', buffer }],
    meta: meta([{ id: '00000001', sha256: sha256(buffer), name: '大图', uploadedAt: '2026-01-01T00:00:00Z' }], 2),
    generatedAt: GENERATED_AT,
  })

  assert.equal(index.count, 1)
  assert.equal(warnings.some((w) => w.includes('128')), true)
})

test('文件 ID 大于等于 nextId 时列为 blocker，构建必须失败', () => {
  const buffer = skin()
  const { warnings, blockers } = buildIndex({
    entries: [{ id: '00000005', buffer }],
    meta: meta([], 3),
    generatedAt: GENERATED_AT,
  })

  // 撞号会让后台上传覆盖既有 PNG，所以不能再降级成「告警后继续构建」
  assert.equal(blockers.length, 1)
  assert.equal(blockers[0].includes('nextId'), true)
  // 报错文案要直接给出该改成多少，八位十六进制
  assert.equal(blockers[0].includes('00000006'), true)
  assert.equal(warnings.some((w) => w.includes('nextId')), false)
})

test('ID 恰好等于 nextId 时也算撞号', () => {
  const { blockers } = buildIndex({
    entries: [{ id: '00000003', buffer: skin() }],
    meta: meta([], 3),
    generatedAt: GENERATED_AT,
  })

  assert.equal(blockers.length, 1)
})

test('ID 小于 nextId 时不产生 blocker', () => {
  const buffer = skin()
  const { blockers } = buildIndex({
    entries: [{ id: '00000001', buffer }],
    meta: meta([{ id: '00000001', sha256: sha256(buffer), name: 'ok', uploadedAt: null }], 8),
    generatedAt: GENERATED_AT,
  })

  assert.deepEqual(blockers, [])
})

test('索引带上 version 与 generatedAt', () => {
  const { index } = buildIndex({ entries: [], meta: meta(), generatedAt: GENERATED_AT })
  assert.equal(index.version, 1)
  assert.equal(index.generatedAt, GENERATED_AT)
  assert.equal(index.count, 0)
})
