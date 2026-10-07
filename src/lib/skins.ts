/** 与 scripts/lib/skin-index.mjs 生成的 public/skins.json 对应。 */
export interface SkinEntry {
  id: string
  path: string
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

/**
 * 站点对外只认 ID。
 *
 * 展示名一律是 ID：既然后台的上传命名就是 ID，历史数据里那些从文件名来的名字
 * 也一并按 ID 显示，避免同一批皮肤出现两套叫法。`skins.meta.json` 里的 `name`
 * 字段仍然保留，只是不再参与展示。
 */
export function displayName(entry: SkinEntry): string {
  return entry.id
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}
