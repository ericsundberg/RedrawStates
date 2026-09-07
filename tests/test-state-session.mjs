import test from "node:test";
import assert from "node:assert/strict";

import { convertLegacyTopology } from "../js/data/legacy-datasets.mjs";
import { createStateSession } from "../js/model/state-session.mjs";

function makeDataset() {
  return convertLegacyTopology({
    type: "Topology",
    arcs: [],
    objects: {
      counties: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Polygon",
            id: "01001",
            properties: {
              name: "Example A",
              state: "AL",
              population: 600,
              landAreaM2: 2_000_000,
              waterAreaM2: 0,
              dem: 60,
              gop: 40,
            },
            arcs: [],
          },
          {
            type: "Polygon",
            id: "01003",
            properties: {
              name: "Example B",
              state: "AL",
              population: 400,
              landAreaM2: 1_000_000,
              waterAreaM2: 0,
              dem: 10,
              gop: 80,
            },
            arcs: [],
          },
        ],
      },
    },
  });
}

test("starts with a consistent state-model snapshot", () => {
  const session = createStateSession(makeDataset());
  const snapshot = session.getSnapshot();

  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.model.assignments["01001"], "state:AL");
  assert.equal(
    snapshot.totals.find((total) => total.stateId === "state:AL")
      .population,
    1000
  );

  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.totals));
});

test("creates a state and moves counties into it", () => {
  const session = createStateSession(makeDataset());

  session.addState({
    id: "custom:example",
    name: "Example State",
    abbreviation: "EX",
  });

  const snapshot = session.moveCounties(
    ["01001"],
    "custom:example"
  );

  assert.equal(
    snapshot.model.assignments["01001"],
    "custom:example"
  );

  const created = snapshot.totals.find(
    (total) => total.stateId === "custom:example"
  );

  assert.equal(created.population, 600);
  assert.equal(created.landAreaM2, 2_000_000);
  assert.equal(created.votes.dem, 60);
});

test("renaming a state preserves its identity and assignments", () => {
  const session = createStateSession(makeDataset());

  session.renameState("state:AL", {
    name: "Renamed Alabama",
    abbreviation: "RA",
  });

  const snapshot = session.getSnapshot();

  assert.equal(snapshot.model.states[0].id, "state:AL");
  assert.equal(snapshot.model.states[0].abbreviation, "RA");
  assert.equal(snapshot.model.assignments["01001"], "state:AL");
});

test("failed operations do not change the current snapshot", () => {
  const session = createStateSession(makeDataset());
  const before = session.getSnapshot();

  assert.throws(
    () => session.moveCounties(["missing"], "state:AK"),
    /Unknown county/
  );

  assert.equal(session.getSnapshot(), before);
  assert.equal(session.getSnapshot().revision, 0);
});

test("subscribers receive changes and can unsubscribe", () => {
  const session = createStateSession(makeDataset());
  const revisions = [];

  const unsubscribe = session.subscribe(
    (snapshot) => revisions.push(snapshot.revision)
  );

  session.moveCounties(["01001"], "state:AK");
  unsubscribe();
  session.moveCounties(["01003"], "state:AK");

  assert.deepEqual(revisions, [0, 1]);
});

test("reset restores the original assignments and totals", () => {
  const session = createStateSession(makeDataset());

  session.moveCounties(["01001"], "state:AK");
  session.reset();

  const snapshot = session.getSnapshot();

  assert.equal(snapshot.model.assignments["01001"], "state:AL");
  assert.equal(
    snapshot.totals.find((total) => total.stateId === "state:AL")
      .population,
    1000
  );

  assert.equal(snapshot.revision, 2);
});

test("a replacement model must contain the full county inventory", () => {
  const session = createStateSession(makeDataset());
  const before = session.getSnapshot();

  const invalid = {
    version: 1,
    states: before.model.states,
    assignments: {
      "01001": "state:AL",
    },
  };

  assert.throws(
    () => session.replaceModel(invalid),
    /County 01003 has no state assignment/
  );

  assert.equal(session.getSnapshot(), before);
  assert.equal(session.getSnapshot().revision, 0);
});