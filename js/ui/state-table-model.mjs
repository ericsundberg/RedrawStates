/**
 * State table column definitions, row values, and stable sorting.
 */

import { getIncomeWeights } from "../model/state-simulation.mjs";
import {
  AREA_UNITS,
  displayMetricValue,
} from "../map/map-metrics.mjs";

const integerFormat = new Intl.NumberFormat("en-US");
const decimalFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const percentFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatNumber(value, decimals = false) {
  if (value == null || !Number.isFinite(value)) return "—";

  return decimals
    ? decimalFormat.format(value)
    : integerFormat.format(value);
}

export function buildStateTableRows(snapshot, dataset, allocation) {
  const totals = new Map(
    snapshot.totals.map((total) => [total.stateId, total])
  );

  const incomeWeights =
    dataset.metadata.measurement.kind === "income-weight"
      ? getIncomeWeights(snapshot, dataset)
      : null;

  return snapshot.model.states.map((state, index) => ({
    index,
    state,
    total: totals.get(state.id),
    electors: allocation.byState.get(state.id) ?? null,
    incomeWeight: incomeWeights?.get(state.id) ?? null,
  }));
}

export function buildStateTableColumns(
  dataset,
  { areaUnit = "km2", voteFormat = "count" } = {}
) {
  const units = AREA_UNITS[areaUnit] ?? AREA_UNITS.km2;
  const incomeMode =
    dataset.metadata.measurement.kind === "income-weight";

  const columns = [
    {
      id: "state",
      label: "State",
      type: "text",
      value: (row) => row.state.abbreviation,
      format: (value) => value,
    },
    {
      id: "counties",
      label: "Counties",
      type: "number",
      value: (row) => row.total.countyCount,
    },
    {
      id: "population",
      label: incomeMode ? "Income weight" : "Population",
      type: "number",
      value: (row) => incomeMode
        ? row.incomeWeight
        : row.total.population,
    },
    {
      id: "electors",
      label: "Electors",
      type: "number",
      value: (row) => row.electors,
    },
    {
      id: "land",
      label: `Land ${units.areaLabel}`,
      type: "number",
      decimals: true,
      value: (row) =>
        displayMetricValue(row.total.landAreaM2, "land", areaUnit),
    },
    {
      id: "area",
      label: `Total ${units.areaLabel}`,
      type: "number",
      decimals: true,
      value: (row) =>
        displayMetricValue(row.total.totalAreaM2, "area", areaUnit),
    },
    {
      id: "density",
      label: units.densityLabel,
      type: "number",
      decimals: true,
      value: (row) =>
        displayMetricValue(row.total.densityPerKm2, "density", areaUnit),
    },
  ];

  for (const field of dataset.metadata.voteFields) {
    columns.push({
      id: `votes:${field.id}`,
      label: field.label,
      type: "number",
      decimals: voteFormat === "share",

      value(row) {
        const votes = row.total.votes;
        const count = votes?.[field.id];

        if (count == null) return null;

        if (voteFormat !== "share") return count;

        const totalVotes = Object.values(votes).reduce(
          (sum, value) => sum + value,
          0
        );

        return totalVotes > 0 ? count / totalVotes : null;
      },

      format(value) {
        return voteFormat === "share"
          ? value == null ? "—" : percentFormat.format(value)
          : formatNumber(value);
      },
    });
  }

  return columns;
}

export function sortStateTableRows(
  rows,
  column,
  direction = "asc"
) {
  const multiplier = direction === "desc" ? -1 : 1;

  return [...rows].sort((a, b) => {
    const left = column.value(a);
    const right = column.value(b);

    const leftMissing = left == null || (
      typeof left === "number" && !Number.isFinite(left)
    );

    const rightMissing = right == null || (
      typeof right === "number" && !Number.isFinite(right)
    );

    if (leftMissing && rightMissing) return a.index - b.index;
    if (leftMissing) return 1;
    if (rightMissing) return -1;

    const comparison = column.type === "text"
      ? String(left).localeCompare(String(right))
      : left - right;

    return comparison * multiplier || a.index - b.index;
  });
}

export function formatStateTableValue(column, value) {
  if (column.format) return column.format(value);

  return formatNumber(value, column.decimals);
}