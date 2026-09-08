/**
 * One-time data migration for built-in preset abbreviations.
 *
 * Default mode is read-only. Use --write only after reviewing
 * the proposed changes. No county assignments or state IDs change.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

import {
  loadLegacyDataset,
} from "../js/data/legacy-datasets.mjs";

import {
  applyPresetPatch,
  normalizePreset,
} from "../js/presets/preset-model.mjs";

const root = new URL("../", import.meta.url);
const directory = new URL("../data/presets/", import.meta.url);
const write = process.argv.includes("--write");

const codes = new Map([
  ["custom:preset:plymouth", "PL"],
  ["custom:preset:six-californias:jefferson", "JF"],
  ["custom:preset:six-californias:north", "CN"],
  ["custom:preset:six-californias:silicon-valley", "SV"],
  ["custom:preset:six-californias:central", "CC"],
  ["custom:preset:six-californias:west", "CW"],
  ["custom:preset:six-californias:south", "CS"],
  ["custom:preset:cal3:north", "NL"],
  ["custom:preset:cal3:california", "CM"],
  ["custom:preset:cal3:south", "SL"],
  ["custom:preset:west-florida", "WF"],
  ["custom:preset:franklin", "FK"],
  ["custom:preset:absaroka", "AB"],
  ["custom:preset:south-florida", "SF"],
  ["custom:preset:jefferson-1941", "JH"],
  ["custom:preset:chicagoland", "CH"],
  ["custom:preset:superior", "SU"],
  ["custom:preset:long-island", "LI"],
  ["custom:preset:baja-arizona", "BA"],
  ["custom:preset:west-kansas", "WK"],
  ["custom:preset:south-georgia", "SG"],
  ["custom:preset:madawaska", "MK"],
  ["custom:preset:west-maryland", "WM"],
  ["state:WV", "WS"],
]);

async function readJson(path) {
  return JSON.parse(
    await readFile(new URL(path, root), "utf8")
  );
}

function serialize(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

async function main() {
  const dataset = await loadLegacyDataset("2024", readJson);
  const manifest = await readJson("data/presets/index.json");

  const reserved = new Map(
    dataset.model.states.map((state) => [
      state.abbreviation,
      state.id,
    ])
  );

  const proposed = new Map();
  const encountered = new Set();
  const updates = [];

  for (const entry of manifest.presets) {
    const path = new URL(entry.filename, directory);
    const original = await readJson(path);

    const states = original.states.map((state) => {
      const abbreviation = codes.get(state.id) ?? state.abbreviation;

      assert.match(
        abbreviation,
        /^[A-Z]{2}$/,
        `${state.id} must use two uppercase letters.`
      );

      if (codes.has(state.id)) {
        encountered.add(state.id);
      }

      const reservedOwner = reserved.get(abbreviation);

      if (reservedOwner && reservedOwner !== state.id) {
        throw new Error(
          `${abbreviation} is reserved for ${reservedOwner}; ` +
          `cannot assign it to ${state.id}.`
        );
      }

      const previousOwner = proposed.get(abbreviation);

      if (previousOwner && previousOwner !== state.id) {
        throw new Error(
          `Duplicate hypothetical abbreviation ${abbreviation}: ` +
          `${previousOwner} and ${state.id}.`
        );
      }

      proposed.set(abbreviation, state.id);

      return {
        ...state,
        abbreviation,
      };
    });

    const revised = normalizePreset({
      ...original,
      states,
    }, dataset);

    const before = applyPresetPatch(
      dataset.model,
      original,
      dataset
    ).model;

    const after = applyPresetPatch(
      dataset.model,
      revised,
      dataset
    ).model;

    assert.deepEqual(after.assignments, before.assignments);

    assert.deepEqual(
      after.states.map(({ abbreviation, ...state }) => state),
      before.states.map(({ abbreviation, ...state }) => state)
    );

    assert.deepEqual(revised.geography, original.geography);
    assert.deepEqual(revised.moves, original.moves);
    assert.deepEqual(revised.removeStates, original.removeStates);

    updates.push({
      path,
      filename: entry.filename,
      revised,
      changes: states
        .filter((state, index) =>
          state.abbreviation !== original.states[index].abbreviation
        )
        .map((state) => ({
          name: state.name,
          from: original.states.find((item) => item.id === state.id)
            .abbreviation,
          to: state.abbreviation,
        })),
    });
  }

  for (const id of codes.keys()) {
    assert.ok(encountered.has(id), `Missing expected state: ${id}`);
  }

  for (const update of updates) {
    for (const change of update.changes) {
      console.log(
        `${update.filename}: ${change.name} ` +
        `${change.from} → ${change.to}`
      );
    }
  }

  if (!write) {
    console.log(
      "Read-only verification complete. Run with --write to save."
    );
    return;
  }

  // Every document has been normalized and checked before any write.
  for (const update of updates) {
    if (update.changes.length > 0) {
      await writeFile(
        update.path,
        serialize(update.revised),
        "utf8"
      );
    }
  }

  console.log("Abbreviation migration completed.");
  console.log("All state IDs and county assignments were preserved.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});