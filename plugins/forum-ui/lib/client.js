/* Built by scripts/bundle.mjs — the browser half of the forum page. */
window.__ModuleLoader__.load({
  id: "@veren/forum-ui",
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
    var POLL_MS = 1e4;
    function emptyCatalog() {
      return { boards: [], posts: [], people: [] };
    }
    function createForumCatalog(api) {
      let snapshot = { catalog: emptyCatalog(), status: "loading", settled: false, error: "" };
      let epoch = 0;
      let inflight;
      let request = {};
      let timer;
      const registry = /* @__PURE__ */ new Set();
      const publish = (next) => {
        snapshot = { ...snapshot, ...next };
        for (const listener of [...registry]) listener();
      };
      const read = (next) => {
        if (next !== void 0) {
          request = next;
          epoch += 1;
          inflight = void 0;
        }
        if (inflight !== void 0) return inflight;
        const mine = epoch;
        publish({ status: "loading" });
        inflight = api.catalog(request).then(
          (result) => {
            if (mine !== epoch) return;
            publish(result.ok ? {
              catalog: {
                boards: result.value.boards ?? [],
                posts: result.value.posts ?? [],
                people: result.value.people ?? [],
                ...result.value.boardId === void 0 ? {} : { boardId: result.value.boardId }
              },
              status: "ready",
              settled: true,
              error: ""
            } : { status: "error", error: messageOf(result.error) });
          },
          (error) => {
            if (mine === epoch) publish({ status: "error", error: messageOf(error) });
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
              void read();
              timer = globalThis.setInterval(() => {
                void read();
              }, POLL_MS);
            }
            return () => {
              registry.delete(listener);
              if (registry.size !== 0) return;
              if (timer !== void 0) globalThis.clearInterval(timer);
              timer = void 0;
              epoch += 1;
              inflight = void 0;
              snapshot = { catalog: emptyCatalog(), status: "loading", settled: false, error: "" };
            };
          }
        },
        refresh: (next) => {
          void read(next);
        }
      };
    }
    function messageOf(error) {
      if (error instanceof Error) return error.message;
      if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
      return String(error);
    }

    // src/client/locales.ts
    var NS = "forum";
    var zh = {
      panel: "\u8BBA\u575B",
      panelSubtitle: "\u677F\u5757\u3001\u8BA8\u8BBA\u4E0E\u901A\u77E5\uFF0C\u90FD\u5728\u8FD9\u4E00\u9875\u3002",
      board: "\u677F\u5757",
      boards: "\u677F\u5757",
      posts: "\u5E16\u5B50",
      noBoards: "\u8FD8\u6CA1\u6709\u677F\u5757\u3002\u65B0\u5EFA\u4E00\u4E2A\u5DE5\u4F5C\u533A\uFF0C\u5237\u65B0\u540E\u5B83\u5C31\u4F1A\u6210\u4E3A\u65B0\u677F\u5757\u3002",
      noPosts: "\u8FD9\u4E2A\u677F\u5757\u8FD8\u6CA1\u6709\u5E16\u5B50\uFF0C\u6765\u53D1\u7B2C\u4E00\u6761\u3002",
      loading: "\u6B63\u5728\u8BFB\u53D6\u2026",
      failed: "\u8BFB\u53D6\u5931\u8D25",
      newPost: "\u53D1\u65B0\u5E16",
      newPostHint: "\u5199\u6E05\u695A\u6807\u9898\u4E0E\u6B63\u6587\uFF0C\u53D1\u5E03\u540E\u5373\u53EF\u5728\u677F\u5757\u4E2D\u770B\u5230\u3002",
      title: "\u6807\u9898",
      titlePlaceholder: "\u4E00\u53E5\u8BDD\u8BF4\u6E05\u8FD9\u5E16\u8BB2\u4EC0\u4E48",
      body: "\u6B63\u6587",
      bodyPlaceholder: "\u6B63\u6587\u91CC\u5199 @\u9884\u8BBE\u540D \u5C31\u80FD\u901A\u77E5\u90A3\u4E2A\u9884\u8BBE",
      tags: "\u6807\u7B7E",
      tagsPlaceholder: "\u7528\u9017\u53F7\u5206\u9694\uFF0C\u4F8B\u5982\uFF1A\u95F2\u804A, \u8FDB\u5C55",
      publish: "\u53D1\u5E03",
      cancel: "\u53D6\u6D88",
      author: "\u697C\u4E3B",
      actingAs: "\u4EE5\u8C01\u7684\u8EAB\u4EFD",
      search: "\u641C\u7D22",
      searchPlaceholder: "\u641C\u7D22\u6807\u9898 / \u6B63\u6587 / \u6807\u7B7E / \u4F5C\u8005",
      tag: "\u6807\u7B7E\u7B5B\u9009",
      allTags: "\u5168\u90E8\u6807\u7B7E",
      sortHeat: "\u70ED\u5EA6",
      sortNew: "\u6700\u65B0",
      sortViews: "\u6D4F\u89C8\u91CF",
      views: "\u6D4F\u89C8",
      comments: "\u8BC4\u8BBA",
      upvote: "\u8D5E",
      downvote: "\u8E29",
      pin: "\u7F6E\u9876",
      unpin: "\u53D6\u6D88\u7F6E\u9876",
      pinned: "\u5DF2\u7F6E\u9876",
      back: "\u8FD4\u56DE\u5217\u8868",
      reply: "\u56DE\u590D",
      writeReply: "\u5199\u4E0B\u4F60\u7684\u56DE\u590D",
      replyPlaceholder: "\u56DE\u590D\u91CC\u540C\u6837\u53EF\u4EE5\u7528 @\u9884\u8BBE\u540D",
      send: "\u53D1\u9001",
      expand: "\u5C55\u5F00\u5168\u6587",
      collapse: "\u6536\u8D77",
      notifyInbox: "\u7559\u5728\u5BF9\u65B9\u6536\u4EF6\u7BB1\uFF08\u4E0D\u5524\u9192\uFF09",
      notifyWake: "\u7ACB\u5373\u901A\u77E5\u5BF9\u65B9\u4F1A\u8BDD\uFF08\u4F1A\u5524\u9192\uFF09",
      notifyInboxShort: "\u7559\u5728\u6536\u4EF6\u7BB1",
      notifyWakeShort: "\u7ACB\u5373\u901A\u77E5",
      notifications: "\u6211\u7684\u901A\u77E5",
      notificationsHint: "\u6709\u4EBA @ \u4F60\u6216\u56DE\u590D\u4F60\u65F6\uFF0C\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
      readNotifications: "\u8BFB\u53D6\u901A\u77E5",
      refreshNotifications: "\u5237\u65B0\u901A\u77E5",
      noNotifications: "\u6CA1\u6709\u901A\u77E5\u3002",
      markAllRead: "\u5168\u90E8\u6807\u4E3A\u5DF2\u8BFB",
      replyingTo: "\u56DE\u590D",
      autoPost: "\u81EA\u52A8\u53D1\u5E16",
      autoPostHint: "\u9ED8\u8BA4\u5168\u90E8\u5173\u95ED\u3002\u6253\u5F00\u67D0\u4E2A\u9884\u8BBE\u540E\uFF0C\u5B83\u624D\u4F1A\u81EA\u5DF1\u53D1\u5E16\uFF1B\u8FD9\u91CC\u7684\u6BCF\u4E00\u6B21\u5F00\u5173\u90FD\u53EA\u5F71\u54CD\u5B83\u81EA\u5DF1\u3002",
      autoPostRunning: "\u8FD0\u884C\u4E2D",
      autoPostStopped: "\u5DF2\u505C\u6B62",
      enabled: "\u5DF2\u5F00\u542F",
      disabled: "\u5DF2\u5173\u95ED",
      everyMinutes: "\u95F4\u9694\uFF08\u5206\u949F\uFF09",
      lastAt: "\u4E0A\u6B21\u81EA\u52A8\u53D1\u5E16",
      never: "\u4ECE\u672A",
      save: "\u4FDD\u5B58",
      read: "\u5DF2\u8BFB",
      unread: "\u672A\u8BFB",
      mentionsYou: "\u63D0\u5230\u4E86\u4F60",
      repliedYou: "\u56DE\u590D\u4E86\u4F60",
      workspaces: "\u4E2A\u5DE5\u4F5C\u533A",
      emptyTitle: "\u8FD9\u91CC\u8FD8\u6CA1\u6709\u5E16\u5B50",
      emptyBody: "\u53D1\u7B2C\u4E00\u7BC7\u5E16\u5B50\uFF0C\u5F00\u542F\u8FD9\u4E2A\u677F\u5757\u7684\u8BA8\u8BBA\u3002",
      emptyCta: "\u53D1\u7B2C\u4E00\u7BC7\u5E16\u5B50",
      noReplies: "\u8FD8\u6CA1\u6709\u56DE\u590D\uFF0C\u6765\u5199\u7B2C\u4E00\u6761\u3002",
      originalPoster: "\u697C\u4E3B",
      pickBoard: "\u9009\u62E9\u677F\u5757",
      close: "\u5173\u95ED",
      retry: "\u91CD\u8BD5",
      notifyMethod: "\u901A\u77E5\u65B9\u5F0F",
      replyBody: "\u56DE\u590D\u5185\u5BB9",
      sort: "\u6392\u5E8F",
      config: "\u914D\u7F6E",
      configSubtitle: "\u901A\u77E5\u4E0E\u81EA\u52A8\u53D1\u5E16\u8BBE\u7F6E\uFF0C\u53EA\u5F71\u54CD\u5F53\u524D\u8EAB\u4EFD\u3002",
      toastPublished: "\u53D1\u5E03\u6210\u529F",
      toastComment: "\u56DE\u590D\u5DF2\u53D1\u9001",
      toastPinned: "\u5DF2\u7F6E\u9876",
      toastUnpinned: "\u5DF2\u53D6\u6D88\u7F6E\u9876",
      toastVoted: "\u6295\u7968\u5DF2\u8BB0\u5F55",
      toastVoteCleared: "\u5DF2\u53D6\u6D88\u6295\u7968",
      toastSaved: "\u81EA\u52A8\u53D1\u5E16\u8BBE\u7F6E\u5DF2\u4FDD\u5B58",
      toastMarkedRead: "\u5DF2\u5168\u90E8\u6807\u4E3A\u5DF2\u8BFB",
      toastInbox: "\u901A\u77E5\u5DF2\u5237\u65B0",
      toastError: "\u64CD\u4F5C\u5931\u8D25"
    };
    var en = {
      panel: "Forum",
      panelSubtitle: "Boards, threads and mentions in one place.",
      board: "Board",
      boards: "Boards",
      posts: "Posts",
      noBoards: "No board yet. Create a workspace and refresh: it becomes a new board.",
      noPosts: "This board has no post yet. Write the first one.",
      loading: "Loading\u2026",
      failed: "Could not read",
      newPost: "New post",
      newPostHint: "Give it a clear title and body \u2014 it shows up on the board right after publishing.",
      title: "Title",
      titlePlaceholder: "One line saying what this post is about",
      body: "Body",
      bodyPlaceholder: "Write @preset in the body to notify that preset",
      tags: "Tags",
      tagsPlaceholder: "Comma separated, for example: chat, progress",
      publish: "Publish",
      cancel: "Cancel",
      author: "Author",
      actingAs: "Acting as",
      search: "Search",
      searchPlaceholder: "Search title / body / tags / author",
      tag: "Tag filter",
      allTags: "All tags",
      sortHeat: "Heat",
      sortNew: "Newest",
      sortViews: "Most viewed",
      views: "views",
      comments: "comments",
      upvote: "Upvote",
      downvote: "Downvote",
      pin: "Pin",
      unpin: "Unpin",
      pinned: "Pinned",
      back: "Back to list",
      reply: "Reply",
      writeReply: "Write your reply",
      replyPlaceholder: "Replies accept @preset mentions too",
      send: "Send",
      expand: "Show all",
      collapse: "Collapse",
      notifyInbox: "Leave it in their inbox (no wake)",
      notifyWake: "Notify their live session now (wakes it)",
      notifyInboxShort: "Inbox only",
      notifyWakeShort: "Notify now",
      notifications: "My notifications",
      notificationsHint: "Mentions and replies to you land here.",
      readNotifications: "Load notifications",
      refreshNotifications: "Refresh notifications",
      noNotifications: "No notification.",
      markAllRead: "Mark all read",
      replyingTo: "Replying to",
      autoPost: "Auto-posting",
      autoPostHint: "Off by default. A preset posts by itself only after you switch it on; each switch affects that preset alone.",
      autoPostRunning: "Running",
      autoPostStopped: "Stopped",
      enabled: "On",
      disabled: "Off",
      everyMinutes: "Interval (minutes)",
      lastAt: "Last automatic post",
      never: "Never",
      save: "Save",
      read: "Read",
      unread: "Unread",
      mentionsYou: "mentioned you",
      repliedYou: "replied to you",
      workspaces: "workspace(s)",
      emptyTitle: "No posts here yet",
      emptyBody: "Write the first post and start this board\u2019s conversation.",
      emptyCta: "Write the first post",
      noReplies: "No reply yet. Be the first.",
      originalPoster: "OP",
      pickBoard: "Choose a board",
      close: "Close",
      retry: "Retry",
      notifyMethod: "Notification",
      replyBody: "Your reply",
      sort: "Sort",
      config: "Settings",
      configSubtitle: "Notifications and auto-posting, for the acting identity only.",
      toastPublished: "Post published",
      toastComment: "Reply sent",
      toastPinned: "Pinned",
      toastUnpinned: "Unpinned",
      toastVoted: "Vote recorded",
      toastVoteCleared: "Vote cleared",
      toastSaved: "Auto-post settings saved",
      toastMarkedRead: "All notifications marked read",
      toastInbox: "Notifications refreshed",
      toastError: "Action failed"
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
    var POST_SORTS = ["heat", "new", "views"];
    var BOARD_SCHEMA = import_zod.z.looseObject({
      id: import_zod.z.string(),
      path: import_zod.z.string(),
      title: import_zod.z.string(),
      postCount: import_zod.z.number()
    });
    var PERSON_SCHEMA = import_zod.z.looseObject({ name: import_zod.z.string(), autoPost: import_zod.z.boolean() });
    var POST_SCHEMA = import_zod.z.looseObject({
      id: import_zod.z.string(),
      boardId: import_zod.z.string(),
      author: import_zod.z.string(),
      title: import_zod.z.string(),
      excerpt: import_zod.z.string(),
      views: import_zod.z.number(),
      up: import_zod.z.number(),
      down: import_zod.z.number(),
      commentCount: import_zod.z.number(),
      pinned: import_zod.z.boolean()
    });
    var COMMENT_SCHEMA = import_zod.z.lazy(() => import_zod.z.looseObject({
      id: import_zod.z.string(),
      author: import_zod.z.string(),
      body: import_zod.z.string(),
      depth: import_zod.z.number(),
      up: import_zod.z.number(),
      down: import_zod.z.number(),
      createdAt: import_zod.z.string(),
      replies: import_zod.z.array(COMMENT_SCHEMA)
    }));
    var DELIVERY_SCHEMA = import_zod.z.looseObject({
      id: import_zod.z.string(),
      recipient: import_zod.z.string(),
      status: import_zod.z.union([import_zod.z.literal("woken"), import_zod.z.literal("inboxed")])
    });
    var CATALOG_SCHEMA = import_zod.z.looseObject({
      boards: import_zod.z.array(BOARD_SCHEMA),
      posts: import_zod.z.array(POST_SCHEMA),
      people: import_zod.z.array(PERSON_SCHEMA)
    });
    var DETAIL_SCHEMA = import_zod.z.looseObject({
      post: POST_SCHEMA,
      body: import_zod.z.string(),
      comments: import_zod.z.array(COMMENT_SCHEMA)
    });
    var WRITE_SCHEMA = import_zod.z.looseObject({
      value: import_zod.z.looseObject({ id: import_zod.z.string() }),
      deliveries: import_zod.z.array(DELIVERY_SCHEMA)
    });
    var PUBLISH_SCHEMA = import_zod.z.looseObject({
      value: import_zod.z.looseObject({ id: import_zod.z.string() }),
      deliveries: import_zod.z.array(DELIVERY_SCHEMA)
    });
    var VOTE_SCHEMA = import_zod.z.looseObject({ up: import_zod.z.number(), down: import_zod.z.number(), cleared: import_zod.z.boolean() });
    var NOTIFICATION_SCHEMA = import_zod.z.looseObject({
      id: import_zod.z.string(),
      recipient: import_zod.z.string(),
      author: import_zod.z.string(),
      summary: import_zod.z.string(),
      state: import_zod.z.string()
    });
    var AUTO_POST_SCHEMA = import_zod.z.looseObject({
      running: import_zod.z.boolean(),
      tickSeconds: import_zod.z.number(),
      maxPerHour: import_zod.z.number(),
      settings: import_zod.z.array(import_zod.z.looseObject({ preset: import_zod.z.string(), enabled: import_zod.z.boolean(), everyMinutes: import_zod.z.number() }))
    });
    var BOARD_REF_SCHEMA = import_zod.z.looseObject({ id: import_zod.z.string(), title: import_zod.z.string() });
    var CATALOG_REQUEST = import_zod.z.looseObject({
      boardId: import_zod.z.string().optional(),
      query: import_zod.z.string().optional(),
      tag: import_zod.z.string().optional(),
      sort: import_zod.z.string().optional()
    });
    var POST_REQUEST = import_zod.z.looseObject({ postId: import_zod.z.string(), reader: import_zod.z.string().optional() });
    var PUBLISH_REQUEST = import_zod.z.looseObject({
      boardId: import_zod.z.string(),
      author: import_zod.z.string(),
      title: import_zod.z.string(),
      body: import_zod.z.string(),
      tags: import_zod.z.array(import_zod.z.string()).optional(),
      notifyMode: import_zod.z.string().optional()
    });
    var COMMENT_REQUEST = import_zod.z.looseObject({
      postId: import_zod.z.string(),
      parentCommentId: import_zod.z.string().optional(),
      author: import_zod.z.string(),
      body: import_zod.z.string(),
      notifyMode: import_zod.z.string().optional()
    });
    var VOTE_REQUEST = import_zod.z.looseObject({
      subjectKind: import_zod.z.string(),
      subjectId: import_zod.z.string(),
      actor: import_zod.z.string(),
      value: import_zod.z.string()
    });
    var PIN_REQUEST = import_zod.z.looseObject({ postId: import_zod.z.string(), pinned: import_zod.z.boolean(), reader: import_zod.z.string().optional() });
    var INBOX_REQUEST = import_zod.z.looseObject({ recipient: import_zod.z.string(), state: import_zod.z.string().optional() });
    var MARK_REQUEST = import_zod.z.looseObject({ recipient: import_zod.z.string(), id: import_zod.z.string().optional(), all: import_zod.z.boolean().optional() });
    var AUTO_POST_REQUEST = import_zod.z.looseObject({
      settings: import_zod.z.array(import_zod.z.looseObject({
        preset: import_zod.z.string(),
        enabled: import_zod.z.boolean(),
        everyMinutes: import_zod.z.number()
      })).optional()
    });
    var BOARD_REQUEST = import_zod.z.looseObject({ workspaceId: import_zod.z.string(), path: import_zod.z.string() });
    var SERVICE = "forum";
    function codec(typeSymbol, create) {
      return { mode: "strict", typeSymbol, create };
    }
    function parameter(name, typeSymbol, create) {
      const spec = codec(typeSymbol, create);
      return { name, wire: name, source: "json", codec: spec, strictCodec: spec };
    }
    function method(exportName, description, typeSymbol, parameters, result) {
      return {
        [`forum/${exportName}`]: {
          service: SERVICE,
          description,
          invocation: { kind: "direct" },
          parameters: [...parameters],
          result: codec(`forum:${typeSymbol}:result`, result)
        }
      };
    }
    var forumRemote = createTypertRemoteInfo({
      package: "@veren/forum",
      methods: {
        ...method("catalog", "Read one board\u2019s posts plus the board list and the known presets.", "catalog", [
          parameter("request", "forum:catalog:request", () => CATALOG_REQUEST)
        ], () => CATALOG_SCHEMA),
        ...method("post", "Read one post with its comment tree, counting one view.", "post", [
          parameter("request", "forum:post:request", () => POST_REQUEST)
        ], () => DETAIL_SCHEMA),
        ...method("publish", "Publish one post and notify the presets it mentions.", "publish", [
          parameter("request", "forum:publish:request", () => PUBLISH_REQUEST)
        ], () => PUBLISH_SCHEMA),
        ...method("comment", "Write one comment or reply and notify the parent\u2019s author.", "comment", [
          parameter("request", "forum:comment:request", () => COMMENT_REQUEST)
        ], () => WRITE_SCHEMA),
        ...method("vote", "Record one preset\u2019s attitude toward one post or comment.", "vote", [
          parameter("request", "forum:vote:request", () => VOTE_REQUEST)
        ], () => VOTE_SCHEMA),
        ...method("pin", "Pin or unpin one post.", "pin", [
          parameter("request", "forum:pin:request", () => PIN_REQUEST)
        ], () => POST_SCHEMA),
        ...method("inbox", "Read one preset\u2019s notifications.", "inbox", [
          parameter("request", "forum:inbox:request", () => INBOX_REQUEST)
        ], () => import_zod.z.array(NOTIFICATION_SCHEMA)),
        ...method("markRead", "Mark one notification, or a whole inbox, read.", "markRead", [
          parameter("request", "forum:markRead:request", () => MARK_REQUEST)
        ], () => import_zod.z.looseObject({ changed: import_zod.z.number() })),
        ...method("autoPost", "Read or replace the per-preset auto-post settings.", "autoPost", [
          parameter("request", "forum:autoPost:request", () => AUTO_POST_REQUEST)
        ], () => AUTO_POST_SCHEMA),
        ...method("ensureBoard", "Register one workspace as a board.", "ensureBoard", [
          parameter("request", "forum:ensureBoard:request", () => BOARD_REQUEST)
        ], () => BOARD_REF_SCHEMA)
      }
    }, import_zod.z);

    // src/client/panel.tsx
    var import_jsx_runtime = require("react/jsx-runtime");
    function ForumPanel(props) {
      const catalog = props.useCatalog((state) => state);
      const autoPost = props.useAutoPost((state) => state);
      const workspaces = props.useWorkspaces((state) => state.items);
      const body = {
        t: props.t,
        catalog,
        autoPost,
        workspaces,
        useWorkspaces: props.useWorkspaces,
        actions: props,
        refresh: props.onRefresh
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ForumBody, { ...body });
    }
    function ForumBody(props) {
      const { t, catalog, autoPost, workspaces, actions, refresh } = props;
      const [boardId, setBoardId] = (0, import_react.useState)(void 0);
      const [query, setQuery] = (0, import_react.useState)("");
      const [tag, setTag] = (0, import_react.useState)("");
      const [sort, setSort] = (0, import_react.useState)("heat");
      const [actor, setActor] = (0, import_react.useState)(void 0);
      const [open, setOpen] = (0, import_react.useState)(void 0);
      const [busy, setBusy] = (0, import_react.useState)(false);
      const [error, setError] = (0, import_react.useState)("");
      const [inbox, setInbox] = (0, import_react.useState)([]);
      const [inboxLoaded, setInboxLoaded] = (0, import_react.useState)(false);
      const [localVotes, setLocalVotes] = (0, import_react.useState)({});
      const [composerOpen, setComposerOpen] = (0, import_react.useState)(false);
      const [configOpen, setConfigOpen] = (0, import_react.useState)(false);
      const { toasts, push } = useToasts();
      const view = catalog.catalog;
      const people = view.people;
      const active = actor ?? people[0]?.name;
      const shownBoard = boardId ?? view.boardId;
      const boardTitle = view.boards.find((board) => board.id === shownBoard)?.title;
      (0, import_react.useEffect)(() => {
        setLocalVotes({});
        setInbox([]);
        setInboxLoaded(false);
      }, [active]);
      const boardFilter = shownBoard === void 0 ? {} : { boardId: shownBoard };
      const voteOf = (kind, id, fallback) => localVotes[`${kind}:${id}`] ?? fallback;
      const ensureBoard = actions.onEnsureBoard;
      const workspaceKey = workspaces.map((workspace) => `${workspace.workspaceId}\0${workspace.path}`).join("");
      (0, import_react.useEffect)(() => {
        let cancelled = false;
        void (async () => {
          for (const workspace of workspaces) {
            try {
              await ensureBoard(workspace.workspaceId, workspace.path);
            } catch {
            }
            if (cancelled) return;
          }
          if (!cancelled) refresh();
        })();
        return () => {
          cancelled = true;
        };
      }, [workspaceKey, ensureBoard, refresh, workspaces]);
      const reload = () => {
        refresh({ ...boardFilter, query, tag, sort });
      };
      const run = async (work, success) => {
        setBusy(true);
        setError("");
        try {
          await work();
          if (success !== void 0) push("success", success);
          return true;
        } catch (cause) {
          const message = messageOf2(cause);
          setError(message);
          push("error", `${t("toastError")}: ${message}`);
          return false;
        } finally {
          setBusy(false);
        }
      };
      const openPost = (postId) => {
        void (async () => {
          setBusy(true);
          try {
            setOpen(await actions.onOpenPost(postId));
          } catch (cause) {
            push("error", `${t("toastError")}: ${messageOf2(cause)}`);
          } finally {
            setBusy(false);
          }
        })();
      };
      const reread = async () => {
        if (open === void 0) return;
        setOpen(await actions.onOpenPost(open.post.id));
      };
      const vote = (kind, id, value, current) => {
        if (active === void 0) return;
        const key = `${kind}:${id}`;
        const previous = voteOf(kind, id, current);
        const clearing = previous === value;
        void run(async () => {
          await actions.onVote({ subjectKind: kind, subjectId: id, actor: active, value });
          setLocalVotes((votes) => {
            const next = { ...votes };
            if (clearing) delete next[key];
            else next[key] = value;
            return next;
          });
          await reread();
          reload();
        }, clearing ? t("toastVoteCleared") : t("toastVoted"));
      };
      const pin = (postId, pinned, inThread) => {
        void run(async () => {
          await actions.onPin({
            postId,
            pinned,
            ...active === void 0 ? {} : { reader: active }
          });
          if (inThread) await reread();
          reload();
        }, pinned ? t("toastPinned") : t("toastUnpinned"));
      };
      const publish = async (input) => {
        const ok = await run(async () => {
          await actions.onPublish(input);
          setBoardId(input.boardId);
          refresh({ boardId: input.boardId, query, tag, sort });
        }, t("toastPublished"));
        if (ok) setComposerOpen(false);
        return ok;
      };
      const comment = async (input) => {
        return run(async () => {
          await actions.onComment(input);
          await reread();
          reload();
        }, t("toastComment"));
      };
      const readInbox = () => {
        if (active === void 0) return;
        void run(async () => {
          setInbox(await actions.onReadInbox(active));
          setInboxLoaded(true);
        }, t("toastInbox"));
      };
      const markAllRead = () => {
        if (active === void 0) return;
        void run(async () => {
          await actions.onMarkAllRead(active);
          setInbox([]);
          setInboxLoaded(true);
        }, t("toastMarkedRead"));
      };
      const saveAutoPost = async (settings) => {
        return run(async () => {
          await actions.onSaveAutoPost(settings);
          reload();
        }, t("toastSaved"));
      };
      const openComposer = () => {
        setError("");
        setComposerOpen(true);
      };
      const selectBoard = (id) => {
        setBoardId(id);
        setOpen(void 0);
        refresh({ boardId: id, query, tag, sort });
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-page", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "forum-header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-heading", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-heading-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-mark", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChatIcon, {}) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: t("panel") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("panelSubtitle") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-header-actions", children: [
            people.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "forum-actor", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("actingAs") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "select",
                {
                  value: active ?? "",
                  "aria-label": t("actingAs"),
                  onChange: (event) => {
                    setActor(event.target.value);
                  },
                  children: people.map((person) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: person.name, children: person.name }, person.name))
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "button",
              {
                type: "button",
                className: configOpen ? "forum-btn forum-primary forum-cta" : "forum-btn forum-cta",
                "aria-pressed": configOpen,
                onClick: () => {
                  setConfigOpen(!configOpen);
                  setOpen(void 0);
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GearIcon, {}),
                  t("config")
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "forum-btn forum-primary forum-cta", onClick: openComposer, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PlusIcon, {}),
              t("newPost")
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", { className: "forum-boardbar", "aria-label": t("boards"), children: view.boards.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-boardbar-empty", children: t("noBoards") }) : view.boards.map((board) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            className: "forum-pill",
            "aria-selected": board.id === shownBoard,
            onClick: () => {
              selectBoard(board.id);
            },
            children: [
              board.title,
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-pill-count", children: board.postCount })
            ]
          },
          board.id
        )) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "forum-layout", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", { className: "forum-main", children: [
          catalog.status === "error" && !configOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-banner", role: "alert", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
              t("failed"),
              ": ",
              catalog.error
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "forum-link", onClick: () => {
              refresh();
            }, children: t("retry") })
          ] }),
          configOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            SettingsPage,
            {
              t,
              inbox,
              inboxLoaded,
              attached: active !== void 0,
              readOnly: busy,
              autoPost,
              onRead: readInbox,
              onMarkAllRead: markAllRead,
              onSave: saveAutoPost,
              onBack: () => {
                setConfigOpen(false);
              }
            }
          ) : open === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            Feed,
            {
              t,
              catalog,
              posts: view.posts,
              boardTitle,
              actor: active,
              readOnly: busy,
              query,
              tag,
              sort,
              onQuery: (value) => {
                setQuery(value);
                refresh({ ...boardFilter, query: value, tag, sort });
              },
              onTag: (value) => {
                setTag(value);
                refresh({ ...boardFilter, query, tag: value, sort });
              },
              onSort: (value) => {
                setSort(value);
                refresh({ ...boardFilter, query, tag, sort: value });
              },
              onOpenPost: openPost,
              onVote: vote,
              voteOf,
              onPin: (postId, pinned) => {
                pin(postId, pinned, false);
              },
              onCreate: openComposer
            }
          ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            Thread,
            {
              t,
              detail: open,
              actor: active,
              readOnly: busy,
              onBack: () => {
                setOpen(void 0);
                reload();
              },
              onVote: vote,
              voteOf,
              onPin: (postId, pinned) => {
                pin(postId, pinned, true);
              },
              onComment: comment
            }
          )
        ] }) }),
        composerOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          ComposerModal,
          {
            t,
            boards: view.boards,
            people,
            actor: active,
            defaultBoard: shownBoard,
            readOnly: busy,
            error,
            onActor: setActor,
            onClose: () => {
              setComposerOpen(false);
            },
            onSubmit: publish
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToastStack, { toasts })
      ] });
    }
    function Feed(props) {
      const { t, catalog, posts, actor, readOnly } = props;
      const tags = (0, import_react.useMemo)(() => tagOptions(catalog), [catalog]);
      const loading = catalog.status === "loading" && !catalog.settled;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-toolbar", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-search", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SearchIcon, {}),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "forum-input",
                value: props.query,
                placeholder: t("searchPlaceholder"),
                "aria-label": t("search"),
                onChange: (event) => {
                  props.onQuery(event.target.value);
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "select",
            {
              className: "forum-select",
              value: props.tag,
              "aria-label": t("tag"),
              onChange: (event) => {
                props.onTag(event.target.value);
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: t("allTags") }),
                tags.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value, children: value }, value))
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "select",
            {
              className: "forum-select",
              value: props.sort,
              "aria-label": t("sort"),
              onChange: (event) => {
                props.onSort(event.target.value);
              },
              children: POST_SORTS.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value, children: value === "heat" ? t("sortHeat") : value === "new" ? t("sortNew") : t("sortViews") }, value))
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "forum-feed-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { className: "forum-feed-title", children: [
          props.boardTitle ?? t("posts"),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-count", children: posts.length }),
          catalog.status === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-live", children: t("loading") })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "forum-feed", children: loading ? [0, 1, 2].map((index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "forum-skeleton", "aria-hidden": "true" }, index)) : posts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-empty", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-empty-icon", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChatIcon, {}) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: catalog.catalog.boards.length === 0 ? t("noBoards") : t("emptyTitle") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: catalog.catalog.boards.length === 0 ? t("notificationsHint") : t("emptyBody") }),
          catalog.catalog.boards.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "forum-btn forum-primary", onClick: props.onCreate, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PlusIcon, {}),
            t("emptyCta")
          ] })
        ] }) : posts.map((post) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          PostCard,
          {
            t,
            post,
            actor,
            readOnly,
            myVote: props.voteOf("post", post.id, post.myVote),
            onOpenPost: props.onOpenPost,
            onVote: props.onVote,
            onPin: props.onPin
          },
          post.id
        )) })
      ] });
    }
    function PostCard(props) {
      const { t, post, actor, readOnly } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: post.pinned ? "forum-card forum-post is-pinned" : "forum-card forum-post", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-post-top", children: [
          post.pinned && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-chip is-warn", children: t("pinned") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "forum-post-title", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "forum-post-link", onClick: () => {
            props.onOpenPost(post.id);
          }, children: post.title }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-post-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-avatar", "aria-hidden": "true", children: initial(post.author) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-post-author", children: post.author }),
          post.tags.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-dot", children: "\xB7" }),
          post.tags.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-chip", children: value }, value))
        ] }),
        post.excerpt !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "forum-post-excerpt", children: post.excerpt }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-post-foot", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "forum-vote-group", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            VoteButtons,
            {
              t,
              up: post.up,
              down: post.down,
              myVote: props.myVote,
              disabled: readOnly || actor === void 0,
              onVote: (value) => {
                props.onVote("post", post.id, value, props.myVote);
              }
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "forum-stat", children: [
            post.views,
            " ",
            t("views")
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-dot", children: "\xB7" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "forum-stat", children: [
            post.commentCount,
            " ",
            t("comments")
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-post-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "forum-btn forum-ghost",
                disabled: readOnly,
                onClick: () => {
                  props.onPin(post.id, !post.pinned);
                },
                children: post.pinned ? t("unpin") : t("pin")
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "forum-btn",
                onClick: () => {
                  props.onOpenPost(post.id);
                },
                children: t("reply")
              }
            )
          ] })
        ] })
      ] });
    }
    function ComposerModal(props) {
      const { t, boards, actor, onActor, onClose, onSubmit, readOnly, error } = props;
      const [title, setTitle] = (0, import_react.useState)("");
      const [body, setBody] = (0, import_react.useState)("");
      const [tags, setTags] = (0, import_react.useState)("");
      const [notify, setNotify] = (0, import_react.useState)("inbox");
      const [board, setBoard] = (0, import_react.useState)(props.defaultBoard ?? boards[0]?.id ?? "");
      const [pending, setPending] = (0, import_react.useState)(false);
      const canSubmit = !readOnly && !pending && actor !== void 0 && board !== "" && title.trim() !== "";
      const submit = (event) => {
        event.preventDefault();
        if (!canSubmit || actor === void 0) return;
        setPending(true);
        void onSubmit({ boardId: board, author: actor, title, body, tags: splitTags(tags), notifyMode: notify }).finally(() => {
          setPending(false);
        });
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Modal, { title: t("newPost"), subtitle: t("newPostHint"), closeLabel: t("close"), onClose, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "forum-form", onSubmit: submit, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-modal-body", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "forum-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-label", children: t("title") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "forum-input",
                value: title,
                autoFocus: true,
                "aria-label": t("title"),
                placeholder: t("titlePlaceholder"),
                onChange: (event) => {
                  setTitle(event.target.value);
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "forum-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-label", children: t("body") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "textarea",
              {
                className: "forum-textarea",
                value: body,
                rows: 7,
                "aria-label": t("body"),
                placeholder: t("bodyPlaceholder"),
                onChange: (event) => {
                  setBody(event.target.value);
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-two", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "forum-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-label", children: t("board") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { className: "forum-select", value: board, onChange: (event) => {
                setBoard(event.target.value);
              }, children: [
                boards.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: t("pickBoard") }),
                boards.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: value.id, children: value.title }, value.id))
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "forum-field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-label", children: t("actingAs") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", { className: "forum-select", value: actor ?? "", onChange: (event) => {
                onActor(event.target.value);
              }, children: props.people.map((person) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: person.name, children: person.name }, person.name)) })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "forum-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-label", children: t("tags") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "forum-input",
                value: tags,
                placeholder: t("tagsPlaceholder"),
                onChange: (event) => {
                  setTags(event.target.value);
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-label", children: t("notifyMethod") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-seg", role: "group", "aria-label": t("notifyMethod"), children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  type: "button",
                  className: "forum-seg-btn",
                  "aria-pressed": notify === "inbox",
                  onClick: () => {
                    setNotify("inbox");
                  },
                  children: t("notifyInboxShort")
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  type: "button",
                  className: "forum-seg-btn",
                  "aria-pressed": notify === "wake",
                  onClick: () => {
                    setNotify("wake");
                  },
                  children: t("notifyWakeShort")
                }
              )
            ] })
          ] }),
          error !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "forum-form-error", role: "alert", children: error })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-modal-foot", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "forum-btn forum-ghost", onClick: onClose, children: t("cancel") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", className: "forum-btn forum-primary", disabled: !canSubmit, children: t("publish") })
          ] })
        ] })
      ] }) });
    }
    function Thread(props) {
      const { t, detail, actor, readOnly, onBack, onVote, onPin, onComment } = props;
      const [replyTo, setReplyTo] = (0, import_react.useState)(void 0);
      const total = countComments(detail.comments);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-thread", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "forum-btn forum-ghost forum-back", onClick: onBack, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowLeftIcon, {}),
          t("back")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "forum-card forum-thread-card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-thread-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: detail.post.title }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  type: "button",
                  className: "forum-btn forum-ghost",
                  disabled: readOnly,
                  onClick: () => {
                    onPin(detail.post.id, !detail.post.pinned);
                  },
                  children: detail.post.pinned ? t("unpin") : t("pin")
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  type: "button",
                  className: "forum-btn forum-primary",
                  disabled: actor === void 0,
                  onClick: () => {
                    setReplyTo({});
                  },
                  children: t("reply")
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-post-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-avatar", "aria-hidden": "true", children: initial(detail.post.author) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-post-author", children: detail.post.author }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-dot", children: "\xB7" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "forum-stat", children: [
              detail.post.views,
              " ",
              t("views")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-dot", children: "\xB7" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "forum-stat", children: [
              total,
              " ",
              t("comments")
            ] }),
            detail.post.pinned && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-chip is-warn", children: t("pinned") }),
            detail.post.tags.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-dot", children: "\xB7" }),
            detail.post.tags.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-chip", children: value }, value))
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "forum-thread-body", children: detail.body }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "forum-thread-foot", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            VoteButtons,
            {
              t,
              up: detail.post.up,
              down: detail.post.down,
              myVote: props.voteOf("post", detail.post.id, detail.post.myVote),
              disabled: readOnly || actor === void 0,
              onVote: (value) => {
                onVote("post", detail.post.id, value, props.voteOf("post", detail.post.id, detail.post.myVote));
              }
            }
          ) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "forum-comments", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "forum-section-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { children: [
            t("comments"),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-count", children: total })
          ] }) }),
          detail.comments.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-empty forum-empty-sm", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t("noReplies") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "forum-btn",
                disabled: actor === void 0,
                onClick: () => {
                  setReplyTo({});
                },
                children: t("writeReply")
              }
            )
          ] }) : detail.comments.map((comment) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            CommentCard,
            {
              t,
              comment,
              actor,
              busy: readOnly,
              postAuthor: detail.post.author,
              voteOf: props.voteOf,
              onReply: (target) => {
                setReplyTo(target);
              },
              onVote
            },
            comment.id
          ))
        ] }),
        replyTo !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          ReplyModal,
          {
            t,
            author: replyTo.author,
            actor,
            readOnly,
            onClose: () => {
              setReplyTo(void 0);
            },
            onSubmit: async (body, notify) => {
              const target = replyTo.commentId;
              const ok = await onComment({
                postId: detail.post.id,
                author: actor ?? "",
                body,
                notifyMode: notify,
                ...target === void 0 ? {} : { parentCommentId: target }
              });
              return ok;
            }
          }
        )
      ] });
    }
    function CommentCard(props) {
      const { t, comment, actor, busy, postAuthor, onReply, onVote } = props;
      const [expanded, setExpanded] = (0, import_react.useState)(false);
      const folded = comment.foldable && !expanded;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: comment.depth > 1 ? "forum-card forum-comment is-nested" : "forum-card forum-comment", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-comment-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-avatar", "aria-hidden": "true", children: initial(comment.author) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: comment.author }),
          comment.author === postAuthor && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-chip is-accent", children: t("originalPoster") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "forum-body", children: folded ? `${comment.body.slice(0, 200)}\u2026` : comment.body }),
        comment.foldable && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "forum-link", onClick: () => {
          setExpanded(!expanded);
        }, children: expanded ? t("collapse") : t("expand") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-post-foot", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            VoteButtons,
            {
              t,
              up: comment.up,
              down: comment.down,
              myVote: props.voteOf("comment", comment.id, comment.myVote),
              disabled: busy || actor === void 0,
              onVote: (value) => {
                onVote("comment", comment.id, value, props.voteOf("comment", comment.id, comment.myVote));
              }
            }
          ),
          comment.depth < 2 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "forum-post-actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "forum-btn forum-ghost",
              disabled: actor === void 0,
              onClick: () => {
                onReply({ commentId: comment.id, author: comment.author });
              },
              children: t("reply")
            }
          ) })
        ] }),
        comment.replies.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "forum-replies", children: comment.replies.map((reply) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          CommentCard,
          {
            t,
            comment: reply,
            actor,
            busy,
            postAuthor,
            voteOf: props.voteOf,
            onReply,
            onVote
          },
          reply.id
        )) })
      ] });
    }
    function ReplyModal(props) {
      const { t, author, actor, readOnly, onClose, onSubmit } = props;
      const [body, setBody] = (0, import_react.useState)("");
      const [notify, setNotify] = (0, import_react.useState)("inbox");
      const [error, setError] = (0, import_react.useState)("");
      const [pending, setPending] = (0, import_react.useState)(false);
      const canSubmit = !readOnly && !pending && actor !== void 0 && body.trim() !== "";
      const submit = (event) => {
        event.preventDefault();
        if (!canSubmit) return;
        setPending(true);
        void onSubmit(body, notify).then((ok) => {
          if (ok) onClose();
        }, (cause) => {
          setError(messageOf2(cause));
        }).finally(() => {
          setPending(false);
        });
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Modal,
        {
          title: author === void 0 ? t("writeReply") : `${t("replyingTo")} @${author}`,
          subtitle: t("replyPlaceholder"),
          closeLabel: t("close"),
          onClose,
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "forum-form", onSubmit: submit, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-modal-body", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "forum-field", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-label", children: t("replyBody") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "textarea",
                  {
                    className: "forum-textarea",
                    value: body,
                    rows: 5,
                    autoFocus: true,
                    "aria-label": t("replyBody"),
                    placeholder: t("replyPlaceholder"),
                    onChange: (event) => {
                      setBody(event.target.value);
                    }
                  }
                )
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-field", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-label", children: t("notifyMethod") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-seg", role: "group", "aria-label": t("notifyMethod"), children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      className: "forum-seg-btn",
                      "aria-pressed": notify === "inbox",
                      onClick: () => {
                        setNotify("inbox");
                      },
                      children: t("notifyInboxShort")
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      className: "forum-seg-btn",
                      "aria-pressed": notify === "wake",
                      onClick: () => {
                        setNotify("wake");
                      },
                      children: t("notifyWakeShort")
                    }
                  )
                ] })
              ] }),
              error !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "forum-form-error", role: "alert", children: error })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-modal-foot", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-actions", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "forum-btn forum-ghost", onClick: onClose, children: t("cancel") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", className: "forum-btn forum-primary", disabled: !canSubmit, children: t("send") })
              ] })
            ] })
          ] })
        }
      );
    }
    function VoteButtons(props) {
      const { t, up, down, myVote, disabled, onVote } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-vote-group", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            className: "forum-vote",
            "aria-pressed": myVote === "up",
            disabled,
            "aria-label": t("upvote"),
            onClick: () => {
              onVote("up");
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", children: "\u2191" }),
              " ",
              up
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            className: "forum-vote",
            "aria-pressed": myVote === "down",
            disabled,
            "aria-label": t("downvote"),
            onClick: () => {
              onVote("down");
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", children: "\u2193" }),
              " ",
              down
            ]
          }
        )
      ] });
    }
    function SettingsPage(props) {
      const { t } = props;
      const [notificationsOpen, setNotificationsOpen] = (0, import_react.useState)(true);
      const [autoPostOpen, setAutoPostOpen] = (0, import_react.useState)(true);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-config", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "forum-btn forum-ghost forum-back", onClick: props.onBack, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowLeftIcon, {}),
          t("back")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-config-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "forum-config-title", children: t("config") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "forum-config-subtitle", children: t("configSubtitle") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          NotificationsCard,
          {
            t,
            items: props.inbox,
            loaded: props.inboxLoaded,
            attached: props.attached,
            readOnly: props.readOnly,
            open: notificationsOpen,
            onToggle: () => {
              setNotificationsOpen(!notificationsOpen);
            },
            onRead: props.onRead,
            onMarkAllRead: props.onMarkAllRead
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          AutoPostCard,
          {
            t,
            snapshot: props.autoPost,
            readOnly: props.readOnly,
            open: autoPostOpen,
            onToggle: () => {
              setAutoPostOpen(!autoPostOpen);
            },
            onSave: props.onSave
          }
        )
      ] });
    }
    function NotificationsCard(props) {
      const { t, items, loaded, attached, readOnly, open, onToggle, onRead, onMarkAllRead } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "forum-side-card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "forum-card-head", "aria-expanded": open, onClick: onToggle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-card-title", children: t("notifications") }),
          items.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-count", children: items.length }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronIcon, {})
        ] }),
        open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-card-body", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "forum-btn forum-wide",
              disabled: !attached || readOnly,
              onClick: onRead,
              children: loaded ? t("refreshNotifications") : t("readNotifications")
            }
          ),
          items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "forum-side-hint", children: loaded ? t("noNotifications") : t("notificationsHint") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "forum-notif-list", children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-notif", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: item.summary }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-notif-meta", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: item.reason === "mention" ? "forum-reason" : "forum-reason is-reply", children: item.reason === "mention" ? t("mentionsYou") : t("repliedYou") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.state === "read" ? t("read") : t("unread") })
              ] })
            ] }, item.id)) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "forum-link forum-wide", onClick: onMarkAllRead, children: t("markAllRead") })
          ] })
        ] })
      ] });
    }
    function AutoPostCard(props) {
      const { t, snapshot, readOnly, open, onToggle, onSave } = props;
      const [drafts, setDrafts] = (0, import_react.useState)({});
      const [pending, setPending] = (0, import_react.useState)(false);
      const settings = snapshot.settings.map((setting) => drafts[setting.preset] ?? setting);
      const dirty = Object.keys(drafts).length > 0;
      const save = () => {
        setPending(true);
        void onSave(settings).then((ok) => {
          if (ok) setDrafts({});
        }).finally(() => {
          setPending(false);
        });
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "forum-side-card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "forum-card-head", "aria-expanded": open, onClick: onToggle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-card-title", children: t("autoPost") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: snapshot.running ? "forum-status is-on" : "forum-status", children: snapshot.running ? t("autoPostRunning") : t("autoPostStopped") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronIcon, {})
        ] }),
        open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-card-body", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "forum-side-hint", children: t("autoPostHint") }),
          settings.map((setting) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-auto-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "forum-switch", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  type: "checkbox",
                  checked: setting.enabled,
                  "aria-label": setting.preset,
                  onChange: (event) => {
                    setDrafts({ ...drafts, [setting.preset]: { ...setting, enabled: event.target.checked } });
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-switch-track", "aria-hidden": "true" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-auto-info", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-auto-name", children: setting.preset }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "forum-auto-note", children: [
                t("lastAt"),
                ": ",
                snapshot.lastAt[setting.preset] ?? t("never")
              ] }),
              snapshot.lastError[setting.preset] !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-form-error", children: snapshot.lastError[setting.preset] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "forum-input forum-auto-min",
                type: "number",
                min: 1,
                "aria-label": t("everyMinutes"),
                value: setting.everyMinutes,
                onChange: (event) => {
                  setDrafts({
                    ...drafts,
                    [setting.preset]: { ...setting, everyMinutes: Math.max(1, Number(event.target.value) || 1) }
                  });
                }
              }
            )
          ] }, setting.preset)),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "forum-btn forum-primary forum-wide",
              disabled: readOnly || pending || !dirty,
              onClick: save,
              children: t("save")
            }
          )
        ] })
      ] });
    }
    function Modal(props) {
      const { onClose } = props;
      (0, import_react.useEffect)(() => {
        const onKey = (event) => {
          if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => {
          document.removeEventListener("keydown", onKey);
        };
      }, [onClose]);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "div",
        {
          className: "forum-overlay",
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose();
          },
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "forum-modal", role: "dialog", "aria-modal": "true", "aria-label": props.title, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "forum-modal-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: props.title }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: props.subtitle })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "forum-icon-btn", "aria-label": props.closeLabel, onClick: onClose, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CloseIcon, {}) })
            ] }),
            props.children
          ] })
        }
      );
    }
    function ToastStack(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "forum-toasts", role: "status", "aria-live": "polite", children: props.toasts.map((toast) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: toast.kind === "success" ? "forum-toast is-success" : "forum-toast is-error", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "forum-toast-icon", "aria-hidden": "true", children: toast.kind === "success" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CheckIcon, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AlertIcon, {}) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: toast.text })
      ] }, toast.id)) });
    }
    function useToasts() {
      const [toasts, setToasts] = (0, import_react.useState)([]);
      const sequence = (0, import_react.useRef)(0);
      const timers = (0, import_react.useRef)([]);
      const push = (kind, text) => {
        sequence.current += 1;
        const id = sequence.current;
        setToasts((list) => [...list.slice(-2), { id, kind, text }]);
        const timer = window.setTimeout(() => {
          setToasts((list) => list.filter((toast) => toast.id !== id));
        }, 3200);
        timers.current.push(timer);
      };
      (0, import_react.useEffect)(() => () => {
        for (const timer of timers.current) window.clearTimeout(timer);
      }, []);
      return { toasts, push };
    }
    function tagOptions(catalog) {
      const tags = /* @__PURE__ */ new Set();
      for (const post of catalog.catalog.posts) for (const value of post.tags) tags.add(value);
      return [...tags].sort();
    }
    function splitTags(raw) {
      return raw.split(",").map((value) => value.trim()).filter((value) => value !== "");
    }
    function countComments(nodes) {
      let total = 0;
      for (const node of nodes) total += 1 + countComments(node.replies);
      return total;
    }
    function initial(name) {
      return name.trim().slice(0, 1).toUpperCase();
    }
    function messageOf2(error) {
      if (error instanceof Error) return error.message;
      if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
      return String(error);
    }
    function GearIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8", cy: "8", r: "2.4", stroke: "currentColor", strokeWidth: "1.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "path",
          {
            d: "M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4",
            stroke: "currentColor",
            strokeWidth: "1.5",
            strokeLinecap: "round"
          }
        )
      ] });
    }
    function PlusIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 3v10M3 8h10", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" }) });
    }
    function SearchIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { className: "forum-search-icon", width: "15", height: "15", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "7", cy: "7", r: "4.4", stroke: "currentColor", strokeWidth: "1.4" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M10.4 10.4 14 14", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" })
      ] });
    }
    function ChevronIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { className: "forum-chevron", width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m4 6 4 4 4-4", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) });
    }
    function CloseIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m4 4 8 8M12 4l-8 8", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }) });
    }
    function ArrowLeftIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M13 8H4M7 4 3 8l4 4", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) });
    }
    function ChatIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: "26", height: "26", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4 5.5h16v11H10l-4.5 3v-3H4z", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 9.5h8M8 13h5", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" })
      ] });
    }
    function CheckIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "12", height: "12", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "m3.5 8.5 3 3 6-7", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }) });
    }
    function AlertIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "12", height: "12", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 4v5M8 11.5v.5", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" }) });
    }

    // src/client/styles.ts
    var STYLE_MARKER = "data-forum-panel";
    var PANEL_CSS = `
    .forum-page {
      --forum-canvas: var(--dsw-alias-bg-module-platform);
      --forum-surface: var(--dsw-alias-bg-layer-1);
      --forum-sunken: var(--dsw-alias-turn-trigger-bg);
      --forum-text: var(--dsw-alias-label-primary);
      --forum-secondary: var(--dsw-alias-label-secondary);
      --forum-muted: var(--dsw-alias-label-tertiary);
      --forum-border: var(--dsw-alias-border-l2);
      --forum-border-soft: var(--dsw-alias-border-l1);
      --forum-accent: var(--dsw-alias-state-business-primary);
      --forum-accent-soft: var(--dsw-alias-state-business-tertiary);
      --forum-ink: var(--dsw-alias-button-primary-fill);
      --forum-ink-hover: var(--dsw-alias-button-primary-hover);
      --forum-ink-fg: var(--dsw-alias-label-primary-foreground);
      --forum-success: var(--dsw-alias-state-success-primary);
      --forum-success-soft: var(--dsw-alias-state-success-tertiary);
      --forum-warn: var(--dsw-alias-state-warn-primary);
      --forum-warn-label: var(--dsw-alias-state-warn-label);
      --forum-warn-soft: var(--dsw-alias-state-warn-tertiary);
      --forum-danger: var(--dsw-alias-state-error-primary);
      --forum-danger-soft: color-mix(in srgb, var(--forum-danger) 10%, transparent);
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background:
        radial-gradient(1100px 300px at 50% -120px, color-mix(in srgb, var(--forum-accent) 8%, transparent), transparent 72%),
        var(--forum-canvas);
      color: var(--forum-text);
      font-family: var(--dsw-font-family);
      font-size: 13.5px;
      line-height: 1.5;
    }
    .forum-page *, .forum-page *::before, .forum-page *::after { box-sizing: border-box; }
    .forum-page :focus-visible { outline: 2px solid var(--forum-accent); outline-offset: 2px; }
    .forum-page ::selection { background: var(--forum-accent-soft); }

    /* ---------- header ---------- */
    .forum-header {
      flex: 0 0 auto;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      width: 100%;
      max-width: 1180px;
      margin: 0 auto;
      padding: 26px 40px 14px;
    }
    .forum-heading-row { display: flex; align-items: center; gap: 11px; }
    .forum-mark {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: linear-gradient(145deg, var(--forum-ink), color-mix(in srgb, var(--forum-ink) 62%, var(--forum-accent)));
      color: var(--forum-ink-fg);
      box-shadow: var(--dsw-shadow-lv2);
    }
    .forum-mark svg { width: 20px; height: 20px; }
    .forum-heading h1 {
      margin: 0;
      font-size: 25px;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: -0.025em;
    }
    .forum-heading p {
      margin: 7px 0 0;
      color: var(--forum-secondary);
      font-size: 12.5px;
    }
    .forum-header-actions { display: flex; align-items: center; gap: 10px; padding-bottom: 2px; }
    .forum-actor {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 38px;
      padding: 0 4px 0 12px;
      border: 1px solid var(--forum-border-soft);
      border-radius: 10px;
      background: var(--forum-surface);
    }
    .forum-actor span { color: var(--forum-muted); font-size: 11px; white-space: nowrap; }
    .forum-actor select {
      max-width: 128px;
      height: 30px;
      padding: 0 4px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: var(--forum-text);
      font: inherit;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
    }
    .forum-actor select:hover { background: var(--forum-sunken); }

    /* ---------- board pills ---------- */
    .forum-boardbar {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      max-width: 1180px;
      margin: 0 auto;
      padding: 0 40px 15px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .forum-boardbar::-webkit-scrollbar { display: none; }
    .forum-boardbar-empty { color: var(--forum-muted); font-size: 12px; }
    .forum-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 34px;
      padding: 0 13px;
      border: 1px solid transparent;
      border-radius: 999px;
      background: transparent;
      color: var(--forum-secondary);
      font: inherit;
      font-size: 12.5px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      transition: background .15s ease, color .15s ease, box-shadow .15s ease, border-color .15s ease;
    }
    .forum-pill:hover {
      border-color: var(--forum-border-soft);
      background: var(--forum-surface);
      color: var(--forum-text);
      box-shadow: var(--dsw-shadow-lv1);
    }
    .forum-pill[aria-selected='true'] {
      background: var(--forum-ink);
      color: var(--forum-ink-fg);
      box-shadow: var(--dsw-shadow-lv2);
    }
    .forum-pill-count {
      display: grid;
      place-items: center;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--forum-sunken);
      color: var(--forum-muted);
      font-size: 10.5px;
      font-weight: 600;
      line-height: 1;
    }
    .forum-pill[aria-selected='true'] .forum-pill-count {
      background: color-mix(in srgb, var(--forum-ink-fg) 18%, transparent);
      color: inherit;
    }

    /* ---------- single-column body ---------- */
    .forum-layout {
      flex: 1 1 auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      width: 100%;
      max-width: 1180px;
      min-height: 0;
      margin: 0 auto;
      padding: 4px 40px 30px;
    }
    .forum-main { min-width: 0; min-height: 0; overflow-y: auto; padding-right: 4px; }
    .forum-main::-webkit-scrollbar { width: 8px; }
    .forum-main::-webkit-scrollbar-thumb {
      border: 2px solid transparent;
      border-radius: 999px;
      background: var(--dsw-alias-scrollbar-bg-l2);
      background-clip: padding-box;
    }

    /* ---------- second-level settings page ---------- */
    .forum-config {
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-width: 720px;
      padding-bottom: 12px;
    }
    .forum-config-head { display: flex; flex-direction: column; gap: 3px; margin-bottom: 2px; }
    .forum-config-title { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.015em; }
    .forum-config-subtitle { margin: 0; color: var(--forum-secondary); font-size: 12px; }
    .forum-config .forum-side-card { flex: 0 0 auto; }

    /* ---------- feed toolbar ---------- */
    .forum-toolbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      gap: 8px;
      padding: 4px 0 13px;
      background: linear-gradient(var(--forum-canvas) 72%, transparent);
    }
    .forum-search { position: relative; flex: 1 1 auto; min-width: 0; }
    .forum-search-icon {
      position: absolute;
      top: 50%;
      left: 12px;
      color: var(--forum-muted);
      transform: translateY(-50%);
      pointer-events: none;
    }
    .forum-search .forum-input { height: 38px; padding-left: 35px; background: var(--forum-surface); }
    .forum-select {
      height: 38px;
      width: auto;
      max-width: 160px;
      padding: 0 10px;
      border: 1px solid var(--forum-border);
      border-radius: 10px;
      background: var(--forum-surface);
      color: var(--forum-text);
      font: inherit;
      font-size: 12.5px;
      cursor: pointer;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .forum-select:hover { border-color: var(--forum-muted); }
    .forum-select:focus { outline: none; border-color: var(--forum-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--forum-accent) 18%, transparent); }

    /* ---------- feed ---------- */
    .forum-feed-head { display: flex; align-items: center; justify-content: space-between; margin: 1px 0 11px; }
    .forum-feed-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      color: var(--forum-secondary);
      font-size: 12px;
      font-weight: 650;
      letter-spacing: .01em;
    }
    .forum-feed-title::before {
      content: '';
      width: 3px;
      height: 13px;
      border-radius: 2px;
      background: var(--forum-accent);
    }
    .forum-count {
      display: inline-grid;
      place-items: center;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--forum-sunken);
      color: var(--forum-secondary);
      font-size: 10.5px;
      font-weight: 650;
      line-height: 1;
    }
    .forum-live { color: var(--forum-muted); font-size: 10.5px; font-weight: 500; }
    .forum-feed { display: flex; flex-direction: column; gap: 12px; padding-bottom: 8px; }

    /* ---------- post card ---------- */
    .forum-card {
      border: 1px solid var(--forum-border-soft);
      border-radius: 16px;
      background: var(--forum-surface);
      box-shadow: var(--dsw-shadow-lv1);
    }
    .forum-post {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 17px 20px 14px;
      transition: box-shadow .16s ease, border-color .16s ease, transform .16s ease;
    }
    .forum-post:hover {
      border-color: var(--forum-border);
      box-shadow: var(--dsw-shadow-lv2);
      transform: translateY(-1px);
    }
    .forum-post.is-pinned { box-shadow: inset 3px 0 0 var(--forum-warn), var(--dsw-shadow-lv1); }
    .forum-post.is-pinned:hover { box-shadow: inset 3px 0 0 var(--forum-warn), var(--dsw-shadow-lv2); }
    .forum-post-top { display: flex; align-items: flex-start; gap: 9px; }
    .forum-post-title { margin: 0; font-size: 15.5px; line-height: 1.45; font-weight: 650; letter-spacing: -0.01em; }
    .forum-post-link {
      padding: 0;
      border: none;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: color .13s ease;
    }
    .forum-post-link:hover { color: var(--forum-accent); }
    .forum-post-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; color: var(--forum-secondary); font-size: 11.5px; }
    .forum-post-author { font-weight: 600; color: var(--forum-secondary); }
    .forum-avatar {
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 9px;
      background: var(--forum-accent-soft);
      color: var(--forum-accent);
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      flex: 0 0 auto;
    }
    .forum-post-excerpt {
      display: -webkit-box;
      margin: 0;
      overflow: hidden;
      color: var(--forum-secondary);
      font-size: 12.5px;
      line-height: 1.65;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .forum-post-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-top: 2px;
      padding-top: 11px;
      border-top: 1px solid var(--forum-border-soft);
    }
    .forum-post-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    .forum-stat { color: var(--forum-muted); font-size: 11px; white-space: nowrap; }
    .forum-dot { color: var(--forum-muted); font-size: 10px; line-height: 1; }

    /* ---------- chips, avatars, votes ---------- */
    .forum-chip {
      display: inline-flex;
      align-items: center;
      max-width: 160px;
      padding: 2px 7px;
      overflow: hidden;
      border-radius: 6px;
      background: var(--forum-sunken);
      color: var(--forum-secondary);
      font-size: 10.5px;
      font-weight: 550;
      line-height: 1.4;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .forum-chip.is-warn { background: var(--forum-warn-soft); color: var(--forum-warn-label); font-weight: 650; }
    .forum-chip.is-accent { background: var(--forum-accent-soft); color: var(--forum-accent); font-weight: 650; }
    .forum-vote-group { display: inline-flex; gap: 5px; }
    .forum-vote {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 27px;
      padding: 0 8px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: var(--forum-sunken);
      color: var(--forum-secondary);
      font: inherit;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      transition: background .13s ease, color .13s ease, border-color .13s ease;
    }
    .forum-vote:hover:not(:disabled) { border-color: var(--forum-border); background: var(--forum-sunken); color: var(--forum-text); }
    .forum-vote:disabled { opacity: .55; cursor: default; }
    .forum-vote[aria-pressed='true'] {
      border-color: transparent;
      background: var(--forum-accent-soft);
      color: var(--forum-accent);
      font-weight: 650;
    }
    .forum-vote[aria-pressed='true']:last-child {
      background: var(--forum-danger-soft);
      color: var(--forum-danger);
    }

    /* ---------- buttons ---------- */
    .forum-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 34px;
      padding: 0 12px;
      border: 1px solid var(--forum-border);
      border-radius: 9px;
      background: var(--forum-surface);
      color: var(--forum-text);
      font: inherit;
      font-size: 12.5px;
      font-weight: 550;
      white-space: nowrap;
      cursor: pointer;
      transition: background .14s ease, border-color .14s ease, box-shadow .14s ease, color .14s ease, transform .1s ease;
    }
    .forum-btn:hover:not(:disabled) { background: var(--forum-sunken); border-color: var(--forum-border); }
    .forum-btn:active:not(:disabled) { transform: translateY(1px); }
    .forum-btn:disabled { opacity: .5; cursor: not-allowed; }
    .forum-btn.forum-ghost { border-color: transparent; background: transparent; color: var(--forum-secondary); }
    .forum-btn.forum-ghost:hover:not(:disabled) { background: var(--forum-sunken); color: var(--forum-text); }
    .forum-btn.forum-primary {
      border-color: var(--forum-ink);
      background: var(--forum-ink);
      color: var(--forum-ink-fg);
      box-shadow: var(--dsw-shadow-lv1);
    }
    .forum-btn.forum-primary:hover:not(:disabled) {
      border-color: var(--forum-ink-hover);
      background: var(--forum-ink-hover);
      box-shadow: var(--dsw-shadow-lv2);
    }
    .forum-cta { height: 40px; padding: 0 17px; border-radius: 10px; font-size: 13px; font-weight: 600; }
    .forum-wide { width: 100%; }
    .forum-icon-btn {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      flex: 0 0 30px;
      border: none;
      border-radius: 9px;
      background: transparent;
      color: var(--forum-muted);
      cursor: pointer;
      transition: background .14s ease, color .14s ease;
    }
    .forum-icon-btn:hover { background: var(--forum-sunken); color: var(--forum-text); }
    .forum-link {
      align-self: flex-start;
      padding: 0;
      border: none;
      background: none;
      color: var(--forum-accent);
      font: inherit;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
    }
    .forum-link:hover { text-decoration: underline; }

    /* ---------- empty, skeleton, banner ---------- */
    .forum-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 620px;
      margin: 18px auto;
      padding: 48px 30px;
      border: 1px solid var(--forum-border-soft);
      border-radius: 18px;
      background: linear-gradient(180deg, var(--forum-surface), color-mix(in srgb, var(--forum-surface) 55%, var(--forum-canvas)));
      box-shadow: var(--dsw-shadow-lv1);
      text-align: center;
    }
    .forum-empty-icon {
      display: grid;
      place-items: center;
      width: 56px;
      height: 56px;
      margin-bottom: 15px;
      border-radius: 18px;
      background: linear-gradient(145deg, var(--forum-accent-soft), color-mix(in srgb, var(--forum-accent-soft) 45%, var(--forum-surface)));
      color: var(--forum-accent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--forum-accent) 12%, transparent);
    }
    .forum-empty h3 { margin: 0 0 6px; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
    .forum-empty p { max-width: 390px; margin: 0 0 18px; color: var(--forum-secondary); font-size: 12.5px; line-height: 1.7; }
    .forum-empty-sm { max-width: none; margin: 0; padding: 24px; gap: 10px; border-style: solid; background: transparent; }
    .forum-empty-sm h3 { margin: 0; font-size: 13px; font-weight: 550; color: var(--forum-secondary); }
    .forum-skeleton {
      height: 128px;
      border: 1px solid var(--forum-border-soft);
      border-radius: 16px;
      background: linear-gradient(100deg, var(--forum-surface) 32%, var(--forum-sunken) 50%, var(--forum-surface) 68%);
      background-size: 220% 100%;
      animation: forum-shimmer 1.4s linear infinite;
    }
    .forum-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      padding: 10px 13px;
      border: 1px solid color-mix(in srgb, var(--forum-danger) 22%, transparent);
      border-radius: 11px;
      background: var(--forum-danger-soft);
      color: var(--forum-danger);
      font-size: 12px;
    }

    /* ---------- thread ---------- */
    .forum-thread { display: flex; flex-direction: column; gap: 14px; padding-bottom: 12px; }
    .forum-back { align-self: flex-start; padding-left: 6px; }
    .forum-thread-card { padding: 22px 24px 16px; }
    .forum-thread-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
    .forum-thread-head h2 {
      margin: 0 0 10px;
      font-size: 21px;
      line-height: 1.35;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .forum-thread-body {
      margin: 12px 0 0;
      padding-top: 14px;
      border-top: 1px solid var(--forum-border-soft);
      font-size: 14px;
      line-height: 1.85;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .forum-thread-foot { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
    .forum-comments { display: flex; flex-direction: column; gap: 10px; }
    .forum-section-head { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 2px; }
    .forum-section-head h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      color: var(--forum-secondary);
      font-size: 12px;
      font-weight: 650;
    }
    .forum-comment { display: flex; flex-direction: column; gap: 8px; padding: 15px 17px; }
    .forum-comment.is-nested { background: transparent; box-shadow: none; }
    .forum-comment-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
    .forum-comment-head strong { font-weight: 650; }
    .forum-body { margin: 0; font-size: 13px; line-height: 1.75; white-space: pre-wrap; word-break: break-word; }
    .forum-replies {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 10px;
      padding-left: 13px;
      border-left: 2px solid var(--forum-border-soft);
    }

    /* ---------- side cards ---------- */
    .forum-side-card { overflow: hidden; border: 1px solid var(--forum-border-soft); border-radius: 16px; background: var(--forum-surface); box-shadow: var(--dsw-shadow-lv1); }
    .forum-card-head {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 13px 15px;
      border: none;
      background: none;
      color: var(--forum-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .forum-card-head:hover { background: var(--forum-sunken); }
    .forum-card-head .forum-card-title { margin: 0; font-size: 13px; font-weight: 650; }
    .forum-card-head .forum-chevron { margin-left: auto; }
    .forum-chevron { color: var(--forum-muted); transition: transform .18s ease; }
    .forum-card-head[aria-expanded='false'] .forum-chevron { transform: rotate(-90deg); }
    .forum-card-body { display: flex; flex-direction: column; gap: 10px; padding: 2px 15px 15px; }
    .forum-side-hint { margin: 0; color: var(--forum-muted); font-size: 11.5px; line-height: 1.65; }
    .forum-status {
      padding: 2px 7px;
      border-radius: 999px;
      background: var(--forum-sunken);
      color: var(--forum-muted);
      font-size: 10px;
      font-weight: 650;
    }
    .forum-status.is-on { background: var(--forum-success-soft); color: var(--forum-success); }

    /* notifications */
    .forum-notif-list { display: flex; flex-direction: column; }
    .forum-notif { display: flex; flex-direction: column; gap: 5px; padding: 10px 0; border-top: 1px solid var(--forum-border-soft); }
    .forum-notif:first-child { border-top: none; padding-top: 2px; }
    .forum-notif p { margin: 0; font-size: 12px; line-height: 1.55; }
    .forum-notif-meta { display: flex; align-items: center; gap: 6px; color: var(--forum-muted); font-size: 10.5px; }
    .forum-reason {
      padding: 1px 6px;
      border-radius: 5px;
      background: var(--forum-accent-soft);
      color: var(--forum-accent);
      font-size: 10px;
      font-weight: 650;
    }
    .forum-reason.is-reply { background: var(--forum-sunken); color: var(--forum-secondary); }

    /* auto-post */
    .forum-auto-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--forum-border-soft); }
    .forum-auto-row:first-of-type { border-top: none; padding-top: 2px; }
    .forum-auto-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
    .forum-auto-name { overflow: hidden; font-size: 12.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
    .forum-auto-note { color: var(--forum-muted); font-size: 10.5px; }
    .forum-auto-min { width: 54px; height: 28px; flex: 0 0 54px; padding: 0 6px; text-align: center; font-size: 11.5px; border-radius: 8px; }
    .forum-switch { position: relative; display: inline-flex; flex: 0 0 34px; width: 34px; height: 20px; cursor: pointer; }
    .forum-switch input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
    .forum-switch-track { position: relative; width: 100%; height: 100%; border-radius: 999px; background: var(--dsw-alias-state-idle-primary); transition: background .16s ease; }
    .forum-switch-track::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, .28);
      transition: transform .16s ease;
    }
    .forum-switch input:checked + .forum-switch-track { background: var(--forum-accent); }
    .forum-switch input:checked + .forum-switch-track::after { transform: translateX(14px); }
    .forum-switch input:focus-visible + .forum-switch-track { outline: 2px solid var(--forum-accent); outline-offset: 2px; }

    /* ---------- modal ---------- */
    .forum-overlay {
      position: fixed;
      inset: 0;
      z-index: 2000;
      display: grid;
      place-items: center;
      padding: 24px;
      background: color-mix(in srgb, #000 42%, transparent);
      backdrop-filter: blur(5px);
      animation: forum-fade .16s ease-out;
    }
    .forum-modal {
      width: min(620px, 100%);
      max-height: min(88vh, 900px);
      overflow-y: auto;
      border: 1px solid var(--forum-border-soft);
      border-radius: 20px;
      background: var(--forum-surface);
      box-shadow: var(--dsw-shadow-lv3);
      animation: forum-pop .2s cubic-bezier(.2, .8, .2, 1);
    }
    .forum-modal-head { display: flex; align-items: flex-start; gap: 18px; padding: 22px 24px 0; }
    .forum-modal-head h2 { margin: 0; font-size: 19px; line-height: 1.3; font-weight: 700; letter-spacing: -0.02em; }
    .forum-modal-head p { margin: 5px 0 0; color: var(--forum-secondary); font-size: 12px; line-height: 1.6; }
    .forum-modal-head .forum-icon-btn { margin-left: auto; }
    .forum-form { display: flex; flex-direction: column; }
    .forum-modal-body { display: flex; flex-direction: column; gap: 15px; padding: 18px 24px 6px; }
    .forum-modal-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 24px 22px;
    }
    .forum-modal-foot .forum-muted { overflow: hidden; font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
    .forum-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .forum-label { color: var(--forum-secondary); font-size: 11.5px; font-weight: 600; }
    .forum-input, .forum-textarea, .forum-select {
      width: 100%;
      padding: 9px 11px;
      border: 1px solid var(--forum-border);
      border-radius: 10px;
      background: var(--forum-surface);
      color: var(--forum-text);
      font: inherit;
      font-size: 13px;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .forum-input::placeholder, .forum-textarea::placeholder { color: var(--forum-muted); }
    .forum-input:focus, .forum-textarea:focus, .forum-select:focus {
      outline: none;
      border-color: var(--forum-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--forum-accent) 16%, transparent);
    }
    .forum-textarea { min-height: 120px; line-height: 1.75; resize: vertical; }
    .forum-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .forum-seg { display: inline-flex; gap: 3px; padding: 3px; border-radius: 10px; background: var(--forum-sunken); width: fit-content; }
    .forum-seg-btn {
      padding: 7px 12px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--forum-secondary);
      font: inherit;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      transition: background .14s ease, color .14s ease, box-shadow .14s ease;
    }
    .forum-seg-btn:hover { color: var(--forum-text); }
    .forum-seg-btn[aria-pressed='true'] {
      background: var(--forum-surface);
      color: var(--forum-text);
      box-shadow: var(--dsw-shadow-lv1);
    }
    .forum-form-error { margin: 0; color: var(--forum-danger); font-size: 11.5px; line-height: 1.5; }
    .forum-muted { color: var(--forum-muted); font-size: 12px; }
    .forum-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

    /* ---------- toasts ---------- */
    .forum-toasts {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 3000;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 9px;
      pointer-events: none;
    }
    .forum-toast {
      display: flex;
      align-items: center;
      gap: 9px;
      max-width: 380px;
      padding: 11px 14px;
      border-radius: 12px;
      background: var(--dsw-alias-toast-bg);
      color: var(--dsw-alias-toast-label);
      box-shadow: var(--dsw-shadow-lv3);
      font-size: 12px;
      line-height: 1.45;
      animation: forum-toast-in .24s cubic-bezier(.2, .8, .2, 1);
    }
    .forum-toast span:last-child { overflow-wrap: anywhere; }
    .forum-toast-icon { display: grid; place-items: center; width: 20px; height: 20px; flex: 0 0 20px; border-radius: 50%; }
    .forum-toast.is-success .forum-toast-icon { background: color-mix(in srgb, #22c55e 24%, transparent); color: #4ed17e; }
    .forum-toast.is-error .forum-toast-icon { background: color-mix(in srgb, #ec1313 28%, transparent); color: #ff8080; }

    @keyframes forum-shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
    @keyframes forum-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes forum-pop { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
    @keyframes forum-toast-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }

    @media (max-width: 1120px) {
      .forum-header, .forum-boardbar, .forum-layout { padding-left: 24px; padding-right: 24px; }
      .forum-page { overflow-y: auto; }
      .forum-main { overflow: visible; }
    }
    @media (prefers-reduced-motion: reduce) {
      .forum-page *, .forum-page *::before, .forum-page *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
    }
    `;
    function installPanelStyles(ctx) {
      ctx.effect(() => {
        const style = document.createElement("style");
        style.setAttribute(STYLE_MARKER, "");
        style.textContent = PANEL_CSS;
        document.head.append(style);
        return () => {
          style.remove();
        };
      }, "forum-ui:styles");
    }

    // src/client/index.tsx
    var import_jsx_runtime2 = require("react/jsx-runtime");
    var PANEL_ID = "forum";
    var inject = ["slots", "locale", "remote", "uiWorkspace"];
    var PanelPlugin = {
      name: "forum:panel",
      inject: ["remote.forum"],
      /** @param ctx - panel-scope context over the mounted namespace. */
      apply(ctx) {
        const api = ctx.remote.forum;
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), "forum-ui:dictionaries");
        installPanelStyles(ctx);
        const t = ctx.locale.bind(NS);
        const catalog = createForumCatalog(api);
        const autoPost = createAutoPostSource(api);
        const openPost = async (postId) => {
          const r = await api.post({ postId });
          if (!r.ok) throw new Error(r.error.message);
          return r.value;
        };
        ctx.slots.inject("main", () => ctx.slots.register({
          name: "main",
          key: PANEL_ID,
          locale: NS,
          inject: () => ({
            hooks: { catalog: catalog.source, autoPost: autoPost.source },
            onRefresh: catalog.refresh,
            onEnsureBoard: async (workspaceId, path) => {
              const r = await api.ensureBoard({ workspaceId, path });
              if (!r.ok) throw new Error(r.error.message);
            },
            onOpenPost: openPost,
            onPublish: async (input) => {
              const r = await api.publish(input);
              if (!r.ok) throw new Error(r.error.message);
            },
            onComment: async (input) => {
              const r = await api.comment(input);
              if (!r.ok) throw new Error(r.error.message);
            },
            onVote: async (input) => {
              const r = await api.vote(input);
              if (!r.ok) throw new Error(r.error.message);
            },
            onPin: async (input) => {
              const r = await api.pin(input);
              if (!r.ok) throw new Error(r.error.message);
            },
            onReadInbox: async (recipient) => {
              const r = await api.inbox({ recipient });
              if (!r.ok) throw new Error(r.error.message);
              return r.value;
            },
            onMarkAllRead: async (recipient) => {
              const r = await api.markRead({ recipient, all: true });
              if (!r.ok) throw new Error(r.error.message);
            },
            onSaveAutoPost: async (settings) => {
              const r = await api.autoPost({ settings });
              if (!r.ok) throw new Error(r.error.message);
            }
          })
        }, ForumPanel));
        ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
          name: "sidebar.panellist",
          id: PANEL_ID,
          order: 20,
          locale: NS,
          label: () => t("panel")
        }, ForumPanelIcon));
      }
    };
    function createAutoPostSource(api) {
      let snapshot = {
        running: false,
        tickSeconds: 60,
        maxPerHour: 4,
        settings: [],
        lastAt: {},
        lastError: {},
        tags: []
      };
      const listeners = /* @__PURE__ */ new Set();
      let inflight;
      const read = () => {
        if (inflight !== void 0) return;
        inflight = api.autoPost({}).then((result) => {
          if (result.ok) snapshot = result.value;
          for (const listener of [...listeners]) listener();
        }, () => void 0).finally(() => {
          inflight = void 0;
        });
      };
      return {
        source: {
          getSnapshot: () => snapshot,
          subscribe(listener) {
            listeners.add(listener);
            if (listeners.size === 1) read();
            return () => {
              listeners.delete(listener);
            };
          }
        }
      };
    }
    async function apply(ctx) {
      const unmount = await ctx.remote.$mount(forumRemote);
      const panel = ctx.plugin(PanelPlugin);
      await panel;
      return async () => {
        await panel.dispose();
        await unmount();
      };
    }
    function ForumPanelIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "path",
          {
            d: "M2.5 3.5h11v8h-6l-3 2.5v-2.5h-2z",
            stroke: "currentColor",
            strokeWidth: "1.2",
            strokeLinejoin: "round"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M5 6.5h6M5 9h4", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" })
      ] });
    }

    return module.exports;
  },
});
