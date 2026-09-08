import test from "node:test";
import assert from "node:assert/strict";

import {
  buildElectoralBarModel,
} from "../js/ui/electoral-bar-model.mjs";

function fixture() {
  const snapshot = {
    model: {
      states: [
        {
          id: "state:MA",
          name: "Massachusetts",
          abbreviation: "MA",
        },
        {
          id: "custom:plymouth",
          name: "Plymouth",
          abbreviation: "PL",
        },
        {
          id: "state:NY",
          name: "New York",
          abbreviation: "NY",
        },
        {
          id: "custom:empty",
          name: "Empty",
          abbreviation: "EE",
        },
      ],
    },
  };

  const dataset = {
    metadata: {
      voteFields: [
        { id: "dem", label: "Democrat" },
        { id: "gop", label: "GOP" },
        { id: "grn", label: "Green" },
      ],
    },
  };

  const allocation = {
    status: "available",
    totalElectors: 24,
    byState: new Map([
      ["state:MA", 10],
      ["custom:plymouth", 4],
      ["state:NY", 10],
      ["custom:empty", 0],
    ]),
  };

  const summary = {
    bucketTotals: {
      dem: 10,
      gop: 10,
      grn: 0,
    },
    unallocated: 4,
    stateSummaries: new Map([
      ["state:MA", { status: "leader", leadingIds: ["dem"] }],
      ["custom:plymouth", { status: "tie", leadingIds: ["dem", "gop"] }],
      ["state:NY", { status: "leader", leadingIds: ["gop"] }],
      ["custom:empty", { status: "no-votes", leadingIds: [] }],
    ]),
  };

  return { snapshot, dataset, allocation, summary };
}

test("state segments reconcile to the modeled total", () => {
  const values = fixture();

  const result = buildElectoralBarModel(
    values.snapshot,
    values.dataset,
    values.allocation,
    values.summary
  );

  assert.equal(result.totalElectors, 24);
  assert.equal(
    result.states.reduce((sum, state) => sum + state.electors, 0),
    24
  );
  assert.equal(
    result.groups.reduce((sum, group) => sum + group.total, 0),
    24
  );
});

test("state names and codes remain separate", () => {
  const values = fixture();

  const result = buildElectoralBarModel(
    values.snapshot,
    values.dataset,
    values.allocation,
    values.summary
  );

  const plymouth = result.states.find(
    (state) => state.id === "custom:plymouth"
  );

  assert.equal(plymouth.name, "Plymouth");
  assert.equal(plymouth.code, "PL");
  assert.equal(plymouth.electors, 4);
});

test("ties remain unallocated rather than receiving an arbitrary color", () => {
  const values = fixture();

  const result = buildElectoralBarModel(
    values.snapshot,
    values.dataset,
    values.allocation,
    values.summary
  );

  const plymouth = result.states.find(
    (state) => state.id === "custom:plymouth"
  );

  assert.equal(plymouth.bucketId, "unallocated");
  assert.equal(result.groups.at(-1).total, 4);
});

test("a third recorded bucket receives its own state segments", () => {
  const values = fixture();

  values.summary.stateSummaries.set(
    "custom:plymouth",
    { status: "leader", leadingIds: ["grn"] }
  );

  values.summary.bucketTotals.grn = 4;
  values.summary.unallocated = 0;

  const result = buildElectoralBarModel(
    values.snapshot,
    values.dataset,
    values.allocation,
    values.summary
  );

  const green = result.groups.find((group) => group.id === "grn");

  assert.equal(green.total, 4);
  assert.deepEqual(
    green.states.map((state) => state.id),
    ["custom:plymouth"]
  );
});

test("zero-elector states remain in the inspect inventory", () => {
  const values = fixture();

  const result = buildElectoralBarModel(
    values.snapshot,
    values.dataset,
    values.allocation,
    values.summary
  );

  assert.equal(result.states.length, 4);
  assert.equal(
    result.states.find((state) => state.id === "custom:empty").electors,
    0
  );
});

test("unavailable allocations do not invent segment counts", () => {
  const values = fixture();

  values.allocation.status = "unavailable";
  values.allocation.totalElectors = null;

  const result = buildElectoralBarModel(
    values.snapshot,
    values.dataset,
    values.allocation,
    values.summary
  );

  assert.equal(result.status, "unavailable");
  assert.equal(result.totalElectors, null);
  assert.deepEqual(result.states, []);
});

test("inconsistent allocation summaries are rejected", () => {
  const values = fixture();

  values.summary.bucketTotals.dem = 11;

  assert.throws(
    () => buildElectoralBarModel(
      values.snapshot,
      values.dataset,
      values.allocation,
      values.summary
    ),
    /do not reconcile/
  );
});

test("the presentation model does not mutate its inputs", () => {
  const values = fixture();
  const originalName = values.snapshot.model.states[0].name;

  buildElectoralBarModel(
    values.snapshot,
    values.dataset,
    values.allocation,
    values.summary
  );

  assert.equal(values.snapshot.model.states[0].name, originalName);
  assert.equal(values.allocation.byState.get("state:MA"), 10);
});