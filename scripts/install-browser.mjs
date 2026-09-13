import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const root = process.cwd();
const browserRoot = path.join(root, "vendor", "playwright");
const cliPath = path.join(root, "node_modules", "playwright-core", "cli.js");

await mkdir(browserRoot, { recursive: true });

await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [cliPath, "install", "--only-shell", "chromium"],
    {
      cwd: root,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: browserRoot,
      },
      stdio: "inherit",
    },
  );
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`Playwright browser installation exited with code ${code}`));
    }
  });
});

async function findExecutable(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".links") {
      continue;
    }
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findExecutable(candidate);
      if (nested) {
        return nested;
      }
    } else if (
      entry.name === "headless_shell.exe" ||
      entry.name === "headless_shell" ||
      entry.name === "chrome-headless-shell.exe" ||
      entry.name === "chrome-headless-shell"
    ) {
      return candidate;
    }
  }
  return undefined;
}

const browserDescriptors = JSON.parse(
  await readFile(path.join(root, "node_modules", "playwright-core", "browsers.json"), "utf8"),
);
const headlessDescriptor = browserDescriptors.browsers.find(
  (browser) => browser.name === "chromium-headless-shell",
);
if (!headlessDescriptor?.revision) {
  throw new Error("playwright-core does not declare a Chromium headless shell revision.");
}
const expectedBrowserDirectory = path.join(
  browserRoot,
  `chromium_headless_shell-${headlessDescriptor.revision}`,
);
const executable = await findExecutable(expectedBrowserDirectory);
if (!executable) {
  throw new Error(`No Chromium headless executable found under ${expectedBrowserDirectory}`);
}
await access(executable);

for (const entry of await readdir(browserRoot, { withFileTypes: true })) {
  if (
    entry.isDirectory() &&
    /^chromium_headless_shell-\d+$/u.test(entry.name) &&
    path.join(browserRoot, entry.name) !== expectedBrowserDirectory
  ) {
    await rm(path.join(browserRoot, entry.name), { recursive: true, force: true });
  }
}

const playwrightPackage = JSON.parse(
  await readFile(path.join(root, "node_modules", "playwright-core", "package.json"), "utf8"),
);
const manifest = {
  platform: process.platform,
  arch: process.arch,
  playwrightVersion: playwrightPackage.version,
  executable: path.relative(browserRoot, executable).split(path.sep).join("/"),
};

await writeFile(
  path.join(browserRoot, "browser-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`Prepared ${manifest.platform}-${manifest.arch}: ${manifest.executable}\n`);
