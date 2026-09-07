import test from "node:test";
import assert from "node:assert/strict";

import {
  addState,
  createStateModel,
  moveCounties,
  removeState,
  renameState,
  validateStateModel,
} from "../js/model/state-registry.mjs";

import {
  aggregateStates,
  summarizeVotes,
} from "../js/model/state-aggregation.mjs";

const states = [
  {
    id: "state:a",
    name: "Alpha",
    abbreviation: "AA",
    kind: "state",
  },
  {
    id: "state:b",
    name: "Beta",
    abbreviation: "BB",
    kind: "state",
  },
];

function createFixture() {
  return createStateModel({
    states,
    assignments: {
      "00001": "state:a",
      "00002": "state:a",
      "00003": "state:b",
    },
  });
}

const counties = [
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
];

const candidateIds = ["a", "b", "c"];

test("creates a valid, immutable, serializable model", () => {
  const model = createFixture();

  assert.equal(validateStateModel(model), true);
  assert.equal(model.version, 1);
  assert.equal(model.assignments["00001"], "state:a");

  assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.states));
  assert.ok(Object.isFrozen(model.assignments));

  const restored = JSON.parse(JSON.stringify(model));
  assert.equal(validateStateModel(restored), true);
  assert.deepEqual(restored, model);
});

test("rejects duplicate state IDs and abbreviations", () => {
  assert.throws(
    () => createStateModel({
      states: [...states, { ...states[0] }],
    }),
    /Duplicate state ID/
  );

  assert.throws(
    () => createStateModel({
      states: [
        ...states,
        { id: "state:c", name: "Gamma", abbreviation: "aa" },
      ],
    }),
    /Duplicate state abbreviation/
  );
});

test("creates and renames states without changing stable IDs", () => {
  const original = createFixture();

  const added = addState(original, {
    id: "custom:example-1",
    name: "New State",
    abbreviation: "NS",
  });

  const renamed = renameState(added, "custom:example-1", {
    name: "Renamed State",
    abbreviation: "RS",
  });

  assert.equal(original.states.length, 2);
  assert.equal(added.states.length, 3);

  const created = renamed.states.find(
    (state) => state.id === "custom:example-1"
  );

  assert.equal(created.name, "Renamed State");
  assert.equal(created.abbreviation, "RS");
  assert.equal(created.id, "custom:example-1");

  assert.throws(
    () => renameState(renamed, "custom:example-1", {
      abbreviation: "AA",
    }),
    /Duplicate state abbreviation/
  );
});

test("moves counties atomically and preserves the original model", () => {
  const original = createFixture();

  const moved = moveCounties(
    original,
    ["00001", "00002", "00001"],
    "state:b"
  );

  assert.equal(moved.assignments["00001"], "state:b");
  assert.equal(moved.assignments["00002"], "state:b");
  assert.equal(original.assignments["00001"], "state:a");

  assert.throws(
    () => moveCounties(original, ["00001", "missing"], "state:b"),
    /Unknown county/
  );

  assert.equal(original.assignments["00001"], "state:a");

  assert.throws(
    () => moveCounties(original, ["00001"], "state:unknown"),
    /Unknown destination/
  );
});

test("dissolving a state requires a safe destination", () => {
  const original = createFixture();

  assert.throws(
    () => removeState(original, "state:a"),
    /destination state is required/
  );

  const dissolved = removeState(original, "state:a", "state:b");

  assert.equal(dissolved.states.length, 1);
  assert.equal(dissolved.assignments["00001"], "state:b");
  assert.equal(dissolved.assignments["00002"], "state:b");

  assert.throws(
    () => removeState(dissolved, "state:b"),
    /last remaining state/
  );

  assert.equal(original.states.length, 2);
});

test("an empty state can be removed without reassigning counties", () => {
  const original = addState(createFixture(), {
    id: "custom:empty",
    name: "Empty",
    abbreviation: "EE",
  });

  const removed = removeState(original, "custom:empty");

  assert.equal(removed.states.length, 2);
  assert.deepEqual(removed.assignments, createFixture().assignments);
});

