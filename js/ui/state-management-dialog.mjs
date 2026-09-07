/**
 * Accessible state-management dialog.
 */

function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
}

export function mountStateManagementDialog({
  getManager,
  getDefaultStateId,
  onChange,
  onOpen = () => {},
}) {
  const tools = document.getElementById("map-tools");
  const section = tools.querySelector(".session-controls");

  const opener = element("button", "btn btn-default btn-block", "Manage states");
  opener.type = "button";
  opener.id = "manage-states-button";

  const anchor = section.querySelector(".state-creation");

  if (anchor) {
    anchor.insertAdjacentElement("afterend", opener);
  } else {
    section.append(opener);
  }

  const dialog = element("dialog", "state-manager-dialog");
  dialog.setAttribute("aria-labelledby", "state-manager-title");

  dialog.innerHTML = `
    <div class="state-manager-heading">
      <div>
        <h2 id="state-manager-title">Manage states</h2>
        <p>Create, rename, or dissolve states in the current simulation.</p>
      </div>
      <button type="button" class="workspace-button"
        id="state-manager-close" aria-label="Close state manager">
        &times;
      </button>
    </div>

    <div class="state-manager-content">
      <label for="state-manager-select">State</label>
      <select class="form-control" id="state-manager-select"></select>

      <p id="state-manager-summary" class="state-manager-note"></p>

      <form id="state-manager-edit">
        <div class="state-manager-fields">
          <div>
            <label for="state-manager-name">State name</label>
            <input class="form-control" id="state-manager-name"
              maxlength="120" required>
          </div>
          <div>
            <label for="state-manager-abbreviation">Abbreviation</label>
            <input class="form-control" id="state-manager-abbreviation"
              maxlength="12" required>
          </div>
        </div>

        <p id="state-manager-origin" class="state-manager-note"></p>

        <div class="state-manager-actions">
          <button type="submit" class="btn btn-primary"
            id="state-manager-save">Save changes</button>
          <button type="button" class="btn btn-default"
            id="state-manager-restore">Restore original name</button>
          <button type="button" class="btn btn-default"
            id="state-manager-dissolve">Dissolve state…</button>
        </div>
      </form>

      <section id="state-manager-removal" class="state-manager-removal" hidden>
        <h3>Dissolve state</h3>
        <p id="state-manager-removal-description"></p>

        <label for="state-manager-destination">Reassign counties to</label>
        <select class="form-control" id="state-manager-destination"></select>

        <div class="state-manager-actions">
          <button type="button" class="btn btn-default"
            id="state-manager-review">Review dissolution</button>
          <button type="button" class="btn btn-default"
            id="state-manager-cancel-removal">Cancel</button>
        </div>

        <div id="state-manager-confirmation"
          class="state-manager-confirmation" hidden>
          <p id="state-manager-confirmation-text"></p>
          <button type="button" class="btn btn-danger"
            id="state-manager-confirm">Confirm dissolution</button>
        </div>
      </section>

      <p id="state-manager-status" class="state-manager-status"
        role="status" aria-live="polite"></p>
    </div>
  `;

  document.body.append(dialog);

  const select = dialog.querySelector("#state-manager-select");
  const editForm = dialog.querySelector("#state-manager-edit");
  const nameInput = dialog.querySelector("#state-manager-name");
  const abbreviationInput = dialog.querySelector("#state-manager-abbreviation");
  const saveButton = dialog.querySelector("#state-manager-save");
  const restoreButton = dialog.querySelector("#state-manager-restore");
  const dissolveButton = dialog.querySelector("#state-manager-dissolve");
  const summary = dialog.querySelector("#state-manager-summary");
  const origin = dialog.querySelector("#state-manager-origin");
  const removal = dialog.querySelector("#state-manager-removal");
  const removalDescription = dialog.querySelector(
    "#state-manager-removal-description"
  );
  const destination = dialog.querySelector("#state-manager-destination");
  const confirmation = dialog.querySelector("#state-manager-confirmation");
  const confirmationText = dialog.querySelector(
    "#state-manager-confirmation-text"
  );
  const status = dialog.querySelector("#state-manager-status");

  let manager = null;
  let selectedId = null;
  let pending = null;
  let renderedManager = null;
  let renderedRevision = null;

  function setMessage(message) {
    status.textContent = message;
  }

  function getRows() {
    return manager.listStates();
  }

  function hideRemoval() {
    pending = null;
    removal.hidden = true;
    confirmation.hidden = true;
    editForm.hidden = false;
    select.disabled = false;
  }

  function render() {
    manager = getManager();

    if (!manager) return;

    const snapshot = manager.getSnapshot();
    const rows = getRows();

    renderedManager = manager;
    renderedRevision = snapshot.revision;

    if (
      selectedId !== null &&
      !rows.some((state) => state.id === selectedId)
    ) {
      selectedId = rows[0]?.id ?? null;
    }

    if (selectedId === null && select.value !== "") {
      selectedId = rows[0]?.id ?? null;
    }

    select.replaceChildren();

    const newOption = element("option", null, "Create a new state");
    newOption.value = "";
    select.append(newOption);

    for (const state of rows) {
      const option = element(
        "option",
        null,
        `${state.name} (${state.abbreviation})`
      );

      option.value = state.id;
      select.append(option);
    }

    select.value = selectedId ?? "";

    summary.textContent = `${rows.length} states in the current configuration.`;

    hideRemoval();

    if (selectedId === null) {
      nameInput.value = "";
      abbreviationInput.value = "";
      saveButton.textContent = "Create state";
      restoreButton.hidden = true;
      dissolveButton.hidden = true;
      origin.textContent =
        "A new state starts empty. Move counties into it using the map.";
      return;
    }

    const state = rows.find((item) => item.id === selectedId);

    nameInput.value = state.name;
    abbreviationInput.value = state.abbreviation;
    saveButton.textContent = "Save changes";

    origin.textContent = state.isOriginal
      ? `Original state · ${state.countyCount} counties · Stable ID: ${state.id}`
      : `Hypothetical state · ${state.countyCount} counties · Stable ID: ${state.id}`;

    restoreButton.hidden = !state.isOriginal;
    restoreButton.disabled = !state.nameChanged;

    dissolveButton.hidden = false;
    dissolveButton.disabled = rows.length <= 1;
  }

  function refresh() {
    if (!dialog.open) return;

    const current = getManager();

    if (!current) {
      close();
      return;
    }

    if (
      current !== renderedManager ||
      current.getSnapshot().revision !== renderedRevision
    ) {
      render();
    }
  }

  function commit(action, makeChange) {
    const before = manager.getSnapshot();

    try {
      const result = action();
      const change = makeChange(result);
      const after = manager.getSnapshot();

      if (after !== before) {
        onChange(change);
      }

      render();
      setMessage(
        after === before ? "No changes to save." : change.message
      );
    } catch (error) {
      setMessage(error.message);
    }
  }

  select.addEventListener("change", () => {
    selectedId = select.value || null;
    render();
    setMessage("");
  });

  editForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const values = {
      name: nameInput.value.trim(),
      abbreviation: abbreviationInput.value.trim(),
    };

    if (selectedId === null) {
      commit(
        () => manager.create(values),
        (result) => {
          selectedId = result.state.id;

          return {
            type: "create",
            stateId: result.state.id,
            message: `Created ${result.state.name}.`,
          };
        }
      );
      return;
    }

    const stateId = selectedId;

    commit(
      () => manager.rename(stateId, values),
      () => ({
        type: "rename",
        stateId,
        message: "State name updated.",
      })
    );
  });

  restoreButton.addEventListener("click", () => {
    const stateId = selectedId;

    commit(
      () => manager.restoreName(stateId),
      () => ({
        type: "rename",
        stateId,
        message: "Original state name restored.",
      })
    );
  });

  dissolveButton.addEventListener("click", () => {
    const rows = getRows();
    const source = rows.find((state) => state.id === selectedId);

    if (!source || rows.length <= 1) return;

    pending = null;
    confirmation.hidden = true;
    editForm.hidden = true;
    select.disabled = true;
    removal.hidden = false;

    removalDescription.textContent = source.countyCount === 0
      ? `${source.name} is empty and can be removed without moving counties.`
      : `${source.name} contains ${source.countyCount} counties. Choose a destination for all of them.`;

    destination.replaceChildren();

    if (source.countyCount === 0) {
      const option = element("option", null, "No reassignment needed");
      option.value = "";
      destination.append(option);
      destination.disabled = true;
    } else {
      destination.disabled = false;

      for (const state of rows) {
        if (state.id === source.id) continue;

        const option = element(
          "option",
          null,
          `${state.name} (${state.abbreviation})`
        );

        option.value = state.id;
        destination.append(option);
      }

      const preferred = getDefaultStateId();

      if (
        rows.some((state) =>
          state.id === preferred && state.id !== source.id
        )
      ) {
        destination.value = preferred;
      }
    }

    setMessage("");
  });

  destination.addEventListener("change", () => {
    pending = null;
    confirmation.hidden = true;
  });

  dialog.querySelector("#state-manager-review").addEventListener(
    "click",
    () => {
      try {
        pending = manager.previewDissolution(
          selectedId,
          destination.value || null
        );

        const count = pending.countyIds.length;

        confirmationText.textContent = count === 0
          ? `Remove ${pending.source.name}? No counties will be reassigned.`
          : `Remove ${pending.source.name} and reassign all ${count} counties to ${pending.destination.name}? This will also remove the state from the current configuration.`;

        confirmation.hidden = false;
        setMessage("");
      } catch (error) {
        pending = null;
        confirmation.hidden = true;
        setMessage(error.message);
      }
    }
  );

  dialog.querySelector("#state-manager-confirm").addEventListener(
    "click",
    () => {
      if (!pending) return;

      const plan = pending;

      commit(
        () => manager.dissolve(plan),
        () => {
          selectedId = plan.destinationId ||
            manager.getSnapshot().model.states[0].id;

          return {
            type: "dissolve",
            stateId: plan.stateId,
            destinationId: plan.destinationId,
            message: `Dissolved ${plan.source.name}.`,
          };
        }
      );
    }
  );

  dialog.querySelector("#state-manager-cancel-removal").addEventListener(
    "click",
    () => {
      hideRemoval();
      setMessage("");
    }
  );

  function close() {
    pending = null;

    if (dialog.open) {
      dialog.close();
    }
  }

  dialog.querySelector("#state-manager-close").addEventListener(
    "click",
    close
  );

  dialog.addEventListener("close", () => {
    pending = null;
  });

  opener.addEventListener("click", () => {
    if (dialog.open) return;

    manager = getManager();

    if (!manager) return;

    selectedId = getDefaultStateId() || null;
    onOpen();
    render();
    setMessage("");
    dialog.showModal();
    nameInput.focus();
  });

  return Object.freeze({
    refresh,
    close,

    setBusy(busy) {
      opener.disabled = busy || !getManager();
    },

    destroy() {
      close();
      opener.remove();
      dialog.remove();
    },
  });
}