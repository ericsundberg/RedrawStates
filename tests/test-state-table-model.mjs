import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStateTableColumns,
  sortStateTableRows,
} from "../js/ui/state-table-model.mjs";

const dataset = {
  metadata: {
    measurement: { kind: "population" },
    voteFields: [
      { id: "dem", label: "Democrat" },
      { id: "gop", label: "GOP" },
      { id: "grn", label: "Green" },
    ],
  },
};

const rows = [
  {
    index: 0,
    state: { abbreviation: "AA" },
    electors: 3,
    total: {
      countyCount: 2,
      population: 100,
      landAreaM2: 1_000_000,
      totalAreaM2: 2_000_000,
      densityPerKm2: 100,
      votes: { dem: 50, gop: 40, grn: 10 },
    },
  },
  {
    index: 1,
    state: { abbreviation: "BB" },
    electors: 4,
    total: {
      countyCount: 3,
      population: 200,
      landAreaM2: 2_000_000,
      totalAreaM2: 3_000_000,
      densityPerKm2: 100,
      votes: { dem: 70, gop: 90, grn: 40 },
    },
  },
  {
    index: 2,
    state: { abbreviation: "CC" },
    electors: null,
    total: {
      countyCount: 1,
      population: null,
      landAreaM2: null,
      totalAreaM2: null,
      densityPerKm2: null,
      votes: { dem: null, gop: null, grn: null },
    },
  },
];

test("Green votes sort numerically in descending order", () => {
  const columns = buildStateTableColumns(dataset);
  const green = columns.find((column) => column.id === "votes:grn");

  const sorted = sortStateTableRows(rows, green, "desc");

  assert.deepEqual(
    sorted.map((row) => row.state.abbreviation),
    ["BB", "AA", "CC"]
  );
});

test("a second sort direction reverses numerical order", () => {
  const columns = buildStateTableColumns(dataset);
  const green = columns.find((column) => column.id === "votes:grn");

  const sorted = sortStateTableRows(rows, green, "asc");

  assert.deepEqual(
    sorted.map((row) => row.state.abbreviation),
    ["AA", "BB", "CC"]
  );
});

test("missing values remain last in both directions", () => {
  const columns = buildStateTableColumns(dataset);
  const population = columns.find((column) => column.id === "population");

  for (const direction of ["asc", "desc"]) {
    const sorted = sortStateTableRows(rows, population, direction);

    assert.equal(sorted.at(-1).state.abbreviation, "CC");
  }
});

test("percentage columns use all recorded votes", () => {
  const columns = buildStateTableColumns(dataset, {
    voteFormat: "share",
  });

  const green = columns.find((column) => column.id === "votes:grn");

  assert.equal(green.value(rows[0]), 0.1);
  assert.equal(green.value(rows[1]), 0.2);
});

test("area units are converted without changing source data", () => {
  const columns = buildStateTableColumns(dataset, {
    areaUnit: "km2",
  });

  const land = columns.find((column) => column.id === "land");

  assert.equal(land.value(rows[0]), 1);
  assert.equal(rows[0].total.landAreaM2, 1_000_000);
});