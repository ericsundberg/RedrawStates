/**
 * Sortable state details table.
 */

import {
  buildStateTableColumns,
  buildStateTableRows,
  formatStateTableValue,
  sortStateTableRows,
} from "./state-table-model.mjs";

function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
}

export function mountStateTableView() {
  const table = document.getElementById("state-summary");
  const thead = table.querySelector("thead");
  const tbody = document.getElementById("states");

  const controls = element("div", "state-table-controls");

  controls.innerHTML = `
    <label>
      Vote columns
      <select class="form-control" id="table-vote-format">
        <option value="count">Vote counts</option>
        <option value="share">Vote percentages</option>
      </select>
    </label>
    <label>
      Area units
      <select class="form-control" id="table-area-unit">
        <option value="km2">Square kilometers</option>
        <option value="sqmi">Square miles</option>
      </select>
    </label>
  `;

  table.parentElement.insertBefore(controls, table);

  let tableSort = { key: "state", direction: "asc" };
  let voteFormat = "count";
  let areaUnit = "km2";
  let currentTable = null;

  const voteSelect = controls.querySelector("#table-vote-format");
  const areaSelect = controls.querySelector("#table-area-unit");

  function renderTable(snapshot, dataset, allocation) {
    currentTable = [snapshot, dataset, allocation];

    const columns = buildStateTableColumns(dataset, {
      areaUnit,
      voteFormat,
    });

    const rows = buildStateTableRows(snapshot, dataset, allocation);

    const activeColumn = columns.find(
      (column) => column.id === tableSort.key
    ) ?? columns[0];

    const sorted = sortStateTableRows(
      rows,
      activeColumn,
      tableSort.direction
    );

    const headerRow = element("tr");

    for (const column of columns) {
      const header = element("th");
      header.scope = "col";

      if (column.id === tableSort.key) {
        header.setAttribute(
          "aria-sort",
          tableSort.direction === "asc"
            ? "ascending"
            : "descending"
        );
      }

      const button = element(
        "button",
        "state-table-sort",
        column.label
      );

      button.type = "button";
      button.title = `Sort by ${column.label}`;

      if (column.id === tableSort.key) {
        button.append(
          element(
            "span",
            "sort-indicator",
            tableSort.direction === "asc" ? " ▲" : " ▼"
          )
        );
      }

      button.addEventListener("click", () => {
        if (tableSort.key === column.id) {
          tableSort.direction =
            tableSort.direction === "asc" ? "desc" : "asc";
        } else {
          tableSort = {
            key: column.id,
            direction: column.type === "text" ? "asc" : "desc",
          };
        }

        renderTable(snapshot, dataset, allocation);
      });

      header.append(button);
      headerRow.append(header);
    }

    thead.replaceChildren(headerRow);

    const fragment = document.createDocumentFragment();

    for (const row of sorted) {
      const tr = element("tr");

      for (const column of columns) {
        const cell = element("td");
        const value = column.value(row);

        cell.textContent = formatStateTableValue(column, value);

        if (column.id === "state") {
          cell.title = row.state.name;
        }

        if (column.id === "code") {
          cell.className = "state-table-code";
        }

        tr.append(cell);
      }

      fragment.append(tr);
    }

    tbody.replaceChildren(fragment);
  }

  voteSelect.addEventListener("change", () => {
    voteFormat = voteSelect.value;

    if (currentTable) {
      renderTable(...currentTable);
    }
  });

  areaSelect.addEventListener("change", () => {
    areaUnit = areaSelect.value;

    if (currentTable) {
      renderTable(...currentTable);
    }
  });

  return {
    render: renderTable,

    toggleVoteFormat() {
      voteFormat = voteFormat === "count" ? "share" : "count";
      voteSelect.value = voteFormat;

      if (currentTable) {
        renderTable(...currentTable);
      }
    },
  };
}