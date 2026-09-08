/**
 * Map sidebar controls.
 */

function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
}

export function mountMapControls(actions) {
  const tools = document.getElementById("map-tools");
  const help = tools.querySelector(".tools-help");

  const section = element("section", "session-controls");

  section.innerHTML = `
    <div class="tools-field">
      <label for="map-metric">Map metric</label>
      <select class="form-control" id="map-metric">
        <option value="votes">Recorded vote buckets</option>
        <option value="population">Population</option>
        <option value="density">Population density</option>
        <option value="land">Land area</option>
        <option value="area">Total area</option>
      </select>
    </div>

    <div class="tools-field" id="vote-bucket-field">
      <label for="vote-bucket">Votes to display</label>
      <select class="form-control" id="vote-bucket"></select>
    </div>

    <div class="tools-field" id="vote-style-field">
      <label for="vote-style">Color treatment</label>
      <select class="form-control" id="vote-style">
        <option value="classic">Classic state context</option>
        <option value="context">All-bucket state context</option>
        <option value="local">Local leading bucket</option>
      </select>
    </div>

    <div class="tools-field" id="vote-measure-field" hidden>
      <label for="vote-measure">Selected-bucket measure</label>
      <select class="form-control" id="vote-measure">
        <option value="share">Share of all recorded votes</option>
        <option value="count">Raw vote count</option>
      </select>
    </div>

    <div class="tools-field">
      <label for="map-level">Display</label>
      <select class="form-control" id="map-level">
        <option value="counties">Counties</option>
        <option value="states">States</option>
        <option value="outlines">Outlines only</option>
      </select>
    </div>

    <div class="tools-field">
      <label for="destination-state">Destination state</label>
      <select class="form-control" id="destination-state"></select>
    </div>

    <p id="selection-count" class="tools-description">
      0 counties selected
    </p>

    <button type="button" class="btn btn-primary btn-block"
      id="move-selected">Move selected counties</button>

    <details class="state-creation">
      <summary>Create a state</summary>
      <form id="create-state-form">
        <label for="new-state-name">Name</label>
        <input class="form-control" id="new-state-name"
          maxlength="120" required>
        <label for="new-state-abbreviation">Abbreviation</label>
        <input class="form-control" id="new-state-abbreviation"
          maxlength="12" required>
        <button class="btn btn-primary btn-block" type="submit">
          Create state
        </button>
      </form>
    </details>

    <button type="button" class="btn btn-default btn-block"
      id="reset-configuration">Reset boundaries</button>

    <p id="area-data-note" class="tools-description"></p>
    <p id="map-status" role="status" aria-live="polite"
      class="tools-description"></p>
  `;

  tools.insertBefore(section, help);

  const destination = section.querySelector("#destination-state");
  const metric = section.querySelector("#map-metric");
  const level = section.querySelector("#map-level");
  const bucket = section.querySelector("#vote-bucket");
  const style = section.querySelector("#vote-style");
  const measure = section.querySelector("#vote-measure");
  const count = section.querySelector("#selection-count");
  const status = section.querySelector("#map-status");
  const areaNote = section.querySelector("#area-data-note");

  let stateSignature = "";
  let bucketSignature = "";

  metric.addEventListener("change", () => {
    actions.setMetric(metric.value);
  });

  level.addEventListener("change", () => {
    actions.setLevel(level.value);
  });

  bucket.addEventListener("change", () => {
    actions.setVoteDisplay({ bucketId: bucket.value });
  });

  style.addEventListener("change", () => {
    actions.setVoteDisplay({ style: style.value });
  });

  measure.addEventListener("change", () => {
    actions.setVoteDisplay({ measure: measure.value });
  });

  section.querySelector("#move-selected").addEventListener(
    "click",
    () => actions.moveSelected(destination.value)
  );

  section.querySelector("#reset-configuration").addEventListener(
    "click",
    () => {
      if (window.confirm(
        "Reset all county assignments and remove hypothetical states?"
      )) {
        actions.reset();
      }
    }
  );

  section.querySelector("#create-state-form").addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      actions.createState(
        section.querySelector("#new-state-name").value.trim(),
        section.querySelector("#new-state-abbreviation").value.trim()
      );
    }
  );

  function renderStateOptions(states) {
    const signature = JSON.stringify(
      states.map((state) => [state.id, state.name, state.abbreviation])
    );

    if (signature === stateSignature) return;

    const previous = destination.value;
    stateSignature = signature;
    destination.replaceChildren();

    for (const state of states) {
      const option = element(
        "option",
        null,
        `${state.name} (${state.abbreviation})`
      );

      option.value = state.id;
      destination.append(option);
    }

    if (states.some((state) => state.id === previous)) {
      destination.value = previous;
    }
  }

  function renderBucketOptions(fields) {
    const signature = JSON.stringify(
      fields.map((field) => [field.id, field.label])
    );

    if (signature === bucketSignature) return;

    bucketSignature = signature;
    bucket.replaceChildren();

    const all = element("option", null, "All recorded buckets");
    all.value = "all";
    bucket.append(all);

    for (const field of fields) {
      const option = element("option", null, field.label);
      option.value = field.id;
      bucket.append(option);
    }
  }

  return {
    setStatus(message) {
      status.textContent = message;
    },

    setDestination(stateId) {
      destination.value = stateId;
    },

    getDestination() {
      return destination.value;
    },

    setBusy(busy) {
      for (const control of section.querySelectorAll(
        "button, input, select"
      )) {
        control.disabled = busy;
      }
    },

    render({
      snapshot,
      dataset,
      selected,
      metric: activeMetric,
      level: activeLevel,
      voteDisplay,
    }) {
      renderStateOptions(snapshot.model.states);
      renderBucketOptions(dataset.metadata.voteFields);

      metric.value = activeMetric;
      level.value = activeLevel;
      bucket.value = voteDisplay.bucketId;
      style.value = voteDisplay.style;
      measure.value = voteDisplay.measure;

      const isVotes = activeMetric === "votes";
      const isAll = voteDisplay.bucketId === "all";

      section.querySelector("#vote-bucket-field").hidden = !isVotes;
      section.querySelector("#vote-style-field").hidden = !isVotes || !isAll;
      section.querySelector("#vote-measure-field").hidden = !isVotes || isAll;

      count.textContent = `${selected.size} counties selected`;

      const area = dataset.metadata.area;

      areaNote.textContent = area?.status === "available"
        ? `Area vintage: ${dataset.metadata.areaVintage}. ` +
          "Legacy coverage; Kalawao is not in the current map."
        : area?.reason ?? "Area data unavailable.";
    },
  };
}