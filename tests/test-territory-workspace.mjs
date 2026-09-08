import test from "node:test";
import assert from "node:assert/strict";

import {
  createStateModel,
} from "../js/model/state-registry.mjs";

import {
  UNITED_STATES_ID,
  createTerritoryWorkspace,
  includedStateModel,
  excludedCountyIds,
  territoryCounts,
  selectCurrentState,
  excludeCounties,
  restoreCounties,
  moveTerritoryCounties,
  dissolveAllStates,
  reactivateArchivedState,
  resetTerritoryWorkspace,
  createTerritoryDocument,
  readTerritoryDocument,
} from "../js/model/territory-workspace.mjs";

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

  return {
    model,
    workspace: createTerritoryWorkspace(model),
  };
}

test("a new workspace preserves the original model", () => {
  const { model, workspace } = fixture();

  assert.equal(workspace.placements, model);
  assert.deepEqual(workspace.excluded, {});
  assert.deepEqual(workspace.archivedStates, []);

  assert.deepEqual(territoryCounts(workspace), {
    stateCount: 3,
    includedCountyCount: 5,
    excludedCountyCount: 0,
    totalCountyCount: 5,
  });

  assert.ok(Object.isFrozen(workspace));
});

test("excluding counties preserves their last state and removes them from the included projection", () => {
  const { model, workspace } = fixture();

  const next = excludeCounties(workspace, [
    "01001",
    "02001",
  ]);

  assert.deepEqual(excludedCountyIds(next), [
    "01001",
    "02001",
  ]);

  assert.equal(next.excluded["01001"], "state:AA");
  assert.equal(next.excluded["02001"], "state:BB");

  const included = includedStateModel(next);

  assert.deepEqual(
    Object.keys(included.assignments).sort(),
    ["01003", "02003", "03001"]
  );

  assert.equal(
    next.placements.assignments["01001"],
    "state:AA"
  );

  assert.deepEqual(model.assignments, workspace.placements.assignments);
});

test("repeated exclusion does not overwrite restoration history", () => {
  const { workspace } = fixture();

  const first = excludeCounties(workspace, ["01001"]);
  const second = excludeCounties(first, ["01001"]);

  assert.equal(second, first);
  assert.equal(second.excluded["01001"], "state:AA");
});

test("Shift-click selects the current state additively", () => {
  const { workspace } = fixture();

  const moved = moveTerritoryCounties(
    workspace,
    ["01001"],
    "state:BB"
  );

  assert.deepEqual(
    selectCurrentState(moved, "01001", ["03001"]),
    ["01001", "02001", "02003", "03001"]
  );
});

test("Shift-clicking excluded territory selects the excluded pool", () => {
  const { workspace } = fixture();

  const next = excludeCounties(workspace, [
    "01001",
    "02001",
  ]);

  assert.deepEqual(
    selectCurrentState(next, "01001", ["03001"]),
    ["01001", "02001", "03001"]
  );
});

test("dissolve all creates the exact US identity and preserves exclusions", () => {
  const { model, workspace } = fixture();

  const excluded = excludeCounties(workspace, ["01001"]);
  const next = dissolveAllStates(excluded);

  assert.deepEqual(next.placements.states, [{
    id: UNITED_STATES_ID,
    name: "United State of America",
    abbreviation: "US",
    kind: "state",
  }]);

  assert.equal(next.archivedStates.length, 3);
  assert.equal(next.excluded["01001"], "state:AA");

  assert.ok(
    Object.values(next.placements.assignments)
      .every((stateId) => stateId === UNITED_STATES_ID)
  );

  assert.equal(
    Object.keys(includedStateModel(next).assignments).length,
    4
  );

  assert.equal(model.states.length, 3);
  assert.equal(model.assignments["01001"], "state:AA");
});

test("restoration requires a destination if the previous state was dissolved", () => {
  const { workspace } = fixture();

  const next = dissolveAllStates(
    excludeCounties(workspace, ["01001"])
  );

  assert.throws(
    () => restoreCounties(next, ["01001"]),
    /no longer active/
  );

  const restored = restoreCounties(
    next,
    ["01001"],
    UNITED_STATES_ID
  );

  assert.deepEqual(excludedCountyIds(restored), []);
  assert.equal(
    restored.placements.assignments["01001"],
    UNITED_STATES_ID
  );
});

test("an archived state can be reactivated and receive restored counties", () => {
  const { workspace } = fixture();

  const dissolved = dissolveAllStates(
    excludeCounties(workspace, ["01001"])
  );

  const reactivated = reactivateArchivedState(
    dissolved,
    "state:AA"
  );

  const restored = restoreCounties(
    reactivated,
    ["01001"]
  );

  assert.equal(
    restored.placements.assignments["01001"],
    "state:AA"
  );

  assert.equal(restored.excluded["01001"], undefined);
  assert.equal(restored.placements.states.length, 2);
});

test("moving excluded counties re-adds them to the US", () => {
  const { workspace } = fixture();

  const excluded = excludeCounties(workspace, ["01001"]);

  const next = moveTerritoryCounties(
    excluded,
    ["01001"],
    "state:CC"
  );

  assert.deepEqual(excludedCountyIds(next), []);
  assert.equal(
    next.placements.assignments["01001"],
    "state:CC"
  );
});

test("invalid bulk operations are atomic", () => {
  const { workspace } = fixture();
  const before = excludeCounties(workspace, ["01001"]);

  assert.throws(
    () => restoreCounties(before, ["01001", "99999"]),
    /Unknown county/
  );

  assert.throws(
    () => moveTerritoryCounties(before, ["01001"], "state:ZZ"),
    /Unknown destination/
  );

  assert.deepEqual(excludedCountyIds(before), ["01001"]);
  assert.equal(before.placements.assignments["01001"], "state:AA");
});

test("territory documents round-trip and reject incompatible inventories", () => {
  const { model, workspace } = fixture();

  const current = dissolveAllStates(
    excludeCounties(workspace, ["01001"])
  );

  const encoded = JSON.stringify(
    createTerritoryDocument(current)
  );

  const restored = readTerritoryDocument(
    JSON.parse(encoded),
    model
  );

  assert.deepEqual(
    restored.placements,
    current.placements
  );

  assert.deepEqual(restored.excluded, current.excluded);
  assert.deepEqual(
    restored.archivedStates,
    current.archivedStates
  );

  const incompatible = createStateModel({
    states: model.states,
    assignments: {
      "01001": "state:AA",
    },
  });

  assert.throws(
    () => readTerritoryDocument(JSON.parse(encoded), incompatible),
    /incompatible/
  );
});

test("legacy state models load as fully included territory", () => {
  const { model } = fixture();

  const restored = readTerritoryDocument(
    JSON.parse(JSON.stringify(model)),
    model
  );

  assert.deepEqual(restored.excluded, {});
  assert.deepEqual(restored.placements, model);
});

test("reset restores the original states and clears exclusions", () => {
  const { model, workspace } = fixture();

  const changed = dissolveAllStates(
    excludeCounties(workspace, ["01001"])
  );

  const reset = resetTerritoryWorkspace(model);

  assert.deepEqual(reset.placements, model);
  assert.deepEqual(reset.excluded, {});
  assert.deepEqual(reset.archivedStates, []);
  assert.notDeepEqual(changed.placements, reset.placements);
});