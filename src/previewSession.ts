import path from "node:path";
import * as vscode from "vscode";
import { readRenderConfig } from "./config";
import type { RenderConfig } from "./config";
import { LatestTaskScheduler } from "./latestTaskScheduler";
import { normalizePathForComparison, resolveWorkspaceRelativeRoot } from "./pathUtils";
import type { PdfRenderer } from "./pdfRenderer";
import { StaticWorkspaceServer } from "./staticServer";

interface RenderResult {
  pdf: Buffer;
  dependencies: Set<string>;
  durationMs: number;
}

type ViewerStatus =
  | { state: "idle"; message: string }
  | { state: "rendering"; message: string }
  | { state: "ready"; message: string }
  | { state: "error"; message: string };

interface PreviewSessionOptions {
  entryUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
  extensionUri: vscode.Uri;
  renderer: PdfRenderer;
  output: vscode.OutputChannel;
  onDispose(session: PreviewSession): void;
  onActivate(session: PreviewSession): void;
}

export class PreviewSession implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly scheduler: LatestTaskScheduler<RenderResult>;
  private readonly disposables: vscode.Disposable[] = [];
  private server: StaticWorkspaceServer | undefined;
  private serverRoot: string | undefined;
  private dependencies: Set<string>;
  private lastPdf: Buffer | undefined;
  private viewerReady = false;
  private disposed = false;
  private panelWasDisposed = false;
  private status: ViewerStatus = { state: "idle", message: "Waiting to render…" };

  public readonly entryUri: vscode.Uri;

  public constructor(private readonly options: PreviewSessionOptions) {
    this.entryUri = options.entryUri;
    this.dependencies = new Set([normalizePathForComparison(this.entryUri.fsPath)]);
    const mediaRoot = vscode.Uri.joinPath(options.extensionUri, "dist", "webview");
    this.panel = vscode.window.createWebviewPanel(
      "htmlLivePdf.preview",
      `PDF: ${path.basename(this.entryUri.fsPath)}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [mediaRoot],
      },
    );
    this.panel.webview.html = this.createWebviewHtml(mediaRoot);

    this.scheduler = new LatestTaskScheduler(
      (signal, revision) => this.performRender(signal, revision),
      {
        onSuccess: (result) => this.acceptRender(result),
        onError: (error) => this.acceptError(error),
      },
    );

    this.disposables.push(
      this.panel.onDidDispose(() => {
        this.panelWasDisposed = true;
        this.dispose();
        options.onDispose(this);
      }),
      this.panel.onDidChangeViewState((event) => {
        if (event.webviewPanel.active) {
          options.onActivate(this);
        }
      }),
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleViewerMessage(message);
      }),
    );
  }

  public start(): void {
    this.scheduler.runNow();
  }

  public reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside, true);
    this.options.onActivate(this);
  }

  public refresh(immediate = true): void {
    if (this.disposed) {
      return;
    }
    if (immediate) {
      this.scheduler.runNow();
    } else {
      this.scheduler.schedule(this.currentConfig().debounceMs);
    }
  }

  public notifyFileChanged(uri: vscode.Uri): void {
    if (
      !this.disposed &&
      uri.scheme === "file" &&
      this.dependencies.has(normalizePathForComparison(uri.fsPath))
    ) {
      this.refresh(false);
    }
  }

  public async exportPdf(): Promise<void> {
    if (!this.lastPdf) {
      void vscode.window.showWarningMessage("No successful PDF preview is available to export.");
      return;
    }

    const extension = path.extname(this.entryUri.path);
    const baseName = path.basename(this.entryUri.path, extension);
    const defaultUri = this.entryUri.with({
      path: path.posix.join(path.posix.dirname(this.entryUri.path), `${baseName}.pdf`),
    });
    const destination = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "PDF document": ["pdf"] },
      saveLabel: "Export PDF",
      title: "Export HTML preview as PDF",
    });
    if (!destination) {
      return;
    }

    await vscode.workspace.fs.writeFile(destination, Uint8Array.from(this.lastPdf));
    void vscode.window.showInformationMessage(`PDF exported to ${destination.fsPath}`);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.scheduler.dispose();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    const server = this.server;
    this.server = undefined;
    void server?.stop();
    if (!this.panelWasDisposed) {
      this.panel.dispose();
    }
  }

  private currentConfig(): RenderConfig {
    return readRenderConfig(
      vscode.workspace.getConfiguration("htmlLivePdf", this.entryUri),
    );
  }

  private async performRender(signal: AbortSignal, revision: number): Promise<RenderResult> {
    const startedAt = Date.now();
    const config = this.currentConfig();
    this.setStatus({ state: "rendering", message: "Rendering PDF…" });
    const server = await this.ensureServer(config);
    const capture = server.beginCapture();
    let captureEnded = false;

    try {
      const url = server.urlForFile(this.entryUri.fsPath, revision);
      const pdf = await this.options.renderer.render({
        url,
        config,
        signal,
        label: path.basename(this.entryUri.fsPath),
      });
      const dependencies = server.endCapture(capture);
      captureEnded = true;
      dependencies.add(normalizePathForComparison(this.entryUri.fsPath));
      return { pdf, dependencies, durationMs: Date.now() - startedAt };
    } finally {
      if (!captureEnded) {
        server.endCapture(capture);
      }
    }
  }

  private async ensureServer(config: RenderConfig): Promise<StaticWorkspaceServer> {
    const desiredRoot = resolveWorkspaceRelativeRoot(
      this.options.workspaceFolder.uri.fsPath,
      config.serverRoot,
    );
    if (this.server && this.serverRoot === normalizePathForComparison(desiredRoot)) {
      return this.server;
    }

    await this.server?.stop();
    const server = new StaticWorkspaceServer(desiredRoot);
    await server.start();
    this.server = server;
    this.serverRoot = normalizePathForComparison(desiredRoot);
    this.options.output.appendLine(
      `[${path.basename(this.entryUri.fsPath)}] serving ${desiredRoot} at ${server.origin}`,
    );
    return server;
  }

  private acceptRender(result: RenderResult): void {
    this.lastPdf = result.pdf;
    this.dependencies = result.dependencies;
    this.setStatus({
      state: "ready",
      message: `Rendered in ${result.durationMs.toLocaleString()} ms`,
    });
    this.postPdf();
  }

  private acceptError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    this.options.output.appendLine(
      `[${path.basename(this.entryUri.fsPath)}] render failed:\n${detail}`,
    );
    this.setStatus({ state: "error", message });
  }

  private setStatus(status: ViewerStatus): void {
    this.status = status;
    if (this.viewerReady) {
      void this.panel.webview.postMessage({ type: "status", ...status });
    }
  }

  private postPdf(): void {
    if (!this.viewerReady || !this.lastPdf) {
      return;
    }
    void this.panel.webview.postMessage({
      type: "pdf",
      data: Uint8Array.from(this.lastPdf),
      fileName: `${path.basename(this.entryUri.fsPath, path.extname(this.entryUri.fsPath))}.pdf`,
    });
  }

  private async handleViewerMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }
    const type = (message as { type?: unknown }).type;
    switch (type) {
      case "ready":
        this.viewerReady = true;
        void this.panel.webview.postMessage({ type: "status", ...this.status });
        this.postPdf();
        break;
      case "refresh":
        this.refresh();
        break;
      case "export":
        await this.exportPdf();
        break;
    }
  }

  private createWebviewHtml(mediaRoot: vscode.Uri): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "viewer.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "viewer.css"));
    const workerUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "pdf.worker.min.mjs"),
    );
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
      `worker-src ${webview.cspSource} blob:`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>PDF preview</title>
</head>
<body data-pdf-worker-uri="${escapeAttribute(workerUri.toString())}">
  <header class="toolbar" role="toolbar" aria-label="PDF preview controls">
    <button id="previous" type="button" title="Previous page" aria-label="Previous page">‹</button>
    <label class="page-control"><span class="sr-only">Page</span><input id="page-number" type="number" min="1" value="1" inputmode="numeric"><span id="page-total">/ 0</span></label>
    <button id="next" type="button" title="Next page" aria-label="Next page">›</button>
    <span class="separator" aria-hidden="true"></span>
    <button id="zoom-out" type="button" title="Zoom out (Ctrl/Cmd + wheel or pinch)" aria-label="Zoom out">−</button>
    <button id="zoom-label" type="button" title="Fit width">Fit width</button>
    <button id="zoom-in" type="button" title="Zoom in (Ctrl/Cmd + wheel or pinch)" aria-label="Zoom in">+</button>
    <span class="separator" aria-hidden="true"></span>
    <span id="paper-size" class="paper-size" title="Paper size">Paper: —</span>
    <span class="spacer"></span>
    <button id="refresh" type="button" title="Render again">Refresh</button>
    <button id="export" type="button" title="Export the current PDF" disabled>Export</button>
  </header>
  <div id="status" class="status" role="status" aria-live="polite">Waiting to render…</div>
  <main id="viewport" class="viewport">
    <div id="empty-state" class="empty-state">The PDF preview will appear here.</div>
    <canvas id="page-canvas" aria-label="Rendered PDF page" hidden></canvas>
  </main>
  <script type="module" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
