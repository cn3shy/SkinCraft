import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { encodePng } from '../scripts/lib/png.mjs'
import { handleUpload } from '../functions/api/upload.ts'
import { createFakeGitHub } from './helpers/fake-github.mjs'

const PASSWORD = 'correct-horse-battery-staple-0123456789abcdef'

const ENV = {
  ADMIN_PASSWORD: PASSWORD,
  GITHUB_TOKEN: 'github_pat_fake',
  GITHUB_REPO: '3shy/SkinCraft',
  GITHUB_BRANCH: 'main',
  SITE_ORIGIN: 'https://skins.3shy.cn',
}

function skinPng(width = 64, height = 64, tint = 120) {
  const px = new Uint8Array(width * height * 4)
  for (let i = 0; i < px.length; i += 4) px.set([tint, tint + 20, tint + 40, 255], i)
  return encodePng(width, height, px)
}

function itemFrom(buffer, name = '测试皮肤') {
  return {
    name,
    contentBase64: buffer.toString('base64'),
    sha256: createHash('sha256').update(buffer).digest('hex'),
    size: buffer.length,
  }
}

function request(body, { password = PASSWORD, method = 'POST' } = {}) {
  return new Request('https://skins.3shy.cn/api/upload', {
    method,
    headers: {
      authorization: `Bearer ${password}`,
      'content-type': 'application/json',
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}

function seedMeta(meta) {
  return new Map([['skins.meta.json', Buffer.from(`${JSON.stringify(meta)}\n`)]])
}

const EMPTY_META = { version: 1, nextId: 1, skins: [] }

function readMeta(state) {
  return JSON.parse(state.files.get('skins.meta.json').toString('utf8'))
}

// ---------------------------------------------------------------- 鉴权

test('密码错误返回 401', async () => {
  const { fetchImpl } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const response = await handleUpload(
    request({ items: [] }, { password: 'wrong-password-of-same-length-000000' }),
    ENV,
    { fetch: fetchImpl },
  )
  assert.equal(response.status, 401)
})

test('未配置 ADMIN_PASSWORD 时一律拒绝，绝不退化成无鉴权', async () => {
  const { fetchImpl, state } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const response = await handleUpload(
    request({ items: [itemFrom(skinPng())] }),
    { ...ENV, ADMIN_PASSWORD: undefined },
    { fetch: fetchImpl },
  )
  assert.equal(response.status, 401)
  assert.equal(state.commits.length, 0)
})

test('非 POST 方法返回 405', async () => {
  const { fetchImpl } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const response = await handleUpload(request({}, { method: 'GET' }), ENV, { fetch: fetchImpl })
  assert.equal(response.status, 405)
})

// ---------------------------------------------------------------- 正常上传

test('上传一张新皮肤会创建一次提交并写入 PNG 与 meta', async () => {
  const { fetchImpl, state } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const item = itemFrom(skinPng(), 'Wreeper')

  const response = await handleUpload(request({ items: [item] }), ENV, { fetch: fetchImpl })
  assert.equal(response.status, 200)

  const body = await response.json()
  assert.deepEqual(body.results, [
    { status: 'created', id: '00000001', url: 'https://skins.3shy.cn/s/00000001.png' },
  ])
  assert.equal(body.commitSha, 'commit-1')

  assert.equal(state.commits.length, 1, '应当只产生一次提交')
  assert.ok(state.files.has('public/s/00000001.png'), '应当写入皮肤文件')

  const meta = readMeta(state)
  assert.equal(meta.nextId, 2)
  assert.equal(meta.skins.length, 1)
  assert.equal(meta.skins[0].id, '00000001')
  assert.equal(meta.skins[0].name, 'Wreeper')
  assert.equal(meta.skins[0].sha256, item.sha256)
  assert.equal(meta.skins[0].size, item.size)
  assert.ok(meta.skins[0].uploadedAt, '应当记录上传时间')
})

test('多张皮肤合并成一次提交', async () => {
  const { fetchImpl, state } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const items = [itemFrom(skinPng(64, 64, 10), 'A'), itemFrom(skinPng(64, 64, 90), 'B'), itemFrom(skinPng(64, 64, 170), 'C')]

  const response = await handleUpload(request({ items }), ENV, { fetch: fetchImpl })
  assert.equal(response.status, 200)

  const body = await response.json()
  assert.deepEqual(
    body.results.map((r) => r.id),
    ['00000001', '00000002', '00000003'],
  )
  assert.equal(state.commits.length, 1, '三张皮肤也应当只有一次提交')
  assert.equal(readMeta(state).nextId, 4)
})

test('重复上传同一张皮肤返回既有直链且不产生新提交', async () => {
  const { fetchImpl, state } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const item = itemFrom(skinPng())

  const first = await (await handleUpload(request({ items: [item] }), ENV, { fetch: fetchImpl })).json()
  const commitsAfterFirst = state.commits.length

  const second = await (
    await handleUpload(request({ items: [item] }), ENV, { fetch: fetchImpl })
  ).json()

  assert.equal(second.results[0].status, 'duplicate')
  assert.equal(second.results[0].id, first.results[0].id)
  assert.equal(second.results[0].url, first.results[0].url)
  assert.equal(state.commits.length, commitsAfterFirst, '重复上传不应产生新提交')
  assert.equal(readMeta(state).skins.length, 1, '不应重复写入 meta 条目')
})

test('批次内两张相同的皮肤只占一个 ID', async () => {
  const { fetchImpl, state } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const png = skinPng()

  const response = await handleUpload(
    request({ items: [itemFrom(png, '一'), itemFrom(png, '二')] }),
    ENV,
    { fetch: fetchImpl },
  )
  const body = await response.json()

  assert.equal(body.results[0].status, 'created')
  assert.equal(body.results[1].status, 'duplicate')
  assert.equal(body.results[1].id, body.results[0].id)
  assert.equal(readMeta(state).skins.length, 1)
})

test('新 ID 会跳过仓库里已存在的文件，避免撞号', async () => {
  const files = seedMeta({ version: 1, nextId: 1, skins: [] })
  files.set('public/s/00000001.png', skinPng(64, 64, 200))

  const { fetchImpl, state } = createFakeGitHub({ files })
  const response = await handleUpload(request({ items: [itemFrom(skinPng())] }), ENV, {
    fetch: fetchImpl,
  })
  const body = await response.json()

  assert.equal(body.results[0].id, '00000002', '00000001 已被占用，应当让位')
  assert.equal(readMeta(state).nextId, 3)
})

// ---------------------------------------------------------------- 预检

test('dryRun 只回报计划，不产生任何提交', async () => {
  const { fetchImpl, state } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const response = await handleUpload(
    request({ items: [itemFrom(skinPng())], dryRun: true }),
    ENV,
    { fetch: fetchImpl },
  )

  const body = await response.json()
  assert.equal(body.dryRun, true)
  assert.equal(body.results[0].status, 'created')
  assert.equal(body.results[0].id, '00000001')
  assert.equal(state.commits.length, 0, 'dryRun 不应提交')
  assert.equal(readMeta(state).nextId, 1, 'dryRun 不应改动 meta')
})

// ---------------------------------------------------------------- 校验

test('尺寸不是皮肤尺寸时整批拒绝且不提交', async () => {
  const { fetchImpl, state } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const response = await handleUpload(
    request({ items: [itemFrom(skinPng(128, 128))] }),
    ENV,
    { fetch: fetchImpl },
  )

  assert.equal(response.status, 400)
  assert.equal(state.commits.length, 0)
})

test('批次里只要有一张不合法就整批拒绝，保证原子性', async () => {
  const { fetchImpl, state } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const response = await handleUpload(
    request({ items: [itemFrom(skinPng(), '好图'), itemFrom(skinPng(32, 32), '坏图')] }),
    ENV,
    { fetch: fetchImpl },
  )

  assert.equal(response.status, 400)
  const body = await response.json()
  assert.ok(body.results.some((r) => r.status === 'invalid'))
  assert.equal(state.commits.length, 0, '一张不合法就不应写入任何东西')
})

test('声明的 sha256 与实际内容不符时拒绝', async () => {
  const { fetchImpl } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const item = { ...itemFrom(skinPng()), sha256: 'a'.repeat(64) }

  const response = await handleUpload(request({ items: [item] }), ENV, { fetch: fetchImpl })
  assert.equal(response.status, 400)
})

test('非 PNG 内容被拒绝', async () => {
  const { fetchImpl } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const junk = Buffer.from('这不是 PNG，只是一段普通文本而已')
  const response = await handleUpload(
    request({ items: [itemFrom(junk)] }),
    ENV,
    { fetch: fetchImpl },
  )
  assert.equal(response.status, 400)
})

test('超过单批上限返回 413', async () => {
  const { fetchImpl, state } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  const items = Array.from({ length: 31 }, (_, i) => itemFrom(skinPng(64, 64, i * 3), `#${i}`))

  const response = await handleUpload(request({ items }), { ...ENV, MAX_BATCH: '30' }, {
    fetch: fetchImpl,
  })
  assert.equal(response.status, 413)
  assert.equal(state.commits.length, 0)
})

// ---------------------------------------------------------------- 并发

test('PATCH ref 遇到 422 时整体重试，最终提交成功', async () => {
  const { fetchImpl, state } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  state.conflictsToSimulate = 1

  const response = await handleUpload(request({ items: [itemFrom(skinPng())] }), ENV, {
    fetch: fetchImpl,
  })

  assert.equal(response.status, 200)
  // 冲突那一次不会落地，分支只应被推进一次
  assert.equal(state.refUpdates, 1)
  assert.ok(state.files.has('public/s/00000001.png'), '重试后皮肤文件应当已入树')
  assert.equal(readMeta(state).nextId, 2, '重试不应重复分配 ID')
})

test('重试会重新读取 meta，不会重复占用已被人抢走的 ID', async () => {
  const { fetchImpl, state } = createFakeGitHub({ files: seedMeta(EMPTY_META) })
  state.conflictsToSimulate = 1

  // 模拟并发上传在第一次 PATCH 失败时已经把 00000001 用掉了
  const originalFetch = fetchImpl
  const raced = async (url, init) => {
    if (state.conflictsToSimulate === 1 && (init?.method ?? 'GET') === 'PATCH') {
      state.conflictsToSimulate = 0
      state.commitCounter += 1
      state.files.set('public/s/00000001.png', skinPng(64, 64, 250))
      state.files.set(
        'skins.meta.json',
        Buffer.from(
          JSON.stringify({
            version: 1,
            nextId: 2,
            skins: [{ id: '00000001', sha256: 'x'.repeat(64), name: '别人传的', size: 1, uploadedAt: '2026-01-01T00:00:00Z' }],
          }),
        ),
      )
      return new Response(JSON.stringify({ message: 'not a fast forward' }), { status: 422 })
    }
    return originalFetch(url, init)
  }

  const response = await handleUpload(request({ items: [itemFrom(skinPng())] }), ENV, {
    fetch: raced,
  })

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.results[0].id, '00000002', '应当避开已被占用的 00000001')
  assert.equal(readMeta(state).nextId, 3)
  assert.equal(readMeta(state).skins.length, 2, '不应覆盖别人的 meta 条目')
})

test('GitHub 鉴权失败时返回 502 且不泄漏 token', async () => {
  const failing = async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
  const response = await handleUpload(request({ items: [itemFrom(skinPng())] }), ENV, {
    fetch: failing,
  })

  assert.equal(response.status, 502)
  assert.equal((await response.text()).includes(ENV.GITHUB_TOKEN), false)
})
