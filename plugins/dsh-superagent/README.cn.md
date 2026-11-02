# dsh-superagent（Gitea fork）

> **研究原型，仅供参考，非 DeepSeek 官方产品。** fork 自 [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT）。上游只支持 GitHub 与飞书；**本 fork 新增了 Gitea 来源**，GitHub 侧代码保持逐字未动。

dsh-superagent 是面向一个代码仓库的主动型智能体，打包为 [DeepSeek Harness](https://www.deepseek.com/en/harness/)（DSH）bundle。它监听仓库来源（GitHub / **Gitea**，可选飞书）：名单内的人 @ 它提出请求，它开一个工单、在自己的 agent 会话与目录里干活，然后回到原对话交付（例如开 PR）。Web 面板展示哪些事需要人。

## 本 fork 的新增（Gitea 来源）

- **Gitea 来源**：`src/sources/gitea*.ts` 六个模块，与 GitHub 来源同构（kind 定义、Trigger 翻译、PR 绑定、出站通道、读取、轮询循环），打包为 `./gitea-watch` 插件，bundle 里默认关闭
- **gitea CLI**（`tools/gitea-cli/`）：零依赖 Node 命令行，覆盖 `api` 调用、`auth status` 与 git 凭据 helper（`auth git-credential`）；令牌从配置文件读取——DSH 会剥掉凭据形状的环境变量，文件是唯一可靠载体
- **执行器环境**：worker-bin 的 `gitea` shim、worker-gitconfig 的 Gitea 站点凭据段、`DSH_SUPERAGENT_GITEA_*` 执行环境变量、`gitea/` 资源读取、`skill/gitea` 技能与双语面板词条
- **setup**：`source:gitea` 卡片校验站点/仓库/CLI；全空 quietly 缺席（不阻塞其它来源），半配置时点名缺失项
- **范围与已知边界**：Gitea 的行内评审评论不在接收范围（评审以 review 形式到达，评审回答以 PR 会话评论发出）；CI 快照只有提交状态（Gitea 无 check-run API）

上游 `SETUP.md` 与 `docs/` 仍描述上游行为；Gitea 部分的面板表单即配置界面（来源卡片 + 策略名单 + 执行环境变量）。

## 最小上手（Gitea-only）

1. `pnpm install && pnpm build`
2. `dsh plugin --profile <你的 profile> add <本目录>`（或 tarball）
3. 在 profile 的 `cordis.patch.yml` 启用：`- id: dsh-superagent-gitea` + `disabled: false`
4. 面板 › 设置 › 来源 › Gitea 卡片：填站点（`https://gitea.example.com`）、仓库（`owner/name`）、智能体的 gitea CLI 路径；保存后 setup 自动校验推送权限
5. 策略 › 各来源 › Gitea：把能发起工作的账号加进名单
6. 在仓库里 @ 智能体账号提需求；面板 Overview 约一分钟内出现工单

## 开发

`pnpm check` 跑 typecheck、测试与构建。Gitea 来源的测试在 `tests/gitea.spec.ts`。

## License

[MIT](LICENSE)
