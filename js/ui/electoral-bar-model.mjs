/**
 * Pure presentation model for aggregated and state-by-state electoral bars.
 */

const UNALLOCATED = "unallocated";

function validElectors(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function buildElectoralBarModel(
  snapshot,
  dataset,
  allocation,
  summary
) {
  const fields = dataset.metadata.voteFields;

  const groups = [
    ...fields.map((field) => ({
      id: field.id,
      label: field.label,
      total: 0,
      states: [],
    })),
    {
      id: UNALLOCATED,
      label: "Unallocated / ties",
      total: 0,
      states: [],
    },
  ];

  if (allocation.status !== "available") {
    return {
      status: "unavailable",
      totalElectors: null,
      groups,
      states: [],
    };
  }

  const groupsById = new Map(
    groups.map((group) => [group.id, group])
  );

  const states = [];

  for (const state of snapshot.model.states) {
    const electors = allocation.byState.get(state.id);

    if (!validElectors(electors)) {
      throw new Error(`Invalid elector count for ${state.id}.`);
    }

    const voteSummary = summary.stateSummaries.get(state.id);

    const leader = voteSummary?.status === "leader"
      ? voteSummary.leadingIds[0]
      : null;

    const bucketId = leader && groupsById.has(leader)
      ? leader
      : UNALLOCATED;

    const record = {
      id: state.id,
      name: state.name,
      code: state.abbreviation,
      electors,
      bucketId,
      bucketLabel: groupsById.get(bucketId).label,
      voteStatus: voteSummary?.status ?? "unavailable",
    };

    states.push(record);

    const group = groupsById.get(bucketId);
    group.total += electors;
    group.states.push(record);
  }

  for (const group of groups) {
    group.states.sort((a, b) =>
      a.code.localeCompare(b.code) ||
      a.name.localeCompare(b.name)
    );
  }

  const total = groups.reduce(
    (sum, group) => sum + group.total,
    0
  );

  if (total !== allocation.totalElectors) {
    throw new Error("The state segments do not reconcile to the allocation.");
  }

  for (const field of fields) {
    if (groupsById.get(field.id).total !== summary.bucketTotals[field.id]) {
      throw new Error(
        `The ${field.label} segments do not reconcile to the summary.`
      );
    }
  }

  if (
    groupsById.get(UNALLOCATED).total !== summary.unallocated
  ) {
    throw new Error("Unallocated segments do not reconcile to the summary.");
  }

  return {
    status: "available",
    totalElectors: total,
    groups,
    states,
  };
}