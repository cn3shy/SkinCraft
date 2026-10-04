import { deflateSync } from 'node:zlib'

/** PNG 文件签名，固定 8 字节。 */
export const PNG_MAGIC = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 读出 IHDR 所需的最小字节数：8 签名 + 4 长度 + 4 类型 + 13 数据。 */
const MIN_IHDR_BYTES = 29

// ---------------------------------------------------------------- 编码

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/**
 * 把 RGBA 像素编码成 8 位真彩（colorType 6）PNG，每行 filter 固定为 0。
 * 仅用于生成测试与样例皮肤，不是通用图像编码器。
 */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`像素数据长度 ${rgba.length} 与 ${width}×${height} 的 RGBA 尺寸不符`)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: truecolour with alpha
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter type: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    )
  }

  return Buffer.concat([
    Buffer.from(PNG_MAGIC),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------- 解码

/**
 * 只解析 PNG 头部，不解压像素数据。
 * 皮肤站只需要宽高与像素格式来做校验，全量解码在边缘运行时太贵。
 */
export function parsePngHeader(buf) {
  if (!buf || buf.length < MIN_IHDR_BYTES) {
    throw new Error(
      `PNG 数据被截断：读出 IHDR 至少需要 ${MIN_IHDR_BYTES} 字节，实际只有 ${buf?.length ?? 0} 字节`,
    )
  }

  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (buf[i] !== PNG_MAGIC[i]) {
      throw new Error('不是有效的 PNG：魔数不匹配')
    }
  }

  const type = buf.toString('latin1', 12, 16)
  if (type !== 'IHDR') {
    throw new Error(`不是有效的 PNG：偏移 12 处期望 IHDR，实际是 "${type}"`)
  }

  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  }
}

/** 廉价地确认文件以 IEND 结尾。不做全量 CRC 校验，那在边缘运行时太贵。 */
export function hasIendChunk(buf) {
  if (!buf || buf.length < 12) return false
  return buf.toString('latin1', buf.length - 8, buf.length - 4) === 'IEND'
}
