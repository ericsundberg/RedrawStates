/**
 * User-defined regional boundary presets.
 *
 * All references use the original dataset inventory. Presets contain
 * only affected state definitions and county assignments.
 */

import {
  normalizePreset,
  presetGeography,
  PRESET_FORMAT,
  PRESET_VERSION,
} from "./preset-model.mjs";

import {
  countyIdsSouthOfLatitude,
} from "./preset-geography.mjs";

import {
  resolvePresetCounties,
} from "./preset-county-resolver.mjs";

export { resolvePresetCounties };

function originalStateCounties(dataset, stateCode) {
  return dataset.counties
    .filter(
      (county) =>
        county.originalStateId === `state:${stateCode}`
    )
    .map((county) => county.id)
    .sort();
}

function stateDefinition(id, name, abbreviation) {
  return { id, name, abbreviation, kind: "state" };
}

function makePreset(dataset, values) {
  return normalizePreset({
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    geography: presetGeography(dataset),
    sourceDataset: dataset.metadata.id,
    states: [],
    moves: [],
    removeStates: [],
    ...values,
  }, dataset);
}

function movesForNames(dataset, stateCode, names, destinationId) {
  return resolvePresetCounties(dataset, stateCode, names).map(
    (countyId) => [countyId, destinationId]
  );
}

function createSimpleStatePreset(dataset, spec) {
  const stateId = `custom:preset:${spec.slug}`;

  return makePreset(dataset, {
    id: `builtin:${spec.slug}`,
    name: spec.name,
    description: spec.description,
    ...(spec.source ? { source: spec.source } : {}),
    states: [
      stateDefinition(stateId, spec.name, spec.abbreviation),
    ],
    moves: spec.parts.flatMap((part) =>
      movesForNames(
        dataset,
        part.state,
        part.counties,
        stateId
      )
    ),
  });
}

const SIMPLE_PRESETS = [
  {
    slug: "chicagoland",
    name: "Chicagoland",
    abbreviation: "CHI",
    description:
      "Lake, Cook, DuPage, and Will counties, Illinois. " +
      "All other counties remain unchanged.",
    parts: [{
      state: "IL",
      counties: ["Lake", "Cook", "DuPage", "Will"],
    }],
  },
  {
    slug: "superior",
    name: "Superior",
    abbreviation: "SUP",
    description:
      "The 15 counties of Michigan's Upper Peninsula. No northern " +
      "Lower Peninsula, Wisconsin, or Minnesota counties are included.",
    parts: [{
      state: "MI",
      counties: [
        "Alger", "Baraga", "Chippewa", "Delta", "Dickinson",
        "Gogebic", "Houghton", "Iron", "Keweenaw", "Luce",
        "Mackinac", "Marquette", "Menominee", "Ontonagon",
        "Schoolcraft",
      ],
    }],
  },
  {
    slug: "long-island",
    name: "Long Island",
    abbreviation: "LI",
    description:
      "Nassau and Suffolk counties form an independent hypothetical " +
      "state. New York City counties remain in New York.",
    parts: [{
      state: "NY",
      counties: ["Nassau", "Suffolk"],
    }],
  },
  {
    slug: "baja-arizona",
    name: "Baja Arizona",
    abbreviation: "BAZ",
    description:
      "Cochise, Pima, and Santa Cruz counties form Baja Arizona. " +
      "All other Arizona counties remain unchanged.",
    parts: [{
      state: "AZ",
      counties: ["Cochise", "Pima", "Santa Cruz"],
    }],
  },
  {
    slug: "west-kansas",
    name: "West Kansas",
    abbreviation: "WKS",
    description:
      "The exact seventeen-county western Kansas arrangement requested " +
      "for this sandbox. All other Kansas counties remain unchanged.",
    parts: [{
      state: "KS",
      counties: [
        "Morton", "Stanton", "Hamilton", "Kearny", "Grant",
        "Stevens", "Seward", "Haskell", "Finney", "Gray",
        "Meade", "Clark", "Ford", "Hodgeman", "Edwards",
        "Kiowa", "Comanche",
      ],
    }],
  },
  {
    slug: "madawaska",
    name: "Madawaska",
    abbreviation: "MAD",
    description:
      "Aroostook County, Maine, forms Madawaska. This is a modern " +
      "whole-county interpretation inspired by the historical republic, " +
      "not a reconstruction of its original border territory.",
    parts: [{
      state: "ME",
      counties: ["Aroostook"],
    }],
  },
  {
    slug: "west-maryland",
    name: "West Maryland",
    abbreviation: "WMD",
    description:
      "Garrett, Allegany, Washington, Frederick, and Carroll counties " +
      "form West Maryland. Remaining Maryland counties are unchanged.",
    parts: [{
      state: "MD",
      counties: [
        "Garrett", "Allegany", "Washington",
        "Frederick", "Carroll",
      ],
    }],
  },
];

function createWisconsinReattachment(dataset) {
  return makePreset(dataset, {
    id: "builtin:wisconsin-reattachment",
    name: "Wisconsin Reattachment",
    description:
      "Jo Daviess, Stephenson, Winnebago, and Boone counties are " +
      "transferred from Illinois to the existing Wisconsin identity. " +
      "No new state is created.",
    moves: movesForNames(
      dataset,
      "IL",
      ["Jo Daviess", "Stephenson", "Winnebago", "Boone"],
      "state:WI"
    ),
  });
}

