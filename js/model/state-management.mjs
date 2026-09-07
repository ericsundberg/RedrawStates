/**
 * State-management operations built on the immutable state session.
 *
 * No election data, county records, or geographic geometry is modified
 * directly by this module.
 */

import {
  createStateModel,
  removeState,
  renameState,
  validateStateModel,
} from "./state-registry.mjs";

function findState(model, stateId) {
  const state = model.states.find((item) => item.id === stateId);

  if (!state) {
    throw new Error(`Unknown state: ${stateId}`);
  }

  return state;
}

export function createStateManager(session, originalModel, createId) {
  if (!session || typeof session.getSnapshot !== "function") {
    throw new TypeError("A state session is required.");
  }

  if (typeof createId !== "function") {
    throw new TypeError("A state ID factory is required.");
  }

  validateStateModel(originalModel);

  const originalIds = Object.keys(originalModel.assignments).sort();
  const currentIds = Object.keys(
    session.getSnapshot().model.assignments
  ).sort();

  if (
    originalIds.length !== currentIds.length ||
    originalIds.some((id, index) => id !== currentIds[index])
  ) {
    throw new Error("The original and current county inventories differ.");
  }

  const originalStates = new Map(
    originalModel.states.map((state) => [state.id, state])
  );

  function getSnapshot() {
    return session.getSnapshot();
  }

  function listStates() {
    const snapshot = getSnapshot();
    const totals = new Map(
      snapshot.totals.map((total) => [total.stateId, total])
    );

    return snapshot.model.states.map((state) => {
      const original = originalStates.get(state.id) ?? null;

      return Object.freeze({
        ...state,
        original,
        isOriginal: original !== null,
        nameChanged: original !== null && (
          state.name !== original.name ||
          state.abbreviation !== original.abbreviation
        ),
        countyCount: totals.get(state.id)?.countyCount ?? 0,
      });
    });
  }

  function create(values) {
    const id = createId();

    if (typeof id !== "string" || !id.startsWith("custom:")) {
      throw new Error("New states require a stable custom state ID.");
    }

    // Normalize and validate before touching the session.
    const definition = createStateModel({
      states: [{
        id,
        name: values.name,
        abbreviation: values.abbreviation,
        kind: "state",
      }],
    }).states[0];

    const snapshot = session.addState(definition);

    return Object.freeze({
      state: definition,
      snapshot,
    });
  }

  function rename(stateId, changes) {
    const snapshot = getSnapshot();
    const current = findState(snapshot.model, stateId);

    const nextModel = renameState(snapshot.model, stateId, {
      name: changes.name,
      abbreviation: changes.abbreviation,
    });

    const next = findState(nextModel, stateId);

    if (
      current.name === next.name &&
      current.abbreviation === next.abbreviation
    ) {
      return snapshot;
    }

    return session.renameState(stateId, {
      name: next.name,
      abbreviation: next.abbreviation,
    });
  }

  function restoreName(stateId) {
    const original = originalStates.get(stateId);

    if (!original) {
      throw new Error("This state does not have an original name to restore.");
    }

    return rename(stateId, {
      name: original.name,
      abbreviation: original.abbreviation,
    });
  }

  function previewDissolution(stateId, destinationId = null) {
    const snapshot = getSnapshot();
    const destination = destinationId || null;

    // The registry performs all destination and last-state checks.
    removeState(snapshot.model, stateId, destination);

    const countyIds = Object.entries(snapshot.model.assignments)
      .filter(([, assignedState]) => assignedState === stateId)
      .map(([countyId]) => countyId)
      .sort();

    return Object.freeze({
      revision: snapshot.revision,
      model: snapshot.model,
      stateId,
      destinationId: destination,
      source: findState(snapshot.model, stateId),
      destination: destination
        ? findState(snapshot.model, destination)
        : null,
      countyIds: Object.freeze(countyIds),
    });
  }

  function dissolve(plan) {
    const snapshot = getSnapshot();

    if (
      !plan ||
      plan.revision !== snapshot.revision ||
      plan.model !== snapshot.model
    ) {
      throw new Error(
        "The configuration changed. Review the dissolution again."
      );
    }

    // Revalidate against the live model, then commit atomically.
    removeState(snapshot.model, plan.stateId, plan.destinationId);

    return session.removeState(
      plan.stateId,
      plan.destinationId
    );
  }

  return Object.freeze({
    getSnapshot,
    listStates,
    create,
    rename,
    restoreName,
    previewDissolution,
    dissolve,
  });
}