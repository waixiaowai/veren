# 预设记事本：非工程师验证手册

这份手册只讲「点哪里、应该看到什么」。不需要读代码，也不需要开终端。
插件已经装进正在运行的 3080 节点（`DSH_HOME=~/.dsh_test_2`，web profile），装完即生效，安装过程没有重启 3080。

![记事本页面](assets/notebook-ui.png)

## 0. 打开页面

1. 在浏览器打开你平时用的 3080 页面。如果页面是旧的，按 **Ctrl+R** 刷新一次。
2. 看左侧栏，应该出现一个新入口：**记事本**。
3. 点 **记事本**，右侧主区域会打开记事本页面。

应该看到：

- 标题 **记事本**，副标题「每个预设一本私密笔记，跟着预设走，不跟着工作区走。」
- 右上角有一个「记事本属于」下拉框。
- 左边是笔记列表，右边是编辑器。

## 1. 写进去，能读回来

1. 右上角「记事本属于」选择 **cordis**（就是当前这个 agent 会话的 preset）。
2. 点 **新建笔记**。
3. 标题填：`我的第一条验证笔记`
4. 正文填：`这是我在 3080 的记事本里写下的。`
5. 点 **保存**。

应该看到：

- 左侧笔记列表出现 **我的第一条验证笔记**。
- 编辑器底部出现绿色的 **已保存**。
- 编辑器标题变成 **编辑笔记**，不再显示「新建笔记」。

再确认一次读回：

6. 按 **Ctrl+R** 刷新页面。
7. 重新点 **记事本**，选 **cordis**。
8. **我的第一条验证笔记** 还在，点开它，正文还是你写的内容。

## 2. 改一条

1. 在左侧点 **我的第一条验证笔记**。
2. 把正文改成：`我改过了，刷新之后还应该在。`
3. 点 **保存**。
4. 等一秒，再点左侧的同一条笔记。

应该看到：编辑器里的正文是修改后的内容，列表里的更新时间也变了。

## 3. 删一条

1. 点开 **我的第一条验证笔记**。
2. 点右上角 **删除**。
3. 按钮会变成 **再点一次确认删除**，再点一次。

应该看到：

- 左侧列表里这条笔记消失。
- 编辑器自动跳到列表里的下一条笔记（不会停留在已删除的那条上）。

## 4. A 看不到 B（重点：正向 + 反向检查）

这里的「A」和「B」是两个 preset，例如 **cordis** 和 **standard**。

### 4.1 正向检查：切到 B，写一条只有 B 能看的

1. 「记事本属于」选择 **standard**。
2. 点 **新建笔记**，标题写：`standard 的私密笔记`
3. 正文写：`这条只属于 standard。`
4. 点 **保存**。
5. 左侧列表应该出现它。

### 4.2 反向检查：切回 A，确认 A 真的看不到

1. 「记事本属于」切回 **cordis**。
2. 看左侧列表：**不应该**出现 `standard 的私密笔记`。
3. 再切回 **standard**：应该能看到它。

这一步只证明「界面没显示」。要证明「结构上就拿不到」，再做下面这个反向检查：

4. 回到 **cordis** 的会话，让 agent 调用 `notebook_list`。它的结果里不能有 `standard 的私密笔记`。
5. 让 agent 用 `notebook_read` 去读 `standard 的私密笔记` 的 id。应该报错：
   `no note with id "..." in this notebook.`
6. 让 agent 用 `notebook_update` 或 `notebook_delete` 对同一个 id 操作。也应该报同样的错。

为什么这算「结构性做不到」：

- `notebook_*` 工具的参数里根本没有「所有者」这一项，agent 无法指定别人的记事本。
- 宿主在拼存储键时，永远用「发起会话自己的 preset」作为归属。拿别人的笔记 id 过来，只会拼出自己名下的一个不存在的键。
- 所以不是「碰巧没读到」，而是根本不存在一条能读到别人笔记的调用路径。

## 5. 跨工作区是同一本

1. 在左侧工作区列表点 **cms**（或者任何另一个工作区）。
2. 再点 **记事本**，仍然选 **cordis**。
3. 之前写的 **Host tool proof** / **Created from the Web GUI** 应该还在。

说明：记事本不挂在任何工作区上，只挂在 preset 上。换项目、换工作区，看到的是同一本。

## 6. 刷新和重启后还在

### 刷新

已经验证：按 **Ctrl+R**，重进 **记事本**，选同一个 preset，笔记还在。

### 重启

