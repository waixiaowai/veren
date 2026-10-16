/**
 * The startup trigger's delivery engine. One drive per live runtime instance,
 * every delivery inside `ctx.agents.withoutInitiator`, so a session this plugin
 * creates or wakes can never re-enter the same trigger and start a loop.
 *
 * Sessions are reached through the core `ctx.agents` registry, which every
 * profile mounts. The Web application's richer `sessionController` is used when
 * it is present, because only it resolves agent presets and workspace targets;
 * the headless, ACP, and SDK profiles have no such controller and go through
 * `agents.create` / `agents.resume` exactly as the headless runner does.
 *
 * 启动触发的投递引擎。每个运行实例只驱动一次，所有投递都在
 * `ctx.agents.withoutInitiator` 内执行，因此本插件拉起/唤醒的会话无法重新触发
 * 同一套逻辑，不会形成无限套娃。会话统一走核心 `ctx.agents` 注册表——所有
 * profile 都有它；Web 应用更丰富的 `sessionController` 只在存在时使用，因为只有
 * 它能解析 agent preset 与工作区目标。
 * @module @veren/startup-autostart/runtime
 */
import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { brandString } from '@deepseek-ai/dsh-brand';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { startupMessageText, withDefined } from "./domain.js";
/** Longest retained failure account, in characters. */
const MAX_DETAIL_LENGTH = 300;
/** Render a thrown value as a bounded one-line account. */
function errorText(error) {
    const text = error instanceof Error ? error.message : String(error);
    const oneLine = text.replaceAll(/\s+/g, ' ').trim();
    return oneLine.length <= MAX_DETAIL_LENGTH ? oneLine : `${oneLine.slice(0, MAX_DETAIL_LENGTH - 1)}…`;
}
/**
 * Owns the one permitted drive and every delivery it performs.
 *
 * The runtime is replaced together with the storage domain it commits into, so
 * "once per process" means once per activated service: an HMR reload arms a
 * fresh drive, and the durable per-item cooldown is what stops a second run
 * from repeating itself inside the cooldown window.
 */
