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

const expected = {
  "builtin:new-york-vermont-claims": {
    destination: "state:NY",
    counties: [
      "50001", "50003", "50005", "50007", "50009",
      "50011", "50013", "50015", "50017", "50019",
      "50021", "50023", "50025", "50027",
    ],
  },
  "builtin:united-carolina": {
    destination: "state:NC",
    counties: Array.from(
      { length: 46 },
      (_, index) => `45${String(index * 2 + 1).padStart(3, "0")}`
    ),
  },
  "builtin:north-colorado-2013": {
    destination: "custom:preset:north-colorado-2013",
    counties: [
      "08017", "08039", "08063", "08073", "08075",
      "08087", "08095", "08115", "08121", "08123", "08125",
    ],
  },
  "builtin:jones-county-1861": {
    destination: "custom:preset:jones-county-1861",
    counties: ["28067"],
  },
  "builtin:callaway-kingdom": {
    destination: "custom:preset:callaway-kingdom",
    counties: ["29027"],
  },
  "builtin:mcdonald-territory": {
    destination: "custom:preset:mcdonald-territory",
    counties: ["29119"],
  },
  "builtin:state-of-scott": {
    destination: "custom:preset:state-of-scott",
    counties: ["47151"],
  },
  "builtin:state-of-winston": {
    destination: "custom:preset:state-of-winston",
    counties: ["01133"],
  },
};

function byId(presets, id) {
  const preset = presets.find((item) => item.id === id);

  assert.ok(preset, `Missing preset: ${id}`);

  return preset;
}

for (const [id, specification] of Object.entries(expected)) {
  test(`${id} contains exactly the requested counties`, async () => {
    const { dataset, presets } = await fixture();
    const preset = byId(presets, id);

    assert.deepEqual(
      preset.moves.map(([countyId]) => countyId).sort(),
      [...specification.counties].sort()
    );

    assert.ok(
      preset.moves.every(([, destination]) =>
        destination === specification.destination
      )
    );

    const resulting = applyPresetPatch(
      dataset.model,
      preset,
      dataset
    ).model;

    for (const countyId of specification.counties) {
      assert.equal(
        resulting.assignments[countyId],
        specification.destination
      );
    }
  });
}

test("Vermont is dissolved into New York", async () => {
  const { dataset, presets } = await fixture();

  const model = applyPresetPatch(
    dataset.model,
    byId(presets, "builtin:new-york-vermont-claims"),
    dataset
  ).model;

  assert.equal(
    model.states.some((state) => state.id === "state:VT"),
    false
  );

  assert.equal(
    model.states.find((state) => state.id === "state:NY")
      .abbreviation,
    "NY"
  );
});

test("United Carolina retains the original North Carolina identity", async () => {
  const { dataset, presets } = await fixture();

  const model = applyPresetPatch(
    dataset.model,
    byId(presets, "builtin:united-carolina"),
    dataset
  ).model;

  const carolina = model.states.find(
    (state) => state.id === "state:NC"
  );

  assert.equal(carolina.name, "Carolina");
  assert.equal(carolina.abbreviation, "CR");

  assert.equal(
    model.states.some((state) => state.id === "state:SC"),
    false
  );

  for (const county of dataset.counties) {
    if (
      county.originalStateId === "state:NC" ||
      county.originalStateId === "state:SC"
    ) {
      assert.equal(
        model.assignments[county.id],
        "state:NC"
      );
    }
  }
});

test("all catalog state definitions use unique two-letter abbreviations", async () => {
  const { dataset, presets } = await fixture();

  const reserved = new Map(
    dataset.model.states.map((state) => [
      state.abbreviation,
      state.id,
    ])
  );

  const proposed = new Map();

  for (const preset of presets) {
    for (const state of preset.states) {
      assert.match(
        state.abbreviation,
        /^[A-Z]{2}$/,
        `${preset.id}: ${state.name}`
      );

      const reservedOwner = reserved.get(state.abbreviation);

      assert.ok(
        !reservedOwner || reservedOwner === state.id,
        `${state.abbreviation} is reserved for ${reservedOwner}.`
      );

      const previousOwner = proposed.get(state.abbreviation);

      assert.ok(
        !previousOwner || previousOwner === state.id,
        `${state.abbreviation} is used by both ` +
        `${previousOwner} and ${state.id}.`
      );

      proposed.set(state.abbreviation, state.id);
    }
  }
});

test("the new presets compose and preserve unrelated assignments", async () => {
  const { dataset, presets } = await fixture();
  const session = createStateSession(dataset);
  const before = session.getSnapshot();

  const layers = Object.keys(expected).map(
    (id) => byId(presets, id)
  );

  const plan = createPresetPlan(
    dataset,
    before,
    layers,
    { base: "original" }
  );

  assert.equal(plan.applied.length, 8);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.stateCount, 55);

  const expectedAssignments = {
    ...dataset.model.assignments,
  };

  for (const preset of layers) {
    for (const [countyId, destination] of preset.moves) {
      expectedAssignments[countyId] = destination;
    }
  }

  assert.deepEqual(
    plan.model.assignments,
    expectedAssignments
  );

  assert.equal(session.getSnapshot(), before);
  assert.equal(dataset.model, before.model);
});