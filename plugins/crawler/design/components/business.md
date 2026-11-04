---
title: 业务组件
description: 绑定接口与状态的组件：配置面板、终端日志、数据浏览、环境检查、免责声明。
sidebar:
  order: 103
  label: 业务组件
lastUpdated: 2026-11-04
---

业务组件组合基础与复合组件，绑定接口与状态。逐个写明使用的接口标识、字段映射与适用状态；处理重复操作与请求竞态。

## 1. Component List

| 组件 | 接口（见[接口设计](../api/)） | 职责 |
| --- | --- | --- |
| CrawlerConfigPanel | config-platforms、config-options、crawler-start、crawler-stop、crawler-status | 组装采集参数并下发启停 |
| TerminalLog | crawler-logs、ws-logs | 历史补发 + 实时日志流 |
| StatusBadge | ws-status | 任务状态徽标 |
| DataExplorer | data-files、data-file、data-download、data-stats | 数据产物浏览、预览、下载 |
| EnvironmentCheck | env-check | 运行环境校验 |
| LicenseDisclaimer | （本机记忆，无接口） | 首次免责声明确认 |

## 2. Contracts

```tsx
// 用途：表达数据绑定、状态覆盖与竞态处理（非实现）
const CrawlerConfigPanel: React.FC = () => {
  const platforms = useQuery(["platforms"], fetchPlatforms);      // GET /api/config/platforms
  const options = useQuery(["options"], fetchOptions);            // GET /api/config/options
  const { mutate: start, isPending } = useMutation(startCrawler, {
    onError: (err) => toast.error(err.userMessage),               // 错误文案引用错误码表
  });
  // 重复操作防护：isPending 期间禁点启动；运行中互斥由后端拒绝并回显原因
  return (
    <form onSubmit={(e) => { e.preventDefault(); start(collectForm()); }}>
      <OptionGroup label="平台" options={platforms.data} />
      <OptionGroup label="采集模式" options={options.data.crawlerTypes} />
      <FormRow id="keywords" label="关键词" error={form.errors.keywords}>
        <Textarea value={form.keywords} onChange={setKeywords} />
      </FormRow>
      <Button type="submit" loading={isPending}>启动采集</Button>
      <Button variant="danger" onClick={() => stopMutation.mutate()}>停止采集</Button>
    </form>
  );
};
```

适用状态逐组件声明：

- **CrawlerConfigPanel**：加载（枚举拉取骨架）、就绪、提交中、失败（错误文案与字段校验）、无权限态不适用（单机无账号）。竞态：枚举失败可单独重试，不影响其余表单；启动被拒保留全部表单值。
- **TerminalLog**：连接中（历史拉取）、已连接（实时追加）、断线（显式标记 + 自动重连指数退避）、重连成功（补拉缺口）。竞态：历史补发与实时流以日志 id 去重，旧连接残留消息丢弃。
- **DataExplorer**：加载、空（尚无数据）、筛选空（清除筛选入口）、失败（重试保持筛选）、下载中。竞态：筛选变化取消进行中的列表请求，旧响应不覆盖新筛选结果。
- **EnvironmentCheck**：检查中、通过、失败（修复提示 + 重新检查）。
- **LicenseDisclaimer**：未确认（阻断主区）、已确认（不再渲染）。重复确认幂等。

提交后反馈：启动成功聚焦终端区；停止成功表单解锁；下载完成以通知确认。所有回调、数据服务与类型均有契约来源（[接口设计](../api/)与[数据字典](../data/)）。