test("aggregates population, land, water, and all candidates", () => {
  const totals = aggregateStates(createFixture(), counties, {
    candidateIds,
  });

  const alpha = totals.find((total) => total.stateId === "state:a");

  assert.equal(alpha.countyCount, 2);
  assert.equal(alpha.population, 1000);
  assert.equal(alpha.landAreaM2, 3_000_000);
  assert.equal(alpha.waterAreaM2, 1_000_000);
  assert.equal(alpha.totalAreaM2, 4_000_000);
  assert.ok(Math.abs(alpha.densityPerKm2 - 1000 / 3) < 1e-10);

  assert.deepEqual(alpha.votes, {
    a: 70,
    b: 120,
    c: 10,
  });

  assert.deepEqual(summarizeVotes(alpha.votes), {
    status: "leader",
    leadingIds: ["b"],
    totalVotes: 200,
  });
});

test("recomputes totals after moving a county", () => {
  const model = moveCounties(createFixture(), ["00002"], "state:b");

  const totals = aggregateStates(model, counties, { candidateIds });
  const alpha = totals.find((total) => total.stateId === "state:a");
  const beta = totals.find((total) => total.stateId === "state:b");

  assert.equal(alpha.population, 600);
  assert.equal(beta.population, 600);
  assert.equal(beta.landAreaM2, 3_000_000);

  assert.deepEqual(beta.votes, {
    a: 15,
    b: 85,
    c: 100,
  });

  assert.deepEqual(summarizeVotes(beta.votes).leadingIds, ["c"]);
});

test("missing measurements are not silently treated as zero", () => {
  const incomplete = counties.map((county) => ({ ...county }));

  incomplete[1].population = null;
  incomplete[1].waterAreaM2 = null;
  incomplete[1].votes = null;

  const totals = aggregateStates(createFixture(), incomplete, {
    candidateIds,
  });

  const alpha = totals.find((total) => total.stateId === "state:a");

  assert.equal(alpha.population, null);
  assert.equal(alpha.waterAreaM2, null);
  assert.equal(alpha.totalAreaM2, null);
  assert.equal(alpha.densityPerKm2, null);
  assert.equal(alpha.landAreaM2, 3_000_000);

  assert.equal(alpha.missing.population, 1);
  assert.equal(alpha.missing.waterAreaM2, 1);
  assert.equal(alpha.missing.votes, 1);

  assert.equal(summarizeVotes(alpha.votes).status, "incomplete");
});

test("zero area is not converted into an invalid density", () => {
  const model = createStateModel({
    states,
    assignments: { "00001": "state:a" },
  });

  const totals = aggregateStates(model, [{
    id: "00001",
    population: 10,
    landAreaM2: 0,
    waterAreaM2: 0,
  }]);

  assert.equal(totals[0].population, 10);
  assert.equal(totals[0].densityPerKm2, null);
  assert.equal(totals[1].population, 0);
  assert.equal(totals[1].countyCount, 0);
});

test("rejects incomplete inventories, duplicates, and unknown candidates", () => {
  const model = createFixture();

  assert.throws(
    () => aggregateStates(model, counties.slice(0, 2)),
    /Missing county records/
  );

  assert.throws(
    () => aggregateStates(model, [...counties, counties[0]]),
    /Duplicate county record/
  );

  assert.throws(
    () => aggregateStates(model, [{
      ...counties[0],
      votes: { unknown: 10 },
    }, counties[1], counties[2]], { candidateIds }),
    /unknown candidate/
  );
});

test("reports ties, unavailable data, and zero-vote contests explicitly", () => {
  assert.deepEqual(summarizeVotes({ a: 40, b: 40, c: 10 }), {
    status: "tie",
    leadingIds: ["a", "b"],
    totalVotes: 90,
  });

  assert.equal(summarizeVotes({ a: 0, b: 0 }).status, "no-data");
  assert.equal(summarizeVotes({ a: null, b: 10 }).status, "incomplete");
  assert.equal(summarizeVotes(null).status, "unavailable");
});