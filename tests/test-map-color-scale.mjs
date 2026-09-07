import test from "node:test";
import assert from "node:assert/strict";

import {
  VOTE_COLORS,
  colorForBucketShare,
  colorForVoteBucket,
  getClassicVoteColor,
  getContextualVoteColorDetails,
  getVoteColorDetails,
  interpolateHex,
  NEUTRAL_VOTE_COLOR,
} from "../js/map/map-color-scale.mjs";

test("interpolation has exact endpoints and clamps its input", () => {
  assert.equal(interpolateHex("#ffffff", "#000000", 0), "#ffffff");
  assert.equal(interpolateHex("#ffffff", "#000000", 1), "#000000");
  assert.equal(interpolateHex("#ffffff", "#000000", -1), "#ffffff");
  assert.equal(interpolateHex("#ffffff", "#000000", 2), "#000000");
});

test("the shared vote palette uses the configured colors", () => {
  assert.equal(VOTE_COLORS.dem, "#4aa3ff");
  assert.equal(VOTE_COLORS.gop, "#ff6b57");
  assert.equal(VOTE_COLORS.grn, "#00a651");
  assert.equal(VOTE_COLORS.lib, "#f2c300");
  assert.equal(VOTE_COLORS.una, "#8e63d2");
  assert.equal(VOTE_COLORS.oth, "#5f7285");
});

test("configured bucket colors are returned directly", () => {
  assert.equal(colorForVoteBucket("grn"), "#00a651");
  assert.equal(colorForVoteBucket("lib"), "#f2c300");
});

