/**
 * Sparse, composable RedrawStates presets.
 *
 * A preset contains only changed state definitions, county movements,
 * and explicit removals. It never changes source election or area data.
 */

import {
  createStateModel,
  validateIdentifier,
  validateStateModel,
} from "../model/state-registry.mjs";

export const PRESET_FORMAT = "redraw-states-preset";
export const BUNDLE_FORMAT = "redraw-states-preset-bundle";
export const PRESET_VERSION = 1;

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

function text(value, label, maximum, required = true) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  const result = value.trim();

  if ((required && !result) || result.length > maximum) {
    throw new Error(`${label} is empty or too long.`);
  }

  return result;
}

function sameInventory(first, second) {
  const a = Object.keys(first.assignments).sort();
  const b = Object.keys(second.assignments).sort();

  return a.length === b.length &&
    a.every((id, index) => id === b[index]);
}

/**
 * Same deterministic inventory fingerprint as the existing share codec.
 * This is a compatibility identifier, not a cryptographic signature.
 */
export function presetInventoryKey(assignments) {
  const ids = Object.keys(assignments).sort();
  let hash = 2166136261;

  for (const character of ids.join(",")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return `${ids.length}:${(hash >>> 0).toString(16)}`;
}

export function presetGeography(dataset) {
  return {
    schema: dataset.metadata.schema,
    inventory: presetInventoryKey(dataset.model.assignments),
  };
}

function normalizeStateDefinition(state) {
  const value = record(state, "State definition");

  return createStateModel({
    states: [{
      id: value.id,
      name: value.name,
      abbreviation: value.abbreviation,
      kind: value.kind ?? "state",
    }],
  }).states[0];
}

function normalizeRemoval(value) {
  const removal = typeof value === "string"
    ? { id: value, destinationId: null }
    : record(value, "State removal");

  const id = validateIdentifier(removal.id, "Removed state ID");

  const destinationId = removal.destinationId == null
    ? null
    : validateIdentifier(
        removal.destinationId,
        "Removal destination"
      );

  if (id === destinationId) {
    throw new Error("A state cannot be dissolved into itself.");
  }

  return { id, destinationId };
}

export function normalizePreset(raw, dataset) {
  const source = record(raw, "Preset");
  validateStateModel(dataset.model);

  if (
    source.format !== PRESET_FORMAT ||
    source.version !== PRESET_VERSION
  ) {
    throw new Error("Unsupported preset format or version.");
  }

  const geography = presetGeography(dataset);

  if (
    source.geography?.schema !== geography.schema ||
    source.geography?.inventory !== geography.inventory
  ) {
    throw new Error(
      "This preset is incompatible with the loaded county inventory."
    );
  }

  const states = source.states ?? [];
  const moves = source.moves ?? [];
  const removeStates = source.removeStates ?? [];

  if (
    !Array.isArray(states) ||
    !Array.isArray(moves) ||
    !Array.isArray(removeStates)
  ) {
    throw new Error("Preset operations must be arrays.");
  }

  if (
    states.length > 1000 ||
    moves.length > Object.keys(dataset.model.assignments).length ||
    removeStates.length > 1000
  ) {
    throw new Error("Preset exceeds the supported operation limits.");
  }

  const normalizedStates = states.map(normalizeStateDefinition);
  const stateIds = new Set();

  for (const state of normalizedStates) {
    if (stateIds.has(state.id)) {
      throw new Error(`Duplicate preset state: ${state.id}`);
    }

    stateIds.add(state.id);
  }

  const normalizedRemovals = removeStates.map(normalizeRemoval);
  const removedIds = new Set();

  for (const removal of normalizedRemovals) {
    if (removedIds.has(removal.id) || stateIds.has(removal.id)) {
      throw new Error(`Conflicting state operations: ${removal.id}`);
    }

    removedIds.add(removal.id);
  }

  const assignments = dataset.model.assignments;
  const seenCounties = new Set();

  const normalizedMoves = moves.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error("A county movement must be an ID/destination pair.");
    }

    const [countyId, stateId] = entry;

    if (
      typeof countyId !== "string" ||
      !/^\d{5}$/.test(countyId) ||
      !Object.hasOwn(assignments, countyId) ||
      seenCounties.has(countyId)
    ) {
      throw new Error(`Invalid or duplicate preset county: ${countyId}`);
    }

    validateIdentifier(stateId, "Movement destination");

    if (removedIds.has(stateId)) {
      throw new Error(
        `County ${countyId} targets a state removed by this preset.`
      );
    }

    seenCounties.add(countyId);
    return [countyId, stateId];
  });

  const result = {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    id: validateIdentifier(source.id, "Preset ID"),
    name: text(source.name, "Preset name", 120),
    description: text(
      source.description ?? "",
      "Preset description",
      4000,
      false
    ),
    geography,
    sourceDataset: source.sourceDataset ?? null,
    states: normalizedStates,
    moves: normalizedMoves,
    removeStates: normalizedRemovals,
  };

  if (source.source) {
    const provenance = record(source.source, "Preset source");

    result.source = {
      title: text(provenance.title, "Source title", 300),
      url: text(provenance.url, "Source URL", 2000),
    };

    if (!/^https?:\/\//i.test(result.source.url)) {
      throw new Error("Preset source URLs must use HTTP or HTTPS.");
    }
  }

  return result;
}

