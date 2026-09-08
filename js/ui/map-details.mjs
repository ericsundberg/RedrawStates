/**
 * Workspace controls, electoral summary, and sortable state details.
 */

import { mountMapControls } from "./map-controls.mjs";
import { mountStateTableView } from "./state-table-view.mjs";
import { mountElectoralBar } from "./electoral-bar.mjs";

const numberFormat = new Intl.NumberFormat("en-US");

export function mountMapDetails(actions) {
  const controls = mountMapControls(actions);
  const table = mountStateTableView();
  const bar = mountElectoralBar();

  return {
    setStatus: controls.setStatus,
    setDestination: controls.setDestination,
    getDestination: controls.getDestination,
    setBusy: controls.setBusy,
    toggleVoteFormat: table.toggleVoteFormat,

    render(viewState) {
      controls.render(viewState);

      const {
        snapshot,
        dataset,
        allocation,
        summary,
      } = viewState;

      table.render(snapshot, dataset, allocation);
      bar.render(snapshot, dataset, allocation, summary);

      document.querySelector(".summary-caption").textContent =
        allocation.status === "available"
          ? `${numberFormat.format(allocation.totalElectors)} modeled electors`
          : "Allocation unavailable";

      document.getElementById("legacy-model-note").textContent =
        "This is a hypothetical allocation using recorded aggregate " +
        "vote buckets. Map filters change presentation only, not " +
        "the underlying votes or electoral allocation.";
    },
  };
}