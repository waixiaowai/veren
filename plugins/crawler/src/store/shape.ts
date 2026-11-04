/**
 * 数据整形：把平台爬取器生产的原始条目映射为统一实体并完成脱敏。
 * Shaping: maps raw crawler-produced items into the unified records and
 * applies anonymization — the only path from memory data to persisted shape.
 *
 * 采集层只生产内存数据，一切落地形状由本文件定义。
 * The crawler layer only produces in-memory data; every persisted shape
 * is defined here.
 *
 * @module @veren/crawler/store/shape
 */
import type { CommentRecord, ContentRecord } from '../types.ts'
import { creatorHash, maskNickname } from './mask.ts'

/** 平台爬取器生产的原始内容条目（字段宽松，整形容错）/ raw content item as produced by a platform crawler */
export interface RawContentItem {
  id: string
  title?: string | null
  desc?: string | null
  url?: string
  publishTime?: string | null
  likedCount?: number | null
  commentCount?: number | null
  collectedCount?: number | null
  shareCount?: number | null
  imageList?: string[] | string | null
  videoUrl?: string | null
  tagList?: string[] | string | null
  /** 明文创作者标识（落地前必被哈希）/ plain creator identifier (hashed before persistence) */
  creatorId: string
  /** 明文昵称（落地前必被遮蔽）/ plain nickname (masked before persistence) */
  nickname: string
}

/** 平台爬取器生产的原始评论条目 / raw comment item as produced by a platform crawler */
export interface RawCommentItem {
  id: string
  contentId: string
  parentCommentId?: string | null
  content: string
  likeCount?: number | null
  subCommentCount?: number | null
  pictures?: string[] | string | null
  publishTime?: string | null
  /** 明文创作者标识 / plain creator identifier */
  creatorId: string
  /** 明文昵称 / plain nickname */
  nickname: string
}

/** 整形上下文：来源关键词与时间源 / shaping context: source keyword and clock */
export interface ShapeContext {
  sourceKeyword: string | null
  now: () => number
}

/** 列表字段归一：数组转逗号分隔串，字符串原样，缺失给空串 / normalize list fields to a comma-joined string */
function toList(value: string[] | string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return Array.isArray(value) ? value.join(',') : value
}

/**
 * 整形内容实体：映射 + 脱敏 + 上下文补全。
 * Shapes a content record: mapping, masking, and context completion.
 */
export function shapeContent(raw: RawContentItem, ctx: ShapeContext): ContentRecord {
  const ts = ctx.now()
  return {
    id: raw.id,
    title: raw.title ?? null,
    desc: raw.desc ?? null,
    url: raw.url ?? '',
    publishTime: raw.publishTime ?? null,
    likedCount: raw.likedCount ?? null,
    commentCount: raw.commentCount ?? null,
    collectedCount: raw.collectedCount ?? null,
    shareCount: raw.shareCount ?? null,
    imageList: toList(raw.imageList),
    videoUrl: raw.videoUrl ?? null,
    tagList: toList(raw.tagList),
    sourceKeyword: ctx.sourceKeyword,
    creatorHash: creatorHash(raw.creatorId),
    nickname: maskNickname(raw.nickname),
    addTs: ts,
    lastModifyTs: ts,
  }
}

/**
 * 整形评论实体：映射 + 脱敏 + 上下文补全。
 * Shapes a comment record: mapping, masking, and context completion.
 */
export function shapeComment(raw: RawCommentItem, ctx: ShapeContext): CommentRecord {
  const ts = ctx.now()
  return {
    id: raw.id,
    contentId: raw.contentId,
    parentCommentId: raw.parentCommentId ?? null,
    content: raw.content,
    likeCount: raw.likeCount ?? null,
    subCommentCount: raw.subCommentCount ?? null,
    pictures: raw.pictures === null || raw.pictures === undefined ? null : toList(raw.pictures),
    publishTime: raw.publishTime ?? null,
    sourceKeyword: ctx.sourceKeyword,
    creatorHash: creatorHash(raw.creatorId),
    nickname: maskNickname(raw.nickname),
    addTs: ts,
    lastModifyTs: ts,
  }
}
