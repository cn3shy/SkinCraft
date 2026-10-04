<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    text: string
    label?: string
  }>(),
  { label: '复制直链' },
)

const copied = ref(false)
let timer: number | undefined

async function writeToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  // 非安全上下文（http）下 Clipboard API 不可用，退回 execCommand
  const scratch = document.createElement('textarea')
  scratch.value = text
  scratch.setAttribute('readonly', '')
  scratch.style.position = 'fixed'
  scratch.style.opacity = '0'
  document.body.appendChild(scratch)
  scratch.select()
  document.execCommand('copy')
  scratch.remove()
}

async function copy(): Promise<void> {
  try {
    await writeToClipboard(props.text)
    copied.value = true
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch {
    copied.value = false
  }
}

onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <button type="button" class="copy-button" :class="{ copied }" @click="copy">
    {{ copied ? '已复制' : props.label }}
  </button>
</template>

<style scoped>
.copy-button {
  padding: 0.5rem 0.9rem;
  border: 1px solid #2f3742;
  border-radius: 6px;
  background: #1c2027;
  color: #e7e9ee;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.copy-button:hover {
  background: #232830;
  border-color: #3d4756;
}

.copy-button.copied {
  border-color: #3f7f5a;
  color: #7fd6a0;
}
</style>
