import test from "node:test";
import assert from "node:assert/strict";

import { createStateModel } from "../js/model/state-registry.mjs";
import { createStateSession } from "../js/model/state-session.mjs";

import {
  applyPresetPatch,
  applyPresetPlan,
  createPresetBundle,
  createPresetFromModel,
  createPresetPlan,
  normalizePreset,
  presetGeography,
  readPresetDocument,
} from "../js/presets/preset-model.mjs";

import {
  createCorePresets,
} from "../js/presets/core-presets.mjs";

import {
  presetFilename,
  readPresetFiles,
} from "../js/presets/preset-files.mjs";

function fixture() {
  const states = [
    { id: "state:MA", name: "Massachusetts", abbreviation: "MA" },
    { id: "state:NY", name: "New York", abbreviation: "NY" },
    { id: "state:CA", name: "California", abbreviation: "CA" },
  ];

  const assignments = {
    "25001": "state:MA",
    "25005": "state:MA",
    "25007": "state:MA",
    "25019": "state:MA",
    "25023": "state:MA",
    "36001": "state:NY",
  };

  for (let code = 1; code <= 115; code += 2) {
    assignments[`06${String(code).padStart(3, "0")}`] = "state:CA";
  }

  const model = createStateModel({ states, assignments });

  const counties = Object.keys(assignments).map((id) => ({
    id,
    population: 100,
    landAreaM2: 1_000_000,
    waterAreaM2: 0,
    votes: { dem: 60, gop: 40 },
  }));

  const dataset = {
    metadata: {
      id: "2024",
      schema: "redraw-legacy-v1",
      geographyVintage: 2019,
      measurement: { kind: "population" },
    },
    model,
    counties,
    candidateIds: ["dem", "gop"],
  };

  return {
    dataset,
    session: createStateSession(dataset),
  };
}

function makePreset(dataset, values) {
  return normalizePreset({
    format: "redraw-states-preset",
    version: 1,
    id: "local:test",
    name: "Test preset",
    description: "",
    geography: presetGeography(dataset),
    sourceDataset: dataset.metadata.id,
    states: [],
    moves: [],
    removeStates: [],
    ...values,
  }, dataset);
}

test("Plymouth changes only the five requested Massachusetts counties", () => {
  const { dataset } = fixture();
  const [plymouth] = createCorePresets(dataset);

  assert.equal(plymouth.moves.length, 5);
  assert.equal(plymouth.states.length, 1);

  assert.deepEqual(
    plymouth.moves
      .filter(([, stateId]) => stateId === "state:NY")
      .map(([id]) => id)
      .sort(),
    ["25007", "25019"]
  );

  const result = applyPresetPatch(
    dataset.model,
    plymouth,
    dataset
  ).model;

  for (const id of ["25023", "25001", "25005"]) {
    assert.equal(
      result.assignments[id],
      "custom:preset:plymouth"
    );
  }

  assert.equal(result.assignments["25007"], "state:NY");
  assert.equal(result.assignments["25019"], "state:NY");
  assert.equal(result.assignments["36001"], "state:NY");
});

test("Six Californias covers each of the 58 counties once", () => {
  const { dataset } = fixture();
  const [, six] = createCorePresets(dataset);

  const ids = six.moves.map(([id]) => id);

  assert.equal(ids.length, 58);
  assert.equal(new Set(ids).size, 58);
  assert.equal(six.states.length, 6);

  const result = applyPresetPatch(
    dataset.model,
    six,
    dataset
  ).model;

  assert.equal(
    result.states.some((state) => state.id === "state:CA"),
    false
  );

  assert.equal(
    result.assignments["06037"],
    "custom:preset:six-californias:west"
  );

  assert.equal(
    result.assignments["06075"],
    "custom:preset:six-californias:silicon-valley"
  );

  assert.equal(
    result.assignments["06073"],
    "custom:preset:six-californias:south"
  );

  assert.equal(result.assignments["25023"], "state:MA");
});

test("both core presets compose without changing unrelated counties", () => {
  const { dataset, session } = fixture();

  const plan = createPresetPlan(
    dataset,
    session.getSnapshot(),
    createCorePresets(dataset),
    { base: "original" }
  );

  assert.equal(plan.applied.length, 2);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.affectedCountyCount, 63);
  assert.equal(plan.changedCountyCount, 63);
  assert.equal(plan.stateCount, 9);
  assert.equal(plan.model.assignments["36001"], "state:NY");
});

test("the top layer is applied last and wins assignment conflicts", () => {
  const { dataset, session } = fixture();

  const top = makePreset(dataset, {
    id: "local:top",
    name: "Top",
    moves: [["25023", "state:NY"]],
  });

  const bottom = makePreset(dataset, {
    id: "local:bottom",
    name: "Bottom",
    moves: [["25023", "state:CA"]],
  });

  const plan = createPresetPlan(
    dataset,
    session.getSnapshot(),
    [top, bottom]
  );

  assert.deepEqual(
    plan.applied.map((item) => item.name),
    ["Bottom", "Top"]
  );

  assert.equal(plan.model.assignments["25023"], "state:NY");
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].earlier, "Bottom");
  assert.equal(plan.conflicts[0].later, "Top");
});

