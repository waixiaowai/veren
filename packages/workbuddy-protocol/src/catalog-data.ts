/**
 * 静态兜底目录：从在线端点快照而来，被上游动态答案替换。
 * Static fallback catalogs: captured from the live endpoints, replaced by the
 * upstream's dynamic answer once it loads.
 *
 * 纪律：本表是**启动占位，不是承诺**——花名册日抖动大（`auto`/`kimi-k3-1`/
 * `minimax-m3` 一周内出现又消失）。促销标签刻意不烙进静态表（时间盒化的
 * 「限时免费」会活得比优惠久）；首刷成功前这些行不带标签。
 * Discipline: a boot-time placeholder, never a promise (the roster churns
 * within days). Promo badges are deliberately not baked in (a time-boxed "free
 * now" would outlive the offer); rows simply ship without them until the first
 * live refresh.
 *
 * 快照来源：卷宗 catalog.ts（CN 2026-09-23 复核、国际 2026-09-11 捕获）。
 * Snapshot provenance: dossier catalog.ts (CN re-verified 2026-09-23, international captured 2026-09-11).
 *
 * @module @veren/workbuddy-protocol/catalog-data
 */

import type { WorkBuddyUpstreamModel } from './catalog-types.ts'

/** CN 端点快照的 CLI 模型（与当日 `cli` 花名册一致，16 条）。 */
/** CLI models observed on the CN endpoint (the day's `cli` roster, 16 rows). */
export const FALLBACK_CN_MODELS: readonly WorkBuddyUpstreamModel[] = [
  { id: 'hy4-preview', name: 'Hy4 preview', contextWindow: 1_000_000, maxTokens: 64_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['high'], defaultEffort: 'high', canDisableThinking: false }, billing: { credits: 'x0.29 credits', free: false } },
  { id: 'hy3', name: 'Hy3', contextWindow: 192_000, maxTokens: 64_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'high', canDisableThinking: false }, billing: { credits: 'x0.00 credits', free: true } },
  { id: 'hy3-x', name: 'Hy3-X', contextWindow: 192_000, maxTokens: 64_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'high', canDisableThinking: false }, billing: { credits: 'x0.05 credits', free: false } },
  { id: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash', contextWindow: 1_000_000, maxTokens: 128_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'high', canDisableThinking: false }, billing: { credits: 'x0.03 credits', free: false } },
  { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1_000_000, maxTokens: 64_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.79 credits', free: false } },
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', contextWindow: 1_000_000, maxTokens: 131_072, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: true }, billing: { credits: 'x0.06 credits', free: false } },
  { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 1_000_000, maxTokens: 64_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.79 credits', free: false } },
  { id: 'glm-5.1', name: 'GLM-5.1', contextWindow: 200_000, maxTokens: 48_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.79 credits', free: false } },
  { id: 'glm-5v-turbo', name: 'GLM-5v-Turbo', contextWindow: 200_000, maxTokens: 64_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.71 credits', free: false } },
  { id: 'minimax-m3', name: 'MiniMax-M3', contextWindow: 512_000, maxTokens: 64_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.25 credits', free: false } },
  { id: 'minimax-m2.7', name: 'MiniMax-M2.7', contextWindow: 200_000, maxTokens: 48_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.19 credits', free: false } },
  { id: 'kimi-k3-1', name: 'Kimi-K3', contextWindow: 1_000_000, maxTokens: 32_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x1.62 credits', free: false } },
  { id: 'kimi-k2.8-preview', name: 'Kimi-K2.8-Preview', contextWindow: 1_000_000, maxTokens: 64_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: true }, billing: { credits: 'x0.77 credits', free: false } },
  { id: 'kimi-k2.7', name: 'Kimi-K2.7-Code', contextWindow: 256_000, maxTokens: 32_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.57 credits', free: false } },
  { id: 'kimi-k2.6', name: 'Kimi-K2.6', contextWindow: 256_000, maxTokens: 32_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.52 credits', free: false } },
  { id: 'deepseek-v4-pro', name: 'Deepseek-V4-Pro', contextWindow: 1_000_000, maxTokens: 128_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'high', canDisableThinking: false }, billing: { credits: 'x0.51 credits', free: false } },
]

/** 国际端点 App 形文档快照的 `cli` 花名册（20 条）。 */
/** The `cli` roster captured from the international App-form document (20 rows). */
export const FALLBACK_GLOBAL_MODELS: readonly WorkBuddyUpstreamModel[] = [
  { id: 'default-model', name: 'Auto', contextWindow: 176_000, maxTokens: 24_000, supportsImages: true, reasoning: { supports: false, onlyReasoning: false, canDisableThinking: true }, billing: { free: false } },
  { id: 'fast-model', name: 'Fast', contextWindow: 200_000, maxTokens: 32_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.34', free: false } },
  { id: 'balanced-model', name: 'Balanced', contextWindow: 256_000, maxTokens: 32_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.59', free: false } },
  { id: 'primary-model', name: 'Primary', contextWindow: 272_000, maxTokens: 72_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'high', canDisableThinking: false }, billing: { credits: 'x3.31', free: false } },
  { id: 'deep-model', name: 'Deep', contextWindow: 176_000, maxTokens: 24_000, supportsImages: true, reasoning: { supports: false, onlyReasoning: false, canDisableThinking: true }, billing: { credits: 'x3.33', free: false } },
  { id: 'hy4-preview-f', name: 'Hy4 preview', contextWindow: 300_000, defaultContextWindow: 300_000, supportedContextWindows: [300_000, 1_000_000], maxTokens: 64_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['high'], defaultEffort: 'high', canDisableThinking: false }, billing: { free: false, rateUnknown: true } },
  { id: 'hy3', name: 'Hy3', contextWindow: 192_000, maxTokens: 64_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['low', 'high'], defaultEffort: 'high', canDisableThinking: false }, billing: { free: false, rateUnknown: true } },
  { id: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash', contextWindow: 300_000, defaultContextWindow: 300_000, supportedContextWindows: [300_000, 1_000_000], maxTokens: 128_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'high', canDisableThinking: false }, billing: { free: false, rateUnknown: true } },
  { id: 'gpt-6-astra', name: 'GPT-6-Astra', contextWindow: 400_000, defaultContextWindow: 400_000, supportedContextWindows: [400_000, 1_000_000], maxTokens: 128_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', canDisableThinking: true }, billing: { credits: 'x6.67', free: false } },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', contextWindow: 1_000_000, maxTokens: 128_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', canDisableThinking: true }, billing: { credits: 'x3.47', free: false } },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', contextWindow: 1_000_000, maxTokens: 128_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', canDisableThinking: true }, billing: { credits: 'x1.39', free: false } },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', contextWindow: 1_000_000, maxTokens: 128_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', canDisableThinking: true }, billing: { credits: 'x0.14', free: false } },
  { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 1_000_000, maxTokens: 128_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x3.31', free: false } },
  { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 272_000, maxTokens: 72_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x1.65', free: false } },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex', contextWindow: 272_000, maxTokens: 72_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x1.25', free: false } },
  { id: 'gemini-3.5-flash', name: 'Gemini-3.5-Flash', contextWindow: 1_000_000, maxTokens: 65_536, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.99', free: false } },
  { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1_000_000, maxTokens: 48_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: true }, billing: { credits: 'x0.79', free: false } },
  { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 1_000_000, maxTokens: 48_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, supportedEfforts: ['high', 'xhigh'], defaultEffort: 'high', canDisableThinking: true }, billing: { credits: 'x0.79', free: false } },
  { id: 'kimi-k3', name: 'Kimi-K3', contextWindow: 1_000_000, maxTokens: 32_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x1.62', free: false } },
  { id: 'kimi-k2.6', name: 'Kimi-K2.6', contextWindow: 256_000, maxTokens: 32_000, supportsImages: true, reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'medium', canDisableThinking: false }, billing: { credits: 'x0.52', free: false } },
]

/** 按区域取兜底表。The fallback table for one region. */
export function fallbackModelsFor(region: 'cn' | 'global'): readonly WorkBuddyUpstreamModel[] {
  return region === 'global' ? FALLBACK_GLOBAL_MODELS : FALLBACK_CN_MODELS
}
