<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import CopyButton from '../components/CopyButton.vue'

const PASSWORD_KEY = 'skincraft-admin-password'
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

type DraftStatus = 'ready' | 'invalid' | 'planned' | 'duplicate' | 'created' | 'failed'

interface Draft {
  key: number
  fileName: string
  name: string
  size: number
  sha256: string
  contentBase64: string
  status: DraftStatus
  /** 服务端给出的拒绝原因，或本地初筛的原因 */
  reason?: string
  id?: string
  url?: string
  selected: boolean
}

const password = ref('')
const drafts = ref<Draft[]>([])
const busy = ref(false)
const message = ref('')
const messageKind = ref<'info' | 'error'>('info')
const dragging = ref(false)

let nextKey = 1

const pending = computed(() =>
  drafts.value.filter((d) => d.selected && d.status !== 'invalid' && d.status !== 'duplicate'),
)
const changed = computed(() =>
  drafts.value.filter((d) => d.status === 'created' || d.status === 'duplicate'),
)

function say(text: string, kind: 'info' | 'error' = 'info'): void {
  message.value = text
  messageKind.value = kind
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

async function addFiles(files: FileList | File[]): Promise<void> {
  const incoming = [...files].filter((file) => file.name.toLowerCase().endsWith('.png'))
  if (incoming.length === 0) return

  for (const file of incoming) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    // 本地只做魔数初筛，拿到即时反馈；尺寸等权威校验交给服务端
    const magicOk = PNG_MAGIC.every((byte, index) => bytes[index] === byte)
    drafts.value.push({
      key: nextKey++,
      fileName: file.name,
      name: file.name.replace(/\.png$/i, ''),
      size: bytes.length,
      sha256: await sha256Hex(bytes),
      contentBase64: toBase64(bytes),
      status: magicOk ? 'ready' : 'invalid',
      reason: magicOk ? undefined : '不是 PNG 文件（魔数不匹配）',
      selected: magicOk,
    })
  }
  say(`已加入 ${incoming.length} 个文件，先点「预检」确认后再上传。`)
}

function reset(): void {
  drafts.value = []
  say('')
}

async function callUpload(dryRun: boolean): Promise<void> {
  const items = pending.value
  if (items.length === 0) {
    say('没有待上传的皮肤。', 'error')
    return
  }

  busy.value = true
  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${password.value}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        dryRun,
        items: items.map((draft) => ({
          name: draft.name,
          contentBase64: draft.contentBase64,
          sha256: draft.sha256,
          size: draft.size,
        })),
      }),
    })

    sessionStorage.setItem(PASSWORD_KEY, password.value)

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string
      results?: { status: string; id?: string; url?: string; reason?: string }[]
      commitSha?: string
    }

    if (Array.isArray(payload.results) && payload.results.length === items.length) {
      payload.results.forEach((result, index) => {
        const draft = items[index]
        draft.id = result.id
        draft.url = result.url
        if (result.status === 'invalid') {
          draft.status = 'invalid'
          draft.reason = result.reason
          draft.selected = false
        } else if (result.status === 'duplicate') {
          draft.status = 'duplicate'
        } else if (dryRun) {
          draft.status = 'planned'
        } else {
          draft.status = 'created'
        }
      })
    }

    if (!response.ok) {
      say(payload.error ?? `请求失败：HTTP ${response.status}`, 'error')
      return
    }

    say(
      dryRun
        ? '预检完成。确认无误后点「上传」，会合并成一次提交。'
        : `已提交${payload.commitSha ? `（${payload.commitSha.slice(0, 7)}）` : ''}，站点大约 1–3 分钟后生效。`,
    )
  } catch (cause) {
    say(`请求出错：${cause instanceof Error ? cause.message : String(cause)}`, 'error')
  } finally {
    busy.value = false
  }
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  if (event.dataTransfer?.files) void addFiles(event.dataTransfer.files)
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.files) void addFiles(input.files)
  input.value = ''
}

onMounted(() => {
  password.value = sessionStorage.getItem(PASSWORD_KEY) ?? ''
})
</script>

