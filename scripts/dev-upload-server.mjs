#!/usr/bin/env node
/**
 * 本地 Node 适配器：用与线上完全同一份 handler 跑上传与删除逻辑。
 *
 * 存在的理由是 EdgeOne 的边缘函数本地调试有启动次数日限额（社区反馈不到 20 次），
 * 频繁重启会把自己锁死。这里用 node:http 包一层，既能无限次调试，又因为
 * 两个 handler 只依赖 Web 标准 API 而与线上行为一致。
 *
 * 用法:
 *   node scripts/dev-upload-server.mjs            # 监听 8787
 *   PORT=9000 node scripts/dev-upload-server.mjs
 *
 * 环境变量从 .env.local 读取（可用 `edgeone makers env pull -f .env.local` 拉取），
 * 进程环境变量优先。
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleUpload } from '../functions/api/upload.ts'
import { handleDeleteSkin } from '../functions/api/skin.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = join(ROOT, '.env.local')
const PORT = Number(process.env.PORT ?? 8787)

const KEYS = [
  'ADMIN_PASSWORD',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'GITHUB_BRANCH',
  'SITE_ORIGIN',
  'MAX_BATCH',
]

function loadEnvFile(path) {
  if (!existsSync(path)) return {}
  const values = {}
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return values
}

const fileEnv = loadEnvFile(ENV_FILE)
const env = {}
for (const key of KEYS) {
  env[key] = process.env[key] ?? fileEnv[key]
}

const missing = KEYS.filter((key) => !env[key] && key !== 'MAX_BATCH')
if (missing.length > 0) {
  console.warn(`⚠ .env.local 缺少: ${missing.join(', ')}`)
  console.warn('  上传相关请求会返回 401 / 500，但校验类错误路径仍可调试。\n')
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  const handler =
    url.pathname === '/api/upload'
      ? handleUpload
      : url.pathname === '/api/skin'
        ? handleDeleteSkin
        : null

  if (!handler) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('只有 POST /api/upload 与 DELETE /api/skin')
    return
  }

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks)

  const headers = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[name] = value
  }

  let response
  try {
    // 带上原始 query，删除端点从 ?id= 里取目标
    const request = new Request(`http://localhost${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    })
    response = await handler(request, env)
  } catch (cause) {
    console.error('[适配器异常]', cause)
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '适配器内部异常，见终端日志' }))
    return
  }

  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(Buffer.from(await response.arrayBuffer()))
})

server.listen(PORT, () => {
  console.log(`本地上传适配器已启动:`)
  console.log(`  POST   http://localhost:${PORT}/api/upload`)
  console.log(`  DELETE http://localhost:${PORT}/api/skin?id=<8位十六进制>`)
  console.log(`仓库: ${env.GITHUB_REPO ?? '(未配置)'}  分支: ${env.GITHUB_BRANCH ?? '(未配置)'}`)
  console.log(`站点源: ${env.SITE_ORIGIN ?? '(未配置)'}`)
})
