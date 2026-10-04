<script setup lang="ts">
import { computed, ref } from 'vue'
import SkinCanvas from './SkinCanvas.vue'
import { displayName, skinUrl, type SkinEntry } from '../lib/skins'

const props = defineProps<{ entry: SkinEntry }>()

const url = computed(() => skinUrl(props.entry))
const name = computed(() => displayName(props.entry))

/** 3D 实例就绪后隐藏静态占位，归还后再显示回来 */
const ready = ref(false)
</script>

<template>
  <a class="card" :href="`#/s/${props.entry.id}`">
    <div class="preview">
      <div
        v-show="!ready"
        class="fallback"
        :style="{ backgroundImage: `url(${url})` }"
        aria-hidden="true"
      />
      <SkinCanvas :skin="url" @ready="ready = true" @released="ready = false" />
      <span class="badge">#{{ props.entry.id }}</span>
    </div>
    <div class="meta">
      <span class="name">{{ name }}</span>
    </div>
  </a>
</template>

<style scoped>
.card {
  display: block;
  border: 1px solid #262b33;
  border-radius: 10px;
  background: #1a1e24;
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  transition: border-color 0.15s, transform 0.15s;
  /* 卡片数量可能上万，让浏览器跳过离屏卡片的渲染与布局，
     等价于虚拟滚动但不必手写滚动窗口逻辑。 */
  content-visibility: auto;
  contain-intrinsic-size: auto 200px;
}

.card:hover {
  border-color: #3d4756;
  transform: translateY(-2px);
}

.preview {
  position: relative;
  aspect-ratio: 2 / 3;
  background: linear-gradient(180deg, #232a33, #171a20);
}

.fallback {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 72%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  border-radius: 6px;
  background-repeat: no-repeat;
  /* 皮肤贴图中脸的正面对应 64×64 里的 (8,8)-(15,15) 这 8×8 区域。
     本元素是正方形，放大 8 倍后不会拉伸像素；把该区域左上角对齐到容器左上角
     需要向左上各偏移一个容器宽，代入 background-position 百分比公式
     (P × (容器 - 图像) = -容器) 得 P = 1/7。 */
  background-size: 800% 800%;
  background-position: 14.2857% 14.2857%;
  image-rendering: pixelated;
}

.badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(12, 14, 18, 0.72);
  color: #97a1b0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.6875rem;
}

.meta {
  padding: 0.5rem 0.65rem 0.6rem;
}

.name {
  display: block;
  font-size: 0.8125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
