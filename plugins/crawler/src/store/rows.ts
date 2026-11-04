/**
 * dsh 存储域行 schema：统一实体的 zod 形状（与 src/types.ts 记录一一对应）。
 * The dsh storage-domain row schemas: zod shapes of the unified records
 * (one-to-one with the records in src/types.ts).
 *
 * @module @veren/crawler/store/rows
 */
import { z } from 'zod'

/** 内容行 / the content row */
export const contentSchema = z.object({
  id: z.string(),
  title: z.nullable(z.string()),
  desc: z.nullable(z.string()),
  url: z.string(),
  publishTime: z.nullable(z.string()),
  likedCount: z.nullable(z.number()),
  commentCount: z.nullable(z.number()),
  collectedCount: z.nullable(z.number()),
  shareCount: z.nullable(z.number()),
  imageList: z.string(),
  videoUrl: z.nullable(z.string()),
  tagList: z.string(),
  sourceKeyword: z.nullable(z.string()),
  creatorHash: z.string(),
  nickname: z.string(),
  addTs: z.number(),
  lastModifyTs: z.number(),
})

/** 评论行 / the comment row */
export const commentSchema = z.object({
  id: z.string(),
  contentId: z.string(),
  parentCommentId: z.nullable(z.string()),
  content: z.string(),
  likeCount: z.nullable(z.number()),
  subCommentCount: z.nullable(z.number()),
  pictures: z.nullable(z.string()),
  publishTime: z.nullable(z.string()),
  sourceKeyword: z.nullable(z.string()),
  creatorHash: z.string(),
  nickname: z.string(),
  addTs: z.number(),
  lastModifyTs: z.number(),
})
