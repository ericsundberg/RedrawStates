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

import {
  computeAllocation,
  summarizeAllocation,
} from "../model/state-simulation.mjs";

import {
  DEFAULT_VOTE_DISPLAY,
  normalizeVoteDisplay,
} from "./map-visualization.mjs";

import { createMapView } from "./map-view.mjs";
import { createShareUrl, restoreShare } from "./map-share.mjs";
import { mountMapDetails } from "../ui/map-details.mjs";

export function startMapApp() {
  const datasetCache = new Map();

  let dataset = null;
  let session = null;
  let selected = new Set();
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
      if (!session || loading) return;

      try {
        const id = `custom:${crypto.randomUUID()}`;

        session.addState({
          id,
          name,
          abbreviation,
          kind: "state",
        });

        ui.setDestination(id);
        ui.setStatus(`Created ${name}. Select counties to move into it.`);
        clearSharedAddress();
        render();
      } catch (error) {
        ui.setStatus(error.message);
      }
    },

    reset() {
      if (!session || loading) return;

      session.reset();
      selected.clear();
      setMode("pickup");
      clearSharedAddress();
      render();
      ui.setStatus("Original boundaries restored.");
    },
  });

  const view = createMapView(
    document.getElementById("states-svg"),
    {
      onCountyClick(countyId) {
        if (!session || loading) return;

        if (mode === "dropoff") {
          moveSelected(session.getSnapshot().model.assignments[countyId]);
          return;
        }

        if (selected.has(countyId)) {
          selected.delete(countyId);
        } else {
          selected.add(countyId);
        }

        render();
      },

      onStateClick(stateId) {
        if (!session || loading) return;

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

    moveButton.classList.toggle("btn-warning", mode === "dropoff");
    moveButton.classList.toggle("btn-danger", mode !== "dropoff");
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
    const allocation = computeAllocation(snapshot, dataset);
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

    const incomeMode =
      dataset.metadata.measurement.kind === "income-weight";

    document.querySelector(
      ".summary-heading > span:first-child"
    ).textContent = incomeMode
      ? "Income-weighted simulation"
      : "Hypothetical electoral totals";

    document.getElementById("lede").textContent =
      "Select counties and move them between states. " +
      "Map filters do not change the underlying votes.";
  }

  function sameInventory(first, second) {
    const a = Object.keys(first.assignments).sort();
    const b = Object.keys(second.assignments).sort();

    return a.length === b.length &&
      a.every((id, index) => id === b[index]);
  }

  async function getDataset(datasetId) {
    if (!datasetCache.has(datasetId)) {
      const promise = loadDatasetWithAreas(datasetId);
      datasetCache.set(datasetId, promise);

      promise.catch(() => datasetCache.delete(datasetId));
    }

    return datasetCache.get(datasetId);
  }

  async function load(datasetId, { preserve = true, useUrl = false } = {}) {
    const request = ++requestNumber;
    loading = true;
    ui.setBusy(true);
    ui.setStatus("Loading dataset...");

    const previousDataset = dataset;
    const previousSession = session;
    const previousModel = preserve && session
      ? session.getSnapshot().model
      : null;

    try {
      getLegacyDataset(datasetId);

      const nextDataset = await getDataset(datasetId);

      if (request !== requestNumber) return;

      const nextSession = createStateSession(nextDataset);

      if (useUrl) {
        nextSession.replaceModel(
          restoreShare(
            nextDataset,
            new URLSearchParams(window.location.search)
          )
        );
      } else if (previousModel) {
        if (!sameInventory(previousModel, nextDataset.model)) {
          throw new Error(
            "The county inventories differ. Reset the configuration " +
            "before switching datasets."
          );
        }

        nextSession.replaceModel(previousModel);
      }

      dataset = nextDataset;
      session = nextSession;
      selected.clear();
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
        yearSelect.value = previousDataset?.metadata.id ?? "2024";
        ui.setStatus(`Could not load dataset: ${error.message}`);
      }
    } finally {
      if (request === requestNumber) {
        loading = false;
        ui.setBusy(false);
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
      "input, select, textarea, button, [contenteditable], " +
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

    shareInput.value = createShareUrl(
      dataset,
      session.getSnapshot().model
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