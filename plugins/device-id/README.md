# @veren/device-id

Platform-agnostic core of the stable device identity. Other plugins depend on
THIS package only; the per-OS packages `@veren/device-id-win` / `-mac` /
`-linux` supply the platform capability, and the host mounts the dsh storage
domain facility (`ctx.storageDomain`).

## Usage

```ts
import { DeviceIdToken } from '@veren/device-id';

export const inject = [DeviceIdToken];
export const apply = (ctx: Context) => {
  const id = ctx[DeviceIdToken].id;    // stable UUID
  ctx[DeviceIdToken].source;           // 'domain-store' | 'platform-anchor' | 'fingerprint' | 'fresh'
};
```

Install exactly one platform plugin alongside this package:

| OS      | package                  | fingerprint (stable tier)         | out-of-band anchor            |
| ------- | ------------------------ | --------------------------------- | ----------------------------- |
| Windows | `@veren/device-id-win`   | SMBIOS UUID + baseboard serial    | HKCU registry                 |
| macOS   | `@veren/device-id-mac`   | IOPlatformUUID                    | `~/Library/Application Support/veren` |
| Linux   | `@veren/device-id-linux` | DMI product_uuid / product_serial / board_serial | `~/.local/state/veren` |

## Resolution policy

Applied once in `apply` (the service is only constructed after resolution, so
`id` is always valid):

1. **dsh domain store** (`device_id` domain global): the durable,
   schema-validated primary anchor. Guarantees requirement #2 - without an OS
   reinstall the id never changes no matter how often it is generated.
2. **Platform anchor** (e.g. Windows registry): recovers the id when the
   domain medium is wiped on the same OS install.
3. **Stable-tier hardware fingerprint** deterministically mapped to a
   UUID-v5-shaped id: best-effort across an OS reinstall (requirement #1). It
   holds while the firmware-level identifiers are unchanged.
4. **Fresh random UUID** only if the platform could collect nothing.

The record keeps a rolling list of recent fingerprints (max 8) for audits.

## Host requirements

- the `storage-domain` plugin mounted (`ctx.storageDomain`), routed to any kv
  backend (e.g. `@deepseek-ai/dsh-storage-json`);
- exactly one `@veren/device-id-*` platform plugin installed.

## Caveats

- Cross-reinstall stability is best-effort: replacing the motherboard (and on
  Windows the system disk together with it) can change the fingerprint.
- VM clones share the SMBIOS UUID - treat cloned VMs as one identity, like
  every hardware-based scheme.
