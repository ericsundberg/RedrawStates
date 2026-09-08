
/**
 * Territory-aware D3 renderer. Exclusion is a presentation layer,
 * not a synthetic state in the session or electoral model.
 */

import {
  normalizeLegacyCountyId,
} from "../data/legacy-geography.mjs";

import {
  createMapColorizer,
} from "./map-visualization.mjs";

import {
  mountMapColorLegend,
} from "../ui/map-color-legend.mjs";

import {
  installMapSelectionGestures,
} from "./map-selection-gestures.mjs";

const WIDTH = 960;
const HEIGHT = 500;
const EXCLUDED_COLOR = "#b9bec5";
const EXCLUDED_STROKE = "#767d86";

export function buildTerritoryStateFeatures(dataset, snapshot, merge) {
  const model = snapshot.includedModel ?? snapshot.model;
  const groups = new Map();

  for (const [id, geometry] of dataset.geometriesById) {
    if (!Object.hasOwn(model.assignments, id)) continue;

    const stateId = model.assignments[id];

    if (!groups.has(stateId)) {
      groups.set(stateId, []);
    }

    groups.get(stateId).push(geometry);
  }

  return model.states
    .filter((state) => groups.has(state.id))
    .map((state) => ({
      id: state.id,
      geometry: merge(
        dataset.topology,
        groups.get(state.id)
      ),
    }));
}

