/* Built by scripts/bundle.mjs - the browser half of the notebook page. */
window.__ModuleLoader__.load({
  id: "@veren/notebook-ui",
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

    // src/client/locales.ts
    var NS = "notebook";
    var zh = {
      panel: "\u8BB0\u4E8B\u672C",
      panelSubtitle: "\u6BCF\u4E2A\u9884\u8BBE\u4E00\u672C\u79C1\u5BC6\u7B14\u8BB0\uFF0C\u8DDF\u7740\u9884\u8BBE\u8D70\uFF0C\u4E0D\u8DDF\u7740\u5DE5\u4F5C\u533A\u8D70\u3002",
      owner: "\u8BB0\u4E8B\u672C\u5C5E\u4E8E",
      ownerHint: "\u9009\u62E9\u8981\u770B\u8C01\u7684\u8BB0\u4E8B\u672C\u3002\u522B\u7684\u9884\u8BBE\u770B\u4E0D\u5230\u8FD9\u4E00\u672C\u3002",
      notes: "\u7B14\u8BB0",
      noOwners: "\u8FD8\u6CA1\u6709\u53EF\u9009\u7684\u9884\u8BBE\u3002",
      noNotes: "\u8FD9\u672C\u8BB0\u4E8B\u672C\u8FD8\u662F\u7A7A\u7684\u3002",
      noNotesHint: "\u5199\u4E0B\u7B2C\u4E00\u6761\uFF0C\u4E4B\u540E\u7528\u5DE5\u5177\u6216\u8FD9\u4E2A\u9875\u9762\u90FD\u80FD\u7FFB\u5230\u3002",
      newNote: "\u65B0\u5EFA\u7B14\u8BB0",
      newNoteHint: "\u6807\u9898\u5FC5\u586B\uFF0C\u6B63\u6587\u53EF\u4EE5\u4E3A\u7A7A\u3002",
      editNote: "\u7F16\u8F91\u7B14\u8BB0",
      title: "\u6807\u9898",
      titlePlaceholder: "\u4E00\u53E5\u8BDD\u8BF4\u6E05\u8FD9\u6761\u7B14\u8BB0\u8BB0\u4EC0\u4E48",
      body: "\u6B63\u6587",
      bodyPlaceholder: "\u5199\u503C\u5F97\u7559\u4E0B\u3001\u4EE5\u540E\u8FD8\u80FD\u7FFB\u5230\u7684\u5185\u5BB9",
      save: "\u4FDD\u5B58",
      saving: "\u4FDD\u5B58\u4E2D\u2026",
      delete: "\u5220\u9664",
      confirmDelete: "\u518D\u70B9\u4E00\u6B21\u786E\u8BA4\u5220\u9664",
      refresh: "\u5237\u65B0",
      loading: "\u6B63\u5728\u8BFB\u53D6\u2026",
      failed: "\u8BFB\u53D6\u5931\u8D25",
      retry: "\u91CD\u8BD5",
      emptyTitle: "\u8FD8\u6CA1\u6709\u9009\u4E2D\u7B14\u8BB0",
      emptyBody: "\u4ECE\u5DE6\u8FB9\u9009\u4E00\u6761\uFF0C\u6216\u8005\u65B0\u5EFA\u4E00\u6761\u3002",
      saved: "\u5DF2\u4FDD\u5B58",
      deleted: "\u5DF2\u5220\u9664",
      unsaved: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539",
      titleRequired: "\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A\u3002",
      bodyTooLong: "\u6B63\u6587\u8D85\u8FC7\u957F\u5EA6\u4E0A\u9650\u3002",
      removed: "\u9884\u8BBE\u5DF2\u5220\u9664\uFF0C\u7B14\u8BB0\u4ECD\u4FDD\u7559",
      updatedAt: "\u66F4\u65B0\u4E8E",
      selectNote: "\u9009\u62E9\u4E00\u6761\u7B14\u8BB0",
      close: "\u5173\u95ED"
    };
    var en = {
      panel: "Notebook",
      panelSubtitle: "One private notebook per preset, carried by the preset, not by the workspace.",
      owner: "Notebook owner",
      ownerHint: "Choose whose notebook to read. No other preset can see it.",
      notes: "Notes",
      noOwners: "No preset is available yet.",
      noNotes: "This notebook is empty.",
      noNotesHint: "Write the first note; the tools and this page will both find it later.",
      newNote: "New note",
      newNoteHint: "A title is required; the body may be empty.",
      editNote: "Edit note",
      title: "Title",
      titlePlaceholder: "One line saying what this note is about",
      body: "Body",
      bodyPlaceholder: "Write what is worth keeping and finding again",
      save: "Save",
      saving: "Saving\u2026",
      delete: "Delete",
      confirmDelete: "Click again to delete",
      refresh: "Refresh",
      loading: "Loading\u2026",
      failed: "Could not read",
      retry: "Retry",
      emptyTitle: "No note selected",
      emptyBody: "Pick one on the left, or create a new one.",
      saved: "Saved",
      deleted: "Deleted",
      unsaved: "Unsaved changes",
      titleRequired: "A title is required.",
      bodyTooLong: "The body is over its length limit.",
      removed: "Preset removed; notes retained",
      updatedAt: "Updated",
      selectNote: "Select a note",
      close: "Close"
    };

    // src/client/panel.tsx
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
          const method2 = endpoint.slice(separator + 1);
          const parameters = definition.parameters.map((parameter2) => ({ ...parameter2, wire: parameter2.wire ?? parameter2.name }));
          const descriptor = {
            ...definition,
            id: `${this.spec.package}#${endpoint}`,
            namespace,
            method: method2,
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
                const call = Reflect.get(receiver, method2);
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
    var MAX_TITLE_CHARS = 200;
    var MAX_BODY_CHARS = 1e5;
    var OWNER_SCHEMA = import_zod.z.looseObject({
      id: import_zod.z.string(),
      declared: import_zod.z.boolean(),
      noteCount: import_zod.z.number()
    });
    var NOTE_SCHEMA = import_zod.z.looseObject({
      id: import_zod.z.string(),
      title: import_zod.z.string(),
      body: import_zod.z.string(),
      createdAt: import_zod.z.string(),
      updatedAt: import_zod.z.string()
    });
    var OWNERS_REQUEST = import_zod.z.looseObject({});
    var LIST_REQUEST = import_zod.z.looseObject({ owner: import_zod.z.string() });
    var CREATE_REQUEST = import_zod.z.looseObject({ owner: import_zod.z.string(), title: import_zod.z.string(), body: import_zod.z.string() });
    var UPDATE_REQUEST = import_zod.z.looseObject({
      owner: import_zod.z.string(),
      id: import_zod.z.string(),
      title: import_zod.z.string().optional(),
      body: import_zod.z.string().optional(),
      expectedUpdatedAt: import_zod.z.string().optional()
    });
    var REMOVE_REQUEST = import_zod.z.looseObject({ owner: import_zod.z.string(), id: import_zod.z.string() });
    var SERVICE = "notebook";
    function codec(typeSymbol, create) {
      return { mode: "strict", typeSymbol, create };
    }
    function parameter(name, typeSymbol, create) {
      const spec = codec(typeSymbol, create);
      return { name, wire: name, source: "json", codec: spec, strictCodec: spec };
    }
    function method(exportName, description, typeSymbol, parameters, result) {
      return {
        [`notebook/${exportName}`]: {
          service: SERVICE,
          description,
          invocation: { kind: "direct" },
          parameters: [...parameters],
          result: codec(`notebook:${typeSymbol}:result`, result)
        }
      };
    }
    var notebookRemote = createTypertRemoteInfo({
      package: "@veren/notebook",
      methods: {
        ...method("owners", "List every preset with a notebook.", "owners", [
          parameter("request", "notebook:owners:request", () => OWNERS_REQUEST)
        ], () => import_zod.z.array(OWNER_SCHEMA)),
        ...method("list", "Read one preset\u2019s notes, newest update first.", "list", [
          parameter("request", "notebook:list:request", () => LIST_REQUEST)
        ], () => import_zod.z.array(NOTE_SCHEMA)),
        ...method("create", "Write one note into one preset\u2019s notebook.", "create", [
          parameter("request", "notebook:create:request", () => CREATE_REQUEST)
        ], () => NOTE_SCHEMA),
        ...method("update", "Replace fields of one note in one preset\u2019s notebook.", "update", [
          parameter("request", "notebook:update:request", () => UPDATE_REQUEST)
        ], () => NOTE_SCHEMA),
        ...method("deleteNote", "Delete one note from one preset\u2019s notebook.", "deleteNote", [
          parameter("request", "notebook:deleteNote:request", () => REMOVE_REQUEST)
        ], () => import_zod.z.looseObject({ deleted: import_zod.z.boolean() }))
      }
    }, import_zod.z);

    // src/client/editor.tsx
    var import_jsx_runtime = require("react/jsx-runtime");
    var EMPTY_DRAFT = { title: "", body: "", updatedAt: void 0 };
    function NoteEditor(props) {
      const { t, editingNew, draft, busy, dirty, error, notice, confirmDelete } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "notebook-editor-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: editingNew ? t("newNote") : t("editNote") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: editingNew ? t("newNoteHint") : `${t("updatedAt")} ${formatTime(draft.updatedAt)}` })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "notebook-editor-actions", children: [
            !editingNew && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "notebook-btn is-danger",
                disabled: busy,
                onClick: props.onRemove,
                children: confirmDelete ? t("confirmDelete") : t("delete")
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "notebook-btn is-primary",
                disabled: busy,
                onClick: props.onSave,
                children: busy ? t("saving") : t("save")
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "notebook-form", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "notebook-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "notebook-label", children: t("title") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "notebook-input",
                value: draft.title,
                maxLength: MAX_TITLE_CHARS,
                placeholder: t("titlePlaceholder"),
                onChange: (event) => {
                  props.onEdit({ title: event.target.value });
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "notebook-field is-grow", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "notebook-label", children: t("body") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "textarea",
              {
                className: "notebook-textarea",
                value: draft.body,
                maxLength: MAX_BODY_CHARS,
                placeholder: t("bodyPlaceholder"),
                onChange: (event) => {
                  props.onEdit({ body: event.target.value });
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "notebook-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
              draft.body.length,
              " / ",
              MAX_BODY_CHARS
            ] }),
            dirty && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("unsaved") }),
            notice !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "notebook-notice", children: notice }),
            error !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "notebook-error", children: error })
          ] })
        ] })
      ] });
    }
    function formatTime(value) {
      if (value === void 0) return "";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }

    // src/client/note-list.tsx
    var import_jsx_runtime2 = require("react/jsx-runtime");
    function NoteList(props) {
      const { t, notes, selectedId, busy, canCreate } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "notebook-list", "aria-label": t("notes"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "notebook-list-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("notes") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "notebook-count", children: notes.length })
        ] }),
        notes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "notebook-empty", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: t("noNotes") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("noNotesHint") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              className: "notebook-btn is-primary",
              disabled: !canCreate || busy,
              onClick: props.onCreate,
              children: t("newNote")
            }
          )
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "notebook-items", children: notes.map((note) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "button",
          {
            type: "button",
            className: "notebook-item",
            "aria-current": note.id === selectedId,
            onClick: () => {
              props.onOpen(note);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "notebook-item-title", children: note.title }),
              note.body !== "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "notebook-item-excerpt", children: note.body }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "notebook-item-time", children: formatTime(note.updatedAt) })
            ]
          },
          note.id
        )) })
      ] });
    }

    // src/client/panel.tsx
    var import_jsx_runtime3 = require("react/jsx-runtime");
    function NotebookPanel(props) {
      const state = props.useNotebook((snapshot) => snapshot);
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(NotebookBody, { state, t: props.t, actions: props });
    }
    function NotebookBody(props) {
      const { state, t, actions } = props;
      const [selectedId, setSelectedId] = (0, import_react.useState)(void 0);
      const [draft, setDraft] = (0, import_react.useState)(EMPTY_DRAFT);
      const [editingNew, setEditingNew] = (0, import_react.useState)(false);
      const [dirty, setDirty] = (0, import_react.useState)(false);
      const [busy, setBusy] = (0, import_react.useState)(false);
      const [error, setError] = (0, import_react.useState)("");
      const [notice, setNotice] = (0, import_react.useState)("");
      const [confirmDelete, setConfirmDelete] = (0, import_react.useState)(false);
      const deleted = (0, import_react.useRef)(void 0);
      const openNote = (note) => {
        setSelectedId(note.id);
        setEditingNew(false);
        setDraft({ title: note.title, body: note.body, updatedAt: note.updatedAt });
        setDirty(false);
        setConfirmDelete(false);
        setError("");
      };
      (0, import_react.useEffect)(() => {
        setSelectedId(void 0);
        setEditingNew(false);
        setDraft(EMPTY_DRAFT);
        setDirty(false);
        setConfirmDelete(false);
        setError("");
        setNotice("");
      }, [state.owner]);
      (0, import_react.useEffect)(() => {
        if (editingNew) return;
        if (selectedId === void 0) {
          const first = state.notes[0];
          if (first !== void 0) openNote(first);
          return;
        }
        const current = state.notes.find((note) => note.id === selectedId);
        if (current === void 0) {
          if (deleted.current !== void 0 && !state.notes.some((note) => note.id === deleted.current)) {
            deleted.current = void 0;
            setNotice("");
            const first = state.notes[0];
            if (first !== void 0) openNote(first);
            else {
              setSelectedId(void 0);
              setEditingNew(false);
              setDraft(EMPTY_DRAFT);
              setDirty(false);
            }
          }
          return;
        }
        if (!dirty && current.updatedAt !== draft.updatedAt) openNote(current);
      }, [state.notes, selectedId, editingNew, dirty, draft.updatedAt]);
      const startNew = () => {
        deleted.current = void 0;
        setEditingNew(true);
        setSelectedId(void 0);
        setDraft(EMPTY_DRAFT);
        setDirty(false);
        setConfirmDelete(false);
        setError("");
        setNotice("");
      };
      const chooseOwner2 = (owner) => {
        deleted.current = void 0;
        actions.onSelect(owner);
        setSelectedId(void 0);
        setEditingNew(false);
        setDraft(EMPTY_DRAFT);
        setDirty(false);
        setConfirmDelete(false);
        setError("");
        setNotice("");
      };
      const edit = (patch) => {
        setDraft((current) => ({ ...current, ...patch }));
        setDirty(true);
        setConfirmDelete(false);
        setError("");
      };
      const save = async () => {
        const owner = state.owner;
        if (owner === void 0) return;
        const title = draft.title.trim();
        if (title === "") {
          setError(t("titleRequired"));
          return;
        }
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const note = editingNew ? await actions.onCreate({ owner, title, body: draft.body }) : selectedId === void 0 ? void 0 : await actions.onUpdate({
            owner,
            id: selectedId,
            title,
            body: draft.body,
            ...draft.updatedAt === void 0 ? {} : { expectedUpdatedAt: draft.updatedAt }
          });
          if (note === void 0) return;
          openNote(note);
          setNotice(t("saved"));
          actions.onRefresh();
        } catch (cause) {
          setError(messageOf(cause));
        } finally {
          setBusy(false);
        }
      };
      const remove = async () => {
        const owner = state.owner;
        const id = selectedId;
        if (owner === void 0 || id === void 0) return;
        if (!confirmDelete) {
          setConfirmDelete(true);
          return;
        }
        setBusy(true);
        setError("");
        setNotice("");
        try {
          await actions.onRemove({ owner, id });
          deleted.current = id;
          setSelectedId(void 0);
          setEditingNew(false);
          setDraft(EMPTY_DRAFT);
          setDirty(false);
          setConfirmDelete(false);
          setNotice(t("deleted"));
          actions.onRefresh();
        } catch (cause) {
          setError(messageOf(cause));
        } finally {
          setBusy(false);
        }
      };
      const active = editingNew || selectedId !== void 0;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "notebook-page", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "notebook-header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "notebook-heading", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "notebook-heading-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "notebook-mark", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(NotebookGlyph, {}) }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h1", { children: t("panel") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: t("panelSubtitle") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "notebook-actions", children: [
            state.owners.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "notebook-owner", title: t("ownerHint"), children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("owner") }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "select",
                {
                  value: state.owner ?? "",
                  "aria-label": t("owner"),
                  onChange: (event) => {
                    chooseOwner2(event.target.value);
                  },
                  children: state.owners.map((owner) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: owner.id, children: owner.declared ? owner.id : `${owner.id} (${t("removed")})` }, owner.id))
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "notebook-btn", onClick: () => {
              actions.onRefresh();
            }, children: t("refresh") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                className: "notebook-btn is-primary",
                disabled: state.owner === void 0 || busy,
                onClick: startNew,
                children: t("newNote")
              }
            )
          ] })
        ] }),
        state.status === "error" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "notebook-banner", role: "alert", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
            t("failed"),
            ": ",
            state.error
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "notebook-btn", onClick: () => {
            actions.onRefresh();
          }, children: t("retry") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "notebook-layout", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            NoteList,
            {
              t,
              notes: state.notes,
              selectedId,
              busy,
              canCreate: state.owner !== void 0,
              onOpen: (note) => {
                deleted.current = void 0;
                openNote(note);
              },
              onCreate: startNew
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("section", { className: "notebook-editor", "aria-label": t("editNote"), children: state.owner === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "notebook-empty", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: t("noOwners") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: t("ownerHint") })
          ] }) : !active ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "notebook-empty", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: t("emptyTitle") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: t("emptyBody") })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            NoteEditor,
            {
              t,
              editingNew,
              draft,
              busy,
              dirty,
              error,
              notice,
              confirmDelete,
              onEdit: edit,
              onSave: () => {
                void save();
              },
              onRemove: () => {
                void remove();
              }
            }
          ) })
        ] })
      ] });
    }
    function messageOf(error) {
      if (error instanceof Error) return error.message;
      if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
      return String(error);
    }
    function NotebookGlyph() {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("svg", { width: "19", height: "19", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M3.5 2.5h8v11h-8z", stroke: "currentColor", strokeWidth: "1.2", strokeLinejoin: "round" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M5.5 9h5M5.5 11h3.5", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" })
      ] });
    }

    // src/client/index.tsx
    var import_jsx_runtime4 = require("react/jsx-runtime");
    var PANEL_ID = "notebook";
    var POLL_MS = 8e3;
    var inject = ["slots", "locale", "remote"];
    var PanelPlugin = {
      name: "notebook:panel",
      inject: ["remote.notebook"],
      /** @param ctx - panel-scope context over the mounted namespace. */
      apply(ctx) {
        const api = ctx.remote.notebook;
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), "notebook-ui:dictionaries");
        installPanelStyles(ctx);
        const t = ctx.locale.bind(NS);
        const notebook = createNotebookSource(api);
        ctx.slots.inject("main", () => ctx.slots.register({
          name: "main",
          key: PANEL_ID,
          locale: NS,
          inject: () => ({
            hooks: { notebook: notebook.source },
            onSelect: notebook.select,
            onRefresh: notebook.refresh,
            onCreate: async (input) => unwrap(api.create(input)),
            onUpdate: async (input) => unwrap(api.update(input)),
            onRemove: async (input) => unwrap(api.deleteNote(input))
          })
        }, NotebookPanel));
        ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
          name: "sidebar.panellist",
          id: PANEL_ID,
          order: 21,
          locale: NS,
          label: () => t("panel")
        }, NotebookPanelIcon));
      }
    };
    function createNotebookSource(api) {
      let snapshot = {
        owners: [],
        owner: void 0,
        notes: [],
        status: "loading",
        settled: false,
        error: ""
      };
      let owner;
      let epoch = 0;
      let timer;
      const listeners = /* @__PURE__ */ new Set();
      const publish = (next) => {
        snapshot = { ...snapshot, ...next };
        for (const listener of [...listeners]) listener();
      };
      const run = async (mine) => {
        try {
          const owners = await readOwners(api);
          const chosen = chooseOwner(owners, owner);
          owner = chosen;
          if (chosen === void 0) {
            if (mine === epoch) {
              publish({ owners, owner: void 0, notes: [], status: "ready", settled: true, error: "" });
            }
            return;
          }
          const notes = await readNotes(api, chosen);
          if (mine !== epoch) return;
          publish({ owners, owner: chosen, notes, status: "ready", settled: true, error: "" });
        } catch (error) {
          if (mine === epoch) publish({ status: "error", error: messageOf2(error) });
        }
      };
      const load = () => {
        const mine = ++epoch;
        if (!snapshot.settled) publish({ status: "loading" });
        void run(mine);
      };
      return {
        source: {
          getSnapshot: () => snapshot,
          subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) {
              load();
              timer = globalThis.setInterval(load, POLL_MS);
            }
            return () => {
              listeners.delete(listener);
              if (listeners.size !== 0) return;
              if (timer !== void 0) globalThis.clearInterval(timer);
              timer = void 0;
              epoch += 1;
            };
          }
        },
        select: (next) => {
          owner = next;
          load();
        },
        refresh: () => {
          load();
        }
      };
    }
    function chooseOwner(owners, current) {
      if (current !== void 0 && owners.some((owner) => owner.id === current)) return current;
      return owners.find((owner) => owner.declared)?.id ?? owners[0]?.id;
    }
    async function readOwners(api) {
      const result = await api.owners({});
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    }
    async function readNotes(api, owner) {
      const result = await api.list({ owner });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    }
    async function unwrap(result) {
      const settled = await result;
      if (!settled.ok) throw new Error(settled.error.message);
      return settled.value;
    }
    function messageOf2(error) {
      if (error instanceof Error) return error.message;
      if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
      return String(error);
    }
    async function apply(ctx) {
      try {
        const unmount = await ctx.remote.$mount(notebookRemote);
        const panel = ctx.plugin(PanelPlugin);
        await panel;
        return async () => {
          await panel.dispose();
          await unmount();
        };
      } catch (error) {
        console.error("notebook-ui apply failed", error);
        throw error;
      }
    }
    function NotebookPanelIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("path", { d: "M3.5 2.5h8v11h-8z", stroke: "currentColor", strokeWidth: "1.2", strokeLinejoin: "round" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("path", { d: "M7.5 2.5v4l1.2-.9 1.3.9v-4", fill: "currentColor" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("path", { d: "M5.5 9h5M5.5 11h3.5", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" })
      ] });
    }
    var STYLE_MARKER = "data-notebook-panel";
    function installPanelStyles(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style");
        style.setAttribute(STYLE_MARKER, "");
        style.textContent = ".notebook-page {\n  --nb-canvas: var(--dsw-alias-bg-module-platform);\n  --nb-surface: var(--dsw-alias-bg-layer-1);\n  --nb-sunken: var(--dsw-alias-turn-trigger-bg);\n  --nb-text: var(--dsw-alias-label-primary);\n  --nb-secondary: var(--dsw-alias-label-secondary);\n  --nb-muted: var(--dsw-alias-label-tertiary);\n  --nb-border: var(--dsw-alias-border-l2);\n  --nb-border-soft: var(--dsw-alias-border-l1);\n  --nb-accent: var(--dsw-alias-state-business-primary);\n  --nb-accent-soft: var(--dsw-alias-state-business-tertiary);\n  --nb-ink: var(--dsw-alias-button-primary-fill);\n  --nb-ink-hover: var(--dsw-alias-button-primary-hover);\n  --nb-ink-fg: var(--dsw-alias-label-primary-foreground);\n  --nb-danger: var(--dsw-alias-state-error-primary);\n  --nb-success: var(--dsw-alias-state-success-primary);\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  min-height: 0;\n  overflow: hidden;\n  background: var(--nb-canvas);\n  color: var(--nb-text);\n  font-family: var(--dsw-font-family);\n  font-size: 13.5px;\n  line-height: 1.5;\n}\n.notebook-page *, .notebook-page *::before, .notebook-page *::after { box-sizing: border-box; }\n.notebook-page :focus-visible { outline: 2px solid var(--nb-accent); outline-offset: 2px; }\n.notebook-page ::selection { background: var(--nb-accent-soft); }\n.notebook-header {\n  flex: 0 0 auto;\n  display: flex;\n  flex-wrap: wrap;\n  align-items: flex-end;\n  justify-content: space-between;\n  gap: 18px;\n  width: 100%;\n  max-width: 1120px;\n  margin: 0 auto;\n  padding: 24px 32px 14px;\n}\n.notebook-heading-row { display: flex; align-items: center; gap: 10px; }\n.notebook-mark {\n  display: grid;\n  place-items: center;\n  width: 36px;\n  height: 36px;\n  border-radius: 11px;\n  background: var(--nb-accent-soft);\n  color: var(--nb-accent);\n}\n.notebook-mark svg { width: 19px; height: 19px; }\n.notebook-heading h1 { margin: 0; font-size: 23px; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; }\n.notebook-heading p { margin: 6px 0 0; color: var(--nb-secondary); font-size: 12.5px; }\n.notebook-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }\n.notebook-owner {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  height: 36px;\n  padding: 0 4px 0 11px;\n  border: 1px solid var(--nb-border-soft);\n  border-radius: 10px;\n  background: var(--nb-surface);\n}\n.notebook-owner span { color: var(--nb-muted); font-size: 11px; white-space: nowrap; }\n.notebook-owner select {\n  max-width: 190px;\n  height: 28px;\n  padding: 0 4px;\n  border: none;\n  border-radius: 7px;\n  background: transparent;\n  color: var(--nb-text);\n  font: inherit;\n  font-size: 12.5px;\n  font-weight: 600;\n  cursor: pointer;\n}\n.notebook-owner select:hover { background: var(--nb-sunken); }\n.notebook-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  height: 34px;\n  padding: 0 12px;\n  border: 1px solid var(--nb-border);\n  border-radius: 9px;\n  background: var(--nb-surface);\n  color: var(--nb-text);\n  font: inherit;\n  font-size: 12.5px;\n  font-weight: 550;\n  white-space: nowrap;\n  cursor: pointer;\n}\n.notebook-btn:hover:not(:disabled) { background: var(--nb-sunken); }\n.notebook-btn:disabled { opacity: .5; cursor: not-allowed; }\n.notebook-btn.is-primary { border-color: var(--nb-ink); background: var(--nb-ink); color: var(--nb-ink-fg); }\n.notebook-btn.is-primary:hover:not(:disabled) { background: var(--nb-ink-hover); border-color: var(--nb-ink-hover); }\n.notebook-btn.is-danger { border-color: color-mix(in srgb, var(--nb-danger) 35%, var(--nb-border)); color: var(--nb-danger); }\n.notebook-btn.is-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--nb-danger) 10%, transparent); }\n.notebook-banner {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  width: 100%;\n  max-width: 1120px;\n  margin: 0 auto 8px;\n  padding: 9px 12px;\n  border: 1px solid color-mix(in srgb, var(--nb-danger) 22%, transparent);\n  border-radius: 10px;\n  background: color-mix(in srgb, var(--nb-danger) 8%, transparent);\n  color: var(--nb-danger);\n  font-size: 12px;\n}\n.notebook-layout {\n  flex: 1 1 auto;\n  display: grid;\n  grid-template-columns: 310px minmax(0, 1fr);\n  gap: 18px;\n  width: 100%;\n  max-width: 1120px;\n  min-height: 0;\n  margin: 0 auto;\n  padding: 0 32px 28px;\n}\n.notebook-list, .notebook-editor {\n  min-height: 0;\n  overflow: hidden;\n  border: 1px solid var(--nb-border-soft);\n  border-radius: 14px;\n  background: var(--nb-surface);\n  box-shadow: var(--dsw-shadow-lv1);\n}\n.notebook-list { display: flex; flex-direction: column; }\n.notebook-list-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 13px 15px;\n  border-bottom: 1px solid var(--nb-border-soft);\n  color: var(--nb-secondary);\n  font-size: 12px;\n  font-weight: 650;\n}\n.notebook-count {\n  display: grid;\n  place-items: center;\n  min-width: 20px;\n  height: 20px;\n  padding: 0 6px;\n  border-radius: 999px;\n  background: var(--nb-sunken);\n  color: var(--nb-secondary);\n  font-size: 10.5px;\n  line-height: 1;\n}\n.notebook-items { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; }\n.notebook-item {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  width: 100%;\n  margin-bottom: 4px;\n  padding: 10px 11px;\n  border: 1px solid transparent;\n  border-radius: 10px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n}\n.notebook-item:hover { background: var(--nb-sunken); }\n.notebook-item[aria-current='true'] { border-color: var(--nb-border); background: var(--nb-sunken); }\n.notebook-item-title {\n  overflow: hidden;\n  font-size: 12.5px;\n  font-weight: 650;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.notebook-item-excerpt {\n  display: -webkit-box;\n  overflow: hidden;\n  color: var(--nb-secondary);\n  font-size: 11.5px;\n  line-height: 1.55;\n  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 2;\n}\n.notebook-item-time { color: var(--nb-muted); font-size: 10.5px; }\n.notebook-editor { display: flex; flex-direction: column; }\n.notebook-editor-head {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 12px;\n  padding: 16px 18px 12px;\n  border-bottom: 1px solid var(--nb-border-soft);\n}\n.notebook-editor-head h2 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }\n.notebook-editor-head p { margin: 4px 0 0; color: var(--nb-muted); font-size: 11.5px; }\n.notebook-editor-actions { display: flex; flex-wrap: wrap; gap: 8px; }\n.notebook-form { flex: 1 1 auto; display: flex; flex-direction: column; gap: 14px; min-height: 0; padding: 16px 18px 18px; }\n.notebook-field { display: flex; flex-direction: column; gap: 6px; min-height: 0; }\n.notebook-field.is-grow { flex: 1 1 auto; }\n.notebook-label { color: var(--nb-secondary); font-size: 11.5px; font-weight: 600; }\n.notebook-input, .notebook-textarea {\n  width: 100%;\n  padding: 9px 11px;\n  border: 1px solid var(--nb-border);\n  border-radius: 10px;\n  background: var(--nb-surface);\n  color: var(--nb-text);\n  font: inherit;\n  font-size: 13px;\n}\n.notebook-input::placeholder, .notebook-textarea::placeholder { color: var(--nb-muted); }\n.notebook-input:focus, .notebook-textarea:focus {\n  outline: none;\n  border-color: var(--nb-accent);\n  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nb-accent) 16%, transparent);\n}\n.notebook-textarea { flex: 1 1 auto; min-height: 220px; line-height: 1.7; resize: none; }\n.notebook-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: var(--nb-muted); font-size: 11px; }\n.notebook-notice { color: var(--nb-success); font-weight: 600; }\n.notebook-error { color: var(--nb-danger); font-weight: 600; }\n.notebook-empty {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  min-height: 240px;\n  padding: 32px;\n  color: var(--nb-secondary);\n  text-align: center;\n}\n.notebook-empty h3 { margin: 0; font-size: 14px; font-weight: 650; color: var(--nb-text); }\n.notebook-empty p { max-width: 360px; margin: 0; font-size: 12px; line-height: 1.65; }\n.notebook-empty .notebook-btn { margin-top: 10px; }\n.notebook-items::-webkit-scrollbar { width: 8px; }\n.notebook-items::-webkit-scrollbar-thumb {\n  border: 2px solid transparent;\n  border-radius: 999px;\n  background: var(--dsw-alias-scrollbar-bg-l2);\n  background-clip: padding-box;\n}\n@media (max-width: 900px) {\n  .notebook-header, .notebook-layout { padding-left: 18px; padding-right: 18px; }\n  .notebook-layout { grid-template-columns: minmax(0, 1fr); overflow-y: auto; }\n  .notebook-list { max-height: 260px; }\n}\n\n";
        document.head.append(style);
        return () => {
          style.remove();
        };
      }, "notebook-ui:styles");
    }

    return module.exports;
  },
});
