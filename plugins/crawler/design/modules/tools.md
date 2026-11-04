---
title: 工具集
description: 日志、时间、Cookie 转换、二维码、浏览器启动、优雅退出与词云等横切工具。
sidebar:
  order: 28
  label: 工具集
lastUpdated: 2026-11-04
---

工具集（外围域）：提供采集主链路复用的横切工具，自身不含业务语义；与各模块的分界是「模块调用工具，工具不反向依赖任何模块」。

## 1. Responsibilities

- **日志**：全局单例日志器，统一级别与格式，压低第三方请求库的噪音日志。
- **时间**：当前时间戳、日期格式化、Unix 时间与字符串互转、RFC 时间转换。
- **Cookie 转换**：浏览器上下文 Cookie 与字符串、字典形态互转，供登录与接口客户端共享。
- **二维码**：从登录页定位并下载二维码图像，保存后弹窗展示。
- **浏览器启动**：浏览器路径探测、调试端口探测、启动就绪等待、进程清理。
- **CDP 管理**：连接或启动带远程调试的浏览器，注入隐身脚本，管理 Cookie 与连接清理。
- **滑块验证**：缺口模板匹配与轨迹生成（工具性支持，不承诺通过率）。
- **随机 UA**：桌面与移动两套用户代理随机池。
- **请求客户端工厂**：统一构造内部请求客户端，校验开关与证书校验策略集中管理。
- **优雅退出**：信号监听、限时清理、二次中断强退（退出码 130），Windows 平台回退实现。
- **词云**：从评论文本生成词频与词云图，加载停用词表。
- **脱敏**：人物标识哈希化、昵称遮蔽，供存储适配调用。
- **文件头管理**：版权头批量检查与插入（开发期工具，非运行时依赖）。

## 2. Contracts

```ts
// 全局日志
interface LoggerContract {
  info(tag: string, message: string): void;
  warn(tag: string, message: string): void;
  error(tag: string, message: string): void;
}

// 优雅退出
interface AppRunnerContract {
  run(appMain: () => Promise<void>, appCleanup: () => Promise<void>, options: {
    cleanupTimeoutSeconds: number;      // 默认 15
    onFirstInterrupt?: () => void;      // CDP 模式额外清理浏览器启动器
    forceExitCode?: number;             // 二次中断退出码，默认 130
  }): Promise<void>;
}

// 脱敏
interface AnonymizerContract {
  anonymizeUserId(userId: string): string;   // 哈希截断为定长十六进制
  maskNickname(name: string): string;        // 首尾各保留一字，中间遮蔽
}

// Cookie 转换
interface CookieConverterContract {
  toString(cookies: CookiePair[]): string;
  toHeaderAndDict(cookies: CookiePair[]): [string, Record<string, string>];
  fromBrowserContext(context: BrowserContext): Promise<CookiePair[]>;
}
```

## 3. Flow

工具集以纯函数与单例服务为主，无独立业务流程。关键编排发生在优雅退出：首次中断取消主任务并以限时等待清理完成，超时后取消剩余任务；二次中断跳过一切清理立即强退。词云在采集结束后由启动器按介质与开关调用，读取评论数据文件生成词云图文件。

失败分支与恢复策略：清理函数各自捕获预期异常（连接已关闭类）不外抛；二维码下载失败由登录流程重试；词云生成失败仅记日志不影响采集结果。

## 4. Acceptance

1. **成功路径**：采集全程日志按统一格式输出，时间字段全部来自统一时间工具。
2. **退出路径**：中断后限时清理完成退出；二次中断立即以约定退出码退出。
3. **脱敏路径**：任意输入经脱敏函数后不含原始标识与完整昵称。
4. **转换路径**：Cookie 三种形态互转往返后键值一致，浏览器上下文提取覆盖全部目标域。
