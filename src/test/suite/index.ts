import assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(
    "gede-oke.html-live-pdf-preview",
  );
  assert.ok(extension, "Extension is discoverable in the extension development host");
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("htmlLivePdf.openPreview"));
  assert.ok(commands.includes("htmlLivePdf.refreshPreview"));
  assert.ok(commands.includes("htmlLivePdf.exportPdf"));

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, "Fixture workspace is open");
  const entry = vscode.Uri.joinPath(workspaceFolder.uri, "index.html");
  const document = await vscode.workspace.openTextDocument(entry);
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand("htmlLivePdf.openPreview", entry);

  const deadline = Date.now() + 10_000;
  let previewFound = false;
  while (Date.now() < deadline && !previewFound) {
    previewFound = vscode.window.tabGroups.all.some((group) =>
      group.tabs.some((tab) => tab.label === "PDF: index.html"),
    );
    if (!previewFound) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const tabLabels = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.map((tab) => tab.label),
  );
  assert.ok(
    previewFound,
    `Open Preview creates the in-editor PDF webview; current tabs: ${tabLabels.join(", ")}`,
  );
}
