import test from "node:test";
import assert from "node:assert/strict";

import { createStateModel } from "../js/model/state-registry.mjs";
import { createStateManager } from "../js/model/state-management.mjs";

import {
  UNITED_STATES_ID,
  createDissolveAllPlan,
  selectCurrentStateCounties,
} from "../js/model/bulk-state-operations.mjs";

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
    ],
    assignments: {
      "01001": "state:AA",
      "01003": "state:AA",
      "02001": "state:BB",
    },
  });

  let snapshot = Object.freeze({
    revision: 0,
    model,
    totals: [
      { stateId: "state:AA", countyCount: 2 },
      { stateId: "state:BB", countyCount: 1 },
    ],
  });

  let commits = 0;

  const session = {
    getSnapshot: () => snapshot,

    replaceModel(nextModel) {
      commits += 1;

      snapshot = Object.freeze({
        revision: snapshot.revision + 1,
        model: nextModel,
        totals: [],
      });

      return snapshot;
    },

    addState() {
      throw new Error("Not used.");
    },

    renameState() {
      throw new Error("Not used.");
    },

    removeState() {
      throw new Error("Not used.");
    },
  };

  return {
    model,
    session,
    manager: createStateManager(
      session,
      model,
      () => "custom:test"
    ),
    commitCount: () => commits,
  };
}

test("dissolution creates exactly the requested US state", () => {
  const { model } = fixture();
  const plan = createDissolveAllPlan(model);

  assert.deepEqual(plan.nextModel.states, [{
    id: UNITED_STATES_ID,
    name: "United State of America",
    abbreviation: "US",
    kind: "state",
  }]);

  assert.equal(plan.countyCount, 3);
  assert.equal(plan.sourceStateCount, 2);
  assert.equal(plan.changedCountyCount, 3);

  assert.deepEqual(Object.values(plan.nextModel.assignments), [
    UNITED_STATES_ID,
    UNITED_STATES_ID,
    UNITED_STATES_ID,
  ]);

  assert.equal(model.states.length, 2);
  assert.equal(model.assignments["01001"], "state:AA");
});

test("already merged models are unchanged", () => {
  const { model } = fixture();
  const merged = createDissolveAllPlan(model).nextModel;

  assert.equal(
    createDissolveAllPlan(merged).nextModel,
    merged
  );
});

test("dissolution refuses unknown territory metadata", () => {
  const { model } = fixture();

  assert.throws(
    () => createDissolveAllPlan({
      ...model,
      excluded: { "01001": "state:AA" },
    }),
    /territory data/
  );
});

test("selection uses current assignments and is additive", () => {
  const { model } = fixture();

  assert.deepEqual(
    selectCurrentStateCounties(
      model,
      "01001",
      ["02001"]
    ),
    ["01001", "01003", "02001"]
  );
});

test("selection rejects unknown counties without changing inputs", () => {
  const { model } = fixture();
  const selected = ["02001"];

  assert.throws(
    () => selectCurrentStateCounties(model, "99999", selected),
    /Unknown county/
  );

  assert.throws(
    () => selectCurrentStateCounties(model, "01001", ["99999"]),
    /Unknown county/
  );

  assert.deepEqual(selected, ["02001"]);
});

test("the manager commits a complete dissolution atomically", () => {
  const { manager, commitCount } = fixture();

  const plan = manager.previewDissolveAll();
  const after = manager.dissolveAll(plan);

  assert.equal(after.revision, 1);
  assert.equal(after.model.states.length, 1);
  assert.equal(commitCount(), 1);

  assert.equal(
    manager.dissolveAll(manager.previewDissolveAll()),
    after
  );

  assert.equal(commitCount(), 1);
});

test("stale dissolution previews cannot overwrite newer changes", () => {
  const { manager, session, model, commitCount } = fixture();
  const plan = manager.previewDissolveAll();

  session.replaceModel(model);

  const before = session.getSnapshot();

  assert.throws(
    () => manager.dissolveAll(plan),
    /configuration changed/
  );

  assert.equal(session.getSnapshot(), before);
  assert.equal(commitCount(), 1);
});

test("the manager exposes additive state selection", () => {
  const { manager } = fixture();

  assert.deepEqual(
    manager.selectStateCounties("01001", ["02001"]),
    ["01001", "01003", "02001"]
  );
});