test("reversing the stack reverses the winning assignment", () => {
  const { dataset, session } = fixture();

  const first = makePreset(dataset, {
    id: "local:first",
    moves: [["25023", "state:NY"]],
  });

  const second = makePreset(dataset, {
    id: "local:second",
    moves: [["25023", "state:CA"]],
  });

  const plan = createPresetPlan(
    dataset,
    session.getSnapshot(),
    [second, first]
  );

  assert.equal(plan.model.assignments["25023"], "state:CA");
});

test("unlisted counties retain their current assignment", () => {
  const { dataset, session } = fixture();

  session.moveCounties(["25001"], "state:NY");

  const preset = makePreset(dataset, {
    moves: [["25023", "state:CA"]],
  });

  const plan = createPresetPlan(
    dataset,
    session.getSnapshot(),
    [preset],
    { base: "current" }
  );

  assert.equal(plan.model.assignments["25001"], "state:NY");
  assert.equal(plan.model.assignments["25023"], "state:CA");
  assert.equal(plan.model.assignments["36001"], "state:NY");
});

test("original base ignores previous sandbox changes", () => {
  const { dataset, session } = fixture();

  session.moveCounties(["25001"], "state:NY");

  const preset = makePreset(dataset, {
    moves: [["25023", "state:CA"]],
  });

  const plan = createPresetPlan(
    dataset,
    session.getSnapshot(),
    [preset],
    { base: "original" }
  );

  assert.equal(plan.model.assignments["25001"], "state:MA");
});

test("invalid county operations leave the session unchanged", () => {
  const { dataset, session } = fixture();
  const before = session.getSnapshot();

  assert.throws(
    () => createPresetPlan(
      dataset,
      before,
      [makePreset(dataset, {
        moves: [["99999", "state:NY"]],
      })]
    ),
    /Invalid or duplicate preset county/
  );

  assert.equal(session.getSnapshot(), before);
});

test("unknown destinations are rejected before application", () => {
  const { dataset, session } = fixture();
  const before = session.getSnapshot();

  const preset = makePreset(dataset, {
    moves: [["25023", "custom:missing"]],
  });

  assert.throws(
    () => createPresetPlan(dataset, before, [preset]),
    /Unknown preset destination/
  );

  assert.equal(session.getSnapshot(), before);
});

test("occupied states cannot be removed without a safe destination", () => {
  const { dataset, session } = fixture();

  const preset = makePreset(dataset, {
    removeStates: ["state:MA"],
  });

  assert.throws(
    () => createPresetPlan(
      dataset,
      session.getSnapshot(),
      [preset]
    ),
    /still contains/
  );
});

test("a stale reviewed plan cannot replace a newer configuration", () => {
  const { dataset, session } = fixture();

  const preset = makePreset(dataset, {
    moves: [["25023", "state:NY"]],
  });

  const plan = createPresetPlan(
    dataset,
    session.getSnapshot(),
    [preset]
  );

  session.moveCounties(["25001"], "state:NY");
  const before = session.getSnapshot();

  assert.throws(
    () => applyPresetPlan(session, plan),
    /configuration changed/
  );

  assert.equal(session.getSnapshot(), before);
});

test("a valid plan commits through the session", () => {
  const { dataset, session } = fixture();

  const preset = makePreset(dataset, {
    moves: [["25023", "state:NY"]],
  });

  const plan = createPresetPlan(
    dataset,
    session.getSnapshot(),
    [preset]
  );

  const result = applyPresetPlan(session, plan);

  assert.equal(result.model.assignments["25023"], "state:NY");
  assert.equal(result.revision, 1);
});

test("exporting current changes is sparse and round-trips", () => {
  const { dataset, session } = fixture();
  const stateId = "custom:test-state";

  session.addState({
    id: stateId,
    name: "Test State",
    abbreviation: "TS",
    kind: "state",
  });

  session.moveCounties(["25023"], stateId);

  const current = session.getSnapshot().model;

  const preset = createPresetFromModel(
    dataset,
    current,
    {
      id: "local:export",
      name: "Export",
      description: "A test configuration.",
    }
  );

  assert.equal(preset.moves.length, 1);
  assert.equal(preset.states.length, 1);
  assert.equal(preset.moves[0][0], "25023");

  const restored = applyPresetPatch(
    dataset.model,
    preset,
    dataset
  ).model;

  assert.deepEqual(restored.assignments, current.assignments);
});

test("bundle import preserves top-first priority order", () => {
  const { dataset } = fixture();

  const top = makePreset(dataset, {
    id: "local:top",
    name: "Top",
  });

  const bottom = makePreset(dataset, {
    id: "local:bottom",
    name: "Bottom",
  });

  const bundle = createPresetBundle(
    [top, bottom],
    {
      id: "local:bundle",
      name: "My stack",
      description: "",
    }
  );

  const imported = readPresetDocument(bundle, dataset);

  assert.deepEqual(
    imported.map((preset) => preset.name),
    ["Top", "Bottom"]
  );
});

test("file imports validate an entire batch before returning", async () => {
  const { dataset } = fixture();

  const preset = makePreset(dataset, {
    id: "local:file",
  });

  const good = JSON.stringify(preset);

  const files = [
    {
      name: "good.json",
      size: good.length,
      async text() {
        return good;
      },
    },
    {
      name: "bad.json",
      size: 12,
      async text() {
        return "{not json";
      },
    },
  ];

  await assert.rejects(
    readPresetFiles(files, dataset),
    /bad.json is not valid JSON/
  );
});

test("download filenames are sanitized", () => {
  assert.equal(
    presetFilename("My Plymouth / California Setup"),
    "my-plymouth-california-setup.redraw.json"
  );
});