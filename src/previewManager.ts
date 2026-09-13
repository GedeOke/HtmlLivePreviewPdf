import * as vscode from "vscode";
import { normalizePathForComparison } from "./pathUtils";
import { PdfRenderer } from "./pdfRenderer";
import { PreviewSession } from "./previewSession";

export class PreviewManager implements vscode.Disposable {
  private readonly sessions = new Map<string, PreviewSession>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly renderer: PdfRenderer;
  private activeSession: PreviewSession | undefined;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {
    this.renderer = new PdfRenderer(context.extensionPath, output);
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    this.disposables.push(
      watcher,
      watcher.onDidChange((uri) => this.notifyFileChanged(uri)),
      watcher.onDidCreate((uri) => this.notifyFileChanged(uri)),
      watcher.onDidDelete((uri) => this.notifyFileChanged(uri)),
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.notifyFileChanged(document.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("htmlLivePdf")) {
          for (const session of this.sessions.values()) {
            session.refresh(false);
          }
        }
      }),
    );
  }

  public open(entryUri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): void {
    const key = normalizePathForComparison(entryUri.fsPath);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.reveal();
      return;
    }

    const session = new PreviewSession({
      entryUri,
      workspaceFolder,
      extensionUri: this.context.extensionUri,
      renderer: this.renderer,
      output: this.output,
      onActivate: (activated) => {
        this.activeSession = activated;
      },
      onDispose: (disposed) => {
        this.sessions.delete(key);
        if (this.activeSession === disposed) {
          this.activeSession = [...this.sessions.values()].at(-1);
        }
      },
    });
    this.sessions.set(key, session);
    this.activeSession = session;
    session.start();
  }

  public refreshActive(): void {
    const session = this.getActiveSession();
    if (!session) {
      void vscode.window.showInformationMessage("Open an HTML Live PDF preview first.");
      return;
    }
    session.refresh();
  }

  public async exportActive(): Promise<void> {
    const session = this.getActiveSession();
    if (!session) {
      void vscode.window.showInformationMessage("Open an HTML Live PDF preview first.");
      return;
    }
    await session.exportPdf();
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    for (const session of [...this.sessions.values()]) {
      session.dispose();
    }
    this.sessions.clear();
    void this.renderer.dispose();
  }

  private notifyFileChanged(uri: vscode.Uri): void {
    for (const session of this.sessions.values()) {
      session.notifyFileChanged(uri);
    }
  }

  private getActiveSession(): PreviewSession | undefined {
    return this.activeSession ?? [...this.sessions.values()].at(-1);
  }
}
