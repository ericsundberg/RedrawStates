import test from "node:test";
import assert from "node:assert/strict";

import {
  createStateModel,
} from "../js/model/state-registry.mjs";

import {
  createStateSession,
} from "../js/model/state-session.mjs";

import {
  createTerritoryDocument,
  readTerritoryDocument,
} from "../js/model/territory-workspace.mjs";

import {
  encodeTerritoryConfiguration,
  decodeTerritoryConfiguration,
  restoreTerritoryShare,
} from "../js/map/territory-share.mjs";

import {
  computeTerritoryAllocation,
} from "../js/map/territory-allocation.mjs";

import {
  computeAllocation,
  getIncomeWeights,
} from "../js/model/state-simulation.mjs";

import {
  buildTerritoryStateFeatures,
} from "../js/map/map-territory-view.mjs";

function fixture() {
  const states = [
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
  ];

  const assignments = {
    "01001": "state:AA",
    "01003": "state:AA",
    "02001": "state:BB",
    "02003": "state:BB",
    "03001": "state:CC",
  };

  const model = createStateModel({ states, assignments });

  const counties = Object.keys(assignments).map((id, i) => ({
    id,
    name: id,
    originalStateId: assignments[id],
    population: (i + 1) * 100,
    landAreaM2: 1_000_000,
    waterAreaM2: 100,
    votes: {
      dem: (i + 1) * 60,
      gop: (i + 1) * 40,
    },
    measures: {
      incomeWeightDollars: (i + 1) * 1000,
    },
  }));

  const dataset = {
    model,
    counties,
    candidateIds: ["dem", "gop"],
    metadata: {
      id: "2024",
      schema: "test-v1",
      measurement: { kind: "population" },
      voteFields: [],
    },
    geometriesById: new Map(
      counties.map((county) => [
        county.id,
        { id: county.id },
      ])
    ),
    topology: {},
  };

  return {
    dataset,
    session: createStateSession(dataset),
  };
}

test("excluded counties retain placement and leave all US totals", () => {
  const { dataset, session } = fixture();
  const original = JSON.stringify(dataset.counties);

  session.excludeCounties(["01001", "02001"]);

  const snapshot = session.getSnapshot();

  assert.equal(
    Object.keys(snapshot.model.assignments).length,
    5
  );

  assert.deepEqual(
    Object.keys(snapshot.excluded).sort(),
    ["01001", "02001"]
  );

  assert.equal(
    snapshot.totals.reduce(
      (sum, total) => sum + total.population,
      0
    ),
    1100
  );

  assert.equal(snapshot.excludedTotals.population, 400);
  assert.equal(snapshot.excludedTotals.landAreaM2, 2_000_000);
  assert.equal(snapshot.excludedTotals.votes.dem, 240);
  assert.equal(JSON.stringify(dataset.counties), original);
});

test("selection, removal, restoration, and reassignment are reversible", () => {
  const { session } = fixture();

  session.excludeCounties(["01001", "02001"]);

  assert.deepEqual(
    session.selectStateCounties("01001", ["03001"]),
    ["01001", "02001", "03001"]
  );

  session.moveCounties(["01001"], "state:BB");

  assert.equal(session.getSnapshot().excluded["01001"], undefined);
  assert.equal(
    session.getSnapshot().model.assignments["01001"],
    "state:BB"
  );

  session.restoreCounties(["02001"]);

  assert.equal(
    Object.keys(session.getSnapshot().excluded).length,
    0
  );

  assert.equal(
    session.getSnapshot().model.assignments["02001"],
    "state:BB"
  );
});

test("dissolve all preserves exclusions and archived restoration history", () => {
  const { session } = fixture();

  session.excludeCounties(["01001"]);

  const plan = createStateModel({
    states: [{
      id: "custom:united-states-of-america",
      name: "United State of America",
      abbreviation: "US",
      kind: "state",
    }],
    assignments: Object.fromEntries(
      Object.keys(session.getSnapshot().model.assignments)
        .map((id) => [
          id,
          "custom:united-states-of-america",
        ])
    ),
  });

  session.replaceModel(plan);

  let snapshot = session.getSnapshot();

  assert.equal(snapshot.model.states.length, 1);
  assert.equal(snapshot.model.states[0].abbreviation, "US");
  assert.equal(snapshot.excluded["01001"], "state:AA");
  assert.equal(snapshot.territory.archivedStates.length, 3);
  assert.equal(snapshot.totals[0].population, 1400);

  assert.throws(
    () => session.restoreCounties(["01001"]),
    /no longer active/
  );

  session.reactivateArchivedState("state:AA");
  session.restoreCounties(["01001"]);

  snapshot = session.getSnapshot();

  assert.equal(
    snapshot.model.assignments["01001"],
    "state:AA"
  );

  assert.equal(Object.keys(snapshot.excluded).length, 0);
});

