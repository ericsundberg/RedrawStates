
/**
 * Transactional state session with explicit US membership.
 * The placement model keeps every county. Only the included projection
 * participates in US totals and electoral allocation.
 */

import {
  addState,
  moveCounties,
  removeState,
  renameState,
  validateStateModel,
} from "./state-registry.mjs";

import { aggregateStates } from "./state-aggregation.mjs";

import {
  createTerritoryWorkspace,
  includedStateModel,
  excludeCounties,
  restoreCounties,
  moveTerritoryCounties,
  dissolveAllStates,
  reactivateArchivedState,
  createTerritoryDocument,
  readTerritoryDocument,
} from "./territory-workspace.mjs";

import {
  replaceTerritoryPlacements,
} from "./territory-transitions.mjs";

import {
  toggleCurrentStateSelection,
} from "./state-selection.mjs";

const EXCLUDED_SUMMARY_STATE = Object.freeze({
  id: "internal:excluded-territory",
  name: "Excluded territory",
  abbreviation: "EX",
  kind: "state",
});

function freezeTotals(totals) {
  return Object.freeze(
    totals.map((total) => Object.freeze({
      ...total,
      votes: total.votes === null
        ? null
        : Object.freeze({ ...total.votes }),
      missing: Object.freeze({ ...total.missing }),
    }))
  );
}

function sameInventory(first, second) {
  const a = Object.keys(first.assignments).sort();
  const b = Object.keys(second.assignments).sort();

  return a.length === b.length &&
    a.every((id, i) => id === b[i]);
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

  const inventory = Object.keys(initialModel.assignments);

  if (
    inventory.length !== countyById.size ||
    inventory.some((id) => !countyById.has(id))
  ) {
    throw new Error("The dataset and model county inventories differ.");
  }

  const listeners = new Set();
  let revision = 0;
  let workspace = createTerritoryWorkspace(initialModel);

  function normalizeWorkspace(value) {
    return readTerritoryDocument(
      createTerritoryDocument(value),
      initialModel
    );
  }

  function makeSnapshot(value, nextRevision) {
    const includedModel = includedStateModel(value);

    const includedCounties = dataset.counties.filter((county) =>
      Object.hasOwn(includedModel.assignments, county.id)
    );

    const excludedCounties = dataset.counties.filter((county) =>
      Object.hasOwn(value.excluded, county.id)
    );

    const totals = aggregateStates(
      includedModel,
      includedCounties,
      { candidateIds: dataset.candidateIds }
    );

    // This temporary accumulator is never part of the US state model.
    const excludedModel = {
      version: 1,
      states: [EXCLUDED_SUMMARY_STATE],
      assignments: Object.fromEntries(
        excludedCounties.map((county) => [
          county.id,
          EXCLUDED_SUMMARY_STATE.id,
        ])
      ),
    };

    const excludedTotals = aggregateStates(
      excludedModel,
      excludedCounties,
      { candidateIds: dataset.candidateIds }
    )[0];

    return Object.freeze({
      revision: nextRevision,
      model: value.placements,
      includedModel,
      excluded: value.excluded,
      territory: value,
      totals: freezeTotals(totals),
      excludedTotals: freezeTotals([excludedTotals])[0],
      metadata: dataset.metadata,
    });
  }

  let snapshot = makeSnapshot(workspace, revision);

  function commit(nextWorkspace) {
    const next = normalizeWorkspace(nextWorkspace);

    // All validation and aggregation happen before changing live state.
    const nextSnapshot = makeSnapshot(next, revision + 1);

    revision += 1;
    workspace = next;
    snapshot = nextSnapshot;

    for (const listener of listeners) {
      listener(snapshot);
    }

    return snapshot;
  }

  function replacePlacements(nextModel, options = {}) {
    return commit(
      replaceTerritoryPlacements(workspace, nextModel, {
        preserveExclusions: true,
        ...options,
      })
    );
  }

  return Object.freeze({
    getSnapshot() {
      return snapshot;
    },

    getTerritoryWorkspace() {
      return workspace;
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
        moveTerritoryCounties(workspace, countyIds, destinationId)
      );
    },

    addState(state) {
      return replacePlacements(
        addState(workspace.placements, state)
      );
    },

    renameState(stateId, changes) {
      return replacePlacements(
        renameState(workspace.placements, stateId, changes)
      );
    },

    removeState(stateId, destinationId = null) {
      return replacePlacements(
        removeState(
          workspace.placements,
          stateId,
          destinationId
        )
      );
    },

    replaceModel(model, options = {}) {
      return replacePlacements(model, options);
    },

    replaceTerritoryWorkspace(value) {
      return commit(value);
    },

    excludeCounties(countyIds) {
      return commit(
        excludeCounties(workspace, countyIds)
      );
    },

    restoreCounties(countyIds, destinationId = null) {
      return commit(
        restoreCounties(workspace, countyIds, destinationId)
      );
    },

    reactivateArchivedState(stateId) {
      return commit(
        reactivateArchivedState(workspace, stateId)
      );
    },

    restorePreviousStates(countyIds) {
      if (!Array.isArray(countyIds)) {
        throw new TypeError("County IDs must be an array.");
      }

      let next = workspace;
      const previousIds = new Set();

      for (const id of countyIds) {
        if (!Object.hasOwn(next.excluded, id)) {
          throw new Error(`County ${id} is not excluded.`);
        }

        previousIds.add(next.excluded[id]);
      }

      for (const id of previousIds) {
        if (!next.placements.states.some((state) => state.id === id)) {
          next = reactivateArchivedState(next, id);
        }
      }

      next = restoreCounties(next, countyIds);

      return commit(next);
    },

    dissolveAllStates() {
      return commit(
        dissolveAllStates(workspace)
      );
    },

    selectStateCounties(countyId, selectedIds = []) {
      return toggleCurrentStateSelection(
        workspace,
        countyId,
        selectedIds
      );
    },

    reset() {
      return commit(
        createTerritoryWorkspace(initialModel)
      );
    },
  });
}