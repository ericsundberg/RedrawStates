import {
  computeAllocation,
  summarizeAllocation,
} from "../model/state-simulation.mjs";

export function computeTerritoryAllocation(snapshot, dataset) {
  if (dataset.metadata.measurement.kind !== "income-weight") {
    return computeAllocation(snapshot, dataset);
  }

  const includedDataset = {
    ...dataset,
    counties: dataset.counties.filter(
      (county) => !Object.hasOwn(snapshot.excluded ?? {}, county.id)
    ),
  };

  return computeAllocation(snapshot, includedDataset);
}

export { summarizeAllocation };