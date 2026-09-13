import path from "node:path";

export function normalizePathForComparison(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function resolveWorkspaceRelativeRoot(workspacePath: string, configuredRoot: string): string {
  if (path.isAbsolute(configuredRoot)) {
    throw new Error("htmlLivePdf.serverRoot must be relative to the workspace folder.");
  }

  const resolved = path.resolve(workspacePath, configuredRoot);
  if (!isPathInside(path.resolve(workspacePath), resolved)) {
    throw new Error("htmlLivePdf.serverRoot cannot point outside the workspace folder.");
  }
  return resolved;
}
