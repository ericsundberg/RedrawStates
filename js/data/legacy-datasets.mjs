/**
 * Adapter for the inherited RedrawStates TopoJSON datasets.
 *
 * The original topology is never modified. Legacy vote buckets are
 * preserved without pretending they contain every individual candidate.
 * The 2016 Income dataset is explicitly separated from population data.
 */

import { createStateModel } from "../model/state-registry.mjs";
import { aggregateStates } from "../model/state-aggregation.mjs";
import { US_STATES } from "./us-states.mjs";
import {
  normalizeLegacyCountyId,
  resolveLegacyState,
} from "./legacy-geography.mjs";

const DATASET_ROWS = [
  ["2004", "2004", "data/us2004.json"],
  ["2008", "2008", "data/us2008.json"],
  ["2012", "2012", "data/us2012.json"],
  ["2016i", "2016 Income", "data/us2016income.json"],
  ["2016", "2016", "data/us.json"],
  ["2020", "2020", "data/us2020.json"],
  ["2020s", "2020 w/ New Populations", "data/us2020-new-pop.json"],
  ["2024", "2024", "data/us2024.json"],
];

export const LEGACY_DATASETS = Object.freeze(
  DATASET_ROWS.map(([id, label, filename]) =>
    Object.freeze({ id, label, filename })
  )
);

export const LEGACY_VOTE_FIELDS = Object.freeze([
  Object.freeze({ id: "dem", label: "Democrat", kind: "aggregate" }),
  Object.freeze({ id: "gop", label: "GOP", kind: "aggregate" }),
  Object.freeze({ id: "grn", label: "Green", kind: "aggregate" }),
  Object.freeze({ id: "lib", label: "Libertarian", kind: "aggregate" }),
  Object.freeze({ id: "una", label: "Unaffiliated", kind: "aggregate" }),
  Object.freeze({ id: "oth", label: "Other", kind: "aggregate" }),
]);

const VOTE_BUCKET_IDS = Object.freeze(
  LEGACY_VOTE_FIELDS.map((field) => field.id)
);

const POPULATION_MEASUREMENT = Object.freeze({
  id: "population",
  label: "Population",
  kind: "population",
  unit: "people",
  sourceField: "population",
  aggregation: "sum",
});

const INCOME_MEASUREMENT = Object.freeze({
  id: "incomeWeightDollars",
  label: "Estimated aggregate personal income",
  kind: "income-weight",
  unit: "2014 inflation-adjusted dollars",
  sourceField: "population",
  aggregation: "sum",
  sourceYear: 2014,
  sourcePeriod: "2010–2014 ACS five-year estimates",
  sourceTables: Object.freeze(["B19301", "B01003"]),
  description:
    "The original notebook multiplied per-capita income by the " +
    "corresponding population estimate. The resulting value is an " +
    "income-weight proxy, not a population count or a directly " +
    "observed aggregate-income total.",
});

export function getLegacyDataset(datasetId) {
  const definition = LEGACY_DATASETS.find(
    (dataset) => dataset.id === datasetId
  );

  if (!definition) {
    throw new Error(`Unknown legacy dataset: ${datasetId}`);
  }

  return definition;
}

function readNonNegative(value, label, integer = false) {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new TypeError(
      `${label} must be a nonnegative number or null.`
    );
  }

  return value;
}

function readArea(properties, primary, alternative, countyId) {
  const first = readNonNegative(
    properties[primary],
    `${countyId}.${primary}`
  );

  const second = readNonNegative(
    properties[alternative],
    `${countyId}.${alternative}`
  );

  if (first !== null && second !== null && first !== second) {
    throw new Error(
      `Conflicting area measurements for county ${countyId}.`
    );
  }

  return first ?? second;
}

function readLegacyVotes(properties, countyId) {
  const presentFields = VOTE_BUCKET_IDS.filter(
    (id) => Object.hasOwn(properties, id)
  );

  if (presentFields.length === 0) {
    return null;
  }

  const votes = {};

  for (const bucketId of VOTE_BUCKET_IDS) {
    if (!Object.hasOwn(properties, bucketId)) {
      // The inherited schema omits some zero-valued vote buckets.
      votes[bucketId] = 0;
      continue;
    }

    const value = readNonNegative(
      properties[bucketId],
      `${countyId}.${bucketId}`,
      true
    );

    if (value === null) {
      return null;
    }

    votes[bucketId] = value;
  }

  return Object.freeze(votes);
}

