/* Built by scripts/bundle.mjs - the browser half of the app toolbar plugin. */
window.__ModuleLoader__.load({
  id: "@veren/app-host-ui",
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

    // src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);

    // src/client/catalog.ts
    var LOADING = { state: "loading", apps: [] };
    function createAppCatalog(remote, onInvalidate) {
      let snapshot = LOADING;
      const listeners = /* @__PURE__ */ new Set();
      const publish = (next) => {
        snapshot = next;
        for (const listener of [...listeners]) listener();
      };
      let reading = false;
      const read = () => {
        if (reading) return;
        reading = true;
        void remote.catalog().then((result) => {
          reading = false;
          publish(result.ok ? { state: "ready", apps: result.value } : { state: "failed", apps: [], error: result.error });
        });
      };
      read();
      const disposeInvalidate = onInvalidate(read);
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        refresh: read,
        dispose: () => disposeInvalidate
      };
    }

    // src/client/locales.ts
    var NS = "app-host-ui";
    var zh = {
      picker: "\u5E94\u7528",
      pickerAria: "\u6253\u5F00\u4E00\u4E2A\u5E94\u7528",
      loading: "\u6B63\u5728\u8BFB\u53D6\u5E94\u7528\u2026",
      failed: "\u5E94\u7528\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25",
      retry: "\u91CD\u8BD5",
      noApps: "\u8FD8\u6CA1\u6709\u5DF2\u5B89\u88C5\u7684\u5E94\u7528",
      entryMissing: "\uFF08\u5165\u53E3\u9875\u7F3A\u5931\uFF09",
      appDisabled: "\uFF08\u5DF2\u505C\u7528\uFF09",
      appBroken: "\uFF08\u5F02\u5E38\uFF09",
      opening: "\u6B63\u5728\u6253\u5F00\u2026",
      openFailed: "\u5165\u53E3\u9875\u6253\u5F00\u5931\u8D25"
    };
    var en = {
      picker: "Apps",
      pickerAria: "Open an application",
      loading: "Reading apps\u2026",
      failed: "Failed to read the app catalog",
      retry: "Retry",
      noApps: "No installed applications yet",
      entryMissing: "(entry page missing)",
      appDisabled: "(disabled)",
      appBroken: "(broken)",
      opening: "Opening\u2026",
      openFailed: "Failed to open the entry page"
    };

    // src/client/picker.tsx
    var import_react = require("react");
    var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_jsx_runtime = require("react/jsx-runtime");
    function appNote(app, t) {
      if (app.entryUrl === void 0) return ` ${t("entryMissing")}`;
      if (app.state === "disabled") return ` ${t("appDisabled")}`;
      if (app.state === "broken") return ` ${t("appBroken")}`;
      return "";
    }
    function StatusRows(props) {
      const { snapshot, t } = props;
      if (snapshot.state === "loading") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ah-picker-status", children: t("loading") });
      if (snapshot.state === "failed") {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ah-picker-status", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            t("failed"),
            ": ",
            snapshot.error?.code ?? "",
            " ",
            snapshot.error?.message ?? ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: props.onRetry, children: t("retry") })
        ] });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ah-picker-status", children: t("noApps") });
    }
    function AppPicker(props) {
      const [open, setOpen] = (0, import_react.useState)(false);
      const [failure, setFailure] = (0, import_react.useState)(void 0);
      const snapshot = props.useCatalog((current) => current);
      const t = props.t;
      const hasApps = snapshot.apps.length > 0;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_dsh_client_ui_primitives.Menu,
        {
          portal: true,
          dense: true,
          compact: true,
          autoFocus: true,
          open,
          anchor: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            import_dsh_client_ui_primitives.Button,
            {
              variant: "outline",
              size: "sm",
              className: "ah-picker",
              "aria-label": t("pickerAria"),
              "aria-haspopup": "menu",
              "aria-expanded": open,
              onClick: () => {
                setOpen(true);
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ah-picker-value", children: t("picker") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {})
              ]
            }
          ),
          items: hasApps ? snapshot.apps.map((app) => ({ id: app.id, label: `${app.name}${appNote(app, t)}` })) : [],
          children: hasApps ? failure === void 0 ? void 0 : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ah-picker-status", children: [
            t("openFailed"),
            ": ",
            failure
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusRows, { snapshot, t, onRetry: props.onRetry }),
          onSelect: (id) => {
            setFailure(void 0);
            void props.onOpen(id).then((failed) => {
              if (failed !== void 0) {
                setFailure(failed);
                setOpen(true);
              }
            });
          },
          onClose: () => {
            setOpen(false);
          }
        }
      );
    }

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
    var APP_SCHEMA = import_zod.z.looseObject({
      id: import_zod.z.string(),
      name: import_zod.z.string(),
      description: import_zod.z.string(),
      state: import_zod.z.union([import_zod.z.literal("active"), import_zod.z.literal("disabled"), import_zod.z.literal("broken")]),
      entryUrl: import_zod.z.string().optional()
    });
    var OPEN_SCHEMA = import_zod.z.looseObject({ sessionId: import_zod.z.string(), url: import_zod.z.string(), title: import_zod.z.string() });
    var SERVICE = "appHost";
    function codec(typeSymbol, create) {
      return { mode: "strict", typeSymbol, create };
    }
    function parameter(name, typeSymbol, create) {
      const spec = codec(typeSymbol, create);
      return { name, wire: name, source: "json", codec: spec, strictCodec: spec };
    }
    var appHostRemote = createTypertRemoteInfo({
      package: "@veren/app-host-ui",
      methods: {
        "appHost/catalog": {
          service: SERVICE,
          description: "Read the installed-application catalog with each app entry-page url.",
          invocation: { kind: "direct" },
          parameters: [],
          result: codec("app-host:catalog:result", () => import_zod.z.array(APP_SCHEMA))
        },
        "appHost/open": {
          service: SERVICE,
          description: "Open one app page (entry by default, or the given url of the same app) into a fresh page session and focus it.",
          invocation: { kind: "direct" },
          parameters: [
            parameter("appId", "app-host:open:appId", () => import_zod.z.string()),
            parameter("url", "app-host:open:url", () => import_zod.z.string().optional())
          ],
          result: codec("app-host:open:result", () => OPEN_SCHEMA)
        }
      }
    }, import_zod.z);

    // src/client/styles.ts
    var STYLE_ID = "app-host-ui-picker-styles";
    var CSS = `
    .ah-picker { display: inline-flex; min-width: 0; }
    .ah-picker .ah-picker-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 12em; }
    .ah-picker .ah-picker-note { opacity: 0.7; font-size: 0.85em; margin-left: 0.35em; }
    .ah-picker-status { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; max-width: 20em;
      color: var(--dsw-alias-label-secondary, inherit); font-size: 0.9em; }
    `;
    function installPickerStyles(_ctx) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => {
        style.remove();
      };
    }

    // src/client/index.tsx
    var PICKER_ID = "app-picker";
    var inject = ["slots", "locale", "remote", "uiWorkspace"];
    var PickerPlugin = {
      name: "app-host-ui:picker",
      // Per-namespace declarations: the property proxy admits exactly the
      // namespaces the fiber names, so plain `remote` is not enough.
      // 按命名空间声明：属性代理只放行 fiber 点名的命名空间，单写 remote 不够。
      inject: ["remote.appHost", "slots", "locale", "uiWorkspace"],
      /** @param ctx - panel-scope context over the mounted namespace. */
      apply(ctx) {
        const appHost = ctx.remote.appHost;
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), "app-host-ui: dictionaries");
        installPickerStyles(ctx);
        const catalog = createAppCatalog(appHost, (listener) => ctx.on("connection/reset", listener));
        ctx.effect(() => catalog.dispose(), "app-host-ui: catalog invalidation listener");
        const onOpen = async (appId) => {
          const raw = await appHost.open(appId);
          const result = typeof raw === "object" && raw !== null && "ok" in raw ? raw : { ok: true, value: raw };
          if (!result.ok) return `${result.error.code}: ${result.error.message}`;
          ctx.uiWorkspace.openSession(result.value.sessionId);
          return void 0;
        };
        ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
          name: "conversation.input.left",
          id: PICKER_ID,
          order: 20,
          locale: NS,
          inject: () => ({
            hooks: { catalog: { getSnapshot: catalog.getSnapshot, subscribe: catalog.subscribe } },
            onOpen,
            onRetry: catalog.refresh
          })
        }, AppPicker));
        ctx.remote.$on("app-host/focus", (payload) => {
          ctx.uiWorkspace.openSession(payload.sessionId);
        });
      }
    };
    async function apply(ctx) {
      const unmount = await ctx.remote.$mount(appHostRemote);
      const picker = ctx.plugin(PickerPlugin);
      await picker;
      return async () => {
        await picker.dispose();
        await unmount();
      };
    }

    return module.exports;
  },
});
