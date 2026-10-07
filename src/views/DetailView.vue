<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { IdleAnimation, SkinViewer } from 'skinview3d'
import CopyButton from '../components/CopyButton.vue'
import { displayName, formatSize, loadIndex, skinUrl, type SkinEntry } from '../lib/skins'

const props = defineProps<{ id: string }>()

const stage = ref<HTMLDivElement | null>(null)
const entry = ref<SkinEntry | null>(null)
const error = ref('')
const spinning = ref(true)
const animating = ref(true)

/**
 * 预览用的手臂模型，由 classic ←→ slim 滑动开关控制，默认 classic。
 *
 * 不再用 skinview3d 的 auto-detect（inferModelType）：它的判据是
 * 「slim 专属区域里有没有透明像素」，而现实中大量 classic 皮肤的右臂区是留空的，
 * 会被误判成 slim。这个站点按设计不记录模型类型，所以改成让用户显式选一个 —— 
 * 反正插件侧本来也要显式指定，预览与命令用同一个值才自洽。
 */
type ModelChoice = 'default' | 'slim'
const MODEL_KEY = 'skincraft-model'

/** 记住上次的选择，同一标签页内切换皮肤不必再拨一次。 */
function initialModel(): ModelChoice {
  try {
    return sessionStorage.getItem(MODEL_KEY) === 'slim' ? 'slim' : 'default'
  } catch {
    return 'default'
  }
}

const model = ref<ModelChoice>(initialModel())

function rememberModel(next: ModelChoice): void {
  try {
    sessionStorage.setItem(MODEL_KEY, next)
  } catch {
    // 隐私模式下 sessionStorage 可能不可用，记不住就算了
  }
}

// 详情页单独持有一个带鼠标控制的实例，不占用画廊的实例池。
// 用 shallowRef 而不是普通变量：模板要按「实例是否就绪」切换 UI，
// 而 shallowRef 不会去代理 SkinViewer 内部那棵 WebGL 对象图。
const viewer = shallowRef<SkinViewer | null>(null)
let resizeObserver: ResizeObserver | null = null

const url = computed(() => (entry.value ? skinUrl(entry.value) : ''))
const name = computed(() => (entry.value ? displayName(entry.value) : ''))
const uploadedAt = computed(() => {
  const value = entry.value?.uploadedAt
  if (!value) return '未知'
  return new Date(value).toLocaleString('zh-CN')
})

/** 开关选中的那个模型名，命令、说明文案都由它派生，保证三者永远一致。 */
const modelLabel = computed(() => (model.value === 'slim' ? 'slim' : 'classic'))

/**
 * 可选的玩家名输入。
 *
 * 玩家的 ID 只存在于使用者那一侧，站点拿不到也不该存，所以这里是个纯本地输入：
 * 填了就替换命令里的占位符，方便直接整条复制粘贴；留空就保留 `<玩家ID>` 占位。
 */
const playerName = ref('')

const trimmedPlayerName = computed(() => playerName.value.trim())
const hasPlayerName = computed(() => trimmedPlayerName.value.length > 0)

/** 当前模型 + 当前玩家名对应的现成命令；拨开关或改玩家名都会立刻变。 */
const command = computed(() => {
  if (!url.value) return ''
  const target = hasPlayerName.value ? trimmedPlayerName.value : '<玩家ID>'
  return `/skin set web ${modelLabel.value} "${url.value}" ${target}`
})

function ensureViewer(): void {
  if (viewer.value || !stage.value) return
  const el = stage.value
  const created = new SkinViewer({
    width: Math.max(1, el.clientWidth),
    height: Math.max(1, el.clientHeight),
    model: 'auto-detect',
    enableControls: true,
    zoom: HOME_ZOOM,
  })
  el.appendChild(created.canvas)
  viewer.value = created
}

/**
 * 标准视角的两个组成部分，重置时都要复位。
 *
 * 单靠 viewer.resetCameraPose() 是不够的：它直接改 camera.position，
 * 而 OrbitControls 每帧都会在 draw() 里 update()，把相机从它自己缓存的球坐标
 * 重新算一遍——于是刚改完就被覆盖，按钮看起来"点了没反应"。
 * 正确做法是同时用 controls 自己的 saveState/reset：reset() 会连内部球坐标一起复位。
 */
const HOME_ZOOM = 0.9

