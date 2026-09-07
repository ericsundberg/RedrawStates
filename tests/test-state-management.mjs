import test from "node:test";
import assert from "node:assert/strict";

import { createStateModel } from "../js/model/state-registry.mjs";
import { createStateSession } from "../js/model/state-session.mjs";
import { createStateManager } from "../js/model/state-management.mjs";
import {
  encodeConfiguration,
  decodeConfiguration,
} from "../js/map/map-share.mjs";

function makeFixture() {
  const model = createStateModel({
    states: [
      { id: "state:a", name: "Alpha", abbreviation: "AA" },
      { id: "state:b", name: "Beta", abbreviation: "BB" },
    ],
    assignments: {
      "00001": "state:a",
      "00002": "state:a",
      "00003": "state:b",
    },
  });

  const dataset = {
    metadata: { id: "test", measurement: { kind: "population" } },
    model,
    candidateIds: ["a", "b", "c"],
    counties: [
      {
        id: "00001",
        population: 600,
        landAreaM2: 2_000_000,
        waterAreaM2: 1_000_000,
        votes: { a: 60, b: 40, c: 0 },
      },
      {
        id: "00002",
        population: 400,
        landAreaM2: 1_000_000,
        waterAreaM2: 0,
        votes: { a: 10, b: 80, c: 10 },
      },
      {
        id: "00003",
        population: 200,
        landAreaM2: 2_000_000,
        waterAreaM2: 0,
        votes: { a: 5, b: 5, c: 90 },
      },
    ],
  };

  const session = createStateSession(dataset);

  let nextId = 0;

  const manager = createStateManager(
    session,
    model,
    () => `custom:test-${++nextId}`
  );

  return { dataset, session, manager };
}

test("lists original states and their current county counts", () => {
  const { manager } = makeFixture();
  const rows = manager.listStates();

  assert.equal(rows.length, 2);
  assert.equal(rows[0].isOriginal, true);
  assert.equal(rows[0].countyCount, 2);
  assert.equal(rows[1].countyCount, 1);
  assert.ok(Object.isFrozen(rows[0]));
});

test("creates a normalized state with a stable custom ID", () => {
  const { manager, session } = makeFixture();

  const result = manager.create({
    name: "  New State  ",
    abbreviation: " ns ",
  });

  assert.equal(result.state.id, "custom:test-1");
  assert.equal(result.state.name, "New State");
  assert.equal(result.state.abbreviation, "NS");
  assert.equal(result.snapshot.model.states.length, 3);

  const total = session.getSnapshot().totals.find(
    (item) => item.stateId === result.state.id
  );

  assert.equal(total.countyCount, 0);
  assert.equal(total.population, 0);
});

test("rejects invalid or duplicate names without changing the session", () => {
  const { manager, session } = makeFixture();
  const before = session.getSnapshot();

  assert.throws(
    () => manager.create({ name: "", abbreviation: "EX" }),
    /must have a name/
  );

  assert.throws(
    () => manager.create({ name: "Duplicate", abbreviation: "AA" }),
    /Duplicate state abbreviation/
  );

  assert.equal(session.getSnapshot(), before);
});

test("renaming preserves state identity, assignments, and source data", () => {
  const { dataset, manager, session } = makeFixture();

  manager.rename("state:a", {
    name: "New Alpha",
    abbreviation: "NA",
  });

  const snapshot = session.getSnapshot();

  assert.equal(snapshot.model.states[0].id, "state:a");
  assert.equal(snapshot.model.states[0].abbreviation, "NA");
  assert.equal(snapshot.model.assignments["00001"], "state:a");
  assert.equal(dataset.model.states[0].name, "Alpha");
  assert.equal(manager.listStates()[0].nameChanged, true);
});

test("an unchanged name does not create a new revision", () => {
  const { manager, session } = makeFixture();
  const before = session.getSnapshot();

  const result = manager.rename("state:a", {
    name: "Alpha",
    abbreviation: "aa",
  });

  assert.equal(result, before);
  assert.equal(session.getSnapshot().revision, 0);
});

