import { chromium, type Browser, type BrowserContext } from "playwright-core";
import type { RenderConfig } from "./config";
import { abortError } from "./latestTaskScheduler";
import { locateBundledBrowser } from "./browserLocator";

export interface LogSink {
  appendLine(value: string): void;
}

export interface PdfRenderRequest {
  url: string;
  config: RenderConfig;
  signal: AbortSignal;
  label: string;
}

export class PdfRenderer {
  private browserPromise: Promise<Browser> | undefined;

  public constructor(
    private readonly extensionPath: string,
    private readonly output: LogSink,
  ) {}

  public async render(request: PdfRenderRequest): Promise<Buffer> {
    this.throwIfAborted(request.signal);
    const browser = await this.getBrowser(request.config.timeoutMs);
    this.throwIfAborted(request.signal);

    let context: BrowserContext | undefined;
    const abortListener = (): void => {
      if (context) {
        void context.close().catch(() => undefined);
      }
    };
    request.signal.addEventListener("abort", abortListener, { once: true });

    try {
      context = await browser.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(request.config.timeoutMs);
      page.setDefaultNavigationTimeout(request.config.timeoutMs);
      page.on("console", (message) => {
        this.output.appendLine(`[${request.label}] console.${message.type()}: ${message.text()}`);
      });
      page.on("pageerror", (error) => {
        this.output.appendLine(`[${request.label}] page error: ${error.stack ?? error.message}`);
      });
      page.on("requestfailed", (failedRequest) => {
        this.output.appendLine(
          `[${request.label}] request failed: ${failedRequest.method()} ${failedRequest.url()} - ${failedRequest.failure()?.errorText ?? "unknown error"}`,
        );
      });
      page.on("response", (response) => {
        if (response.status() >= 400) {
          this.output.appendLine(
            `[${request.label}] HTTP ${response.status()}: ${response.request().method()} ${response.url()}`,
          );
        }
      });

      await page.emulateMedia({ media: "print" });
      const navigation = await page.goto(request.url, {
        waitUntil: "domcontentloaded",
        timeout: request.config.timeoutMs,
      });
      if (!navigation || navigation.status() >= 400) {
        throw new Error(
          `Unable to load HTML entry (${navigation?.status() ?? "no response"}): ${request.url}`,
        );
      }

      switch (request.config.readyMode) {
        case "networkIdle":
          await page.waitForLoadState("networkidle", { timeout: request.config.timeoutMs });
          break;
        case "selector":
          await page.waitForSelector(request.config.readySelector, {
            state: "attached",
            timeout: request.config.timeoutMs,
          });
          break;
        case "windowFlag":
          await page.waitForFunction(
            () =>
              (globalThis as typeof globalThis & { __HTML_LIVE_PDF_READY__?: boolean })
                .__HTML_LIVE_PDF_READY__ === true,
            undefined,
            { timeout: request.config.timeoutMs },
          );
          break;
      }

      await page.evaluate(async (timeoutMs) => {
        const assetsReady = (async (): Promise<void> => {
          await document.fonts?.ready;
          await Promise.all(
            Array.from(document.images).map(async (image) => {
              if (!image.complete) {
                await new Promise<void>((resolve) => {
                  image.addEventListener("load", () => resolve(), { once: true });
                  image.addEventListener("error", () => resolve(), { once: true });
                });
              }
              await image.decode?.().catch(() => undefined);
            }),
          );
        })();
        const timeout = new Promise<never>((_resolve, reject) => {
          globalThis.setTimeout(
            () => reject(new Error(`Timed out waiting for fonts and images after ${timeoutMs} ms.`)),
            timeoutMs,
          );
        });
        await Promise.race([assetsReady, timeout]);
      }, request.config.timeoutMs);
      this.throwIfAborted(request.signal);

      const data = await page.pdf({
        format: request.config.pageFormat,
        landscape: request.config.landscape,
        preferCSSPageSize: request.config.preferCssPageSize,
        printBackground: request.config.printBackground,
      });
      this.throwIfAborted(request.signal);
      return Buffer.from(data);
    } catch (error) {
      if (request.signal.aborted) {
        throw abortError();
      }
      throw error;
    } finally {
      request.signal.removeEventListener("abort", abortListener);
      await context?.close().catch(() => undefined);
    }
  }

  public async dispose(): Promise<void> {
    const browserPromise = this.browserPromise;
    this.browserPromise = undefined;
    if (browserPromise) {
      const browser = await browserPromise.catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }
  }

  private async getBrowser(timeoutMs: number): Promise<Browser> {
    if (!this.browserPromise) {
      const launchPromise = (async () => {
        const executablePath = await locateBundledBrowser(this.extensionPath);
        this.output.appendLine(`Starting bundled Chromium: ${executablePath}`);
        const browser = await chromium.launch({
          executablePath,
          headless: true,
          timeout: timeoutMs,
        });
        browser.once("disconnected", () => {
          if (this.browserPromise === launchPromise) {
            this.browserPromise = undefined;
          }
          this.output.appendLine("Bundled Chromium disconnected.");
        });
        return browser;
      })();
      this.browserPromise = launchPromise;
      void launchPromise.catch(() => {
        if (this.browserPromise === launchPromise) {
          this.browserPromise = undefined;
        }
      });
    }
    return this.browserPromise;
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw abortError();
    }
  }
}
