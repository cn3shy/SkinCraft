/**
 * POST /api/upload —— 站长专属的皮肤上传端点。
 *
 * 流程：校验密码 → 逐张校验 PNG → 读 GitHub 现状 → 分配 ID 并去重
 *      → 用 Git Data API 把「所有 PNG + 更新后的 skins.meta.json」合并成一次提交
 *
 * 只使用 Web 标准 API（Request/Response/fetch/crypto.subtle/atob/btoa），
 * 这样同一份 handler 能被本地 Node 适配器零改动复用。
 *
 * GitHub 那一层在 lib/github.ts，与 /api/skin 的删除端点共用。
 */

import {
  MAX_ID,
  META_PATH,
  base64FromBytes,
  bytesFromBase64,
  createBlob,
  createCommit,
  createTree,
  fail,
  githubConfigured,
  idOf,
  json,
  mapWithConcurrency,
  patchRef,
  readBase,
  requireAdmin,
  sha256Hex,
  skinPath,
  urlFor,
  type Base,
  type Env,
  type Meta,
  type MetaEntry,
  type TreeEntry,
} from './lib/github.ts'

export type { Env }

// ---------------------------------------------------------------- 常量

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const VALID_DIMENSIONS = new Set(['64x64', '64x32'])
const MAX_SKIN_BYTES = 64 * 1024
const MAX_BODY_BYTES = 1024 * 1024
const DEFAULT_MAX_BATCH = 30
const MAX_ATTEMPTS = 3

// ---------------------------------------------------------------- 类型

export interface Deps {
  fetch?: typeof fetch
  now?: () => Date
}

interface PreparedItem {
  name: string
  /** 显式标注成非共享的 ArrayBuffer，才满足 crypto.subtle 的 BufferSource 约束 */
  bytes: Uint8Array<ArrayBuffer>
  sha256: string
}

// ---------------------------------------------------------------- PNG 校验

function parseSkinPng(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 29) {
    throw new Error('不是有效的 PNG：数据被截断')
  }

  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) {
      throw new Error('不是有效的 PNG：魔数不匹配')
    }
  }

  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (chunkType !== 'IHDR') {
    throw new Error('不是有效的 PNG：缺少 IHDR')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const bitDepth = bytes[24]
  const colorType = bytes[25]

  if (bitDepth !== 8) {
    throw new Error(`位深应为 8，实际为 ${bitDepth}`)
  }
  if (colorType !== 6 && colorType !== 3) {
    throw new Error(`颜色类型应为 6 或 3，实际为 ${colorType}`)
  }
  if (!VALID_DIMENSIONS.has(`${width}x${height}`)) {
    throw new Error(`尺寸应为 64×64 或 64×32，实际为 ${width}×${height}`)
  }

  const tail = String.fromCharCode(
    bytes[bytes.length - 8],
    bytes[bytes.length - 7],
    bytes[bytes.length - 6],
    bytes[bytes.length - 5],
  )
  if (tail !== 'IEND') {
    throw new Error('PNG 结构不完整：缺少 IEND')
  }

  return { width, height }
}

async function prepareItem(raw: unknown): Promise<PreparedItem> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('条目格式不正确')
  }
  const candidate = raw as Record<string, unknown>

  if (typeof candidate.contentBase64 !== 'string') {
    throw new Error('缺少 contentBase64')
  }

  const bytes = bytesFromBase64(candidate.contentBase64)
  if (bytes.length === 0) {
    throw new Error('内容是空的')
  }
  if (bytes.length > MAX_SKIN_BYTES) {
    throw new Error(`单张皮肤不能超过 ${MAX_SKIN_BYTES} 字节，实际 ${bytes.length} 字节`)
  }
  if (typeof candidate.size === 'number' && candidate.size !== bytes.length) {
    throw new Error('声明的 size 与实际内容长度不符')
  }

  parseSkinPng(bytes)

  const sha256 = await sha256Hex(bytes)
  if (typeof candidate.sha256 === 'string' && candidate.sha256.toLowerCase() !== sha256) {
    throw new Error('声明的 sha256 与实际内容不符')
  }

  const name = typeof candidate.name === 'string' ? candidate.name.trim().slice(0, 64) : ''
  return { name, bytes, sha256 }
}

// ---------------------------------------------------------------- 提交

/** 把一批 PNG 与更新后的 meta 合并成一次提交。返回 null 表示分支被并发推进，需要整体重试。 */
async function writeBatch(
  env: Env,
  fetchImpl: typeof fetch,
  base: Base,
  assignments: { id: string; item: PreparedItem }[],
  nextMeta: Meta,
  message: string,
): Promise<string | null> {
  const blobShas = await mapWithConcurrency(assignments, 6, (assignment) =>
    createBlob(env, fetchImpl, base64FromBytes(assignment.item.bytes)),
  )

  const metaBytes = new TextEncoder().encode(`${JSON.stringify(nextMeta, null, 2)}\n`)
  const metaBlobSha = await createBlob(env, fetchImpl, base64FromBytes(metaBytes))

  const entries: TreeEntry[] = [
    ...assignments.map((assignment, index) => ({
      path: skinPath(assignment.id),
      mode: '100644' as const,
      type: 'blob' as const,
      sha: blobShas[index],
    })),
    { path: META_PATH, mode: '100644', type: 'blob', sha: metaBlobSha },
  ]

  const treeSha = await createTree(env, fetchImpl, base.treeSha, entries)
  const commitSha = await createCommit(env, fetchImpl, treeSha, base.commitSha, message)
  return patchRef(env, fetchImpl, commitSha)
}

