<script setup lang="ts">
import { onMounted, ref } from 'vue'
import SkinCard from '../components/SkinCard.vue'
import { loadIndex, type SkinIndex } from '../lib/skins'

const index = ref<SkinIndex | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    index.value = await loadIndex()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
})
</script>

<template>
  <section>
    <p v-if="error" class="state error">{{ error }}</p>
    <p v-else-if="!index" class="state">正在加载皮肤列表…</p>
    <p v-else-if="index.count === 0" class="state">还没有皮肤。</p>
    <template v-else>
      <p class="count">共 {{ index.count }} 张皮肤</p>
      <div class="grid">
        <SkinCard v-for="entry in index.skins" :key="entry.id" :entry="entry" />
      </div>
    </template>
  </section>
</template>

<style scoped>
.count {
  margin: 0 0 1rem;
  color: var(--muted);
  font-size: 0.875rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 1rem;
}
</style>
