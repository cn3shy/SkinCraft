/**
 * GitHub Git Data API 的共享封装，供 /api/upload 与 /api/skin 两个端点复用。
 *
 * 单文件自包含是 EdgeOne Functions 的一条经验法则（打包器对内部模块的处理未经证实），
 * 但把同一套 GitHub 逻辑抄两遍的代价更明确：两处都要各自维护常量时间比较、422 重试、
 * base_tree 合并这些容易写错的细节。因此这里选共享单文件，两端点各自保持薄壳。
 *
 * 只使用 Web 标准 API，这样浏览器之外（本地 Node 适配器）也能原样跑。
 */

export interface Env {
  ADMIN_PASSWORD?: string
  GITHUB_TOKEN?: string
  GITHUB_REPO?: string
  GITHUB_BRANCH?: string
  SITE_ORIGIN?: string
  MAX_BATCH?: string
}

export interface MetaEntry {
  id: string
  sha256: string
  name: string
  size: number
  uploadedAt: string
}

export interface Meta {
  version: number
  nextId: number
  skins: MetaEntry[]
}

export interface Base {
  commitSha: string
  treeSha: string
  /** 仓库现有路径 -> blob sha */
  paths: Map<string, string>
  meta: Meta
}

export const META_PATH = 'skins.meta.json'
export const SKIN_DIR = 'public/s'
export const MAX_ID = 0xffffffff

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export function fail(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status)
}

export function bytesFromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 常量时间比较：长度与内容都走完全程，不做短路，避免用响应时间猜密码。 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }
  return diff === 0
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

export function idOf(numeric: number): string {
  return numeric.toString(16).padStart(8, '0')
}

export function skinPath(id: string): string {
  return `${SKIN_DIR}/${id}.png`
}

export function urlFor(id: string, env: Env): string {
  return `${env.SITE_ORIGIN ?? ''}/s/${id}.png`
}

/**
 * 鉴权。未配置密码时必须拒绝，绝不能退化成「无鉴权可写仓库」。
 * 返回 null 表示通过，否则返回该直接回给客户端的响应。
 */
export function requireAdmin(request: Request, env: Env): Response | null {
  const expected = env.ADMIN_PASSWORD
  if (!expected) {
    return fail(401, '服务端未配置管理密码')
  }
  const provided = bearerToken(request)
  if (!provided || !constantTimeEqual(provided, expected)) {
    return fail(401, '密码不正确')
  }
  return null
}

/** 服务端所需的 GitHub 配置是否齐备。 */
export function githubConfigured(env: Env): boolean {
  return Boolean(env.GITHUB_REPO && env.GITHUB_BRANCH && env.GITHUB_TOKEN)
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await run(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export function githubError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

export async function gh(
  env: Env,
  fetchImpl: typeof fetch,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetchImpl(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN ?? ''}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'SkinCraft',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}

export async function ghJson<T>(
  env: Env,
  fetchImpl: typeof fetch,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await gh(env, fetchImpl, path, init)
  if (!response.ok) {
    throw githubError(response.status, `GitHub API ${path} 返回 ${response.status}`)
  }
  return (await response.json()) as T
}

/** 读分支头、它的 tree（含全部路径），以及 skins.meta.json 的内容。 */
export async function readBase(env: Env, fetchImpl: typeof fetch): Promise<Base> {
  const ref = await ghJson<{ object: { sha: string } }>(
    env,
    fetchImpl,
    `/git/ref/heads/${env.GITHUB_BRANCH}`,
  )
  const commitSha = ref.object.sha

  const commit = await ghJson<{ tree: { sha: string } }>(
    env,
    fetchImpl,
    `/git/commits/${commitSha}`,
  )
  const treeSha = commit.tree.sha

  const tree = await ghJson<{ tree: { path: string; sha: string }[] }>(
    env,
    fetchImpl,
    `/git/trees/${treeSha}?recursive=1`,
  )
  const paths = new Map(tree.tree.map((entry) => [entry.path, entry.sha]))

  let meta: Meta = { version: 1, nextId: 1, skins: [] }
  const metaSha = paths.get(META_PATH)
  if (metaSha) {
    const blob = await ghJson<{ content: string }>(env, fetchImpl, `/git/blobs/${metaSha}`)
    const parsed = JSON.parse(new TextDecoder().decode(bytesFromBase64(blob.content))) as Meta
    meta = { version: parsed.version ?? 1, nextId: parsed.nextId ?? 1, skins: parsed.skins ?? [] }
  }

  return { commitSha, treeSha, paths, meta }
}

/** 提前放回一个已算好的 blob，省掉一次重复上传。 */
export async function createBlob(
  env: Env,
  fetchImpl: typeof fetch,
  content: string,
): Promise<string> {
  const created = await ghJson<{ sha: string }>(env, fetchImpl, '/git/blobs', {
    method: 'POST',
    body: JSON.stringify({ content, encoding: 'base64' }),
  })
  return created.sha
}

export interface TreeEntry {
  path: string
  mode: '100644'
  type: 'blob'
  /** null 表示删除该路径 */
  sha: string | null
}

/** 基于 baseTree 建一棵新 tree。 */
export async function createTree(
  env: Env,
  fetchImpl: typeof fetch,
  baseTreeSha: string,
  entries: TreeEntry[],
): Promise<string> {
  const newTree = await ghJson<{ sha: string }>(env, fetchImpl, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  })
  return newTree.sha
}

export async function createCommit(
  env: Env,
  fetchImpl: typeof fetch,
  treeSha: string,
  parentSha: string,
  message: string,
): Promise<string> {
  const newCommit = await ghJson<{ sha: string }>(env, fetchImpl, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  })
  return newCommit.sha
}

/**
 * 推进分支。返回 null 表示分支被并发推进（非快进），调用方应重读现状后整体重试。
 *
 * force 必须为 false：并发推进时宁可失败重试，也不能覆盖别人的提交。
 */
export async function patchRef(
  env: Env,
  fetchImpl: typeof fetch,
  commitSha: string,
): Promise<string | null> {
  const patch = await gh(env, fetchImpl, `/git/refs/heads/${env.GITHUB_BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commitSha, force: false }),
  })

  if (patch.status === 422) return null
  if (!patch.ok) {
    throw githubError(patch.status, `推进分支失败：HTTP ${patch.status}`)
  }
  return commitSha
}
