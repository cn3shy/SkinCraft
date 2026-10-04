import { SkinViewer } from 'skinview3d'

/**
 * 浏览器同时存活的 WebGL 上下文有硬上限（通常是 16 个），
 * 而画廊要展示成千上万张皮肤，所以必须限制 SkinViewer 实例数量并循环复用。
 *
 * 注意 SkinViewer.dispose() 会彻底销毁实例，不能"用完即弃"式回收，
 * 因此这里让一批常驻实例在池中流转，离屏时只暂停渲染循环而非销毁。
 */
const MAX_VIEWERS = 8

/** 卡片预览的初始渲染尺寸；使用方可以随后按自己的容器尺寸 setSize。 */
const DEFAULT_WIDTH = 180
const DEFAULT_HEIGHT = 270

class RendererPool {
  private readonly idle: SkinViewer[] = []
  private readonly all: SkinViewer[] = []
  private readonly waiters: Array<(viewer: SkinViewer) => void> = []
  private shutDown = false

  /** 借出一个 viewer；池满时排队，等别的卡片归还。 */
  async acquire(): Promise<SkinViewer> {
    if (this.shutDown) {
      throw new Error('RendererPool 已关闭')
    }

    const reused = this.idle.pop()
    if (reused) {
      reused.renderPaused = false
      return reused
    }

    if (this.all.length < MAX_VIEWERS) {
      return this.create()
    }

    return new Promise<SkinViewer>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  /** 归还 viewer。清空纹理与相机姿态，避免下一张卡片看到上一位的残留。 */
  release(viewer: SkinViewer): void {
    if (this.shutDown) return

    viewer.animation = null
    viewer.resetSkin()
    viewer.resetCameraPose()

    const waiter = this.waiters.shift()
    if (waiter) {
      // 直接转交给排队者，省掉一次「暂停再恢复」的往返
      waiter(viewer)
      return
    }

    viewer.renderPaused = true
    this.idle.push(viewer)
  }

  /** 已创建的 WebGL 上下文数量，用于排查「上下文过多」类问题。 */
  get size(): number {
    return this.all.length
  }

  get idleCount(): number {
    return this.idle.length
  }

  /** 页面卸载时释放全部 WebGL 上下文。 */
  disposeAll(): void {
    this.shutDown = true
    this.waiters.length = 0
    this.idle.length = 0
    for (const viewer of this.all) {
      if (!viewer.disposed) viewer.dispose()
    }
    this.all.length = 0
  }

  private create(): SkinViewer {
    const viewer = new SkinViewer({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      model: 'auto-detect',
      // 卡片上不开鼠标控制，否则页面滚动会被画布吃掉
      enableControls: false,
    })
    this.all.push(viewer)
    return viewer
  }
}

export const rendererPool = new RendererPool()
