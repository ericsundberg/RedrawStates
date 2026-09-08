import {
  createTerritoryDocument,
  readTerritoryDocument,
} from "../model/territory-workspace.mjs";

export function downloadTerritoryWorkspace(dataset, workspace) {
  const payload = {
    ...createTerritoryDocument(workspace),
    sourceDataset: dataset.metadata.id,
  };

  const blob = new Blob(
    [JSON.stringify(payload, null, 2) + "\n"],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download =
    `redraw-states-${dataset.metadata.id}-scenario.json`;

  document.body.append(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export async function readTerritoryFile(file, dataset) {
  if (!file || typeof file.text !== "function") {
    throw new TypeError("Select a JSON scenario file.");
  }

  if (file.size > 5_000_000) {
    throw new Error("The scenario file exceeds the 5 MB limit.");
  }

  let raw;

  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  return readTerritoryDocument(raw, dataset.model);
}