<template>
  <section class="admin">
    <h1>上传后台</h1>
    <p class="lead">
      只有站长能上传。站点对外只读浏览，没有账号系统。
    </p>

    <label class="field">
      <span>管理密码</span>
      <input v-model="password" type="password" autocomplete="current-password" placeholder="仅存在本标签页" />
    </label>

    <div
      class="dropzone"
      :class="{ dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p>把 PNG 拖到这里</p>
      <label class="pick">
        选择文件
        <input type="file" accept="image/png" multiple @change="onPick" />
      </label>
    </div>

    <p v-if="message" class="message" :class="messageKind">{{ message }}</p>

    <div v-if="drafts.length > 0" class="actions">
      <button type="button" :disabled="busy" @click="callUpload(true)">预检</button>
      <button type="button" class="primary" :disabled="busy" @click="callUpload(false)">
        上传 {{ pending.length }} 张
      </button>
      <button type="button" :disabled="busy" @click="reset">清空</button>
    </div>

    <table v-if="drafts.length > 0" class="drafts">
      <thead>
        <tr>
          <th />
          <th>名称</th>
          <th>体积</th>
          <th>状态</th>
          <th>直链</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="draft in drafts" :key="draft.key" :class="draft.status">
          <td>
            <input
              v-model="draft.selected"
              type="checkbox"
              :disabled="draft.status === 'invalid' || draft.status === 'duplicate'"
            />
          </td>
          <td>
            <input v-model="draft.name" class="name-input" type="text" maxlength="64" />
            <span class="sha">{{ draft.sha256.slice(0, 12) }}…</span>
          </td>
          <td>{{ (draft.size / 1024).toFixed(1) }} KB</td>
          <td>
            <span class="status">{{ draft.status }}</span>
            <span v-if="draft.reason" class="reason">{{ draft.reason }}</span>
            <span v-else-if="draft.id" class="id">#{{ draft.id }}</span>
          </td>
          <td>
            <CopyButton v-if="draft.url" :text="draft.url" label="复制" />
            <span v-else class="muted">—</span>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="changed.length > 0" class="hint">
      上传后需要等 EdgeOne 重新构建，直链才会可访问。
    </p>
  </section>
</template>

<style scoped>
.admin {
  max-width: 860px;
}

h1 {
  margin: 0 0 0.35rem;
  font-size: 1.375rem;
}

.lead {
  margin: 0 0 1.5rem;
  color: var(--muted);
  font-size: 0.875rem;
}

.field {
  display: block;
  margin-bottom: 1rem;
}

.field span {
  display: block;
  margin-bottom: 0.3rem;
  color: var(--muted);
  font-size: 0.8125rem;
}

.field input {
  width: 100%;
  max-width: 380px;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
}

.dropzone {
  padding: 2rem;
  border: 1px dashed #39424f;
  border-radius: 10px;
  background: var(--panel);
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
}

.dropzone.dragging {
  border-color: var(--accent);
  background: #1d232c;
}

.dropzone p {
  margin: 0 0 0.75rem;
  color: var(--muted);
}

.pick {
  display: inline-block;
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
}

.pick input {
  display: none;
}

.message {
  margin: 1rem 0 0;
  font-size: 0.875rem;
}

.message.error {
  color: #e08a8a;
}

.message.info {
  color: var(--muted);
}

.actions {
  display: flex;
  gap: 0.6rem;
  margin: 1rem 0;
}

.actions button {
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.actions button.primary {
  border-color: #3b6ea5;
  background: #23405e;
}

.actions button:disabled {
  opacity: 0.5;
  cursor: default;
}

.drafts {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.drafts th {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-weight: 500;
  text-align: left;
}

.drafts td {
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid #1f242b;
  vertical-align: middle;
}

.drafts tr.invalid {
  color: #c98b8b;
}

.name-input {
  width: 100%;
  padding: 0.25rem 0.4rem;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.name-input:hover,
.name-input:focus {
  border-color: var(--border);
  background: var(--panel);
  outline: none;
}

.sha,
.reason,
.muted {
  display: block;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.6875rem;
}

.reason {
  font-family: inherit;
  color: #c98b8b;
}

.id {
  display: block;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.6875rem;
}

.hint {
  margin-top: 1rem;
  color: var(--muted);
  font-size: 0.8125rem;
}
</style>
