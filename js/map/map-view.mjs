/**
 * D3 map renderer. Geographic state comes only from session snapshots.
 */

import { normalizeLegacyCountyId } from "../data/legacy-geography.mjs";
import { createMapColorizer } from "./map-visualization.mjs";
import { mountMapColorLegend } from "../ui/map-color-legend.mjs";

const WIDTH = 960;
const HEIGHT = 500;

export function createMapView(element, handlers) {
  const d3 = window.d3;
  const topojson = window.topojson;

  const svg = d3.select(element)
    .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const root = svg.append("g");
  const countyLayer = root.append("g").attr("class", "county-layer");
  const stateLayer = root.append("g").attr("class", "state-layer");

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
  }

  function rebuildStates(snapshot) {
    if (currentModel === snapshot.model) return;

    currentModel = snapshot.model;

    const groups = d3.group(
      [...currentDataset.geometriesById.entries()],
      ([id]) => snapshot.model.assignments[id]
    );

    stateFeatures = snapshot.model.states
      .filter((state) => groups.has(state.id))
      .map((state) => ({
        id: state.id,
        geometry: topojson.merge(
          currentDataset.topology,
          groups.get(state.id).map(([, geometry]) => geometry)
        ),
      }));
  }

  function showTooltip(event, countyId) {
    const county = countyById.get(countyId);

    if (!county || !currentView) return;

    const snapshot = currentView.snapshot;
    const stateId = snapshot.model.assignments[countyId];
    const state = snapshot.model.states.find((item) => item.id === stateId);
    const details = countyColors.get(countyId);

    tooltip.selectAll("*").remove();

    tooltip.append("strong").text(county.name);
    tooltip.append("div").text(state?.name ?? "Unassigned");

    if (county.population != null) {
      tooltip.append("div").text(
        `Population: ${county.population.toLocaleString()}`
      );
    } else {
      tooltip.append("div").text("Population: unavailable");
    }

    if (county.landAreaM2 != null) {
      tooltip.append("div").text(
        `Land: ${(county.landAreaM2 / 1_000_000).toLocaleString(
          "en-US", { maximumFractionDigits: 2 }
        )} km²`
      );
    }

    if (details?.basis === "selected-share") {
      tooltip.append("div").text(
        `Selected vote share: ${(details.share * 100).toFixed(2)}%`
      );
    } else if (details?.basis === "selected-count") {
      tooltip.append("div").text(
        `Selected votes: ${details.value.toLocaleString()}`
      );
    } else if (details?.basis === "classic-two-party") {
      tooltip.append("div").text(
        `Democratic two-party share: ${
          (details.twoPartyShare * 100).toFixed(2)
        }%`
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
      .style(
        "left",
        `${Math.max(4, Math.min(event.clientX + 12, window.innerWidth - 280))}px`
      )
      .style(
        "top",
        `${Math.max(4, Math.min(event.clientY + 12, window.innerHeight - 220))}px`
      );
  }

  function hideTooltip() {
    tooltip.style("display", "none");
  }

  function render(view) {
    currentView = view;
    setDataset(view.dataset);
    rebuildStates(view.snapshot);

    const totals = new Map(
      view.snapshot.totals.map((total) => [total.stateId, total])
    );

    const countyColorizer = createMapColorizer(
      view,
      view.dataset.counties
    );

    const stateColorizer = createMapColorizer(
      view,
      view.snapshot.totals
    );

    countyColors = new Map(
      view.dataset.counties.map((county) => {
        const stateId = view.snapshot.model.assignments[county.id];

        return [
          county.id,
          countyColorizer.get(county, totals.get(stateId)?.votes),
        ];
      })
    );

    stateColors = new Map(
      view.snapshot.totals.map((total) => [
        total.stateId,
        stateColorizer.get(total, total.votes),
      ])
    );

    countyLayer
      .style("display", view.level === "counties" ? null : "none")
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
      .attr("fill", (feature) =>
        countyColors.get(feature.id)?.color ?? "#dfe3e8"
      )
      .classed("is-selected", (feature) => view.selected.has(feature.id))
      .on("click", (event, feature) => {
        if (!event.defaultPrevented) {
          handlers.onCountyClick(feature.id);
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

    stateLayer.selectAll("path")
      .data(stateFeatures, (feature) => feature.id)
      .join("path")
      .attr("class", "map-session-state")
      .attr("d", (feature) => path(feature.geometry))
      .attr("fill", (feature) => {
        if (view.level === "counties" || view.level === "outlines") {
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
          handlers.onStateClick(feature.id);
        }
      })
      .selectAll("title")
      .data((feature) => [feature])
      .join("title")
      .text((feature) =>
        view.snapshot.model.states.find(
          (state) => state.id === feature.id
        )?.name ?? feature.id
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
      tooltip.remove();
      colorLegend.destroy();
      svg.on(".zoom", null);
    },
  };
}