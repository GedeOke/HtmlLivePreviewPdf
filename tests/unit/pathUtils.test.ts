import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPathInside, resolveWorkspaceRelativeRoot } from "../../src/pathUtils";

describe("path utilities", () => {
  it("recognizes descendants without accepting sibling-prefix paths", () => {
    const root = path.resolve("workspace", "site");
    expect(isPathInside(root, path.join(root, "assets", "app.css"))).toBe(true);
    expect(isPathInside(root, path.resolve("workspace", "site-other", "app.css"))).toBe(false);
  });

  it("rejects absolute and escaping server roots", () => {
    const workspace = path.resolve("workspace");
    expect(() => resolveWorkspaceRelativeRoot(workspace, path.parse(workspace).root)).toThrow(
      /relative/u,
    );
    expect(() => resolveWorkspaceRelativeRoot(workspace, "../outside")).toThrow(/outside/u);
  });
});
