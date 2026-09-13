export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
export const ZOOM_STEP = 0.25;

const POINTS_PER_INCH = 72;
const MILLIMETERS_PER_INCH = 25.4;
const PAPER_MATCH_TOLERANCE_MM = 2;

const PAPER_SIZES = [
  { name: "A3", shortMm: 297, longMm: 420 },
  { name: "A4", shortMm: 210, longMm: 297 },
  { name: "A5", shortMm: 148, longMm: 210 },
  { name: "Letter", shortMm: 215.9, longMm: 279.4 },
  { name: "Legal", shortMm: 215.9, longMm: 355.6 },
] as const;

export interface PaperSizeInfo {
  name: string;
  widthMm: number;
  heightMm: number;
  orientation: "portrait" | "landscape" | "square";
}

export function clampPage(page: number, totalPages: number): number {
  if (totalPages < 1) {
    return 1;
  }
  return Math.min(totalPages, Math.max(1, Math.round(page)));
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function stepScale(scale: number, direction: -1 | 1): number {
  return clampScale(Math.round((scale + direction * ZOOM_STEP) * 100) / 100);
}

export function wheelScale(scale: number, deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return clampScale(scale);
  }

  const change = Math.min(0.2, Math.max(0.01, Math.abs(deltaY) * 0.002));
  const factor = deltaY < 0 ? 1 + change : 1 / (1 + change);
  return clampScale(Math.round(scale * factor * 10_000) / 10_000);
}

export function fitWidthScale(containerWidth: number, pageWidthAtScaleOne: number): number {
  if (containerWidth <= 0 || pageWidthAtScaleOne <= 0) {
    return 1;
  }
  return clampScale(containerWidth / pageWidthAtScaleOne);
}

export function paperSizeFromPoints(widthPoints: number, heightPoints: number): PaperSizeInfo {
  const widthMm = roundMillimeters(pointsToMillimeters(widthPoints));
  const heightMm = roundMillimeters(pointsToMillimeters(heightPoints));
  const shortMm = Math.min(widthMm, heightMm);
  const longMm = Math.max(widthMm, heightMm);
  const match = PAPER_SIZES.find(
    (paper) =>
      Math.abs(paper.shortMm - shortMm) <= PAPER_MATCH_TOLERANCE_MM &&
      Math.abs(paper.longMm - longMm) <= PAPER_MATCH_TOLERANCE_MM,
  );

  return {
    name: match?.name ?? "Custom",
    widthMm,
    heightMm,
    orientation:
      Math.abs(widthMm - heightMm) < 0.1
        ? "square"
        : widthMm > heightMm
          ? "landscape"
          : "portrait",
  };
}

export function paperSizeLabel(info: PaperSizeInfo): string {
  return `${info.name} · ${formatMillimeters(info.widthMm)} × ${formatMillimeters(info.heightMm)} mm`;
}

function pointsToMillimeters(points: number): number {
  if (!Number.isFinite(points) || points <= 0) {
    return 0;
  }
  return (points * MILLIMETERS_PER_INCH) / POINTS_PER_INCH;
}

function roundMillimeters(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatMillimeters(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
