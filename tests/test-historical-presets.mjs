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
  createBuiltinPresets,
} from "../js/presets/builtin-presets.mjs";

import {
  createHistoricalPresets,
} from "../js/presets/historical-presets.mjs";

import {
  countyIdsByName,
  countyIdsSouthOfLatitude,
  createCountyCentroidReader,
} from "../js/presets/preset-geography.mjs";

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
    presets: createHistoricalPresets(dataset),
  };
}

function byId(presets, id) {
  const preset = presets.find((item) => item.id === id);

  assert.ok(preset, `Missing preset: ${id}`);

  return preset;
}

test("all seven historical presets load against the real inventory", async () => {
  const { presets } = await fixture();

  assert.equal(presets.length, 7);
  assert.equal(new Set(presets.map((item) => item.id)).size, 7);
});

test("Cal 3 partitions all 58 California counties", async () => {
  const { dataset, presets } = await fixture();

  const preset = byId(presets, "builtin:cal3-2018");
  const result = applyPresetPatch(
    dataset.model,
    preset,
    dataset
  ).model;

  const californiaIds = dataset.counties
    .filter((county) => county.originalStateId === "state:CA")
    .map((county) => county.id);

  assert.equal(preset.moves.length, 58);
  assert.equal(new Set(preset.moves.map(([id]) => id)).size, 58);

  const counts = Object.fromEntries(
    preset.states.map((state) => [
      state.id,
      preset.moves.filter(([, id]) => id === state.id).length,
    ])
  );

  assert.deepEqual(
    Object.values(counts).sort((a, b) => a - b),
    [6, 12, 40]
  );

  assert.equal(
    result.states.some((state) => state.id === "state:CA"),
    false
  );

  assert.ok(
    californiaIds.every((id) =>
      result.assignments[id].startsWith("custom:preset:cal3:")
    )
  );

  assert.equal(result.assignments["25023"], "state:MA");
});

test("West Florida uses the documented centroid rule", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:british-west-florida-1764");

  const expected = [
    ...countyIdsSouthOfLatitude(dataset, "AL", 32 + 28 / 60),
    ...countyIdsSouthOfLatitude(dataset, "MS", 32 + 28 / 60),
    ...countyIdsByName(dataset, "LA", [
      "East Baton Rouge",
      "East Feliciana",
      "Livingston",
      "St. Helena",
      "St. Tammany",
      "Tangipahoa",
      "Washington",
      "West Feliciana",
    ]),
    ...countyIdsByName(dataset, "FL", [
      "Bay",
      "Calhoun",
      "Escambia",
      "Gulf",
      "Holmes",
      "Jackson",
      "Okaloosa",
      "Santa Rosa",
      "Walton",
      "Washington",
    ]),
  ];

  assert.deepEqual(
    preset.moves.map(([id]) => id).sort(),
    expected.sort()
  );

  const centroid = createCountyCentroidReader(dataset);

  for (const [id] of preset.moves) {
    if (id.startsWith("01") || id.startsWith("28")) {
      assert.ok(centroid(id)[1] <= 32 + 28 / 60);
    }
  }

  assert.equal(preset.moves.some(([id]) => id === "12037"), false);
  assert.equal(preset.moves.some(([id]) => id === "12077"), false);
});

test("Franklin uses exactly the requested twelve counties", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:franklin");

  const expected = countyIdsByName(dataset, "TN", [
    "Blount",
    "Sevier",
    "Jefferson",
    "Hamblen",
    "Hawkins",
    "Sullivan",
    "Johnson",
    "Carter",
    "Unicoi",
    "Washington",
    "Greene",
    "Cocke",
  ]);

  assert.deepEqual(
    preset.moves.map(([id]) => id).sort(),
    expected
  );
});

