import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  loadLegacyDataset,
} from "../js/data/legacy-datasets.mjs";

import {
  loadPresetCatalog,
} from "../js/presets/preset-catalog.mjs";

import {
  applyPresetPatch,
} from "../js/presets/preset-model.mjs";

const root = new URL("../", import.meta.url);

async function readJson(path) {
  return JSON.parse(
    await readFile(new URL(path, root), "utf8")
  );
}

const expectedCounties = [
  "51013", // Arlington County
  "51059", // Fairfax County
  "51107", // Loudoun County
  "51153", // Prince William County
  "51510", // Alexandria city
  "51600", // Fairfax city
  "51610", // Falls Church city
  "51683", // Manassas city
  "51685", // Manassas Park city
];

const destination = "custom:preset:northern-virginia";

let fixturePromise;

function fixture() {
  if (!fixturePromise) {
    fixturePromise = (async () => {
      const dataset = await loadLegacyDataset("2024", readJson);
      const catalog = await loadPresetCatalog(dataset, readJson);

      const preset = catalog.find(
        (item) => item.id === "builtin:northern-virginia"
      );

      assert.ok(preset, "Northern Virginia is missing from the catalog.");

      return { dataset, preset };
    })();
  }

  return fixturePromise;
}

test("Northern Virginia contains the exact nine jurisdictions", async () => {
  const { preset } = await fixture();

  assert.deepEqual(
    preset.moves.map(([countyId]) => countyId).sort(),
    [...expectedCounties].sort()
  );

  assert.ok(
    preset.moves.every(([, stateId]) => stateId === destination)
  );

  assert.equal(preset.states.length, 1);
  assert.equal(preset.states[0].name, "Northern Virginia");
  assert.equal(preset.states[0].abbreviation, "VN");
  assert.deepEqual(preset.removeStates, []);
});

test("Northern Virginia preserves all unrelated assignments", async () => {
  const { dataset, preset } = await fixture();
  const original = dataset.model;
  const before = JSON.stringify(dataset.counties);

  const model = applyPresetPatch(
    original,
    preset,
    dataset
  ).model;

  const expected = {
    ...original.assignments,
  };

  for (const countyId of expectedCounties) {
    expected[countyId] = destination;
  }

  assert.deepEqual(model.assignments, expected);

  assert.equal(
    Object.keys(model.assignments).length,
    Object.keys(original.assignments).length
  );

  assert.equal(
    model.states.find((state) => state.id === "state:VA").name,
    "Virginia"
  );

  assert.equal(
    model.states.find((state) => state.id === destination)
      .abbreviation,
    "VN"
  );

  assert.equal(JSON.stringify(dataset.counties), before);
  assert.equal(original.assignments["51013"], "state:VA");
});

test("independent cities are distinct from their surrounding counties", async () => {
  const { dataset } = await fixture();

  for (const countyId of expectedCounties) {
    assert.ok(
      dataset.counties.some((county) => county.id === countyId),
      `Missing county-equivalent record: ${countyId}`
    );
  }

  assert.notEqual("51059", "51600");
  assert.notEqual("51153", "51683");
  assert.notEqual("51153", "51685");
});