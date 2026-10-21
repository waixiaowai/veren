
# 这是为了方便测试插件而有插件自己管理的dsh web 插件

1. 插件启动时 启动一个dsh profile web 并记录 启动成功的地址
2. 提供工具 get dsh test info { WEB_URL： 带token的地址, DSH_HOME: 启动根目录, DSH_SRC: 源码目录, ERROR: 启动报错 }

---

以下为完整需求原文（自 deepseek-harness 仓库 plugins\dsh-test\PROMPT.md 迁入）：

请设计并开发一个 DSH web 插件，目录为 cursour 工作区下的 plugins\dsh-test（含 PROMPT.md，把需求原样写进去）。这是一个"由插件自己管理、用于方便测试其他插件"的 DSH web 插件，需求：

1. 插件启动时，启动一个 dsh profile web 实例，并在启动成功后记录其访问地址。
2. 提供一个工具 `get_dsh_test_info`，返回：
   - WEB_URL：带 token 的访问地址
   - DSH_HOME：启动根目录
   - DSH_SRC：源码目录
   - ERROR：启动报错（有错时）

验收（非工程师可自行检查）：
- 插件能在 DSH 中被加载启用，不报错；
- 调用 get_dsh_test_info 能拿到 WEB_URL，且浏览器打开该地址能进入 DSH web 界面；
- 启动失败时 ERROR 字段给出可读的错误原因，而不是工具直接崩掉。
完成后报告：插件文件位置、如何启用、工具返回示例。技术实现（如何拉起子进程、如何拿 token）由你按 DSH 插件机制自行决定。
