import test from "node:test";
import assert from "node:assert/strict";

import {
  mountMapBulkControls,
} from "../js/ui/map-bulk-controls.mjs";

function element(tag) {
  return {
    tag,
    children: [],
    disabled: false,
    textContent: "",
    classList: {
      add() {},
    },
    attributes: {},
    listeners: {},

    append(...nodes) {
      this.children.push(...nodes);
    },

    remove() {
      this.removed = true;
    },

    setAttribute(key, value) {
      this.attributes[key] = value;
    },

    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },

    removeEventListener(name, callback) {
      if (this.listeners[name] === callback) {
        delete this.listeners[name];
      }
    },

    click() {
      this.listeners.click?.();
    },
  };
}

function fixture() {
  const mapElement = element("svg");

  globalThis.document = {
    createElement: element,
    getElementById(id) {
      return id === "states-svg" ? mapElement : null;
    },
  };

  let approved = true;

  globalThis.window = {
    confirm: () => approved,
  };

  const container = element("div");
  let selected = [];
  let commits = 0;
  let status = "";

  const original = {
    states: [
      { id: "state:AA" },
      { id: "state:BB" },
    ],
  };

  const merged = {
    states: [
      { id: "custom:united-states-of-america" },
    ],
  };

  let model = original;

  const manager = {
    previewDissolveAll: () => ({
      model,
      nextModel: model === original ? merged : model,
      sourceStateCount: model.states.length,
      countyCount: 3,
    }),

    dissolveAll(plan) {
      assert.equal(plan.model, model);

      model = plan.nextModel;
      commits++;

      return { model };
    },
  };

  const controls = mountMapBulkControls({
    container,
    mapElement,

    getContext: () => ({
      manager,
      loading: false,
      selectedCount: selected.length,
      anchorCountyId: "01001",
    }),

    onSelectState: (id) => {
      selected = [id, "01003"];
    },

    onClearSelection: () => {
      selected = [];
    },

    onDissolved: () => {
      status = "Dissolved";
    },

    onStatus: (message) => {
      status = message;
    },
  });

  const buttons = container.children[0].children[2].children;

  function rightClick() {
    let prevented = false;

    mapElement.listeners.contextmenu?.({
      preventDefault() {
        prevented = true;
      },
    });

    return prevented;
  }

  return {
    controls,
    buttons,
    mapElement,
    rightClick,
    getSelected: () => selected,
    getCommits: () => commits,
    getStatus: () => status,

    setApproved(value) {
      approved = value;
    },

    setSelected(value) {
      selected = [...value];
      controls.refresh();
    },
  };
}

test("selection and clear controls call their host callbacks", () => {
  const f = fixture();

  f.buttons[0].click();

  assert.deepEqual(
    f.getSelected(),
    ["01001", "01003"]
  );

  f.buttons[1].click();

  assert.deepEqual(f.getSelected(), []);
});

test("right-click clears every selected county", () => {
  const f = fixture();

  f.setSelected(["01001", "01003", "02001"]);

  assert.equal(f.rightClick(), true);
  assert.deepEqual(f.getSelected(), []);
  assert.equal(f.getCommits(), 0);
});

test("right-click preserves the browser menu when selection is empty", () => {
  const f = fixture();

  assert.equal(f.rightClick(), false);
  assert.deepEqual(f.getSelected(), []);
});

test("right-click does not clear while controls are busy", () => {
  const f = fixture();

  f.setSelected(["01001"]);
  f.controls.setBusy(true);

  assert.equal(f.rightClick(), false);
  assert.deepEqual(f.getSelected(), ["01001"]);
});

test("dissolution requires confirmation and commits only once", () => {
  const f = fixture();

  f.setApproved(false);
  f.buttons[2].click();

  assert.equal(f.getCommits(), 0);

  f.setApproved(true);
  f.buttons[2].click();

  assert.equal(f.getCommits(), 1);

  f.buttons[2].click();

  assert.equal(f.getCommits(), 1);
  assert.match(f.getStatus(), /already one/);
});

test("busy controls are disabled", () => {
  const f = fixture();

  f.controls.setBusy(true);

  assert.ok(
    f.buttons.every((button) => button.disabled)
  );
});

test("destroy removes the map context-menu listener", () => {
  const f = fixture();

  assert.equal(
    typeof f.mapElement.listeners.contextmenu,
    "function"
  );

  f.controls.destroy();

  assert.equal(
    f.mapElement.listeners.contextmenu,
    undefined
  );
});