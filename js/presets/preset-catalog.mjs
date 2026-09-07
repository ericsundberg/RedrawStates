/**
 * Data-only preset catalog reader.
 *
 * The catalog contains file references, not preset implementations.
 * The same reader works in a browser or Node through injected JSON I/O.
 */

import {
  readPresetDocument,
} from "./preset-model.mjs";

export const PRESET_CATALOG_FORMAT = "redraw-states-preset-catalog";
export const PRESET_CATALOG_VERSION = 1;

const DEFAULT_MANIFEST = "data/presets/index.json";
const MAX_CATALOG_ENTRIES = 256;

function isRecord(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function validateEntry(entry) {
  if (!isRecord(entry)) {
    throw new Error("Catalog entries must be objects.");
  }

  if (
    typeof entry.id !== "string" ||
    !/^builtin:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)
  ) {
    throw new Error("Invalid built-in preset ID.");
  }

  if (
    typeof entry.filename !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(entry.filename)
  ) {
    throw new Error(
      `Invalid catalog filename for ${entry.id}.`
    );
  }

  return {
    id: entry.id,
    filename: entry.filename,
  };
}

export function validatePresetCatalog(raw) {
  if (
    !isRecord(raw) ||
    raw.format !== PRESET_CATALOG_FORMAT ||
    raw.version !== PRESET_CATALOG_VERSION ||
    !Array.isArray(raw.presets)
  ) {
    throw new Error("Unsupported preset catalog format.");
  }

  if (
    raw.presets.length === 0 ||
    raw.presets.length > MAX_CATALOG_ENTRIES
  ) {
    throw new Error("Invalid preset catalog size.");
  }

  const entries = raw.presets.map(validateEntry);
  const ids = new Set();
  const filenames = new Set();

  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate catalog ID: ${entry.id}`);
    }

    if (filenames.has(entry.filename)) {
      throw new Error(
        `Duplicate catalog filename: ${entry.filename}`
      );
    }

    ids.add(entry.id);
    filenames.add(entry.filename);
  }

  return entries;
}

/**
 * Load and validate all built-in presets for a dataset.
 *
 * readJson(path) may be asynchronous or synchronous. It must return
 * parsed JSON. No browser, filesystem, or network API is used here.
 */
export async function loadPresetCatalog(
  dataset,
  readJson,
  manifestPath = DEFAULT_MANIFEST
) {
  if (typeof readJson !== "function") {
    throw new TypeError("A JSON reader is required.");
  }

  const manifest = await readJson(manifestPath);
  const entries = validatePresetCatalog(manifest);

  const directory = manifestPath.slice(
    0,
    manifestPath.lastIndexOf("/") + 1
  );

  const presets = [];

  for (const entry of entries) {
    const raw = await readJson(
      `${directory}${entry.filename}`
    );

    const documents = readPresetDocument(raw, dataset);

    if (documents.length !== 1) {
      throw new Error(
        `Catalog file ${entry.filename} must contain one preset.`
      );
    }

    const preset = documents[0];

    if (preset.id !== entry.id) {
      throw new Error(
        `Catalog ID mismatch in ${entry.filename}: ` +
        `expected ${entry.id}, received ${preset.id}.`
      );
    }

    presets.push(preset);
  }

  return Object.freeze(presets);
}