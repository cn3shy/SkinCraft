import { createHash } from 'node:crypto'

/**
 * 一个有状态的 GitHub Git Data API 假实现，用来在不联网的前提下
 * 验证上传函数发出的请求序列与产生的提交内容。
 */
export function createFakeGitHub({ files = new Map() } = {}) {
  const state = {
    /** 仓库工作树：path -> 内容 */
    files,
    /** 已创建但尚未进树的 blob：sha -> 内容 */
    blobs: new Map(),
    /** 已创建但尚未被分支引用的 tree：sha -> 条目列表 */
    trees: new Map(),
    /** 已创建但尚未落地的 commit：sha -> 所属 tree 的 sha */
    pendingCommits: new Map(),
    /** 分支头的提交号。只有 PATCH ref 成功才会前进，孤儿提交不改变它 */
    commitCounter: 0,
    /** 记录所有收到的请求，形如 "POST /repos/o/r/git/blobs" */
    calls: [],
    /** 每个落地的提交，含 message 与 sha */
    commits: [],
    /** 成功推进分支的次数 */
    refUpdates: 0,
    /** 设为正整数后，接下来这么多次 PATCH ref 会返回 422 并模拟分支被并发推进 */
    conflictsToSimulate: 0,
  }

  const sha1 = (buf) => createHash('sha1').update(buf).digest('hex')

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  /** 按 sha 找内容：先找待入树的 blob，再找已在树里的文件 */
  function contentBySha(sha) {
    if (state.blobs.has(sha)) return state.blobs.get(sha)
    for (const content of state.files.values()) {
      if (sha1(content) === sha) return content
    }
    return null
  }

  async function fetchImpl(url, init = {}) {
    const method = (init.method ?? 'GET').toUpperCase()
    const { pathname, searchParams } = new URL(url)
    state.calls.push(`${method} ${pathname}`)

    const route = pathname.replace(/^\/repos\/[^/]+\/[^/]+\//, '')

    if (method === 'GET' && route.startsWith('git/ref/heads/')) {
      return json({ object: { sha: `commit-${state.commitCounter}` } })
    }

    if (method === 'GET' && route.startsWith('git/commits/')) {
      const sha = route.slice('git/commits/'.length)
      return json({ sha, tree: { sha: `tree-${sha}` } })
    }

    if (method === 'GET' && route.startsWith('git/trees/')) {
      if (searchParams.get('recursive') !== '1') {
        return json({ message: '本假实现只支持 recursive=1' }, 400)
      }
      const tree = [...state.files.entries()].map(([path, content]) => ({
        path,
        mode: '100644',
        type: 'blob',
        sha: sha1(content),
      }))
      return json({ sha: route.slice('git/trees/'.length), tree, truncated: false })
    }

    if (method === 'GET' && route.startsWith('git/blobs/')) {
      const sha = route.slice('git/blobs/'.length)
      const content = contentBySha(sha)
      return content
        ? json({ sha, encoding: 'base64', content: content.toString('base64') })
        : json({ message: 'Not Found' }, 404)
    }

    if (method === 'POST' && route === 'git/blobs') {
      const body = JSON.parse(init.body)
      if (body.encoding !== 'base64') {
        return json({ message: '本假实现只支持 base64 编码的 blob' }, 400)
      }
      const content = Buffer.from(body.content, 'base64')
      const sha = sha1(content)
      state.blobs.set(sha, content)
      return json({ sha })
    }

    if (method === 'POST' && route === 'git/trees') {
      const body = JSON.parse(init.body)
      for (const entry of body.tree) {
        if (entry.sha !== null && !contentBySha(entry.sha)) {
          return json({ message: `未知的 blob sha: ${entry.sha}` }, 422)
        }
      }
      // 只登记，不改工作树——tree 在分支被推进之前不影响仓库内容
      const sha = `tree-${state.trees.size + 1}`
      state.trees.set(sha, body.tree)
      return json({ sha })
    }

    if (method === 'POST' && route === 'git/commits') {
      const body = JSON.parse(init.body)
      if (body.parents?.[0] !== `commit-${state.commitCounter}`) {
        return json({ message: '父提交不是当前分支头' }, 409)
      }
      const sha = `commit-${state.commitCounter + 1}`
      state.pendingCommits.set(sha, body.tree)
      state.commits.push({ message: body.message, sha })
      return json({ sha })
    }

    if (method === 'PATCH' && route.startsWith('git/refs/heads/')) {
      if (state.conflictsToSimulate > 0) {
        state.conflictsToSimulate -= 1
        // 模拟「分支被另一路提交推进」，让本次提交不再是快进
        state.commitCounter += 1
        return json({ message: 'Update is not a fast forward' }, 422)
      }

      const body = JSON.parse(init.body)
      if (body.force !== false) {
        return json({ message: '本假实现拒绝强制推送' }, 422)
      }
      if (body.sha !== `commit-${state.commitCounter + 1}`) {
        return json({ message: 'Update is not a fast forward' }, 422)
      }

      // 分支真正前进，这次提交的 tree 才落到工作树上
      const entries = state.trees.get(state.pendingCommits.get(body.sha)) ?? []
      for (const entry of entries) {
        const content = entry.sha === null ? null : contentBySha(entry.sha)
        if (content) state.files.set(entry.path, content)
      }

      state.commitCounter += 1
      state.refUpdates += 1
      return json({ object: { sha: body.sha } })
    }

    return json({ message: `假实现没有覆盖的端点: ${method} ${route}` }, 501)
  }

  return { fetchImpl, state }
}