test("previous states can be reactivated and restored in one transaction", () => {
  const { session } = fixture();

  session.excludeCounties(["01001", "02001"]);
  session.dissolveAllStates();

  const before = session.getSnapshot();
  const after = session.restorePreviousStates(["01001", "02001"]);

  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.model.assignments["01001"], "state:AA");
  assert.equal(after.model.assignments["02001"], "state:BB");
  assert.equal(after.excludedTotals.countyCount, 0);
  assert.equal(after.model.states.length, 3);
});

test("invalid changes leave both model and membership unchanged", () => {
  const { session } = fixture();

  session.excludeCounties(["01001"]);

  const before = session.getSnapshot();

  assert.throws(
    () => session.restoreCounties(["01001", "99999"]),
    /Unknown county/
  );

  assert.throws(
    () => session.moveCounties(["01001"], "state:ZZ"),
    /Unknown destination/
  );

  assert.equal(session.getSnapshot(), before);

  assert.throws(
    () => session.replaceModel(createStateModel({
      states: before.model.states,
      assignments: { "01001": "state:AA" },
    })),
    /County 01003 has no state assignment/
  );

  assert.equal(session.getSnapshot(), before);
});

test("ordinary model replacement and reset preserve or clear membership intentionally", () => {
  const { dataset, session } = fixture();

  session.excludeCounties(["01001"]);

  const next = createStateModel({
    states: dataset.model.states,
    assignments: {
      ...dataset.model.assignments,
      "01001": "state:BB",
    },
  });

  session.replaceModel(next);

  assert.equal(
    session.getSnapshot().excluded["01001"],
    "state:AA"
  );

  assert.equal(
    session.getSnapshot().model.assignments["01001"],
    "state:BB"
  );

  session.reset();

  assert.deepEqual(session.getSnapshot().excluded, {});
  assert.deepEqual(session.getSnapshot().model, dataset.model);
});

test("version 3 sharing preserves boundaries, exclusions, and archives", () => {
  const { dataset, session } = fixture();

  session.excludeCounties(["01001", "02001"]);
  session.dissolveAllStates();

  const workspace = session.getTerritoryWorkspace();
  const encoded = encodeTerritoryConfiguration(dataset, workspace);
  const decoded = decodeTerritoryConfiguration(dataset, encoded);

  assert.deepEqual(decoded.placements, workspace.placements);
  assert.deepEqual(decoded.excluded, workspace.excluded);
  assert.deepEqual(decoded.archivedStates, workspace.archivedStates);

  assert.deepEqual(
    readTerritoryDocument(
      createTerritoryDocument(decoded),
      dataset.model
    ).excluded,
    workspace.excluded
  );
});

test("malformed and incompatible shares are rejected", () => {
  const { dataset, session } = fixture();

  const encoded = encodeTerritoryConfiguration(
    dataset,
    session.getTerritoryWorkspace()
  );

  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8")
  );

  payload.excluded = [[999, 0]];

  assert.throws(
    () => decodeTerritoryConfiguration(
      dataset,
      Buffer.from(JSON.stringify(payload)).toString("base64url")
    ),
    /excluded county/
  );

  payload.excluded = [];
  payload.inventory = "wrong";

  assert.throws(
    () => decodeTerritoryConfiguration(
      dataset,
      Buffer.from(JSON.stringify(payload)).toString("base64url")
    ),
    /incompatible/
  );
});

test("income allocation receives only included source counties", () => {
  const { dataset, session } = fixture();

  dataset.metadata.measurement.kind = "income-weight";
  session.excludeCounties(["01001"]);

  const result = computeTerritoryAllocation(
    session.getSnapshot(),
    dataset
  );

  const includedDataset = {
    ...dataset,
    counties: dataset.counties.filter(
      (county) => county.id !== "01001"
    ),
  };

  assert.deepEqual(
    result,
    computeAllocation(session.getSnapshot(), includedDataset)
  );

  assert.equal(
    getIncomeWeights(
      session.getSnapshot(),
      includedDataset
    ).get("state:AA"),
    2000
  );

  assert.equal(dataset.counties.length, 5);
});

test("state geometry never merges excluded counties into included states", () => {
  const { dataset, session } = fixture();

  session.excludeCounties(["01001", "02001"]);

  const features = buildTerritoryStateFeatures(
    dataset,
    session.getSnapshot(),
    (_topology, geometries) =>
      geometries.map((geometry) => geometry.id)
  );

  assert.deepEqual(features, [
    { id: "state:AA", geometry: ["01003"] },
    { id: "state:BB", geometry: ["02003"] },
    { id: "state:CC", geometry: ["03001"] },
  ]);
});

test("subscribers receive one atomic snapshot per successful operation", () => {
  const { session } = fixture();
  const revisions = [];

  const unsubscribe = session.subscribe(
    (snapshot) => revisions.push(snapshot.revision)
  );

  session.excludeCounties(["01001"]);
  session.restoreCounties(["01001"]);

  unsubscribe();

  session.excludeCounties(["02001"]);

  assert.deepEqual(revisions, [0, 1, 2]);
});