export class StartupRuntime {
    ctx;
    items;
    transact;
    commit;
    latched = false;
    requested = false;
    running;
    stopping = false;
    /**
     * @param ctx - Host services used to create, resume, and enqueue.
     * @param items - current durable items, read fresh at each drive.
     * @param transact - serialize a drive against management writes.
     * @param commit - persist one item's run stamp and outcome.
     */
    constructor(ctx, items, transact, commit) {
        this.ctx = ctx;
        this.items = items;
        this.transact = transact;
        this.commit = commit;
    }
    /**
     * Accept the first trigger of this runtime and ignore every later one.
     * Dispatch failures are logged; the trigger never rejects into its caller.
     */
    requestDrive() {
        if (this.stopping || this.latched)
            return;
        this.latched = true;
        this.requested = true;
        this.start();
    }
    /** Stop accepting triggers and drain a running drive before storage closes. */
    async dispose() {
        this.stopping = true;
        // requestDrive reports execution failures itself; teardown only waits.
        await this.running?.catch(() => undefined);
    }
    /**
     * Run exactly one item now, outside any caller's initiator scope.
     *
     * The manual path deliberately ignores the latch: the caller asked for this
     * item, and the cooldown decision belongs to the management operation that
     * checked it. The delivered message is still attributed to no initiator, so a
     * Session woken this way cannot re-enter the trigger.
     * @param item - the item to deliver.
     * @returns the retained outcome of this attempt; failures are recorded, not thrown.
     */
    async runItem(item) {
        return this.ctx.agents.withoutInitiator(async () => this.attempt(item));
    }
    /** Start the drive inside the initiator-free scope, reporting any failure. */
    start() {
        let run;
        try {
            run = this.ctx.agents.withoutInitiator(async () => {
                while (this.requested && !this.stopping) {
                    this.requested = false;
                    await this.transact(async () => { await this.drive(); });
                }
            });
        }
        catch (error) {
            // Ancestor unloading closes initiator admission before runtime cleanup.
            this.requested = false;
            this.ctx.logger.warn(`startup-autostart: the startup trigger did not run: ${errorText(error)}`);
            return;
        }
        this.running = run;
        void run.catch((error) => {
            this.ctx.logger.warn(`startup-autostart: the startup trigger stopped: ${errorText(error)}`);
        }).finally(() => { this.running = undefined; });
    }
    /**
     * Run every enabled item, stamping each attempt.
     *
     * Nothing here consults the run history: a start is the one event the user
     * asked to act on, and a restart interrupted whatever the previous start set
     * going. A failing item is recorded and logged; it never stops the rest.
     * @returns one report per attempted item.
     */
    async drive() {
        const reports = [];
        const all = this.items();
        const enabled = all.filter(item => item.enabled);
        if (enabled.length === 0) {
            this.ctx.logger.debug(`startup-autostart: ${all.length} item(s) stored, none enabled`);
            return reports;
        }
        for (const item of enabled) {
            if (this.stopping)
                break;
            reports.push({ id: item.id, name: item.name, outcome: await this.attempt(item) });
        }
        this.ctx.logger.info(`startup-autostart: ran ${reports.length} startup item(s); `
            + `${reports.filter(report => report.outcome.status === 'failed').length} failed`);
        return reports;
    }
    /**
     * Deliver one item and stamp the attempt, whatever the result.
     *
     * The stamp records history for the panel and the model; it gates nothing.
     * A failure is contained here so one broken item never stops the others.
     * @param item - the item to deliver.
     * @returns the retained outcome; a failure is recorded rather than thrown.
     */
    async attempt(item) {
        const startedAt = new Date().toISOString();
        let outcome;
        try {
            outcome = { status: 'ok', detail: await this.deliver(item, startedAt), at: new Date().toISOString() };
        }
        catch (error) {
            outcome = { status: 'failed', detail: errorText(error), at: new Date().toISOString() };
            this.ctx.logger.warn(`startup-autostart: item "${item.name}" (${item.id}) failed: ${outcome.detail}`);
        }
        await this.commit({ ...item, lastRunAt: startedAt, lastOutcome: outcome, runCount: item.runCount + 1 });
        return outcome;
    }
    /**
     * Perform one item's action and describe what happened.
     * @param item - the item to deliver.
     * @param startedAt - instant the run started, stamped into the message framing.
     * @returns a bounded one-line account for the retained outcome.
     */
    async deliver(item, startedAt) {
        return item.action === 'new_session'
            ? this.deliverNewSession(item, startedAt)
            : this.deliverExistingSession(item, startedAt);
    }
    /** Create the Session an item owns, then optionally wake it with the message. */
    async deliverNewSession(item, startedAt) {
        const controller = this.ctx.get('sessionController');
        let agent;
        if (controller === undefined) {
            this.refuseProfileOnlyTargets(item);
            agent = await this.createAgent(item);
        }
        else {
            const created = await controller.create({
                ...item.workspaceId === undefined ? {} : { workspaceId: item.workspaceId },
                ...item.cwd === undefined ? {} : { cwd: item.cwd },
                ...item.preset === undefined ? {} : { agentPreset: item.preset },
            });
            agent = await this.requireAgent(created.sessionId, item);
        }
        if (item.message === undefined)
            return `created session ${agent.session.id}`;
        agent.followup(this.messageFor(item, startedAt));
        await this.requireFlush(agent, item);
        return `created session ${agent.session.id} and delivered the message`;
    }
    /** Resume the item's Session and act on it according to the item's action. */
    async deliverExistingSession(item, startedAt) {
        const agent = await this.requireAgent(item.sessionId, item);
        if (item.action === 'resume_session')
            return `resumed session ${agent.session.id}`;
        if (item.action === 'queue_message') {
            // inject only fills the inbox: the Session stays idle until something else wakes it.
            agent.inject(this.messageFor(item, startedAt));
            await this.requireFlush(agent, item);
            return `left a message in the inbox of session ${agent.session.id} without waking it`;
        }
        agent.followup(this.messageFor(item, startedAt));
        await this.requireFlush(agent, item);
        return `woke session ${agent.session.id} with the message`;
    }
    /**
     * Resolve one Session to its live Agent, through the Web controller when the
     * profile has one and through the core registry otherwise.
     * @param sessionId - the Session to drive.
     * @param item - the item whose model target applies to the resolved Agent.
     * @returns the live Agent.
     */
    async requireAgent(sessionId, item) {
        const controller = this.ctx.get('sessionController');
        if (controller !== undefined) {
            const found = await controller.resolveAgent(sessionId);
            if ('error' in found)
                throw found.error;
            await this.applyControllerModel(controller, found.agent, item);
            return found.agent;
        }
        const live = this.ctx.agents.get(sessionId);
        if (live !== undefined)
            return live;
        const handle = await this.ctx.agents.resume({ resumeSessionId: sessionId, ...this.agentPlan(item) });
        return handle.agent;
    }
    /**
     * Refuse the targets only the Web session controller can resolve.
     *
     * A profile without that controller composes no preset roster and no
     * workspace registry, so silently creating a plain Session would answer a
     * request the item never made.
     * @param item - the item whose targets are checked.
     * @throws Error naming the unresolvable target.
     */
    refuseProfileOnlyTargets(item) {
        if (item.workspaceId === undefined && item.preset === undefined)
            return;
        const target = item.workspaceId === undefined ? 'an agent preset' : 'a workspace';
        throw new Error(`item "${item.name}" targets ${target}, which this profile cannot resolve: `
            + 'only the Web application mounts the session controller');
    }
    /** Create one new Session through the core registry, under a freshly minted id. */
    async createAgent(item) {
        const handle = await this.ctx.agents.create({
            sessionId: brandString(`session-${randomUUID()}`),
            ...item.cwd === undefined ? {} : { meta: { cwd: item.cwd } },
            ...this.agentPlan(item),
        });
        return handle.agent;
    }
    /**
     * Build the per-Agent options a core-registry create or resume needs.
     *
     * The item's model wins; otherwise the deployment default applies. A profile
     * with neither passes no options at all and lets the Agent fall back to its
     * own configured behaviour.
     * @param item - the item whose model target applies.
     * @returns the options, empty when nothing names a model.
     */
    agentPlan(item) {
        const fallback = this.ctx.get('agentDefaultModel')?.currentSelection();
        // The item's effort is model-supplied text and the core selection brands it;
        // a provider rejects an effort it does not know at request time.
        const selected = item.model === undefined
            ? fallback
            : withDefined({ provider: item.model.provider, model: item.model.model }, { reasoningEffort: item.model.reasoningEffort });
        if (selected === undefined)
            return {};
        const reference = { current: selected, assembled: undefined };
        return {
            agentOptions: { provider: selected.provider, model: selected.model },
            setup: (agentCtx) => { installModelSelection(agentCtx, reference); },
        };
    }
    /**
     * Install the item's model selection on a live Agent through the Web controller.
     * @param controller - the profile's session controller.
     * @param agent - the live Agent the selection applies to.
     * @param item - the item naming the model, when it names one.
     */
    async applyControllerModel(controller, agent, item) {
        if (item.model === undefined)
            return;
        await controller.selectModel({
            sessionId: agent.session.id,
            provider: item.model.provider,
            model: item.model.model,
            ...item.model.reasoningEffort === undefined ? {} : { reasoningEffort: item.model.reasoningEffort },
        });
    }
    /** Build the framed user message one item delivers. */
    messageFor(item, startedAt) {
        return createUserMessage({
            content: [{ type: 'text', text: startupMessageText(item, startedAt, item.message ?? '') }],
            source: { kind: 'startup-autostart' },
        });
    }
    /**
     * Wait for the Session log to acknowledge the enqueued message.
     *
     * The message is already in the Agent's inbox; a refusing persistence layer
     * means the delivery is not durable, which the item's retained outcome must
     * report rather than silently claim success.
     * @param agent - the Agent whose Session must acknowledge the message.
     * @param item - the item whose delivery is being confirmed.
     */
    async requireFlush(agent, item) {
        const flushed = await this.ctx.sessions.flush(agent.session);
        if (!flushed)
            throw new Error(`session persistence did not acknowledge the message of item "${item.name}"`);
    }
}
