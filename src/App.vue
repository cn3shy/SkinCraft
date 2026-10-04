<script setup lang="ts">
import { computed } from 'vue'
import { route } from './lib/route-state'
import GalleryView from './views/GalleryView.vue'
import DetailView from './views/DetailView.vue'
import AdminView from './views/AdminView.vue'

const current = computed(() => route.value)
/** 单独取出来是为了让模板里的类型收窄能成立 */
const detailId = computed(() => (route.value.name === 'detail' ? route.value.id : ''))
</script>

<template>
  <header class="topbar">
    <a class="brand" href="#/">SkinCraft</a>
    <nav class="nav">
      <a href="#/">皮肤库</a>
      <a href="#/admin">后台</a>
    </nav>
  </header>

  <main class="page">
    <GalleryView v-if="current.name === 'gallery'" />
    <DetailView v-else-if="current.name === 'detail'" :id="detailId" />
    <AdminView v-else />
  </main>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.brand {
  color: var(--text);
  font-weight: 600;
  text-decoration: none;
  letter-spacing: 0.02em;
}

.nav {
  display: flex;
  gap: 1rem;
  font-size: 0.875rem;
}

.nav a {
  color: var(--muted);
  text-decoration: none;
}

.nav a:hover {
  color: var(--text);
}

.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.5rem;
}
</style>
