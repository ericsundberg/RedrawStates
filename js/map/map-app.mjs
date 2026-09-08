/**
 * Main application controller.
 */

import {
  getLegacyDataset,
} from "../data/legacy-datasets.mjs";

import {
  loadDatasetWithAreas,
} from "../data/area-overlay.mjs";

import { createStateSession } from "../model/state-session.mjs";
import { createStateManager } from "../model/state-management.mjs";

import {
  computeTerritoryAllocation,
  summarizeAllocation,
} from "./territory-allocation.mjs";

import {
  DEFAULT_VOTE_DISPLAY,
  normalizeVoteDisplay,
} from "./map-visualization.mjs";

import { createMapView } from "./map-territory-view.mjs";

import {
  createTerritoryShareUrl,
  restoreTerritoryShare,
} from "./territory-share.mjs";

import {
  createTerritoryDocument,
  readTerritoryDocument,
} from "../model/territory-workspace.mjs";

import { mountTerritoryControls } from "../ui/territory-controls.mjs";

import {
  downloadTerritoryWorkspace,
  readTerritoryFile,
} from "../ui/territory-files.mjs";

import { mountMapDetails } from "../ui/map-details.mjs";
import { mountMapBulkControls } from "../ui/map-bulk-controls.mjs";

import {
  mountStateManagementDialog,
} from "../ui/state-management-dialog.mjs";

import {
  mountPresetLibrary,
} from "../ui/preset-library.mjs";

