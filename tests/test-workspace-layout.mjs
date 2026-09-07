import test from "node:test";
import assert from "node:assert/strict";

import {
  PANEL_IDS,
  clampDockHeight,
  dockHeightFromPercentage,
  dockPercentageFromHeight,
  getDockBounds,
  normalizePanelId,
} from "../js/ui/workspace-layout.mjs";

test("exposes only the supported information panels", () => {
  assert.deepEqual(PANEL_IDS, [
    "details",
    "instructions",
    "about",
  ]);

  assert.equal(normalizePanelId("details"), "details");
  assert.equal(normalizePanelId("about"), "about");
  assert.equal(normalizePanelId("unknown"), "details");
});

test("reserves space for the map at normal viewport heights", () => {
  const bounds = getDockBounds(900);

  assert.ok(bounds.min > 0);
  assert.ok(bounds.max > bounds.min);
  assert.ok(bounds.max < 900 - 60);
});

test("clamps requested dock heights", () => {
  const bounds = getDockBounds(900);

  assert.equal(clampDockHeight(-100, 900), bounds.min);
  assert.equal(clampDockHeight(100000, 900), bounds.max);
  assert.equal(clampDockHeight(300, 900), 300);
});

test("handles small and invalid viewport sizes", () => {
  assert.deepEqual(getDockBounds(0), { min: 0, max: 0 });
  assert.deepEqual(getDockBounds(Number.NaN), { min: 0, max: 0 });

  const bounds = getDockBounds(320);

  assert.ok(bounds.min >= 0);
  assert.ok(bounds.max >= bounds.min);
  assert.ok(bounds.max < 320);
});

test("converts between range percentages and pixel heights", () => {
  const bounds = getDockBounds(1000);

  assert.equal(dockHeightFromPercentage(0, 1000), bounds.min);
  assert.equal(dockHeightFromPercentage(100, 1000), bounds.max);

  assert.equal(dockPercentageFromHeight(bounds.min, 1000), 0);
  assert.equal(dockPercentageFromHeight(bounds.max, 1000), 100);
});

test("percentage controls clamp out-of-range values", () => {
  const bounds = getDockBounds(800);

  assert.equal(dockHeightFromPercentage(-50, 800), bounds.min);
  assert.equal(dockHeightFromPercentage(150, 800), bounds.max);
});

test("larger range values produce larger dock heights", () => {
  const small = dockHeightFromPercentage(20, 900);
  const medium = dockHeightFromPercentage(50, 900);
  const large = dockHeightFromPercentage(80, 900);

  assert.ok(small < medium);
  assert.ok(medium < large);
});