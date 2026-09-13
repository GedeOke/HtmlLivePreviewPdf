import path from "node:path";
import * as vscode from "vscode";
import { PreviewManager } from "./previewManager";

let manager: PreviewManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("HTML Live PDF Preview", { log: true });
  manager = new PreviewManager(context, output);
  context.subscriptions.push(
    output,
    manager,
    vscode.commands.registerCommand("htmlLivePdf.openPreview", async (resource?: vscode.Uri) => {
      const entry = await resolveHtmlEntry(resource);
      if (!entry) {
        return;
      }
      const workspaceFolder = validateEntry(entry);
      if (!workspaceFolder) {
        return;
      }
      manager?.open(entry, workspaceFolder);
    }),
    vscode.commands.registerCommand("htmlLivePdf.refreshPreview", () => {
      manager?.refreshActive();
    }),
    vscode.commands.registerCommand("htmlLivePdf.exportPdf", async () => {
      await manager?.exportActive();
    }),
  );
  output.info("HTML Live PDF Preview activated.");
}

export function deactivate(): void {
  manager?.dispose();
  manager = undefined;
}

async function resolveHtmlEntry(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (resource?.scheme === "file" && isHtml(resource)) {
    return resource;
  }
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme === "file" && isHtml(activeUri)) {
    return activeUri;
  }

  const candidates = await vscode.workspace.findFiles(
    "**/*.html",
    "**/{node_modules,dist,out,build,vendor}/**",
    500,
  );
  if (candidates.length === 0) {
    void vscode.window.showWarningMessage("No HTML files were found in this workspace.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map((uri) => ({
      label: vscode.workspace.asRelativePath(uri, false),
      description: uri.fsPath,
      uri,
    })),
    { placeHolder: "Choose an HTML file to preview as PDF", matchOnDescription: true },
  );
  return picked?.uri;
}

function validateEntry(entry: vscode.Uri): vscode.WorkspaceFolder | undefined {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showErrorMessage(
      "Trust this workspace before running HTML and JavaScript in the PDF renderer.",
    );
    return undefined;
  }
  if (vscode.env.remoteName) {
    void vscode.window.showErrorMessage(
      "HTML Live PDF Preview v1 supports local desktop workspaces only, not Remote/WSL sessions.",
    );
    return undefined;
  }
  if (entry.scheme !== "file" || !isHtml(entry)) {
    void vscode.window.showErrorMessage("Choose a local .html file inside the workspace.");
    return undefined;
  }
  const folder = vscode.workspace.getWorkspaceFolder(entry);
  if (!folder || folder.uri.scheme !== "file") {
    void vscode.window.showErrorMessage("The HTML file must be inside a local workspace folder.");
    return undefined;
  }
  return folder;
}

function isHtml(uri: vscode.Uri): boolean {
  return path.extname(uri.path).toLowerCase() === ".html";
}
