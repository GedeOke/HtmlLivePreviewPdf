import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
import "./viewer.css";
import {
  clampPage,
  fitWidthScale,
  paperSizeFromPoints,
  paperSizeLabel,
  stepScale,
  wheelScale,
} from "./viewerState";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

type StatusState = "idle" | "rendering" | "ready" | "error";
type ExtensionMessage =
  | { type: "status"; state: StatusState; message: string }
  | { type: "pdf"; data: Uint8Array | ArrayBuffer; fileName: string };

const vscode = acquireVsCodeApi();
const workerUri = document.body.dataset.pdfWorkerUri;
if (!workerUri) {
  throw new Error("PDF.js worker URI was not provided.");
}
GlobalWorkerOptions.workerSrc = workerUri;

const previousButton = element<HTMLButtonElement>("previous");
const nextButton = element<HTMLButtonElement>("next");
const pageNumberInput = element<HTMLInputElement>("page-number");
const pageTotal = element<HTMLSpanElement>("page-total");
const zoomOutButton = element<HTMLButtonElement>("zoom-out");
const zoomInButton = element<HTMLButtonElement>("zoom-in");
const zoomLabelButton = element<HTMLButtonElement>("zoom-label");
const paperSizeElement = element<HTMLSpanElement>("paper-size");
const refreshButton = element<HTMLButtonElement>("refresh");
const exportButton = element<HTMLButtonElement>("export");
const statusElement = element<HTMLDivElement>("status");
const viewportElement = element<HTMLElement>("viewport");
const emptyState = element<HTMLDivElement>("empty-state");
const canvas = element<HTMLCanvasElement>("page-canvas");

let pdf: PDFDocumentProxy | undefined;
let currentPage = 1;
let scale = 1;
let fitWidth = true;
let renderTask: RenderTask | undefined;
let renderRevision = 0;
let gestureRenderFrame = 0;
let pendingZoomAnchor: ZoomAnchor | undefined;

interface ZoomAnchor {
  xRatio: number;
  yRatio: number;
  clientX: number;
  clientY: number;
}

previousButton.addEventListener("click", () => {
  if (pdf && currentPage > 1) {
    currentPage -= 1;
    requestPageRender();
  }
});
nextButton.addEventListener("click", () => {
  if (pdf && currentPage < pdf.numPages) {
    currentPage += 1;
    requestPageRender();
  }
});
pageNumberInput.addEventListener("change", () => {
  if (pdf) {
    currentPage = clampPage(Number(pageNumberInput.value), pdf.numPages);
    requestPageRender();
  }
});
zoomOutButton.addEventListener("click", () => {
  fitWidth = false;
  scale = stepScale(scale, -1);
  requestPageRender();
});
zoomInButton.addEventListener("click", () => {
  fitWidth = false;
  scale = stepScale(scale, 1);
  requestPageRender();
});
zoomLabelButton.addEventListener("click", () => {
  fitWidth = true;
  requestPageRender();
});
viewportElement.addEventListener(
  "wheel",
  (event) => {
    if ((!event.ctrlKey && !event.metaKey) || !pdf) {
      return;
    }

    event.preventDefault();
    const nextScale = wheelScale(scale, wheelDeltaInPixels(event));
    if (nextScale === scale) {
      return;
    }

    pendingZoomAnchor = zoomAnchorAt(event.clientX, event.clientY);
    fitWidth = false;
    scale = nextScale;
    updateZoomLabel();
    scheduleGestureRender();
  },
  { passive: false },
);
refreshButton.addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
exportButton.addEventListener("click", () => vscode.postMessage({ type: "export" }));

let resizeFrame = 0;
const resizeObserver = new ResizeObserver(() => {
  if (!fitWidth || !pdf) {
    return;
  }
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => requestPageRender());
});
resizeObserver.observe(viewportElement);

window.addEventListener("message", (event: MessageEvent<ExtensionMessage>) => {
  const message = event.data;
  if (message.type === "status") {
    updateStatus(message.state, message.message);
  } else if (message.type === "pdf") {
    void loadPdf(message.data);
  }
});

