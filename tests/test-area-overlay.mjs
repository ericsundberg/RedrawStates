import test from "node:test";
import assert from "node:assert/strict";

import { createStateModel } from "../js/model/state-registry.mjs";
import { applyAreaOverlay } from "../js/data/area-overlay.mjs";

function dataset() {
  const model = createStateModel({
    states: [
      {
        id: "state:AL",
        name: "Alpha",
        abbreviation: "AL",
        kind: "state",
      },
    ],
    assignments: {
      "01001": "state:AL",
      "01003": "state:AL",
    },
  });

  return {
    metadata: {
      id: "2024",
      measurement: { kind: "population" },
    },
    model,
    counties: [
      {
        id: "01001",
        population: 600,
        landAreaM2: null,
        waterAreaM2: null,
        votes: { a: 60, b: 40 },
      },
      {
        id: "01003",
        population: 400,
        landAreaM2: null,
        waterAreaM2: null,
        votes: { a: 10, b: 80 },
      },
    ],
    candidateIds: ["a", "b"],
    topology: { objects: { counties: { geometries: [] } } },
  };
}

function overlay() {
  return {
    schema: "redraw-area-v1",
    geographyVintage: 2019,
    datasetIds: ["2024"],
    source: {
      publisher: "Test source",
      sha256: "a".repeat(64),
    },
    coverage: { kind: "legacy-inventory" },
    areas: {
      "01001": [2_000_000, 1_000_000],
      "01003": [1_000_000, 0],
    },
  };
}

test("area overlay recomputes land, water, total area, and density", () => {
  const result = applyAreaOverlay(dataset(), overlay());
  const total = result.totals[0];

  assert.equal(total.population, 1000);
  assert.equal(total.landAreaM2, 3_000_000);
  assert.equal(total.waterAreaM2, 1_000_000);
  assert.equal(total.totalAreaM2, 4_000_000);
  assert.ok(Math.abs(total.densityPerKm2 - 1000 / 3) < 1e-10);
});

test("source records are not mutated", () => {
  const original = dataset();
  const result = applyAreaOverlay(original, overlay());

  assert.equal(original.counties[0].landAreaM2, null);
  assert.equal(result.counties[0].landAreaM2, 2_000_000);
  assert.equal(result.model, original.model);
  assert.equal(result.topology, original.topology);
});

test("incomplete area inventories are rejected", () => {
  const source = overlay();
  delete source.areas["01003"];

  assert.throws(
    () => applyAreaOverlay(dataset(), source),
    /inventory mismatch/
  );
});

test("extra area records are rejected", () => {
  const source = overlay();
  source.areas["99999"] = [100, 0];

  assert.throws(
    () => applyAreaOverlay(dataset(), source),
    /inventory mismatch/
  );
});

test("invalid measurements are rejected", () => {
  const source = overlay();
  source.areas["01001"] = [-1, 0];

  assert.throws(
    () => applyAreaOverlay(dataset(), source),
    /Invalid area measurements/
  );
});