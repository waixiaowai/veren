# Olares 上的 npm 私有仓库（Verdaccio）

> 读者对象：需要发布或安装 `@veren/*`（及其他私有 scope）npm 包的团队成员。英文版见 [npm-private-registry-olares.md](./npm-private-registry-olares.md)。

## 仓库信息

| 项目 | 值 |
|---|---|
| 软件 | Verdaccio 7.0.2（协议标准的开源 npm registry） |
| 外部地址 | `https://830a2922.comilogic.olares.cn` |
| Web UI | 同一地址——浏览包、登录 |
| 运行形态 | Olares 应用 `verdaccio`（chart 0.1.5，命名空间 `verdaccio-comilogic`） |
| 账号 | 管理员开户（自助注册已关闭） |
| 管理员 | `admin`——密码仅线下一次性交付，请入密码库 |

## 拉包（匿名，无需账号）

`@veren/*` 匿名可读——与现有 `npm.veren.top` 行为一致。

**必踩的坑，先说清**：`--registry` 命令行旗标**覆盖不了**任何 `.npmrc`（项目级或用户级）里
已写死的 scope 路由。本机把 `@veren` 指到了 `npm.veren.top`，不写本地 `.npmrc` 的话安装会
静默走到旧源。永远用目录本地 `.npmrc`：

```ini
# <你的项目>/.npmrc（一次性测试就放临时目录）
registry=https://830a2922.comilogic.olares.cn/
@veren:registry=https://830a2922.comilogic.olares.cn/
```

关于 npm 到底在哪找到这个文件，两个细节：

- npm 从 cwd **向上走到最近的 `package.json` / `node_modules`** 取最近的 `.npmrc`——放在
  包根目录更下层的子目录里的 `.npmrc` 会被静默忽略。
- 最便宜的验证：`npm config list` 会给每个被压掉的键标注 `; overridden by project`。看不到
  这个标注，就说明路由根本没发生。

还有一扇 Windows + Git Bash 特有的静默失败之门：`NPM_CONFIG_USERCONFIG` 必须是
**Windows 原生路径**（`cygpath -w /tmp/...npmrc`）；直接写 POSIX 形式的 `/tmp/...` 解析不了，
npm 会静默回退到用户级配置——恰好落进本节警告的错误源故障。

然后：

```bash
npm install @veren/imagegen        # 从 Olares 仓库解析
npm view @veren/imagegen versions  # 匿名读 metadata 可用
```

非 `@veren/*` 的公共包首次访问经 uplink 从 `registry.npmmirror.com` 拉取并缓存，之后直接
吃本地缓存。

## 发包（需账号）

发布需要 token。找仓库管理员开户（自助注册已关闭），然后：

```bash
# 写一份仅发布用的 .npmrc（禁止提交进仓库）
mkdir -p ~/.config/npm-olares
cat > ~/.config/npm-olares/registry.npmrc <<EOF
registry=https://830a2922.comilogic.olares.cn/
@veren:registry=https://830a2922.comilogic.olares.cn/
//830a2922.comilogic.olares.cn/:_authToken=<你的TOKEN>
EOF

# 与 market/release.mjs 完全同款的发布方式——临时 userconfig，不动全局
NPM_CONFIG_USERCONFIG=~/.config/npm-olares/registry.npmrc npm publish
```

自己获取 `<你的TOKEN>`（需要你账号的密码）：

```bash
curl -u <用户名>:<密码> -X PUT -H 'Content-Type: application/json' \
  -d '{"name":"<用户名>","password":"<密码>"}' \
  https://830a2922.comilogic.olares.cn/-/user/org.couchdb.user:<用户名>
# → 返回 JSON 里有 "token": "..."
```

规则：

- **同版本永不可重发**（registry 不可变——与本仓 versioning 红线一致：先 bump 再发布）。
- `--access public` 可用但不必须（与 npmjs.com 不同，Verdaccio 对 scoped 包默认即可发布）。
- 清理：`npm unpublish <pkg>@<ver> --force`——npm 拒绝直接删一个包的**最后一个版本**，必须
  加 `--force`，而冒烟包通常只有单版本。注意删掉某名字的最后一个版本后，该名字 24 小时内
  不可重发（npm 客户端策略）。第三个路由坑：`npm unpublish` 不认 userconfig 里的 scope 键——
  必须站在自带 `.npmrc`（含两行 registry）的目录里跑，否则会静默打到 registry.npmjs.org
  （404）。

## 管理操作

全部经 `olares-cli`（v1.12.7+）。先找 pod：

```bash
olares-cli cluster pod list -n verdaccio-comilogic -o json
```

**开户**（`max_users: -1` 已关自助注册）：

```bash
# 本地生成密码与 htpasswd 兼容哈希，再经 exec 追加
PASS=<随机密码>
HASH=$(openssl passwd -apr1 "$PASS")
olares-cli cluster pod exec verdaccio-comilogic/<pod> -c verdaccio -- \
  sh -c "echo '<用户名>:$HASH' >> /verdaccio/storage/htpasswd"
```

`htpasswd` 文件落在应用持久卷（`appData`）上，pod 重启与应用升级后账号都在（已验证：
workload 重启与两次 chart 升级后登录仍 201）。

**删除已发布版本**：带 token 执行 `npm unpublish --registry <URL> <pkg>@<ver>`。

## 策略一览

| 包模式 | 读 | 发布 | uplink 代理 |
|---|---|---|---|
| `@veren/*` | 匿名 | 须登录 | **无**（仅本地——阻断依赖混淆） |
| `@*/*`、`**` | 匿名 | 须登录 | `registry.npmmirror.com`（只缓存） |

其他：请求体上限 100mb、同版本禁重发、信任集群 pod CIDR 的 `X-Forwarded-For`、自助注册关闭。

## 与 npm.veren.top 的关系

`npm.veren.top`（同为 Verdaccio）继续服务现有 `@veren/*` 全线、market 与三环境——什么都没动。
本 Olares 仓库是**并行**仓库。`@veren/*` 全线迁移是另立决策（registry 不可变，切换 = 各消费方
改 scope 配置；已发布版本留在原源）。

## 已知限制

- **集群内消费者暂时够不到本仓库。** per-user 应用之间跨命名空间流量被平台隔离（从
  `gitearunner` 探测本应用在 TCP 层超时，该 pod 唯一通行的通道是 giteaclone service）。
  未来的选项：把 chart 改成 shared app（`options.shared: true`，平台授予 mesh +
  NetworkPolicy 通道；需重装进 `-shared` 命名空间）——待决策。
- pod 钉在 `olares-worker` 节点（与 CI runner 同通道；跨节点路径实测异常）。数据在
  JuiceFS（`appData`），钉节点不影响数据安全。
- 镜像以精确 tag `7.0.2` 钉死（Verdaccio 从不挪动已发布版本 tag）；digest 钉死待网络
  条件允许——本网络到 Docker Hub / daocloud 的 manifest 端点均不可达。

## chart 源

chart 源可从实例取回：

```bash
olares-cli market download verdaccio   # 取回存储的 .tgz
```

每项 chart 决策的记录在 chart 内 `NOTES.md`（作者时的目录为 cursour 工作区
`.tmp-registry-chart/verdaccio/`）。
