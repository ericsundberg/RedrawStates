/**
 * Territory membership and bulk state operations.
 *
 * This is a compatibility-safe domain layer around the existing
 * state registry. The placement model retains the complete county
 * inventory. Exclusion is represented separately and must be
 * filtered out before calculating US totals or electoral results.
 *
 * No source county records are mutated.
 */

import {
  addState,
  createStateModel,
  moveCounties as moveRegistryCounties,
  validateIdentifier,
  validateStateModel,
} from "./state-registry.mjs";

export const TERRITORY_FORMAT = "redraw-states-territory-workspace";
export const TERRITORY_VERSION = 1;

export const UNITED_STATES_ID =
  "custom:united-states-of-america";

export const UNITED_STATES_STATE = Object.freeze({
  id: UNITED_STATES_ID,
  name: "United State of America",
  abbreviation: "US",
  kind: "state",
});

function record(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value;
}

function sameInventory(first, second) {
  const a = Object.keys(first.assignments).sort();
  const b = Object.keys(second.assignments).sort();

  return a.length === b.length &&
    a.every((id, index) => id === b[index]);
}

function validateCountyIds(workspace, countyIds) {
  if (!Array.isArray(countyIds)) {
    throw new TypeError("County IDs must be an array.");
  }

  const unique = [...new Set(countyIds)];

  for (const countyId of unique) {
    validateIdentifier(countyId, "County ID");

    if (!Object.hasOwn(workspace.placements.assignments, countyId)) {
      throw new Error(`Unknown county: ${countyId}`);
    }
  }

  return unique;
}

function activeStates(workspace) {
  return new Map(
    workspace.placements.states.map((state) => [state.id, state])
  );
}

function archiveMap(workspace) {
  return new Map(
    workspace.archivedStates.map((state) => [state.id, state])
  );
}

function makeWorkspace(placements, excluded, archivedStates) {
  validateStateModel(placements);
  record(excluded, "Excluded counties");

  if (!Array.isArray(archivedStates)) {
    throw new TypeError("Archived states must be an array.");
  }

  const active = new Set(
    placements.states.map((state) => state.id)
  );

  const archived = new Map();

  for (const state of archivedStates) {
    const normalized = createStateModel({
      states: [state],
    }).states[0];

    if (active.has(normalized.id) || archived.has(normalized.id)) {
      throw new Error(`Duplicate archived state: ${normalized.id}`);
    }

    archived.set(normalized.id, normalized);
  }

  const normalizedExcluded = {};

  for (const [countyId, previousStateId] of Object.entries(excluded)) {
    if (!Object.hasOwn(placements.assignments, countyId)) {
      throw new Error(`Unknown excluded county: ${countyId}`);
    }

    validateIdentifier(previousStateId, "Previous state ID");

    if (
      !active.has(previousStateId) &&
      !archived.has(previousStateId)
    ) {
      throw new Error(
        `Excluded county ${countyId} has an unknown previous state.`
      );
    }

    normalizedExcluded[countyId] = previousStateId;
  }

  const workspace = {
    format: TERRITORY_FORMAT,
    version: TERRITORY_VERSION,
    placements,
    excluded: Object.freeze(normalizedExcluded),
    archivedStates: Object.freeze([...archived.values()]),
  };

  return Object.freeze(workspace);
}

export function createTerritoryWorkspace(model) {
  validateStateModel(model);

  return makeWorkspace(model, {}, []);
}

export function validateTerritoryWorkspace(workspace) {
  const value = record(workspace, "Territory workspace");

  if (
    value.format !== TERRITORY_FORMAT ||
    value.version !== TERRITORY_VERSION
  ) {
    throw new Error("Unsupported territory workspace version.");
  }

  makeWorkspace(
    value.placements,
    value.excluded,
    value.archivedStates
  );

  return true;
}

function checked(workspace) {
  validateTerritoryWorkspace(workspace);
  return workspace;
}

/**
 * The projection to use for US-wide totals and electoral calculations.
 * Excluded counties are absent, not assigned to a synthetic state.
 */
export function includedStateModel(workspace) {
  checked(workspace);

  const assignments = Object.fromEntries(
    Object.entries(workspace.placements.assignments)
      .filter(([countyId]) =>
        !Object.hasOwn(workspace.excluded, countyId)
      )
  );

  return createStateModel({
    states: workspace.placements.states,
    assignments,
  });
}

export function excludedCountyIds(workspace) {
  checked(workspace);
  return Object.keys(workspace.excluded).sort();
}

export function territoryCounts(workspace) {
  checked(workspace);

  const totalCount = Object.keys(
    workspace.placements.assignments
  ).length;

  const excludedCount = Object.keys(workspace.excluded).length;

  return {
    stateCount: workspace.placements.states.length,
    includedCountyCount: totalCount - excludedCount,
    excludedCountyCount: excludedCount,
    totalCountyCount: totalCount,
  };
}

/**
 * Select the entire current modeled state.
 *
 * Shift-click selection is additive. Clicking an excluded county
 * selects the excluded pool, since that is its current membership.
 */
export function selectCurrentState(
  workspace,
  countyId,
  selectedCountyIds = []
) {
  checked(workspace);

  const selected = validateCountyIds(
    workspace,
    selectedCountyIds
  );

  validateCountyIds(workspace, [countyId]);

  const assignments = workspace.placements.assignments;
  const clickedIsExcluded = Object.hasOwn(
    workspace.excluded,
    countyId
  );

  const destination = assignments[countyId];

  const group = Object.keys(assignments).filter((id) => {
    const isExcluded = Object.hasOwn(workspace.excluded, id);

    if (clickedIsExcluded) {
      return isExcluded;
    }

    return !isExcluded && assignments[id] === destination;
  });

  return [...new Set([...selected, ...group])].sort();
}

