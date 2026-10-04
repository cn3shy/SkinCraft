<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SkinViewer } from 'skinview3d'
import { rendererPool } from '../lib/renderer-pool'

const props = defineProps<{
  /** 皮肤资源地址，直接交给 skinview3d 加载 */
  skin: string
}>()

const emit = defineEmits<{
  /** 3D 实例就绪且皮肤加载完成，使用方可以隐藏静态占位 */
  ready: []
  /** 3D 实例已归还给池，使用方应重新显示占位 */
  released: []
}>()

const host = ref<HTMLDivElement | null>(null)

let viewer: SkinViewer | null = null
let observer: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null

/** 卡片是否还在视口（含预加载边距）内 */
let wanted = false
let acquiring = false
let loadingSkin = false
let unmounted = false

async function attach(): Promise<void> {
  if (unmounted || viewer || acquiring || !host.value) return

  acquiring = true
  let acquired: SkinViewer
  try {
    acquired = await rendererPool.acquire()
  } catch {
    acquiring = false
    return
  }
  acquiring = false

  // 等待期间组件可能已卸载或已滑出视口，此时必须原地归还，否则就是泄漏
  if (unmounted || !wanted || !host.value) {
    rendererPool.release(acquired)
    return
  }

  viewer = acquired
  const el = host.value
  el.appendChild(acquired.canvas)
  sizeToContainer(acquired, el)

  loadingSkin = true
  let loaded = false
  try {
    await acquired.loadSkin(props.skin, { model: 'auto-detect' })
    loaded = true
  } catch {
    // 404 或断网：下面会直接归还实例，让静态占位图顶上
  } finally {
    loadingSkin = false
  }

  if (unmounted || !wanted || viewer !== acquired || !loaded) {
    detach()
    return
  }

  // 加载期间容器可能刚从 content-visibility 的跳过状态恢复，尺寸会变
  sizeToContainer(acquired, el)
  emit('ready')
}

function detach(): void {
  if (!viewer) return
  if (loadingSkin) {
    // 纹理还在加载中：此刻归还会让池把实例交给别的卡片，
    // 而本次加载完成后会把纹理写到别人身上。交给 attach 的收尾逻辑归还。
    return
  }
  const released = viewer
  viewer = null
  released.canvas.remove()
  rendererPool.release(released)
  emit('released')
}

function sizeToContainer(target: SkinViewer, el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  target.setSize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)))
}

function setWanted(next: boolean): void {
  if (wanted === next) return
  wanted = next
  if (next) void attach()
  else detach()
}

onMounted(() => {
  const el = host.value
  if (!el) return

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) setWanted(entry.isIntersecting)
    },
    // 提前 300px 开始准备，快速滚动时不至于看到成片空白
    { rootMargin: '300px 0px' },
  )
  observer.observe(el)

  resizeObserver = new ResizeObserver(() => {
    if (viewer) sizeToContainer(viewer, el)
  })
  resizeObserver.observe(el)
})

onBeforeUnmount(() => {
  unmounted = true
  observer?.disconnect()
  observer = null
  resizeObserver?.disconnect()
  resizeObserver = null
  detach()
})

watch(
  () => props.skin,
  (next) => {
    if (!viewer) return
    viewer.loadSkin(next, { model: 'auto-detect' }).catch(() => {})
  },
)
</script>

<template>
  <div ref="host" class="skin-canvas" />
</template>

<style scoped>
.skin-canvas {
  position: absolute;
  inset: 0;
}

.skin-canvas :deep(canvas) {
  display: block;
}
</style>
