#!/usr/bin/env node

/**
 * Read-only audit of the inherited TopoJSON datasets.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

import {
  LEGACY_DATASETS,
  convertLegacyTopology,
  getLegacyDataset,
} from "../js/data/legacy-datasets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function countMissing(counties, field) {
  return counties.filter(
    (county) => county[field] === null
  ).length;
}

function completeSum(values, label) {
  if (values.some((value) => value === null)) {
    return null;
  }

  return values.reduce((sum, value) => {
    const next = sum + value;

    if (!Number.isSafeInteger(next)) {
      throw new RangeError(`${label} exceeds the safe integer range.`);
    }

    return next;
  }, 0);
}

function summarizeMeasurement(dataset) {
  const measurement = dataset.metadata.measurement;

  if (measurement.kind === "income-weight") {
    return {
      measurement: measurement.id,
      measurementTotal: completeSum(
        dataset.counties.map(
          (county) => county.measures.incomeWeightDollars
        ),
        "Income weight"
      ),
    };
  }

  return {
    measurement: "population",
    measurementTotal: completeSum(
      dataset.counties.map((county) => county.population),
      "Population"
    ),
  };
}

async function auditDataset(definition) {
  const filename = resolve(root, definition.filename);
  const topology = JSON.parse(await readFile(filename, "utf-8"));

  const dataset = convertLegacyTopology(topology, definition.id);
  const diagnostics = dataset.diagnostics;

  const report = {
    dataset: definition.id,
    sourceGeometries: diagnostics.sourceGeometryCount,
    usableCounties: dataset.counties.length,
    states: dataset.model.states.length,
    excluded: diagnostics.excludedGeometries.length,
    repaired: diagnostics.repairedAssignments.length,
    ...summarizeMeasurement(dataset),
    missingPopulation: countMissing(dataset.counties, "population"),
    missingLandArea: countMissing(dataset.counties, "landAreaM2"),
    missingWaterArea: countMissing(dataset.counties, "waterAreaM2"),
    missingVotes: countMissing(dataset.counties, "votes"),
  };

  console.table([report]);

  if (diagnostics.excludedGeometries.length > 0) {
    console.log("Preserved source-only or unsupported geometries:");
    console.table(diagnostics.excludedGeometries);
  }

  if (diagnostics.repairedAssignments.length > 0) {
    console.log("Documented assignment repairs:");
    console.table(diagnostics.repairedAssignments);
  }

  return dataset;
}

async function main() {
  const requestedIds = process.argv.slice(2);

  const definitions = requestedIds.length > 0
    ? requestedIds.map(getLegacyDataset)
    : LEGACY_DATASETS;

  let failed = false;

  for (const definition of definitions) {
    console.log(`\n=== ${definition.label} ===`);

    try {
      await auditDataset(definition);
    } catch (error) {
      failed = true;
      console.error(`${definition.id}: ${error.message}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

await main();