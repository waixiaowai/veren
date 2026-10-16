/* Built by scripts/build-client.mjs — the browser half of the startup-autostart plugin. */
window.__ModuleLoader__.load({
  id: "@veren/startup-autostart",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    "use strict";
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // src/client/index.ts
    var index_exports = {};
    __export(index_exports, {
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);

    // src/client/catalog.ts
    function createStartupCatalog(deps) {
      let snapshot = { records: [], status: "loading", settled: false };
      let disposers = [];
      let epoch = 0;
      let inflight;
      const registry = /* @__PURE__ */ new Set();
      const publish = (next) => {
        snapshot = { ...snapshot, ...next };
        for (const listener of [...registry]) listener();
      };
      const read = () => {
        if (inflight !== void 0) return inflight;
        const mine = epoch;
        publish({ status: "loading" });
        inflight = deps.list().then(
          (result) => {
            if (mine !== epoch) return;
            publish(result.ok ? { records: result.value, status: "ready", settled: true } : { status: "error" });
          },
          () => {
            if (mine === epoch) publish({ status: "error" });
          }
        ).finally(() => {
          if (mine === epoch) inflight = void 0;
        });
        return inflight;
      };
      return {
        source: {
          getSnapshot: () => snapshot,
          subscribe(listener) {
            registry.add(listener);
            if (registry.size === 1) {
              disposers = [deps.subscribeReset(() => {
                void read();
              })];
              if (deps.pollMs > 0) {
                const timer = setInterval(() => {
                  void read();
                }, deps.pollMs);
                disposers.push(() => {
                  clearInterval(timer);
                });
              }
              void read();
            }
            return () => {
              registry.delete(listener);
              if (registry.size !== 0) return;
              for (const dispose of disposers) dispose();
              disposers = [];
              epoch += 1;
              inflight = void 0;
              snapshot = { records: [], status: "loading", settled: false };
            };
          }
        },
        refresh: () => {
          void read();
        }
      };
    }

    // src/client/icon.tsx
    var import_jsx_runtime = require("react/jsx-runtime");
    function StartupPanelIcon({ size }) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "svg",
        {
          viewBox: "0 0 16 16",
          width: size,
          height: size,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.4",
          strokeLinecap: "round",
          "aria-hidden": "true",
          focusable: "false",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 2.4v5.4" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.7 4.7a4.7 4.7 0 1 0 6.6 0" })
          ]
        }
      );
    }

    // src/client/locales.ts
    var NS = "startup.panel";
    var zh = {
      "panel": "\u542F\u52A8\u9879",
      "panel.title": "\u542F\u52A8\u9879",
      "panel.subtitle": "\u6BCF\u6B21 DSH \u6210\u529F\u542F\u52A8\u540E\u81EA\u52A8\u6267\u884C\u7684\u5DE5\u4F5C\u3002\u6CA1\u6709\u9632\u6296\uFF1A\u6BCF\u6B21\u542F\u52A8\u90FD\u4F1A\u6267\u884C\u6BCF\u4E00\u6761\u542F\u7528\u9879\u3002",
      "panel.search": "\u641C\u7D22\u540D\u5B57\u3001\u6D88\u606F\u6216\u4F1A\u8BDD id",
      "panel.filter.all": "\u5168\u90E8",
      "panel.filter.enabled": "\u542F\u7528\u4E2D",
      "panel.filter.disabled": "\u5DF2\u505C\u7528",
      "panel.loading": "\u6B63\u5728\u52A0\u8F7D\u542F\u52A8\u9879\u2026",
      "panel.error": "\u65E0\u6CD5\u52A0\u8F7D\u542F\u52A8\u9879\u3002",
      "panel.retry": "\u91CD\u8BD5",
      "panel.empty": "\u8FD8\u6CA1\u6709\u767B\u8BB0\u4EFB\u4F55\u542F\u52A8\u9879\u3002",
      "panel.emptyFiltered": "\u6CA1\u6709\u7B26\u5408\u5F53\u524D\u7B5B\u9009\u7684\u542F\u52A8\u9879\u3002",
      "panel.new": "\u65B0\u5EFA",
      "panel.newHint": "\u65B0\u5EFA\u4F1A\u6253\u5F00\u4E00\u4E2A\u65B0\u4F1A\u8BDD\uFF0C\u7531\u6A21\u578B\u7528 startup_create \u767B\u8BB0\uFF0C\u9762\u677F\u672C\u8EAB\u4E0D\u63D0\u4F9B\u8868\u5355\u3002",
      "panel.count": "\u5171 {count} \u6761",
      "panel.enabledOn": "\u5DF2\u542F\u7528",
      "panel.enabledOff": "\u5DF2\u505C\u7528",
      "panel.toggle.on": "\u505C\u7528\u300C{name}\u300D",
      "panel.toggle.off": "\u542F\u7528\u300C{name}\u300D",
      "panel.select": "\u6253\u5F00\u300C{name}\u300D",
      "panel.action.new_session": "\u5F00\u65B0\u4F1A\u8BDD",
      "panel.action.resume_session": "\u6062\u590D\u4F1A\u8BDD",
      "panel.action.message_session": "\u53D1\u6D88\u606F\u5E76\u5524\u9192",
      "panel.action.queue_message": "\u53EA\u6295\u9012\u5230\u6536\u4EF6\u7BB1",
      "panel.target.cwd": "\u76EE\u5F55\uFF1A{value}",
      "panel.target.workspace": "\u5DE5\u4F5C\u533A\uFF1A{value}",
      "panel.target.session": "\u4F1A\u8BDD\uFF1A{value}",
      "panel.target.preset": "\u9884\u8BBE\uFF1A{value}",
      "panel.target.message": "\u6D88\u606F\uFF1A{value}",
      "panel.target.none": "\u672A\u8BBE\u7F6E\u76EE\u6807",
      "panel.run.never": "\u8FD8\u6CA1\u6267\u884C\u8FC7",
      "panel.run.count": "\u6267\u884C {count} \u6B21",
      "panel.run.ok": "\u6210\u529F",
      "panel.run.failed": "\u5931\u8D25",
      "panel.detail.title": "\u542F\u52A8\u9879\u8BE6\u60C5",
      "panel.detail.close": "\u5173\u95ED\u8BE6\u60C5",
      "panel.detail.field.id": "id",
      "panel.detail.field.name": "\u540D\u5B57",
      "panel.detail.field.enabled": "\u542F\u7528",
      "panel.detail.field.action": "\u52A8\u4F5C",
      "panel.detail.field.cwd": "\u76EE\u5F55",
      "panel.detail.field.workspace": "\u5DE5\u4F5C\u533A",
      "panel.detail.field.session": "\u4F1A\u8BDD id",
      "panel.detail.field.preset": "\u9884\u8BBE",
      "panel.detail.field.model": "\u6A21\u578B",
      "panel.detail.field.message": "\u6D88\u606F",
      "panel.detail.field.createdAt": "\u521B\u5EFA\u65F6\u95F4",
      "panel.detail.field.updatedAt": "\u66F4\u65B0\u65F6\u95F4",
      "panel.detail.field.lastRunAt": "\u4E0A\u6B21\u6267\u884C",
      "panel.detail.field.lastOutcome": "\u4E0A\u6B21\u7ED3\u679C",
      "panel.detail.field.runCount": "\u6267\u884C\u6B21\u6570",
      "panel.detail.unset": "\uFF08\u672A\u8BBE\u7F6E\uFF09",
      "panel.detail.unsaved": "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539",
      "panel.detail.save": "\u4FDD\u5B58\u4FEE\u6539",
      "panel.detail.saving": "\u6B63\u5728\u4FDD\u5B58\u2026",
      "panel.detail.revert": "\u653E\u5F03\u4FEE\u6539",
      "panel.detail.saved": "\u5DF2\u4FDD\u5B58",
      "panel.detail.run": "\u7ACB\u5373\u8FD0\u884C\u4E00\u6B21",
      "panel.detail.running": "\u6B63\u5728\u8FD0\u884C\u2026",
      "panel.detail.run.ok": "\u6267\u884C\u6210\u529F\uFF1A{detail}",
      "panel.detail.run.failed": "\u6267\u884C\u5931\u8D25\uFF1A{detail}",
      "panel.detail.delete": "\u5220\u9664",
      "panel.detail.deleteConfirm": "\u786E\u5B9A\u5220\u9664\u300C{name}\u300D\uFF1F\u5220\u9664\u540E\u5B83\u4E0D\u4F1A\u518D\u89E6\u53D1\u3002",
      "panel.detail.deleteYes": "\u786E\u8BA4\u5220\u9664",
      "panel.detail.deleteNo": "\u53D6\u6D88",
      "panel.detail.deleted": "\u5DF2\u5220\u9664",
      "panel.detail.failed": "\u64CD\u4F5C\u5931\u8D25\uFF1A{message}"
    };
    var en = {
      "panel": "Startup items",
      "panel.title": "Startup items",
      "panel.subtitle": "Work DeepSeek Harness performs every time it starts. No debounce: every enabled item runs on every start.",
      "panel.search": "Search name, message, or session id",
      "panel.filter.all": "All",
      "panel.filter.enabled": "Enabled",
      "panel.filter.disabled": "Disabled",
      "panel.loading": "Loading startup items\u2026",
      "panel.error": "Could not load startup items.",
      "panel.retry": "Retry",
      "panel.empty": "No startup item is registered yet.",
      "panel.emptyFiltered": "No startup item matches the current filter.",
      "panel.new": "New",
      "panel.newHint": "New opens a session where the model registers the item with startup_create; the panel itself has no form.",
      "panel.count": "{count} items",
      "panel.enabledOn": "Enabled",
      "panel.enabledOff": "Disabled",
      "panel.toggle.on": "Disable \u201C{name}\u201D",
      "panel.toggle.off": "Enable \u201C{name}\u201D",
      "panel.select": "Open \u201C{name}\u201D",
      "panel.action.new_session": "Create a session",
      "panel.action.resume_session": "Resume a session",
      "panel.action.message_session": "Wake a session",
      "panel.action.queue_message": "Queue without waking",
      "panel.target.cwd": "Directory: {value}",
      "panel.target.workspace": "Workspace: {value}",
      "panel.target.session": "Session: {value}",
      "panel.target.preset": "Preset: {value}",
      "panel.target.message": "Message: {value}",
      "panel.target.none": "No target",
      "panel.run.never": "Never ran",
      "panel.run.count": "Ran {count} times",
      "panel.run.ok": "OK",
      "panel.run.failed": "Failed",
      "panel.detail.title": "Startup item detail",
      "panel.detail.close": "Close detail",
      "panel.detail.field.id": "id",
      "panel.detail.field.name": "Name",
      "panel.detail.field.enabled": "Enabled",
      "panel.detail.field.action": "Action",
      "panel.detail.field.cwd": "Directory",
      "panel.detail.field.workspace": "Workspace",
      "panel.detail.field.session": "Session id",
      "panel.detail.field.preset": "Preset",
      "panel.detail.field.model": "Model",
      "panel.detail.field.message": "Message",
      "panel.detail.field.createdAt": "Created",
      "panel.detail.field.updatedAt": "Updated",
      "panel.detail.field.lastRunAt": "Last run",
      "panel.detail.field.lastOutcome": "Last result",
      "panel.detail.field.runCount": "Runs",
      "panel.detail.unset": "(not set)",
      "panel.detail.unsaved": "Unsaved changes",
      "panel.detail.save": "Save changes",
      "panel.detail.saving": "Saving\u2026",
      "panel.detail.revert": "Discard changes",
      "panel.detail.saved": "Saved",
      "panel.detail.run": "Run once now",
      "panel.detail.running": "Running\u2026",
      "panel.detail.run.ok": "Ran successfully: {detail}",
      "panel.detail.run.failed": "Run failed: {detail}",
      "panel.detail.delete": "Delete",
      "panel.detail.deleteConfirm": "Delete \u201C{name}\u201D? It will never trigger again.",
      "panel.detail.deleteYes": "Delete",
      "panel.detail.deleteNo": "Cancel",
      "panel.detail.deleted": "Deleted",
      "panel.detail.failed": "The operation failed: {message}"
    };

    // src/client/panel.tsx
    var import_react2 = require("react");

    // src/client/detail.tsx
    var import_react = require("react");

    // src/client/remote.ts
    var import_zod = require("zod");

    // ../../deepseek/deepseek-harness/packages/typert/protocol/src/remote-info.ts
    function createTypertRemoteInfo(spec, zod) {
      return new RemoteInfo(spec, zod);
    }
    var RemoteInfo = class {
      constructor(spec, zod) {
        this.spec = spec;
        this.zod = zod;
      }
      spec;
      zod;
      index;
      get package() {
        return this.spec.package;
      }
      get descriptors() {
        return this.resolve().descriptors;
      }
      get methods() {
        return this.resolve().methods;
      }
      resolve() {
        if (this.index !== void 0) return this.index;
        const zod = this.zod;
        const descriptors = [];
        const methods = /* @__PURE__ */ Object.create(null);
        for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
          const separator = endpoint.indexOf("/");
          const namespace = endpoint.slice(0, separator);
          const method = endpoint.slice(separator + 1);
          const parameters = definition.parameters.map((parameter2) => ({ ...parameter2, wire: parameter2.wire ?? parameter2.name }));
          const descriptor = {
            ...definition,
            id: `${this.spec.package}#${endpoint}`,
            namespace,
            method,
            parameters,
            result: definition.result.description === void 0 ? definition.result : new ResultValue(definition.result)
          };
          if (definition.invocation.kind === "direct") {
            const inputs = [];
            const direct = Object.assign(descriptor, {
              input(options) {
                const strict = options?.strict === true;
                return inputs[strict ? 1 : 0] ??= new NamedInput(parameters, strict, zod);
              },
              invoke(remote, input, signal) {
                const named = input;
                const values = parameters.map((parameter2) => named[parameter2.wire]);
                if (definition.cancellation !== void 0) values.push(signal);
                const receiver = Reflect.get(remote, namespace);
                const call = Reflect.get(receiver, method);
                return call.apply(receiver, values);
              }
            });
            methods[endpoint] = direct;
          }
          descriptors.push(descriptor);
        }
        return this.index = { descriptors, methods };
      }
    };
    function optional(parameter2) {
      return parameter2.source === "json" && parameter2.acceptsUndefined === true;
    }
    var NamedInput = class {
      constructor(parameters, strict, zod) {
        this.parameters = parameters;
        this.strict = strict;
        this.zod = zod;
      }
      parameters;
      strict;
      zod;
      schema;
      projection;
      codec(parameter2) {
        return this.strict ? parameter2.strictCodec : parameter2.codec;
      }
      create = () => this.schema ??= this.zod.strictObject(Object.fromEntries(this.parameters.map((parameter2) => {
        const value = this.codec(parameter2).create();
        return [parameter2.wire, optional(parameter2) ? value.optional() : value.nonoptional()];
      })));
      get jsonSchema() {
        return this.project().jsonSchema;
      }
      get jsonSchemaError() {
        return this.project().jsonSchemaError;
      }
      project() {
        if (this.projection !== void 0) return this.projection;
        const unavailable = this.parameters.find((parameter2) => this.codec(parameter2).jsonSchema === void 0);
        if (unavailable !== void 0) {
          return this.projection = { jsonSchemaError: this.codec(unavailable).jsonSchemaError ?? `No JSON Schema for parameter ${unavailable.wire}` };
        }
        return this.projection = {
          jsonSchema: {
            type: "object",
            properties: Object.fromEntries(this.parameters.map((parameter2) => [parameter2.wire, {
              ...this.codec(parameter2).jsonSchema,
              ...parameter2.description === void 0 ? {} : { description: parameter2.description }
            }])),
            required: this.parameters.filter((parameter2) => !optional(parameter2)).map((parameter2) => parameter2.wire),
            additionalProperties: false
          }
        };
      }
    };
    var ResultValue = class {
      constructor(spec) {
        this.spec = spec;
      }
      spec;
      projection;
      get mode() {
        return this.spec.mode;
      }
      get typeSymbol() {
        return this.spec.typeSymbol;
      }
      get create() {
        return this.spec.create;
      }
      get decode() {
        return this.spec.decode;
      }
      get encode() {
        return this.spec.encode;
      }
      get description() {
        return this.spec.description;
      }
      get jsonSchemaError() {
        return this.spec.jsonSchemaError;
      }
      get jsonSchema() {
        if (this.projection === void 0) {
          const schema = this.spec.jsonSchema;
          this.projection = { value: schema === void 0 ? void 0 : { ...schema, description: this.spec.description } };
        }
        return this.projection.value;
      }
    };

    // src/client/remote.ts
    var STARTUP_ACTIONS = ["new_session", "resume_session", "message_session", "queue_message"];
    var MODEL_SCHEMA = import_zod.z.looseObject({
      provider: import_zod.z.string(),
      model: import_zod.z.string(),
      reasoningEffort: import_zod.z.string().optional()
    });
    var OUTCOME_SCHEMA = import_zod.z.looseObject({
      status: import_zod.z.union([import_zod.z.literal("ok"), import_zod.z.literal("failed")]),
      detail: import_zod.z.string(),
      at: import_zod.z.string()
    });
    var ITEM_SCHEMA = import_zod.z.looseObject({
      id: import_zod.z.string(),
      name: import_zod.z.string(),
      enabled: import_zod.z.boolean(),
      action: import_zod.z.enum(STARTUP_ACTIONS),
      model: MODEL_SCHEMA.optional(),
      lastOutcome: OUTCOME_SCHEMA.optional()
    });
    var REQUEST_SCHEMA = import_zod.z.looseObject({
      name: import_zod.z.string().optional(),
      enabled: import_zod.z.boolean().optional(),
      action: import_zod.z.enum(STARTUP_ACTIONS).optional(),
      model: MODEL_SCHEMA.optional(),
      message: import_zod.z.string().optional(),
      sessionId: import_zod.z.string().optional(),
      cwd: import_zod.z.string().optional(),
      workspaceId: import_zod.z.string().optional(),
      preset: import_zod.z.string().optional()
    });
    var SERVICE = "startupAutostart";
    function codec(typeSymbol, create) {
      return { mode: "strict", typeSymbol, create };
    }
    function parameter(name, typeSymbol, create) {
      const spec = codec(typeSymbol, create);
      return { name, wire: name, source: "json", codec: spec, strictCodec: spec };
    }
    var startupRemote = createTypertRemoteInfo({
      package: "@veren/startup-autostart",
      methods: {
        "startup/catalog": {
          service: SERVICE,
          description: "Read every stored startup item. Never activates a session and never reads session history.",
          invocation: { kind: "direct" },
          parameters: [],
          result: codec("startup:catalog:result", () => import_zod.z.array(ITEM_SCHEMA))
        },
        "startup/create": {
          service: SERVICE,
          description: "Register one startup item that runs on every successful start, with no debounce.",
          invocation: { kind: "direct" },
          parameters: [parameter("request", "startup:create:request", () => REQUEST_SCHEMA)],
          result: codec("startup:create:result", () => ITEM_SCHEMA)
        },
        "startup/update": {
          service: SERVICE,
          description: "Edit one stored startup item in place; an omitted field keeps its stored value.",
          invocation: { kind: "direct" },
          parameters: [parameter("request", "startup:update:request", () => REQUEST_SCHEMA.extend({ id: import_zod.z.string() }))],
          result: codec("startup:update:result", () => ITEM_SCHEMA)
        },
        "startup/delete": {
          service: SERVICE,
          description: "Delete one startup item so it never triggers again.",
          invocation: { kind: "direct" },
          parameters: [parameter("request", "startup:delete:request", () => import_zod.z.looseObject({ id: import_zod.z.string() }))],
          result: codec("startup:delete:result", () => import_zod.z.looseObject({ id: import_zod.z.string(), deleted: import_zod.z.boolean() }))
        },
        "startup/run": {
          service: SERVICE,
          description: "Run one startup item immediately instead of waiting for the next start.",
          invocation: { kind: "direct" },
          parameters: [parameter("request", "startup:run:request", () => import_zod.z.looseObject({
            id: import_zod.z.string(),
            force: import_zod.z.boolean().optional()
          }))],
          result: codec("startup:run:result", () => import_zod.z.looseObject({ id: import_zod.z.string(), outcome: OUTCOME_SCHEMA.optional() }))
        }
      }
    }, import_zod.z);

    // src/client/detail.tsx
    var import_jsx_runtime2 = require("react/jsx-runtime");
    function draftOf(item) {
      return {
        name: item.name,
        enabled: item.enabled,
        action: item.action,
        message: item.message ?? "",
        sessionId: item.sessionId ?? "",
        cwd: item.cwd ?? "",
        workspaceId: item.workspaceId ?? "",
        preset: item.preset ?? ""
      };
    }
    function changedFields(item, draft) {
      const committed = draftOf(item);
      const when = (key) => draft[key] === committed[key] ? {} : { [key]: draft[key] };
      return {
        id: item.id,
        ...when("name"),
        ...when("enabled"),
        ...when("action"),
        ...when("message"),
        ...when("sessionId"),
        ...when("cwd"),
        ...when("workspaceId"),
        ...when("preset")
      };
    }
    function Field(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "sa-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "sa-field-label", children: props.label }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "sa-field-value", children: props.value })
      ] });
    }
    function StartupDetail({ item, t, onUpdate, onDelete, onRun }) {
      const [draft, setDraft] = (0, import_react.useState)(() => draftOf(item));
      const [note, setNote] = (0, import_react.useState)(void 0);
      const [bad, setBad] = (0, import_react.useState)(false);
      const [busy, setBusy] = (0, import_react.useState)(false);
      const [confirming, setConfirming] = (0, import_react.useState)(false);
      const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(item));
      const edit = (key, value) => {
        setDraft((current) => ({ ...current, [key]: value }));
        setNote(void 0);
      };
      const report = (failure, okText) => {
        setBad(failure !== void 0);
        setNote(failure ?? okText);
      };
      const save = async () => {
        setBusy(true);
        try {
          report(await onUpdate(changedFields(item, draft)), t("panel.detail.saved"));
        } finally {
          setBusy(false);
        }
      };
      const run = async () => {
        setBusy(true);
        try {
          const outcome2 = await onRun(item.id);
          setBad(!outcome2.ok);
          setNote(t(outcome2.ok ? "panel.detail.run.ok" : "panel.detail.run.failed", { detail: outcome2.detail }));
        } finally {
          setBusy(false);
        }
      };
      const remove = async () => {
        setBusy(true);
        try {
          const failure = await onDelete(item.id);
          setBad(failure !== void 0);
          setNote(failure ?? t("panel.detail.deleted"));
          setConfirming(false);
        } finally {
          setBusy(false);
        }
      };
      const outcome = item.lastOutcome;
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "sa-detail", "aria-label": t("panel.detail.title"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "sa-detail-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { className: "sa-detail-title", children: t("panel.detail.title") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "sa-hint", children: item.id })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "sa-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "sa-field-label", htmlFor: "sa-name", children: t("panel.detail.field.name") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              id: "sa-name",
              className: "sa-field-input",
              value: draft.name,
              onChange: (event) => {
                edit("name", event.target.value);
              }
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "sa-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "sa-field-label", htmlFor: "sa-enabled", children: t("panel.detail.field.enabled") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              id: "sa-enabled",
              type: "checkbox",
              checked: draft.enabled,
              onChange: (event) => {
                edit("enabled", event.target.checked);
              }
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "sa-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "sa-field-label", htmlFor: "sa-action", children: t("panel.detail.field.action") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "select",
            {
              id: "sa-action",
              className: "sa-field-select",
              value: draft.action,
              onChange: (event) => {
                edit("action", event.target.value);
              },
              children: STARTUP_ACTIONS.map((action) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: action, children: t(`panel.action.${action}`) }, action))
            }
          )
        ] }),
        draft.action === "new_session" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "sa-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "sa-field-label", htmlFor: "sa-cwd", children: t("panel.detail.field.cwd") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "input",
              {
                id: "sa-cwd",
                className: "sa-field-input",
                value: draft.cwd,
                onChange: (event) => {
                  edit("cwd", event.target.value);
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "sa-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "sa-field-label", htmlFor: "sa-ws", children: t("panel.detail.field.workspace") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "input",
              {
                id: "sa-ws",
                className: "sa-field-input",
                value: draft.workspaceId,
                onChange: (event) => {
                  edit("workspaceId", event.target.value);
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "sa-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "sa-field-label", htmlFor: "sa-preset", children: t("panel.detail.field.preset") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "input",
              {
                id: "sa-preset",
                className: "sa-field-input",
                value: draft.preset,
                onChange: (event) => {
                  edit("preset", event.target.value);
                }
              }
            )
          ] })
        ] }),
        draft.action !== "new_session" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "sa-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "sa-field-label", htmlFor: "sa-session", children: t("panel.detail.field.session") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              id: "sa-session",
              className: "sa-field-input",
              value: draft.sessionId,
              onChange: (event) => {
                edit("sessionId", event.target.value);
              }
            }
          )
        ] }),
        draft.action !== "resume_session" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "sa-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { className: "sa-field-label", htmlFor: "sa-message", children: t("panel.detail.field.message") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "textarea",
            {
              id: "sa-message",
              className: "sa-field-textarea",
              value: draft.message,
              onChange: (event) => {
                edit("message", event.target.value);
              }
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field, { label: t("panel.detail.field.model"), value: item.model === void 0 ? t("panel.detail.unset") : `${item.model.provider} / ${item.model.model}` }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field, { label: t("panel.detail.field.createdAt"), value: item.createdAt }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field, { label: t("panel.detail.field.updatedAt"), value: item.updatedAt }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field, { label: t("panel.detail.field.lastRunAt"), value: item.lastRunAt ?? t("panel.run.never") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field, { label: t("panel.detail.field.lastOutcome"), value: outcome === void 0 ? t("panel.detail.unset") : `${t(outcome.status === "ok" ? "panel.run.ok" : "panel.run.failed")} \xB7 ${outcome.detail}` }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field, { label: t("panel.detail.field.runCount"), value: String(item.runCount) }),
        debugNote(note, bad, t),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "sa-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "sa-btn sa-btn-primary", disabled: busy || !dirty, onClick: () => {
            void save();
          }, children: busy ? t("panel.detail.saving") : t("panel.detail.save") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "sa-btn", disabled: busy || !dirty, onClick: () => {
            setDraft(draftOf(item));
            setNote(void 0);
          }, children: t("panel.detail.revert") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "sa-btn", disabled: busy, onClick: () => {
            void run();
          }, children: busy ? t("panel.detail.running") : t("panel.detail.run") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "sa-btn sa-btn-danger", disabled: busy, onClick: () => {
            setConfirming(true);
          }, children: t("panel.detail.delete") })
        ] }),
        confirming && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "sa-actions", role: "alertdialog", "aria-label": t("panel.detail.deleteConfirm", { name: item.name }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "sa-note", children: t("panel.detail.deleteConfirm", { name: item.name }) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "sa-btn sa-btn-danger", disabled: busy, onClick: () => {
            void remove();
          }, children: t("panel.detail.deleteYes") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "sa-btn", disabled: busy, onClick: () => {
            setConfirming(false);
          }, children: t("panel.detail.deleteNo") })
        ] }),
        dirty && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "sa-note", children: t("panel.detail.unsaved") })
      ] });
    }
    function debugNote(note, bad, t) {
      if (note === void 0) return null;
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: bad ? "sa-note-bad" : "sa-note", children: bad ? t("panel.detail.failed", { message: note }) : note });
    }

    // src/client/panel.tsx
    var import_jsx_runtime3 = require("react/jsx-runtime");
    function targetSummary(item, t) {
      if (item.action === "new_session") {
        if (item.cwd !== void 0) return t("panel.target.cwd", { value: item.cwd });
        if (item.workspaceId !== void 0) return t("panel.target.workspace", { value: item.workspaceId });
        return t("panel.target.none");
      }
      if (item.sessionId === void 0) return t("panel.target.none");
      return t("panel.target.session", { value: item.sessionId });
    }
    function Row(props) {
      const { item, selected, t, onSelect, onToggle } = props;
      const outcome = item.lastOutcome;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("li", { className: "sa-row", "aria-current": selected, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "input",
          {
            className: "sa-switch",
            type: "checkbox",
            checked: item.enabled,
            "aria-label": t(item.enabled ? "panel.toggle.on" : "panel.toggle.off", { name: item.name }),
            onChange: (event) => {
              onToggle(event.target.checked);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { type: "button", className: "sa-row-main", "aria-label": t("panel.select", { name: item.name }), onClick: onSelect, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "sa-row-name", children: item.name }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "sa-row-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "sa-badge", children: t(`panel.action.${item.action}`) }),
            " ",
            targetSummary(item, t)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "sa-row-meta", children: [
            t("panel.run.count", { count: item.runCount }),
            " \xB7 ",
            outcome === void 0 ? t("panel.run.never") : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: outcome.status === "ok" ? "sa-badge sa-badge-ok" : "sa-badge sa-badge-bad", children: t(outcome.status === "ok" ? "panel.run.ok" : "panel.run.failed") }),
            item.lastRunAt === void 0 ? "" : ` \xB7 ${item.lastRunAt}`
          ] })
        ] })
      ] });
    }
    function StartupPanel(props) {
      const { useCatalog, onRetry, onNew, onUpdate, onDelete, onRun, t } = props;
      const catalog = useCatalog((snapshot) => snapshot);
      const [search, setSearch] = (0, import_react2.useState)("");
      const [filter, setFilter] = (0, import_react2.useState)("all");
      const [selectedId, setSelectedId] = (0, import_react2.useState)(void 0);
      const rows = (0, import_react2.useMemo)(() => {
        const query = search.trim().toLowerCase();
        return catalog.records.filter((item) => (filter === "all" || item.enabled === (filter === "enabled")) && (query === "" || item.name.toLowerCase().includes(query) || (item.message ?? "").toLowerCase().includes(query) || (item.sessionId ?? "").toLowerCase().includes(query)));
      }, [catalog.records, search, filter]);
      const selected = rows.find((item) => item.id === selectedId) ?? rows[0];
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "sa-page", "aria-label": t("panel.title"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "sa-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { className: "sa-title", children: t("panel.title") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "sa-subtitle", children: t("panel.subtitle") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "sa-toolbar", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "input",
            {
              className: "sa-input",
              type: "search",
              value: search,
              placeholder: t("panel.search"),
              "aria-label": t("panel.search"),
              onChange: (event) => {
                setSearch(event.target.value);
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "sa-seg", role: "group", "aria-label": t("panel.filter.all"), children: ["all", "enabled", "disabled"].map((key) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", "aria-pressed": filter === key, onClick: () => {
            setFilter(key);
          }, children: t(`panel.filter.${key}`) }, key)) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "sa-btn sa-btn-primary", onClick: onNew, children: t("panel.new") })
        ] }),
        catalog.status === "error" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "sa-note-bad", role: "alert", children: [
          t("panel.error"),
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "sa-btn", onClick: onRetry, children: t("panel.retry") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "sa-body", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "sa-list-wrap", children: [
            catalog.status === "loading" && !catalog.settled && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "sa-empty", children: t("panel.loading") }),
            catalog.settled && rows.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "sa-empty", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: catalog.records.length === 0 ? t("panel.empty") : t("panel.emptyFiltered") }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "sa-hint", children: t("panel.newHint") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: "sa-list", children: rows.map((item) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              Row,
              {
                item,
                selected: selected?.id === item.id,
                t,
                onSelect: () => {
                  setSelectedId(item.id);
                },
                onToggle: (enabled) => {
                  void onUpdate({ id: item.id, enabled });
                }
              },
              item.id
            )) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "sa-detail-wrap", children: selected === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "sa-hint", children: t("panel.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            StartupDetail,
            {
              item: selected,
              t,
              onUpdate,
              onDelete,
              onRun
            },
            selected.id
          ) })
        ] })
      ] });
    }

    // src/client/styles.ts
    var STYLE_MARKER = "data-startup-autostart-panel";
    var PANEL_CSS = `
    .sa-page { display: flex; flex-direction: column; gap: 12px; padding: 16px; height: 100%; box-sizing: border-box; overflow: hidden; }
    .sa-head { display: flex; flex-direction: column; gap: 4px; }
    .sa-title { font-size: 16px; font-weight: 600; color: var(--dsw-text-primary); margin: 0; }
    .sa-subtitle { font-size: 12px; color: var(--dsw-text-tertiary); margin: 0; }
    .sa-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .sa-input { flex: 1 1 220px; min-width: 160px; padding: 6px 10px; font-size: 13px;
      color: var(--dsw-text-primary); background: var(--dsw-surface-sunken);
      border: 1px solid var(--dsw-border-subtle); border-radius: 6px; }
    .sa-seg { display: flex; border: 1px solid var(--dsw-border-subtle); border-radius: 6px; overflow: hidden; }
    .sa-seg > button { padding: 6px 10px; font-size: 12px; cursor: pointer; border: 0;
      color: var(--dsw-text-secondary); background: var(--dsw-surface-sunken); }
    .sa-seg > button[aria-pressed="true"] { color: var(--dsw-text-primary); background: var(--dsw-surface-raised); font-weight: 600; }
    .sa-btn { padding: 6px 12px; font-size: 12px; cursor: pointer; border-radius: 6px;
      color: var(--dsw-text-primary); background: var(--dsw-surface-raised);
      border: 1px solid var(--dsw-border-subtle); }
    .sa-btn:disabled { opacity: .5; cursor: default; }
    .sa-btn-primary { color: var(--dsw-text-on-accent); background: var(--dsw-accent); border-color: var(--dsw-accent); }
    .sa-btn-danger { color: var(--dsw-danger-text); border-color: var(--dsw-danger-border); }
    .sa-body { display: flex; gap: 12px; min-height: 0; flex: 1 1 auto; }
    .sa-list-wrap { flex: 1 1 55%; min-width: 0; overflow: auto; }
    .sa-detail-wrap { flex: 1 1 45%; min-width: 280px; overflow: auto; }
    .sa-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .sa-row { display: flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left;
      padding: 8px 10px; cursor: pointer; border-radius: 8px;
      background: var(--dsw-surface-sunken); border: 1px solid var(--dsw-border-subtle); }
    .sa-row[aria-current="true"] { border-color: var(--dsw-accent); }
    .sa-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .sa-row-name { font-size: 13px; font-weight: 600; color: var(--dsw-text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sa-row-meta { font-size: 12px; color: var(--dsw-text-tertiary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sa-badge { font-size: 11px; padding: 1px 6px; border-radius: 999px;
      color: var(--dsw-text-secondary); background: var(--dsw-surface-raised); }
    .sa-badge-ok { color: var(--dsw-success-text); }
    .sa-badge-bad { color: var(--dsw-danger-text); }
    .sa-switch { flex: 0 0 auto; margin-top: 2px; cursor: pointer; }
    .sa-detail { display: flex; flex-direction: column; gap: 10px; padding: 12px;
      border-radius: 8px; background: var(--dsw-surface-raised); border: 1px solid var(--dsw-border-subtle); }
    .sa-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sa-detail-title { font-size: 13px; font-weight: 600; color: var(--dsw-text-primary); margin: 0; }
    .sa-field { display: flex; flex-direction: column; gap: 3px; }
    .sa-field-label { font-size: 11px; color: var(--dsw-text-tertiary); }
    .sa-field-value { font-size: 12px; color: var(--dsw-text-primary); word-break: break-word; }
    .sa-field-input, .sa-field-select, .sa-field-textarea { padding: 5px 8px; font-size: 12px;
      color: var(--dsw-text-primary); background: var(--dsw-surface-sunken);
      border: 1px solid var(--dsw-border-subtle); border-radius: 6px; font-family: inherit; }
    .sa-field-textarea { min-height: 56px; resize: vertical; }
    .sa-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .sa-note { font-size: 12px; color: var(--dsw-text-tertiary); }
    .sa-note-bad { font-size: 12px; color: var(--dsw-danger-text); }
    .sa-hint { font-size: 11px; color: var(--dsw-text-tertiary); }
    .sa-empty { padding: 24px; text-align: center; font-size: 13px; color: var(--dsw-text-tertiary); }
    `;
    function installPanelStyles(ctx) {
      const doc = globalThis.document;
      ctx.effect(() => {
        const previous = doc.querySelector(`style[${STYLE_MARKER}]`);
        previous?.remove();
        const style = doc.createElement("style");
        style.setAttribute(STYLE_MARKER, "");
        style.textContent = PANEL_CSS;
        doc.head.append(style);
        return () => {
          style.remove();
        };
      }, "startup-autostart panel styles");
    }

    // src/client/index.ts
    var PANEL_ID = "startup";
    var inject = ["slots", "locale", "remote", "uiWorkspace"];
    function reported(error) {
      return `${error.code}: ${error.message}`;
    }
    async function apply(ctx) {
      const unmount = await ctx.remote.$mount(startupRemote);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "startup-autostart: dictionaries");
      installPanelStyles(ctx);
      const t = ctx.locale.bind(NS);
      const catalog = createStartupCatalog({
        list: () => ctx.remote.startup.catalog(),
        subscribeReset: (listener) => ctx.on("connection/reset", listener),
        // See `StartupCatalogDeps.pollMs`: the Host's change notification is not
        // forwarded to this out-of-tree bundle, so the page re-reads on a timer.
        pollMs: 1e4
      });
      const onUpdate = async (request) => {
        const result = await ctx.remote.startup.update(request);
        return result.ok ? void 0 : reported(result.error);
      };
      const onDelete = async (id) => {
        const result = await ctx.remote.startup.delete({ id });
        return result.ok ? void 0 : reported(result.error);
      };
      const onRun = async (id) => {
        const result = await ctx.remote.startup.run({ id });
        if (!result.ok) return { ok: false, detail: reported(result.error) };
        return { ok: result.value.outcome?.status === "ok", detail: result.value.outcome?.detail ?? "" };
      };
      ctx.slots.inject("main", () => ctx.slots.register({
        name: "main",
        key: PANEL_ID,
        locale: NS,
        inject: () => ({
          hooks: { catalog: catalog.source },
          onRetry: catalog.refresh,
          // The page has no creation form of its own: a new item starts in a
          // session, where the model registers it with `startup_create`.
          onNew: () => {
            ctx.uiWorkspace.startSession();
          },
          onUpdate,
          onDelete,
          onRun
        })
      }, StartupPanel));
      ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 10,
        locale: NS,
        label: () => t("panel")
      }, StartupPanelIcon));
      return async () => {
        await unmount();
      };
    }

    return module.exports;
  },
});
