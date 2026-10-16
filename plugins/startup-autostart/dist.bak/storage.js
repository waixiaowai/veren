/**
 * Durable startup items, independent of Session logs and of any workspace
 * folder. The domain routes through the profile's default storage backend, so
 * the file lands under `$DSH_HOME/storages` and survives deleting a project
 * directory.
 *
 * 持久化的启动项，与会话日志、工作区文件夹都解耦。域走 profile 的默认存储后端，
 * 文件落在 `$DSH_HOME/storages` 下；删掉项目目录不会带走它。
 * @module @local/startup-autostart/storage
 */
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { withDefined } from "./domain.js";
/** Actions accepted by the stored schema; the record validator owns the rules. */
const actionSchema = z.enum(['new_session', 'resume_session', 'message_session', 'queue_message']);
const modelSchema = z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1).optional(),
}).strict();
const outcomeSchema = z.object({
    status: z.enum(['ok', 'failed']),
    detail: z.string(),
    at: z.string().min(1),
}).strict();
const instantSchema = z.iso.datetime({ precision: 3 }).refine(value => !value.startsWith('0000-'), {
    message: 'Expected a canonical four-digit-year UTC calendar instant',
});
/** Schema of one stored startup item, validated at the durable read boundary. */
export const startupItemSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    action: actionSchema,
    cwd: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    preset: z.string().min(1).optional(),
    model: modelSchema.optional(),
    message: z.string().min(1).optional(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
    lastRunAt: instantSchema.optional(),
    lastOutcome: outcomeSchema.optional(),
    runCount: z.number().int().min(0),
});
/** Copy a stored model selection onto the runtime target without `undefined` members. */
function toModelTarget(model) {
    if (model === undefined)
        return undefined;
    return withDefined({ provider: model.provider, model: model.model }, { reasoningEffort: model.reasoningEffort });
}
/**
 * Narrow one stored row onto the record type the runtime delivers from.
 * Each optional field is copied only when present, so the record never carries
 * an explicit `undefined`.
 * @param item - the decoded stored row.
 * @returns the runtime-facing record.
 */
export function toRecord(item) {
    return withDefined({
        id: item.id,
        name: item.name,
        enabled: item.enabled,
        action: item.action,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        runCount: item.runCount,
    }, {
        cwd: item.cwd,
        workspaceId: item.workspaceId,
        sessionId: item.sessionId,
        preset: item.preset,
        model: toModelTarget(item.model),
        message: item.message,
        lastRunAt: item.lastRunAt,
        lastOutcome: item.lastOutcome,
    });
}
/**
 * Authoritative startup-item storage. Malformed rows reject opening the domain,
 * because a silently dropped startup item is an invisible behavior change.
 *
 * The table key type stays `string`: the item brand lives on
 * {@link StartupItemRecord}, and widening the key here keeps the stored row type
 * exactly the schema's own declaration instead of a second, drifting one.
 */
export const startupDomain = defineDomain({
    name: 'startup',
    version: 1,
    tables: { items: domainTable(startupItemSchema) },
});
/** Storage domain name, shared with the panel's read path. */
export const STARTUP_DOMAIN_NAME = startupDomain.name;
/** Storage table name holding every startup item. */
export const STARTUP_TABLE_NAME = 'items';
