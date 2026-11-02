# @veren/zhihu-ops-bundle

一步装好知乎运营分析应用。

这是**纯配置组合包**：自身零运行时代码，patch 只插一行——`zhihu-ops` 应用。
应用做的全部事情（每日只读采集、持久快照、派生指标、四个页面、报告投递）都
活在那一个应用里。

应用框架——应用注册表、页面注册表、任务中心、app-host——经
`@veren/app-host-bundle` 依赖带入，由后者插入自己的框架行。

## 为什么只有一层 profile

成员插件**不**声明 `dsh.bundle.patch`。这正是整个技术栈只留一层 profile 的
原因：`dsh plugin` 的 reconciliation 只能激活本组合包，因此安装它绝不会重复
插行。成员只作为普通依赖随行。

## 安装

```bash
dsh plugin --profile web add @veren/zhihu-ops-bundle
```

然后打开知乎运营分析应用，调 `setup_credentials` 把你在
[developer.zhihu.com](https://developer.zhihu.com) 创建的 Access Secret 粘进去。

## 需要什么

- 一个知乎开放平台的 **Access Secret**（唯一的凭据；它落在凭据存储里，不进
  配置）。
- 应用框架（`@veren/app-host-bundle`），本组合包依赖它。

## 不做什么

它绝不在知乎上发布、评论或关注。它只读，也只写本地存储域与任务中心。
