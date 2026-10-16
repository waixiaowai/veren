/**
 * Startup autostart: run every enabled startup item each time DeepSeek Harness
 * finishes starting.
 *
 * Nothing debounces a start. A restart interrupts the sessions the items drive,
 * so a suppressed run is work the user never gets back; the only gate is an
 * item's own `enabled` flag.
 *
 * The trigger accepts two independent paths, because the launcher's successful
 * start signal is optional and one-shot:
 *
 * 1. `ctx.get('appReady').onReady(...)` when the launcher provides it — the
 *    signal commits after the whole plugin tree mounted and the surface is
 *    serving. A late subscription (an HMR reload) fires immediately, so editing
 *    this plugin never loses the trigger.
 * 2. Plugin activation completion, used when no launcher signal exists at all.
 *
 * Both paths funnel into one latched drive per activated service, and every
 * delivery runs inside `ctx.agents.withoutInitiator`. Those two facts are the
 * entire guard against a double dispatch: the latch makes one trigger per
 * activated service, and the initiator-free scope is what keeps a session this
 * plugin wakes from re-entering the trigger. A reload is a new activated
 * service, so it drives again by design.
 *
 * 启动自启动：每次 DeepSeek Harness 启动完成后执行每一条 enabled 的启动项。
 *
 * 没有防抖。重启会打断启动项正在驱动的会话，被压掉的一次执行就是用户永远拿不回来
 * 的那一次；唯一的门槛是启动项自己的 `enabled`。
 * @module @veren/startup-autostart
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Service } from '@deepseek-ai/cordis';
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
import { StartupInputError, createStartupItem, startupItemView, updateStartupItem } from "./domain.js";
import { STARTUP_DOMAIN_NAME, STARTUP_TABLE_NAME, startupDomain, toRecord } from "./storage.js";
import { StartupRuntime } from "./runtime.js";
export { MAX_MESSAGE_LENGTH, MAX_NAME_LENGTH, STARTUP_ACTIONS, StartupInputError } from "./domain.js";
export { STARTUP_DOMAIN_NAME, STARTUP_TABLE_NAME, startupDomain, startupItemSchema } from "./storage.js";
/**
 * Host service owning the durable startup items, the startup trigger, and the
 * Typert Remote surface the management panel reads.
 *
 * The plugin has no configuration: what a start does is fixed by the items the
 * user registered, and there is no deployment-varying knob left once the
 * debounce is gone.
 */