export function createSouthGeorgiaPreset(
  dataset,
  selectSouth = countyIdsSouthOfLatitude
) {
  const stateId = "custom:preset:south-georgia";
  const MACON_LATITUDE = 32.8407;

  const bibbId = resolvePresetCounties(
    dataset,
    "GA",
    ["Bibb"]
  )[0];

  const originalIds = new Set(
    originalStateCounties(dataset, "GA")
  );

  const selected = selectSouth(
    dataset,
    "GA",
    MACON_LATITUDE
  );

  if (!Array.isArray(selected)) {
    throw new Error("South Georgia selection must return county IDs.");
  }

  const countyIds = [...new Set(selected)]
    .filter((id) => id !== bibbId)
    .sort();

  for (const id of countyIds) {
    if (!originalIds.has(id)) {
      throw new Error(
        `South Georgia selected a county outside Georgia: ${id}`
      );
    }
  }

  if (
    countyIds.length === 0 ||
    countyIds.length >= originalIds.size
  ) {
    throw new Error("South Georgia produced an invalid county selection.");
  }

  return makePreset(dataset, {
    id: "builtin:south-georgia",
    name: "South Georgia",
    description:
      "A whole-county approximation of the area south of Macon. " +
      "Counties are selected when their geographic centroid lies south " +
      "of approximately 32.8407° N, and Bibb County is explicitly " +
      "retained in North Georgia. Counties crossed by the latitude " +
      "are not split. The remaining original Georgia identity is " +
      "renamed North Georgia and retains the GA abbreviation.",
    states: [
      stateDefinition("state:GA", "North Georgia", "GA"),
      stateDefinition(stateId, "South Georgia", "SGA"),
    ],
    moves: countyIds.map((id) => [id, stateId]),
  });
}

export const WETSYLVANIA_KENTUCKY = Object.freeze({
  fivco: [
    "Boyd", "Carter", "Elliott", "Greenup", "Lawrence",
  ],
  gateway: [
    "Bath", "Menifee", "Montgomery", "Morgan", "Rowan",
  ],
  bigSandy: [
    "Floyd", "Johnson", "Magoffin", "Martin", "Pike",
  ],
  kentuckyRiver: [
    "Breathitt", "Knott", "Lee", "Leslie", "Letcher",
    "Owsley", "Perry", "Wolfe",
  ],
  cumberlandValley: [
    "Bell", "Clay", "Harlan", "Jackson", "Knox",
    "Laurel", "Rockcastle", "Whitley",
  ],
});

function createWetsylvania(dataset) {
  const stateId = "state:WV";

  const kentucky = Object.values(
    WETSYLVANIA_KENTUCKY
  ).flat();

  const kentuckyIds = resolvePresetCounties(
    dataset,
    "KY",
    kentucky
  );

  if (kentuckyIds.length !== 31) {
    throw new Error("The Wetsylvania Kentucky inventory is incomplete.");
  }

  const westVirginiaIds = originalStateCounties(dataset, "WV");

  if (westVirginiaIds.length !== 55) {
    throw new Error(
      "The Wetsylvania preset requires the 55 original West Virginia counties."
    );
  }

  const pennsylvania = movesForNames(
    dataset,
    "PA",
    [
      "Allegheny",
      "Westmoreland",
      "Fayette",
      "Greene",
      "Washington",
    ],
    stateId
  );

  const virginia = movesForNames(
    dataset,
    "VA",
    [
      "Wise",
      "51720",
      "Dickenson",
      "Buchanan",
    ],
    stateId
  );

  return makePreset(dataset, {
    id: "builtin:wetsylvania",
    name: "Wetsylvania",
    description:
      "A user-defined Appalachian arrangement. The existing West Virginia " +
      "identity is renamed Wetsylvania, and all 55 original West Virginia " +
      "counties are explicitly restored to it. Five Pennsylvania counties, " +
      "31 eastern Kentucky counties, and Wise, Norton independent city, " +
      "Dickenson, and Buchanan in Virginia are assigned to it. The Kentucky " +
      "selection uses FIVCO, Gateway, Big Sandy, Kentucky River, and " +
      "Cumberland Valley development districts as a reproducible " +
      "approximation of the Greenup-to-Bell region. It is not the boundary " +
      "of the eighteenth-century Westsylvania proposal.",
    states: [
      stateDefinition(stateId, "Wetsylvania", "WET"),
    ],
    moves: [
      ...westVirginiaIds.map((id) => [id, stateId]),
      ...pennsylvania,
      ...kentuckyIds.map((id) => [id, stateId]),
      ...virginia,
    ],
  });
}

export function createRegionalPresets(dataset, options = {}) {
  const simple = SIMPLE_PRESETS.map((spec) =>
    createSimpleStatePreset(dataset, spec)
  );

  return [
    simple[0],
    simple[1],
    simple[2],
    simple[3],
    simple[4],
    createSouthGeorgiaPreset(
      dataset,
      options.selectSouth ?? countyIdsSouthOfLatitude
    ),
    createWisconsinReattachment(dataset),
    simple[5],
    createWetsylvania(dataset),
    simple[6],
  ];
}