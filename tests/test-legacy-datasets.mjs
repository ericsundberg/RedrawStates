import test from "node:test";
import assert from "node:assert/strict";

import {
  LEGACY_DATASETS,
  convertLegacyTopology,
  getLegacyDataset,
  loadLegacyDataset,
} from "../js/data/legacy-datasets.mjs";

function geometry(id, properties) {
  return {
    type: "Polygon",
    id,
    properties,
    arcs: [[0]],
  };
}

function makeTopology() {
  return {
    type: "Topology",
    arcs: [[[0, 0], [1, 0]]],
    objects: {
      counties: {
        type: "GeometryCollection",
        geometries: [
          geometry("01001", {
            id: "01001",
            name: "Example One",
            state: "AL",
            population: 600,
            ALAND: 2_000_000,
            AWATER: 1_000_000,
            dem: 60,
            gop: 40,
            grn: 0,
          }),
          geometry("01003", {
            id: "01003",
            name: "Example Two",
            state: "AL",
            population: 400,
            landAreaM2: 1_000_000,
            waterAreaM2: 0,
            dem: 10,
            gop: 80,
          }),
          geometry("02000", {
            id: "02000",
            name: "Example Alaska",
            state: "AK",
            population: 200,
            dem: 5,
            gop: 5,
            una: 90,
          }),
          geometry("72001", {
            id: "72001",
            name: "Excluded Territory",
          }),
        ],
      },
    },
  };
}

function makeIncomeTopology() {
  const topology = makeTopology();

  topology.objects.counties.geometries.push(
    geometry("15005", {}),
    geometry("51515", {})
  );

  return topology;
}

test("the catalog contains every inherited selectable dataset", () => {
  assert.deepEqual(
    LEGACY_DATASETS.map((dataset) => dataset.id),
    ["2004", "2008", "2012", "2016i", "2016", "2020", "2020s", "2024"]
  );

  assert.equal(
    getLegacyDataset("2024").filename,
    "data/us2024.json"
  );

  assert.throws(
    () => getLegacyDataset("unknown"),
    /Unknown legacy dataset/
  );
});

test("converts source records without mutating TopoJSON", () => {
  const topology = makeTopology();
  const original = structuredClone(topology);

  const dataset = convertLegacyTopology(topology);

  assert.deepEqual(topology, original);
  assert.equal(dataset.model.states.length, 51);
  assert.equal(dataset.counties.length, 3);
  assert.equal(dataset.model.assignments["01001"], "state:AL");
  assert.equal(dataset.model.assignments["02000"], "state:AK");

  assert.equal(
    dataset.diagnostics.excludedGeometries.length,
    1
  );

  assert.equal(
    dataset.diagnostics.excludedGeometries[0].id,
    "72001"
  );

  assert.equal(
    dataset.geometriesById.get("01001"),
    topology.objects.counties.geometries[0]
  );
});

test("preserves area values and missing measurements", () => {
  const dataset = convertLegacyTopology(makeTopology());

  const first = dataset.counties.find(
    (county) => county.id === "01001"
  );

  const alaska = dataset.counties.find(
    (county) => county.id === "02000"
  );

  assert.equal(first.landAreaM2, 2_000_000);
  assert.equal(first.waterAreaM2, 1_000_000);
  assert.equal(alaska.landAreaM2, null);
  assert.equal(alaska.waterAreaM2, null);

  const alabama = dataset.totals.find(
    (total) => total.stateId === "state:AL"
  );

  assert.equal(alabama.population, 1000);
  assert.equal(alabama.totalAreaM2, 4_000_000);
  assert.ok(
    Math.abs(alabama.densityPerKm2 - 1000 / 3) < 1e-10
  );
});

test("preserves legacy vote buckets without inventing candidates", () => {
  const dataset = convertLegacyTopology(makeTopology());

  assert.deepEqual(dataset.candidateIds, [
    "dem", "gop", "grn", "lib", "una", "oth",
  ]);

  assert.deepEqual(dataset.counties[0].votes, {
    dem: 60,
    gop: 40,
    grn: 0,
    lib: 0,
    una: 0,
    oth: 0,
  });

  assert.equal(dataset.metadata.voteSchema, "aggregated-party-buckets");
  assert.equal(dataset.metadata.measurement.kind, "population");
});

test("explicitly missing vote values remain unavailable", () => {
  const topology = makeTopology();
  topology.objects.counties.geometries[0].properties.dem = null;

  const dataset = convertLegacyTopology(topology);

  assert.equal(dataset.counties[0].votes, null);

  const alabama = dataset.totals.find(
    (total) => total.stateId === "state:AL"
  );

  assert.equal(alabama.missing.votes, 1);
  assert.equal(alabama.votes.dem, null);
});

