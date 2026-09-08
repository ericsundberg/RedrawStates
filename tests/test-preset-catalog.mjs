import test from "node:test";
import assert from "node:assert/strict";

import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  loadLegacyDataset,
} from "../js/data/legacy-datasets.mjs";

import {
  createStateSession,
} from "../js/model/state-session.mjs";

import {
  applyPresetPatch,
  createPresetBundle,
  createPresetPlan,
  normalizePreset,
  presetGeography,
  readPresetDocument,
} from "../js/presets/preset-model.mjs";

import {
  loadPresetCatalog,
  validatePresetCatalog,
} from "../js/presets/preset-catalog.mjs";

const ROOT = new URL("../", import.meta.url);
const MANIFEST = new URL(
  "../data/presets/index.json",
  import.meta.url
);

/**
 * Node filesystem reader for the universal catalog.
 *
 * new URL() accepts a relative repository path, an absolute file URL,
 * or a URL object. readFile receives a URL object rather than a
 * literal "file:///..." filename.
 */
async function readJson(path) {
  const url = new URL(path, ROOT);

  return JSON.parse(
    await readFile(url, "utf8")
  );
}

let sharedFixture = null;

async function fixture() {
  if (!sharedFixture) {
    sharedFixture = (async () => {
      const dataset = await loadLegacyDataset(
        "2024",
        readJson
      );

      const manifest = await readJson(MANIFEST);

      const presets = await loadPresetCatalog(
        dataset,
        readJson,
        MANIFEST.href
      );

      return { dataset, manifest, presets };
    })();
  }

  return sharedFixture;
}

function byId(presets, id) {
  const preset = presets.find((item) => item.id === id);

  assert.ok(preset, `Missing preset: ${id}`);

  return preset;
}

test("the manifest references unique standalone JSON files", async () => {
  const manifest = await readJson(MANIFEST);
  const entries = validatePresetCatalog(manifest);

  assert.ok(entries.length > 0);

  for (const entry of entries) {
    const raw = await readJson(
      new URL(entry.filename, MANIFEST)
    );

    assert.equal(raw.id, entry.id);
    assert.equal(raw.format, "redraw-states-preset");
    assert.equal(raw.version, 1);
    assert.ok(Array.isArray(raw.states));
    assert.ok(Array.isArray(raw.moves));
    assert.ok(Array.isArray(raw.removeStates));
  }
});

test("the manifest rejects duplicate entries and path traversal", () => {
  const base = {
    format: "redraw-states-preset-catalog",
    version: 1,
    presets: [{
      id: "builtin:example",
      filename: "example.json",
    }],
  };

  assert.throws(
    () => validatePresetCatalog({
      ...base,
      presets: [
        base.presets[0],
        base.presets[0],
      ],
    }),
    /Duplicate catalog ID/
  );

  assert.throws(
    () => validatePresetCatalog({
      ...base,
      presets: [{
        id: "builtin:example",
        filename: "../example.json",
      }],
    }),
    /Invalid catalog filename/
  );
});

test("the universal reader loads every manifest entry in order", async () => {
  const { manifest, presets } = await fixture();
  const entries = validatePresetCatalog(manifest);

  assert.equal(presets.length, entries.length);

  assert.deepEqual(
    presets.map((preset) => preset.id),
    entries.map((entry) => entry.id)
  );
});

test("every JSON preset round-trips through the universal schema", async () => {
  const { dataset, presets } = await fixture();

  for (const preset of presets) {
    const serialized = JSON.parse(
      JSON.stringify(preset)
    );

    assert.deepEqual(
      normalizePreset(serialized, dataset),
      preset,
      preset.id
    );

    assert.deepEqual(
      preset.geography,
      presetGeography(dataset)
    );
  }
});