/** 把当前姿态记成"标准视角"。必须在相机调整到位之后调用（controls 构造时的快照不完整）。 */
function captureHomePose(): void {
  const current = viewer.value
  if (!current) return
  current.zoom = HOME_ZOOM
  current.resetCameraPose()
  current.controls.saveState()
}

/** 把开关选中的模型显式交给 skinview3d；不再走 auto-detect。 */
function loadSkin(): void {
  if (!viewer.value || !entry.value) return
  void viewer.value.loadSkin(skinUrl(entry.value), { model: model.value })
}

function applyOptions(): void {
  if (!viewer.value) return
  viewer.value.autoRotate = spinning.value
  viewer.value.autoRotateSpeed = 1.2
  viewer.value.animation = animating.value ? new IdleAnimation() : null
}

/** 回到标准视角：位置、朝向、缩放一起复位。 */
function resetPose(): void {
  const current = viewer.value
  if (!current) return
  current.zoom = HOME_ZOOM
  current.controls.reset()
}

async function show(id: string): Promise<void> {
  error.value = ''
  try {
    const index = await loadIndex()
    const found = index.skins.find((skin) => skin.id === id) ?? null
    if (!found) {
      entry.value = null
      error.value = `找不到 ID 为 ${id} 的皮肤`
      return
    }

    entry.value = found
    ensureViewer()
    if (!viewer.value) return

    applyOptions()
    loadSkin()
    // 相机此时才被 setSize / adjustCameraDistance 调整到位，standard 视角要在这之后记
    captureHomePose()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    const el = stage.value
    const current = viewer.value
    if (!current || !el) return
    current.setSize(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight))
  })
  if (stage.value) resizeObserver.observe(stage.value)

  void show(props.id)
})

watch(
  () => props.id,
  (next) => void show(next),
)

// 只重贴纹理，不重建 viewer：这样切换模型不会闪一下空白，也不多占一个 WebGL 上下文
watch(model, () => {
  loadSkin()
  // 换了手臂宽度，相机距离是按旧模型算的；走 controls 接口复位，见 resetPose 的说明
  resetPose()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  const current = viewer.value
  if (current && !current.disposed) current.dispose()
  viewer.value = null
})
</script>

<template>
  <p v-if="error" class="state error">{{ error }}</p>

  <section v-else class="detail">
    <div ref="stage" class="stage" />

    <aside class="panel">
      <a class="back" href="#/">← 返回皮肤库</a>
      <h1>{{ name }}</h1>

      <dl class="facts">
        <div>
          <dt>ID</dt>
          <dd class="mono">{{ props.id }}</dd>
        </div>
        <div>
          <dt>体积</dt>
          <dd>{{ entry ? formatSize(entry.size) : '—' }}</dd>
        </div>
        <div>
          <dt>上传时间</dt>
          <dd>{{ uploadedAt }}</dd>
        </div>
      </dl>

      <div class="url">
        <span class="mono">{{ url }}</span>
      </div>
      <CopyButton :text="url" />

      <div class="model-switch">
        <span class="model-switch-label">手臂模型</span>
        <div class="switch" role="radiogroup" aria-label="手臂模型">
          <input
            id="model-classic"
            v-model="model"
            class="switch-input"
            type="radio"
            name="model"
            value="default"
            @change="rememberModel(model)"
          />
          <input
            id="model-slim"
            v-model="model"
            class="switch-input"
            type="radio"
            name="model"
            value="slim"
            @change="rememberModel(model)"
          />
          <span class="switch-track" aria-hidden="true" />
          <label class="switch-side" for="model-classic">classic</label>
          <label class="switch-side" for="model-slim">slim</label>
        </div>
      </div>

      <label class="player-field">
        <span class="player-label">玩家 ID（可选）</span>
        <input
          v-model="playerName"
          class="player-input"
          type="text"
          maxlength="32"
          placeholder="留空则保留 <玩家ID> 占位"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <div class="command">
        <span class="label">Minecraft 使用</span>
        <div class="command-row">
          <code class="snippet" :class="{ placeholder: !hasPlayerName }">{{ command }}</code>
          <CopyButton :text="command" :label="`复制 ${modelLabel}`" />
        </div>
        <span class="command-hint">
          命令与左侧 3D 预览都跟着上面的开关走：当前是 <code>{{ modelLabel }}</code>。
          <template v-if="hasPlayerName">
            玩家名已按 <code>{{ trimmedPlayerName }}</code> 填好，整条复制即可用。
          </template>
          <template v-else>
            填入玩家 ID 可自动替换 <code>&lt;玩家ID&gt;</code>。
          </template>
        </span>
      </div>

      <div class="toggles">
        <label>
          <input v-model="spinning" type="checkbox" @change="applyOptions" />
          自动旋转
        </label>
        <label>
          <input v-model="animating" type="checkbox" @change="applyOptions" />
          播放动画
        </label>
        <button type="button" @click="resetPose">重置视角</button>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.detail {
  display: grid;
  grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
  gap: 2rem;
  align-items: start;
}

