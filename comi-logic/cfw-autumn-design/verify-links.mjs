// 校验产物中的站内相对链接是否可达 / verify relative links resolve in the built site
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";

const dist = process.argv[2];
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith(".html")) files.push(full);
  }
})(dist);

function existsAny(target) {
  const local = target.replace(/^\//, "").split("/").join("\\");
  for (const candidate of [local, `${local}.html`, join(local, "index.html")]) {
    try {
      if (statSync(join(dist, candidate)).isFile()) return true;
    } catch {
      // 继续尝试下一个候选路径 / try the next candidate
    }
  }
  return false;
}

let checked = 0;
const broken = [];
for (const file of files) {
  const rel = file.slice(dist.length).replace(/^[\\/]/, "").split("\\").join("/");
  const pageDir = posix.dirname("/" + rel);
  const html = readFileSync(file, "utf8");
  for (const match of html.matchAll(/href="(\.{1,2}\/[^"]*)"/g)) {
    const raw = match[1].split("#")[0].split("?")[0].replace(/\/+$/, "");
    if (!raw) continue;
    checked += 1;
    const resolved = posix.normalize(posix.join(pageDir, raw));
    if (!existsAny(resolved)) broken.push(`${rel} -> ${match[1]}`);
  }
}
console.log(`pages=${files.length} relativeLinks=${checked} broken=${broken.length}`);
for (const item of broken.slice(0, 20)) console.log("BROKEN " + item);
