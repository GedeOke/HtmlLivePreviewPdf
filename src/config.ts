export const PAGE_FORMATS = ["A4", "A3", "A5", "Letter", "Legal"] as const;
export const READY_MODES = ["networkIdle", "selector", "windowFlag"] as const;

export type PageFormat = (typeof PAGE_FORMATS)[number];
export type ReadyMode = (typeof READY_MODES)[number];

export interface RenderConfig {
  serverRoot: string;
  pageFormat: PageFormat;
  landscape: boolean;
  printBackground: boolean;
  preferCssPageSize: boolean;
  readyMode: ReadyMode;
  readySelector: string;
  timeoutMs: number;
  debounceMs: number;
}

export interface ConfigurationSource {
  get<T>(section: string, defaultValue: T): T;
}

function enumValue<T extends string>(
  candidate: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof candidate === "string" && allowed.includes(candidate as T)
    ? (candidate as T)
    : fallback;
}

function boundedNumber(candidate: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? Math.min(maximum, Math.max(minimum, Math.round(candidate)))
    : fallback;
}

export function readRenderConfig(source: ConfigurationSource): RenderConfig {
  const serverRoot = source.get<unknown>("serverRoot", ".");
  const readySelector = source.get<unknown>(
    "readySelector",
    '[data-html-pdf-ready="true"]',
  );

  return {
    serverRoot: typeof serverRoot === "string" && serverRoot.trim() ? serverRoot.trim() : ".",
    pageFormat: enumValue(source.get<unknown>("pageFormat", "A4"), PAGE_FORMATS, "A4"),
    landscape: source.get<unknown>("landscape", false) === true,
    printBackground: source.get<unknown>("printBackground", true) !== false,
    preferCssPageSize: source.get<unknown>("preferCssPageSize", true) !== false,
    readyMode: enumValue(
      source.get<unknown>("readyMode", "networkIdle"),
      READY_MODES,
      "networkIdle",
    ),
    readySelector:
      typeof readySelector === "string" && readySelector.trim()
        ? readySelector.trim()
        : '[data-html-pdf-ready="true"]',
    timeoutMs: boundedNumber(source.get<unknown>("timeoutMs", 30_000), 30_000, 1_000, 120_000),
    debounceMs: boundedNumber(source.get<unknown>("debounceMs", 300), 300, 0, 5_000),
  };
}
