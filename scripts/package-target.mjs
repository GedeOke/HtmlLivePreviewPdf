import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const expectedTargets = new Map([
  ["win32-x64", ["win32", "x64"]],
  ["darwin-x64", ["darwin", "x64"]],
  ["darwin-arm64", ["darwin", "arm64"]],
]);
const target = process.argv[2];

if (!target || !expectedTargets.has(target)) {
  throw new Error("Usage: npm run package -- <win32-x64|darwin-x64|darwin-arm64>");
}

const [expectedPlatform, expectedArch] = expectedTargets.get(target);
if (process.platform !== expectedPlatform || process.arch !== expectedArch) {
  throw new Error(
    `Target ${target} must be packaged natively on ${expectedPlatform}-${expectedArch}; ` +
      `current host is ${process.platform}-${process.arch}.`,
  );
}

const root = process.cwd();
const browserRoot = path.join(root, "vendor", "playwright");
const manifestPath = path.join(browserRoot, "browser-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
  throw new Error("Bundled browser manifest does not match the current packaging target.");
}
if (manifest.playwrightVersion !== packageJson.dependencies["playwright-core"]) {
  throw new Error("Bundled browser manifest does not match the pinned playwright-core version.");
}
await access(path.join(browserRoot, ...manifest.executable.split("/")));

const releaseDir = path.join(root, "release");
await mkdir(releaseDir, { recursive: true });
const output = path.join(
  releaseDir,
  `${packageJson.name}-${packageJson.version}-${target}.vsix`,
);
const vscePath = path.join(root, "node_modules", "@vscode", "vsce", "vsce");

await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      vscePath,
      "package",
      "--allow-missing-repository",
      "--target",
      target,
      "--out",
      output,
    ],
    { cwd: root, stdio: "inherit" },
  );
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`vsce exited with code ${code}`));
    }
  });
});
