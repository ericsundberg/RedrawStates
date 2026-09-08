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
  loadPresetCatalog,
} from "../js/presets/preset-catalog.mjs";

const root = new URL("../", import.meta.url);

async function readJson(path) {
  return JSON.parse(
    await readFile(new URL(path, root), "utf8")
  );
}

let fixturePromise;

function fixture() {
  if (!fixturePromise) {
    fixturePromise = (async () => {
      const dataset = await loadLegacyDataset(
        "2024",
        readJson
      );

      const presets = await loadPresetCatalog(
        dataset,
        readJson
      );

      return { dataset, presets };
    })();
  }

  return fixturePromise;
}

function byId(presets, id) {
  const preset = presets.find((item) => item.id === id);

  assert.ok(preset, `Missing preset: ${id}`);

  return preset;
}

function countyId(dataset, stateCode, name) {
  const matches = dataset.counties.filter(
    (county) =>
      county.originalStateId === `state:${stateCode}` &&
      county.name.toLowerCase() === name.toLowerCase()
  );

  assert.equal(
    matches.length,
    1,
    `Expected one ${name}, ${stateCode} record.`
  );

  return matches[0].id;
}

const smallPresets = [
  ["builtin:chicagoland", "IL", [
    "Lake", "Cook", "DuPage", "Will",
  ]],
  ["builtin:superior", "MI", [
    "Alger", "Baraga", "Chippewa", "Delta", "Dickinson",
    "Gogebic", "Houghton", "Iron", "Keweenaw", "Luce",
    "Mackinac", "Marquette", "Menominee", "Ontonagon",
    "Schoolcraft",
  ]],
  ["builtin:long-island", "NY", [
    "Nassau", "Suffolk",
  ]],
  ["builtin:baja-arizona", "AZ", [
    "Cochise", "Pima", "Santa Cruz",
  ]],
  ["builtin:west-kansas", "KS", [
    "Morton", "Stanton", "Hamilton", "Kearny", "Grant",
    "Stevens", "Seward", "Haskell", "Finney", "Gray",
    "Meade", "Clark", "Ford", "Hodgeman", "Edwards",
    "Kiowa", "Comanche",
  ]],
  ["builtin:madawaska", "ME", ["Aroostook"]],
  ["builtin:west-maryland", "MD", [
    "Garrett", "Allegany", "Washington",
    "Frederick", "Carroll",
  ]],
];

for (const [id, stateCode, names] of smallPresets) {
  test(`${id} retains its exact county list`, async () => {
    const { dataset, presets } = await fixture();
    const preset = byId(presets, id);

    assert.deepEqual(
      preset.moves.map(([county]) => county).sort(),
      names.map((name) =>
        countyId(dataset, stateCode, name)
      ).sort()
    );
  });
}

test("Wisconsin Reattachment uses the existing Wisconsin identity", async () => {
  const { dataset, presets } = await fixture();

  const preset = byId(
    presets,
    "builtin:wisconsin-reattachment"
  );

  assert.equal(preset.states.length, 0);

  assert.deepEqual(
    preset.moves.map(([id]) => id).sort(),
    [
      "Jo Daviess", "Stephenson", "Winnebago", "Boone",
    ].map((name) => countyId(dataset, "IL", name)).sort()
  );

  assert.ok(
    preset.moves.every(([, destination]) =>
      destination === "state:WI"
    )
  );
});

test("South Georgia retains Bibb and renames the original state", async () => {
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

  assert.equal(
    model.assignments[countyId(dataset, "GA", "Bibb")],
    "state:GA"
  );
});

test("Westsylvania has the complete revised boundary", async () => {
  const { dataset, presets } = await fixture();

  const preset = byId(presets, "builtin:wetsylvania");
  const moves = new Map(preset.moves);

  assert.equal(preset.moves.length, 96);
  assert.equal(moves.size, 96);

  const expected = {
    ...dataset.model.assignments,
  };

  const originalWV = dataset.counties.filter(
    (county) => county.originalStateId === "state:WV"
  );

  assert.equal(originalWV.length, 55);

  // All original WV counties are explicitly covered.
  for (const county of originalWV) {
    assert.ok(moves.has(county.id));
  }

  const toVirginia = [
    "Jefferson", "Berkeley", "Morgan", "Hampshire",
    "Hardy", "Pendleton", "Grant", "Mineral",
  ];

  for (const name of toVirginia) {
    const id = countyId(dataset, "WV", name);
    assert.equal(moves.get(id), "state:VA");
    expected[id] = "state:VA";
  }

  const returnedToKentucky = [
    "Whitley", "Knox", "Clay", "Laurel",
    "Rockcastle", "Jackson", "Owsley", "Lee",
    "Wolfe", "Menifee", "Montgomery", "Bath",
    "Rowan", "Morgan",
  ];

  for (const name of returnedToKentucky) {
    const id = countyId(dataset, "KY", name);
    assert.equal(moves.get(id), "state:KY");
    expected[id] = "state:KY";
  }

  const retainedKentucky = [
    "Boyd", "Carter", "Elliott", "Greenup", "Lawrence",
    "Floyd", "Johnson", "Magoffin", "Martin", "Pike",
    "Breathitt", "Knott", "Leslie", "Letcher", "Perry",
    "Harlan", "Bell",
  ];

  for (const name of retainedKentucky) {
    const id = countyId(dataset, "KY", name);
    assert.equal(moves.get(id), "state:WV");
    expected[id] = "state:WV";
  }

  for (const name of [
    "Allegheny", "Westmoreland", "Fayette",
    "Greene", "Washington",
  ]) {
    const id = countyId(dataset, "PA", name);
    assert.equal(moves.get(id), "state:WV");
    expected[id] = "state:WV";
  }

  for (const name of [
    "Wise", "Dickenson", "Buchanan",
  ]) {
    const id = countyId(dataset, "VA", name);
    assert.equal(moves.get(id), "state:WV");
    expected[id] = "state:WV";
  }

  assert.equal(moves.get("51720"), "state:WV");
  expected["51720"] = "state:WV";

  const garrett = countyId(dataset, "MD", "Garrett");
  assert.equal(moves.get(garrett), "state:WV");
  expected[garrett] = "state:WV";

  const model = applyPresetPatch(
    dataset.model,
    preset,
    dataset
  ).model;

  assert.deepEqual(model.assignments, expected);

  const state = model.states.find(
    (item) => item.id === "state:WV"
  );

  assert.equal(state.name, "Westsylvania");
  assert.equal(state.abbreviation, "WS");
});

test("regional JSON presets do not mutate source data", async () => {
  const { dataset, presets } = await fixture();
  const session = createStateSession(dataset);

  const originalModel = dataset.model;
  const originalCounty = dataset.counties[0];
  const originalSnapshot = session.getSnapshot();

  const ids = [
    "builtin:chicagoland",
    "builtin:superior",
    "builtin:long-island",
    "builtin:baja-arizona",
    "builtin:west-kansas",
    "builtin:south-georgia",
    "builtin:wisconsin-reattachment",
    "builtin:madawaska",
    "builtin:wetsylvania",
    "builtin:west-maryland",
  ];

  const plan = createPresetPlan(
    dataset,
    originalSnapshot,
    ids.map((id) => byId(presets, id)),
    { base: "original" }
  );

  assert.equal(plan.applied.length, ids.length);
  assert.equal(dataset.model, originalModel);
  assert.equal(dataset.counties[0], originalCounty);
  assert.equal(session.getSnapshot(), originalSnapshot);
});