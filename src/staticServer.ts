import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isPathInside, normalizePathForComparison } from "./pathUtils";

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

export function contentTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export class StaticWorkspaceServer {
  private server: Server | undefined;
  private rootRealPath: string | undefined;
  private originValue: string | undefined;
  private readonly captures = new Map<symbol, Set<string>>();

  public constructor(private readonly rootPath: string) {}

  public get origin(): string {
    if (!this.originValue) {
      throw new Error("Static server has not been started.");
    }
    return this.originValue;
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const rootStats = await stat(this.rootPath);
    if (!rootStats.isDirectory()) {
      throw new Error(`Configured server root is not a directory: ${this.rootPath}`);
    }
    this.rootRealPath = await realpath(this.rootPath);
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error("Static server initialization failed."));
        return;
      }
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = this.server.address();
    if (!address || typeof address === "string") {
      await this.stop();
      throw new Error("Static server did not receive a TCP port.");
    }
    this.originValue = `http://127.0.0.1:${address.port}`;
  }

  public urlForFile(filePath: string, revision?: number): string {
    if (!this.rootRealPath) {
      throw new Error("Static server has not been started.");
    }
    const configuredRoot = path.resolve(this.rootPath);
    const resolvedFile = path.resolve(filePath);
    const relative = path.relative(configuredRoot, resolvedFile);
    if (relative === "" || relative === "." || !isPathInside(configuredRoot, resolvedFile)) {
      if (relative === "" || relative === ".") {
        throw new Error("A directory cannot be used as the HTML preview entry.");
      }
      throw new Error("HTML entry is outside htmlLivePdf.serverRoot.");
    }
    const pathname = relative.split(path.sep).map(encodeURIComponent).join("/");
    const url = new URL(`${this.origin}/${pathname}`);
    if (revision !== undefined) {
      url.searchParams.set("__htmlLivePdfRevision", String(revision));
    }
    return url.toString();
  }

  public beginCapture(): symbol {
    const token = Symbol("dependency-capture");
    this.captures.set(token, new Set());
    return token;
  }

  public endCapture(token: symbol): Set<string> {
    const files = this.captures.get(token) ?? new Set<string>();
    this.captures.delete(token);
    return files;
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.originValue = undefined;
    this.rootRealPath = undefined;
    this.captures.clear();
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }
      if (!this.rootRealPath) {
        response.writeHead(503);
        response.end("Server is not ready");
        return;
      }

      const requestUrl = new URL(request.url ?? "/", this.origin);
      let decodedPath: string;
      try {
        decodedPath = requestUrl.pathname
          .split("/")
          .map((segment) => decodeURIComponent(segment))
          .join(path.sep);
      } catch {
        response.writeHead(400);
        response.end("Malformed URL path");
        return;
      }

      const unresolved = path.resolve(this.rootRealPath, `.${path.sep}${decodedPath}`);
      if (!isPathInside(this.rootRealPath, unresolved)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      let target = await realpath(unresolved).catch(() => undefined);
      if (!target || !isPathInside(this.rootRealPath, target)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      let targetStats = await stat(target);
      if (targetStats.isDirectory()) {
        target = await realpath(path.join(target, "index.html")).catch(() => undefined);
        if (!target || !isPathInside(this.rootRealPath, target)) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        targetStats = await stat(target);
      }
      if (!targetStats.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const logicalTarget = path.resolve(
        this.rootPath,
        path.relative(this.rootRealPath, target),
      );
      const normalizedTarget = normalizePathForComparison(logicalTarget);
      for (const capture of this.captures.values()) {
        capture.add(normalizedTarget);
      }

      response.writeHead(200, {
        "Cache-Control": "no-store, max-age=0",
        "Content-Length": targetStats.size,
        "Content-Type": contentTypeFor(target),
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }

      const stream = createReadStream(target);
      stream.once("error", () => {
        if (!response.headersSent) {
          response.writeHead(500);
        }
        response.end();
      });
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      response.end(`Internal preview server error: ${String(error)}`);
    }
  }
}

export function fileUrlForDiagnostics(filePath: string): string {
  return pathToFileURL(filePath).toString();
}
