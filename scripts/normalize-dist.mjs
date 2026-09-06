import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));

function normalize(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      normalize(path);
      continue;
    }
    const source = readFileSync(path, "utf8");
    const cleaned = source.replace(/[ \t]+$/gm, "");
    if (cleaned !== source) writeFileSync(path, cleaned);
  }
}

normalize(root);
