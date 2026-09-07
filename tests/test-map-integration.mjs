import test from "node:test";
import assert from "node:assert/strict";

import { createStateModel } from "../js/model/state-registry.mjs";
import { createStateSession } from "../js/model/state-session.mjs";

import {
  computeAllocation,
  summarizeAllocation,
  leadingBucket,
} from "../js/model/state-simulation.mjs";

import {
  encodeConfiguration,
  decodeConfiguration,
  decodeLegacyShare,
} from "../js/map/map-share.mjs";

function makeDataset(incomeMode = false) {
  const states = [
    { id: "state:AL", name: "Alpha", abbreviation: "AL", kind: "state" },
    { id: "state:AK", name: "Beta", abbreviation: "AK", kind: "state" },
    { id: "state:DC", name: "District", abbreviation: "DC", kind: "district" },
  ];

  const assignments = {
    "01001": "state:AL",
    "01003": "state:AL",
    "02000": "state:AK",
  };

  const counties = [
    {
      id: "01001",
      name: "One",
      population: incomeMode ? null : 600,
      landAreaM2: 2_000_000,
      waterAreaM2: 0,
      measures: { incomeWeightDollars: 6000 },
      votes: { a: 60, b: 40, c: 0 },
    },
    {
      id: "01003",
      name: "Two",
      population: incomeMode ? null : 400,
      landAreaM2: 1_000_000,
      waterAreaM2: 0,
      measures: { incomeWeightDollars: 4000 },
      votes: { a: 10, b: 80, c: 10 },
    },
    {
      id: "02000",
      name: "Three",
      population: incomeMode ? null : 200,
      landAreaM2: 2_000_000,
      waterAreaM2: 0,
      measures: { incomeWeightDollars: 2000 },
      votes: { a: 5, b: 5, c: 90 },
    },
  ];

  const model = createStateModel({ states, assignments });

  return {
    metadata: {
      id: incomeMode ? "2016i" : "2024",
      measurement: { kind: incomeMode ? "income-weight" : "population" },
    },
    model,
    counties,
    candidateIds: ["a", "b", "c"],
    topology: {
      objects: {
        counties: {
          geometries: [
            { id: "01001", properties: { id: "01001" } },
            { id: "01003", properties: { id: "01003" } },
            { id: "02000", properties: { id: "02000" } },
          ],
        },
      },
    },
  };
}

test("a new state receives counties through the immutable session", () => {
  const dataset = makeDataset();
  const session = createStateSession(dataset);

  session.addState({
    id: "custom:example",
    name: "Example",
    abbreviation: "EX",
  });

  session.moveCounties(["01001"], "custom:example");

  const snapshot = session.getSnapshot();

  assert.equal(snapshot.model.assignments["01001"], "custom:example");
  assert.equal(dataset.model.assignments["01001"], "state:AL");

  const total = snapshot.totals.find(
    (item) => item.stateId === "custom:example"
  );

  assert.equal(total.population, 600);
  assert.equal(total.votes.a, 60);
});

test("hypothetical allocation includes additional nonempty states", () => {
  const dataset = makeDataset();
  const session = createStateSession(dataset);

  session.addState({
    id: "custom:example",
    name: "Example",
    abbreviation: "EX",
  });

  session.moveCounties(["01001"], "custom:example");

  const allocation = computeAllocation(session.getSnapshot(), dataset);

  assert.equal(allocation.status, "available");
  assert.equal(allocation.basis, "population");
  assert.equal(allocation.totalElectors, 441);
  assert.equal(allocation.byState.get("state:DC"), 0);
});

test("the third vote bucket can lead a state", () => {
  const dataset = makeDataset();
  const session = createStateSession(dataset);
  const snapshot = session.getSnapshot();
  const allocation = computeAllocation(snapshot, dataset);
  const summary = summarizeAllocation(snapshot, dataset, allocation);

  assert.equal(leadingBucket({ a: 5, b: 5, c: 90 }), "c");
  assert.ok(summary.bucketTotals.c > 0);
});

test("ties are not assigned to an arbitrary bucket", () => {
  const dataset = makeDataset();
  dataset.counties[2].votes = { a: 50, b: 50, c: 0 };

  const session = createStateSession(dataset);
  const snapshot = session.getSnapshot();
  const allocation = computeAllocation(snapshot, dataset);
  const summary = summarizeAllocation(snapshot, dataset, allocation);

  assert.equal(summary.stateSummaries.get("state:AK").status, "tie");
  assert.equal(summary.unallocated, allocation.byState.get("state:AK"));
});

test("income weights are separate from population", () => {
  const dataset = makeDataset(true);
  const session = createStateSession(dataset);
  const snapshot = session.getSnapshot();

  assert.equal(snapshot.totals[0].population, null);

  const allocation = computeAllocation(snapshot, dataset);

  assert.equal(allocation.status, "available");
  assert.equal(allocation.basis, "income-weight");
});

test("versioned sharing restores names and movements without mutation", () => {
  const dataset = makeDataset();
  const session = createStateSession(dataset);

  session.addState({
    id: "custom:example",
    name: "Example State",
    abbreviation: "EX",
  });

  session.moveCounties(["01001"], "custom:example");

  const model = session.getSnapshot().model;
  const encoded = encodeConfiguration(dataset, model);
  const restored = decodeConfiguration(dataset, encoded);

  assert.deepEqual(restored, model);
  assert.equal(dataset.model.assignments["01001"], "state:AL");
});

test("legacy sharing restores the original state order", () => {
  const dataset = makeDataset();

  // In the synthetic registry: a = AL, b = AK, c = DC.
  const restored = decodeLegacyShare(dataset, "b2a");

  assert.equal(restored.assignments["01001"], "state:AK");
  assert.equal(restored.assignments["01003"], "state:AL");
  assert.equal(restored.assignments["02000"], "state:AL");
});

test("malformed share data is rejected", () => {
  const dataset = makeDataset();

  assert.throws(
    () => decodeConfiguration(dataset, "not-valid"),
    /Invalid|Unexpected|share/i
  );

  assert.throws(
    () => decodeLegacyShare(dataset, "999a"),
    /longer than/
  );
});