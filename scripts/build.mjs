import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as esbuild from "esbuild";

const root = process.cwd();
const watch = process.argv.includes("--watch");
const dist = path.join(root, "dist");
const webviewOut = path.join(dist, "webview");
const licenseOut = path.join(dist, "licenses");

await mkdir(webviewOut, { recursive: true });
await mkdir(licenseOut, { recursive: true });

const builds = [
  {
    entryPoints: [path.join(root, "src", "extension.ts")],
    outfile: path.join(dist, "extension.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode", "playwright-core"],
    sourcemap: true,
  },
  {
    entryPoints: [path.join(root, "src", "webview", "viewer.ts")],
    outfile: path.join(webviewOut, "viewer.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome120",
    sourcemap: true,
  },
  {
    entryPoints: [path.join(root, "src", "test", "suite", "index.ts")],
    outfile: path.join(dist, "test", "suite", "index.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: true,
  },
];

const workerSource = path.join(
  root,
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs",
);
const workerTarget = path.join(webviewOut, "pdf.worker.min.mjs");

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
  await copyFile(workerSource, workerTarget);
  await copyThirdPartyLicenses();
  process.stdout.write("Watching extension and webview sources...\n");
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
  await copyFile(workerSource, workerTarget);
  await copyThirdPartyLicenses();
}

async function copyThirdPartyLicenses() {
  await Promise.all([
    copyFile(
      path.join(root, "node_modules", "pdfjs-dist", "LICENSE"),
      path.join(licenseOut, "PDFJS-LICENSE.txt"),
    ),
    copyFile(
      path.join(root, "node_modules", "playwright-core", "LICENSE"),
      path.join(licenseOut, "PLAYWRIGHT-LICENSE.txt"),
    ),
  ]);
}
