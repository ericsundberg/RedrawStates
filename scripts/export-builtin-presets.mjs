/**
 * One-time migration of the existing JavaScript preset catalogs
 * into standalone JSON documents.
 *
 * Run before removing the old preset factories.
 * This script never overwrites existing preset files.
 */

import assert from "node:assert/strict";

import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";

import {
  fileURLToPath,
} from "node:url";

import {
  dirname,
  resolve,
} from "node:path";

import {
  loadLegacyDataset,
} from "../js/data/legacy-datasets.mjs";

import {
  createBuiltinPresets,
} from "../js/presets/builtin-presets.mjs";

import {
  applyPresetPatch,
  normalizePreset,
} from "../js/presets/preset-model.mjs";

import {
  loadPresetCatalog,
  PRESET_CATALOG_FORMAT,
  PRESET_CATALOG_VERSION,
} from "../js/presets/preset-catalog.mjs";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);

const destination = resolve(root, "data/presets");

const expectedIds = new Set([
  "builtin:plymouth-colony",
  "builtin:six-californias",
  "builtin:cal3-2018",
  "builtin:british-west-florida-1764",
  "builtin:franklin",
  "builtin:absaroka-1939",
  "builtin:greater-idaho-current",
  "builtin:south-florida-2014",
  "builtin:jefferson-1941",
  "builtin:chicagoland",
  "builtin:superior",
  "builtin:long-island",
  "builtin:baja-arizona",
  "builtin:west-kansas",
  "builtin:south-georgia",
  "builtin:wisconsin-reattachment",
  "builtin:madawaska",
  "builtin:wetsylvania",
  "builtin:west-maryland",
]);

async function readJson(filename) {
  return JSON.parse(
    await readFile(resolve(root, filename), "utf8")
  );
}

function serialize(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

async function main() {
  const dataset = await loadLegacyDataset("2024", readJson);
  const presets = createBuiltinPresets(dataset);

  const actualIds = new Set(
    presets.map((preset) => preset.id)
  );

  assert.deepEqual(
    [...actualIds].sort(),
    [...expectedIds].sort(),
    "The current catalog does not match the expected 19 presets."
  );

  assert.equal(
    presets.length,
    actualIds.size,
    "The current catalog contains duplicate IDs."
  );

  const manifest = {
    format: PRESET_CATALOG_FORMAT,
    version: PRESET_CATALOG_VERSION,
    presets: [],
  };

  const output = [];
  const filenames = new Set();

  // Validate and prepare every document before writing anything.
  for (const preset of presets) {
    const filename =
      `${preset.id.replace(/^builtin:/, "")}.json`;

    assert.match(
      filename,
      /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/
    );

    assert.equal(
      filenames.has(filename),
      false,
      `Duplicate filename: ${filename}`
    );

    filenames.add(filename);

    const raw = JSON.parse(serialize(preset));
    const restored = normalizePreset(raw, dataset);

    assert.deepEqual(
      restored,
      preset,
      `Serialization changed ${preset.id}.`
    );

    const originalModel = applyPresetPatch(
      dataset.model,
      preset,
      dataset
    ).model;

    const restoredModel = applyPresetPatch(
      dataset.model,
      restored,
      dataset
    ).model;

    assert.deepEqual(
      restoredModel,
      originalModel,
      `Round-trip model differs for ${preset.id}.`
    );

    manifest.presets.push({
      id: preset.id,
      filename,
    });

    output.push({
      filename,
      contents: serialize(raw),
      moves: preset.moves.length,
    });
  }

  // Refuse to overwrite an existing migration or hand-edited data.
  try {
    await mkdir(destination);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        "data/presets already exists. Review or move that directory " +
        "before running the migration; no files were overwritten."
      );
    }

    throw error;
  }

  for (const file of output) {
    await writeFile(
      resolve(destination, file.filename),
      file.contents,
      { flag: "wx" }
    );
  }

  await writeFile(
    resolve(destination, "index.json"),
    serialize(manifest),
    { flag: "wx" }
  );

  // Read the generated files through the new universal reader.
  const imported = await loadPresetCatalog(
    dataset,
    readJson
  );

  assert.deepEqual(
    imported,
    presets,
    "The JSON catalog differs from the original catalog."
  );

  console.log(
    `Exported and verified ${imported.length} standalone presets.`
  );

  for (const file of output) {
    console.log(
      `${file.filename}: ${file.moves} county assignments`
    );
  }

  console.log(
    "Generated data/presets/index.json. " +
    "The running application has not been changed."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});