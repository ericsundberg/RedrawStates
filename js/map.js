/**
 * RedrawStates application entry point.
 */

for (const href of [
  "css/map-session.css",
  "css/map-color-legend.css",
  "css/map-enhancements.css",
  "css/state-management.css",
]) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = href;
  document.head.append(stylesheet);
}

import("./map/map-app.mjs")
  .then(({ startMapApp }) => startMapApp())
  .catch((error) => {
    console.error("RedrawStates could not start:", error);

    const message = document.createElement("p");
    message.className = "alert alert-danger";
    message.textContent = `The map could not start: ${error.message}`;

    document.getElementById("states-div")?.append(message);
  });