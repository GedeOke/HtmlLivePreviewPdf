import path from "node:path";
import process from "node:process";
import { runTests } from "@vscode/test-electron";

const root = process.cwd();
delete process.env.ELECTRON_RUN_AS_NODE;

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, "dist", "test", "suite", "index.js"),
    launchArgs: [path.join(root, "tests", "fixtures", "workspace")],
  });
} catch (error) {
  process.stderr.write(`Extension tests failed: ${String(error)}\n`);
  process.exitCode = 1;
}
