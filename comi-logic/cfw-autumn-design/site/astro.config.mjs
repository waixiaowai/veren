import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// 目录式路由（默认）：封面位于 /design/，其余页面位于 /design/<path>/。
// Directory-style routes (default): the cover lives at /design/ and every other page at /design/<path>/.
export default defineConfig({
  site: 'https://example.com',
  integrations: [starlight({ title: '计费基础设施方案' })],
});
