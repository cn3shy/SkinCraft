/**
 * 极简 hash 路由。
 *
 * 用 hash 而非 path 路由，是为了免去 SPA fallback 配置——
 * 托管层（EdgeOne Pages）只需要原样吐出静态文件，少一个待验证的配置项。
 */
export type Route =
  | { name: 'gallery' }
  | { name: 'detail'; id: string }
  | { name: 'admin' }

/** 皮肤 ID 固定为 8 位小写十六进制，因此这里也强制小写，与文件名严格一致。 */
const DETAIL_PATTERN = /^\/s\/([0-9a-f]{8})$/

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/'

  if (path === '/admin') {
    return { name: 'admin' }
  }

  const match = DETAIL_PATTERN.exec(path)
  if (match) {
    return { name: 'detail', id: match[1] }
  }

  return { name: 'gallery' }
}
