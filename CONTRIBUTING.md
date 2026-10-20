# 贡献约定 / Contributing

## 临时产物一律放系统临时目录 / Temp artifacts go to the system temp directory

**约定：临时文件、打包产物（tarball/dist）、浏览器 profile 一律放系统临时目录（如 `%TEMP%`），不许落在仓库工作区内。**

理由：仓库目录会被备份和版本控制误带入，临时产物落在里面会污染备份与 git 状态。

Rationale: the repo directory gets backed up and swept into version control; temp artifacts left inside pollute both.

已有的历史案例：`.pnpm-store`（335MB pnpm store 孤儿目录）、`.tmp-cdp-profile`（290MB 浏览器自动化配置）都曾在仓库根目录疯长。若必须写在仓库旁，用完即删，并确保 `.gitignore` 覆盖。

## 其他 / Other

- 提交信息使用英文 conventional 格式（如 `chore: ...`、`fix: ...`）。
- 通用开发规范见 [AGENTS.md](./AGENTS.md)。
