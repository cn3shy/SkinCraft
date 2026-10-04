import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRoute } from '../src/lib/route.ts'

test('根路径进入画廊', () => {
  assert.deepEqual(parseRoute('#/'), { name: 'gallery' })
})

test('空 hash 进入画廊', () => {
  assert.deepEqual(parseRoute(''), { name: 'gallery' })
  assert.deepEqual(parseRoute('#'), { name: 'gallery' })
})

test('识别后台路由', () => {
  assert.deepEqual(parseRoute('#/admin'), { name: 'admin' })
})

test('识别皮肤详情路由并带出 ID', () => {
  assert.deepEqual(parseRoute('#/s/00000001'), { name: 'detail', id: '00000001' })
  assert.deepEqual(parseRoute('#/s/000000ff'), { name: 'detail', id: '000000ff' })
})

test('大写十六进制 ID 不匹配，因为文件系统里只有小写名', () => {
  assert.deepEqual(parseRoute('#/s/0000001A'), { name: 'gallery' })
})

test('ID 长度不对或含非十六进制字符时不匹配', () => {
  assert.deepEqual(parseRoute('#/s/1'), { name: 'gallery' })
  assert.deepEqual(parseRoute('#/s/000000001'), { name: 'gallery' })
  assert.deepEqual(parseRoute('#/s/zzzzzzzz'), { name: 'gallery' })
})

test('多余路径段不匹配', () => {
  assert.deepEqual(parseRoute('#/s/00000001/extra'), { name: 'gallery' })
})

test('未知路径回落到画廊', () => {
  assert.deepEqual(parseRoute('#/nope'), { name: 'gallery' })
})
