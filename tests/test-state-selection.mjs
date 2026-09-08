
import test from "node:test";
import assert from "node:assert/strict";

import {
  createStateModel,
} from "../js/model/state-registry.mjs";

import {
  createTerritoryWorkspace,
  excludeCounties,
  moveTerritoryCounties,
} from "../js/model/territory-workspace.mjs";

import {
  toggleCurrentStateSelection,
} from "../js/model/state-selection.mjs";

import {
  createStateSession,
} from "../js/model/state-session.mjs";

function fixture() {
  const model = createStateModel({
    states: [
      {
        id: "state:AA",
        name: "Alpha",
        abbreviation: "AA",
        kind: "state",
      },
      {
        id: "state:BB",
        name: "Beta",
        abbreviation: "BB",
        kind: "state",
      },
      {
        id: "state:CC",
        name: "Gamma",
        abbreviation: "CC",
        kind: "state",
      },
    ],
    assignments: {
      "01001": "state:AA",
      "01003": "state:AA",
      "02001": "state:BB",
      "02003": "state:BB",
      "03001": "state:CC",
    },
  });

  return createTerritoryWorkspace(model);
}

test("Shift-click adds a state, then removes it without touching other selections", () => {
  const workspace = fixture();

  const first = toggleCurrentStateSelection(
    workspace,
    "01001",
    ["03001"]
  );

  assert.deepEqual(
    first,
    ["01001", "01003", "03001"]
  );

  assert.deepEqual(
    toggleCurrentStateSelection(workspace, "01003", first),
    ["03001"]
  );
});

test("a partially selected state is completed before it can be toggled off", () => {
  const workspace = fixture();
  const partial = ["01001", "03001"];

  const full = toggleCurrentStateSelection(
    workspace,
    "01001",
    partial
  );

  assert.deepEqual(
    full,
    ["01001", "01003", "03001"]
  );

  assert.deepEqual(partial, ["01001", "03001"]);

  assert.deepEqual(
    toggleCurrentStateSelection(workspace, "01001", full),
    ["03001"]
  );
});

test("excluded territory is one independently toggleable group", () => {
  const workspace = excludeCounties(
    fixture(),
    ["01001", "02001"]
  );

  const first = toggleCurrentStateSelection(
    workspace,
    "01001",
    ["03001"]
  );

  assert.deepEqual(
    first,
    ["01001", "02001", "03001"]
  );

  assert.deepEqual(
    toggleCurrentStateSelection(workspace, "02001", first),
    ["03001"]
  );

  assert.deepEqual(
    toggleCurrentStateSelection(workspace, "01003", first),
    ["01001", "01003", "02001", "03001"]
  );
});

test("selection follows current assignments after a county transfer", () => {
  const workspace = moveTerritoryCounties(
    fixture(),
    ["01003"],
    "state:BB"
  );

  assert.deepEqual(
    toggleCurrentStateSelection(workspace, "01001"),
    ["01001"]
  );

  assert.deepEqual(
    toggleCurrentStateSelection(workspace, "01003"),
    ["01003", "02001", "02003"]
  );
});

test("invalid input is rejected without mutating the selection or workspace", () => {
  const workspace = fixture();
  const selected = ["01001"];

  assert.throws(
    () => toggleCurrentStateSelection(
      workspace,
      "99999",
      selected
    ),
    /Unknown county/
  );

  assert.throws(
    () => toggleCurrentStateSelection(
      workspace,
      "01001",
      ["99999"]
    ),
    /Unknown county/
  );

  assert.deepEqual(selected, ["01001"]);
  assert.deepEqual(workspace.excluded, {});
});

test("the session exposes toggling without committing a model revision", () => {
  const workspace = fixture();

  const dataset = {
    model: workspace.placements,
    counties: Object.keys(workspace.placements.assignments).map(
      (id) => ({
        id,
        population: 100,
        landAreaM2: 1_000_000,
        waterAreaM2: 0,
        votes: { dem: 60, gop: 40 },
      })
    ),
    candidateIds: ["dem", "gop"],
    metadata: {
      id: "test",
      measurement: { kind: "population" },
    },
  };

  const session = createStateSession(dataset);
  const before = session.getSnapshot();

  const first = session.selectStateCounties(
    "01001",
    ["03001"]
  );

  assert.deepEqual(
    first,
    ["01001", "01003", "03001"]
  );

  assert.deepEqual(
    session.selectStateCounties("01003", first),
    ["03001"]
  );

  assert.equal(session.getSnapshot(), before);
});