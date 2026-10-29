# @veren/imagegen

面向 DSH agent 的位图图像生成与编辑，后端可以是任何 OpenAI 兼容的 Images API 端点。

## 提供什么

插件挂载即注册三件事：

1. **两个模型工具**
   - `imagegen__generate` —— 每次调用产一张图，完整 prompt 驱动；落盘进工作区（永不覆盖，重名自动派生 `hero-v2.png`），并返回持久图像引用，vision 模型可以回看自己的产物。
   - `imagegen__edit` —— 对既有图片文件走同一闭环（局部重绘、换背景、去物体、合成），支持可选蒙版。
2. **`image-generation` 技能** —— 从久经考验的图像技能完整移植的提示词纪律：生成/编辑的意图判定、19 个用途分类 slug、结构化 prompt schema、按具体度分级的增补政策、单变量迭代。参考文件（`prompting.md`、`sample-prompts.md`）随正文一起打包，供模型按需渐进读取。
3. **引导式登录流** —— 粘贴 Images API key（或从宿主环境只读导入 `IMAGEGEN_API_KEY`/`OPENAI_API_KEY`）。key 在 `GET /models` 在线校验通过后才落凭据库；永不进配置文件、永不进日志。

chroma-key 后处理器（`chroma_key: "#00ff00"`）把纯键色底转成真 alpha 通道——这是对无真透明模型（gpt-image-2 拒绝透明背景）的透明化兜底路径。

## 成本治理

`enabled` 默认 **false**。未开启时所有工具调用以 `IMAGEGEN_DISABLED` 拒绝——安装插件不等于授权付费调用。请在配置行里显式打开。

## 安装（稳定测试节点）

```powershell
# 通过插件自带的 patch 挂 bundle 行（或把 @veren/imagegen 加进你安装的组合包）
pnpm --dir deepseek\deepseek-harness dsh plugin --profile web add plugins\imagegen
```

配置行（profile overlay 示例见 `cordis.patch.yml`）：

```yaml
- insert:
    - id: imagegen
      name: '@veren/imagegen'
      config:
        enabled: true            # 付费门
        # baseURL: https://api.openai.com/v1
        # model: gpt-image-2
```

然后走授权流登录一次（设置 → 凭据，或流 key `imagegen/account`）。

## 配置参考

| 字段 | 缺省 | 含义 |
| --- | --- | --- |
| `enabled` | `false` | 付费门；关闭时报 `IMAGEGEN_DISABLED` |
| `baseURL` | `https://api.openai.com/v1` | OpenAI 兼容 Images API 根 |
| `model` | `gpt-image-2` | 缺省图像模型 |
| `requestTimeoutMs` | `600000` | 单请求超时（生成可达数分钟） |
| `maxAttempts` | `3` | 瞬态失败尝试次数（429/5xx；遵循 Retry-After） |

## 稳定错误码

`IMAGEGEN_DISABLED`、`IMAGEGEN_NO_KEY`、`IMAGEGEN_NO_WORKSPACE`、`IMAGEGEN_SIZE_INVALID`、`IMAGEGEN_QUALITY_INVALID`、`IMAGEGEN_FORMAT_INVALID`、`IMAGEGEN_TRANSPARENCY_UNSUPPORTED`、`IMAGEGEN_OPTION_UNSUPPORTED`、`IMAGEGEN_PROMPT_EMPTY`、`IMAGEGEN_INPUT_FILE_MISSING`、`IMAGEGEN_CHROMA_INVALID`、`IMAGEGEN_CHROMA_FAILED`、`IMAGEGEN_API_ERROR`、`IMAGEGEN_INVALID_RESPONSE`。工具以结构化值返回（`{ kind: 'error', code, message }`），绝不跨工具边界抛异常。

## 模型能力矩阵（前置校验，fail loud）

- `gpt-image-2`：尺寸 `auto` 或 `WxH`，边长 ≤ 3840px 且两边均为 16px 倍数，长宽比 ≤ 3:1，总像素 655 360–8 294 400；不支持透明背景与 `input_fidelity`。
- legacy（`gpt-image-1.5`/`1`/`1-mini` 及未知模型）：尺寸固定 `1024x1024`/`1536x1024`/`1024x1536`/`auto`；透明背景要求 `png`/`webp` 输出。

## 开发

```bash
pnpm --dir plugins/imagegen run typecheck
pnpm --dir plugins/imagegen run test        # 73 个单测 + 组合测试
pnpm --dir plugins/imagegen run test:e2e    # 真实付费调用；无 IMAGEGEN_E2E_KEY/OPENAI_API_KEY 自跳过
```

稳定节点验收（DSH_HOME=deepseek\.dsh，端口 3080）：起 web profile，开会话让 agent 画点东西，检查 (a) PNG 落在工作区，(b) 会话日志里工具结果带图，(c) vision 模型能描述图片内容，(d) 追问「你怎么知道路径的」答的是工具结果。

英文版见 [README.md](README.md)。/ See [README.md](README.md) for the English version.
