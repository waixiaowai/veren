---
title: 页面组件
description: 控制台单页的组装契约、URL 状态与页面四态。
sidebar:
  order: 104
  label: 页面组件
lastUpdated: 2026-11-04
---

页面是业务组件和基础组件的薄封装，负责路由参数、组件组装与页面级交互。控制台面板为单页应用（无路由库），页面级可分享状态进入 URL search params。

## 1. ConsolePage

```tsx
// 用途：表达单页组装与状态恢复（非实现）
const ConsolePage: React.FC = () => {
  const params = useSearchParams();   // data_platform / data_type / preview_path
  // URL 状态：数据浏览的筛选与预览目标
  //   data_platform: 七平台枚举 | 缺省为全部；非法值回退全部（replace）
  //   data_type: json | csv | excel | 缺省全部
  //   preview_path: 数据目录内相对路径；越界或缺省不打开预览
  const licenseOk = useLocalFlag("license_accepted");
  const env = useEnvironmentCheck({ skip: !licenseOk });
  const status = useCrawlerStatus();  // ws-status 订阅

  return (
    <Layout sidebar={<Sidebar />}>
      {!licenseOk && <LicenseDisclaimer onAccept={accept} />}
      {env.ready && !env.ok && <EnvironmentCheckDialog {...env} />}
      <CrawlerConfigPanel disabled={status.status === "running"} />
      <TerminalLog active={status.status !== "idle"} />
      <DataExplorer platform={params.data_platform} fileType={params.data_type}
        previewPath={params.preview_path} />
    </Layout>
  );
};
```

## 2. URL State Rules

| 字段 | 类型 | 默认 | 非法值处理 | 同步时机 |
| --- | --- | --- | --- | --- |
| data_platform | 平台枚举 | 全部 | replace 回退默认 | 筛选变化（replace，不重置其他筛选） |
| data_type | 类型枚举 | 全部 | replace 回退默认 | 同上 |
| preview_path | 相对路径 | 空 | 越界值 replace 清除 | 打开/关闭预览（replace） |

筛选改变使用 replace（避免每次筛选产生历史记录）；从外部带着 preview_path 打开页面（分享/刷新）时直接恢复预览。敏感内容（Cookie 凭证）永不入 URL。

## 3. Page States

| 状态 | 表现 | 默认动作 |
| --- | --- | --- |
| 加载 | 枚举与环境检查骨架屏 | 自动重试一次 |
| 空 | 数据浏览空态文案（区分尚无数据与筛选无结果） | 引导到配置区或清除筛选 |
| 失败 | 区块级错误条，重试保持筛选与分页 | 手动重试；其余区块不受影响 |
| 无权限 | 越界路径访问提示原因 | 关闭预览并清除非法参数 |

部分可用降级：数据浏览接口失败不影响配置与终端区块；环境检查失败阻断采集但不阻断日志查看。转场规则：单页内对话框进出幂等，刷新与前进后退按 URL 重放预览状态，不因重放重复发请求（预览结果按 path 缓存）。
