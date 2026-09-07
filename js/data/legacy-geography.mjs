/**
 * Geographic identity and compatibility rules for inherited datasets.
 *
 * Source-only shells remain in the original topology, but they are not
 * treated as usable counties. No population, votes, area, or assignments
 * are manufactured to make a dataset pass validation.
 */

import {
  STATES_BY_ABBREVIATION,
  STATES_BY_FIPS,
} from "./us-states.mjs";

const SOURCE_ONLY_GEOMETRIES = new Map([
  [
    "2016i",
    new Map([
      [
        "15005",
        Object.freeze({
          name: "Kalawao County, Hawaii",
          reason:
            "The inherited income dataset contains an empty geometry " +
            "with no state assignment or measurements. It is retained " +
            "in the source topology pending a complete geography rebuild.",
        }),
      ],
      [
        "51515",
        Object.freeze({
          name: "Former Bedford independent city, Virginia",
          reason:
            "The inherited income dataset contains an empty geometry " +
            "for the former independent city. Bedford became a town " +
            "within Bedford County in 2013. No measurements are " +
            "transferred or invented.",
        }),
      ],
    ]),
  ],
]);

export function normalizeLegacyCountyId(rawId) {
  if (typeof rawId === "number") {
    if (!Number.isSafeInteger(rawId) || rawId < 0) {
      throw new TypeError(`Invalid county ID: ${rawId}`);
    }

    rawId = String(rawId);
  }

  if (
    typeof rawId !== "string" ||
    !/^\d{1,5}$/.test(rawId)
  ) {
    throw new TypeError(`Invalid county ID: ${String(rawId)}`);
  }

  return rawId.padStart(5, "0");
}

/**
 * Resolve a source geometry into either a usable state assignment
 * or a documented exclusion.
 *
 * Recognized county identifiers with missing assignments are errors
 * unless they match a verified, empty source-only shell.
 */
export function resolveLegacyState({
  datasetId,
  countyId,
  stateCode,
  properties = {},
}) {
  if (
    stateCode !== null &&
    stateCode !== undefined &&
    stateCode !== ""
  ) {
    const state = STATES_BY_ABBREVIATION.get(stateCode);

    if (!state) {
      throw new Error(`Unsupported state code: ${stateCode}`);
    }

    if (state.fips !== countyId.slice(0, 2)) {
      throw new Error(
        `County ${countyId} has a state code that disagrees ` +
        `with its geographic identifier.`
      );
    }

    return {
      state,
      repair: null,
      exclusion: null,
    };
  }

  const sourceOnly = SOURCE_ONLY_GEOMETRIES
    .get(datasetId)
    ?.get(countyId);

  if (sourceOnly && Object.keys(properties).length === 0) {
    return {
      state: null,
      repair: null,
      exclusion: Object.freeze({
        id: countyId,
        name: sourceOnly.name,
        kind: "source-only-empty-geometry",
        reason: sourceOnly.reason,
      }),
    };
  }

  if (STATES_BY_FIPS.has(countyId.slice(0, 2))) {
    throw new Error(
      `County ${countyId} is missing its state assignment.`
    );
  }

  return {
    state: null,
    repair: null,
    exclusion: Object.freeze({
      id: countyId,
      kind: "unsupported-unassigned-geometry",
      reason: "No supported state assignment",
    }),
  };
}