.stage {
  position: relative;
  width: 100%;
  height: 480px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: linear-gradient(180deg, #232a33, #171a20);
  overflow: hidden;
  touch-action: none;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  align-items: flex-start;
}

.back {
  color: var(--muted);
  font-size: 0.875rem;
  text-decoration: none;
}

.back:hover {
  color: var(--text);
}

h1 {
  margin: 0;
  font-size: 1.375rem;
  word-break: break-all;
}

.facts {
  display: flex;
  gap: 1.75rem;
  margin: 0;
}

.facts dt {
  color: var(--muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.facts dd {
  margin: 0.15rem 0 0;
  font-size: 0.9375rem;
}

.url {
  max-width: 100%;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  overflow-wrap: anywhere;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
  color: var(--muted);
}

.command {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-width: 100%;
}

.command .label {
  color: var(--muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.command-rows {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* 命令行占满剩余宽度，按钮固定宽度靠右，两条命令因此上下对齐 */
.command-row {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.command-row .snippet {
  flex: 1;
  min-width: 0;
}

.command .snippet {
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
  /* 命令只有一行，长 ID 也不换行；溢出时可横向滚动而不是撑破侧栏 */
  overflow-x: auto;
  white-space: pre;
}

.command-row :deep(.copy-button) {
  flex: none;
}

.command-hint {
  color: var(--muted);
  font-size: 0.8125rem;
  line-height: 1.55;
}

.command-hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  color: var(--text);
}

/* 占位符还没被玩家名替换时，让 <玩家ID> 一眼看出是需要改的地方 */
.snippet.placeholder {
  color: var(--muted);
}

.player-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-width: 100%;
}

.player-label {
  color: var(--muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.player-input {
  max-width: 260px;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
}

.player-input:focus {
  border-color: var(--accent);
  outline: none;
}

.toggles {
  display: flex;
  align-items: center;
  gap: 1.1rem;
  font-size: 0.875rem;
}

.toggles label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--muted);
  cursor: pointer;
}

.toggles button {
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

/* 滑动开关：两个单选按钮叠在轨道上，滑块由 :checked 的兄弟选择器驱动 */
.model-switch {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.model-switch-label {
  color: var(--muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.switch {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
}

/* 两个 input 铺满整个开关、叠在一起，接收点击与键盘操作（方向键可在组内切换）。
   它们不可见但可聚焦，键盘焦点环通过 :focus-visible 转到下面的 .switch-track 上。 */
.switch-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.switch-track {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(50% - 2px);
  height: calc(100% - 4px);
  border-radius: 999px;
  background: #2c4a68;
  transition: transform 0.18s ease;
}

#model-slim:checked ~ .switch-track {
  transform: translateX(100%);
}

.switch:has(.switch-input:focus-visible) .switch-track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* 文字在滑块之上，保证任何状态下都可读 */
.switch-side {
  position: relative;
  z-index: 1;
  padding: 0.3rem 0.9rem;
  color: var(--muted);
  font-size: 0.8125rem;
  text-align: center;
  cursor: pointer;
  transition: color 0.18s;
}

#model-classic:checked ~ .switch-side[for='model-classic'],
#model-slim:checked ~ .switch-side[for='model-slim'] {
  color: var(--text);
}

@media (prefers-reduced-motion: reduce) {
  .switch-track,
  .switch-side {
    transition: none;
  }
}

@media (max-width: 720px) {
  .detail {
    grid-template-columns: minmax(0, 1fr);
  }

  .stage {
    height: 380px;
  }

  /* 窄屏下命令与按钮并排会挤扁命令，改为上下堆叠 */
  .command-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
