import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentTypeFor, StaticWorkspaceServer } from "../../src/staticServer";
import { normalizePathForComparison } from "../../src/pathUtils";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("StaticWorkspaceServer", () => {
  it("serves files without caching and records dependencies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "html-live-pdf-server-"));
    cleanupPaths.push(root);
    await mkdir(path.join(root, "assets"));
    const entry = path.join(root, "index.html");
    const style = path.join(root, "assets", "style.css");
    await writeFile(entry, '<link rel="stylesheet" href="/assets/style.css">Hello', "utf8");
    await writeFile(style, "body { color: red; }", "utf8");
    const server = new StaticWorkspaceServer(root);
    await server.start();
    const capture = server.beginCapture();

    try {
      const entryResponse = await fetch(server.urlForFile(entry));
      const styleResponse = await fetch(`${server.origin}/assets/style.css`);
      expect(entryResponse.status).toBe(200);
      expect(entryResponse.headers.get("cache-control")).toContain("no-store");
      expect(styleResponse.headers.get("content-type")).toContain("text/css");
      const dependencies = server.endCapture(capture);
      expect(dependencies).toEqual(
        new Set([normalizePathForComparison(entry), normalizePathForComparison(style)]),
      );
    } finally {
      await server.stop();
    }
  });

  it("does not serve files outside the configured root", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "html-live-pdf-boundary-"));
    cleanupPaths.push(parent);
    const root = path.join(parent, "site");
    await mkdir(root);
    await writeFile(path.join(parent, "secret.txt"), "secret", "utf8");
    const server = new StaticWorkspaceServer(root);
    await server.start();
    try {
      const response = await fetch(`${server.origin}/%2e%2e%2fsecret.txt`);
      expect([403, 404]).toContain(response.status);
      expect(await response.text()).not.toContain("secret");
    } finally {
      await server.stop();
    }
  });

  it("maps common asset MIME types", () => {
    expect(contentTypeFor("page.html")).toContain("text/html");
    expect(contentTypeFor("font.woff2")).toBe("font/woff2");
    expect(contentTypeFor("unknown.bin")).toBe("application/octet-stream");
  });
});
