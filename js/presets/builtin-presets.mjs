/**
 * Complete built-in preset catalog.
 */

import { createCorePresets } from "./core-presets.mjs";
import { createHistoricalPresets } from "./historical-presets.mjs";
import { createRegionalPresets } from "./regional-presets.mjs";

export { createCorePresets };

export function createBuiltinPresets(dataset) {
  return [
    ...createCorePresets(dataset),
    ...createHistoricalPresets(dataset),
    ...createRegionalPresets(dataset),
  ];
}