/**
 * Apply one patch to a model without mutating it.
 *
 * State definitions with matching IDs update that identity. New
 * identities must use custom: IDs. Different identities with duplicate
 * abbreviations are rejected by the final registry validation.
 */
export function applyPresetPatch(model, rawPreset, dataset) {
  validateStateModel(model);

  if (!sameInventory(model, dataset.model)) {
    throw new Error("The current model has a different county inventory.");
  }

  const preset = normalizePreset(rawPreset, dataset);
  const states = new Map(model.states.map((state) => [state.id, state]));
  const assignments = { ...model.assignments };
  const writes = new Map();

  for (const definition of preset.states) {
    const previous = states.get(definition.id);

    if (!previous && !definition.id.startsWith("custom:")) {
      throw new Error(
        `New state ${definition.id} must have a custom: identity.`
      );
    }

    if (previous && previous.kind !== definition.kind) {
      throw new Error(
        `A preset cannot change the kind of state ${definition.id}.`
      );
    }

    states.set(definition.id, definition);
  }

  const removals = new Map(
    preset.removeStates.map((item) => [item.id, item.destinationId])
  );

  function resolveDestination(stateId) {
    const visited = new Set();
    let destination = stateId;

    while (removals.has(destination)) {
      if (visited.has(destination)) {
        throw new Error("Preset removals contain a destination cycle.");
      }

      visited.add(destination);
      destination = removals.get(destination);

      if (destination === null) {
        throw new Error(
          `State ${stateId} has no destination for remaining counties.`
        );
      }
    }

    if (!states.has(destination)) {
      throw new Error(`Unknown preset destination: ${destination}`);
    }

    return destination;
  }

  for (const [countyId, stateId] of preset.moves) {
    if (!states.has(stateId)) {
      throw new Error(`Unknown preset destination: ${stateId}`);
    }

    assignments[countyId] = stateId;
    writes.set(countyId, stateId);
  }

  for (const removal of preset.removeStates) {
    if (!states.has(removal.id)) {
      continue;
    }

    const remaining = Object.entries(assignments)
      .filter(([, stateId]) => stateId === removal.id)
      .map(([countyId]) => countyId);

    if (remaining.length > 0 && removal.destinationId === null) {
      throw new Error(
        `State ${removal.id} still contains ${remaining.length} counties. ` +
        "The preset must explicitly move them or provide a destination."
      );
    }

    if (remaining.length > 0) {
      const destination = resolveDestination(removal.id);

      for (const countyId of remaining) {
        assignments[countyId] = destination;
        writes.set(countyId, destination);
      }
    }
  }

  for (const removal of preset.removeStates) {
    states.delete(removal.id);
  }

  const nextModel = createStateModel({
    states: [...states.values()],
    assignments,
  });

  return {
    model: nextModel,
    writes: [...writes.entries()],
    preset,
  };
}

/**
 * The supplied array is top-first priority order.
 * Reverse it for execution, so index zero is applied last.
 */
