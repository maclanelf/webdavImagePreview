'use client'

import type { CreatorSummary, MediaFile } from '@/types'

/**
 * 会话级博主合并映射。
 *
 * 设计目标：
 * 1. 不直接回写前端本地缓存池或服务端预热池里的旧文件对象。
 * 2. 只在“当前会话”里记住哪些旧博主已经被合并到哪个新博主。
 * 3. 后续无论文件来自本地缓存、服务端随机池、图组缓存还是历史缓存，
 *    只要进入前端展示状态前统一经过这里归一化，就能拿到正确的新博主。
 *
 * 注意：
 * - 这里记录的是“旧博主 ID -> 合并后的目标博主摘要”。
 * - 会话结束后映射自然消失；下次重新进入时，数据库本身已经是最新数据。
 */
type MergeTarget = {
  /** 合并后的目标博主，也就是用户最终保留的那个博主。 */
  creator: CreatorSummary | null
  /** 目标博主是否已经是确定解析结果。 */
  creatorResolved: boolean
}

/**
 * 旧博主 ID 到“最终目标博主”的映射表。
 *
 * 示例：
 * - B 合并到 A，则记录 B.id -> A
 * - 之后如果 A 又合并到 D，则解析 B 时会继续沿链路走到 D
 */
const mergedCreatorMap = new Map<number, MergeTarget>()

function normalizeCreatorId(creatorId: number): number | null {
  const normalizedId = Number(creatorId)
  return Number.isInteger(normalizedId) ? normalizedId : null
}

/**
 * 清空当前前端会话里登记过的博主合并映射。
 *
 * 使用场景：
 * - 显式清缓存，准备开始一轮新的浏览会话
 * - 运行时切换到另一套 WebDAV / 数据源配置
 */
export function clearMergedCreators(): void {
  mergedCreatorMap.clear()
}

/**
 * 沿着会话内的合并映射一直追到最终目标博主。
 *
 * 这里专门支持一次会话内的多次合并：
 * - B -> A
 * - C -> A
 * - A -> D
 * 那么读取 B / C / A 时，最终都会被解析成 D。
 *
 * `visited` 用来防止异常情况下出现环状映射导致死循环。
 */
function resolveMergedTarget(creatorId: number): MergeTarget | null {
  let currentId = creatorId
  const visited = new Set<number>()

  while (!visited.has(currentId)) {
    visited.add(currentId)

    const target = mergedCreatorMap.get(currentId)
    if (!target) {
      return null
    }

    const nextId = target.creator?.id
    if (nextId == null || nextId === currentId) {
      return target
    }

    currentId = nextId
  }

  return mergedCreatorMap.get(currentId) || null
}

/**
 * 记录一次“博主合并”结果到当前会话。
 *
 * 参数语义：
 * - `sourceCreatorIds`: 被合并掉的旧博主 ID 列表，例如 [B.id, C.id]
 * - `creator`: 合并后的目标博主，例如 A。这里不是旧博主，而是最终保留的新博主。
 * - `creatorResolved`: 目标博主的解析状态，通常合并成功后应为 true。
 *
 * 这个函数只登记映射，不负责修改任何缓存池里的已有文件对象。
 */
export function registerMergedCreators(sourceCreatorIds: number[], creator: CreatorSummary | null, creatorResolved: boolean): void {
  const normalizedIds = Array.from(new Set(
    sourceCreatorIds
      .map(normalizeCreatorId)
      .filter((id): id is number => id !== null)
  ))

  if (normalizedIds.length === 0) {
    return
  }

  const nextTarget: MergeTarget = {
    creator,
    creatorResolved: Boolean(creatorResolved),
  }

  normalizedIds.forEach((sourceId) => {
    mergedCreatorMap.set(sourceId, nextTarget)
  })
}

/**
 * 当目标博主在当前会话里又被编辑后，回刷所有最终解析到它的合并映射快照。
 *
 * 这里不仅覆盖“直接指向该目标”的映射，也覆盖链式合并场景：
 * - B -> A
 * - A -> D
 * - 编辑 D
 * 那么 B / A 两条映射都会一起更新为最新的 D 摘要。
 */
export function refreshMergedCreatorTarget(
  creator: CreatorSummary | null,
  creatorResolved: boolean,
): boolean {
  const targetCreatorId = creator?.id != null ? normalizeCreatorId(creator.id) : null
  if (targetCreatorId == null) {
    return false
  }

  const nextTarget: MergeTarget = {
    creator,
    creatorResolved: Boolean(creatorResolved),
  }

  let updated = false

  // 目标博主自己也登记一份“自指向”快照。
  // 这样当前状态里已经是目标 creator.id 的对象，后续再走 resolveMergedCreator /
  // resolveMergedMediaFile 时，也能拿到最新编辑后的摘要，而不只修复旧 sourceId 的对象。
  mergedCreatorMap.set(targetCreatorId, nextTarget)
  updated = true

  mergedCreatorMap.forEach((_target, sourceId) => {
    const resolvedTarget = resolveMergedTarget(sourceId)
    if (resolvedTarget?.creator?.id !== targetCreatorId) {
      return
    }

    mergedCreatorMap.set(sourceId, nextTarget)
    updated = true
  })

  return updated
}

/**
 * 只归一化博主对象本身。
 *
 * 输入可能是：
 * - 数据库刚查出来的 creator
 * - 服务端随机池返回的旧 creator
 * - 前端缓存里保存的旧 creator
 *
 * 如果当前会话里存在“旧 ID -> 新博主”的映射，就返回新的目标博主；
 * 否则原样返回。
 */
export function resolveMergedCreator(
  creator: CreatorSummary | null | undefined,
  creatorResolved?: boolean,
): { creator: CreatorSummary | null; creatorResolved: boolean } {
  if (!creator?.id) {
    return {
      creator: creator || null,
      creatorResolved: Boolean(creatorResolved),
    }
  }

  const target = resolveMergedTarget(creator.id)
  if (!target) {
    return {
      creator,
      creatorResolved: Boolean(creatorResolved),
    }
  }

  return {
    creator: target.creator,
    creatorResolved: target.creatorResolved,
  }
}

/**
 * 归一化整个媒体文件对象里的博主信息。
 *
 * 使用场景：
 * - 随机模式从服务端随机池取到文件后
 * - 图组模式从当前组/下一组缓存拿到文件后
 * - 大视频模式随机取到文件后
 * - 历史回看恢复文件后
 *
 * 这样无论文件是从哪里来的，只要准备进入当前页面状态，
 * 都可以在最后一跳把旧博主显示修正成新的目标博主。
 */
export function resolveMergedMediaFile(file: MediaFile): MediaFile {
  const resolved = resolveMergedCreator(file.creator, file.creatorResolved)

  if (resolved.creator === file.creator && resolved.creatorResolved === Boolean(file.creatorResolved)) {
    return file
  }

  return {
    ...file,
    creator: resolved.creator,
    creatorResolved: resolved.creatorResolved,
  }
}
