import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const directory = path.resolve(process.argv[2] ?? "release");
const files = (await readdir(directory)).filter((name) => name.endsWith(".vsix")).sort();
if (files.length === 0) {
  throw new Error(`No VSIX files found in ${directory}`);
}

const lines = [];
for (const file of files) {
  const data = await readFile(path.join(directory, file));
  lines.push(`${createHash("sha256").update(data).digest("hex")}  ${file}`);
}
await writeFile(path.join(directory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
