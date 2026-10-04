import { createHash } from 'node:crypto'
import { parsePngHeader } from './png.mjs'

/** Minecraft 皮肤的合法贴图尺寸。64×32 是 1.8 之前的旧版布局。 */
const VALID_DIMENSIONS = new Set(['64x64', '64x32'])

/**
 * 由「磁盘上实际存在的 PNG」与「skins.meta.json 的展示元数据」合成站点索引。
 *
 * 设计要点：物理字段（体积、有效期）永远以实际文件为准，meta 只提供展示字段
 * （name / uploadedAt）。这样即使有人直接往 public/s/ 丢 PNG，站点也能正常收录，
 * 不会出现索引与文件不一致。
 *
 * @param {{ entries: {id: string, buffer: Buffer}[], meta: object, generatedAt: string }} input
 * @returns {{ index: object, warnings: string[] }}
 */
export function buildIndex({ entries, meta, generatedAt }) {
  const warnings = []
  const nextId = meta?.nextId ?? 1
  const metaById = new Map((meta?.skins ?? []).map((skin) => [skin.id, skin]))
  const skins = []
  const seenIds = new Set()

  for (const { id, buffer } of entries) {
    seenIds.add(id)
    const record = metaById.get(id)

    let header
    try {
      header = parsePngHeader(buffer)
    } catch (error) {
      warnings.push(`${id}.png 不是有效的 PNG，已跳过：${error.message}`)
      continue
    }

    if (!VALID_DIMENSIONS.has(`${header.width}x${header.height}`)) {
      warnings.push(
        `${id}.png 的尺寸是 ${header.width}×${header.height}，皮肤只应是 64×64 或 64×32`,
      )
    }

    const actualSha256 = createHash('sha256').update(buffer).digest('hex')
    if (record?.sha256 && record.sha256 !== actualSha256) {
      warnings.push(
        `${id}.png 的 sha256 与 skins.meta.json 记录不一致，索引以实际文件为准`,
      )
    }

    if (!record) {
      warnings.push(
        `${id}.png 在 skins.meta.json 里没有条目，已按未知信息收录（用后台上传可自动补齐元数据）`,
      )
    }

    if (Number.parseInt(id, 16) >= nextId) {
      warnings.push(
        `${id}.png 的 ID 不小于 skins.meta.json 里的 nextId(${nextId})，后台上传分配新 ID 时会撞号，请提升 nextId`,
      )
    }

    skins.push({
      id,
      path: `/s/${id}.png`,
      name: record?.name ?? '',
      size: buffer.length,
      uploadedAt: record?.uploadedAt ?? null,
    })
  }

  for (const record of meta?.skins ?? []) {
    if (!seenIds.has(record.id)) {
      warnings.push(
        `skins.meta.json 里的 ${record.id} 没有对应文件 public/s/${record.id}.png`,
      )
    }
  }

  skins.sort((a, b) => {
    if (a.uploadedAt === b.uploadedAt) return a.id.localeCompare(b.id)
    if (a.uploadedAt === null) return 1
    if (b.uploadedAt === null) return -1
    return b.uploadedAt.localeCompare(a.uploadedAt)
  })

  return {
    index: { version: 1, generatedAt, count: skins.length, skins },
    warnings,
  }
}
