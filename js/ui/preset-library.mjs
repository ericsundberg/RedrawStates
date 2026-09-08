/**
 * JSON-backed preset library and ordered load stack.
 *
 * Built-in and imported presets use the same schema and instantiator.
 * No preset-specific JavaScript factories are used by this module.
 */

import {
  loadPresetCatalog,
} from "../presets/preset-catalog.mjs";

import {
  applyPresetPlan,
  createPresetBundle,
  createPresetFromModel,
  createPresetPlan,
  readPresetDocument,
} from "../presets/preset-model.mjs";

import {
  downloadPresetJson,
  presetFilename,
  readPresetFiles,
} from "../presets/preset-files.mjs";

function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
}

function newKey() {
  return crypto.randomUUID();
}

async function readJson(path) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-cache",
  });

  if (!response.ok) {
    throw new Error(
      `Could not load ${path}: HTTP ${response.status}.`
    );
  }

  return response.json();
}

export function mountPresetLibrary({
  getContext,
  onApplied,
  onOpen = () => {},
}) {
  const tools = document.getElementById("map-tools");
  const section = tools.querySelector(".session-controls");

  const opener = element(
    "button",
    "btn btn-default btn-block",
    "Presets and local files"
  );

  opener.type = "button";
  opener.id = "presets-open";

  const managerButton = document.getElementById(
    "manage-states-button"
  );

  if (managerButton) {
    managerButton.insertAdjacentElement("afterend", opener);
  } else {
    section.append(opener);
  }

  const dialog = element("dialog", "preset-library-dialog");
  dialog.setAttribute("aria-labelledby", "preset-library-title");

  dialog.innerHTML = `
    <header class="preset-library-heading">
      <div>
        <h2 id="preset-library-title">Preset library</h2>
        <p>Combine county arrangements and save JSON files locally.</p>
      </div>
      <button type="button" class="workspace-button"
        id="presets-close" aria-label="Close preset library">
        &times;
      </button>
    </header>

    <div class="preset-library-content">
      <section>
        <h3>Available presets</h3>
        <label for="presets-catalog">Built-in and imported files</label>
        <div class="preset-library-inline">
          <select class="form-control" id="presets-catalog"></select>
          <button type="button" class="btn btn-default" id="presets-add">
            Add to stack
          </button>
          <button type="button" class="btn btn-default" id="presets-reload">
            Reload
          </button>
        </div>
        <p id="presets-description" class="preset-library-note"></p>
        <div id="presets-source" class="preset-library-source"></div>
        <label class="preset-library-import">
          Import JSON preset or stack
          <input id="presets-import" type="file"
            accept=".json,.redraw.json,application/json" multiple>
        </label>
      </section>

      <section>
        <h3>Selected load stack</h3>
        <p class="preset-library-note">
          Top = highest priority. The bottom loads first and the top
          loads last. Only explicitly affected counties are changed.
        </p>
        <div id="presets-queue" class="preset-library-queue"></div>

        <label for="presets-base">Start from</label>
        <select class="form-control" id="presets-base">
          <option value="current">Current configuration</option>
          <option value="original">Original boundaries</option>
        </select>

        <div class="preset-library-actions">
          <button type="button" class="btn btn-default" id="presets-preview">
            Review resulting configuration
          </button>
          <button type="button" class="btn btn-primary" id="presets-apply"
            disabled>Apply reviewed stack</button>
          <button type="button" class="btn btn-default"
            id="presets-download-stack">Download stack</button>
          <button type="button" class="btn btn-default"
            id="presets-clear">Clear stack</button>
        </div>

        <div id="presets-review" class="preset-library-review" hidden></div>
      </section>

      <section>
        <h3>Save current configuration</h3>
        <p class="preset-library-note">
          Downloads changes from the original configuration, not a
          complete national assignment table. No data is sent to a server.
        </p>
        <label for="presets-name">Preset name</label>
        <input class="form-control" id="presets-name"
          maxlength="120" required>
        <label for="presets-description-input">Description</label>
        <textarea class="form-control" id="presets-description-input"
          rows="3" maxlength="4000"></textarea>
        <button type="button" class="btn btn-default"
          id="presets-save">Download current changes</button>
      </section>

      <p id="presets-status" class="preset-library-status"
        role="status" aria-live="polite"></p>
    </div>
  `;

  document.body.append(dialog);

  const find = (selector) => dialog.querySelector(selector);

  const catalogSelect = find("#presets-catalog");
  const catalogDescription = find("#presets-description");
  const sourceContainer = find("#presets-source");
  const queueContainer = find("#presets-queue");
  const baseSelect = find("#presets-base");
  const review = find("#presets-review");
  const applyButton = find("#presets-apply");
  const status = find("#presets-status");
  const nameInput = find("#presets-name");
  const descriptionInput = find("#presets-description-input");
  const importInput = find("#presets-import");

  let catalog = [];
  let importedDocuments = [];
  let queue = [];
  let plan = null;
  let planContext = null;
  let loadedDataset = null;
  let loadingDataset = null;
  let generation = 0;
  let queueVersion = 0;
  let reviewedQueueVersion = null;
  let busy = false;
  let loading = false;
  let importing = false;
  let destroyed = false;

  function context() {
    return destroyed ? null : getContext();
  }

  function message(value) {
    status.textContent = value;
  }

  function locked() {
    return busy || loading || importing;
  }

  function invalidate() {
    plan = null;
    planContext = null;
    reviewedQueueVersion = null;
    applyButton.disabled = true;
    review.hidden = true;
    review.replaceChildren();
  }

  function changedQueue() {
    queueVersion += 1;
    invalidate();
    renderQueue();
    syncControls();
  }

  function catalogItem(preset, origin) {
    return {
      key: newKey(),
      preset,
      origin,
    };
  }

  function syncControls() {
    const disabled = locked();
    const selected = catalog.some(
      (item) => item.key === catalogSelect.value
    );

    for (const control of dialog.querySelectorAll(
      "button, input, select, textarea"
    )) {
      if (control.id !== "presets-close") {
        control.disabled = disabled;
      }
    }

    find("#presets-close").disabled = busy;
    find("#presets-add").disabled = disabled || !selected;
    find("#presets-preview").disabled =
      disabled || queue.length === 0;
    find("#presets-download-stack").disabled =
      disabled || queue.length === 0;
    find("#presets-clear").disabled =
      disabled || queue.length === 0;
    applyButton.disabled = disabled || !plan;

    for (const button of queueContainer.querySelectorAll(
      "button[data-queue-action]"
    )) {
      button.disabled =
        disabled || button.dataset.queueDisabled === "true";
    }
  }

  function renderCatalog() {
    const previous = catalogSelect.value;
    catalogSelect.replaceChildren();

    for (const item of catalog) {
      const option = element(
        "option",
        null,
        `${item.origin}: ${item.preset.name}`
      );

      option.value = item.key;
      catalogSelect.append(option);
    }

    if (catalog.some((item) => item.key === previous)) {
      catalogSelect.value = previous;
    }

    const selected = catalog.find(
      (item) => item.key === catalogSelect.value
    );

    catalogDescription.textContent =
      selected?.preset.description ?? "";

    sourceContainer.replaceChildren();

    if (selected?.preset.source) {
      const link = element(
        "a",
        null,
        selected.preset.source.title
      );

      link.href = selected.preset.source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      sourceContainer.append(link);
    }

    syncControls();
  }

  function renderQueue() {
    queueContainer.replaceChildren();

    if (queue.length === 0) {
      queueContainer.append(element(
        "p",
        "preset-library-note",
        "No presets selected. Add one or more presets above."
      ));
      return;
    }

    queue.forEach((entry, index) => {
      const row = element("div", "preset-library-queue-row");
      const label = element("div", "preset-library-queue-label");

      label.append(
        element("strong", null, `${index + 1}. ${entry.preset.name}`),
        element(
          "span",
          null,
          index === 0 ? "Highest priority · loads last" : ""
        )
      );

      const controls = element(
        "div",
        "preset-library-queue-actions"
      );

      for (const [symbol, title, change] of [
        ["↑", "Move higher priority", -1],
        ["↓", "Move lower priority", 1],
      ]) {
        const button = element("button", "btn btn-default", symbol);
        const target = index + change;

        button.type = "button";
        button.title = title;
        button.dataset.queueAction = "move";
        button.dataset.queueDisabled = String(
          target < 0 || target >= queue.length
        );
        button.setAttribute(
          "aria-label",
          `${title}: ${entry.preset.name}`
        );

        button.addEventListener("click", () => {
          if (locked()) return;

          const next = [...queue];

          [next[index], next[target]] = [next[target], next[index]];

          queue = next;
          changedQueue();
        });

        controls.append(button);
      }

      const remove = element("button", "btn btn-default", "Remove");

      remove.type = "button";
      remove.dataset.queueAction = "remove";
      remove.dataset.queueDisabled = "false";
      remove.setAttribute(
        "aria-label",
        `Remove ${entry.preset.name} from the stack`
      );

      remove.addEventListener("click", () => {
        if (locked()) return;

        queue = queue.filter((item) => item.key !== entry.key);
        changedQueue();
      });

      controls.append(remove);
      row.append(label, controls);
      queueContainer.append(row);
    });

    syncControls();
  }

  function addToQueue(preset) {
    if (queue.length >= 64) {
      throw new Error("The load stack supports at most 64 layers.");
    }

    queue.push({
      key: newKey(),
      preset,
    });

    changedQueue();
  }

  /**
   * Load the manifest and every built-in JSON document.
   * Imported files remain in memory across compatible dataset changes.
   */
  async function initialize(dataset, force = false) {
    if (!force && loadedDataset === dataset && !loading) {
      return;
    }

    if (!force && loading && loadingDataset === dataset) {
      return;
    }

    const token = ++generation;

    loading = true;
    loadingDataset = dataset;
    loadedDataset = null;
    catalog = [];
    queue = [];
    changedQueue();
    renderCatalog();
    message("Loading built-in JSON presets...");

    try {
      const builtins = await loadPresetCatalog(
        dataset,
        readJson
      );

      if (
        token !== generation ||
        context()?.dataset !== dataset
      ) {
        return;
      }

      const nextCatalog = builtins.map(
        (preset) => catalogItem(preset, "Built-in")
      );

      let incompatibleImports = 0;

      for (const raw of importedDocuments) {
        try {
          const presets = readPresetDocument(raw, dataset);

          for (const preset of presets) {
            nextCatalog.push(
              catalogItem(preset, "Local file")
            );
          }
        } catch {
          incompatibleImports += 1;
        }
      }

      catalog = nextCatalog;
      loadedDataset = dataset;

      renderCatalog();

      message(
        `Loaded ${builtins.length} built-in presets.` +
        (
          incompatibleImports > 0
            ? ` ${incompatibleImports} imported documents are ` +
              "unavailable for this dataset."
            : ""
        )
      );
    } catch (error) {
      if (token !== generation) return;

      loadedDataset = dataset;

      message(
        `Built-in presets could not be loaded: ${error.message}`
      );
    } finally {
      if (token === generation) {
        loading = false;
        loadingDataset = null;
        renderCatalog();
        renderQueue();
        syncControls();
      }
    }
  }

  function showReview(nextPlan) {
    review.replaceChildren();

    review.append(element(
      "p",
      null,
      `${nextPlan.applied.length} layers; ` +
      `${nextPlan.affectedCountyCount} affected counties; ` +
      `${nextPlan.changedCountyCount} net county changes; ` +
      `${nextPlan.stateCount} resulting states.`
    ));

    review.append(element(
      "p",
      "preset-library-note",
      `Execution order: ${
        nextPlan.applied.map((item) => item.name).join(" → ")
      }`
    ));

    if (nextPlan.conflicts.length > 0) {
      const details = element("details");
      const summary = element(
        "summary",
        null,
        `${nextPlan.conflicts.length} assignment overrides`
      );
      const list = element("div", "preset-library-conflicts");

      for (const conflict of nextPlan.conflicts.slice(0, 200)) {
        list.append(element(
          "div",
          null,
          `${conflict.countyId}: ${conflict.earlier} → ` +
          `${conflict.later} (${conflict.from} → ${conflict.to})`
        ));
      }

      if (nextPlan.conflicts.length > 200) {
        list.append(element(
          "p",
          "preset-library-note",
          `Showing the first 200 of ${nextPlan.conflicts.length} overrides.`
        ));
      }

      details.append(summary, list);
      review.append(details);
    } else {
      review.append(element(
        "p",
        "preset-library-note",
        "No conflicting county assignments between the selected layers."
      ));
    }

    review.hidden = false;
  }

  catalogSelect.addEventListener("change", renderCatalog);

  find("#presets-reload").addEventListener("click", () => {
    const current = context();

    if (current && !locked()) {
      initialize(current.dataset, true);
    }
  });

  find("#presets-add").addEventListener("click", () => {
    if (locked()) return;

    const item = catalog.find(
      (candidate) => candidate.key === catalogSelect.value
    );

    if (!item) return;

    try {
      addToQueue(item.preset);
      message(`${item.preset.name} added to the stack.`);
    } catch (error) {
      message(error.message);
    }
  });

  baseSelect.addEventListener("change", invalidate);

  find("#presets-preview").addEventListener("click", () => {
    const current = context();

    if (!current || locked()) return;

    try {
      const nextPlan = createPresetPlan(
        current.dataset,
        current.session.getSnapshot(),
        queue,
        { base: baseSelect.value }
      );

      plan = nextPlan;
      planContext = current;
      reviewedQueueVersion = queueVersion;

      showReview(nextPlan);
      syncControls();

      message("Review the result and any overrides before applying.");
    } catch (error) {
      invalidate();
      message(error.message);
    }
  });

  applyButton.addEventListener("click", () => {
    const current = context();

    if (
      !current ||
      locked() ||
      !plan ||
      current.session !== planContext?.session ||
      current.dataset !== planContext?.dataset ||
      current.session.getSnapshot() !== plan.snapshot ||
      reviewedQueueVersion !== queueVersion ||
      baseSelect.value !== plan.base
    ) {
      invalidate();
      message("The stack or configuration changed. Review it again.");
      return;
    }

    if (!window.confirm(
      `Apply ${plan.applied.length} preset layers to the ` +
      `${plan.base === "original" ? "original" : "current"} ` +
      "configuration? The current arrangement will be replaced."
    )) {
      return;
    }

    try {
      const appliedPlan = plan;

      applyPresetPlan(current.session, appliedPlan);
      invalidate();

      onApplied(appliedPlan);

      message("The reviewed preset stack has been applied.");
    } catch (error) {
      invalidate();
      message(error.message);
    }
  });

  find("#presets-download-stack").addEventListener("click", () => {
    if (locked() || queue.length === 0) return;

    const name = nameInput.value.trim() || "Preset stack";

    const bundle = createPresetBundle(
      queue.map((entry) => entry.preset),
      {
        id: `local:${newKey()}`,
        name,
        description: descriptionInput.value.trim(),
      }
    );

    downloadPresetJson(bundle, presetFilename(name));
    message("Stack JSON download requested.");
  });

  find("#presets-clear").addEventListener("click", () => {
    if (locked()) return;

    queue = [];
    changedQueue();
    message("The load stack has been cleared.");
  });

  find("#presets-save").addEventListener("click", () => {
    const current = context();

    if (!current || locked()) return;

    try {
      const preset = createPresetFromModel(
        current.dataset,
        current.session.getSnapshot().model,
        {
          id: `local:${newKey()}`,
          name: nameInput.value,
          description: descriptionInput.value,
        }
      );

      downloadPresetJson(
        preset,
        presetFilename(preset.name)
      );

      importedDocuments.push(preset);
      catalog.push(catalogItem(preset, "Local file"));
      renderCatalog();

      message(
        "Preset JSON download requested. A copy is also available " +
        "in this browser session's library."
      );
    } catch (error) {
      message(error.message);
    }
  });

  importInput.addEventListener("change", async (event) => {
    const current = context();

    if (!current || locked()) return;

    importing = true;
    syncControls();

    const files = [...event.target.files];

    try {
      const imported = await readPresetFiles(
        files,
        current.dataset
      );

      if (
        context()?.session !== current.session ||
        context()?.dataset !== current.dataset
      ) {
        throw new Error(
          "The dataset changed during import. Import the files again."
        );
      }

      if (queue.length + imported.length > 64) {
        throw new Error("The load stack supports at most 64 layers.");
      }

      // The entire batch is validated before either collection changes.
      for (const preset of imported) {
        importedDocuments.push(preset);
        catalog.push(catalogItem(preset, "Local file"));
        queue.push({
          key: newKey(),
          preset,
        });
      }

      changedQueue();
      renderCatalog();

      message(
        `Imported ${imported.length} preset layers. ` +
        "They were added at the bottom of the stack."
      );
    } catch (error) {
      message(`Import failed: ${error.message}`);
    } finally {
      importing = false;
      importInput.value = "";
      renderCatalog();
      syncControls();
    }
  });

  function close() {
    generation += 1;
    loading = false;
    loadingDataset = null;
    invalidate();

    if (dialog.open) {
      dialog.close();
    }
  }

  find("#presets-close").addEventListener("click", close);
  dialog.addEventListener("close", invalidate);

  opener.addEventListener("click", () => {
    const current = context();

    if (busy || dialog.open || !current) return;

    onOpen();
    invalidate();
    message("");

    dialog.showModal();
    initialize(current.dataset);
  });

  return {
    close,

    refresh() {
      if (!dialog.open) return;

      const current = context();

      if (!current) {
        close();
        return;
      }

      if (
        current.dataset !== loadedDataset &&
        current.dataset !== loadingDataset
      ) {
        initialize(current.dataset);
        return;
      }

      if (
        plan &&
        (
          current.session !== planContext?.session ||
          current.session.getSnapshot() !== plan.snapshot
        )
      ) {
        invalidate();
        message(
          "The configuration changed. Review the stack again."
        );
      }
    },

    setBusy(value) {
      busy = value;
      opener.disabled = value || !context();
      syncControls();
    },

    destroy() {
      destroyed = true;
      close();
      opener.remove();
      dialog.remove();
    },
  };
}