export function createPresetPlan(
  dataset,
  snapshot,
  layers,
  { base = "current" } = {}
) {
  if (base !== "current" && base !== "original") {
    throw new Error("Preset base must be current or original.");
  }

  if (!Array.isArray(layers) || layers.length === 0 || layers.length > 64) {
    throw new Error("Select between one and 64 preset layers.");
  }

  const startingModel = base === "original"
    ? dataset.model
    : snapshot.model;

  if (!sameInventory(startingModel, dataset.model)) {
    throw new Error("The current county inventory is incompatible.");
  }

  let model = startingModel;
  const writers = new Map();
  const affected = new Set();
  const conflicts = [];
  const applied = [];

  for (const layer of [...layers].reverse()) {
    const key = layer.key ?? layer.preset?.id ?? layer.id;
    const preset = layer.preset ?? layer;

    const result = applyPresetPatch(model, preset, dataset);
    model = result.model;

    for (const [countyId, destinationId] of result.writes) {
      const previous = writers.get(countyId);

      if (previous && previous.destinationId !== destinationId) {
        conflicts.push({
          countyId,
          earlier: previous.name,
          later: result.preset.name,
          from: previous.destinationId,
          to: destinationId,
        });
      }

      writers.set(countyId, {
        key,
        name: result.preset.name,
        destinationId,
      });

      affected.add(countyId);
    }

    applied.push({
      key,
      name: result.preset.name,
      writes: result.writes.length,
    });
  }

  const changedCountyCount = Object.keys(model.assignments)
    .filter((id) =>
      model.assignments[id] !== startingModel.assignments[id]
    ).length;

  return Object.freeze({
    snapshot,
    base,
    model,
    applied: Object.freeze(applied),
    conflicts: Object.freeze(conflicts),
    affectedCountyCount: affected.size,
    changedCountyCount,
    stateCount: model.states.length,
  });
}

export function applyPresetPlan(session, plan) {
  if (!plan || session.getSnapshot() !== plan.snapshot) {
    throw new Error(
      "The configuration changed. Review the preset stack again."
    );
  }

  return session.replaceModel(plan.model);
}

/**
 * Export a complete current configuration as a sparse delta against
 * the original dataset. No unchanged county assignments are included.
 */
export function createPresetFromModel(
  dataset,
  model,
  { id, name, description = "" }
) {
  validateStateModel(model);

  if (!sameInventory(model, dataset.model)) {
    throw new Error("Cannot export a different county inventory.");
  }

  const originalStates = new Map(
    dataset.model.states.map((state) => [state.id, state])
  );

  const currentIds = new Set(model.states.map((state) => state.id));

  const states = model.states.filter((state) => {
    const original = originalStates.get(state.id);

    return !original ||
      original.name !== state.name ||
      original.abbreviation !== state.abbreviation ||
      original.kind !== state.kind;
  });

  const moves = Object.entries(model.assignments)
    .filter(([countyId, stateId]) =>
      dataset.model.assignments[countyId] !== stateId
    )
    .sort(([a], [b]) => a.localeCompare(b));

  const removeStates = dataset.model.states
    .filter((state) => !currentIds.has(state.id))
    .map((state) => ({
      id: state.id,
      destinationId: null,
    }));

  const preset = normalizePreset({
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    id,
    name,
    description,
    geography: presetGeography(dataset),
    sourceDataset: dataset.metadata.id,
    states,
    moves,
    removeStates,
  }, dataset);

  // Ensure the exported delta reproduces the assignments from baseline.
  const restored = applyPresetPatch(dataset.model, preset, dataset).model;

  for (const countyId of Object.keys(model.assignments)) {
    if (restored.assignments[countyId] !== model.assignments[countyId]) {
      throw new Error(`Export verification failed for ${countyId}.`);
    }
  }

  return preset;
}

export function createPresetBundle(presets, metadata = {}) {
  return {
    format: BUNDLE_FORMAT,
    version: PRESET_VERSION,
    id: metadata.id,
    name: metadata.name ?? "Preset stack",
    description: metadata.description ?? "",
    order: "top-last",
    presets,
  };
}

export function readPresetDocument(raw, dataset) {
  const document = record(raw, "Preset document");

  if (document.format === PRESET_FORMAT) {
    return [normalizePreset(document, dataset)];
  }

  if (
    document.format !== BUNDLE_FORMAT ||
    document.version !== PRESET_VERSION ||
    document.order !== "top-last" ||
    !Array.isArray(document.presets) ||
    document.presets.length > 64
  ) {
    throw new Error("Unsupported preset or stack file.");
  }

  return document.presets.map((preset) =>
    normalizePreset(preset, dataset)
  );
}