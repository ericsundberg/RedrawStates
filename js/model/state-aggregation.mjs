/**
 * Aggregate county demographic and election data into state totals.
 *
 * Input records:
 * {
 *   id: "01001",
 *   population: 58805,
 *   landAreaM2: 1539634184,
 *   waterAreaM2: 25769335,
 *   votes: { "candidate-id": 1234 }
 * }
 *
 * Population and area fields may be null when unavailable.
 * If election data is requested, a missing votes object means unavailable
 * data. A present votes object is considered complete for the supplied
 * candidate IDs; an absent candidate key in that object means zero votes.
 */

import {
  validateIdentifier,
  validateStateModel,
} from "./state-registry.mjs";

const METRIC_FIELDS = ["population", "landAreaM2", "waterAreaM2"];
const SQUARE_METERS_PER_SQUARE_KILOMETER = 1_000_000;

function readNonNegativeNumber(value, label, integer = false) {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new TypeError(`${label} must be a nonnegative number or null.`);
  }

  return value;
}

function addNumber(current, value, label, integer = false) {
  const result = current + value;

  if (!Number.isFinite(result) || (integer && !Number.isSafeInteger(result))) {
    throw new RangeError(`${label} exceeds the supported numeric range.`);
  }

  return result;
}

function createAccumulator(stateId, candidateIds, includeVotes) {
  return {
    stateId,
    countyCount: 0,
    population: 0,
    landAreaM2: 0,
    waterAreaM2: 0,
    votes: includeVotes
      ? Object.fromEntries(candidateIds.map((id) => [id, 0]))
      : null,
    missing: {
      population: 0,
      landAreaM2: 0,
      waterAreaM2: 0,
      votes: includeVotes ? 0 : null,
    },
  };
}

/**
 * Recompute all state totals from the supplied county inventory.
 *
 * Every assigned county must occur exactly once. Missing or extra county
 * records are errors, so incomplete geographic joins cannot go unnoticed.
 */
export function aggregateStates(model, counties, { candidateIds = [] } = {}) {
  validateStateModel(model);

  if (!Array.isArray(counties)) {
    throw new TypeError("Counties must be an array.");
  }

  if (!Array.isArray(candidateIds)) {
    throw new TypeError("Candidate IDs must be an array.");
  }

  const candidateSet = new Set();

  for (const candidateId of candidateIds) {
    validateIdentifier(candidateId, "Candidate ID");

    if (candidateSet.has(candidateId)) {
      throw new Error(`Duplicate candidate ID: ${candidateId}`);
    }

    candidateSet.add(candidateId);
  }

  const includeVotes = candidateIds.length > 0;
  const seenCounties = new Set();

  const totals = new Map(
    model.states.map((state) => [
      state.id,
      createAccumulator(state.id, candidateIds, includeVotes),
    ])
  );

  for (const county of counties) {
    if (county === null || typeof county !== "object" || Array.isArray(county)) {
      throw new TypeError("Each county must be an object.");
    }

    const countyId = validateIdentifier(county.id, "County ID");

    if (seenCounties.has(countyId)) {
      throw new Error(`Duplicate county record: ${countyId}`);
    }

    if (!Object.hasOwn(model.assignments, countyId)) {
      throw new Error(`County ${countyId} has no state assignment.`);
    }

    seenCounties.add(countyId);

    const stateId = model.assignments[countyId];
    const total = totals.get(stateId);
    total.countyCount += 1;

    for (const field of METRIC_FIELDS) {
      const value = readNonNegativeNumber(
        county[field],
        `${countyId}.${field}`,
        field === "population"
      );

      if (value === null) {
        total.missing[field] += 1;
      } else {
        total[field] = addNumber(
          total[field],
          value,
          `${stateId}.${field}`,
          field === "population"
        );
      }
    }

    if (!includeVotes) {
      continue;
    }

    if (county.votes === null || county.votes === undefined) {
      total.missing.votes += 1;
      continue;
    }

    if (
      typeof county.votes !== "object" ||
      Array.isArray(county.votes)
    ) {
      throw new TypeError(`${countyId}.votes must be an object or null.`);
    }

    for (const candidateId of Object.keys(county.votes)) {
      if (!candidateSet.has(candidateId)) {
        throw new Error(
          `County ${countyId} contains unknown candidate ${candidateId}.`
        );
      }
    }

    for (const candidateId of candidateIds) {
      const value = readNonNegativeNumber(
        county.votes[candidateId] ?? 0,
        `${countyId}.votes.${candidateId}`,
        true
      );

      if (value === null) {
        throw new Error("A present votes object cannot contain null totals.");
      }

      total.votes[candidateId] = addNumber(
        total.votes[candidateId],
        value,
        `${stateId}.votes.${candidateId}`,
        true
      );
    }
  }

  if (seenCounties.size !== Object.keys(model.assignments).length) {
    const missingIds = Object.keys(model.assignments)
      .filter((countyId) => !seenCounties.has(countyId));

    throw new Error(
      `Missing county records: ${missingIds.join(", ")}`
    );
  }

  return model.states.map((state) => {
    const total = totals.get(state.id);

    for (const field of METRIC_FIELDS) {
      if (total.missing[field] > 0) {
        total[field] = null;
      }
    }

    if (includeVotes && total.missing.votes > 0) {
      total.votes = Object.fromEntries(
        candidateIds.map((candidateId) => [candidateId, null])
      );
    }

    const totalAreaM2 =
      total.landAreaM2 === null || total.waterAreaM2 === null
        ? null
        : total.landAreaM2 + total.waterAreaM2;

    const densityPerKm2 =
      total.population === null ||
      total.landAreaM2 === null ||
      total.landAreaM2 === 0
        ? null
        : total.population /
          (total.landAreaM2 / SQUARE_METERS_PER_SQUARE_KILOMETER);

    return {
      ...total,
      totalAreaM2,
      densityPerKm2,
    };
  });
}

/**
 * Identify the leading candidate(s) without assuming a two-party contest.
 *
 * This is a vote-summary function, not an electoral allocation function.
 * It never resolves ties by arbitrarily assigning them to a candidate.
 */
export function summarizeVotes(votes) {
  if (votes === null || votes === undefined) {
    return {
      status: "unavailable",
      leadingIds: [],
      totalVotes: null,
    };
  }

  if (typeof votes !== "object" || Array.isArray(votes)) {
    throw new TypeError("Votes must be an object or null.");
  }

  const entries = Object.entries(votes);

  for (const [candidateId, value] of entries) {
    validateIdentifier(candidateId, "Candidate ID");
    readNonNegativeNumber(value, `votes.${candidateId}`, true);
  }

  if (entries.some(([, value]) => value === null || value === undefined)) {
    return {
      status: "incomplete",
      leadingIds: [],
      totalVotes: null,
    };
  }

  const totalVotes = entries.reduce(
    (sum, [, value]) => addNumber(sum, value, "Total votes", true),
    0
  );

  if (totalVotes === 0) {
    return {
      status: "no-data",
      leadingIds: [],
      totalVotes: 0,
    };
  }

  const highest = Math.max(...entries.map(([, value]) => value));
  const leadingIds = entries
    .filter(([, value]) => value === highest)
    .map(([candidateId]) => candidateId);

  return {
    status: leadingIds.length === 1 ? "leader" : "tie",
    leadingIds,
    totalVotes,
  };
}