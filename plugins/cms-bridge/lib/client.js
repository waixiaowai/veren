window.__ModuleLoader__.load({
	id: "@veren/cms-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/bridge.ts
		/** 读取节点身份(GET;POST 同路由)/ fetch the node identity (GET; POST shares the route) */
		async function fetchIdentity() {
			const res = await fetch("/cms-bridge/api/identity");
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = await res.json();
			if (!body.identity) throw new Error("no identity in response");
			return body.identity;
		}
		/** 保存节点身份 / save the node identity */
		async function saveIdentity(identity) {
			const res = await fetch("/cms-bridge/api/identity", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(identity)
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
		}
		/**
		* 上传图标图片:经节点代理转到 cms /v1/files(is_public),返回公开 CAS URL。
		* Uploads the icon image: the node proxy forwards it to cms /v1/files
		* (is_public) and returns the public CAS URL.
		*/
		async function uploadIconImage(file) {
			const form = new FormData();
			form.append("purpose", "user_data");
			form.append("is_public", "true");
			form.append("file", file);
			const res = await fetch("/cms-bridge/api/icon", {
				method: "POST",
				body: form
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
			const body = await res.json();
			if (typeof body.url !== "string" || body.url === "") throw new Error("no url in response");
			return body.url;
		}
		/** 拉取一次状态 / fetch the status once */
		async function fetchStatus(signal) {
			try {
				const res = await fetch("/cms-bridge/api/status", { signal });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return {
					status: await res.json(),
					error: null
				};
			} catch (error) {
				return {
					status: null,
					error: error instanceof Error ? error.message : String(error)
				};
			}
		}
		/**
		* 创建基于 SSE 事件推送的状态可观察对象;返回句柄含 start/stop,由 apply
		* 世界登记清理。start 即取一次快照,之后由 /cms-bridge/api/events 实时推送;
		* EventSource 断线自动重连。
		* Creates the SSE-push status observable; the handle carries start/stop for
		* the apply world to register. start takes one snapshot, then
		* /cms-bridge/api/events pushes updates; EventSource reconnects itself.
		*/
		function createStatusStore() {
			let snapshot = {
				status: null,
				error: null
			};
			const listeners = /* @__PURE__ */ new Set();
			let source = null;
			const emit = () => {
				for (const fn of listeners) fn();
			};
			const applySnapshot = (next) => {
				snapshot = next;
				emit();
			};
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				start() {
					if (source) return;
					fetchStatus().then(applySnapshot);
					source = new EventSource("/cms-bridge/api/events");
					source.onmessage = (e) => applySnapshot({
						status: JSON.parse(e.data),
						error: null
					});
					source.onerror = () => applySnapshot({
						...snapshot,
						error: "event stream interrupted; retrying"
					});
				},
				stop() {
					source?.close();
					source = null;
				}
			};
		}
		/** 提交新凭证 / submit a new credential */
		async function rotateCredential(token) {
			const res = await fetch("/cms-bridge/api/credential", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ token })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
		}
		//#endregion
		//#region \0cms-css:C:\Users\imeep\Documents\cursour\plugins\cms-bridge\src\client\panel.module.css.mjs
		const css = "._6Q-w6W_panel{flex-direction:column;gap:12px;width:100%;display:flex}._6Q-w6W_card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-sizing:border-box;border-radius:8px;flex-direction:column;gap:6px;width:100%;padding:10px 12px;display:flex;position:relative}._6Q-w6W_badge{z-index:1;pointer-events:none;position:absolute;top:0;right:12px;transform:translateY(-50%);box-shadow:0 1px 4px #0000001f}._6Q-w6W_cardTitle{align-items:center;gap:6px;font-size:13px;font-weight:600;display:flex}._6Q-w6W_iconImgSmall{object-fit:cover;border-radius:4px;width:16px;height:16px;display:block}._6Q-w6W_hint{color:var(--dsw-alias-label-secondary);font-size:11px}._6Q-w6W_stateLine{align-items:center;gap:8px;display:flex}._6Q-w6W_stateLabel{font-size:13px}._6Q-w6W_row{justify-content:space-between;gap:12px;font-size:12px;display:flex}._6Q-w6W_rowLabel{color:var(--dsw-alias-label-secondary);flex-shrink:0}._6Q-w6W_rowValue{text-align:right;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;overflow:hidden}._6Q-w6W_formRow{align-items:center;gap:8px;width:100%;display:flex}._6Q-w6W_fieldRow{align-items:center;gap:10px;font-size:12px;display:flex}._6Q-w6W_fieldLabel{color:var(--dsw-alias-label-secondary);flex-shrink:0;width:96px}._6Q-w6W_iconRow{flex:auto;align-items:center;gap:8px;min-width:0;display:flex}._6Q-w6W_iconInput{text-align:center;max-width:120px}._6Q-w6W_iconPreview{font-size:20px;line-height:1}._6Q-w6W_iconImg{object-fit:cover;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;width:32px;height:32px;display:block}._6Q-w6W_deviceId{overflow-wrap:anywhere;flex:auto;min-width:0}._6Q-w6W_mono{font-family:monospace}._6Q-w6W_input{flex:auto;min-width:0;font-family:monospace;font-size:12px}._6Q-w6W_eyeToggle{flex-shrink:0;justify-content:center;align-items:center;width:28px;height:28px;padding:0;display:inline-flex}._6Q-w6W_eyeIcon{width:16px;height:16px;display:block}._6Q-w6W_saved{color:var(--dsw-alias-state-success-primary);font-size:12px}._6Q-w6W_errorText{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;font-size:12px}";
		const tagId = "@veren/cms-bridge/panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@veren/cms-bridge";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var panel_module_css_default = {
			"badge": "_6Q-w6W_badge",
			"card": "_6Q-w6W_card",
			"cardTitle": "_6Q-w6W_cardTitle",
			"deviceId": "_6Q-w6W_deviceId",
			"errorText": "_6Q-w6W_errorText",
			"eyeIcon": "_6Q-w6W_eyeIcon",
			"eyeToggle": "_6Q-w6W_eyeToggle",
			"fieldLabel": "_6Q-w6W_fieldLabel",
			"fieldRow": "_6Q-w6W_fieldRow",
			"formRow": "_6Q-w6W_formRow",
			"hint": "_6Q-w6W_hint",
			"iconImg": "_6Q-w6W_iconImg",
			"iconImgSmall": "_6Q-w6W_iconImgSmall",
			"iconInput": "_6Q-w6W_iconInput",
			"iconPreview": "_6Q-w6W_iconPreview",
			"iconRow": "_6Q-w6W_iconRow",
			"input": "_6Q-w6W_input",
			"mono": "_6Q-w6W_mono",
			"panel": "_6Q-w6W_panel",
			"row": "_6Q-w6W_row",
			"rowLabel": "_6Q-w6W_rowLabel",
			"rowValue": "_6Q-w6W_rowValue",
			"saved": "_6Q-w6W_saved",
			"stateLabel": "_6Q-w6W_stateLabel",
			"stateLine": "_6Q-w6W_stateLine"
		};
		//#endregion
		//#region src/client/ApiKeyForm.tsx
		/**
		* API Key 配置表单组件(纯渲染 + 行为回调经 props 注入)。
		* The API Key form component (pure rendering; the rotate behavior arrives via props).
		*
		* 保存走 owner site 注入的 rotate 回调;原文绝不回显,成功后只清空输入框。
		* 眼睛图标切换明文/密文显示。
		* Saving goes through the injected rotate callback; the raw value is never
		* rendered back — on success the input just clears. An eye icon toggles
		* between masked and plain text.
		*/
		/** 眼睛图标(睁眼:可见)/ the eye icon (open: visible) */
		function EyeIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: panel_module_css_default.eyeIcon,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "12",
					cy: "12",
					r: "3"
				})]
			});
		}
		/** 眼睛斜杠图标(闭眼:隐藏)/ the eye-off icon (closed: hidden) */
		function EyeOffIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: panel_module_css_default.eyeIcon,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14.12 14.12a3 3 0 1 1-4.24-4.24" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "1",
						y1: "1",
						x2: "23",
						y2: "23"
					})
				]
			});
		}
		function ApiKeyForm({ rotate, t }) {
			const [token, setToken] = (0, react.useState)("");
			const [visible, setVisible] = (0, react.useState)(false);
			const [phase, setPhase] = (0, react.useState)("idle");
			const [message, setMessage] = (0, react.useState)("");
			const save = async () => {
				setPhase("saving");
				setMessage("");
				try {
					await rotate(token);
					setToken("");
					setVisible(false);
					setPhase("saved");
				} catch (error) {
					setPhase("idle");
					setMessage(error instanceof Error ? error.message : String(error));
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: panel_module_css_default.card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.cardTitle,
						children: t("apiKeyTitle")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.hint,
						children: t("apiKeyHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: panel_module_css_default.formRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: panel_module_css_default.input,
								type: visible ? "text" : "password",
								value: token,
								placeholder: "cmsk_...",
								onChange: (e) => {
									setToken(e.target.value);
									setPhase("idle");
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								className: panel_module_css_default.eyeToggle,
								title: visible ? t("hide") : t("show"),
								"aria-label": visible ? t("hide") : t("show"),
								onClick: () => {
									setVisible((v) => !v);
								},
								children: visible ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EyeIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EyeOffIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								size: "sm",
								disabled: phase === "saving" || token.length === 0,
								onClick: () => {
									save();
								},
								children: phase === "saving" ? t("saving") : t("save")
							})
						]
					}),
					phase === "saved" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.saved,
						children: t("saved")
					}) : null,
					message !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.errorText,
						children: t("saveFailed", { message })
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/IdentityCard.tsx
		/**
		* 节点信息卡片(纯渲染):名称/简介/图标/uuid 四个可编辑字段 + 保存。
		* The node identity card (pure rendering): name/description/icon/uuid fields + save.
		*
		* 加载与保存行为由 owner site 注入(铁律 10);图标字段实时预览 emoji。
		* Load/save behaviors are injected from the owner site (rule 10); the icon
		* field renders a live emoji preview.
		*/
		function IdentityCard({ deviceId, savedAt, t }) {
			const [identity, setIdentity] = (0, react.useState)(null);
			const [phase, setPhase] = (0, react.useState)("idle");
			const [uploading, setUploading] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)("");
			const fileRef = (0, react.useRef)(null);
			/** 选图后经节点代理上传到 cms,成功即把公开 URL 写进图标字段 */
			/** After picking a file, uploads it to cms through the node proxy and writes the public URL into the icon field */
			const upload = async (file) => {
				if (!file) return;
				setUploading(true);
				setMessage("");
				try {
					const url = await uploadIconImage(file);
					setIdentity((current) => current === null ? current : {
						...current,
						nodeIcon: url
					});
				} catch (error) {
					setMessage(error instanceof Error ? error.message : String(error));
				} finally {
					setUploading(false);
				}
			};
			(0, react.useEffect)(() => {
				let alive = true;
				fetchIdentity().then((data) => {
					if (alive) setIdentity(data);
				}).catch((error) => {
					if (alive) setMessage(error instanceof Error ? error.message : String(error));
				});
				return () => {
					alive = false;
				};
			}, [savedAt]);
			if (identity === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: panel_module_css_default.card,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: panel_module_css_default.cardTitle,
					children: t("identityTitle")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: panel_module_css_default.hint,
					children: message !== "" ? message : t("loading")
				})]
			});
			const patch = (key, value) => {
				setIdentity({
					...identity,
					[key]: value
				});
				setPhase("idle");
			};
			const save = async () => {
				setPhase("saving");
				setMessage("");
				try {
					await saveIdentity(identity);
					setPhase("saved");
				} catch (error) {
					setPhase("idle");
					setMessage(error instanceof Error ? error.message : String(error));
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: panel_module_css_default.card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.cardTitle,
						children: t("identityTitle")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						label: t("nodeName"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							className: panel_module_css_default.input,
							value: identity.nodeName,
							onChange: (e) => patch("nodeName", e.target.value)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						label: t("nodeDescription"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							className: panel_module_css_default.input,
							value: identity.nodeDescription,
							placeholder: t("nodeDescriptionPlaceholder"),
							onChange: (e) => patch("nodeDescription", e.target.value)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						label: t("nodeIcon"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: panel_module_css_default.iconRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconPreview, { nodeIcon: identity.nodeIcon }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									ref: fileRef,
									type: "file",
									accept: "image/*",
									style: { display: "none" },
									onChange: (e) => {
										upload(e.target.files?.[0]);
										e.target.value = "";
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									disabled: uploading,
									onClick: () => fileRef.current?.click(),
									children: uploading ? t("uploading") : t("uploadIcon")
								})
							]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						label: t("nodeId"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							className: panel_module_css_default.input,
							type: "text",
							value: identity.nodeId,
							spellCheck: false,
							onChange: (e) => patch("nodeId", e.target.value)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						label: t("deviceId"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `${panel_module_css_default.deviceId} ${panel_module_css_default.mono}`,
							children: deviceId !== "" ? deviceId : t("loading")
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: panel_module_css_default.formRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								size: "sm",
								disabled: phase === "saving",
								onClick: () => {
									save();
								},
								children: phase === "saving" ? t("saving") : t("save")
							}),
							phase === "saved" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: panel_module_css_default.saved,
								children: t("saved")
							}) : null,
							message !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: panel_module_css_default.errorText,
								children: t("saveFailed", { message })
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.hint,
						children: t("identityHint")
					})
				]
			});
		}
		/** 单字段行:标签 + 控件 / one field row: label + control */
		function Field({ label, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: panel_module_css_default.fieldRow,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: panel_module_css_default.fieldLabel,
					children: label
				}), children]
			});
		}
		/** 图标预览:URL 渲染图片,否则按 emoji 文本 / the icon preview: URLs render as images, anything else as emoji text */
		function IconPreview({ nodeIcon }) {
			if (nodeIcon.startsWith("http://") || nodeIcon.startsWith("https://") || nodeIcon.startsWith("data:")) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				className: panel_module_css_default.iconImg,
				src: nodeIcon,
				alt: ""
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: panel_module_css_default.iconPreview,
				"aria-hidden": "true",
				children: nodeIcon
			});
		}
		//#endregion
		//#region src/client/StatusCard.tsx
		/**
		* 连接状态卡片组件(纯渲染):悬浮状态角标 + 关键指标行。
		* The connection status card component (pure rendering): a floating state
		* badge on the card corner + metric rows.
		*
		* 状态不再占卡片内一行,而是以 Tag 角标悬浮于卡片右上边缘(悬浮角标);
		* 数据经 props 从 owner site 穿入(铁律 10),组件不接触 ctx、不自订阅。
		* The state is not an in-card row anymore — it floats on the top-right edge
		* as a Tag badge; data arrives via props (rule 10), never touching ctx.
		*/
		/** 状态 → 悬浮角标配色 / state → floating badge tone */
		const BADGE_TONE = {
			connected: "success",
			connecting: "warning",
			reconnecting: "warning",
			"awaiting-credential": "danger",
			disposed: "neutral",
			idle: "neutral"
		};
		/** 在线时长文案 / uptime label */
		function isUrl(value) {
			return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:");
		}
		function uptime(connectedAt) {
			if (!connectedAt) return "-";
			const s = Math.max(0, Math.floor((Date.now() - connectedAt) / 1e3));
			const m = Math.floor(s / 60);
			const hh = Math.floor(m / 60);
			return hh > 0 ? `${hh}h ${m % 60}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
		}
		function StatusCard({ status, error, t }) {
			const state = status?.state ?? "idle";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: panel_module_css_default.card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
						tone: BADGE_TONE[state],
						className: panel_module_css_default.badge,
						children: t(`state.${state}`)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.cardTitle,
						children: status ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [isUrl(status.node.nodeIcon) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							className: panel_module_css_default.iconImgSmall,
							src: status.node.nodeIcon,
							alt: ""
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"aria-hidden": "true",
							children: status.node.nodeIcon
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status.node.nodeName })] }) : t("statusTitle")
					}),
					error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.errorText,
						children: t("apiUnreachable", { error })
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: t("credential"),
							value: status?.credentialFingerprint ?? t("notSet")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: t("uptime"),
							value: uptime(status?.connectedAt ?? null)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: t("reconnects"),
							value: String(status?.reconnectAttempts ?? 0)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: t("pending"),
							value: String(status?.pendingEvents ?? 0)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: t("inflight"),
							value: String(status?.inflightCommands ?? 0)
						}),
						status?.lastError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: t("lastError"),
							value: status.lastError
						}) : null
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: panel_module_css_default.hint,
						children: t("refreshHint")
					})
				]
			});
		}
		/** 单行指标 / one metric row */
		function Row({ label, value }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: panel_module_css_default.row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: panel_module_css_default.rowLabel,
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: panel_module_css_default.rowValue,
					children: value
				})]
			});
		}
		//#endregion
		//#region src/client/CmsBridgePanel.tsx
		/**
		* 插件页组合面板:状态卡片 + API Key 表单。
		* The plugin-page composite panel: the status card + the API Key form.
		*
		* 数据经 useSyncExternalStore 订阅 owner site 传入的 HostObservable(铁律 9/12:
		* 订阅集中在框架钩子,组件保持纯渲染)。
		* Data is consumed through useSyncExternalStore over the HostObservable passed
		* from the owner site (rules 9/12: subscription lives in the framework hook;
		* the component stays pure/derived).
		*/
		function CmsBridgePanel({ store, rotate, t }) {
			const snapshot = (0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: panel_module_css_default.panel,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusCard, {
						status: snapshot.status,
						error: snapshot.error,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ApiKeyForm, {
						rotate,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IdentityCard, {
						deviceId: snapshot.status?.deviceId ?? "",
						savedAt: snapshot.status?.connectedAt ?? 0,
						t
					})
				]
			});
		}
		//#endregion
		//#region src/client/i18n.ts
		const NS = "@veren/cms-bridge";
		const zh = {
			statusTitle: "CMS 连接",
			apiKeyTitle: "API Key",
			apiKeyHint: "保存后经 Loader 热更生效,插件自动以新凭证重连;原文不会回显。",
			save: "保存",
			saving: "保存中…",
			saved: "已保存",
			saveFailed: "保存失败:{message}",
			uploadIcon: "上传图片",
			uploading: "上传中…",
			show: "显示明文",
			hide: "隐藏明文",
			identityTitle: "节点信息",
			nodeName: "节点名称",
			nodeDescription: "简介",
			nodeDescriptionPlaceholder: "一句话描述这个节点(可选)",
			nodeIcon: "图标",
			nodeId: "节点 ID",
			deviceId: "设备 ID",
			identityHint: "保存后经 Loader 热更,并在下次连接时上报给 cms;ID 为稳定 uuid,修改后服务端将视为新节点。设备 ID 由 device-id 插件从本机硬件解析,只读。",
			loading: "加载中…",
			credential: "凭证",
			notSet: "未配置",
			uptime: "在线时长",
			reconnects: "重连次数",
			pending: "待补报",
			inflight: "执行中",
			lastError: "最近错误",
			refreshHint: "状态实时推送",
			apiUnreachable: "API 不可达:{error}",
			"state.connected": "已连接",
			"state.connecting": "连接中",
			"state.reconnecting": "重连中",
			"state.awaiting-credential": "等待凭证",
			"state.idle": "空闲",
			"state.disposed": "已卸载"
		};
		const en = {
			statusTitle: "CMS Connection",
			apiKeyTitle: "API Key",
			apiKeyHint: "Saved through the Loader hot path; the plugin reconnects with the new credential. The raw value is never shown back.",
			save: "Save",
			saving: "Saving…",
			saved: "Saved",
			saveFailed: "Save failed: {message}",
			uploadIcon: "Upload image",
			uploading: "Uploading…",
			show: "Show plain text",
			hide: "Hide plain text",
			identityTitle: "Node Identity",
			nodeName: "Node name",
			nodeDescription: "Description",
			nodeDescriptionPlaceholder: "One line about this node (optional)",
			nodeIcon: "Icon",
			nodeId: "Node ID",
			deviceId: "Device ID",
			identityHint: "Saved through the Loader hot path and reported to cms on the next connect; the ID is a stable uuid — changing it makes the server treat this as a new node. The Device ID is resolved from this machine by the device-id plugin and is read-only.",
			loading: "Loading…",
			credential: "Credential",
			notSet: "not set",
			uptime: "Uptime",
			reconnects: "Reconnects",
			pending: "Pending events",
			inflight: "In-flight",
			lastError: "Last error",
			refreshHint: "Realtime status updates",
			apiUnreachable: "API unreachable: {error}",
			"state.connected": "Connected",
			"state.connecting": "Connecting",
			"state.reconnecting": "Reconnecting",
			"state.awaiting-credential": "Credential required",
			"state.idle": "Idle",
			"state.disposed": "Disposed"
		};
		//#endregion
		//#region src/client/index.tsx
		/** 服务级注入:slots(挂载点)与 locale(多语言)/ service-level inject: slots (mount) and locale (i18n) */
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "cms-bridge/locale");
			const t = ctx.locale.bind(NS);
			const store = createStatusStore();
			ctx.effect(() => {
				store.start();
				return () => {
					store.stop();
				};
			}, "cms-bridge/status-store");
			const rotate = (token) => rotateCredential(token);
			ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: "@veren/cms-bridge"
			}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CmsBridgePanel, {
				store,
				rotate,
				t
			})));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map