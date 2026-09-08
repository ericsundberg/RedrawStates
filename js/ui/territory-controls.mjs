/**
 * Excluded-territory controls. Existing bulk controls remain unchanged.
 */

export function mountTerritoryControls({
  container,
  getContext,
  onExclude,
  onSelectExcluded,
  onRestore,
  onReadd,
  onSave,
  onLoad,
  onStatus,
}) {
  if (!container || typeof getContext !== "function") {
    throw new TypeError(
      "A territory controls container and context are required."
    );
  }

  const section = document.createElement("section");
  section.className = "map-bulk-controls territory-controls";

  const heading = document.createElement("h3");
  heading.textContent = "US territory";

  const description = document.createElement("p");
  description.textContent =
    "Excluded counties remain on the map but do not count toward US totals or electoral allocation.";

  const summary = document.createElement("p");
  summary.className = "tools-description";
  summary.setAttribute("role", "status");
  summary.setAttribute("aria-live", "polite");

  const actions = document.createElement("div");
  actions.className = "map-bulk-actions";

  function button(label, title) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "btn btn-default";
    node.textContent = label;
    node.title = title;
    return node;
  }

  const exclude = button(
    "Remove selected from US",
    "Exclude selected counties from US totals."
  );

  exclude.classList.add("btn-warning");

  const select = button(
    "Select excluded",
    "Add all excluded counties to the selection."
  );

  const restore = button(
    "Restore previous state",
    "Re-add selected excluded counties to their previous states."
  );

  const readd = button(
    "Re-add to destination",
    "Re-add selected counties to the destination state."
  );

  const save = button(
    "Save scenario JSON",
    "Save boundaries, excluded counties, and restoration history."
  );

  const load = button(
    "Load scenario JSON",
    "Open a saved territory scenario."
  );

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.hidden = true;

  actions.append(
    exclude,
    select,
    restore,
    readd,
    save,
    load,
    fileInput
  );

  const saveNote = document.createElement("p");
  saveNote.className = "tools-description";
  saveNote.textContent =
    "Save scenario JSON retains exclusions and restoration history. Legacy preset JSON stores boundaries only.";

  section.append(
    heading,
    description,
    summary,
    actions,
    saveNote
  );

  container.append(section);

  let busy = false;
  let destroyed = false;

  const context = () => getContext() ?? {};

  const ready = (value) =>
    !destroyed &&
    !busy &&
    !value.loading &&
    Boolean(value.session);

  function refresh() {
    if (destroyed) return;

    const value = context();
    const enabled = ready(value);
    const total = value.excludedCount ?? 0;
    const population = value.excludedTotals?.population;

    const populationText = population == null
      ? "population unavailable"
      : `${population.toLocaleString()} people`;

    summary.textContent =
      `${total.toLocaleString()} counties outside the US · ${populationText}.`;

    exclude.disabled = !enabled || !value.selectedCount;
    select.disabled = !enabled || !total;
    restore.disabled = !enabled || !value.excludedSelectedCount;
    readd.disabled =
      !enabled || !value.selectedCount || !value.destinationId;
    save.disabled = !enabled;
    load.disabled = !enabled;
  }

  function invoke(callback) {
    if (!ready(context())) return;

    try {
      callback();
      refresh();
    } catch (error) {
      onStatus(error.message);
    }
  }

  exclude.addEventListener("click", () => invoke(onExclude));
  select.addEventListener("click", () => invoke(onSelectExcluded));
  restore.addEventListener("click", () => invoke(onRestore));
  readd.addEventListener("click", () => invoke(onReadd));
  save.addEventListener("click", () => invoke(onSave));

  load.addEventListener("click", () => {
    if (ready(context())) {
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];

    if (!file || !ready(context())) return;

    busy = true;
    refresh();

    try {
      await onLoad(file);
    } catch (error) {
      onStatus(error.message);
    } finally {
      fileInput.value = "";
      busy = false;
      refresh();
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
      section.remove();
    },
  });
}