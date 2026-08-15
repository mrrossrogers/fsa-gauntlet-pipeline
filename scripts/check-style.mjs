import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["api", "lib", "public"];
const checkedExtensions = new Set([".css", ".html", ".js", ".md", ".sql"]);
const violations = [];

async function scan(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  if (!entries.length && checkedExtensions.has(extname(path))) {
    const source = await readFile(path, "utf8");
    source.split(/\r?\n/).forEach((line, index) => {
      if (line.includes("\u2014") || (extname(path) === ".html" && /&mdash;/i.test(line))) violations.push(`${path}:${index + 1}`);
    });
    return;
  }
  for (const entry of entries) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) await scan(fullPath);
    else if (checkedExtensions.has(extname(entry.name))) await scan(fullPath);
  }
}

for (const root of roots) await scan(root);
if (violations.length) {
  console.error("FSA style check failed. Em dashes are not permitted:");
  violations.forEach((violation) => console.error(`  ${violation}`));
  process.exit(1);
}
console.log("FSA style check passed.");