test("Absaroka is explicitly identified as a reconstruction", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:absaroka-1939");

  assert.equal(preset.moves.length, 26);
  assert.match(preset.description, /reconstruction/i);
  assert.match(preset.description, /not claimed/i);

  const fremont = countyIdsByName(dataset, "WY", ["Fremont"])[0];

  assert.equal(
    preset.moves.some(([id]) => id === fremont),
    false
  );

  assert.equal(
    new Set(preset.moves.map(([id]) => id)).size,
    26
  );
});

test("Greater Idaho excludes partial and optional counties", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:greater-idaho-current");

  assert.equal(preset.moves.length, 17);

  for (const [, destination] of preset.moves) {
    assert.equal(destination, "state:ID");
  }

  const excluded = [
    ...countyIdsByName(dataset, "OR", [
      "Wasco", "Jefferson", "Deschutes",
      "Coos", "Curry", "Douglas", "Jackson", "Josephine",
    ]),
    ...countyIdsByName(dataset, "WA", [
      "Walla Walla", "Whitman",
    ]),
  ];

  for (const id of excluded) {
    assert.equal(
      preset.moves.some(([countyId]) => countyId === id),
      false
    );
  }
});

test("South Florida renames the remaining original state", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:south-florida-2014");

  assert.equal(preset.moves.length, 24);

  const model = applyPresetPatch(
    dataset.model,
    preset,
    dataset
  ).model;

  const north = model.states.find(
    (state) => state.id === "state:FL"
  );

  assert.equal(north.name, "North Florida");
  assert.equal(north.abbreviation, "FL");

  const orange = countyIdsByName(dataset, "FL", ["Orange"])[0];
  const volusia = countyIdsByName(dataset, "FL", ["Volusia"])[0];

  assert.equal(
    model.assignments[orange],
    "custom:preset:south-florida"
  );

  assert.equal(model.assignments[volusia], "state:FL");
});

test("Jefferson contains the five documented 1941 core counties", async () => {
  const { dataset, presets } = await fixture();
  const preset = byId(presets, "builtin:jefferson-1941");

  const expected = [
    ...countyIdsByName(dataset, "OR", ["Curry"]),
    ...countyIdsByName(dataset, "CA", [
      "Del Norte", "Siskiyou", "Modoc", "Trinity",
    ]),
  ].sort();

  assert.deepEqual(
    preset.moves.map(([id]) => id).sort(),
    expected
  );
});

test("all seven presets compose without changing source data", async () => {
  const { dataset, session, presets } = await fixture();

  const originalModel = dataset.model;
  const originalCounty = dataset.counties.find(
    (county) => county.id === "25023"
  );

  const plan = createPresetPlan(
    dataset,
    session.getSnapshot(),
    presets,
    { base: "original" }
  );

  assert.equal(plan.applied.length, 7);
  assert.equal(
    Object.keys(plan.model.assignments).length,
    Object.keys(originalModel.assignments).length
  );

  assert.equal(plan.model.assignments["25023"], "state:MA");
  assert.equal(dataset.model, originalModel);
  assert.equal(
    dataset.counties.find((county) => county.id === "25023"),
    originalCounty
  );

  assert.equal(
    plan.model.states.find((state) => state.id === "state:FL").name,
    "North Florida"
  );
});

test("a higher-priority Cal 3 layer overrides Six Californias", async () => {
  const { dataset, session, presets } = await fixture();

  const all = createBuiltinPresets(dataset);
  const six = byId(all, "builtin:six-californias");
  const cal3 = byId(presets, "builtin:cal3-2018");

  const plan = createPresetPlan(
    dataset,
    session.getSnapshot(),
    [cal3, six],
    { base: "original" }
  );

  assert.equal(plan.applied[0].name, six.name);
  assert.equal(plan.applied[1].name, cal3.name);
  assert.equal(plan.conflicts.length, 58);

  for (const county of dataset.counties) {
    if (county.originalStateId === "state:CA") {
      assert.ok(
        plan.model.assignments[county.id].startsWith(
          "custom:preset:cal3:"
        )
      );
    }
  }
});