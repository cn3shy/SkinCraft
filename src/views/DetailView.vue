<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { IdleAnimation, SkinViewer } from 'skinview3d'
import CopyButton from '../components/CopyButton.vue'
import { displayName, formatSize, loadIndex, skinUrl, type SkinEntry } from '../lib/skins'

const props = defineProps<{ id: string }>()

const stage = ref<HTMLDivElement | null>(null)
const entry = ref<SkinEntry | null>(null)
const error = ref('')
const spinning = ref(true)
const animating = ref(true)

// 详情页单独持有一个带鼠标控制的实例，不占用画廊的实例池
let viewer: SkinViewer | null = null
let resizeObserver: ResizeObserver | null = null

const url = computed(() => (entry.value ? skinUrl(entry.value) : ''))
const name = computed(() => (entry.value ? displayName(entry.value) : ''))
const uploadedAt = computed(() => {
  const value = entry.value?.uploadedAt
  if (!value) return '未知'
  return new Date(value).toLocaleString('zh-CN')
})

function ensureViewer(): void {
  if (viewer || !stage.value) return
  const el = stage.value
  viewer = new SkinViewer({
    width: Math.max(1, el.clientWidth),
    height: Math.max(1, el.clientHeight),
    model: 'auto-detect',
    enableControls: true,
    zoom: 0.9,
  })
  el.appendChild(viewer.canvas)
}

function applyOptions(): void {
  if (!viewer) return
  viewer.autoRotate = spinning.value
  viewer.autoRotateSpeed = 1.2
  viewer.animation = animating.value ? new IdleAnimation() : null
}

function resetPose(): void {
  viewer?.resetCameraPose()
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
    if (!viewer) return

    applyOptions()
    await viewer.loadSkin(skinUrl(found), { model: 'auto-detect' })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    const el = stage.value
    if (!viewer || !el) return
    viewer.setSize(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight))
  })
  if (stage.value) resizeObserver.observe(stage.value)

  void show(props.id)
})

watch(
  () => props.id,
  (next) => void show(next),
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (viewer && !viewer.disposed) viewer.dispose()
  viewer = null
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

      <p class="hint">
        模型类型（classic / slim）由皮肤插件自行选择，本站只提供图片直链。
      </p>
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

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 0.8125rem;
}

@media (max-width: 720px) {
  .detail {
    grid-template-columns: minmax(0, 1fr);
  }

  .stage {
    height: 380px;
  }
}
</style>