function makeMetadata(definition) {
  const isIncome = definition.id === "2016i";

  return Object.freeze({
    id: definition.id,
    label: definition.label,
    filename: definition.filename,
    schema: "redraw-legacy-v1",
    voteSchema: "aggregated-party-buckets",
    populationVintage: null,
    geographyVintage: null,
    areaVintage: null,
    source: "Inherited RedrawStates dataset",
    voteFields: LEGACY_VOTE_FIELDS,
    measurement: isIncome
      ? INCOME_MEASUREMENT
      : POPULATION_MEASUREMENT,
    populationAvailable: !isIncome,
    provenanceDocument: "docs/legacy-data.md",
  });
}

/**
 * Convert a legacy TopoJSON object into the immutable state model.
 *
 * Source-only geometries are preserved in the original topology and
 * recorded in diagnostics, but are not added to the usable county
 * inventory. No measurements are synthesized for them.
 */
export function convertLegacyTopology(
  topology,
  datasetId = "2024"
) {
  const definition = getLegacyDataset(datasetId);
  const geometries = topology?.objects?.counties?.geometries;

  if (!Array.isArray(geometries)) {
    throw new TypeError(
      "The dataset does not contain county geometries."
    );
  }

  const isIncome = datasetId === "2016i";
  const counties = [];
  const assignments = {};
  const geometriesById = new Map();
  const excludedGeometries = [];
  const repairedAssignments = [];
  const seenIds = new Set();

  for (const geometry of geometries) {
    const properties = geometry.properties ?? {};
    const geometryId = geometry.id ?? null;
    const propertyId = properties.id ?? null;

    if (geometryId === null && propertyId === null) {
      if (properties.state) {
        throw new Error(
          "A geometry with a state assignment is missing its county ID."
        );
      }

      excludedGeometries.push(
        Object.freeze({
          id: null,
          kind: "unidentified-geometry",
          reason: "No county identifier or supported state assignment",
        })
      );

      continue;
    }

    const countyId = normalizeLegacyCountyId(
      geometryId ?? propertyId
    );

    if (
      geometryId !== null &&
      propertyId !== null &&
      normalizeLegacyCountyId(geometryId) !==
        normalizeLegacyCountyId(propertyId)
    ) {
      throw new Error(
        `Conflicting geographic identifiers for county ${countyId}.`
      );
    }

    if (seenIds.has(countyId)) {
      throw new Error(`Duplicate county geometry: ${countyId}`);
    }

    seenIds.add(countyId);

    const resolution = resolveLegacyState({
      datasetId,
      countyId,
      stateCode: properties.state,
      properties,
    });

    if (resolution.exclusion) {
      excludedGeometries.push(resolution.exclusion);
      continue;
    }

    const { state, repair } = resolution;

    if (repair) {
      repairedAssignments.push(repair);
    }

    const name =
      typeof properties.name === "string" && properties.name.trim()
        ? properties.name.trim()
        : countyId;

    const rawMeasurement = readNonNegative(
      properties.population,
      `${countyId}.population`,
      true
    );

    const measures = isIncome
      ? { incomeWeightDollars: rawMeasurement }
      : {};

    const record = Object.freeze({
      id: countyId,
      name,
      originalStateId: state.id,
      population: isIncome ? null : rawMeasurement,
      landAreaM2: readArea(
        properties,
        "landAreaM2",
        "ALAND",
        countyId
      ),
      waterAreaM2: readArea(
        properties,
        "waterAreaM2",
        "AWATER",
        countyId
      ),
      votes: readLegacyVotes(properties, countyId),
      measures: Object.freeze(measures),
    });

    counties.push(record);
    assignments[countyId] = state.id;
    geometriesById.set(countyId, geometry);
  }

  const model = createStateModel({
    states: US_STATES,
    assignments,
  });

  const totals = aggregateStates(model, counties, {
    candidateIds: VOTE_BUCKET_IDS,
  });

  return Object.freeze({
    metadata: makeMetadata(definition),
    model,
    counties: Object.freeze(counties),
    candidateIds: VOTE_BUCKET_IDS,
    totals,
    topology,
    geometriesById,
    diagnostics: Object.freeze({
      sourceGeometryCount: geometries.length,
      excludedGeometries: Object.freeze(excludedGeometries),
      repairedAssignments: Object.freeze(repairedAssignments),
    }),
  });
}

/**
 * Load a dataset through an injectable JSON reader.
 */
export async function loadLegacyDataset(
  datasetId,
  readJson = async (filename) => {
    const response = await fetch(filename);

    if (!response.ok) {
      throw new Error(
        `Could not load ${filename}: HTTP ${response.status}`
      );
    }

    return response.json();
  }
) {
  const definition = getLegacyDataset(datasetId);
  const topology = await readJson(definition.filename);

  return convertLegacyTopology(topology, datasetId);
}