test("rejects duplicate geometries and unknown state codes", () => {
  const duplicate = makeTopology();

  duplicate.objects.counties.geometries.push(
    geometry("01001", { state: "AL", population: 1 })
  );

  assert.throws(
    () => convertLegacyTopology(duplicate),
    /Duplicate county geometry/
  );

  const unknown = makeTopology();
  unknown.objects.counties.geometries[0].properties.state = "ZZ";

  assert.throws(
    () => convertLegacyTopology(unknown),
    /Unsupported state code/
  );
});

test("does not silently exclude a recognized county with no state", () => {
  const topology = makeTopology();
  delete topology.objects.counties.geometries[0].properties.state;

  assert.throws(
    () => convertLegacyTopology(topology),
    /missing its state assignment/
  );
});

test("preserves both empty 2016 Income shells as exclusions", () => {
  const topology = makeIncomeTopology();
  const original = structuredClone(topology);

  const dataset = convertLegacyTopology(topology, "2016i");

  assert.deepEqual(topology, original);
  assert.equal(dataset.diagnostics.sourceGeometryCount, 6);
  assert.equal(dataset.counties.length, 3);

  assert.deepEqual(
    dataset.diagnostics.excludedGeometries.map((item) => item.id),
    ["72001", "15005", "51515"]
  );

  assert.equal(dataset.model.assignments["15005"], undefined);
  assert.equal(dataset.model.assignments["51515"], undefined);
  assert.equal(dataset.geometriesById.has("15005"), false);
  assert.equal(dataset.geometriesById.has("51515"), false);

  assert.equal(dataset.diagnostics.repairedAssignments.length, 0);
});

test("source-only exceptions do not discard populated records", () => {
  const topology = makeIncomeTopology();

  topology.objects.counties.geometries[4].properties = {
    name: "Example",
    population: 100,
  };

  assert.throws(
    () => convertLegacyTopology(topology, "2016i"),
    /County 15005 is missing its state assignment/
  );

  const otherDataset = makeIncomeTopology();

  assert.throws(
    () => convertLegacyTopology(otherDataset, "2024"),
    /County 15005 is missing its state assignment/
  );
});

test("income weights are not treated as population", () => {
  const dataset = convertLegacyTopology(
    makeIncomeTopology(),
    "2016i"
  );

  const first = dataset.counties.find(
    (county) => county.id === "01001"
  );

  assert.equal(first.population, null);
  assert.equal(first.measures.incomeWeightDollars, 600);
  assert.equal(first.votes.dem, 60);

  assert.equal(dataset.metadata.measurement.kind, "income-weight");
  assert.equal(dataset.metadata.measurement.sourceYear, 2014);
  assert.equal(dataset.metadata.populationAvailable, false);

  const alabama = dataset.totals.find(
    (total) => total.stateId === "state:AL"
  );

  assert.equal(alabama.population, null);
  assert.equal(alabama.densityPerKm2, null);
  assert.equal(alabama.votes.dem, 70);
  assert.equal(alabama.votes.gop, 120);
});

test("rejects conflicting geographic identifiers", () => {
  const topology = makeTopology();

  topology.objects.counties.geometries[0].properties.id = "01003";

  assert.throws(
    () => convertLegacyTopology(topology),
    /Conflicting geographic identifiers/
  );

  const mismatch = makeTopology();
  mismatch.objects.counties.geometries[0].properties.state = "AK";

  assert.throws(
    () => convertLegacyTopology(mismatch),
    /state code that disagrees/
  );
});

test("rejects conflicting or invalid area measurements", () => {
  const topology = makeTopology();
  topology.objects.counties.geometries[0].properties.landAreaM2 = 1;

  assert.throws(
    () => convertLegacyTopology(topology),
    /Conflicting area measurements/
  );

  const negative = makeTopology();
  negative.objects.counties.geometries[0].properties.ALAND = -1;

  assert.throws(
    () => convertLegacyTopology(negative),
    /nonnegative number/
  );
});

test("loads through an injected JSON reader", async () => {
  let requestedPath = null;

  const dataset = await loadLegacyDataset(
    "2024",
    async (filename) => {
      requestedPath = filename;
      return makeTopology();
    }
  );

  assert.equal(requestedPath, "data/us2024.json");
  assert.equal(dataset.counties.length, 3);
});