async function loadPdf(data: Uint8Array | ArrayBuffer): Promise<void> {
  try {
    updateStatus("rendering", "Loading PDF preview…");
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const nextPdf = await getDocument({ data: bytes }).promise;
    const previousPdf = pdf;
    pdf = nextPdf;
    currentPage = clampPage(currentPage, nextPdf.numPages);
    exportButton.disabled = false;
    emptyState.hidden = true;
    canvas.hidden = false;
    await renderCurrentPage();
    updateStatus("ready", "Preview ready");
    await previousPdf?.destroy();
  } catch (error) {
    updateStatus("error", `Unable to display PDF: ${errorMessage(error)}`);
  }
}

async function renderCurrentPage(zoomAnchor?: ZoomAnchor): Promise<void> {
  const currentPdf = pdf;
  if (!currentPdf) {
    return;
  }
  const revision = ++renderRevision;
  renderTask?.cancel();
  const page = await currentPdf.getPage(currentPage);
  if (revision !== renderRevision) {
    page.cleanup();
    return;
  }

  const unscaledViewport = page.getViewport({ scale: 1 });
  const actualScale = fitWidth ? calculateFitScale(page) : scale;
  scale = actualScale;
  const viewport = page.getViewport({ scale: actualScale });
  const outputScale = window.devicePixelRatio || 1;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Canvas 2D rendering is unavailable.");
  }

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  restoreZoomAnchor(zoomAnchor);
  renderTask = page.render({
    canvasContext: context,
    viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  });
  try {
    await renderTask.promise;
  } catch (error) {
    if (!(error instanceof Error && error.name === "RenderingCancelledException")) {
      throw error;
    }
  } finally {
    if (revision === renderRevision) {
      renderTask = undefined;
    }
  }

  if (revision === renderRevision) {
    pageNumberInput.value = String(currentPage);
    pageNumberInput.max = String(currentPdf.numPages);
    pageTotal.textContent = `/ ${currentPdf.numPages}`;
    previousButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= currentPdf.numPages;
    updateZoomLabel();
    updatePaperSize(unscaledViewport.width, unscaledViewport.height);
  }
}

function requestPageRender(zoomAnchor?: ZoomAnchor): void {
  void renderCurrentPage(zoomAnchor).catch((error: unknown) => {
    updateStatus("error", `Unable to render PDF page: ${errorMessage(error)}`);
  });
}

function calculateFitScale(page: PDFPageProxy): number {
  const unscaled = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(1, viewportElement.clientWidth - 48);
  return fitWidthScale(availableWidth, unscaled.width);
}

function scheduleGestureRender(): void {
  if (gestureRenderFrame !== 0) {
    return;
  }
  gestureRenderFrame = requestAnimationFrame(() => {
    gestureRenderFrame = 0;
    const zoomAnchor = pendingZoomAnchor;
    pendingZoomAnchor = undefined;
    requestPageRender(zoomAnchor);
  });
}

function wheelDeltaInPixels(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * Math.max(1, viewportElement.clientHeight);
  }
  return event.deltaY;
}

function zoomAnchorAt(clientX: number, clientY: number): ZoomAnchor | undefined {
  if (canvas.hidden) {
    return undefined;
  }
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return undefined;
  }
  return {
    xRatio: clampRatio((clientX - bounds.left) / bounds.width),
    yRatio: clampRatio((clientY - bounds.top) / bounds.height),
    clientX,
    clientY,
  };
}

function restoreZoomAnchor(anchor: ZoomAnchor | undefined): void {
  if (!anchor) {
    return;
  }
  const bounds = canvas.getBoundingClientRect();
  const anchoredX = bounds.left + bounds.width * anchor.xRatio;
  const anchoredY = bounds.top + bounds.height * anchor.yRatio;
  viewportElement.scrollLeft += anchoredX - anchor.clientX;
  viewportElement.scrollTop += anchoredY - anchor.clientY;
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function updateZoomLabel(): void {
  zoomLabelButton.textContent = fitWidth ? "Fit width" : `${Math.round(scale * 100)}%`;
}

function updatePaperSize(widthPoints: number, heightPoints: number): void {
  const paper = paperSizeFromPoints(widthPoints, heightPoints);
  paperSizeElement.textContent = paperSizeLabel(paper);
  paperSizeElement.title = `Paper size: ${paper.name}, ${paper.widthMm} × ${paper.heightMm} mm, ${paper.orientation}`;
}

function updateStatus(state: StatusState, message: string): void {
  statusElement.dataset.state = state;
  statusElement.textContent = message;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing viewer element: ${id}`);
  }
  return value as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

vscode.postMessage({ type: "ready" });
