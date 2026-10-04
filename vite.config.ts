import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // 本地把 /api 转发给 scripts/dev-upload-server.mjs，
    // 这样后台上传页在开发环境也能端到端跑通。生产由 EdgeOne Functions 接管。
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  preview: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
    // 皮肤是 64×64 的小 PNG，Vite 默认会把 <4KB 的资源内联成 base64，
    // 但 /s/*.png 住在 publicDir 里，不参与 Vite 的资源处理，天然不会被内联。
    assetsInlineLimit: 0,
    // 单包约 590 kB（gzip 约 157 kB），绝大部分是 skinview3d + three.js。
    // 画廊是首页、必然要用 3D，拆包省不下首屏流量，所以先不拆。
    // 阈值定在 700 kB：既是"已经考虑过这件事"的记录，也能在体积异常膨胀时重新报警。
    chunkSizeWarningLimit: 700,
  },
})
