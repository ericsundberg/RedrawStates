/**
 * Load and validate authoritative area overlays.
 */

import { loadLegacyDataset } from "./legacy-datasets.mjs";
import { aggregateStates } from "../model/state-aggregation.mjs";

const AREA_DATASETS = new Set(["2020", "2020s", "2024"]);
const AREA_FILE = "data/areas/2019.json";

async function readJson(filename) {
  const response = await fetch(filename);

  if (!response.ok) {
    const error = new Error(
      `Could not load ${filename}: HTTP ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function unavailableDataset(dataset, status, reason) {
  return Object.freeze({
    ...dataset,
    metadata: Object.freeze({
      ...dataset.metadata,
      area: Object.freeze({ status, reason }),
    }),
  });
}

function validateArea(value, countyId) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((number) =>
      Number.isSafeInteger(number) && number >= 0
    )
  ) {
    throw new TypeError(`Invalid area measurements for ${countyId}.`);
  }

  return value;
}

export function applyAreaOverlay(dataset, overlay) {
  if (
    overlay?.schema !== "redraw-area-v1" ||
    overlay.geographyVintage !== 2019 ||
    !Array.isArray(overlay.datasetIds) ||
    !overlay.datasetIds.includes(dataset.metadata.id) ||
    !overlay.areas ||
    typeof overlay.areas !== "object" ||
    Array.isArray(overlay.areas)
  ) {
    throw new Error("The area overlay is incompatible with this dataset.");
  }

  const expected = new Set(dataset.counties.map((county) => county.id));
  const actual = new Set(Object.keys(overlay.areas));

  const missing = [...expected].filter((id) => !actual.has(id));
  const extra = [...actual].filter((id) => !expected.has(id));

  if (missing.length || extra.length) {
    throw new Error(
      `Area inventory mismatch. Missing: ${missing.join(", ") || "none"}; ` +
      `extra: ${extra.join(", ") || "none"}.`
    );
  }

  const counties = dataset.counties.map((county) => {
    const [landAreaM2, waterAreaM2] = validateArea(
      overlay.areas[county.id],
      county.id
    );

    return Object.freeze({
      ...county,
      landAreaM2,
      waterAreaM2,
      totalAreaM2: landAreaM2 + waterAreaM2,
      areaVintage: 2019,
    });
  });

  const totals = aggregateStates(dataset.model, counties, {
    candidateIds: dataset.candidateIds,
  });

  return Object.freeze({
    ...dataset,
    counties: Object.freeze(counties),
    totals,
    metadata: Object.freeze({
      ...dataset.metadata,
      areaVintage: 2019,
      area: Object.freeze({
        status: "available",
        source: overlay.source,
        coverage: overlay.coverage,
      }),
    }),
  });
}

export async function loadDatasetWithAreas(
  datasetId,
  reader = readJson
) {
  const dataset = await loadLegacyDataset(datasetId, reader);

  if (!AREA_DATASETS.has(datasetId)) {
    return unavailableDataset(
      dataset,
      "not-supported",
      "A vintage-matched area overlay has not yet been prepared."
    );
  }

  let overlay;

  try {
    overlay = await reader(AREA_FILE);
  } catch (error) {
    if (error.status === 404) {
      return unavailableDataset(
        dataset,
        "missing",
        "The 2019 area overlay has not been built or deployed."
      );
    }

    throw error;
  }

  return applyAreaOverlay(dataset, overlay);
}