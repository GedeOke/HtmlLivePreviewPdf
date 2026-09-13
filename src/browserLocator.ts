import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

interface BrowserManifest {
  platform: string;
  arch: string;
  playwrightVersion: string;
  executable: string;
}

const SUPPORTED_HOSTS = new Set(["win32-x64", "darwin-x64", "darwin-arm64"]);

export async function locateBundledBrowser(extensionPath: string): Promise<string> {
  const host = `${process.platform}-${process.arch}`;
  if (!SUPPORTED_HOSTS.has(host)) {
    throw new Error(
      `HTML Live PDF Preview does not support ${host}. Install the VSIX matching Windows x64, macOS Intel, or macOS Apple Silicon.`,
    );
  }

  const browserRoot = path.join(extensionPath, "vendor", "playwright");
  const manifestPath = path.join(browserRoot, "browser-manifest.json");
  let manifest: BrowserManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BrowserManifest;
  } catch (error) {
    throw new Error(
      "Bundled Chromium is missing. For development run `npm run browser:install`; for users install the VSIX matching this platform.",
      { cause: error },
    );
  }

  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(
      `This extension contains Chromium for ${manifest.platform}-${manifest.arch}, but VS Code is running on ${host}.`,
    );
  }
  const runtimePackage = JSON.parse(
    await readFile(path.join(extensionPath, "node_modules", "playwright-core", "package.json"), "utf8"),
  ) as { version?: string };
  if (manifest.playwrightVersion !== runtimePackage.version) {
    throw new Error(
      `Bundled Chromium targets Playwright ${manifest.playwrightVersion}, but the extension contains playwright-core ${runtimePackage.version ?? "unknown"}.`,
    );
  }
  if (
    typeof manifest.executable !== "string" ||
    path.isAbsolute(manifest.executable) ||
    manifest.executable.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("Bundled Chromium manifest contains an invalid executable path.");
  }

  const executable = path.resolve(browserRoot, ...manifest.executable.split("/"));
  try {
    await access(executable, process.platform === "win32" ? constants.F_OK : constants.X_OK);
  } catch (error) {
    throw new Error(`Bundled Chromium is not executable: ${executable}`, { cause: error });
  }
  return executable;
}