export function startMapApp() {
  const datasetCache = new Map();

  let dataset = null;
  let session = null;
  let stateManager = null;
  let selected = new Set();
  let selectionAnchor = null;
  let capturedShiftClick = false;
  let mode = "pickup";
  let metric = "votes";
  let level = "counties";
  let voteDisplay = { ...DEFAULT_VOTE_DISPLAY };
  let loading = false;
  let requestNumber = 0;
  let holdKey = null;

  const yearSelect = document.getElementById("selectYear");
  const moveButton = document.getElementById("switchModeButton");
  const countyButton = document.getElementById("countyModeButton");

  const summaryElement = document.querySelector(".map-summary");
  summaryElement.querySelector(".ev-bar")?.remove();

  const allocationBar = document.createElement("div");
  allocationBar.id = "allocation-bar";
  allocationBar.setAttribute("role", "group");
  allocationBar.setAttribute(
    "aria-label",
    "Hypothetical electoral allocation"
  );

  const allocationLegend = document.createElement("div");
  allocationLegend.id = "allocation-legend";

  summaryElement.append(allocationBar, allocationLegend);

  const ui = mountMapDetails({
    setMetric(value) {
      metric = value;
      render();
    },

    setLevel(value) {
      setLevel(value);
    },

    setVoteDisplay(changes) {
      voteDisplay = normalizeVoteDisplay(
        { ...voteDisplay, ...changes },
        dataset?.metadata.voteFields ?? []
      );

      render();
    },

    moveSelected(destination) {
      moveSelected(destination);
    },

    createState(name, abbreviation) {
      if (!stateManager || loading) return;

      try {
        const result = stateManager.create({ name, abbreviation });

        finishStateChange({
          type: "create",
          stateId: result.state.id,
          message:
            `Created ${result.state.name}. ` +
            "Select counties to move into it.",
        });
      } catch (error) {
        ui.setStatus(error.message);
      }
    },

    reset() {
      if (!session || loading) return;

      session.reset();
      selected.clear();
      selectionAnchor = null;
      setMode("pickup");
      clearSharedAddress();
      render();
      ui.setStatus("Original boundaries restored.");
    },
  });

  const managerView = mountStateManagementDialog({
    getManager() {
      return loading ? null : stateManager;
    },

    getDefaultStateId() {
      return ui.getDestination();
    },

    onOpen() {
      holdKey = null;
      presetView.close();
    },

    onChange(change) {
      finishStateChange(change);
    },
  });

  const presetView = mountPresetLibrary({
    getContext() {
      return loading || !dataset || !session
        ? null
        : { dataset, session };
    },

    onOpen() {
      holdKey = null;
      managerView.close();
    },

    onApplied(plan) {
      selected.clear();
      selectionAnchor = null;
      setMode("pickup");

      const states = session.getSnapshot().model.states;

      if (
        !states.some((state) => state.id === ui.getDestination())
      ) {
        ui.setDestination(states[0].id);
      }

      clearSharedAddress();
      render();

      ui.setStatus(
        `Applied ${plan.applied.length} preset layers. ` +
        `${plan.changedCountyCount} net county assignments changed.`
      );
    },
  });

  function selectCurrentState(countyId) {
    if (!session || loading) return;

    try {
      const countyIds = session.selectStateCounties(
        countyId,
        [...selected]
      );

      selected = new Set(countyIds);
      selectionAnchor = countyId;
      holdKey = null;
      render();

      ui.setStatus(
        `Selected ${countyIds.length.toLocaleString()} counties.`
      );
    } catch (error) {
      ui.setStatus(error.message);
    }
  }

  function selectStateById(stateId) {
    if (!session || loading) return;

    const countyId = Object.entries(
      session.getSnapshot().model.assignments
    ).find(([, assignedStateId]) => assignedStateId === stateId)?.[0];

    if (!countyId) {
      ui.setStatus("This state has no counties to select.");
      return;
    }

    selectCurrentState(countyId);
  }

  const bulkView = mountMapBulkControls({
    container: document.getElementById("map-tools"),

    getContext() {
      return {
        manager: stateManager,
        loading,
        selectedCount: selected.size,
        anchorCountyId: selectionAnchor,
      };
    },

    onSelectState(countyId) {
      selectCurrentState(countyId);
    },

    onClearSelection() {
      selected.clear();
      selectionAnchor = null;
      render();
      ui.setStatus("Selection cleared.");
    },

    onDissolved(snapshot, plan) {
      selected.clear();
      selectionAnchor = null;
      holdKey = null;
      setMode("pickup");
      ui.setDestination("custom:united-states-of-america");
      clearSharedAddress();
      render();

      ui.setStatus(
        `Dissolved ${plan.sourceStateCount} states into ` +
        "United State of America (US)."
      );
    },

    onStatus(message) {
      ui.setStatus(message);
    },
  });

  const territoryView = mountTerritoryControls({
    container: document.getElementById("map-tools"),

    getContext() {
      const snapshot = session?.getSnapshot();

      return {
        session,
        loading,
        selectedCount: selected.size,
        excludedSelectedCount: [...selected].filter((id) =>
          Object.hasOwn(snapshot?.excluded ?? {}, id)
        ).length,
        excludedCount: Object.keys(snapshot?.excluded ?? {}).length,
        excludedTotals: snapshot?.excludedTotals,
        destinationId: ui.getDestination(),
      };
    },

    onExclude() {
      if (!session || loading || selected.size === 0) return;

      const count = [...selected].filter((id) =>
        !Object.hasOwn(session.getSnapshot().excluded, id)
      ).length;

      session.excludeCounties([...selected]);
      holdKey = null;
      setMode("pickup");
      clearSharedAddress();
      render();

      ui.setStatus(`${count} counties removed from US totals.`);
    },

    onSelectExcluded() {
      if (!session || loading) return;

      const ids = Object.keys(session.getSnapshot().excluded);

      selected = new Set([...selected, ...ids]);
      selectionAnchor = ids[0] ?? selectionAnchor;
      holdKey = null;
      setMode("pickup");
      render();

      ui.setStatus(`${ids.length} excluded counties selected.`);
    },

    onRestore() {
      if (!session || loading) return;

      const ids = [...selected].filter((id) =>
        Object.hasOwn(session.getSnapshot().excluded, id)
      );

      if (ids.length === 0) {
        ui.setStatus("Select excluded counties first.");
        return;
      }

      session.restorePreviousStates(ids);
      selected.clear();
      selectionAnchor = null;
      setMode("pickup");
      clearSharedAddress();
      render();

      ui.setStatus(
        `${ids.length} counties restored to their previous states.`
      );
    },

    onReadd() {
      moveSelected(ui.getDestination());
    },

    onSave() {
      if (!session || !dataset || loading) return;

      downloadTerritoryWorkspace(
        dataset,
        session.getTerritoryWorkspace()
      );

      ui.setStatus(
        "Scenario JSON prepared with boundaries and exclusions."
      );
    },

    async onLoad(file) {
      if (!session || !dataset || loading) return;

      const currentSession = session;
      const currentDataset = dataset;
      const before = session.getSnapshot();

      const workspace = await readTerritoryFile(
        file,
        currentDataset
      );

      if (
        loading ||
        session !== currentSession ||
        session.getSnapshot() !== before
      ) {
        throw new Error(
          "The configuration changed. Review the file again."
        );
      }

      session.replaceTerritoryWorkspace(workspace);
      selected.clear();
      selectionAnchor = null;
      holdKey = null;
      setMode("pickup");

      const states = session.getSnapshot().model.states;

      if (!states.some((state) => state.id === ui.getDestination())) {
        ui.setDestination(states[0].id);
      }

      clearSharedAddress();
      render();
      ui.setStatus("Scenario loaded, including excluded territory.");
    },

    onStatus(message) {
      ui.setStatus(message);
    },
  });

  const mapElement = document.getElementById("states-svg");

  // Capture the modifier before the D3 handler runs. This preserves
  // compatibility with handlers that pass only a county ID.
  mapElement.addEventListener("click", (event) => {
    capturedShiftClick = event.shiftKey;
  }, true);

  function consumeShiftClick(event) {
    const shift = event?.shiftKey ?? capturedShiftClick;
    capturedShiftClick = false;
    return shift;
  }

  const view = createMapView(
    mapElement,
    {
      onCountyClick(countyId, event) {
        if (!session || loading) return;

        if (consumeShiftClick(event)) {
          selectCurrentState(countyId);
          return;
        }

        selectionAnchor = countyId;

        if (mode === "dropoff") {
          if (
            Object.hasOwn(
              session.getSnapshot().excluded,
              countyId
            )
          ) {
            ui.setStatus(
              "Choose an included destination state to re-add territory."
            );
            return;
          }

          moveSelected(
            session.getSnapshot().model.assignments[countyId]
          );
          return;
        }

        if (selected.has(countyId)) {
          selected.delete(countyId);
        } else {
          selected.add(countyId);
        }

        render();
      },

      onStateClick(stateId, event) {
        if (!session || loading) return;

        if (consumeShiftClick(event)) {
          selectStateById(stateId);
          return;
        }

        if (mode === "dropoff") {
          moveSelected(stateId);
        } else {
          ui.setDestination(stateId);
        }
      },

      onCountyEnter(countyId) {
        if (!session || mode !== "pickup") return;

        if (holdKey === "select" && !selected.has(countyId)) {
          selected.add(countyId);
          selectionAnchor = countyId;
          render();
        } else if (holdKey === "erase" && selected.has(countyId)) {
          selected.delete(countyId);
          render();
        }
      },
    }
  );

  function setMode(nextMode) {
    mode = nextMode;

    moveButton.innerHTML = mode === "dropoff"
      ? "Cancel <u>m</u>ove"
      : "<u>M</u>ove";

    moveButton.classList.toggle(
      "btn-warning",
      mode === "dropoff"
    );

    moveButton.classList.toggle(
      "btn-danger",
      mode !== "dropoff"
    );
  }

  function setLevel(nextLevel) {
    level = nextLevel;

    countyButton.textContent =
      level === "counties" ? "Hide Counties" :
      level === "states" ? "Outlines Only" :
      "Show Counties";

    render();
  }

  function clearSharedAddress() {
    if (!dataset) return;

    const url = new URL(window.location.href);

    url.search = "";
    url.searchParams.set("year", dataset.metadata.id);

    window.history.replaceState(null, "", url);

    const shareGroup = document.getElementById("shareGroup");
    const shareInput = document.getElementById("clipboard-target");

    if (shareGroup) shareGroup.style.display = "none";
    if (shareInput) shareInput.value = "";
  }

  function finishStateChange(change) {
    if (!session) return;

    const states = session.getSnapshot().model.states;
    const preferred = change.destinationId || change.stateId;

    const destinationId = states.some(
      (state) => state.id === preferred
    )
      ? preferred
      : states[0].id;

    if (
      change.type === "dissolve" ||
      change.type === "dissolve-all"
    ) {
      setMode("pickup");
    }

    ui.setDestination(destinationId);
    clearSharedAddress();
    render();
    ui.setStatus(change.message);
  }

  function moveSelected(destinationId) {
    if (!session || loading) return;

    if (selected.size === 0) {
      ui.setStatus("Select one or more counties first.");
      return;
    }

    try {
      session.moveCounties([...selected], destinationId);
      selected.clear();
      selectionAnchor = null;
      setMode("pickup");
      ui.setDestination(destinationId);
      clearSharedAddress();
      render();
      ui.setStatus("County assignments updated.");
    } catch (error) {
      ui.setStatus(error.message);
    }
  }

  function render() {
    if (!session || !dataset) return;

    const snapshot = session.getSnapshot();
    const allocation = computeTerritoryAllocation(snapshot, dataset);

    const allocationSummary = summarizeAllocation(
      snapshot,
      dataset,
      allocation
    );

    const viewState = {
      snapshot,
      dataset,
      selected,
      metric,
      level,
      voteDisplay,
      allocation,
      summary: allocationSummary,
    };

    view.render(viewState);
    ui.render(viewState);
    managerView.refresh();
    presetView.refresh();
    bulkView.refresh();
    territoryView.refresh();

    const incomeMode =
      dataset.metadata.measurement.kind === "income-weight";

    document.querySelector(
      ".summary-heading > span:first-child"
    ).textContent = incomeMode
      ? "Income-weighted simulation"
      : "Hypothetical electoral totals";

    document.getElementById("lede").textContent =
      "Select counties, move them between states, or exclude them from the US. " +
      "Excluded territory remains visible and can be re-added.";
  }

  async function getDataset(datasetId) {
    if (!datasetCache.has(datasetId)) {
      const promise = loadDatasetWithAreas(datasetId);

      datasetCache.set(datasetId, promise);

      promise.catch(() => datasetCache.delete(datasetId));
    }

    return datasetCache.get(datasetId);
  }

  async function load(
    datasetId,
    { preserve = true, useUrl = false } = {}
  ) {
    const request = ++requestNumber;

    loading = true;
    managerView.close();
    presetView.close();

    ui.setBusy(true);
    managerView.setBusy(true);
    presetView.setBusy(true);
    bulkView.setBusy(true);
    territoryView.setBusy(true);
    ui.setStatus("Loading dataset...");

    const previousDataset = dataset;
    const previousSession = session;
    const previousManager = stateManager;

    const previousWorkspace = preserve && session
      ? session.getTerritoryWorkspace()
      : null;

    try {
      getLegacyDataset(datasetId);

      const nextDataset = await getDataset(datasetId);

      if (request !== requestNumber) return;

      const nextSession = createStateSession(nextDataset);

      if (useUrl) {
        nextSession.replaceTerritoryWorkspace(
          restoreTerritoryShare(
            nextDataset,
            new URLSearchParams(window.location.search)
          )
        );
      } else if (previousWorkspace) {
        nextSession.replaceTerritoryWorkspace(
          readTerritoryDocument(
            createTerritoryDocument(previousWorkspace),
            nextDataset.model
          )
        );
      }

      const nextManager = createStateManager(
        nextSession,
        nextDataset.model,
        () => `custom:${crypto.randomUUID()}`
      );

      dataset = nextDataset;
      session = nextSession;
      stateManager = nextManager;

      selected.clear();
      selectionAnchor = null;
      setMode("pickup");

      voteDisplay = normalizeVoteDisplay(
        voteDisplay,
        dataset.metadata.voteFields
      );

      yearSelect.value = datasetId;

      if (!useUrl) {
        clearSharedAddress();
      }

      render();

      ui.setStatus(
        `${nextDataset.metadata.label} loaded. ` +
        `${nextDataset.counties.length.toLocaleString()} geographic records.`
      );
    } catch (error) {
      if (request === requestNumber) {
        dataset = previousDataset;
        session = previousSession;
        stateManager = previousManager;

        yearSelect.value =
          previousDataset?.metadata.id ?? "2024";

        ui.setStatus(
          `Could not load dataset: ${error.message}`
        );
      }
    } finally {
      if (request === requestNumber) {
        loading = false;
        ui.setBusy(false);
        managerView.setBusy(false);
        presetView.setBusy(false);
        bulkView.setBusy(false);
        territoryView.setBusy(false);
      }
    }
  }

  moveButton.addEventListener("click", () => {
    if (!session || loading) return;

    setMode(mode === "pickup" ? "dropoff" : "pickup");

    ui.setStatus(
      mode === "dropoff"
        ? "Choose a destination on the map or use the destination selector."
        : ""
    );
  });

  countyButton.addEventListener("click", () => {
    setLevel(
      level === "counties"
        ? "states"
        : level === "states"
          ? "outlines"
          : "counties"
    );
  });

  yearSelect.addEventListener("change", () => {
    load(yearSelect.value);
  });

  function isTyping(target) {
    return Boolean(target?.closest?.(
      "input, select, textarea, button, dialog, [contenteditable], " +
      "[role='tab'], [role='slider']"
    ));
  }

  document.addEventListener("keydown", (event) => {
    if (
      isTyping(event.target) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "q") holdKey = "select";
    if (key === "w") holdKey = "erase";

    if (key === "m" && !event.repeat && session) {
      moveButton.click();
    }

    if (key === "p" && !event.repeat) {
      ui.toggleVoteFormat();
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.key.toLowerCase() === "q" && holdKey === "select") {
      holdKey = null;
    }

    if (event.key.toLowerCase() === "w" && holdKey === "erase") {
      holdKey = null;
    }
  });

  window.addEventListener("blur", () => {
    holdKey = null;
  });

  const shareGroup = document.getElementById("shareGroup");
  const shareButton = document.getElementById("shareButton");
  const shareInput = document.getElementById("clipboard-target");
  const copyButton = document.getElementById("copy-button");

  shareGroup.classList.add("map-session-share");
  shareGroup.style.display = "none";

  shareButton.insertAdjacentElement("afterend", shareGroup);

  shareButton.addEventListener("click", () => {
    if (!session || !dataset) return;

    shareInput.value = createTerritoryShareUrl(
      dataset,
      session.getTerritoryWorkspace()
    );

    shareGroup.style.display =
      shareGroup.style.display === "none" ? "table" : "none";
  });

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareInput.value);
      ui.setStatus("Share URL copied.");
    } catch {
      shareInput.focus();
      shareInput.select();
      ui.setStatus("Select and copy the URL manually.");
    }
  });

  const initialParams = new URLSearchParams(window.location.search);
  const initialYear = initialParams.get("year") ?? "2024";

  load(initialYear, {
    preserve: false,
    useUrl: initialParams.has("cfg") || initialParams.has("share"),
  });
}