/**
 * Browser-only JSON import and download helpers.
 */

import { readPresetDocument } from "./preset-model.mjs";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export function presetFilename(name) {
  const slug = String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);

  return `${slug || "redraw-preset"}.redraw.json`;
}

export function downloadPresetJson(value, filename) {
  const blob = new Blob(
    [JSON.stringify(value, null, 2) + "\n"],
    { type: "application/json;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Allow the browser time to begin the download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function readPresetFiles(files, dataset) {
  const selected = Array.from(files);

  if (selected.length === 0) {
    return [];
  }

  let totalBytes = 0;

  for (const file of selected) {
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > MAX_FILE_BYTES
    ) {
      throw new Error(
        `${file.name} exceeds the 2 MB per-file limit.`
      );
    }

    totalBytes += file.size;
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error("The selected files exceed the 8 MB import limit.");
  }

  const imported = [];

  for (const file of selected) {
    let raw;

    try {
      raw = JSON.parse(await file.text());
    } catch (error) {
      throw new Error(
        `${file.name} is not valid JSON: ${error.message}`
      );
    }

    try {
      imported.push(
        ...readPresetDocument(raw, dataset)
      );
    } catch (error) {
      throw new Error(
        `${file.name}: ${error.message}`
      );
    }
  }

  // Return only after the entire batch has been validated.
  return imported;
}