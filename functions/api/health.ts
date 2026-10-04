/**
 * GET /api/health —— 环境变量自检。
 *
 * 只回报每个变量「是否已配置」的布尔值，绝不回报任何值本身。
 * 用于验证 EdgeOne 控制台里配的环境变量在函数运行时确实可见。
 */

interface Env {
  ADMIN_PASSWORD?: string
  GITHUB_TOKEN?: string
  GITHUB_REPO?: string
  GITHUB_BRANCH?: string
  SITE_ORIGIN?: string
  MAX_BATCH?: string
}

const CHECKED_KEYS = [
  'ADMIN_PASSWORD',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'GITHUB_BRANCH',
  'SITE_ORIGIN',
] as const

export function onRequestGet(context: { env: Env }): Response {
  const configured: Record<string, boolean> = {}
  const missing: string[] = []

  for (const key of CHECKED_KEYS) {
    const present = Boolean(context.env?.[key])
    configured[key] = present
    if (!present) missing.push(key)
  }

  return new Response(
    JSON.stringify({
      ok: missing.length === 0,
      configured,
      missing,
      maxBatch: context.env?.MAX_BATCH ?? null,
    }),
    {
      status: missing.length === 0 ? 200 : 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )
}

export const onRequest = onRequestGet
