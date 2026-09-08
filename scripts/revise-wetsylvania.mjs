/**
 * One-time revision of the Wetsylvania JSON preset.
 *
 * This is a data migration, not a runtime preset factory.
 * It preserves the existing identity, geography fingerprint,
 * metadata, state definitions, and unrelated county operations.
 */

import assert from "node:assert/strict";

import {
  readFile,
  writeFile,
} from "node:fs/promises";

import {
  loadLegacyDataset,
} from "../js/data/legacy-datasets.mjs";

import {
  applyPresetPatch,
  normalizePreset,
} from "../js/presets/preset-model.mjs";

const root = new URL("../", import.meta.url);

const presetFile = new URL(
  "../data/presets/wetsylvania.json",
  import.meta.url
);

async function readJson(path) {
  return JSON.parse(
    await readFile(new URL(path, root), "utf8")
  );
}

function resolveCounties(dataset, stateCode, names) {
  const stateId = `state:${stateCode}`;

  return names.map((name) => {
    const matches = dataset.counties.filter(
      (county) =>
        county.originalStateId === stateId &&
        county.name.toLowerCase() === name.toLowerCase()
    );

    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one ${name}, ${stateCode}; ` +
        `found ${matches.length}.`
      );
    }

    return matches[0].id;
  });
}

async function main() {
  const dataset = await loadLegacyDataset(
    "2024",
    readJson
  );

  const original = await readJson(presetFile);

  assert.equal(original.id, "builtin:wetsylvania");
  assert.equal(original.moves.length, 95);

  const before = applyPresetPatch(
    dataset.model,
    original,
    dataset
  ).model;

  const moves = new Map(original.moves);
  const changes = new Map();

  function reassign(sourceState, names, destinationState) {
    const ids = resolveCounties(
      dataset,
      sourceState,
      names
    );

    for (const id of ids) {
      assert.equal(
        moves.get(id),
        "state:WV",
        `${id} was not previously assigned to Wetsylvania.`
      );

      const destinationId = `state:${destinationState}`;

      moves.set(id, destinationId);
      changes.set(id, destinationId);
    }
  }

  // Return these fourteen counties to Kentucky.
  reassign("KY", [
    "Whitley",
    "Knox",
    "Clay",
    "Laurel",
    "Rockcastle",
    "Jackson",
    "Owsley",
    "Lee",
    "Wolfe",
    "Menifee",
    "Montgomery",
    "Bath",
    "Rowan",
    "Morgan",
  ], "KY");

  // Transfer the eight named West Virginia counties to Virginia.
  reassign("WV", [
    "Jefferson",
    "Berkeley",
    "Morgan",
    "Hampshire",
    "Hardy",
    "Pendleton",
    "Grant",
    "Mineral",
  ], "VA");

  // Add Garrett County, Maryland, to Wetsylvania.
  const [garrett] = resolveCounties(
    dataset,
    "MD",
    ["Garrett"]
  );

  assert.equal(
    dataset.model.assignments[garrett],
    "state:MD"
  );

  assert.equal(
    moves.has(garrett),
    false,
    "Garrett is already explicitly assigned by the old preset."
  );

  moves.set(garrett, "state:WV");
  changes.set(garrett, "state:WV");

  assert.equal(changes.size, 23);
  assert.equal(moves.size, 96);

  const revised = normalizePreset({
    ...original,
    description:
      "A user-defined Appalachian arrangement. The original West " +
      "Virginia identity is renamed Wetsylvania. Eight northeastern " +
      "West Virginia counties—Jefferson, Berkeley, Morgan, Hampshire, " +
      "Hardy, Pendleton, Grant, and Mineral—are assigned to Virginia. " +
      "Wetsylvania retains the other 47 original West Virginia counties, " +
      "adds Allegheny, Westmoreland, Fayette, Greene, and Washington " +
      "counties from Pennsylvania, and Garrett County from Maryland. " +
      "Its Kentucky territory consists of Boyd, Carter, Elliott, " +
      "Greenup, Lawrence, Floyd, Johnson, Magoffin, Martin, Pike, " +
      "Breathitt, Knott, Leslie, Letcher, Perry, Harlan, and Bell. " +
      "The fourteen Kentucky counties removed by this revision are " +
      "explicitly returned to Kentucky. Wise, Norton independent city, " +
      "Dickenson, and Buchanan remain assigned from Virginia. " +
      "This is a user-defined modern-county arrangement, not an exact " +
      "historical boundary reconstruction.",
    moves: [...moves.entries()].sort(
      ([a], [b]) => a.localeCompare(b)
    ),
  }, dataset);

  const after = applyPresetPatch(
    dataset.model,
    revised,
    dataset
  ).model;

  // The revision must change exactly the requested twenty-three
  // assignments, with no other changes to the old resulting model.
  const expectedAssignments = {
    ...before.assignments,
  };

  for (const [id, destinationId] of changes) {
    expectedAssignments[id] = destinationId;
  }

  assert.deepEqual(
    after.assignments,
    expectedAssignments
  );

  assert.deepEqual(
    after.states,
    before.states
  );

  assert.equal(revised.moves.length, 96);
  assert.equal(revised.id, original.id);
  assert.deepEqual(revised.geography, original.geography);
  assert.deepEqual(revised.removeStates, original.removeStates);

  const state = after.states.find(
    (item) => item.id === "state:WV"
  );

  assert.equal(state.name, "Wetsylvania");
  assert.equal(state.abbreviation, "WET");

  // Write only after all validation succeeds.
  await writeFile(
    presetFile,
    JSON.stringify(revised, null, 2) + "\n",
    "utf8"
  );

  console.log("Revised data/presets/wetsylvania.json");
  console.log("14 Kentucky counties returned to Kentucky.");
  console.log("8 West Virginia counties assigned to Virginia.");
  console.log("Garrett County, Maryland, assigned to Wetsylvania.");
  console.log("96 explicit county operations verified.");
  console.log("No unrelated assignments or state definitions changed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});