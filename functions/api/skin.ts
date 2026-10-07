/**
 * DELETE /api/skin —— 站长专属的皮肤永久删除端点。
 *
 * 一次提交里做两件事：
 *   1. 从 skins.meta.json 移除该条目
 *   2. 把 public/s/<id>.png 从树里摘掉
 *
 * ⚠️ 这是不可逆操作，而且会破坏项目对外承诺的永久直链：
 * 任何已经把该 URL 存进玩家数据的插件都会开始拿到 404。
 * README 里「下架只需移除 meta 条目、PNG 必须保留」说的就是不要走这条路。
 *
 * nextId 有意不回落：ID 只增不减、永不回收复用，否则新皮肤会拿到一个
 * 曾经被别人用过的 URL（旧客户端会因此看到错误的皮肤）。
 */

import {
  META_PATH,
  base64FromBytes,
  createBlob,
  createCommit,
  createTree,
  fail,
  githubConfigured,
  json,
  patchRef,
  readBase,
  requireAdmin,
  skinPath,
  type Env,
  type TreeEntry,
} from './lib/github.ts'

/** 皮肤 ID 固定为八位小写十六进制，与文件名严格一致。 */
const ID_PATTERN = /^[0-9a-f]{8}$/
const MAX_ATTEMPTS = 3

export interface Deps {
  fetch?: typeof fetch
}

export async function handleDeleteSkin(
  request: Request,
  env: Env,
  deps: Deps = {},
): Promise<Response> {
  const fetchImpl = deps.fetch ?? globalThis.fetch

  if (request.method !== 'DELETE') {
    return fail(405, '只接受 DELETE 请求')
  }

  const unauthorized = requireAdmin(request, env)
  if (unauthorized) return unauthorized

  const rawId = new URL(request.url).searchParams.get('id') ?? ''
  // 统一转小写：仓库里只会有小写文件名，避免大小写不一致导致找不到而误报
  const id = rawId.trim().toLowerCase()
  if (!ID_PATTERN.test(id)) {
    return fail(400, 'id 必须是八位小写十六进制')
  }

  if (!githubConfigured(env)) {
    return fail(500, '服务端缺少 GitHub 配置')
  }

  const path = skinPath(id)

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const base = await readBase(env, fetchImpl)

      const existsInTree = base.paths.has(path)
      const entry = base.meta.skins.find((skin) => skin?.id === id)
      if (!existsInTree && !entry) {
        return fail(404, `没有 ID 为 ${id} 的皮肤`)
      }

      const nextMeta = {
        ...base.meta,
        // nextId 保持不动：ID 永不回收，否则新皮肤会复用一个发过的直链
        skins: base.meta.skins.filter((skin) => skin?.id !== id),
      }
      const metaBytes = new TextEncoder().encode(`${JSON.stringify(nextMeta, null, 2)}\n`)

      const entries: TreeEntry[] = [
        // sha 为 null 即表示删除该路径；fake-github 与真实 API 都按这个语义处理
        { path, mode: '100644', type: 'blob', sha: null },
        {
          path: META_PATH,
          mode: '100644',
          type: 'blob',
          sha: await createBlob(env, fetchImpl, base64FromBytes(metaBytes)),
        },
      ]

      const treeSha = await createTree(env, fetchImpl, base.treeSha, entries)
      const commitSha = await createCommit(env, fetchImpl, treeSha, base.commitSha, `删除皮肤 ${id}`)
      const patched = await patchRef(env, fetchImpl, commitSha)
      if (patched === null) {
        continue // 分支被并发推进，重读现状后再来一次
      }

      return json({ deleted: true, id, commitSha: patched })
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

export function onRequestDelete(context: EdgeContext): Promise<Response> {
  return handleDeleteSkin(context.request, context.env)
}

export function onRequest(context: EdgeContext): Promise<Response> {
  return handleDeleteSkin(context.request, context.env)
}
