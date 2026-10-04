/** 与 scripts/lib/skin-index.mjs 生成的 public/skins.json 对应。 */
export interface SkinEntry {
  id: string
  path: string
  name: string
  size: number
  uploadedAt: string | null
}

export interface SkinIndex {
  version: number
  generatedAt: string
  count: number
  skins: SkinEntry[]
}

let pending: Promise<SkinIndex> | null = null

/** 读取站点索引，同一个会话内只请求一次。 */
export function loadIndex(): Promise<SkinIndex> {
  pending ??= fetch('/skins.json').then(async (response) => {
    if (!response.ok) {
      throw new Error(`索引加载失败：HTTP ${response.status}`)
    }
    return (await response.json()) as SkinIndex
  })
  return pending
}

/** 由索引里的 path 拼出可直接交给 mod 的绝对直链。 */
export function skinUrl(entry: SkinEntry): string {
  return new URL(entry.path, location.origin).href
}

/** 没有起名字的皮肤退回显示 ID，保证列表里每一项都可辨识。 */
export function displayName(entry: SkinEntry): string {
  return entry.name || `#${entry.id}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}
