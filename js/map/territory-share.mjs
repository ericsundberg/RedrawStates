/**
 * Version 3 share codec for state boundaries and excluded territory.
 * Existing version 2 and original run-length links remain readable.
 */

import { createStateModel } from "../model/state-registry.mjs";

import {
  createTerritoryWorkspace,
  createTerritoryDocument,
  readTerritoryDocument,
} from "../model/territory-workspace.mjs";

import {
  decodeConfiguration,
  restoreShare,
} from "./map-share.mjs";

function inventoryKey(assignments) {
  const ids = Object.keys(assignments).sort();
  let hash = 2166136261;

  for (const character of ids.join(",")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return `${ids.length}:${(hash >>> 0).toString(16)}`;
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length > 500000
  ) {
    throw new Error("Invalid share configuration.");
  }

  const binary = atob(
    value.replace(/-/g, "+").replace(/_/g, "/")
  );

  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0)
    )
  );
}

function validIndex(value, length) {
  return Number.isSafeInteger(value) &&
    value >= 0 &&
    value < length;
}

export function encodeTerritoryConfiguration(dataset, workspace) {
  const value = readTerritoryDocument(
    createTerritoryDocument(workspace),
    dataset.model
  );

  const ids = Object.keys(dataset.model.assignments).sort();
  const states = value.placements.states;
  const archivedStates = value.archivedStates;
  const allStates = [...states, ...archivedStates];

  const activeIndex = new Map(
    states.map((state, i) => [state.id, i])
  );

  const allIndex = new Map(
    allStates.map((state, i) => [state.id, i])
  );

  const moves = [];
  const excluded = [];

  ids.forEach((id, i) => {
    const stateId = value.placements.assignments[id];

    if (stateId !== dataset.model.assignments[id]) {
      moves.push([i, activeIndex.get(stateId)]);
    }

    if (Object.hasOwn(value.excluded, id)) {
      excluded.push([
        i,
        allIndex.get(value.excluded[id]),
      ]);
    }
  });

  return encodeBase64Url(JSON.stringify({
    version: 3,
    dataset: dataset.metadata.id,
    inventory: inventoryKey(dataset.model.assignments),
    states,
    archivedStates,
    moves,
    excluded,
  }));
}

export function decodeTerritoryConfiguration(dataset, encoded) {
  let payload;

  try {
    payload = JSON.parse(decodeBase64Url(encoded));
  } catch (error) {
    throw new Error(`Invalid share configuration: ${error.message}`);
  }

  if (payload?.version === 2) {
    return createTerritoryWorkspace(
      decodeConfiguration(dataset, encoded)
    );
  }

  const ids = Object.keys(dataset.model.assignments).sort();

  if (
    payload?.version !== 3 ||
    payload.dataset !== dataset.metadata.id ||
    payload.inventory !== inventoryKey(dataset.model.assignments) ||
    !Array.isArray(payload.states) ||
    payload.states.length === 0 ||
    payload.states.length > 1000 ||
    !Array.isArray(payload.archivedStates) ||
    payload.archivedStates.length > 1000 ||
    !Array.isArray(payload.moves) ||
    payload.moves.length > ids.length ||
    !Array.isArray(payload.excluded) ||
    payload.excluded.length > ids.length
  ) {
    throw new Error(
      "This share configuration is incompatible with the dataset."
    );
  }

  const assignments = { ...dataset.model.assignments };
  const seenMoves = new Set();

  for (const entry of payload.moves) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !validIndex(entry[0], ids.length) ||
      !validIndex(entry[1], payload.states.length) ||
      seenMoves.has(entry[0])
    ) {
      throw new Error("Invalid or duplicate shared county movement.");
    }

    seenMoves.add(entry[0]);
    assignments[ids[entry[0]]] = payload.states[entry[1]].id;
  }

  const placements = createStateModel({
    states: payload.states,
    assignments,
  });

  const allStates = [...payload.states, ...payload.archivedStates];
  const excluded = {};

  for (const entry of payload.excluded) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !validIndex(entry[0], ids.length) ||
      !validIndex(entry[1], allStates.length) ||
      Object.hasOwn(excluded, ids[entry[0]])
    ) {
      throw new Error("Invalid or duplicate excluded county.");
    }

    excluded[ids[entry[0]]] = allStates[entry[1]].id;
  }

  return readTerritoryDocument({
    format: "redraw-states-territory-workspace",
    version: 1,
    placements,
    excluded,
    archivedStates: payload.archivedStates,
  }, dataset.model);
}

export function restoreTerritoryShare(dataset, params) {
  if (params.has("cfg")) {
    return decodeTerritoryConfiguration(
      dataset,
      params.get("cfg")
    );
  }

  if (params.has("share")) {
    return createTerritoryWorkspace(
      restoreShare(dataset, params)
    );
  }

  return createTerritoryWorkspace(dataset.model);
}

export function createTerritoryShareUrl(dataset, workspace) {
  const url = new URL(window.location.href);

  url.search = "";
  url.hash = "";
  url.searchParams.set("year", dataset.metadata.id);
  url.searchParams.set(
    "cfg",
    encodeTerritoryConfiguration(dataset, workspace)
  );

  return url.toString();
}