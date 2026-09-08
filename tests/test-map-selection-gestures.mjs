
import test from "node:test";
import assert from "node:assert/strict";

import {
  installMapSelectionGestures,
} from "../js/map/map-selection-gestures.mjs";

function fixture() {
  const listeners = new Map();

  const mapElement = {
    addEventListener(name, fn, capture) {
      listeners.set(name, { fn, capture });
    },

    removeEventListener(name, fn, capture) {
      const entry = listeners.get(name);

      if (
        entry?.fn === fn &&
        entry.capture === capture
      ) {
        listeners.delete(name);
      }
    },

    contains(node) {
      return node.inside === true;
    },
  };

  let selected = new Set(["03001"]);

  const assignments = {
    "01001": "state:AA",
    "01003": "state:AA",
    "02001": "state:BB",
    "02003": "state:BB",
    "03001": "state:CC",
  };

  const excluded = new Set(["02001"]);

  const handlers = {
    onCountyClick(id, event) {
      if (event.shiftKey) {
        const group = excluded.has(id)
          ? [...excluded]
          : Object.keys(assignments).filter((countyId) =>
              !excluded.has(countyId) &&
              assignments[countyId] === assignments[id]
            );

        selected = new Set([...selected, ...group]);
      } else {
        if (selected.has(id)) {
          selected.delete(id);
        } else {
          selected.add(id);
        }
      }
    },

    onStateClick(id, event) {
      if (event.shiftKey) {
        selected = new Set([
          ...selected,
          ...Object.keys(assignments).filter((countyId) =>
            !excluded.has(countyId) &&
            assignments[countyId] === id
          ),
        ]);
      }
    },
  };

  const gestures = installMapSelectionGestures(
    mapElement,
    handlers
  );

  function target(kind, id, inside = true) {
    const attributes = {
      [kind === "county" ? "data-county-id" : "data-state-id"]: id,
    };

    const node = {
      inside,

      getAttribute(name) {
        return attributes[name] ?? null;
      },
    };

    return {
      closest() {
        return node;
      },
    };
  }

  function click(kind, id, shiftKey = true, extra = {}) {
    const event = {
      shiftKey,
      button: 0,
      defaultPrevented: false,
      target: target(kind, id),

      preventDefault() {
        this.defaultPrevented = true;
      },

      stopImmediatePropagation() {
        this.stopped = true;
      },

      ...extra,
    };

    listeners.get("click")?.fn(event);

    return event;
  }

  return {
    click,
    target,
    mapElement,
    listeners,
    gestures,
    selection: () => [...selected].sort(),
  };
}

test("Shift-click selects a modeled state additively and consumes the click", () => {
  const f = fixture();
  const event = f.click("county", "01001");

  assert.deepEqual(
    f.selection(),
    ["01001", "01003", "03001"]
  );

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
});

test("Shift-clicking excluded territory selects the excluded pool", () => {
  const f = fixture();

  f.click("county", "02001");

  assert.deepEqual(
    f.selection(),
    ["02001", "03001"]
  );
});

test("Shift-clicking a state adds only its included counties", () => {
  const f = fixture();

  f.click("state", "state:BB");

  assert.deepEqual(
    f.selection(),
    ["02003", "03001"]
  );
});

test("normal clicks, right-clicks, and blank-space clicks are untouched", () => {
  const f = fixture();

  const normal = f.click("county", "01001", false);
  const right = f.click("county", "01001", true, {
    button: 2,
  });

  const blank = f.click("county", "01001", true, {
    target: {
      closest() {
        return null;
      },
    },
  });

  assert.deepEqual(f.selection(), ["03001"]);

  for (const event of [normal, right, blank]) {
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.stopped, undefined);
  }
});

test("gestures cannot select elements outside the map", () => {
  const f = fixture();

  const event = f.click("county", "01001", true, {
    target: f.target("county", "01001", false),
  });

  assert.equal(event.defaultPrevented, false);
});

test("destroy removes only the installed capture listener", () => {
  const f = fixture();

  assert.equal(f.listeners.get("click").capture, true);

  f.gestures.destroy();

  assert.equal(f.listeners.has("click"), false);
});