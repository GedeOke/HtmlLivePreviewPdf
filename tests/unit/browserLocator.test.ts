import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { locateBundledBrowser } from "../../src/browserLocator";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("locateBundledBrowser", () => {
  it("loads a platform-matching browser manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "html-live-pdf-browser-"));
    cleanupPaths.push(root);
    const browserRoot = path.join(root, "vendor", "playwright");
    const packageRoot = path.join(root, "node_modules", "playwright-core");
    const executableName = process.platform === "win32" ? "headless_shell.exe" : "headless_shell";
    const executable = path.join(browserRoot, "browser", executableName);
    await mkdir(path.dirname(executable), { recursive: true });
    await mkdir(packageRoot, { recursive: true });
    await writeFile(executable, "test", "utf8");
    if (process.platform !== "win32") {
      await chmod(executable, 0o755);
    }
    await writeFile(
      path.join(browserRoot, "browser-manifest.json"),
      JSON.stringify({
        platform: process.platform,
        arch: process.arch,
        playwrightVersion: "test",
        executable: `browser/${executableName}`,
      }),
      "utf8",
    );
    await writeFile(path.join(packageRoot, "package.json"), '{"version":"test"}', "utf8");
    await expect(locateBundledBrowser(root)).resolves.toBe(executable);
  });

  it("rejects traversal in a browser manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "html-live-pdf-browser-"));
    cleanupPaths.push(root);
    const browserRoot = path.join(root, "vendor", "playwright");
    const packageRoot = path.join(root, "node_modules", "playwright-core");
    await mkdir(browserRoot, { recursive: true });
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      path.join(browserRoot, "browser-manifest.json"),
      JSON.stringify({
        platform: process.platform,
        arch: process.arch,
        playwrightVersion: "test",
        executable: "../outside",
      }),
      "utf8",
    );
    await writeFile(path.join(packageRoot, "package.json"), '{"version":"test"}', "utf8");
    await expect(locateBundledBrowser(root)).rejects.toThrow(/invalid executable path/u);
  });
});
