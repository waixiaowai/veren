import { watch } from 'node:fs';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED = new Set([
  'node_modules', '.git', '.design-doc', 'dist', 'web', 'scripts',
  '.astro', '.cache', '.DS_Store',
]);

export async function syncContent(paths) {
  await rm(paths.contentDir, { recursive: true, force: true });
  await mkdir(paths.contentDir, { recursive: true });
  for (const entry of await readdir(paths.designDir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const source = path.join(paths.designDir, entry.name);
    const dest = path.join(paths.contentDir, entry.name);
    await cp(source, dest, {
      recursive: true,
      filter: (item) => !EXCLUDED.has(path.basename(item)),
    });
  }
  return countMarkdown(paths.contentDir);
}

export function watchContent(paths, onError) {
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      syncContent(paths).catch(onError);
    }, 120);
  };
  try {
    const watcher = watch(paths.designDir, { recursive: true }, (_event, filename) => {
      if (shouldIgnore(filename)) return;
      schedule();
    });
    watcher.on('error', onError);
    return {
      close: () => {
        clearTimeout(timer);
        watcher.close();
      },
    };
  } catch {
    return pollContent(paths, onError);
  }
}

function shouldIgnore(filename) {
  if (!filename) return true;
  const first = String(filename).split(/[\\/]/)[0];
  return EXCLUDED.has(first);
}

function pollContent(paths, onError) {
  let previous = '';
  let timer = null;
  const tick = async () => {
    try {
      const next = JSON.stringify(await snapshot(paths.designDir));
      if (previous && next !== previous) await syncContent(paths);
      previous = next;
    } catch (error) {
      onError(error);
    }
  };
  tick();
  timer = setInterval(tick, 800);
  return { close: () => clearInterval(timer) };
}

async function snapshot(dir) {
  const result = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, await snapshot(full));
    } else {
      const info = await stat(full);
      result[full] = info.mtimeMs;
    }
  }
  return result;
}

async function countMarkdown(dir) {
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += await countMarkdown(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.md')) {
      count += 1;
    }
  }
  return count;
}
