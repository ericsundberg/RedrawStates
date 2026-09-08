import {
  createStateModel,
  validateIdentifier,
  validateStateModel,
} from "./state-registry.mjs";

export const UNITED_STATES_ID = "custom:united-states-of-america";

export const UNITED_STATES_STATE = Object.freeze({
  id: UNITED_STATES_ID,
  name: "United State of America",
  abbreviation: "US",
  kind: "state",
});

export function createDissolveAllPlan(model) {
  validateStateModel(model);

  const allowed = new Set(["version", "states", "assignments"]);

  if (Object.keys(model).some((key) => !allowed.has(key))) {
    throw new Error(
      "This model has additional territory data. Use the territory-aware dissolution."
    );
  }

  const alreadyMerged =
    model.states.length === 1 &&
    model.states[0].id === UNITED_STATES_ID &&
    model.states[0].name === UNITED_STATES_STATE.name &&
    model.states[0].abbreviation === "US" &&
    model.states[0].kind === "state" &&
    Object.values(model.assignments).every(
      (id) => id === UNITED_STATES_ID
    );

  const nextModel = alreadyMerged
    ? model
    : createStateModel({
        states: [UNITED_STATES_STATE],
        assignments: Object.fromEntries(
          Object.keys(model.assignments).map((id) => [
            id,
            UNITED_STATES_ID,
          ])
        ),
      });

  return Object.freeze({
    model,
    nextModel,
    sourceStateCount: model.states.length,
    countyCount: Object.keys(model.assignments).length,
    archivedStates: Object.freeze([...model.states]),
    changedCountyCount: Object.entries(model.assignments)
      .filter(([, id]) => id !== UNITED_STATES_ID).length,
  });
}

export function selectCurrentStateCounties(
  model,
  countyId,
  selectedCountyIds = []
) {
  validateStateModel(model);
  validateIdentifier(countyId, "County ID");

  if (!Object.hasOwn(model.assignments, countyId)) {
    throw new Error(`Unknown county: ${countyId}`);
  }

  if (!Array.isArray(selectedCountyIds)) {
    throw new TypeError("Selected county IDs must be an array.");
  }

  const selected = new Set();

  for (const id of selectedCountyIds) {
    validateIdentifier(id, "County ID");

    if (!Object.hasOwn(model.assignments, id)) {
      throw new Error(`Unknown county: ${id}`);
    }

    selected.add(id);
  }

  const stateId = model.assignments[countyId];

  for (const [id, assignedStateId] of Object.entries(model.assignments)) {
    if (assignedStateId === stateId) {
      selected.add(id);
    }
  }

  return [...selected].sort();
}