// ---------------------------------------------------------------- 主流程

export async function handleUpload(
  request: Request,
  env: Env,
  deps: Deps = {},
): Promise<Response> {
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const now = deps.now ?? (() => new Date())

  if (request.method !== 'POST') {
    return fail(405, '只接受 POST 请求')
  }

  // 未配置密码时必须拒绝，绝不能退化成「无鉴权可上传」
  const unauthorized = requireAdmin(request, env)
  if (unauthorized) return unauthorized

  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_BODY_BYTES) {
    return fail(413, `请求体不能超过 ${MAX_BODY_BYTES} 字节`)
  }

  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return fail(400, '请求体不是合法的 JSON')
  }

  const items = Array.isArray(payload.items) ? payload.items : []
  const maxBatch = Number(env.MAX_BATCH ?? DEFAULT_MAX_BATCH)
  if (items.length === 0) {
    return fail(400, 'items 不能为空')
  }
  if (items.length > maxBatch) {
    return fail(413, `单批最多 ${maxBatch} 张，本次 ${items.length} 张`)
  }

  // 校验必须整体通过才动 GitHub，保证一批要么全成、要么全不动
  const prepared: PreparedItem[] = []
  const validation: Record<string, unknown>[] = []
  for (const item of items) {
    try {
      prepared.push(await prepareItem(item))
      validation.push({ status: 'ready' })
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      validation.push({ status: 'invalid', reason })
    }
  }
  if (prepared.length !== items.length) {
    return fail(400, '有皮肤未通过校验，本批未做任何改动', { results: validation })
  }

  if (!githubConfigured(env)) {
    return fail(500, '服务端缺少 GitHub 配置')
  }

  const dryRun = payload.dryRun === true
  const message =
    typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim().slice(0, 200)
      : `上传 ${prepared.length} 张皮肤`

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const base = await readBase(env, fetchImpl)

      const bySha = new Map<string, string>()
      for (const entry of base.meta.skins) {
        if (entry?.sha256 && entry?.id) bySha.set(entry.sha256, entry.id)
      }

      let next = Number(base.meta.nextId ?? 1)
      const assignments: { id: string; item: PreparedItem }[] = []
      const results: { status: string; id: string; url: string }[] = []
      const assignedInBatch = new Map<string, number>()

      for (const item of prepared) {
        const known = bySha.get(item.sha256)
        if (known) {
          results.push({ status: 'duplicate', id: known, url: urlFor(known, env) })
          continue
        }

        const firstIndex = assignedInBatch.get(item.sha256)
        if (firstIndex !== undefined) {
          results.push({ ...results[firstIndex], status: 'duplicate' })
          continue
        }

        while (next <= MAX_ID && base.paths.has(skinPath(idOf(next)))) {
          next += 1
        }
        if (next > MAX_ID) {
          return fail(500, 'ID 空间已用尽')
        }

        const id = idOf(next)
        next += 1
        assignedInBatch.set(item.sha256, results.length)
        assignments.push({ id, item })
        results.push({ status: 'created', id, url: urlFor(id, env) })
      }

      if (dryRun) {
        return json({ dryRun: true, results })
      }

      if (assignments.length === 0) {
        // 全是重复，什么都不用写
        return json({ dryRun: false, commitSha: base.commitSha, results })
      }

      const uploadedAt = now().toISOString()
      const nextMeta: Meta = {
        version: base.meta.version ?? 1,
        nextId: next,
        skins: [
          ...base.meta.skins,
          ...assignments.map(
            ({ id, item }) =>
              ({
                id,
                sha256: item.sha256,
                name: item.name,
                size: item.bytes.length,
                uploadedAt,
              }) satisfies MetaEntry,
          ),
        ],
      }

      const commitSha = await writeBatch(env, fetchImpl, base, assignments, nextMeta, message)
      if (commitSha === null) {
        continue // 分支被并发推进，重读现状后再来一次
      }

      return json({ dryRun: false, commitSha, results })
    }

    return fail(422, '有并发提交，请重试')
  } catch (cause) {
    const status = (cause as { status?: number }).status
    if (status === 401 || status === 403) {
      return fail(502, 'GitHub 鉴权失败，请检查 GITHUB_TOKEN')
    }
    return fail(502, `GitHub 操作失败：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

// ---------------------------------------------------------------- EdgeOne 入口

interface EdgeContext {
  request: Request
  env: Env
}

export function onRequestPost(context: EdgeContext): Promise<Response> {
  return handleUpload(context.request, context.env)
}

export function onRequest(context: EdgeContext): Promise<Response> {
  return handleUpload(context.request, context.env)
}
