import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RenderConfig } from "../../src/config";
import { PdfRenderer } from "../../src/pdfRenderer";
import { StaticWorkspaceServer } from "../../src/staticServer";

let root = "";
let server: StaticWorkspaceServer;
let renderer: PdfRenderer;
const config: RenderConfig = {
  serverRoot: ".",
  pageFormat: "A4",
  landscape: false,
  printBackground: true,
  preferCssPageSize: true,
  readyMode: "windowFlag",
  readySelector: '[data-html-pdf-ready="true"]',
  timeoutMs: 30_000,
  debounceMs: 0,
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "html-live-pdf-renderer-"));
  await writeFile(path.join(root, "data.json"), JSON.stringify({ message: "Dynamic API value" }), "utf8");
  await writeFile(
    path.join(root, "index.html"),
    `<!doctype html><html><body><h1 id="value">Loading</h1><script>
      fetch('./data.json').then(r => r.json()).then(data => {
        setTimeout(() => {
          document.querySelector('#value').textContent = data.message;
          window.__HTML_LIVE_PDF_READY__ = true;
        }, 50);
      });
    </script></body></html>`,
    "utf8",
  );
  server = new StaticWorkspaceServer(root);
  await server.start();
  renderer = new PdfRenderer(process.cwd(), { appendLine: () => undefined });
});

afterAll(async () => {
  await renderer.dispose();
  await server.stop();
  await rm(root, { recursive: true, force: true });
});

describe("PdfRenderer", () => {
  it("waits for dynamic API data and produces a readable PDF", async () => {
    const capture = server.beginCapture();
    const pdfBytes = await renderer.render({
      url: server.urlForFile(path.join(root, "index.html")),
      config,
      signal: new AbortController().signal,
      label: "browser test",
    });
    const dependencies = server.endCapture(capture);
    expect(dependencies.size).toBeGreaterThanOrEqual(2);

    expect(await extractPdfText(pdfBytes)).toContain("Dynamic API value");
  });

  it("renders the included dynamic invoice sample", async () => {
    const sampleRoot = path.join(process.cwd(), "examples", "invoice");
    const sampleData = JSON.parse(
      await readFile(path.join(sampleRoot, "invoice-data.json"), "utf8"),
    ) as {
      invoiceNumber: string;
      projectName: string;
      customer: { name: string };
    };
    const sampleServer = new StaticWorkspaceServer(sampleRoot);
    await sampleServer.start();
    const capture = sampleServer.beginCapture();
    try {
      const pdfBytes = await renderer.render({
        url: sampleServer.urlForFile(path.join(sampleRoot, "index.html")),
        config,
        signal: new AbortController().signal,
        label: "invoice sample",
      });
      const dependencies = sampleServer.endCapture(capture);
      expect(dependencies.size).toBeGreaterThanOrEqual(4);
      const text = withoutWhitespace(await extractPdfText(pdfBytes));
      expect(text).toContain(withoutWhitespace(sampleData.invoiceNumber));
      expect(text).toContain(withoutWhitespace(sampleData.customer.name));
      expect(text).toContain(withoutWhitespace(sampleData.projectName));
    } finally {
      await sampleServer.stop();
    }
  });
});

async function extractPdfText(pdfBytes: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({ data: Uint8Array.from(pdfBytes) }).promise;
  try {
    const pages = await Promise.all(
      Array.from({ length: document.numPages }, async (_value, index) => {
        const page = await document.getPage(index + 1);
        const content = await page.getTextContent();
        return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      }),
    );
    return pages.join(" ");
  } finally {
    await document.destroy();
  }
}

function withoutWhitespace(value: string): string {
  return value.replaceAll(/\s/g, "");
}
