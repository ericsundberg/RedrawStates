
import {
  createTerritoryDocument,
  readTerritoryDocument,
  validateTerritoryWorkspace,
} from "./territory-workspace.mjs";

import {
  validateIdentifier,
  validateStateModel,
} from "./state-registry.mjs";

export function replaceTerritoryPlacements(
  workspace,
  nextModel,
  { reincludeCountyIds = [], preserveExclusions = false } = {}
) {
  validateTerritoryWorkspace(workspace);
  validateStateModel(nextModel);

  const previous = workspace.placements;
  const ids = Object.keys(previous.assignments).sort();
  const nextIds = Object.keys(nextModel.assignments).sort();

  if (
    ids.length !== nextIds.length ||
    ids.some((id, index) => id !== nextIds[index])
  ) {
    const missing = ids.filter(
      (id) => !Object.hasOwn(nextModel.assignments, id)
    );

    if (missing.length) {
      throw new Error(
        `County ${missing[0]} has no state assignment.`
      );
    }

    throw new Error("The current county inventory is incompatible.");
  }

  const active = new Set(
    nextModel.states.map((state) => state.id)
  );

  const archive = new Map(
    workspace.archivedStates.map((state) => [state.id, state])
  );

  for (const state of previous.states) {
    if (!active.has(state.id)) {
      archive.set(state.id, state);
    }
  }

  for (const id of active) {
    archive.delete(id);
  }

  const excluded = { ...workspace.excluded };
  const reinclude = new Set(reincludeCountyIds);

  for (const id of reinclude) {
    validateIdentifier(id, "County ID");

    if (!Object.hasOwn(previous.assignments, id)) {
      throw new Error(`Unknown county: ${id}`);
    }
  }

  for (const id of Object.keys(excluded)) {
    if (
      reinclude.has(id) ||
      (!preserveExclusions &&
        previous.assignments[id] !== nextModel.assignments[id])
    ) {
      delete excluded[id];
    }
  }

  return readTerritoryDocument({
    ...createTerritoryDocument(workspace),
    placements: nextModel,
    excluded,
    archivedStates: [...archive.values()],
  }, previous);
}