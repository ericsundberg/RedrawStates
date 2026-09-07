/**
 * Legend for vote and numeric map visualizations.
 */

import {
  colorForBucketShare,
  colorForVoteBucket,
  getClassicVoteColor,
  NEUTRAL_VOTE_COLOR,
} from "../map/map-color-scale.mjs";

import {
  AREA_UNITS,
  displayMetricValue,
} from "../map/map-metrics.mjs";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function gradient(colors) {
  return `linear-gradient(to right, ${colors.join(", ")})`;
}

function genericGradient(bucketId) {
  return gradient(
    [0, 0.25, 0.5, 0.75, 1].map(
      (share) => `${colorForBucketShare(bucketId, share)} ${share * 100}%`
    )
  );
}

function classicGradient(context) {
  const stops = [];

  for (let index = 0; index < 20; index++) {
    const color = getClassicVoteColor(context, index / 20);
    stops.push(`${color} ${index * 5}%`);
    stops.push(`${color} ${(index + 1) * 5}%`);
  }

  return gradient(stops);
}

function addRow(parent, label, background) {
  const row = element("div", "map-color-legend-row");
  const strip = element("span", "map-color-legend-strip");

  strip.style.backgroundImage = background;
  strip.setAttribute("aria-hidden", "true");

  row.append(
    element("span", "map-color-legend-label", label),
    strip
  );

  parent.append(row);
}

function addScale(parent, left, middle, right) {
  const scale = element("div", "map-color-legend-scale");

  scale.append(
    element("span", null, left),
    element("span", null, middle),
    element("span", null, right)
  );

  parent.append(scale);
}

export function mountMapColorLegend(tools) {
  const section = element("section", "map-color-legend");
  section.id = "map-color-legend";
  section.setAttribute("aria-label", "Map color legend");

  const metricField = tools.querySelector("#map-metric")?.closest(
    ".tools-field"
  );

  metricField.insertAdjacentElement("afterend", section);

  let signature = "";

  function render({
    dataset,
    metric,
    level,
    voteDisplay,
    scale,
    areaUnit = "km2",
  }) {
    section.hidden = level === "outlines";

    if (section.hidden) return;

    const nextSignature = JSON.stringify({
      dataset: dataset.metadata.id,
      metric,
      level,
      voteDisplay,
      maximum: scale?.maximum,
      areaUnit,
    });

    if (nextSignature === signature) return;

    signature = nextSignature;
    section.replaceChildren();

    section.append(element("h3", null, "Map colors"));

    const rows = element("div", "map-color-legend-rows");
    const fields = dataset.metadata.voteFields;

    if (metric === "votes" && voteDisplay.bucketId === "all") {
      if (voteDisplay.style === "classic") {
        section.append(element(
          "p",
          "map-color-legend-description",
          "Original-style five-point, state-context palette. " +
          "Other-leading records use the expanded gradient."
        ));

        addRow(rows, "Democratic-led state", classicGradient("dem"));
        addRow(rows, "GOP-led state", classicGradient("gop"));
        section.append(rows);
        addScale(section, "0% Dem", "50%", "100% Dem");
      } else {
        const description = voteDisplay.style === "context"
          ? "The state's leading bucket determines hue. " +
            "Intensity is that bucket's local share of all recorded votes."
          : "Each county uses its own leading bucket. " +
            "Intensity is that bucket's share of all recorded votes.";

        section.append(element(
          "p",
          "map-color-legend-description",
          description
        ));

        for (const field of fields) {
          addRow(rows, field.label, genericGradient(field.id));
        }

        section.append(rows);
        addScale(section, "0%", "50%", "100%");
      }
    } else if (metric === "votes") {
      const field = fields.find(
        (item) => item.id === voteDisplay.bucketId
      );

      const label = field?.label ?? voteDisplay.bucketId;

      section.append(element(
        "p",
        "map-color-legend-description",
        voteDisplay.measure === "count"
          ? `${label}: raw vote count. A logarithmic color scale is used.`
          : `${label}: share of all recorded votes. Zero is white.`
      ));

      addRow(rows, label, genericGradient(voteDisplay.bucketId));
      section.append(rows);

      addScale(
        section,
        "0",
        voteDisplay.measure === "count" ? "Log scale" : "50%",
        voteDisplay.measure === "count"
          ? (scale?.maximum ?? 0).toLocaleString()
          : "100%"
      );
    } else {
      const labels = {
        population: "Population",
        density: "Population density",
        land: "Land area",
        area: "Total area",
      };

      const units = AREA_UNITS[areaUnit] ?? AREA_UNITS.km2;
      const maximum = displayMetricValue(
        scale?.maximum ?? null,
        metric,
        areaUnit
      );

      section.append(element(
        "p",
        "map-color-legend-description",
        `${labels[metric]}. ${
          metric === "density" ? "Logarithmic" : "Linear"
        } scale. ${
          dataset.metadata.area?.status === "available"
            ? `Area vintage ${dataset.metadata.areaVintage}.`
            : ""
        }`
      ));

      addRow(
        rows,
        labels[metric],
        gradient([
          "#ffffff 0%",
          "#c6dbef 25%",
          "#6baed6 50%",
          "#3182bd 75%",
          "#2166ac 100%",
        ])
      );

      section.append(rows);

      const suffix = metric === "land" || metric === "area"
        ? units.areaLabel
        : metric === "density"
          ? units.densityLabel
          : "people";

      addScale(
        section,
        "0",
        metric === "density" ? "Log scale" : "",
        maximum == null
          ? "Unavailable"
          : `${maximum.toLocaleString("en-US", {
              maximumFractionDigits: 2,
            })} ${suffix}`
      );
    }

    const neutral = element("div", "map-color-legend-neutral");
    const swatch = element("span", "map-color-legend-neutral-swatch");

    swatch.style.backgroundColor = NEUTRAL_VOTE_COLOR;
    neutral.append(
      swatch,
      element("span", null, "Unavailable, incomplete, or tied data")
    );

    section.append(neutral);
  }

  return {
    render,
    destroy() {
      section.remove();
    },
  };
}