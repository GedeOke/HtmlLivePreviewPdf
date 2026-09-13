# HTML Live PDF Preview

Internal VS Code extension for rendering a local HTML file as a live PDF preview. The
preview stays inside VS Code, runs the page's JavaScript and API requests in an isolated
headless Chromium context, and refreshes after a relevant file is saved.

## Use

1. Install the VSIX matching your machine: `win32-x64`, `darwin-x64`, or
   `darwin-arm64`.
2. Open a trusted local workspace and an `.html` file.
3. Run **HTML Live PDF: Open Live PDF Preview** from the editor toolbar, context menu,
   Explorer, or Command Palette.
4. Edit and save the HTML, CSS, JavaScript, JSON, image, or font used by the page. The
   PDF preview on the right updates automatically.
5. Use **Export** in the preview only when a PDF file should be written to disk.

The viewer toolbar shows the actual paper size detected from the rendered PDF, including
CSS `@page` overrides. Use the zoom buttons, hold `Ctrl`/`Cmd` while scrolling the mouse
wheel, or pinch on a touchpad to zoom around the pointer. Normal scrolling remains
available without the modifier key.

The extension serves the workspace on a loopback-only random port. Browser CORS rules
still apply, browser cookies are not reused, and the page remains responsible for its
own API authentication.

## Included sample

Open `examples/invoice/index.html` and run **HTML Live PDF: Open Live PDF Preview**.
The sample fetches `invoice-data.json`, renders a polished
A4 invoice, and exposes both the selector and window-flag readiness signals.

## Dynamic-page readiness

The default `htmlLivePdf.readyMode` is `networkIdle`. Pages with polling or long-lived
connections can instead choose one of these workspace settings:

```json
{
  "htmlLivePdf.readyMode": "selector",
  "htmlLivePdf.readySelector": "[data-html-pdf-ready=\"true\"]"
}
```

or:

```json
{
  "htmlLivePdf.readyMode": "windowFlag"
}
```

For `windowFlag`, set the flag after all API data has been rendered:

```js
window.__HTML_LIVE_PDF_READY__ = true;
```

The renderer additionally waits for `document.fonts.ready` and all page images before
printing.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `htmlLivePdf.serverRoot` | `.` | Workspace-relative static server root. |
| `htmlLivePdf.pageFormat` | `A4` | `A4`, `A3`, `A5`, `Letter`, or `Legal`. |
| `htmlLivePdf.landscape` | `false` | Use landscape pages. |
| `htmlLivePdf.printBackground` | `true` | Include CSS backgrounds. |
| `htmlLivePdf.preferCssPageSize` | `true` | Prefer CSS `@page` size. |
| `htmlLivePdf.readyMode` | `networkIdle` | Readiness strategy. |
| `htmlLivePdf.readySelector` | `[data-html-pdf-ready="true"]` | Selector readiness marker. |
| `htmlLivePdf.timeoutMs` | `30000` | Browser/navigation/readiness timeout. |
| `htmlLivePdf.debounceMs` | `300` | Delay after a relevant save. |

Use print CSS and `@page` for document-specific page size, margins, and pagination:

```css
@page {
  size: A4;
  margin: 12mm;
}

@media print {
  .screen-only { display: none; }
}
```

## Development

Node.js 22 is the supported development toolchain and is used by release CI.

```text
npm install
npm run browser:install
npm run check
npm run test:browser
npm run build
```

Press `F5` in VS Code to launch the Extension Development Host with the included HTML
fixture. `npm run browser:install` downloads the Playwright-pinned headless Chromium to
the ignored `vendor/playwright` directory.

Create the VSIX for the current native platform only:

```text
npm run package -- win32-x64
npm run package -- darwin-x64
npm run package -- darwin-arm64
```

Packaging deliberately fails when the requested target does not match the host or the
bundled Chromium manifest. Tagged GitHub Actions builds create all three VSIX files and
`SHA256SUMS.txt`.

## Supported scope

- Local trusted workspaces on Windows x64, macOS Intel, and macOS Apple Silicon.
- Static `.html` entries and their workspace-local dependencies.
- External API calls made by the page under normal browser security rules.

VS Code Web, Linux, virtual workspaces, Remote SSH, WSL, Codespaces, dev-server URLs,
credential injection, shared browser profiles, and CORS bypass are intentionally outside
v1 scope.
