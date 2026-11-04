---
title: 登录与凭证
description: 扫码、手机号、Cookie 三种登录方式的统一契约、登录态持久化与校验。
sidebar:
  order: 23
  label: 登录与凭证
lastUpdated: 2026-11-04
---

登录与凭证（核心域）：以扫码、手机号、Cookie 三种方式取得并维持目标平台的登录态，负责登录探测、登录执行、Cookie 回写与登录态持久化；与平台爬取器的分界是「爬取器只调用探测与登录接口，凭证的存储与校验归本模块」。

## 1. Responsibilities

- 登录探测：以轻量接口或页面状态判断当前浏览器上下文是否已有有效登录态。
- 三种登录方式：扫码（呈现二维码并轮询扫码结果）、手机号（提交手机号获取验证码并回填）、Cookie（把使用者提供的凭证串注入浏览器上下文）。
- Cookie 回写：登录成功后把浏览器上下文 Cookie 同步给接口客户端。
- 登录态持久化：启用登录态缓存时，把登录后的浏览器档案写入按平台隔离的用户数据目录，下次启动直接复用。
- 平台特化的登录前置：部分平台登录后需执行一次特定页面访问以补齐接口所需 Cookie。

## 2. Key Design Decisions

1. **先探测后登录**：每次采集启动先探测已有登录态，命中则跳过登录流程。违反后果：每次采集都要求人工扫码，自动化不可用。
2. **双重校验登录成功**：登录成功判定同时检查页面元素与 Cookie 变化。违反后果：假登录（页面变了但会话未建立）导致后续请求全部失败。
3. **凭证档案按平台隔离**：持久化目录按平台命名，互不共享。违反后果：Cookie 域串扰导致登录态互相覆盖。
4. **Cookie 凭证不落落地介质**：登录凭证只存在于浏览器档案与本机内存，不进入任何数据文件或数据库。违反后果：凭证泄漏面扩大。

## 3. Contracts

```ts
// 统一登录契约，七平台各自实现
abstract class AbstractLogin {
  abstract begin(): Promise<void>;              // 按 LOGIN_TYPE 分发到三种方式
  abstract loginByQrcode(): Promise<boolean>;   // 呈现二维码并轮询，成功返回 true
  abstract loginByMobile(): Promise<boolean>;   // 手机号+验证码，成功返回 true
  abstract loginByCookies(): Promise<void>;     // 注入使用者提供的 Cookie 串
}

interface LoginProbe {                          // 登录探测结果
  loggedIn: boolean;
  probeMethod: "api" | "page" | "cookie";       // 各平台探测手段不同
}

interface LoginState {
  platform: Platform;
  cookieSnapshot: CookiePair[];                 // 域与键值对
  persistedDir: string;                         // 按平台隔离的用户数据目录
}
```

登录方式与配置枚举一一对应：`qrcode`（默认）、`phone`、`cookie`。手机号方式的验证码通过缓存服务读取（使用者从手机获取后写入缓存键），扫码方式把二维码图像持久化到本地后弹窗展示。

## 4. Flow

```ts
// 用途：表达登录三段式与失败分支
async function begin(login: AbstractLogin): Promise<void> {
  if (await probeLoggedIn()) {                       // 探测命中直接返回
    return;
  }
  let ok = false;
  if (config.loginType === "cookie") {
    if (!config.cookies) throw new CredentialMissingError();
    await login.loginByCookies();                    // 注入凭证串
    ok = await probeLoggedIn();                      // 注入后必须复验
    if (!ok) throw new CredentialInvalidError();
  } else if (config.loginType === "phone") {
    ok = await login.loginByMobile();                // 验证码读缓存，超时失败
  } else {
    ok = await login.loginByQrcode();                // 轮询扫码，超时失败
  }
  if (!ok) throw new LoginTimeoutError();            // 长时间未完成，采集终止
  await persistLoginState();                         // 写平台隔离的用户数据目录
}
```

登录状态机见[状态模型](../states/)。失败分支与恢复策略：

- **扫码超时**：以固定间隔轮询扫码结果，重试窗口耗尽后抛登录超时错误，进程终止；使用者重跑即重开二维码。
- **二维码过期**：部分平台支持重取二维码继续等待；重取仍超时按登录超时处理。
- **Cookie 注入无效**：注入后探测不通过即判凭证失效，立即报错——不带着无效会话进入采集。
- **会话中途失效**：采集过程中探测或请求返回未授权时，由爬取器触发 Cookie 刷新重试；刷新耗尽上抛。
- **幂等**：登录态持久化是覆盖式写入，重复登录只保留最新档案；持久化启用时重启进程免扫码。

## 5. Platform Differences

- **xhs**：探测同时校验页面入口元素与会话 Cookie 键；Cookie 方式只注入会话键到对应域；海外版域名随版本切换。
- **dy**：手机号方式从缓存服务读验证码；探测检查页面登录标记或会话 Cookie 键；Cookie 覆盖主站与创作者站等多个域。
- **ks**：探测以业务查询接口可用性为准；手机号方式当前不可用（仅扫码与 Cookie 有效）。
- **bili**：探测以会话 Cookie 键出现为准；登录后爬取器再补一次接口级探测，失败即退出，避免低画质静默采集。
- **wb**：先在桌面站完成登录，再跳转移动站取得取数用 Cookie；探测检查移动站配置接口的登录标记。
- **tieba**：登录前经真实导航路径进入，规避安全验证；探测结合 Cookie 与页面数据。
- **zhihu**：登录成功后必须先访问一次搜索页补齐搜索 Cookie，否则搜索接口不可用；探测以当前用户信息接口为准。

## 6. Acceptance

1. **成功路径（缓存命中）**：持久化登录态有效时，启动采集不出现任何登录交互，日志记录探测命中。
2. **成功路径（扫码）**：无缓存时弹出二维码，使用者在轮询窗口内完成扫码后采集自动继续，档案写入平台隔离目录。
3. **拒绝路径**：Cookie 方式提供无效凭证串时，进程在采集开始前报凭证失效错误，不发出业务请求。
4. **失败路径**：扫码轮询窗口耗尽未完成登录，进程以登录超时错误退出。
5. **幂等路径**：连续两次采集，第二次免登录；重复登录覆盖旧档案且不产生重复目录。
6. **隔离路径**：两个平台的登录档案分别存放，切换平台采集不互相清除对方登录态。
