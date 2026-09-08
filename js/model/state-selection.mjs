
/**
 * Toggle the current modeled state or excluded-territory group.
 * A fully selected group is removed; otherwise all missing members
 * are added. Unrelated selections remain unchanged.
 */

import {
  selectCurrentState,
} from "./territory-workspace.mjs";

export function toggleCurrentStateSelection(
  workspace,
  countyId,
  selectedCountyIds = []
) {
  const group = selectCurrentState(workspace, countyId);

  const combined = selectCurrentState(
    workspace,
    countyId,
    selectedCountyIds
  );

  const selected = new Set(selectedCountyIds);

  if (!group.every((id) => selected.has(id))) {
    return combined;
  }

  const groupIds = new Set(group);

  return [...selected]
    .filter((id) => !groupIds.has(id))
    .sort();
}