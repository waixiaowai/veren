# @veren/device-id

稳定设备身份的平台无关核心。其他插件只依赖本包；各操作系统由
`@veren/device-id-win` / `-mac` / `-linux` 提供平台能力，宿主需挂载 dsh
storage domain 设施（`ctx.storageDomain`）。

## 使用

```ts
import { DeviceIdToken } from '@veren/device-id';

export const inject = [DeviceIdToken];
export const apply = (ctx: Context) => {
  const id = ctx[DeviceIdToken].id;    // 稳定 UUID
  ctx[DeviceIdToken].source;           // 'domain-store' | 'platform-anchor' | 'fingerprint' | 'fresh'
};
```

请随本包安装且只安装一个平台插件：

| 操作系统 | 包 | 指纹（稳定级） | 带外锚点 |
| --- | --- | --- | --- |
| Windows | `@veren/device-id-win` | SMBIOS UUID + 主板序列号 | HKCU 注册表 |
| macOS | `@veren/device-id-mac` | IOPlatformUUID | `~/Library/Application Support/veren` |
| Linux | `@veren/device-id-linux` | DMI product_uuid / product_serial / board_serial | `~/.local/state/veren` |

## 解析策略

在 `apply` 中一次性解析（服务在解析完成后才构造，`id` 恒有效）：

1. **dsh domain 存储**（`device_id` 域的 global 槽）：持久、过 schema 校验的
   第一锚点。直接保证需求 2：不重装系统时无论生成多少次 ID 都不变。
2. **平台锚点**（如 Windows 注册表）：同一系统安装内 domain 介质被清空时回收
   同一 ID。
3. **稳定级硬件指纹** 确定性映射为 UUID v5 形状：跨重装尽力而为（需求 1），
   固件级标识不变即成立。
4. **新随机 UUID**：平台完全采集不到指纹时才走到这里。

记录保留最近 8 个硬件指纹（滚动截断）供审计。

## 宿主要求

- 挂载 storage-domain 插件（`ctx.storageDomain`），路由到任意 kv 后端
  （如 `@deepseek-ai/dsh-storage-json`）；
- 安装且只安装一个 `@veren/device-id-*` 平台插件。

## 注意事项

- 跨重装稳定是尽力而为：更换主板（Windows 上通常连带系统盘）可能使指纹变化。
- 虚拟机克隆共享 SMBIOS UUID——克隆机视为同一身份，这与所有基于硬件的方案一致。
