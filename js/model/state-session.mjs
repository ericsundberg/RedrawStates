/**
 * Transactional state-session controller.
 *
 * The session owns the current model and derived totals. It does not
 * mutate source county records or TopoJSON geometry.
 */

import {
  addState,
  moveCounties,
  removeState,
  renameState,
  validateStateModel,
} from "./state-registry.mjs";

import { aggregateStates } from "./state-aggregation.mjs";

function freezeTotals(totals) {
  return Object.freeze(
    totals.map((total) =>
      Object.freeze({
        ...total,
        votes: total.votes === null
          ? null
          : Object.freeze({ ...total.votes }),
        missing: Object.freeze({ ...total.missing }),
      })
    )
  );
}

export function createStateSession(dataset) {
  if (
    !dataset ||
    !Array.isArray(dataset.counties) ||
    !Array.isArray(dataset.candidateIds)
  ) {
    throw new TypeError("A valid dataset is required.");
  }

  validateStateModel(dataset.model);

  const initialModel = dataset.model;
  const countyById = new Map(
    dataset.counties.map((county) => [county.id, county])
  );

  if (countyById.size !== dataset.counties.length) {
    throw new Error("The dataset contains duplicate county records.");
  }

  const listeners = new Set();
  let revision = 0;

  function makeSnapshot(model) {
    const totals = aggregateStates(model, dataset.counties, {
      candidateIds: dataset.candidateIds,
    });

    return Object.freeze({
      revision,
      model,
      totals: freezeTotals(totals),
      metadata: dataset.metadata,
    });
  }

  let snapshot = makeSnapshot(initialModel);

  function commit(nextModel) {
    validateStateModel(nextModel);

    // Compute before changing the current snapshot. A failed operation
    // therefore leaves the session unchanged.
    const nextTotals = aggregateStates(nextModel, dataset.counties, {
      candidateIds: dataset.candidateIds,
    });

    revision += 1;

    snapshot = Object.freeze({
      revision,
      model: nextModel,
      totals: freezeTotals(nextTotals),
      metadata: dataset.metadata,
    });

    for (const listener of listeners) {
      listener(snapshot);
    }

    return snapshot;
  }

  return Object.freeze({
    getSnapshot() {
      return snapshot;
    },

    getCounty(countyId) {
      return countyById.get(countyId) ?? null;
    },

    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("A listener must be a function.");
      }

      listener(snapshot);
      listeners.add(listener);

      return () => listeners.delete(listener);
    },

    moveCounties(countyIds, destinationId) {
      return commit(
        moveCounties(snapshot.model, countyIds, destinationId)
      );
    },

    addState(state) {
      return commit(addState(snapshot.model, state));
    },

    renameState(stateId, changes) {
      return commit(renameState(snapshot.model, stateId, changes));
    },

    removeState(stateId, destinationId = null) {
      return commit(
        removeState(snapshot.model, stateId, destinationId)
      );
    },

    replaceModel(model) {
      return commit(model);
    },

    reset() {
      return commit(initialModel);
    },
  });
}