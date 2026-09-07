import test from "node:test";
import assert from "node:assert/strict";

import {
  createMapColorizer,
  normalizeVoteDisplay,
} from "../js/map/map-visualization.mjs";

const fields = [
  { id: "dem", label: "Democrat" },
  { id: "gop", label: "GOP" },
  { id: "grn", label: "Green" },
  { id: "lib", label: "Libertarian" },
];

function view(overrides = {}) {
  return {
    metric: "votes",
    voteDisplay: {
      bucketId: "all",
      style: "classic",
      measure: "share",
    },
    ...overrides,
  };
}

test("invalid vote selections return to a supported setting", () => {
  const result = normalizeVoteDisplay({
    bucketId: "missing",
    style: "unknown",
    measure: "invalid",
  }, fields);

  assert.deepEqual(result, {
    bucketId: "all",
    style: "classic",
    measure: "share",
  });
});

test("state context uses the state leader's hue", () => {
  const county = {
    votes: { dem: 60, gop: 30, grn: 10, lib: 0 },
  };

  const stateVotes = {
    dem: 100,
    gop: 100,
    grn: 500,
    lib: 0,
  };

  const colorizer = createMapColorizer(view({
    voteDisplay: {
      bucketId: "all",
      style: "context",
      measure: "share",
    },
  }), [county]);

  const result = colorizer.get(county, stateVotes);

  assert.equal(result.colorBucketId, "grn");
  assert.equal(result.colorShare, 0.1);
  assert.equal(result.basis, "state-context");
});

test("local mode uses the county's own leading bucket", () => {
  const county = {
    votes: { dem: 30, gop: 20, grn: 50, lib: 0 },
  };

  const colorizer = createMapColorizer(view({
    voteDisplay: {
      bucketId: "all",
      style: "local",
      measure: "share",
    },
  }), [county]);

  const result = colorizer.get(county, {
    dem: 500, gop: 100, grn: 100, lib: 0,
  });

  assert.equal(result.bucketId, "grn");
  assert.equal(result.share, 0.5);
});

test("single-bucket share uses all recorded votes", () => {
  const county = {
    votes: { dem: 40, gop: 30, grn: 20, lib: 10 },
  };

  const colorizer = createMapColorizer(view({
    voteDisplay: {
      bucketId: "lib",
      style: "classic",
      measure: "share",
    },
  }), [county]);

  const result = colorizer.get(county);

  assert.equal(result.value, 0.1);
  assert.equal(result.colorBucketId, "lib");
  assert.equal(result.basis, "selected-share");
});

test("single-bucket counts use a common numeric scale", () => {
  const counties = [
    { votes: { dem: 10, gop: 10, grn: 0, lib: 0 } },
    { votes: { dem: 10, gop: 10, grn: 5, lib: 0 } },
    { votes: { dem: 10, gop: 10, grn: 100, lib: 0 } },
  ];

  const colorizer = createMapColorizer(view({
    voteDisplay: {
      bucketId: "grn",
      style: "classic",
      measure: "count",
    },
  }), counties);

  assert.equal(colorizer.scale.maximum, 100);
  assert.equal(colorizer.get(counties[0]).value, 0);
  assert.notEqual(
    colorizer.get(counties[1]).color,
    colorizer.get(counties[2]).color
  );
});

test("missing selected-bucket data remains neutral", () => {
  const colorizer = createMapColorizer(view({
    voteDisplay: {
      bucketId: "grn",
      style: "classic",
      measure: "share",
    },
  }), []);

  assert.equal(
    colorizer.get({ votes: null }).basis,
    "unavailable"
  );
});

test("population density uses land area, not total area", () => {
  const record = {
    population: 1000,
    landAreaM2: 2_000_000,
    waterAreaM2: 8_000_000,
  };

  const colorizer = createMapColorizer(view({
    metric: "density",
  }), [record]);

  assert.equal(colorizer.get(record).value, 500);
});

test("all visualizations leave their source records unchanged", () => {
  const record = Object.freeze({
    votes: Object.freeze({
      dem: 40, gop: 30, grn: 20, lib: 10,
    }),
  });

  const colorizer = createMapColorizer(view({
    voteDisplay: {
      bucketId: "grn",
      style: "context",
      measure: "share",
    },
  }), [record]);

  colorizer.get(record, record.votes);

  assert.equal(record.votes.grn, 20);
});