export function createMapView(element, handlers) {
  const d3 = window.d3;
  const topojson = window.topojson;

  // Install before D3's normal map interaction handlers.
  const selectionGestures = installMapSelectionGestures(
    element,
    handlers
  );

  const svg = d3.select(element)
    .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const root = svg.append("g");
  const countyLayer = root.append("g").attr("class", "county-layer");
  const stateLayer = root.append("g").attr("class", "state-layer");
  const excludedLayer = root.append("g").attr("class", "excluded-layer");

  const projection = d3.geoAlbersUsa();
  const path = d3.geoPath(projection);

  const colorLegend = mountMapColorLegend(
    document.getElementById("map-tools")
  );

  let currentDataset = null;
  let currentModel = null;
  let features = [];
  let stateFeatures = [];
  let currentView = null;
  let countyById = new Map();
  let countyColors = new Map();
  let stateColors = new Map();

  const tooltip = d3.select("body")
    .append("div")
    .attr("class", "map-session-tooltip")
    .attr("role", "status")
    .style("display", "none");

  const zoom = d3.zoom()
    .scaleExtent([1, 12])
    .extent([[0, 0], [WIDTH, HEIGHT]])
    .translateExtent([[0, 0], [WIDTH, HEIGHT]])
    .on("zoom", (event) => {
      root.attr("transform", event.transform);

      root.classed("close-zoom-stroke", event.transform.k >= 5)
        .classed("wide-zoom-stroke", event.transform.k < 5);
    });

  svg.call(zoom);

  function setDataset(dataset) {
    if (currentDataset === dataset) return;

    currentDataset = dataset;
    currentModel = null;

    countyById = new Map(
      dataset.counties.map((county) => [county.id, county])
    );

    const collection = {
      type: "GeometryCollection",
      geometries: [...dataset.geometriesById.values()],
    };

    features = topojson.feature(
      dataset.topology,
      collection
    ).features.map((feature) => ({
      ...feature,
      id: normalizeLegacyCountyId(
        feature.id ?? feature.properties?.id
      ),
    }));

    projection.fitExtent(
      [[12, 12], [WIDTH - 12, HEIGHT - 12]],
      { type: "FeatureCollection", features }
    );

    countyLayer.selectAll("*").remove();
    stateLayer.selectAll("*").remove();
    excludedLayer.selectAll("*").remove();
  }

  function rebuildStates(snapshot) {
    const includedModel = snapshot.includedModel ?? snapshot.model;

    if (currentModel === includedModel) return;

    currentModel = includedModel;

    stateFeatures = buildTerritoryStateFeatures(
      currentDataset,
      snapshot,
      topojson.merge
    );
  }

  function showTooltip(event, countyId) {
    const county = countyById.get(countyId);

    if (!county || !currentView) return;

    const snapshot = currentView.snapshot;
    const excluded = Object.hasOwn(
      snapshot.excluded ?? {},
      countyId
    );

    const stateId = excluded
      ? snapshot.excluded[countyId]
      : snapshot.model.assignments[countyId];

    const state = [
      ...snapshot.model.states,
      ...(snapshot.territory?.archivedStates ?? []),
    ].find((item) => item.id === stateId);

    const details = countyColors.get(countyId);

    tooltip.selectAll("*").remove();

    tooltip.append("strong").text(county.name);

    tooltip.append("div").text(
      excluded
        ? `Excluded territory — previously ${state?.name ?? "unassigned"}`
        : state?.name ?? "Unassigned"
    );

    tooltip.append("div").text(
      county.population == null
        ? "Population: unavailable"
        : `Population: ${county.population.toLocaleString()}`
    );

    if (county.landAreaM2 != null) {
      tooltip.append("div").text(
        `Land: ${(county.landAreaM2 / 1_000_000).toLocaleString(
          "en-US",
          { maximumFractionDigits: 2 }
        )} km²`
      );
    }

    if (excluded) {
      tooltip.append("div").text(
        "Not counted in US totals or allocation."
      );
    } else if (details?.basis === "selected-share") {
      tooltip.append("div").text(
        `Selected vote share: ${(details.share * 100).toFixed(2)}%`
      );
    } else if (details?.basis === "selected-count") {
      tooltip.append("div").text(
        `Selected votes: ${details.value.toLocaleString()}`
      );
    } else if (details?.basis === "classic-two-party") {
      tooltip.append("div").text(
        `Democratic two-party share: ${(details.twoPartyShare * 100).toFixed(2)}%`
      );
    } else if (details?.colorShare != null) {
      tooltip.append("div").text(
        `Color share: ${(details.colorShare * 100).toFixed(2)}%`
      );
    }

    if (county.votes) {
      const table = tooltip.append("table");

      for (const field of currentView.dataset.metadata.voteFields) {
        const row = table.append("tr");

        row.append("td").text(field.label);
        row.append("td").text(
          county.votes[field.id]?.toLocaleString() ?? "—"
        );
      }
    }

    tooltip
      .style("display", "block")
      .style("left", `${Math.max(4, Math.min(
        event.clientX + 12,
        window.innerWidth - 280
      ))}px`)
      .style("top", `${Math.max(4, Math.min(
        event.clientY + 12,
        window.innerHeight - 220
      ))}px`);
  }

  function hideTooltip() {
    tooltip.style("display", "none");
  }

  function attachCountyHandlers(selection) {
    return selection
      .on("click", (event, feature) => {
        if (!event.defaultPrevented) {
          handlers.onCountyClick(feature.id, event);
        }
      })
      .on("mouseenter", (event, feature) => {
        handlers.onCountyEnter(feature.id);
        showTooltip(event, feature.id);
      })
      .on("mousemove", (event, feature) =>
        showTooltip(event, feature.id)
      )
      .on("mouseleave", hideTooltip);
  }

  function render(view) {
    currentView = view;
    setDataset(view.dataset);
    rebuildStates(view.snapshot);

    const snapshot = view.snapshot;
    const excluded = snapshot.excluded ?? {};

    const includedCounties = view.dataset.counties.filter(
      (county) => !Object.hasOwn(excluded, county.id)
    );

    const totals = new Map(
      snapshot.totals.map((total) => [total.stateId, total])
    );

    const countyColorizer = createMapColorizer(
      view,
      includedCounties
    );

    const stateColorizer = createMapColorizer(
      view,
      snapshot.totals
    );

    countyColors = new Map(
      view.dataset.counties.map((county) => {
        if (Object.hasOwn(excluded, county.id)) {
          return [county.id, {
            status: "excluded",
            basis: "excluded",
            color: EXCLUDED_COLOR,
            stroke: EXCLUDED_STROKE,
          }];
        }

        const stateId = snapshot.model.assignments[county.id];

        return [
          county.id,
          countyColorizer.get(
            county,
            totals.get(stateId)?.votes
          ),
        ];
      })
    );

    stateColors = new Map(
      snapshot.totals.map((total) => [
        total.stateId,
        stateColorizer.get(total, total.votes),
      ])
    );

    attachCountyHandlers(
      countyLayer
        .style(
          "display",
          view.level === "counties" ? null : "none"
        )
        .selectAll("path")
        .data(features, (feature) => feature.id)
        .join("path")
        .attr("class", (feature) => {
          const details = countyColors.get(feature.id);

          const context = details?.basis === "classic-two-party"
            ? ` vote-context-${details.colorBucketId}`
            : "";

          return `map-session-county${context}`;
        })
        .attr("d", path)
        .attr("data-county-id", (feature) => feature.id)
        .attr("fill", (feature) =>
          countyColors.get(feature.id)?.color ?? "#dfe3e8"
        )
        .classed("is-excluded", (feature) =>
          Object.hasOwn(excluded, feature.id)
        )
        .classed("is-selected", (feature) =>
          view.selected.has(feature.id)
        )
    );

    stateLayer.selectAll("path")
      .data(stateFeatures, (feature) => feature.id)
      .join("path")
      .attr("class", "map-session-state")
      .attr("data-state-id", (feature) => feature.id)
      .attr("d", (feature) => path(feature.geometry))
      .attr("fill", (feature) => {
        if (
          view.level === "counties" ||
          view.level === "outlines"
        ) {
          return "transparent";
        }

        return stateColors.get(feature.id)?.color ?? "#dfe3e8";
      })
      .style(
        "pointer-events",
        view.level === "counties" ? "none" : "all"
      )
      .on("click", (event, feature) => {
        if (!event.defaultPrevented) {
          handlers.onStateClick(feature.id, event);
        }
      })
      .selectAll("title")
      .data((feature) => [feature])
      .join("title")
      .text((feature) =>
        snapshot.model.states.find(
          (state) => state.id === feature.id
        )?.name ?? feature.id
      );

    // Excluded territory remains a separate selectable map layer.
    // It never becomes a state feature or receives an allocation.
    attachCountyHandlers(
      excludedLayer
        .style(
          "display",
          view.level === "counties" ? "none" : null
        )
        .selectAll("path")
        .data(
          features.filter((feature) =>
            Object.hasOwn(excluded, feature.id)
          ),
          (feature) => feature.id
        )
        .join("path")
        .attr("class", "map-session-county is-excluded")
        .attr("d", path)
        .attr("data-county-id", (feature) => feature.id)
        .attr("fill", EXCLUDED_COLOR)
        .attr("stroke", EXCLUDED_STROKE)
        .classed("is-selected", (feature) =>
          view.selected.has(feature.id)
        )
    );

    colorLegend.render({
      dataset: view.dataset,
      metric: view.metric,
      level: view.level,
      voteDisplay: view.voteDisplay,
      scale: view.level === "states"
        ? stateColorizer.scale
        : countyColorizer.scale,
    });
  }

  return {
    render,
    hideTooltip,

    resetZoom() {
      svg.transition()
        .duration(200)
        .call(zoom.transform, d3.zoomIdentity);
    },

    destroy() {
      selectionGestures.destroy();
      tooltip.remove();
      colorLegend.destroy();
      svg.on(".zoom", null);
    },
  };
}