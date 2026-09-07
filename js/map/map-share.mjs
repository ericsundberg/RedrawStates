/**
 * Versioned share codec with compatibility for original RedrawStates links.
 */

import { createStateModel } from "../model/state-registry.mjs";
import { normalizeLegacyCountyId } from "../data/legacy-geography.mjs";

const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

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
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 100000) {
    throw new Error("Invalid share configuration.");
  }

  const binary = atob(
    value.replace(/-/g, "+").replace(/_/g, "/")
  );

  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0))
  );
}

function inventoryKey(assignments) {
  const ids = Object.keys(assignments).sort();
  let hash = 2166136261;

  for (const character of ids.join(",")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return `${ids.length}:${(hash >>> 0).toString(16)}`;
}

export function encodeConfiguration(dataset, model) {
  const moves = Object.entries(model.assignments)
    .filter(([id, stateId]) =>
      dataset.model.assignments[id] !== stateId
    )
    .sort(([a], [b]) => a.localeCompare(b));

  const payload = {
    version: 2,
    dataset: dataset.metadata.id,
    inventory: inventoryKey(dataset.model.assignments),
    states: model.states,
    moves,
  };

  return encodeBase64Url(JSON.stringify(payload));
}

export function decodeConfiguration(dataset, encoded) {
  const payload = JSON.parse(decodeBase64Url(encoded));

  if (
    payload.version !== 2 ||
    payload.dataset !== dataset.metadata.id ||
    payload.inventory !== inventoryKey(dataset.model.assignments) ||
    !Array.isArray(payload.states) ||
    !Array.isArray(payload.moves)
  ) {
    throw new Error("This share configuration is incompatible with the dataset.");
  }

  const assignments = { ...dataset.model.assignments };
  const seen = new Set();

  for (const entry of payload.moves) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error("Invalid county movement in share configuration.");
    }

    const [countyId, stateId] = entry;

    if (
      typeof countyId !== "string" ||
      !Object.hasOwn(assignments, countyId) ||
      seen.has(countyId)
    ) {
      throw new Error(`Invalid or duplicate shared county: ${countyId}`);
    }

    seen.add(countyId);
    assignments[countyId] = stateId;
  }

  return createStateModel({
    states: payload.states,
    assignments,
  });
}

/**
 * Decode the original 52-letter run-length format.
 *
 * The first 51 letters represent the original state order. The final
 * letter is the source-only geometry sentinel. All geometry positions,
 * including empty shells, are retained when interpreting old links.
 */
export function decodeLegacyShare(dataset, encoded) {
  const states = dataset.model.states;
  const geometries = [...dataset.topology.objects.counties.geometries]
    .sort((a, b) => Number(a.id) - Number(b.id));

  const assignments = { ...dataset.model.assignments };
  const expanded = [];
  const pattern = /(\d*)([a-zA-Z])/g;
  let offset = 0;
  let match;

  while ((match = pattern.exec(encoded)) !== null) {
    if (match.index !== offset) {
      throw new Error("Invalid legacy share code.");
    }

    offset = pattern.lastIndex;
    const count = match[1] ? Number(match[1]) : 1;

    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error("Invalid legacy share run length.");
    }

    const index = LETTERS.indexOf(match[2]);

    if (index < 0 || index > 51) {
      throw new Error("Invalid legacy state code.");
    }

    if (expanded.length + count > geometries.length) {
      throw new Error("Legacy share code is longer than the county inventory.");
    }

    for (let i = 0; i < count; i++) {
      expanded.push(index);
    }
  }

  if (offset !== encoded.length || expanded.length !== geometries.length) {
    throw new Error("Legacy share code has an incomplete county inventory.");
  }

  for (let i = 0; i < geometries.length; i++) {
    const index = expanded[i];

    if (index === 51) {
      continue;
    }

    const geometry = geometries[i];
    const countyId = normalizeLegacyCountyId(
      geometry.id ?? geometry.properties?.id
    );

    if (Object.hasOwn(assignments, countyId)) {
      assignments[countyId] = states[index].id;
    }
  }

  return createStateModel({
    states,
    assignments,
  });
}

export function restoreShare(dataset, params) {
  if (params.has("cfg")) {
    return decodeConfiguration(dataset, params.get("cfg"));
  }

  if (params.has("share")) {
    return decodeLegacyShare(dataset, params.get("share"));
  }

  return dataset.model;
}

export function createShareUrl(dataset, model) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("year", dataset.metadata.id);
  url.searchParams.set("cfg", encodeConfiguration(dataset, model));
  return url.toString();
}