/**
 * Candidate-neutral presentation rules for recorded vote data.
 */

import { summarizeVotes } from "../model/state-aggregation.mjs";
import {
  colorForBucketShare,
  colorForVoteBucket,
  getClassicVoteColor,
  getContextualVoteColorDetails,
  getVoteColorDetails,
  NEUTRAL_VOTE_COLOR,
} from "./map-color-scale.mjs";

import {
  createNumericScale,
  metricValue,
  MISSING_COLOR,
} from "./map-metrics.mjs";

export const DEFAULT_VOTE_DISPLAY = Object.freeze({
  bucketId: "all",
  style: "classic",
  measure: "share",
});

const STYLES = new Set(["classic", "context", "local"]);
const MEASURES = new Set(["share", "count"]);

export function normalizeVoteDisplay(display, fields) {
  const available = new Set(fields.map((field) => field.id));

  return {
    bucketId:
      display?.bucketId === "all" || available.has(display?.bucketId)
        ? display.bucketId
        : "all",
    style: STYLES.has(display?.style) ? display.style : "classic",
    measure: MEASURES.has(display?.measure)
      ? display.measure
      : "share",
  };
}

function neutralDetails(status = "unavailable") {
  return {
    status,
    bucketId: null,
    colorBucketId: null,
    share: null,
    colorShare: null,
    value: null,
    basis: "unavailable",
    color: NEUTRAL_VOTE_COLOR,
    stroke: "#d4d9e0",
  };
}

function selectedBucketDetails(votes, display, scale) {
  const summary = summarizeVotes(votes);

  if (summary.status === "unavailable" ||
      summary.status === "incomplete" ||
      summary.status === "no-data") {
    return neutralDetails(summary.status);
  }

  const count = votes[display.bucketId] ?? 0;
  const share = count / summary.totalVotes;
  const endpoint = colorForVoteBucket(display.bucketId);

  return {
    ...summary,
    bucketId: display.bucketId,
    colorBucketId: display.bucketId,
    share,
    colorShare: share,
    value: display.measure === "count" ? count : share,
    basis: display.measure === "count"
      ? "selected-count"
      : "selected-share",
    color: display.measure === "count"
      ? scale.color(count, endpoint)
      : colorForBucketShare(display.bucketId, share),
    stroke: "#d4d9e0",
  };
}

function stateContextDetails(votes, stateVotes) {
  const local = getVoteColorDetails(votes);

  if (local.status !== "leader") {
    return local;
  }

  const state = summarizeVotes(stateVotes);

  if (state.status !== "leader") {
    return local;
  }

  const bucketId = state.leadingIds[0];
  const share = (votes[bucketId] ?? 0) / local.totalVotes;

  return {
    ...local,
    colorBucketId: bucketId,
    colorShare: share,
    basis: "state-context",
    color: colorForBucketShare(bucketId, share),
    stroke: "#d4d9e0",
  };
}

export function createMapColorizer(view, records) {
  const { metric, voteDisplay } = view;

  let scale = null;

  if (metric !== "votes") {
    scale = createNumericScale(
      records.map((record) => metricValue(record, metric)),
      { mode: metric === "density" ? "log" : "linear" }
    );
  } else if (
    voteDisplay.bucketId !== "all" &&
    voteDisplay.measure === "count"
  ) {
    scale = createNumericScale(
      records.map((record) => record.votes?.[voteDisplay.bucketId] ?? null),
      { mode: "log" }
    );
  }

  function get(record, stateVotes = null) {
    if (metric !== "votes") {
      const value = metricValue(record, metric);

      return {
        value,
        basis: metric,
        color: scale.color(value),
        stroke: "#d4d9e0",
      };
    }

    const votes = record?.votes ?? null;

    if (voteDisplay.bucketId !== "all") {
      return selectedBucketDetails(votes, voteDisplay, scale);
    }

    if (voteDisplay.style === "classic") {
      return getContextualVoteColorDetails(votes, stateVotes);
    }

    if (voteDisplay.style === "context") {
      return stateContextDetails(votes, stateVotes);
    }

    return getVoteColorDetails(votes);
  }

  return { get, scale };
}