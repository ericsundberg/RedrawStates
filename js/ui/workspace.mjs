/**
 * Docked workspace controller.
 *
 * This module owns interface layout only. Geographic assignments,
 * map rendering, and election calculations remain in their own modules.
 */

import {
  PANEL_IDS,
  clampDockHeight,
  dockHeightFromPercentage,
  dockPercentageFromHeight,
  normalizePanelId,
} from "./workspace-layout.mjs";

function setupWorkspace(root) {
  if (!root || root.dataset.workspaceReady === "true") {
    return;
  }

  root.dataset.workspaceReady = "true";

  const stage = root.querySelector("#map-stage");
  const tools = root.querySelector("#map-tools");
  const toolsToggle = root.querySelector("#tools-toggle");
  const toolsClose = root.querySelector("#tools-close");

  const dock = root.querySelector("#workspace-dock");
  const splitter = root.querySelector("#dock-splitter");
  const dockSize = root.querySelector("#dock-size");
  const dockTitle = root.querySelector("#dock-title");
  const dockToggle = root.querySelector("#dock-toggle");
  const dockCollapse = root.querySelector("#dock-collapse");

  const tabList = root.querySelector(".workspace-tab-list");
  const tabs = Array.from(root.querySelectorAll(".workspace-tab"));

  const panels = new Map(
    PANEL_IDS.map((id) => [
      id,
      root.querySelector(`#panel-${id}`),
    ])
  );

  const titles = {
    details: "Details",
    instructions: "Instructions",
    about: "About",
  };

  let activePanel = "details";
  let collapsed = false;
  let dockHeight = root.clientHeight * 0.34;
  let previousDockHeight = dockHeight;
  let dragging = false;
  let dragStartY = 0;
  let dragStartHeight = 0;

  function setToolsOpen(open) {
    tools.hidden = !open;
    stage.classList.toggle("tools-hidden", !open);
    toolsToggle.setAttribute("aria-expanded", String(open));
    toolsToggle.setAttribute(
      "aria-label",
      open ? "Hide map controls" : "Show map controls"
    );
  }

  function applyDockHeight(height) {
    dockHeight = clampDockHeight(height, root.clientHeight);

    if (!collapsed) {
      previousDockHeight = dockHeight;
    }

    root.style.setProperty(
      "--workspace-dock-height",
      `${dockHeight}px`
    );

    const percentage = dockPercentageFromHeight(
      dockHeight,
      root.clientHeight
    );

    dockSize.value = String(percentage);
    splitter.setAttribute("aria-valuenow", String(percentage));
    splitter.setAttribute(
      "aria-valuetext",
      `${Math.round(dockHeight)} pixels`
    );
  }

  function setCollapsed(nextCollapsed) {
    if (collapsed === nextCollapsed) {
      return;
    }

    if (nextCollapsed) {
      previousDockHeight = dockHeight;
    }

    collapsed = nextCollapsed;

    root.classList.toggle("is-dock-collapsed", collapsed);
    dock.hidden = collapsed;
    splitter.hidden = collapsed;

    dockToggle.setAttribute("aria-expanded", String(!collapsed));
    dockToggle.textContent = collapsed ? "Show pane" : "Hide pane";

    if (!collapsed) {
      applyDockHeight(previousDockHeight);
    }
  }

  function activatePanel(panelId, focusTab = false) {
    activePanel = normalizePanelId(panelId);

    for (const tab of tabs) {
      const selected = tab.dataset.panel === activePanel;

      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;

      if (selected && focusTab) {
        tab.focus();
      }
    }

    for (const [id, panel] of panels) {
      panel.hidden = id !== activePanel;
    }

    dockTitle.textContent = titles[activePanel];
    setCollapsed(false);
  }

  function resizeFromPointer(event) {
    if (!dragging) {
      return;
    }

    const delta = dragStartY - event.clientY;
    applyDockHeight(dragStartHeight + delta);
  }

  function stopDragging(event) {
    if (!dragging) {
      return;
    }

    dragging = false;
    splitter.classList.remove("is-dragging");

    if (
      event &&
      splitter.hasPointerCapture &&
      splitter.hasPointerCapture(event.pointerId)
    ) {
      splitter.releasePointerCapture(event.pointerId);
    }
  }

  toolsToggle.addEventListener("click", () => {
    setToolsOpen(tools.hidden);
  });

  toolsClose.addEventListener("click", () => {
    setToolsOpen(false);
    toolsToggle.focus();
  });

  const narrowScreen = window.matchMedia("(max-width: 760px)");

  function handleScreenChange(event) {
    setToolsOpen(!event.matches);
  }

  setToolsOpen(!narrowScreen.matches);

  if (narrowScreen.addEventListener) {
    narrowScreen.addEventListener("change", handleScreenChange);
  } else {
    narrowScreen.addListener(handleScreenChange);
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      activatePanel(tab.dataset.panel);
    });
  }

  tabList.addEventListener("keydown", (event) => {
    const currentIndex = tabs.findIndex(
      (tab) => tab.dataset.panel === activePanel
    );

    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    activatePanel(tabs[nextIndex].dataset.panel, true);
  });

  dockToggle.addEventListener("click", () => {
    setCollapsed(!collapsed);
  });

  dockCollapse.addEventListener("click", () => {
    setCollapsed(true);
    dockToggle.focus();
  });

  dockSize.addEventListener("input", () => {
    applyDockHeight(
      dockHeightFromPercentage(
        Number(dockSize.value),
        root.clientHeight
      )
    );
  });

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    dragging = true;
    dragStartY = event.clientY;
    dragStartHeight = dockHeight;

    splitter.classList.add("is-dragging");
    splitter.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  splitter.addEventListener("pointermove", resizeFromPointer);
  splitter.addEventListener("pointerup", stopDragging);
  splitter.addEventListener("pointercancel", stopDragging);

  splitter.addEventListener("keydown", (event) => {
    let nextHeight = dockHeight;

    if (event.key === "ArrowUp") {
      nextHeight += event.shiftKey ? 50 : 20;
    } else if (event.key === "ArrowDown") {
      nextHeight -= event.shiftKey ? 50 : 20;
    } else if (event.key === "Home") {
      nextHeight = 0;
    } else if (event.key === "End") {
      nextHeight = root.clientHeight;
    } else {
      return;
    }

    event.preventDefault();
    applyDockHeight(nextHeight);
  });

  const helpLink = root.querySelector("#instructionsHelper");

  helpLink.addEventListener("click", (event) => {
    event.preventDefault();
    activatePanel("instructions");

    if (narrowScreen.matches) {
      setToolsOpen(false);
    }
  });

  /*
   * The inherited map listens for keyboard shortcuts on document.body.
   * Keep those shortcuts from firing while the user interacts with form
   * fields or workspace controls. Keyup events are left alone so the
   * legacy Q/W held-key state can still be released.
   */
  document.addEventListener("keydown", (event) => {
    if (!/^[mqwp]$/i.test(event.key)) {
      return;
    }

    const target = event.target;
    const isControl = target?.closest?.(
      "input, select, textarea, button, [contenteditable], " +
      "[role='tab'], [role='slider']"
    );

    if (
      isControl ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      event.stopPropagation();
    }
  }, true);

  function handleViewportResize() {
    applyDockHeight(dockHeight);
  }

  window.addEventListener("resize", handleViewportResize);

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(handleViewportResize);
    observer.observe(root);
  }

  applyDockHeight(dockHeight);
  activatePanel("details");
}

const root = document.getElementById("redraw-app");

if (root) {
  setupWorkspace(root);
}