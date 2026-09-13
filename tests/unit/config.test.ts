import { describe, expect, it } from "vitest";
import { readRenderConfig, type ConfigurationSource } from "../../src/config";

function source(values: Record<string, unknown>): ConfigurationSource {
  return {
    get<T>(section: string, defaultValue: T): T {
      return (section in values ? values[section] : defaultValue) as T;
    },
  };
}

describe("readRenderConfig", () => {
  it("returns the documented defaults", () => {
    expect(readRenderConfig(source({}))).toEqual({
      serverRoot: ".",
      pageFormat: "A4",
      landscape: false,
      printBackground: true,
      preferCssPageSize: true,
      readyMode: "networkIdle",
      readySelector: '[data-html-pdf-ready="true"]',
      timeoutMs: 30_000,
      debounceMs: 300,
    });
  });

  it("normalizes invalid and out-of-range values", () => {
    const result = readRenderConfig(
      source({
        serverRoot: " ",
        pageFormat: "Tabloid",
        readyMode: "delay",
        readySelector: " ",
        timeoutMs: 999_999,
        debounceMs: -10,
      }),
    );
    expect(result.pageFormat).toBe("A4");
    expect(result.readyMode).toBe("networkIdle");
    expect(result.readySelector).toBe('[data-html-pdf-ready="true"]');
    expect(result.timeoutMs).toBe(120_000);
    expect(result.debounceMs).toBe(0);
  });
});
