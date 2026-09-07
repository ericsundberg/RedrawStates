/**
 * Vote color scales and palette helpers.
 */

import { summarizeVotes } from "../model/state-aggregation.mjs";

export const NEUTRAL_VOTE_COLOR = "#dfe3e8";
export const NEUTRAL_VOTE_STROKE = "#d4d9e0";

/*
  These are the shared presentation colors for vote buckets outside the
  original two-party classic palette.

  Major-party classic colors still use their own binned scale so we can
  preserve the original-style county presentation. These shared colors are
  what power:
    - selected single-bucket views
    - non-major-party leading buckets
    - legends
    - allocation summary swatches
*/
export const VOTE_COLORS = Object.freeze({
  dem: "#4aa3ff",
  gop: "#ff6b57",
  grn: "#00a651",
  lib: "#f2c300",
  una: "#8e63d2",
  oth: "#5f7285",
});

const FALLBACK_BUCKET_COLORS = Object.freeze([
  "#4aa3ff",
  "#ff6b57",
  "#00a651",
  "#f2c300",
  "#8e63d2",
  "#00b8c9",
  "#ff8a00",
  "#ec407a",
]);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseHex(hex) {
  const normalized = hex.replace("#", "").trim();

  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new TypeError(`Invalid hex color: ${hex}`);
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((value) =>
      Math.round(clamp(value, 0, 255))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

export function interpolateHex(start, end, ratio) {
  const left = parseHex(start);
  const right = parseHex(end);
  const bounded = clamp(Number(ratio) || 0, 0, 1);

  return toHex({
    r: left.r + (right.r - left.r) * bounded,
    g: left.g + (right.g - left.g) * bounded,
    b: left.b + (right.b - left.b) * bounded,
  });
}

function createBinnedPalette(endpoint) {
  return Array.from({ length: 21 }, (_, index) =>
    interpolateHex("#ffffff", endpoint, index / 20)
  );
}

/*
  We keep a separate classic binned palette for the original-style
  Democratic/GOP map mode so the presentation stays much closer to the
  original project.
*/
const CLASSIC_DEM_PALETTE = Object.freeze(
  createBinnedPalette("#3f9fff")
);

const CLASSIC_GOP_PALETTE = Object.freeze(
  createBinnedPalette("#ff684f")
);

function fallbackColorForBucket(bucketId) {
  const text = String(bucketId ?? "");

  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return FALLBACK_BUCKET_COLORS[hash % FALLBACK_BUCKET_COLORS.length];
}

export function colorForVoteBucket(bucketId) {
  return VOTE_COLORS[bucketId] ?? fallbackColorForBucket(bucketId);
}

export function colorForBucketShare(bucketId, share) {
  return interpolateHex(
    "#ffffff",
    colorForVoteBucket(bucketId),
    clamp(share, 0, 1)
  );
}

function neutralDetails(status = "unavailable") {
  return Object.freeze({
    status,
    bucketId: null,
    colorBucketId: null,
    share: null,
    colorShare: null,
    totalVotes: null,
    value: null,
    basis: "unavailable",
    color: NEUTRAL_VOTE_COLOR,
    stroke: NEUTRAL_VOTE_STROKE,
  });
}

function getTwoPartySummary(votes) {
  if (!votes || typeof votes !== "object") {
    return neutralDetails("unavailable");
  }

  const dem = votes.dem;
  const gop = votes.gop;

  if (
    dem === undefined ||
    gop === undefined ||
    dem === null ||
    gop === null
  ) {
    return neutralDetails("incomplete");
  }

  if (
    !Number.isFinite(dem) ||
    !Number.isFinite(gop) ||
    dem < 0 ||
    gop < 0
  ) {
    return neutralDetails("incomplete");
  }

  const totalVotes = dem + gop;

  if (totalVotes === 0) {
    return neutralDetails("no-votes");
  }

  if (dem === gop) {
    return Object.freeze({
      status: "tie",
      bucketId: null,
      colorBucketId: null,
      share: null,
      colorShare: null,
      totalVotes,
      value: null,
      basis: "tie",
      color: NEUTRAL_VOTE_COLOR,
      stroke: NEUTRAL_VOTE_STROKE,
    });
  }

  const bucketId = dem > gop ? "dem" : "gop";
  const share = bucketId === "dem" ? dem / totalVotes : gop / totalVotes;

  return Object.freeze({
    status: "leader",
    bucketId,
    colorBucketId: bucketId,
    share,
    colorShare: share,
    totalVotes,
    value: share,
    basis: "two-party",
    color: colorForBucketShare(bucketId, share),
    stroke: NEUTRAL_VOTE_STROKE,
  });
}

export function getClassicVoteColor(contextBucketId, share) {
  const palette = contextBucketId === "dem"
    ? CLASSIC_DEM_PALETTE
    : contextBucketId === "gop"
      ? CLASSIC_GOP_PALETTE
      : null;

  if (!palette) {
    return NEUTRAL_VOTE_COLOR;
  }

  const bounded = clamp(share, 0, 1);
  const index = Math.min(20, Math.floor(bounded * 20));

  return palette[index];
}

export function getVoteColorDetails(votes) {
  const summary = summarizeVotes(votes);

  if (
    summary.status === "unavailable" ||
    summary.status === "incomplete" ||
    summary.status === "no-data" ||
    summary.status === "no-votes"
  ) {
    return neutralDetails(summary.status);
  }

  if (summary.status === "tie") {
    return neutralDetails("tie");
  }

  const bucketId = summary.leadingIds[0];
  const share = (votes[bucketId] ?? 0) / summary.totalVotes;

  return Object.freeze({
    ...summary,
    bucketId,
    colorBucketId: bucketId,
    share,
    colorShare: share,
    value: share,
    basis: "local-leader",
    color: colorForBucketShare(bucketId, share),
    stroke: NEUTRAL_VOTE_STROKE,
  });
}

export function getContextualVoteColorDetails(votes, stateVotes) {
  const local = getVoteColorDetails(votes);

  if (local.status !== "leader") {
    return local;
  }

  const stateSummary = summarizeVotes(stateVotes);

  if (stateSummary.status !== "leader") {
    return local;
  }

  const stateLeader = stateSummary.leadingIds[0];

  /*
    If the local leading bucket is not one of the two major parties, or the
    state itself is led by another bucket, preserve the all-bucket gradient.
    This is how we keep Green, Libertarian, etc. visible in classic mode.
  */
  if (
    (local.bucketId !== "dem" && local.bucketId !== "gop") ||
    (stateLeader !== "dem" && stateLeader !== "gop")
  ) {
    return local;
  }

  const countyTwoParty = getTwoPartySummary(votes);
  const stateTwoParty = getTwoPartySummary(stateVotes);

  if (
    countyTwoParty.status !== "leader" ||
    stateTwoParty.status !== "leader"
  ) {
    return local;
  }

  /*
    Original-style rule:
      - the state's two-party leader sets the color family
      - counties with the opposite local two-party balance are white
      - counties aligned with the state context use five-point bins
  */
  if (countyTwoParty.bucketId !== stateTwoParty.bucketId) {
    return Object.freeze({
      ...local,
      colorBucketId: stateTwoParty.bucketId,
      twoPartyShare: countyTwoParty.share,
      colorShare: 0,
      value: countyTwoParty.share,
      basis: "classic-two-party",
      color: "#ffffff",
      stroke: NEUTRAL_VOTE_STROKE,
    });
  }

  return Object.freeze({
    ...local,
    colorBucketId: stateTwoParty.bucketId,
    twoPartyShare: countyTwoParty.share,
    colorShare: countyTwoParty.share,
    value: countyTwoParty.share,
    basis: "classic-two-party",
    color: getClassicVoteColor(
      stateTwoParty.bucketId,
      countyTwoParty.share
    ),
    stroke: NEUTRAL_VOTE_STROKE,
  });
}