/**
 * Exclude counties without changing their placement or source data.
 * Repeated exclusion preserves the original restoration destination.
 */
export function excludeCounties(workspace, countyIds) {
  checked(workspace);

  const ids = validateCountyIds(workspace, countyIds);

  if (ids.length === 0) {
    return workspace;
  }

  const excluded = { ...workspace.excluded };
  let changed = false;

  for (const countyId of ids) {
    if (!Object.hasOwn(excluded, countyId)) {
      excluded[countyId] =
        workspace.placements.assignments[countyId];

      changed = true;
    }
  }

  if (!changed) {
    return workspace;
  }

  return makeWorkspace(
    workspace.placements,
    excluded,
    workspace.archivedStates
  );
}

/**
 * Restore excluded counties to their last included state, or to an
 * explicitly selected destination.
 *
 * If the last state was dissolved, the caller must reactivate it or
 * choose another destination. No implicit geographic guess is made.
 */
export function restoreCounties(
  workspace,
  countyIds,
  destinationId = null
) {
  checked(workspace);

  const ids = validateCountyIds(workspace, countyIds);

  if (ids.length === 0) {
    return workspace;
  }

  const states = activeStates(workspace);

  if (destinationId !== null && !states.has(destinationId)) {
    throw new Error(`Unknown restoration destination: ${destinationId}`);
  }

  const assignments = {
    ...workspace.placements.assignments,
  };

  const excluded = { ...workspace.excluded };

  // Validate the entire batch before constructing a new model.
  for (const countyId of ids) {
    if (!Object.hasOwn(excluded, countyId)) {
      throw new Error(`County ${countyId} is not excluded.`);
    }

    const target = destinationId ?? excluded[countyId];

    if (!states.has(target)) {
      throw new Error(
        `The previous state for ${countyId} is no longer active. ` +
        "Reactivate it or select another destination."
      );
    }

    assignments[countyId] = target;
  }

  for (const countyId of ids) {
    delete excluded[countyId];
  }

  const placements = createStateModel({
    states: workspace.placements.states,
    assignments,
  });

  return makeWorkspace(
    placements,
    excluded,
    workspace.archivedStates
  );
}

/**
 * Moving a county to an active state also re-adds it to the US.
 * This makes the existing Move to state workflow the explicit
 * re-inclusion mechanism.
 */
export function moveTerritoryCounties(
  workspace,
  countyIds,
  destinationId
) {
  checked(workspace);

  const ids = validateCountyIds(workspace, countyIds);

  if (ids.length === 0) {
    return workspace;
  }

  const placements = moveRegistryCounties(
    workspace.placements,
    ids,
    destinationId
  );

  const excluded = { ...workspace.excluded };

  for (const countyId of ids) {
    delete excluded[countyId];
  }

  return makeWorkspace(
    placements,
    excluded,
    workspace.archivedStates
  );
}

/**
 * Replace all active states with one US state. Excluded counties
 * remain excluded. Their previous states are kept in the archive.
 */
export function dissolveAllStates(workspace) {
  checked(workspace);

  const archive = archiveMap(workspace);

  for (const state of workspace.placements.states) {
    if (state.id !== UNITED_STATES_ID) {
      archive.set(state.id, state);
    }
  }

  archive.delete(UNITED_STATES_ID);

  const assignments = Object.fromEntries(
    Object.keys(workspace.placements.assignments)
      .map((countyId) => [countyId, UNITED_STATES_ID])
  );

  const placements = createStateModel({
    states: [UNITED_STATES_STATE],
    assignments,
  });

  return makeWorkspace(
    placements,
    workspace.excluded,
    [...archive.values()]
  );
}

/**
 * Reactivate a previously dissolved state without assigning any
 * counties to it. The existing registry enforces code uniqueness.
 */
export function reactivateArchivedState(workspace, stateId) {
  checked(workspace);
  validateIdentifier(stateId, "State ID");

  if (activeStates(workspace).has(stateId)) {
    return workspace;
  }

  const archive = archiveMap(workspace);
  const state = archive.get(stateId);

  if (!state) {
    throw new Error(`Unknown archived state: ${stateId}`);
  }

  const placements = addState(workspace.placements, state);
  archive.delete(stateId);

  return makeWorkspace(
    placements,
    workspace.excluded,
    [...archive.values()]
  );
}

/**
 * Restore the original dataset's state arrangement.
 * This is distinct from dissolving all states.
 */
export function resetTerritoryWorkspace(originalModel) {
  return createTerritoryWorkspace(originalModel);
}

/**
 * JSON-compatible document for the eventual save/share integration.
 * The current application's share codec is not changed by this file.
 */
export function createTerritoryDocument(workspace) {
  checked(workspace);

  return {
    format: TERRITORY_FORMAT,
    version: TERRITORY_VERSION,
    placements: workspace.placements,
    excluded: workspace.excluded,
    archivedStates: workspace.archivedStates,
  };
}

export function readTerritoryDocument(raw, originalModel) {
  validateStateModel(originalModel);
  const document = record(raw, "Territory document");

  // Legacy state models remain readable as fully included territory.
  if (document.version === 1 && Array.isArray(document.states)) {
    validateStateModel(document);

    if (!sameInventory(document, originalModel)) {
      throw new Error("The saved county inventory is incompatible.");
    }

    return createTerritoryWorkspace(document);
  }

  const workspace = makeWorkspace(
    document.placements,
    document.excluded,
    document.archivedStates
  );

  if (
    document.format !== TERRITORY_FORMAT ||
    document.version !== TERRITORY_VERSION ||
    !sameInventory(workspace.placements, originalModel)
  ) {
    throw new Error("The territory document is incompatible.");
  }

  return workspace;
}