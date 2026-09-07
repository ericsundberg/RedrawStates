/**
 * Hypothetical electoral allocation and candidate-neutral vote summaries.
 *
 * This module never changes a state model or a county record.
 */

import { summarizeVotes } from "./state-aggregation.mjs";

export const VOTE_COLORS = Object.freeze({
  dem: "#397db8",
  gop: "#d56555",
  grn: "#53966b",
  lib: "#b49a42",
  una: "#8b6ab0",
  oth: "#6c8190",
  unallocated: "#a3aab3",
});

export function getIncomeWeights(snapshot, dataset) {
  const totals = new Map(
    snapshot.model.states.map((state) => [state.id, 0])
  );

  const missing = new Set();

  for (const county of dataset.counties) {
    const stateId = snapshot.model.assignments[county.id];
    const value = county.measures?.incomeWeightDollars;

    if (value === null || value === undefined) {
      missing.add(stateId);
    } else {
      const next = totals.get(stateId) + value;

      if (!Number.isSafeInteger(next)) {
        throw new RangeError("Income weight exceeds the safe integer range.");
      }

      totals.set(stateId, next);
    }
  }

  for (const stateId of missing) {
    totals.set(stateId, null);
  }

  return totals;
}

/**
 * Allocate 435 hypothetical House seats by equal proportions.
 *
 * A positive-weight state starts with one House seat and two additional
 * electors. An empty state receives zero under this simulation. Districts
 * receive three electors when nonempty and do not participate in House
 * apportionment. Missing weights make the allocation unavailable.
 */
export function computeAllocation(snapshot, dataset) {
  const incomeMode = dataset.metadata.measurement.kind === "income-weight";
  const basis = incomeMode ? "income-weight" : "population";

  const weights = incomeMode
    ? getIncomeWeights(snapshot, dataset)
    : new Map(
        snapshot.totals.map((total) => [total.stateId, total.population])
      );

  const byState = new Map();
  const eligible = [];

  for (const state of snapshot.model.states) {
    const weight = weights.get(state.id);

    if (weight === null || weight === undefined) {
      return {
        status: "unavailable",
        basis,
        byState: new Map(
          snapshot.model.states.map((item) => [item.id, null])
        ),
        totalElectors: null,
      };
    }

    if (!Number.isFinite(weight) || weight < 0) {
      throw new TypeError(`Invalid allocation weight for ${state.id}.`);
    }

    if (weight === 0) {
      byState.set(state.id, 0);
    } else if (state.kind === "district") {
      byState.set(state.id, 3);
    } else {
      byState.set(state.id, 3);
      eligible.push({ id: state.id, weight, seats: 1 });
    }
  }

  if (eligible.length === 0) {
    return {
      status: "unavailable",
      basis,
      byState,
      totalElectors: null,
    };
  }

  if (eligible.length > 435) {
    throw new Error("The number of nonempty states exceeds 435 House seats.");
  }

  let allocated = eligible.length;

  while (allocated < 435) {
    let next = null;
    let highestPriority = -1;

    for (const state of eligible) {
      const priority =
        state.weight / Math.sqrt(state.seats * (state.seats + 1));

      if (
        priority > highestPriority ||
        (priority === highestPriority &&
          next !== null &&
          state.id < next.id)
      ) {
        highestPriority = priority;
        next = state;
      }
    }

    next.seats += 1;
    allocated += 1;
  }

  for (const state of eligible) {
    byState.set(state.id, state.seats + 2);
  }

  const totalElectors = [...byState.values()].reduce(
    (sum, value) => sum + value,
    0
  );

  return {
    status: "available",
    basis,
    byState,
    totalElectors,
  };
}

/**
 * Summarize the modeled allocation using every recorded vote bucket.
 * A tie, unavailable vote total, or zero-vote contest remains unallocated.
 */
export function summarizeAllocation(snapshot, dataset, allocation) {
  const bucketTotals = Object.fromEntries(
    dataset.candidateIds.map((id) => [id, 0])
  );

  const stateSummaries = new Map();
  let unallocated = 0;

  for (const total of snapshot.totals) {
    const summary = summarizeVotes(total.votes);
    stateSummaries.set(total.stateId, summary);

    const electors = allocation.byState.get(total.stateId);

    if (electors === null || electors === undefined || electors === 0) {
      continue;
    }

    if (summary.status === "leader") {
      bucketTotals[summary.leadingIds[0]] += electors;
    } else {
      unallocated += electors;
    }
  }

  return {
    bucketTotals,
    stateSummaries,
    unallocated,
    totalElectors: allocation.totalElectors,
  };
}

export function leadingBucket(votes) {
  const summary = summarizeVotes(votes);

  return summary.status === "leader"
    ? summary.leadingIds[0]
    : null;
}