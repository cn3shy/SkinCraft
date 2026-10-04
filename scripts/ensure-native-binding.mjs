#!/usr/bin/env node
/**
 * 构建前置检查：确认 Vite 依赖的原生二进制就位。
 *
 * Vite 8 走 Rolldown，它把平台相关的二进制作为 optionalDependencies 分发
 * （@rolldown/binding-linux-x64-gnu 之类）。部分构建环境的 npm 不会安装它们
 * （npm/cli#4828），于是 `vite build` 会以
 * 「Cannot find native binding」失败——而且失败信息里没有平台和 npm 版本，
 * 在无法直连构建机的情况下极难定位。
 *
 * 这个脚本做两件事：
 *   1. 打印 node / npm / 平台信息与绑定状态，让构建日志自带诊断
 *   2. 绑定缺失时按当前平台补装（直接装，不走 optional 解析），让构建自愈
 *
 * 一切正常时只做几次文件系统检查，开销可忽略。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BINDING_ROOT = join(ROOT, 'node_modules', '@rolldown')
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// Node 20 起，不带 shell 直接 spawn .cmd/.bat 会被拒绝（spawnSync EINVAL），
// 所以 Windows 上必须走 shell。传进去的参数都是仓库内常量，不含 shell 元字符。
const SPAWN_OPTIONS = { cwd: ROOT, shell: process.platform === 'win32' }

function npmVersion() {
  try {
    return execFileSync(NPM, ['--version'], { ...SPAWN_OPTIONS, encoding: 'utf8' }).trim()
  } catch {
    return '(取不到)'
  }
}

/** 找一个已装好、且确实带原生二进制的平台包。 */
function installedBinding() {
  if (!existsSync(BINDING_ROOT)) return null
  for (const name of readdirSync(BINDING_ROOT)) {
    if (!name.startsWith('binding-')) continue
    const dir = join(BINDING_ROOT, name)
    try {
      if (readdirSync(dir).some((file) => file.endsWith('.node'))) return name
    } catch {
      // 目录读不了就跳过
    }
  }
  return null
}

/** 按当前平台与架构，从 rolldown 声明的可选依赖里挑出候选项。 */
function candidatesFor(optionalDependencies) {
  return Object.entries(optionalDependencies ?? {})
    .filter(([name]) => name.includes(process.platform) && name.includes(process.arch))
    .sort(([a], [b]) => {
      // glibc 优先于 musl：绝大多数构建镜像是 glibc
      const score = (name) => (name.includes('gnu') ? 0 : name.includes('musl') ? 1 : 0)
      return score(a) - score(b)
    })
    .map(([name, version]) => `${name}@${version}`)
}

console.log(
  `[preflight] node ${process.version} / npm ${npmVersion()} / ${process.platform}-${process.arch}`,
)

const already = installedBinding()
if (already) {
  console.log(`[preflight] rolldown 原生绑定已就位：${already}`)
  process.exit(0)
}

const rolldownManifest = join(ROOT, 'node_modules', 'rolldown', 'package.json')
if (!existsSync(rolldownManifest)) {
  console.error('[preflight] 找不到 node_modules/rolldown，依赖似乎没装成功')
  process.exit(1)
}

const { version, optionalDependencies } = JSON.parse(readFileSync(rolldownManifest, 'utf8'))
const candidates = candidatesFor(optionalDependencies)

console.error(`[preflight] ✗ rolldown@${version} 的原生绑定缺失`)
console.error(`[preflight] 声明了 ${Object.keys(optionalDependencies ?? {}).length} 个平台包，`)
console.error(`[preflight] 当前平台候选项：${candidates.join(', ') || '(无)'}`)

if (candidates.length === 0) {
  console.error('[preflight] 当前平台没有对应的 rolldown 绑定包，无法修复')
  process.exit(1)
}

for (const spec of candidates) {
  console.error(`[preflight] 尝试补装 ${spec}`)
  try {
    execFileSync(NPM, ['install', '--no-save', '--no-audit', '--no-fund', spec], {
      ...SPAWN_OPTIONS,
      stdio: 'inherit',
    })
  } catch (error) {
    console.error(`[preflight] 安装失败：${error instanceof Error ? error.message : error}`)
    continue
  }

  const fixed = installedBinding()
  if (fixed) {
    console.error(`[preflight] ✓ 已补装 ${fixed}，继续构建`)
    process.exit(0)
  }
}

console.error('[preflight] 所有候选项都试过了，仍然缺原生绑定')
process.exit(1)
