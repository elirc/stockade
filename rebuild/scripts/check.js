import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(path, entry.name))
      : /\.(js|mjs)$/.test(entry.name)
        ? [join(path, entry.name)]
        : [],
  );
}
let count = 0;
for (const path of ["src", "public", "scripts", "tests"].flatMap(files)) {
  const result = spawnSync(process.execPath, ["--check", path], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  count++;
}
console.log(`Syntax checked ${count} JavaScript files.`);
