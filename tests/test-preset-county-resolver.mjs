import test from "node:test";
import assert from "node:assert/strict";

import {
  resolvePresetCounties,
} from "../js/presets/preset-county-resolver.mjs";

const dataset = {
  counties: [
    {
      id: "24005",
      name: "Baltimore",
      originalStateId: "state:MD",
    },
    {
      id: "24510",
      name: "Baltimore City",
      originalStateId: "state:MD",
    },
    {
      id: "24013",
      name: "Carroll",
      originalStateId: "state:MD",
    },
    {
      id: "24021",
      name: "Frederick",
      originalStateId: "state:MD",
    },
    {
      id: "51720",
      name: "Norton",
      originalStateId: "state:VA",
    },
    {
      id: "51195",
      name: "Wise",
      originalStateId: "state:VA",
    },
  ],
};

test("unrelated duplicate names do not prevent a county lookup", () => {
  assert.deepEqual(
    resolvePresetCounties(dataset, "MD", ["Carroll", "Frederick"]),
    ["24013", "24021"]
  );
});

test("exact county and independent-city names remain distinct", () => {
  assert.deepEqual(
    resolvePresetCounties(dataset, "MD", ["Baltimore"]),
    ["24005"]
  );

  assert.deepEqual(
    resolvePresetCounties(dataset, "MD", ["Baltimore City"]),
    ["24510"]
  );
});

test("ambiguous loose names require a FIPS identifier", () => {
  assert.throws(
    () => resolvePresetCounties(
      dataset,
      "MD",
      ["Baltimore County"]
    ),
    /Ambiguous county name/
  );
});

test("five-digit FIPS identifiers resolve independent cities", () => {
  assert.deepEqual(
    resolvePresetCounties(dataset, "VA", ["51720"]),
    ["51720"]
  );
});

test("FIPS identifiers must belong to the requested state", () => {
  assert.throws(
    () => resolvePresetCounties(dataset, "MD", ["51720"]),
    /missing from the inherited inventory/
  );
});

test("duplicate references to the same county are rejected", () => {
  assert.throws(
    () => resolvePresetCounties(
      dataset,
      "MD",
      ["Carroll", "24013"]
    ),
    /Duplicate county/
  );
});

test("unknown county names are not silently omitted", () => {
  assert.throws(
    () => resolvePresetCounties(
      dataset,
      "MD",
      ["Nonexistent County"]
    ),
    /missing from the inherited inventory/
  );
});

test("the source county records remain unchanged", () => {
  const before = JSON.stringify(dataset);

  resolvePresetCounties(dataset, "MD", ["Carroll"]);

  assert.equal(JSON.stringify(dataset), before);
});