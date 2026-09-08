
/**
 * Capture Shift-click before D3's map-layer handlers.
 * Normal clicks and the browser context menu remain untouched.
 */

export function installMapSelectionGestures(mapElement, handlers) {
  if (
    !mapElement ||
    typeof mapElement.addEventListener !== "function"
  ) {
    throw new TypeError("A map element is required.");
  }

  if (
    !handlers ||
    typeof handlers.onCountyClick !== "function" ||
    typeof handlers.onStateClick !== "function"
  ) {
    throw new TypeError(
      "County and state click handlers are required."
    );
  }

  function resolveTarget(target) {
    if (!target || typeof target.closest !== "function") {
      return null;
    }

    const node = target.closest(
      "[data-county-id], [data-state-id]"
    );

    if (!node || !mapElement.contains(node)) {
      return null;
    }

    const countyId = node.getAttribute("data-county-id");

    if (countyId) {
      return {
        kind: "county",
        id: countyId,
      };
    }

    const stateId = node.getAttribute("data-state-id");

    return stateId
      ? { kind: "state", id: stateId }
      : null;
  }

  function onClick(event) {
    if (
      !event.shiftKey ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.button !== undefined && event.button !== 0)
    ) {
      return;
    }

    const target = resolveTarget(event.target);

    if (!target) {
      return;
    }

    // Prevent a second selection or a dropoff through D3's
    // ordinary click handler.
    event.preventDefault();
    event.stopImmediatePropagation();

    if (target.kind === "county") {
      handlers.onCountyClick(target.id, event);
    } else {
      handlers.onStateClick(target.id, event);
    }
  }

  mapElement.addEventListener("click", onClick, true);

  return Object.freeze({
    destroy() {
      mapElement.removeEventListener("click", onClick, true);
    },
  });
}