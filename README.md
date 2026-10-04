# SkinCraft

Minecraft 皮肤站：**3D 预览** + **永久 PNG 直链**。

配合 SkinsRestorer 这类皮肤插件使用：

```
/skin set web classic "https://skins.3shy.cn/s/00000001.png"
```

站点只负责给出**裸 PNG URL**。模型类型（`classic` / `slim`）由插件侧自行选择，本站不做标注。

---

## ⚠️ 唯一不可逆的约定

> **`/s/<id>.png` 一旦对外发布即为永久契约：不可改 ID、不可删除、不可用不同内容覆盖。**

第三方插件会把这条 URL 存进玩家数据，任何变更都会静默破坏他人的客户端。

- 要换皮肤内容 → **新建一个 ID**，旧 ID 永久保留
- 要下架 → 从 `skins.meta.json` 移除条目，但 **PNG 文件必须留在 `public/s/`**，直链继续可用
- ID 只增不减，**永不回收复用**，否则新皮肤会覆盖旧 URL

---

## 架构

```
站长浏览器 /#/admin
   │  POST /api/upload（Bearer 密码）
   ▼
EdgeOne Function ──校验密码与 PNG──▶ GitHub Git Data API（blobs → tree → commit → ref）
   │                                        │  一次上传 = 一次提交 = 一次构建
   │                                        ▼
   │                              EdgeOne Pages 自动构建（npm run build）
   ▼                                        │
返回直链 ────────────────────────────────────┘  约 1–3 分钟后生效

访客/玩家 ──▶ https://skins.3shy.cn/            预览站（静态）
             https://skins.3shy.cn/s/00000001.png  PNG 直链（静态、永久）
             https://skins.3shy.cn/skins.json     站点索引
```

预览站与图片**同域同源**，因此不依赖 CORS。皮肤文件存在 git 仓库里，作为 Pages 构建产物直接静态输出——没有数据库、没有对象存储。64×64 PNG 约 2 KB，两万张也才约 60 MB。

### 目录

| 路径 | 作用 |
|---|---|
| `public/s/<8位十六进制>.png` | 皮肤文件，**站点唯一的内容源** |
| `skins.meta.json` | 展示元数据 + `nextId`，由上传接口维护 |
| `public/skins.json` | 构建产物（gitignored），由 `scripts/build-index.mjs` 生成 |
| `functions/api/upload.ts` | 唯一动态端点，自包含单文件 |
| `functions/api/health.ts` | 环境变量自检，只回报布尔值 |
| `scripts/dev-upload-server.mjs` | 本地 Node 适配器，复用同一份 handler |
| `src/` | Vite + Vue 3 + TS 预览站 |

---

## 本地开发

```bash
npm install
npm run dev          # 生成索引 + Vite，http://localhost:5173
npm run check        # 类型检查 + 单元测试
```

本地调试上传（**不要**用 EdgeOne 的边缘调试，它有启动次数日限额）：

```bash
cp .env.example .env.local   # 填入 ADMIN_PASSWORD / GITHUB_TOKEN 等
node scripts/dev-upload-server.mjs   # 监听 8787
```

Vite 已把 `/api` 代理到 `localhost:8787`，所以 `http://localhost:5173/#/admin` 在本地就能端到端跑通上传。

### 手动新增皮肤

直接丢文件即可，构建脚本会以实际文件为准自动收录：

```bash
cp mine.png public/s/00000002.png
npm run build
```

若该 ID 大于等于 `skins.meta.json` 的 `nextId`，构建会告警提示提升 `nextId`，否则后台上传分配新 ID 时会撞号。

---

## 部署（EdgeOne Pages）

1. 推送仓库到 GitHub（生产分支 `main`）
2. EdgeOne Pages 新建项目，连该仓库；构建命令 `npm run build`，输出目录 `dist`
3. 绑定自定义域名（免费版默认域名只有 3 小时有效期，且大陆访问需 ICP 备案）
4. 在控制台配置环境变量：

| 变量 | 说明 |
|---|---|
| `ADMIN_PASSWORD` | 40+ 位随机字符串，管理员上传密码 |
| `GITHUB_TOKEN` | fine-grained PAT，**仅本仓库**、权限只勾 `Contents: Read and write` |
| `GITHUB_REPO` | `owner/repo` |
| `GITHUB_BRANCH` | `main` |
| `SITE_ORIGIN` | `https://skins.3shy.cn`，用于拼绝对直链 |
| `MAX_BATCH` | 单批上限，默认 30 |

5. 访问 `/api/health` 确认环境变量都已就位

### 省构建额度

免费版构建额度是 **500 次/月**，一次上传会话 = 一次提交 = 一次构建。因此：

- 上传接口把一批皮肤**合并成一次提交**，绝不逐文件提交
- 日常开发在 `dev` 分支进行，不触发生产构建

---

## 验收

直链必须满足（这是整个项目的最终验收标准）：

```bash
DOMAIN=https://skins.3shy.cn
SKIN=$DOMAIN/s/00000001.png

curl -sI "$SKIN"
#   期望：200 / content-type: image/png / server: edgeone makers / EO-Cache-Status: Cache Hit

# 防盗链必须关闭，否则插件拉不到图
curl -s -o /dev/null -w "%{http_code}\n" -H "Referer: https://evil.example/" "$SKIN"
curl -s -o /dev/null -w "%{http_code}\n" "$SKIN"     # 无 Referer 也必须 200

# 内容是 64×64 PNG
curl -s "$SKIN" | xxd -l 8              # → 8950 4e47 0d0a 1a0a
curl -s "$SKIN" | xxd -s 16 -l 8 -p     # → 00000040 00000040
```

游戏内：

```
/skin set web classic "https://skins.3shy.cn/s/00000001.png"
```

---

## 设计边界（明确不做）

数据库、对象存储、账号系统、注册、审核流程、纹理签名 / MineSkin、CustomSkinLoader JSON 协议、CDN 二次加速、构建时缩略图预渲染、搜索/标签/浏览量统计、多模型类型标注。

### 已知取舍

- **画廊的 3D 预览有上限**：浏览器同时存活的 WebGL 上下文通常只有 16 个，实例池限 8 个，因此首屏多数卡片显示的是皮肤头像占位图而非 3D 模型。若要每张都是 3D，可改成「渲染完截成图片即归还实例」的快照式池。
- **卡片用 `content-visibility` 而非虚拟滚动**：目标相同（跳过离屏卡片的渲染与布局），实现简单得多。若卡片数达到数万且出现性能问题，再考虑真正的虚拟滚动。