test("future candidate identifiers receive stable fallback colors", () => {
  const color = colorForVoteBucket("future-bucket");

  assert.equal(color, colorForVoteBucket("future-bucket"));
  assert.match(color, /^#[0-9a-f]{6}$/i);
});

test("bucket gradients interpolate from white to the bucket color", () => {
  assert.equal(colorForBucketShare("grn", 0), "#ffffff");
  assert.equal(colorForBucketShare("grn", 1), "#00a651");
  assert.equal(colorForBucketShare("lib", 1), "#f2c300");
});

test("classic colors use five-percentage-point bins", () => {
  const left = getClassicVoteColor("dem", 0.249);
  const right = getClassicVoteColor("dem", 0.251);

  assert.notEqual(left, right);
});

test("classic colors preserve white opposite-state regions", () => {
  const result = getContextualVoteColorDetails(
    { dem: 40, gop: 60, grn: 0, lib: 0, una: 0, oth: 0 },
    { dem: 60, gop: 40, grn: 0, lib: 0, una: 0, oth: 0 }
  );

  assert.equal(result.basis, "classic-two-party");
  assert.equal(result.color, "#ffffff");
});

test("the final palette entry safely handles 100 percent", () => {
  const color = getClassicVoteColor("gop", 1);

  assert.match(color, /^#[0-9a-f]{6}$/i);
});

test("a county uses the state's major-party color context", () => {
  const result = getContextualVoteColorDetails(
    { dem: 70, gop: 30, grn: 0, lib: 0, una: 0, oth: 0 },
    { dem: 55, gop: 45, grn: 0, lib: 0, una: 0, oth: 0 }
  );

  assert.equal(result.basis, "classic-two-party");
  assert.equal(result.colorBucketId, "dem");
});

test("whole-state colors use statewide two-party balance", () => {
  const votes = {
    dem: 55,
    gop: 45,
    grn: 0,
    lib: 0,
    una: 0,
    oth: 0,
  };

  const result = getContextualVoteColorDetails(votes, votes);

  assert.equal(result.basis, "classic-two-party");
  assert.equal(result.colorBucketId, "dem");
  assert.notEqual(result.color, "#ffffff");
});

test("classic denominator excludes other votes when the leader is unchanged", () => {
  const baseVotes = {
    dem: 60,
    gop: 40,
    grn: 0,
    lib: 0,
    una: 0,
    oth: 0,
  };

  const withOtherVotes = {
    dem: 60,
    gop: 40,
    grn: 20,
    lib: 15,
    una: 5,
    oth: 10,
  };

  const base = getContextualVoteColorDetails(
    baseVotes,
    baseVotes
  );

  const expanded = getContextualVoteColorDetails(
    withOtherVotes,
    withOtherVotes
  );

  assert.equal(base.basis, "classic-two-party");
  assert.equal(expanded.basis, "classic-two-party");
  assert.equal(base.colorBucketId, "dem");
  assert.equal(expanded.colorBucketId, "dem");
  assert.equal(base.color, expanded.color);
});

test("a different leading bucket intentionally uses the fallback", () => {
  const votes = {
    dem: 60,
    gop: 40,
    grn: 200,
    lib: 0,
    una: 0,
    oth: 0,
  };

  const result = getContextualVoteColorDetails(votes, votes);

  assert.equal(result.bucketId, "grn");
  assert.equal(result.colorBucketId, "grn");
  assert.equal(result.color, colorForBucketShare("grn", 200 / 300));
});

test("a non-major-party county leader uses its own all-vote share", () => {
  const result = getContextualVoteColorDetails(
    { dem: 20, gop: 10, grn: 70, lib: 0, una: 0, oth: 0 },
    { dem: 55, gop: 45, grn: 0, lib: 0, una: 0, oth: 0 }
  );

  assert.equal(result.bucketId, "grn");
  assert.equal(result.basis, "local-leader");
  assert.equal(result.color, colorForBucketShare("grn", 0.7));
});

test("a state led by another bucket uses candidate-neutral colors", () => {
  const votes = {
    dem: 25,
    gop: 20,
    grn: 55,
    lib: 0,
    una: 0,
    oth: 0,
  };

  const result = getContextualVoteColorDetails(votes, votes);

  assert.equal(result.bucketId, "grn");
  assert.equal(result.color, colorForBucketShare("grn", 0.55));
});

test("generic gradients support every recorded bucket", () => {
  for (const bucketId of ["dem", "gop", "grn", "lib", "una", "oth"]) {
    const result = getVoteColorDetails({
      dem: bucketId === "dem" ? 60 : 10,
      gop: bucketId === "gop" ? 60 : 10,
      grn: bucketId === "grn" ? 60 : 10,
      lib: bucketId === "lib" ? 60 : 10,
      una: bucketId === "una" ? 60 : 10,
      oth: bucketId === "oth" ? 60 : 10,
    });

    assert.match(result.color, /^#[0-9a-f]{6}$/i);
  }
});

test("generic colors retain the all-recorded-vote denominator", () => {
  const result = getVoteColorDetails({
    dem: 40,
    gop: 30,
    grn: 20,
    lib: 10,
    una: 0,
    oth: 0,
  });

  assert.equal(result.bucketId, "dem");
  assert.equal(result.share, 0.4);
});

test("ties do not receive an arbitrary bucket color", () => {
  const result = getVoteColorDetails({
    dem: 50,
    gop: 50,
    grn: 0,
    lib: 0,
    una: 0,
    oth: 0,
  });

  assert.equal(result.status, "tie");
  assert.equal(result.color, NEUTRAL_VOTE_COLOR);
});

test("missing, incomplete, and zero-vote records are neutral", () => {
  const unavailable = getVoteColorDetails(null);

  const incomplete = getVoteColorDetails({
    dem: 10,
    gop: null,
    grn: 0,
    lib: 0,
    una: 0,
    oth: 0,
  });

  const noVotes = getVoteColorDetails({
    dem: 0,
    gop: 0,
    grn: 0,
    lib: 0,
    una: 0,
    oth: 0,
  });

  assert.equal(unavailable.color, NEUTRAL_VOTE_COLOR);
  assert.equal(incomplete.color, NEUTRAL_VOTE_COLOR);
  assert.equal(noVotes.color, NEUTRAL_VOTE_COLOR);
});

test("color calculations never mutate source vote data", () => {
  const votes = Object.freeze({
    dem: 40,
    gop: 30,
    grn: 20,
    lib: 10,
    una: 0,
    oth: 0,
  });

  const original = { ...votes };

  getVoteColorDetails(votes);
  getContextualVoteColorDetails(votes, votes);

  assert.deepEqual(votes, original);
});