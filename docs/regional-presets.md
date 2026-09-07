import test from "node:test";
import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";

import {
  loadLegacyDataset,
} from "../js/data/legacy-datasets.mjs";

import {
  createStateSession,
} from "../js/model/state-session.mjs";

import {
  applyPresetPatch,
  createPresetPlan,
} from "../js/presets/preset-model.mjs";

import {
  createRegionalPresets,
  createSouthGeorgiaPreset,
  resolvePresetCounties,
} from "../js/presets/regional-presets.mjs";

const datasetPromise = loadLegacyDataset(
  "2024",
  async (filename) => JSON.parse(
    await readFile(
      new URL(`../${filename}`, import.meta.url),
      "utf8"
    )
  )
);

async function fixture() {
  const dataset = await datasetPromise;

  return {
    dataset,
    session: createStateSession(dataset),
    presets: createRegionalPresets(dataset),
  };
}

function byId(presets, id) {
  const preset = presets.find((item) => item.id === id);

  assert.ok(preset, `Missing preset: ${id}`);

  return preset;
}

function movedIds(preset) {
  return preset.moves.map(([id]) => id).sort();
}

function expectedIds(dataset, state, names) {
  return resolvePresetCounties(dataset, state, names);
}

test("the catalog contains ten unique regional presets", async () => {
  const { presets } = await fixture();

  assert.equal(presets.length, 10);
  assert.equal(new Set(presets.map((item) => item.id)).size, 10);
});

test("Chicagoland contains exactly four Illinois counties", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:chicagoland");

  assert.deepEqual(
    movedIds(preset),
    expectedIds(dataset, "IL", [
      "Lake", "Cook", "DuPage", "Will",
    ])
  );
});

test("Superior contains all fifteen Upper Peninsula counties", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:superior");

  assert.deepEqual(
    movedIds(preset),
    expectedIds(dataset, "MI", [
      "Alger", "Baraga", "Chippewa", "Delta", "Dickinson",
      "Gogebic", "Houghton", "Iron", "Keweenaw", "Luce",
      "Mackinac", "Marquette", "Menominee", "Ontonagon",
      "Schoolcraft",
    ])
  );
});

test("Long Island does not include New York City counties", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:long-island");

  assert.deepEqual(
    movedIds(preset),
    expectedIds(dataset, "NY", ["Nassau", "Suffolk"])
  );

  assert.equal(preset.moves.length, 2);
});

test("Baja Arizona contains the requested three counties", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:baja-arizona");

  assert.deepEqual(
    movedIds(preset),
    expectedIds(dataset, "AZ", [
      "Cochise", "Pima", "Santa Cruz",
    ])
  );
});

test("West Kansas contains exactly the requested seventeen counties", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:west-kansas");

  assert.deepEqual(
    movedIds(preset),
    expectedIds(dataset, "KS", [
      "Morton", "Stanton", "Hamilton", "Kearny", "Grant",
      "Stevens", "Seward", "Haskell", "Finney", "Gray",
      "Meade", "Clark", "Ford", "Hodgeman", "Edwards",
      "Kiowa", "Comanche",
    ])
  );
});

test("South Georgia renames only the original Georgia identity", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:south-georgia");

  const model = applyPresetPatch(
    dataset.model,
    preset,
    dataset
  ).model;

  const north = model.states.find(
    (state) => state.id === "state:GA"
  );

  assert.equal(north.name, "North Georgia");
  assert.equal(north.abbreviation, "GA");

  const bibb = expectedIds(dataset, "GA", ["Bibb"])[0];

  assert.equal(model.assignments[bibb], "state:GA");
  assert.equal(preset.moves.some(([id]) => id === bibb), false);

  for (const [id] of preset.moves) {
    assert.equal(
      dataset.model.assignments[id],
      "state:GA"
    );
  }
});

test("South Georgia rejects an invalid geographic selection", async () => {
  const { dataset } = await fixture();

  assert.throws(
    () => createSouthGeorgiaPreset(
      dataset,
      () => ["99999"]
    ),
    /outside Georgia/
  );
});

test("Wisconsin Reattachment transfers to the existing state", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:wisconsin-reattachment");

  assert.equal(preset.states.length, 0);

  assert.deepEqual(
    movedIds(preset),
    expectedIds(dataset, "IL", [
      "Jo Daviess", "Stephenson", "Winnebago", "Boone",
    ])
  );

  assert.ok(
    preset.moves.every(([, stateId]) => stateId === "state:WI")
  );
});

test("Madawaska contains only Aroostook County", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:madawaska");

  assert.deepEqual(
    movedIds(preset),
    expectedIds(dataset, "ME", ["Aroostook"])
  );
});

test("Wetsylvania includes the specified counties and preserves the WV identity", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:wetsylvania");

  const westVirginia = dataset.counties
    .filter((county) => county.originalStateId === "state:WV")
    .map((county) => county.id);

  assert.equal(westVirginia.length, 55);
  assert.equal(preset.moves.length, 95);
  assert.equal(new Set(movedIds(preset)).size, 95);

  const model = applyPresetPatch(
    dataset.model,
    preset,
    dataset
  ).model;

  const state = model.states.find(
    (item) => item.id === "state:WV"
  );

  assert.equal(state.name, "Wetsylvania");
  assert.equal(state.abbreviation, "WET");

  for (const id of westVirginia) {
    assert.equal(model.assignments[id], "state:WV");
  }

  const norton = expectedIds(dataset, "VA", ["Norton"])[0];
  assert.equal(model.assignments[norton], "state:WV");

  for (const name of ["Greenup", "Bell"]) {
    const id = expectedIds(dataset, "KY", [name])[0];
    assert.equal(model.assignments[id], "state:WV");
  }
});

test("West Maryland contains the requested five counties", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:west-maryland");

  assert.deepEqual(
    movedIds(preset),
    expectedIds(dataset, "MD", [
      "Garrett", "Allegany", "Washington",
      "Frederick", "Carroll",
    ])
  );
});

test("individual presets do not change unrelated assignments", async () => {
  const { dataset, presets } = await fixture();

  for (const preset of presets) {
    const model = applyPresetPatch(
      dataset.model,
      preset,
      dataset
    ).model;

    const touched = new Set(movedIds(preset));

    for (const [id, stateId] of Object.entries(dataset.model.assignments)) {
      if (!touched.has(id)) {
        assert.equal(
          model.assignments[id],
          stateId,
          `${preset.name} changed unrelated county ${id}`
        );
      }
    }
  }
});

test("a stack preserves last-loaded assignment authority", async () => {
  const { dataset, session, presets } = await fixture();

  const superior = byId(presets, "builtin:superior");
  const longIsland = byId(presets, "builtin:long-island");

  const plan = createPresetPlan(
    dataset,
    session.getSnapshot(),
    [longIsland, superior],
    { base: "original" }
  );

  assert.deepEqual(
    plan.applied.map((item) => item.name),
    ["Superior", "Long Island"]
  );

  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.changedCountyCount, 17);
  assert.equal(session.getSnapshot().revision, 0);
});

test("the regional catalog never mutates source measurements", async () => {
  const { dataset, session, presets } = await fixture();

  const before = dataset.counties.find(
    (county) => county.id === "36059"
  );

  const originalModel = dataset.model;

  createPresetPlan(
    dataset,
    session.getSnapshot(),
    presets,
    { base: "original" }
  );

  assert.equal(dataset.model, originalModel);
  assert.equal(
    dataset.counties.find((county) => county.id === "36059"),
    before
  );
});