/**
 * Local preset library and ordered, transactional load stack.
 */

import { createBuiltinPresets } from "../presets/builtin-presets.mjs";

import {
  applyPresetPlan,
  createPresetBundle,
  createPresetFromModel,
  createPresetPlan,
  normalizePreset,
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
          Downloads the changes from the original configuration, not
          a complete national assignment table. No data is sent to a server.
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

  const catalogSelect = dialog.querySelector("#presets-catalog");
  const catalogDescription = dialog.querySelector("#presets-description");
  const sourceContainer = dialog.querySelector("#presets-source");
  const queueContainer = dialog.querySelector("#presets-queue");
  const baseSelect = dialog.querySelector("#presets-base");
  const review = dialog.querySelector("#presets-review");
  const applyButton = dialog.querySelector("#presets-apply");
  const status = dialog.querySelector("#presets-status");
  const nameInput = dialog.querySelector("#presets-name");
  const descriptionInput = dialog.querySelector(
    "#presets-description-input"
  );
  const importInput = dialog.querySelector("#presets-import");

  let catalog = [];
  let importedDocuments = [];
  let queue = [];
  let plan = null;
  let planContext = null;
  let catalogDataset = null;
  let busy = false;
  let importing = false;

  function context() {
    return getContext();
  }

  function message(value) {
    status.textContent = value;
  }

  function invalidate() {
    plan = null;
    planContext = null;
    applyButton.disabled = true;
    review.hidden = true;
    review.replaceChildren();
  }

  function catalogItem(preset, origin) {
    return {
      key: newKey(),
      preset,
      origin,
    };
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

    dialog.querySelector("#presets-add").disabled =
      busy || importing || !selected;

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
          index === 0
            ? "Highest priority · loads last"
            : ""
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

        button.type = "button";
        button.title = title;
        button.setAttribute(
          "aria-label",
          `${title}: ${entry.preset.name}`
        );

        const target = index + change;

        button.disabled =
          busy || target < 0 || target >= queue.length;

        button.addEventListener("click", () => {
          const next = [...queue];

          [next[index], next[target]] = [next[target], next[index]];

          queue = next;
          invalidate();
          renderQueue();
        });

        controls.append(button);
      }

      const remove = element("button", "btn btn-default", "Remove");

      remove.type = "button";
      remove.disabled = busy;
      remove.setAttribute(
        "aria-label",
        `Remove ${entry.preset.name} from the stack`
      );

      remove.addEventListener("click", () => {
        queue = queue.filter((item) => item.key !== entry.key);
        invalidate();
        renderQueue();
      });

      controls.append(remove);
      row.append(label, controls);
      queueContainer.append(row);
    });
  }

  function addToQueue(preset) {
    if (queue.length >= 64) {
      throw new Error("The load stack supports at most 64 layers.");
    }

    queue.push({
      key: newKey(),
      preset,
    });

    invalidate();
    renderQueue();
  }

  function initialize() {
    const current = context();

    if (!current || current.dataset === catalogDataset) {
      return;
    }

    catalogDataset = current.dataset;
    catalog = [];
    queue = [];
    invalidate();

    try {
      for (const preset of createBuiltinPresets(current.dataset)) {
        catalog.push(catalogItem(preset, "Built-in"));
      }
    } catch (error) {
      message(`Built-in presets unavailable: ${error.message}`);
    }

    // Preserve imported documents in memory, but only display compatible
    // ones for the current dataset. Nothing is applied automatically.
    for (const raw of importedDocuments) {
      try {
        const presets = readPresetDocument(raw, current.dataset);

        for (const preset of presets) {
          catalog.push(catalogItem(preset, "Local file"));
        }
      } catch {
        // The file remains in memory for a compatible dataset.
      }
    }

    renderCatalog();
    renderQueue();
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

      // Keep the dialog responsive even for unusually large mod stacks.
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

  dialog.querySelector("#presets-add").addEventListener("click", () => {
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

  dialog.querySelector("#presets-preview").addEventListener(
    "click",
    () => {
      const current = context();

      if (!current) return;

      try {
        const nextPlan = createPresetPlan(
          current.dataset,
          current.session.getSnapshot(),
          queue,
          { base: baseSelect.value }
        );

        plan = nextPlan;
        planContext = current;
        showReview(nextPlan);
        applyButton.disabled = false;

        message(
          "Review the result and any overrides before applying."
        );
      } catch (error) {
        invalidate();
        message(error.message);
      }
    }
  );

  applyButton.addEventListener("click", () => {
    const current = context();

    if (
      !current ||
      !plan ||
      current.session !== planContext?.session ||
      current.dataset !== planContext?.dataset
    ) {
      invalidate();
      message("Review the stack again before applying.");
      return;
    }

    if (
      current.session.getSnapshot() !== plan.snapshot
    ) {
      invalidate();
      message("The configuration changed. Review the stack again.");
      return;
    }

    if (!window.confirm(
      `Apply ${plan.applied.length} preset layers to the ` +
      `${baseSelect.value === "original" ? "original" : "current"} ` +
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

  dialog.querySelector("#presets-download-stack").addEventListener(
    "click",
    () => {
      if (queue.length === 0) {
        message("Add at least one preset to the stack first.");
        return;
      }

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
    }
  );

  dialog.querySelector("#presets-clear").addEventListener(
    "click",
    () => {
      queue = [];
      invalidate();
      renderQueue();
      message("The load stack has been cleared.");
    }
  );

  dialog.querySelector("#presets-save").addEventListener(
    "click",
    () => {
      const current = context();

      if (!current) return;

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

        // Keep a copy available until this browser session ends.
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
    }
  );

  importInput.addEventListener("change", async (event) => {
    const current = context();

    if (!current) return;

    importing = true;
    dialog.querySelector("#presets-add").disabled = true;

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

      // All files have been validated before the library is changed.
      for (const preset of imported) {
        importedDocuments.push(preset);
        catalog.push(catalogItem(preset, "Local file"));
        addToQueue(preset);
      }

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
    }
  });

  function close() {
    invalidate();

    if (dialog.open) {
      dialog.close();
    }
  }

  dialog.querySelector("#presets-close").addEventListener(
    "click",
    close
  );

  dialog.addEventListener("close", invalidate);

  opener.addEventListener("click", () => {
    if (busy || dialog.open || !context()) return;

    onOpen();
    initialize();
    invalidate();
    renderCatalog();
    renderQueue();
    message("");

    dialog.showModal();
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

      if (current.dataset !== catalogDataset) {
        initialize();
        message(
          "The dataset changed. Rebuild the stack for the new dataset."
        );
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

      for (const control of dialog.querySelectorAll(
        "button, input, select, textarea"
      )) {
        control.disabled = value;
      }

      if (!value) {
        applyButton.disabled = !plan;
        renderCatalog();
        renderQueue();
      }
    },

    destroy() {
      close();
      opener.remove();
      dialog.remove();
    },
  };
}