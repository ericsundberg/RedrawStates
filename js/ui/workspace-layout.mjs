/**
 * Pure layout calculations for the docked workspace.
 */

export const PANEL_IDS = Object.freeze([
  "details",
  "instructions",
  "about",
]);

export function getDockBounds(viewportHeight) {
  const height = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;

  const available = Math.max(0, height - 60);

  if (available === 0) {
    return { min: 0, max: 0 };
  }

  const minimum = Math.min(160, available * 0.45);
  const reservedMap = Math.min(260, Math.max(120, available * 0.45));

  const maximum = Math.max(
    minimum,
    Math.min(available - reservedMap, available * 0.65)
  );

  return {
    min: Math.round(minimum),
    max: Math.round(maximum),
  };
}

export function clampDockHeight(requestedHeight, viewportHeight) {
  const bounds = getDockBounds(viewportHeight);

  const requested = Number.isFinite(requestedHeight)
    ? requestedHeight
    : bounds.min;

  return Math.round(
    Math.max(bounds.min, Math.min(bounds.max, requested))
  );
}

export function dockHeightFromPercentage(percentage, viewportHeight) {
  const bounds = getDockBounds(viewportHeight);
  const value = Number.isFinite(percentage) ? percentage : 0;
  const fraction = Math.max(0, Math.min(100, value)) / 100;

  return clampDockHeight(
    bounds.min + (bounds.max - bounds.min) * fraction,
    viewportHeight
  );
}

export function dockPercentageFromHeight(height, viewportHeight) {
  const bounds = getDockBounds(viewportHeight);

  if (bounds.max === bounds.min) {
    return 0;
  }

  const clamped = clampDockHeight(height, viewportHeight);

  return Math.round(
    ((clamped - bounds.min) / (bounds.max - bounds.min)) * 100
  );
}

export function normalizePanelId(panelId) {
  return PANEL_IDS.includes(panelId) ? panelId : "details";
}