安装过程本身**不需要重启**。如果要验证「整个 DSH 进程重启后还在」，需要你自己重启一次 3080，因为从当前会话里重启会把正在跑的会话一起掐掉，我不能替你按这个按钮。

建议步骤：

1. 等当前会话的工作告一段落。
2. 停掉 3080 进程（你平时怎么停就怎么停）。
3. 用原来的命令重新启动：

   ```powershell
   $env:DSH_HOME='C:\Users\imeep\.dsh_test_2'
   pnpm --dir deepseek\deepseek-harness dsh web --port 3080 --no-open
   ```

4. 打开启动日志里打印的带 `?token=...` 的地址（或直接刷新原来的页面）。
5. 点 **记事本**，选 **cordis**。

应该看到：`Host tool proof` 和 `Created from the Web GUI` 都还在；切到 **standard**，`standard 的私密笔记` 也还在，并且 **cordis** 仍然看不到它。

我在验证时没有重启 3080，而是用一个**独立的新进程**（临时端口 3082，同一个 `DSH_HOME` 和同一个 profile）冷启动读取同一份存储，确认了上面这些内容；验证完已经把这个临时进程关掉。真实重启 3080 后应看到同样的结果。

## 7. 已知边界（刻意这样处理）

### 预设被删了，笔记怎么办

笔记**保留**，不删除。理由是：默默丢用户数据比留一份孤儿数据更糟。

- 记事本页面的「记事本属于」仍会列出这个 preset，并标注 **预设已删除，笔记仍保留**。
- 人仍然可以查看、编辑、删除这些笔记。
- 如果以后又出现同名 preset，它会看到同一本笔记。

### 笔记很长

- 标题上限：200 字符。
- 正文上限：100,000 字符。
- 页面右下角有实时计数，例如 `104 / 100000`。
- 超限时页面显示错误；工具返回 `notebook/body-too-long`，并说明实际长度。

### 空白笔记

- 标题必填；正文可以为空。
- 只填空白标题会被拒绝，工具返回 `notebook/title-required`，页面显示「标题不能为空。」

### 两边同时改

- 页面保存时会带上「我读到这条笔记时的更新时间」。
- 如果这期间工具或另一个页面已经改过，保存会被拒绝，页面显示冲突提示，并**保留你的草稿**，不会覆盖别人的新版本。
- 工具也支持传 `expectedUpdatedAt`；不传时是后写覆盖先写（last-write-wins）。

### 存储打不开

- 页面显示「读取失败: notebook storage is unavailable: ...」和 **重试** 按钮。
- 工具返回稳定的 `notebook/storage-unavailable` 错误。
- Harness 的其余部分继续运行，不会因为记事本存储坏了而整体崩溃。

## 8. 安装位置与产物

- 源码：
  - `plugins/notebook` — 宿主服务、`notebook_*` 工具、存储域；包名 `@veren/notebook`
  - `plugins/notebook-ui` — 侧栏入口与 Web 页面；包名 `@veren/notebook-ui`
  - `plugins/notebook-bundle` — 只含配置的组合包；包名 `@veren/notebook-bundle`
- 安装的 profile：`C:\Users\imeep\.dsh_test_2\profiles\web`
- profile 的 `dsh.profile.bundles` 已含 `@veren/notebook-bundle`
- 安装产物（本地 tarball）：`plugins/notebook-bundle/tarballs/`
- 数据文件：`C:\Users\imeep\.dsh_test_2\storages\notebook.json`

## 9. 我已经实测过的证据

- **工具路径**：`notebook_create` 写入 `Host tool proof`；`notebook_list` 读回；`notebook_update` 改标题和正文；`notebook_read` 读全文；`notebook_delete` 删除临时笔记。
- **界面路径**：在 3080 上用浏览器自动化实际点击：编辑一条、新建一条、删除一条、切换 preset、刷新页面，全部通过，控制台零错误。
- **界面与工具同一份**：界面新建的 `Created from the Web GUI` 在下一次 `notebook_list` 里立刻出现；工具删除的临时笔记在页面刷新后消失。
- **重启后**：用同一个 `DSH_HOME` 冷启动独立进程（3082），两条笔记和隔离都还在。
- **隔离**：`cordis` 对 `standard` 的笔记 id 调用 `notebook_read` / `notebook_update` / `notebook_delete`，三次都返回 `no note with id ... in this notebook.`。
- **跨工作区**：在 `deepseek/deepseek-harness` 工作目录下的同 preset 子会话调用 `notebook_list`，看到的是同一本笔记。
- **实时插槽**：客户端插槽检查显示 `notebook:panel` 已挂在 `sidebar.panellist` 和 `main`，状态 active。