test("restores original names and rejects conflicting abbreviations", () => {
  const { manager, session } = makeFixture();

  manager.rename("state:a", {
    name: "Renamed",
    abbreviation: "RA",
  });

  manager.restoreName("state:a");

  assert.equal(session.getSnapshot().model.states[0].name, "Alpha");
  assert.equal(manager.listStates()[0].nameChanged, false);

  assert.throws(
    () => manager.rename("state:a", { abbreviation: "BB" }),
    /Duplicate state abbreviation/
  );

  assert.throws(
    () => manager.restoreName("custom:missing"),
    /does not have an original name/
  );
});

test("dissolves an occupied state atomically into a destination", () => {
  const { manager, session } = makeFixture();

  const plan = manager.previewDissolution("state:a", "state:b");

  assert.deepEqual(plan.countyIds, ["00001", "00002"]);
  assert.equal(plan.source.name, "Alpha");
  assert.equal(plan.destination.name, "Beta");
  assert.ok(Object.isFrozen(plan));

  const snapshot = manager.dissolve(plan);

  assert.equal(snapshot.model.states.length, 1);
  assert.equal(snapshot.model.assignments["00001"], "state:b");
  assert.equal(snapshot.model.assignments["00002"], "state:b");
  assert.equal(snapshot.totals[0].population, 1200);
  assert.equal(snapshot.totals[0].landAreaM2, 5_000_000);
  assert.deepEqual(snapshot.totals[0].votes, {
    a: 75,
    b: 125,
    c: 100,
  });
});

test("an empty state can be removed without a destination", () => {
  const { manager, session } = makeFixture();

  const created = manager.create({
    name: "Empty",
    abbreviation: "EE",
  });

  const plan = manager.previewDissolution(created.state.id);

  assert.equal(plan.countyIds.length, 0);
  assert.equal(plan.destinationId, null);

  manager.dissolve(plan);

  assert.equal(session.getSnapshot().model.states.length, 2);
  assert.equal(session.getSnapshot().model.assignments["00001"], "state:a");
});

test("refuses unsafe destinations and the last remaining state", () => {
  const { manager, session } = makeFixture();
  const before = session.getSnapshot();

  assert.throws(
    () => manager.previewDissolution("state:a"),
    /destination state is required/
  );

  assert.throws(
    () => manager.previewDissolution("state:a", "state:a"),
    /cannot be dissolved into itself/
  );

  assert.throws(
    () => manager.previewDissolution("state:a", "missing"),
    /Unknown destination/
  );

  assert.equal(session.getSnapshot(), before);

  manager.dissolve(
    manager.previewDissolution("state:a", "state:b")
  );

  assert.throws(
    () => manager.previewDissolution("state:b"),
    /last remaining state/
  );
});

test("a stale dissolution preview cannot be committed", () => {
  const { manager, session } = makeFixture();

  const plan = manager.previewDissolution("state:a", "state:b");

  session.moveCounties(["00001"], "state:b");
  const before = session.getSnapshot();

  assert.throws(
    () => manager.dissolve(plan),
    /configuration changed/
  );

  assert.equal(session.getSnapshot(), before);
});

test("renames and dissolutions survive the versioned share round trip", () => {
  const { dataset, manager, session } = makeFixture();

  manager.rename("state:a", {
    name: "Renamed Alpha",
    abbreviation: "RA",
  });

  manager.create({
    name: "Third State",
    abbreviation: "TS",
  });

  const createdId = "custom:test-1";

  session.moveCounties(["00001"], createdId);

  manager.dissolve(
    manager.previewDissolution("state:b", createdId)
  );

  const current = session.getSnapshot().model;
  const encoded = encodeConfiguration(dataset, current);
  const restored = decodeConfiguration(dataset, encoded);

  assert.deepEqual(restored, current);
  assert.equal(restored.states.length, 2);
  assert.equal(restored.assignments["00003"], createdId);
});