test("every preset is independently valid and sparse", async () => {
  const { dataset, presets } = await fixture();

  const originalAssignments = dataset.model.assignments;
  const originalIds = Object.keys(originalAssignments).sort();

  for (const preset of presets) {
    const touched = new Set(
      preset.moves.map(([countyId]) => countyId)
    );

    assert.equal(
      touched.size,
      preset.moves.length,
      `${preset.id} contains duplicate county movements.`
    );

    const result = applyPresetPatch(
      dataset.model,
      preset,
      dataset
    ).model;

    assert.deepEqual(
      Object.keys(result.assignments).sort(),
      originalIds,
      `${preset.id} changed the county inventory.`
    );

    for (const [countyId, originalState] of Object.entries(
      originalAssignments
    )) {
      if (!touched.has(countyId)) {
        assert.equal(
          result.assignments[countyId],
          originalState,
          `${preset.id} changed unrelated county ${countyId}.`
        );
      }
    }
  }
});

test("a downloaded bundle preserves the manifest's priority order", async () => {
  const { dataset, presets } = await fixture();

  const bundle = createPresetBundle(
    presets,
    {
      id: "local:catalog-test",
      name: "Catalog test",
      description: "Round-trip test.",
    }
  );

  const imported = readPresetDocument(
    JSON.parse(JSON.stringify(bundle)),
    dataset
  );

  assert.deepEqual(
    imported.map((preset) => preset.id),
    presets.map((preset) => preset.id)
  );
});

test("all manifest presets compose without mutating source data", async () => {
  const { dataset, presets } = await fixture();
  const session = createStateSession(dataset);

  const originalModel = dataset.model;
  const originalCounty = dataset.counties[0];
  const originalSnapshot = session.getSnapshot();

  const plan = createPresetPlan(
    dataset,
    originalSnapshot,
    presets,
    { base: "original" }
  );

  assert.equal(plan.applied.length, presets.length);

  assert.deepEqual(
    Object.keys(plan.model.assignments).sort(),
    Object.keys(originalModel.assignments).sort()
  );

  assert.equal(dataset.model, originalModel);
  assert.equal(dataset.counties[0], originalCounty);
  assert.equal(session.getSnapshot(), originalSnapshot);
});

test("a higher-priority California layer wins its county assignments", async () => {
  const { dataset, presets } = await fixture();

  const six = byId(
    presets,
    "builtin:six-californias"
  );

  const cal3 = byId(
    presets,
    "builtin:cal3-2018"
  );

  const session = createStateSession(dataset);

  const plan = createPresetPlan(
    dataset,
    session.getSnapshot(),
    [cal3, six],
    { base: "original" }
  );

  assert.deepEqual(
    plan.applied.map((item) => item.name),
    [six.name, cal3.name]
  );

  assert.equal(plan.conflicts.length, 58);

  for (const [countyId, destinationId] of cal3.moves) {
    assert.equal(
      plan.model.assignments[countyId],
      destinationId
    );
  }
});

test("an incompatible geographic schema is rejected", async () => {
  const { dataset, presets } = await fixture();

  const incompatible = {
    ...dataset,
    metadata: {
      ...dataset.metadata,
      schema: "different-geography",
    },
  };

  assert.throws(
    () => normalizePreset(presets[0], incompatible),
    /incompatible/
  );
});

test("the static builder packages every manifest JSON file", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "redraw-presets-")
  );

  try {
    const output = join(temporary, "site");

    const result = spawnSync(
      "python3",
      ["scripts/build-site.py", "--output", output],
      {
        cwd: fileURLToPath(ROOT),
        encoding: "utf8",
      }
    );

    assert.equal(
      result.status,
      0,
      result.stderr || result.stdout
    );

    const manifest = await readJson(MANIFEST);

    for (const entry of manifest.presets) {
      const deployed = join(
        output,
        "data",
        "presets",
        entry.filename
      );

      assert.ok((await stat(deployed)).isFile());

      assert.deepEqual(
        await readJson(deployed),
        await readJson(
          new URL(entry.filename, MANIFEST)
        )
      );
    }
  } finally {
    await rm(temporary, {
      recursive: true,
      force: true,
    });
  }
});