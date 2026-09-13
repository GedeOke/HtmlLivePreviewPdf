import { describe, expect, it } from "vitest";
import {
  clampPage,
  fitWidthScale,
  paperSizeFromPoints,
  paperSizeLabel,
  stepScale,
  wheelScale,
} from "../../src/webview/viewerState";

describe("viewer state", () => {
  it("clamps page navigation", () => {
    expect(clampPage(-4, 3)).toBe(1);
    expect(clampPage(99, 3)).toBe(3);
    expect(clampPage(2, 3)).toBe(2);
  });

  it("steps and clamps zoom", () => {
    expect(stepScale(1, 1)).toBe(1.25);
    expect(stepScale(0.25, -1)).toBe(0.25);
    expect(stepScale(4, 1)).toBe(4);
  });

  it("calculates fit-width scale", () => {
    expect(fitWidthScale(500, 1000)).toBe(0.5);
    expect(fitWidthScale(0, 1000)).toBe(1);
  });

  it("zooms smoothly from a mouse wheel or touchpad pinch", () => {
    expect(wheelScale(1, -100)).toBe(1.2);
    expect(wheelScale(1, 100)).toBe(0.8333);
    expect(wheelScale(0.25, 100)).toBe(0.25);
    expect(wheelScale(4, -100)).toBe(4);
  });

  it("identifies actual PDF paper size and orientation", () => {
    const portrait = paperSizeFromPoints(595.28, 841.89);
    expect(portrait).toEqual({
      name: "A4",
      widthMm: 210,
      heightMm: 297,
      orientation: "portrait",
    });
    expect(paperSizeLabel(portrait)).toBe("A4 · 210 × 297 mm");

    expect(paperSizeFromPoints(792, 612)).toMatchObject({
      name: "Letter",
      widthMm: 279.4,
      heightMm: 215.9,
      orientation: "landscape",
    });
    expect(paperSizeFromPoints(500, 500)).toMatchObject({
      name: "Custom",
      orientation: "square",
    });
  });
});
