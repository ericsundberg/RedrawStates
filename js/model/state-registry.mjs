/**
 * State registry and county-assignment model.
 *
 * State IDs and county IDs are stable identifiers. Display names and
 * abbreviations may change without changing those identities.
 *
 * This module is independent of D3, election data, and browser state.
 */

const MODEL_VERSION = 1;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;

export function validateIdentifier(value, label = "Identifier") {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw new TypeError(`${label} must be a valid, nonempty string.`);
  }

  return value;
}

function normalizeState(state) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("A state must be an object.");
  }

  const id = validateIdentifier(state.id, "State ID");

  if (typeof state.name !== "string" || !state.name.trim()) {
    throw new TypeError(`State ${id} must have a name.`);
  }

  const name = state.name.trim();

  if (name.length > 120) {
    throw new RangeError(`State ${id} has a name that is too long.`);
  }

  if (typeof state.abbreviation !== "string") {
    throw new TypeError(`State ${id} must have an abbreviation.`);
  }

  const abbreviation = state.abbreviation.trim().toUpperCase();

  if (!/^[A-Z][A-Z0-9-]{0,11}$/.test(abbreviation)) {
    throw new TypeError(`State ${id} has an invalid abbreviation.`);
  }

  const kind = state.kind ?? "state";

  if (kind !== "state" && kind !== "district") {
    throw new TypeError(`State ${id} has an unsupported kind.`);
  }

  return { id, name, abbreviation, kind };
}

/**
 * Validate a model, including unique state identities and valid assignments.
 */
export function validateStateModel(model) {
  if (model === null || typeof model !== "object" || Array.isArray(model)) {
    throw new TypeError("The state model must be an object.");
  }

  if (model.version !== MODEL_VERSION) {
    throw new Error(`Unsupported state model version: ${model.version}`);
  }

  if (!Array.isArray(model.states) || model.states.length === 0) {
    throw new Error("The model must contain at least one state.");
  }

  const ids = new Set();
  const abbreviations = new Set();

  for (const state of model.states) {
    const normalized = normalizeState(state);

    if (ids.has(normalized.id)) {
      throw new Error(`Duplicate state ID: ${normalized.id}`);
    }

    if (abbreviations.has(normalized.abbreviation)) {
      throw new Error(
        `Duplicate state abbreviation: ${normalized.abbreviation}`
      );
    }

    ids.add(normalized.id);
    abbreviations.add(normalized.abbreviation);
  }

  if (
    model.assignments === null ||
    typeof model.assignments !== "object" ||
    Array.isArray(model.assignments)
  ) {
    throw new TypeError("County assignments must be an object.");
  }

  for (const [countyId, stateId] of Object.entries(model.assignments)) {
    validateIdentifier(countyId, "County ID");

    if (!ids.has(stateId)) {
      throw new Error(
        `County ${countyId} is assigned to unknown state ${stateId}.`
      );
    }
  }

  return true;
}

/**
 * Create an immutable, JSON-serializable state model.
 *
 * assignments is an object keyed by stable county IDs.
 */
export function createStateModel({ states, assignments = {} }) {
  if (!Array.isArray(states)) {
    throw new TypeError("States must be an array.");
  }

  if (
    assignments === null ||
    typeof assignments !== "object" ||
    Array.isArray(assignments)
  ) {
    throw new TypeError("Assignments must be an object.");
  }

  const model = {
    version: MODEL_VERSION,
    states: states.map(normalizeState),
    assignments: Object.fromEntries(Object.entries(assignments)),
  };

  validateStateModel(model);

  for (const state of model.states) {
    Object.freeze(state);
  }

  Object.freeze(model.states);
  Object.freeze(model.assignments);

  return Object.freeze(model);
}

/**
 * Add a state. The caller supplies a stable ID, such as custom:<uuid>.
 */
export function addState(model, state) {
  validateStateModel(model);

  return createStateModel({
    states: [...model.states, state],
    assignments: model.assignments,
  });
}

/**
 * Change a state's display name or abbreviation without changing its ID.
 */
export function renameState(model, stateId, changes) {
  validateStateModel(model);

  if (!model.states.some((state) => state.id === stateId)) {
    throw new Error(`Unknown state: ${stateId}`);
  }

  if (changes === null || typeof changes !== "object") {
    throw new TypeError("State changes must be an object.");
  }

  const states = model.states.map((state) => {
    if (state.id !== stateId) {
      return state;
    }

    return {
      ...state,
      name: changes.name ?? state.name,
      abbreviation: changes.abbreviation ?? state.abbreviation,
    };
  });

  return createStateModel({
    states,
    assignments: model.assignments,
  });
}

/**
 * Move one or more counties to a destination state.
 *
 * All county IDs and the destination are validated before any change is
 * returned. Unknown counties cannot be silently added to the model.
 */
export function moveCounties(model, countyIds, destinationId) {
  validateStateModel(model);

  if (!model.states.some((state) => state.id === destinationId)) {
    throw new Error(`Unknown destination state: ${destinationId}`);
  }

  if (!Array.isArray(countyIds)) {
    throw new TypeError("County IDs must be an array.");
  }

  const uniqueCountyIds = [...new Set(countyIds)];

  for (const countyId of uniqueCountyIds) {
    validateIdentifier(countyId, "County ID");

    if (!Object.hasOwn(model.assignments, countyId)) {
      throw new Error(`Unknown county: ${countyId}`);
    }
  }

  const assignments = { ...model.assignments };

  for (const countyId of uniqueCountyIds) {
    assignments[countyId] = destinationId;
  }

  return createStateModel({
    states: model.states,
    assignments,
  });
}

/**
 * Dissolve a state and optionally reassign all of its counties.
 *
 * A destination is required when the state contains counties. The last
 * remaining state cannot be removed.
 */
export function removeState(model, stateId, destinationId = null) {
  validateStateModel(model);

  if (!model.states.some((state) => state.id === stateId)) {
    throw new Error(`Unknown state: ${stateId}`);
  }

  if (model.states.length === 1) {
    throw new Error("The last remaining state cannot be removed.");
  }

  const assignedCounties = Object.entries(model.assignments)
    .filter(([, assignedState]) => assignedState === stateId)
    .map(([countyId]) => countyId);

  if (destinationId !== null) {
    if (destinationId === stateId) {
      throw new Error("A state cannot be dissolved into itself.");
    }

    if (!model.states.some((state) => state.id === destinationId)) {
      throw new Error(`Unknown destination state: ${destinationId}`);
    }
  }

  if (assignedCounties.length > 0 && destinationId === null) {
    throw new Error(
      "A destination state is required before dissolving an occupied state."
    );
  }

  const assignments = { ...model.assignments };

  for (const countyId of assignedCounties) {
    assignments[countyId] = destinationId;
  }

  return createStateModel({
    states: model.states.filter((state) => state.id !== stateId),
    assignments,
  });
}