let StartupAutostartService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _catalog_decorators;
    let _create_decorators;
    let _update_decorators;
    let _delete_decorators;
    let _run_decorators;
    return class StartupAutostartService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _catalog_decorators = [Remote('catalog')];
            _create_decorators = [Remote('create')];
            _update_decorators = [Remote('update')];
            _delete_decorators = [Remote('delete')];
            _run_decorators = [Remote('run')];
            __esDecorate(this, null, _catalog_decorators, { kind: "method", name: "catalog", static: false, private: false, access: { has: obj => "catalog" in obj, get: obj => obj.catalog }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _create_decorators, { kind: "method", name: "create", static: false, private: false, access: { has: obj => "create" in obj, get: obj => obj.create }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _update_decorators, { kind: "method", name: "update", static: false, private: false, access: { has: obj => "update" in obj, get: obj => obj.update }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _delete_decorators, { kind: "method", name: "delete", static: false, private: false, access: { has: obj => "delete" in obj, get: obj => obj.delete }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _run_decorators, { kind: "method", name: "run", static: false, private: false, access: { has: obj => "run" in obj, get: obj => obj.run }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        /**
         * Core services only. `sessionController` is deliberately NOT injected: it
         * exists in the Web application alone, and a hard dependency on it left this
         * plugin permanently pending in the headless, ACP, and SDK profiles. The
         * runtime reads it through `ctx.get` when it is there, and drives Sessions
         * through `ctx.agents` when it is not.
         */
        static inject = ['agents', 'sessions', 'storageDomain'];
        /** Reason the feature is inert, set when the storage domain could not open. */
        storageFailure = __runInitializers(this, _instanceExtraInitializers);
        ready;
        initialized;
        chain = Promise.resolve();
        runtime;
        stopping = false;
        /**
         * @param ctx - Host services owning storage, Sessions, and dispatch.
         */
        constructor(ctx) {
            super(ctx, 'startupAutostart', { namespace: 'startup' });
            this.ready = this.openDomain(ctx);
            this.initialized = ctx.effect(async () => {
                const domain = await this.ready;
                // A storage failure disables the feature; it never fails activation, and
                // therefore never fails the Harness boot that mounted this plugin.
                if (domain === undefined)
                    return async () => undefined;
                this.runtime = new StartupRuntime(ctx, () => this.records(domain), work => this.serialize(work), item => this.commit(domain, item));
                return ctx.effect(() => async () => {
                    this.stopping = true;
                    await this.runtime?.dispose();
                    await this.chain; // The chain contains failures already returned to their callers.
                    await domain.close();
                });
            });
            this.armTrigger(ctx);
        }
        async [Service.init]() {
            // Readiness ordering only: the drive reports its own failures.
            await this.initialized.then(() => undefined, () => undefined);
        }
        /**
         * Read every stored startup item. Never activates a Session and never reads
         * Session history.
         * @returns all items ordered by creation instant, then by id.
         */
        async catalog() {
            const domain = await this.requireDomain();
            return this.records(domain).map(item => startupItemView(item));
        }
        /**
         * Register one startup item.
         * @param request - the item's fields; `name` and `action` are required.
         * @returns the stored item as the panel and tools read it.
         * @throws StartupInputError for a rejected field, or when storage is unavailable.
         */
        async create(request) {
            return this.serialize(async () => {
                const domain = await this.requireDomain();
                const record = createStartupItem(request, Date.now());
                await domain.table(STARTUP_TABLE_NAME).put(record.id, record);
                this.emitChanged();
                return startupItemView(record);
            });
        }
        /**
         * Edit one stored item in place, keeping its identity and run count. An
         * omitted field keeps its stored value.
         * @param request - the item id plus any fields to replace.
         * @returns the stored item as the panel and tools read it.
         * @throws StartupInputError for a rejected field, an unknown id, or unavailable storage.
         */
        async update(request) {
            return this.serialize(async () => {
                const domain = await this.requireDomain();
                const table = domain.table(STARTUP_TABLE_NAME);
                const current = table.get(request.id);
                if (current === undefined) {
                    throw new StartupInputError('item_not_found', `no startup item with id "${request.id}".`);
                }
                const record = updateStartupItem(toRecord(current), request, Date.now());
                await table.put(request.id, record);
                this.emitChanged();
                return startupItemView(record);
            });
        }
        /**
         * Delete one startup item. A deleted item never triggers again; a delivery
         * already queued in a Session inbox is not retracted.
         * @param request - the exact item id.
         * @returns whether a stored item was removed.
         * @throws StartupInputError when storage is unavailable.
         */
        async delete(request) {
            return this.serialize(async () => {
                const domain = await this.requireDomain();
                const deleted = await domain.table(STARTUP_TABLE_NAME).delete(request.id);
                if (deleted)
                    this.emitChanged();
                return { id: request.id, deleted };
            });
        }
        /**
         * Run one item immediately, without waiting for the next start and without
         * consulting the run history.
         *
         * The only gate is `enabled`: a switched-off item is refused so a manual run
         * cannot quietly undo the user's decision, and `force` is the explicit way to
         * run one anyway.
         * @param request - the item id, and whether to run a disabled item anyway.
         * @returns the retained outcome of this attempt.
         * @throws StartupInputError for an unknown id, a disabled item, or unavailable storage.
         */
        async run(request) {
            return this.serialize(async () => {
                const domain = await this.requireDomain();
                const runtime = this.runtime;
                if (runtime === undefined) {
                    throw new StartupInputError('storage_unavailable', 'the startup runtime is not ready yet; retry after startup finishes.');
                }
                const stored = domain.table(STARTUP_TABLE_NAME).get(request.id);
                if (stored === undefined) {
                    throw new StartupInputError('item_not_found', `no startup item with id "${request.id}".`);
                }
                const record = toRecord(stored);
                if (request.force !== true && !record.enabled) {
                    throw new StartupInputError('item_disabled', `item "${record.name}" is disabled; enable it with update, or pass force to run it anyway.`);
                }
                return { id: record.id, outcome: await runtime.runItem(record) };
            });
        }
        /**
         * Open the storage domain, reporting rather than throwing on failure.
         *
         * A missing or broken storage backend must not take the Harness down with it:
         * startup items are a convenience feature, so the plugin degrades to a
         * logged, inert service that answers every management call with a stable
         * error.
         * @param ctx - the context opening the domain.
         * @returns the open domain, or undefined when it could not be opened.
         */
        async openDomain(ctx) {
            try {
                return await ctx.storageDomain.open(startupDomain);
            }
            catch (error) {
                this.storageFailure = error instanceof Error ? error.message : String(error);
                ctx.logger.error(`startup-autostart: storage domain "${STARTUP_DOMAIN_NAME}" could not open, so startup items are disabled: `
                    + this.storageFailure);
                return undefined;
            }
        }
        /** Resolve the open domain, or raise the recorded storage failure. */
        async requireDomain() {
            const domain = await this.ready;
            if (domain !== undefined)
                return domain;
            throw new StartupInputError('storage_unavailable', `startup storage is unavailable${this.storageFailure === undefined ? '' : `: ${this.storageFailure}`}`);
        }
        /** Snapshot every stored item, ordered for stable presentation. */
        records(domain) {
            return [...domain.table(STARTUP_TABLE_NAME).entries()]
                .map(([, item]) => toRecord(item))
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        }
        /** Persist one item's run stamp and outcome, then notify observers. */
        async commit(domain, item) {
            await domain.table(STARTUP_TABLE_NAME).put(item.id, item);
            this.emitChanged();
        }
        /**
         * Wire both trigger paths.
         *
         * A launcher that provides `ctx.appReady` owns the timing: the drive runs once
         * successful startup commits, and a late subscription fires immediately, which
         * is what makes an HMR reload re-arm the trigger. A host without that signal
         * falls back to activation completion, which is the only honest "we finished
         * loading" moment it has.
         * @param ctx - the context whose launcher fact decides the trigger path.
         */
        armTrigger(ctx) {
            ctx.effect(() => {
                const appReady = ctx.get('appReady');
                if (appReady !== undefined)
                    return appReady.onReady(() => { this.requestDrive(); });
                ctx.logger.debug('startup-autostart: no launcher appReady signal; triggering on plugin activation');
                this.requestDrive();
                return () => undefined;
            }, 'startup-autostart.trigger()');
        }
        /**
         * Ask the runtime for its single drive once the service is initialized.
         *
         * Both trigger paths may arrive before the domain is open, in either order;
         * deferring to `initialized` is what lets the runtime exist first, and the
         * runtime's own latch collapses the two requests into one drive.
         */
        requestDrive() {
            if (this.stopping)
                return;
            void this.initialized.then(() => { this.runtime?.requestDrive(); }, () => undefined);
        }
        /**
         * Dispatch one post-commit change notification, containing observer failures:
         * the durable write already landed, so a throwing listener must not reject the
         * management call that caused it.
         */
        emitChanged() {
            try {
                this.ctx.emit('startup-autostart/changed');
            }
            catch (error) {
                this.ctx.logger.warn(`startup-autostart: startup-autostart/changed listener failed: ${String(error)}`);
            }
        }
        /** Run one management or delivery operation at a time, preserving FIFO order. */
        serialize(work) {
            if (this.stopping)
                return Promise.reject(new Error('Startup autostart service is stopping'));
            const pending = this.chain.then(work);
            this.chain = pending.catch(() => undefined); // Preserve FIFO progress after the caller receives the failure.
            return pending;
        }
    };
})();
export { StartupAutostartService };
export default StartupAutostartService;
