/**
 * Numeric metric extraction, formatting, and color scales.
 */

import { interpolateHex } from "./map-color-scale.mjs";

export const MISSING_COLOR = "#dfe3e8";

export const AREA_UNITS = Object.freeze({
  km2: Object.freeze({
    areaDivisor: 1_000_000,
    densityMultiplier: 1,
    areaLabel: "km²",
    densityLabel: "people / km²",
  }),
  sqmi: Object.freeze({
    areaDivisor: 2_589_988.110336,
    densityMultiplier: 2.589988110336,
    areaLabel: "sq mi",
    densityLabel: "people / sq mi",
  }),
});

export function metricValue(record, metric) {
  if (!record) return null;

  if (metric === "population") {
    return record.population ?? null;
  }

  if (metric === "land") {
    return record.landAreaM2 ?? null;
  }

  if (metric === "area") {
    if (record.totalAreaM2 !== undefined) {
      return record.totalAreaM2;
    }

    return record.landAreaM2 != null &&
      record.waterAreaM2 != null
      ? record.landAreaM2 + record.waterAreaM2
      : null;
  }

  if (metric === "density") {
    if (record.densityPerKm2 !== undefined) {
      return record.densityPerKm2;
    }

    return record.population != null &&
      record.landAreaM2 != null &&
      record.landAreaM2 > 0
      ? record.population / (record.landAreaM2 / 1_000_000)
      : null;
  }

  return null;
}

export function displayMetricValue(value, metric, unit = "km2") {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  const units = AREA_UNITS[unit] ?? AREA_UNITS.km2;

  if (metric === "land" || metric === "area") {
    return value / units.areaDivisor;
  }

  if (metric === "density") {
    return value * units.densityMultiplier;
  }

  return value;
}

export function createNumericScale(values, { mode = "linear" } = {}) {
  const valid = values.filter(
    (value) => Number.isFinite(value) && value >= 0
  );

  const maximum = valid.length ? Math.max(...valid) : 0;

  function fraction(value) {
    if (!Number.isFinite(value) || value < 0 || maximum === 0) {
      return 0;
    }

    const bounded = Math.min(value, maximum);

    return mode === "log"
      ? Math.log1p(bounded) / Math.log1p(maximum)
      : bounded / maximum;
  }

  return Object.freeze({
    maximum,
    available: valid.length > 0,
    mode,
    fraction,

    color(value, endpoint = "#2166ac") {
      if (!Number.isFinite(value) || value < 0) {
        return MISSING_COLOR;
      }

      return interpolateHex("#ffffff", endpoint, fraction(value));
    },
  });
}