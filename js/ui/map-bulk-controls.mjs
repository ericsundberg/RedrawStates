
/**
 * Quick state-boundary and selection controls.
 * The host owns the session, selection, and status messages.
 */

export function mountMapBulkControls({
  container,
  getContext,
  onSelectState,
  onClearSelection,
  onDissolved,
  onStatus,
  mapElement = document.getElementById("states-svg"),
}) {
  if (!container || typeof getContext !== "function") {
    throw new TypeError(
      "A map controls container and context are required."
    );
  }

  if (
    !mapElement ||
    typeof mapElement.addEventListener !== "function"
  ) {
    throw new TypeError("A map element is required.");
  }

  const section = document.createElement("section");
  section.className = "map-bulk-controls";

  const heading = document.createElement("h3");
  heading.textContent = "Quick actions";

  const description = document.createElement("p");
  description.textContent =
    "Shift-click to select a current state. Right-click to clear the selection.";

  const actions = document.createElement("div");
  actions.className = "map-bulk-actions";

  function makeButton(label, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-default";
    button.textContent = label;
    button.title = title;
    return button;
  }

  const selectButton = makeButton(
    "Select current state",
    "Select all counties in the last selected county's current state."
  );

  const clearButton = makeButton(
    "Clear selection",
    "Clear all selected counties."
  );

  const dissolveButton = makeButton(
    "Dissolve all states",
    "Merge included states into United State of America (US)."
  );

  dissolveButton.classList.add("btn-warning");

  const count = document.createElement("p");
  count.className = "map-bulk-selection-count";
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");

  actions.append(selectButton, clearButton, dissolveButton);
  section.append(heading, description, actions, count);
  container.append(section);

  let busy = false;
  let destroyed = false;

  function context() {
    return getContext() ?? {};
  }

  function isReady(current) {
    return !destroyed &&
      !busy &&
      !current.loading &&
      Boolean(current.manager);
  }

  function refresh() {
    if (destroyed) return;

    const current = context();
    const ready = isReady(current);

    selectButton.disabled =
      !ready || !current.anchorCountyId;

    clearButton.disabled =
      !ready || current.selectedCount === 0;

    dissolveButton.disabled = !ready;

    count.textContent =
      `${current.selectedCount ?? 0} counties selected`;
  }

  function clearSelection() {
    const current = context();

    if (!isReady(current) || current.selectedCount === 0) {
      return false;
    }

    onClearSelection();
    refresh();
    return true;
  }

  selectButton.addEventListener("click", () => {
    const current = context();

    if (
      !isReady(current) ||
      !current.anchorCountyId
    ) {
      return;
    }

    try {
      onSelectState(current.anchorCountyId);
      refresh();
    } catch (error) {
      onStatus(error.message);
    }
  });

  clearButton.addEventListener("click", () => {
    clearSelection();
  });

  function handleMapContextMenu(event) {
    const current = context();

    // Preserve the browser menu when there is nothing to clear.
    if (
      !isReady(current) ||
      current.selectedCount === 0
    ) {
      return;
    }

    event.preventDefault();
    clearSelection();
  }

  mapElement.addEventListener(
    "contextmenu",
    handleMapContextMenu
  );

  dissolveButton.addEventListener("click", () => {
    const current = context();

    if (!isReady(current)) return;

    try {
      const plan = current.manager.previewDissolveAll();

      if (plan.nextModel === plan.model) {
        onStatus(
          "The map is already one United State of America."
        );
        return;
      }

      const approved = window.confirm(
        `Dissolve ${plan.sourceStateCount} states into ` +
        "United State of America (US)?\n\n" +
        `${plan.countyCount.toLocaleString()} counties will be assigned ` +
        "to the merged state. This changes the current configuration, " +
        "not the source data. You can restore the original boundaries."
      );

      if (!approved) return;

      const snapshot = current.manager.dissolveAll(plan);
      onDissolved(snapshot, plan);
    } catch (error) {
      onStatus(error.message);
    }
  });

  refresh();

  return Object.freeze({
    refresh,

    setBusy(value) {
      busy = Boolean(value);
      refresh();
    },

    destroy() {
      destroyed = true;

      mapElement.removeEventListener(
        "contextmenu",
        handleMapContextMenu
      );

      section.remove();
    },
  });
}