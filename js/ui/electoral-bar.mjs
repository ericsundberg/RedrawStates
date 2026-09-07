/**
 * Electoral bar with aggregated and state-by-state display modes.
 */

import { VOTE_COLORS } from "../map/map-color-scale.mjs";
import { buildElectoralBarModel } from "./electoral-bar-model.mjs";

const numberFormat = new Intl.NumberFormat("en-US");

function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
}

function format(value) {
  return numberFormat.format(value);
}

export function mountElectoralBar() {
  const bar = document.getElementById("allocation-bar");
  const legend = document.getElementById("allocation-legend");
  const heading = document.querySelector(".summary-heading");

  const control = element("label", "electoral-view-control");
  control.textContent = "Bar view";

  const select = element("select", "form-control");
  select.id = "electoral-bar-view";
  select.setAttribute("aria-label", "Electoral bar view");

  for (const [value, label] of [
    ["totals", "Totals"],
    ["states", "By state"],
  ]) {
    const option = element("option", null, label);
    option.value = value;
    select.append(option);
  }

  control.append(select);
  heading.insertBefore(
    control,
    heading.querySelector(".summary-caption")
  );

  const inspector = element("div", "electoral-state-inspector");
  inspector.hidden = true;

  const inspectorLabel = element("label");
  inspectorLabel.textContent = "Inspect state";

  const stateSelect = element("select", "form-control");
  stateSelect.setAttribute("aria-label", "Inspect a state in the electoral bar");

  const detail = element("span", "electoral-state-detail");
  detail.setAttribute("role", "status");
  detail.setAttribute("aria-live", "polite");

  inspectorLabel.append(stateSelect);
  inspector.append(inspectorLabel, detail);

  legend.insertAdjacentElement("afterend", inspector);

  let mode = "totals";
  let selectedStateId = "";
  let currentModel = null;

  function color(bucketId) {
    return VOTE_COLORS[bucketId] ?? "#a3aab3";
  }

  function renderLegend(model) {
    legend.replaceChildren();

    for (const group of model.groups) {
      if (group.total === 0) continue;

      const label = element("span", "allocation-legend-item");
      const swatch = element("span", "allocation-swatch");

      swatch.style.backgroundColor = color(group.id);

      label.append(
        swatch,
        document.createTextNode(
          `${group.label}: ${format(group.total)}`
        )
      );

      legend.append(label);
    }
  }

  function inspectState(stateId) {
    selectedStateId = stateId;

    const state = currentModel?.states.find(
      (item) => item.id === stateId
    );

    stateSelect.value = state ? stateId : "";

    detail.textContent = state
      ? `${state.name} (${state.code}) · ` +
        `${format(state.electors)} electors · ${state.bucketLabel}`
      : "Select a state to inspect its modeled allocation.";

    for (const segment of bar.querySelectorAll("[data-state-id]")) {
      segment.setAttribute(
        "aria-pressed",
        String(segment.dataset.stateId === stateId)
      );
    }
  }

  function renderInspector(model) {
    stateSelect.replaceChildren();

    const placeholder = element("option", null, "Choose a state…");
    placeholder.value = "";
    stateSelect.append(placeholder);

    const states = [...model.states].sort((a, b) =>
      a.name.localeCompare(b.name) || a.code.localeCompare(b.code)
    );

    for (const state of states) {
      const option = element(
        "option",
        null,
        `${state.name} (${state.code}) — ${format(state.electors)}`
      );

      option.value = state.id;
      stateSelect.append(option);
    }

    if (!states.some((state) => state.id === selectedStateId)) {
      selectedStateId = "";
    }

    inspectState(selectedStateId);
  }

  function renderTotals(model) {
    for (const group of model.groups) {
      if (group.total === 0) continue;

      const segment = element(
        "div",
        "allocation-segment",
        format(group.total)
      );

      segment.style.flex = String(group.total);
      segment.style.backgroundColor = color(group.id);
      segment.title = `${group.label}: ${format(group.total)}`;

      bar.append(segment);
    }
  }

  function renderStates(model) {
    for (const group of model.groups) {
      for (const state of group.states) {
        if (state.electors === 0) continue;

        const segment = element(
          "button",
          "allocation-segment electoral-state-segment"
        );

        segment.type = "button";
        segment.dataset.stateId = state.id;
        segment.style.flex = String(state.electors);
        segment.style.backgroundColor = color(state.bucketId);

        const description =
          `${state.name} (${state.code}): ` +
          `${format(state.electors)} electors; ${state.bucketLabel}`;

        segment.title = description;
        segment.setAttribute("aria-label", description);

        const code = element("span", null, state.code);
        code.setAttribute("aria-hidden", "true");
        segment.append(code);

        segment.addEventListener("click", () => {
          inspectState(state.id);
        });

        bar.append(segment);
      }
    }
  }

  function render() {
    if (!currentModel) return;

    bar.replaceChildren();

    const model = currentModel;
    const available = model.status === "available";

    if (!available) {
      bar.append(element("span", "allocation-empty", "Allocation unavailable"));
      legend.replaceChildren();
      inspector.hidden = true;
      return;
    }

    if (mode === "states") {
      renderStates(model);
      inspector.hidden = false;
      renderInspector(model);
    } else {
      renderTotals(model);
      inspector.hidden = true;
    }

    renderLegend(model);
  }

  select.addEventListener("change", () => {
    mode = select.value;
    render();
  });

  stateSelect.addEventListener("change", () => {
    inspectState(stateSelect.value);
  });

  return {
    render(snapshot, dataset, allocation, summary) {
      currentModel = buildElectoralBarModel(
        snapshot,
        dataset,
        allocation,
        summary
      );

      render();
    },
  };
}