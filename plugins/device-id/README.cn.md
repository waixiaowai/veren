# @veren/device-id

提供稳定「设备 ID」的 Cordis 插件，通过 `DeviceId` 服务对外暴露。凡是需要稳定
机器标识（授权、埋点、服务端设备绑定）的场景都可以使用；如果只需要「每次安装
随机一个 UUID」，则不必使用。

## 使用

```ts
import type {} from '@veren/device-id'; // 类型增强

const id = ctx['device-id'].getId(); // 稳定 UUID，进程内缓存
ctx['device-id'].source;             // 'store-file' | 'registry' | 'fingerprint' | 'fresh'
```

插件内请通过服务令牌注入：

```ts
import { DeviceIdToken } from '@veren/device-id';

export const inject = [DeviceIdToken];
export const apply = (ctx: Context) => {
  const id = ctx[DeviceIdToken].getId();
};
```

## 稳定性是如何实现的

每个进程只解析一次，按以下回退链进行：

1. **存储文件**（第一锚点）：Windows 下为 `%ProgramData%\veren\device-id.json`
   （其他平台 `~/.local/state/veren/device-id.json`）。一旦写入，后续任何一次
   生成都返回同一个 ID。**这直接保证需求 2：只要不重装系统，无论生成多少次，
   ID 都不会变。**
2. **注册表镜像**（`HKCU\Software\Veren\DeviceId`）：存储文件被误删时仍可找回
   同一 ID。
3. **硬件指纹**（对需求 1 尽力而为）：ID 由「稳定级硬件标识」的 SHA-256 摘要确定性派生：Windows 取 SMBIOS UUID + 主板序列号；Linux 取 DMI product_uuid / board_serial（可能需要 root）；macOS 取 IOPlatformUUID。重装即变的来源（Windows MachineGuid、硬盘序列号、Linux /etc/machine-id）一律排除，仅作为软级参考。硬件不变的机器
   即使重装系统、两个锚点全部丢失，也能得到同一个 ID。
4. **新随机 UUID**：只有完全采集不到任何硬件指纹时才会走到这里。

存储文件还维护最近 8 个硬件指纹的滚动列表，便于后续迁移场景识别本机。

## 配置

| key         | 类型     | 默认值（见上文第 1 步）           |
| ----------- | -------- | --------------------------------- |
| `storeFile` | `string` | 平台默认路径                      |

## 注意事项

- 需求 1（跨重装系统保持一致）本质上是尽力而为：当硬件指纹输入未变化时成立；
  同时更换主板和系统盘可能导致 ID 变化。
- 存储文件中的 `fingerprints` 目前仅作记录（恢复使用实时硬件摘要），保留用于
  前向兼容的审计。

