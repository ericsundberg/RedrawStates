/**
 * Original built-in arrangement presets.
 *
 * Kept separate so tests and other consumers can construct the core
 * presets without requiring unrelated regional inventories.
 */

import {
  normalizePreset,
  presetGeography,
  PRESET_FORMAT,
  PRESET_VERSION,
} from "./preset-model.mjs";

const SIX_CALIFORNIAS_SOURCE =
  "https://oag.ca.gov/system/files/initiatives/pdfs/" +
  "13-0063%20%2813-0063%20%28Six%20Californias%29%29.pdf";

const SIX_REGIONS = [
  {
    id: "custom:preset:six-californias:jefferson",
    name: "Jefferson",
    abbreviation: "JEF",
    countyCodes: [
      "007", "011", "015", "021", "023", "033", "035",
      "045", "049", "063", "089", "093", "103", "105",
    ],
  },
  {
    id: "custom:preset:six-californias:north",
    name: "North California",
    abbreviation: "NCA",
    countyCodes: [
      "005", "017", "041", "055", "057", "061", "067",
      "091", "095", "097", "101", "113", "115",
    ],
  },
  {
    id: "custom:preset:six-californias:silicon-valley",
    name: "Silicon Valley",
    abbreviation: "SV",
    countyCodes: [
      "001", "013", "053", "069",
      "075", "081", "085", "087",
    ],
  },
  {
    id: "custom:preset:six-californias:central",
    name: "Central California",
    abbreviation: "CCA",
    countyCodes: [
      "003", "009", "019", "027", "029", "031", "039",
      "043", "047", "051", "077", "099", "107", "109",
    ],
  },
  {
    id: "custom:preset:six-californias:west",
    name: "West California",
    abbreviation: "WCA",
    countyCodes: ["037", "079", "083", "111"],
  },
  {
    id: "custom:preset:six-californias:south",
    name: "South California",
    abbreviation: "SCA",
    countyCodes: ["025", "059", "065", "071", "073"],
  },
];

function makePreset(dataset, values) {
  return normalizePreset({
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    geography: presetGeography(dataset),
    sourceDataset: dataset.metadata.id,
    ...values,
  }, dataset);
}

function createPlymouth(dataset) {
  const assignments = dataset.model.assignments;

  const moves = [
    ["25023", "custom:preset:plymouth"],
    ["25001", "custom:preset:plymouth"],
    ["25005", "custom:preset:plymouth"],
    ["25007", "state:NY"],
    ["25019", "state:NY"],
  ];

  for (const [countyId] of moves) {
    if (assignments[countyId] !== "state:MA") {
      throw new Error(
        `Plymouth preset requires baseline Massachusetts county ${countyId}.`
      );
    }
  }

  return makePreset(dataset, {
    id: "builtin:plymouth-colony",
    name: "Plymouth Colony",
    description:
      "A hypothetical Plymouth state formed from Plymouth, " +
      "Barnstable, and Bristol counties. Dukes and Nantucket " +
      "counties are assigned to New York. All other counties remain unchanged.",
    states: [{
      id: "custom:preset:plymouth",
      name: "Plymouth",
      abbreviation: "PL",
      kind: "state",
    }],
    moves,
    removeStates: [],
  });
}

function createSixCalifornias(dataset) {
  const assignments = dataset.model.assignments;

  const moves = SIX_REGIONS.flatMap((region) =>
    region.countyCodes.map((code) => [
      `06${code}`,
      region.id,
    ])
  );

  const expected = new Set(moves.map(([id]) => id));

  const originalCalifornia = Object.entries(assignments)
    .filter(([, stateId]) => stateId === "state:CA")
    .map(([countyId]) => countyId);

  if (
    moves.length !== 58 ||
    expected.size !== 58 ||
    originalCalifornia.length !== 58 ||
    originalCalifornia.some((id) => !expected.has(id))
  ) {
    throw new Error(
      "The Six Californias preset does not match the inherited California inventory."
    );
  }

  return makePreset(dataset, {
    id: "builtin:six-californias",
    name: "Six Californias (2016 proposal)",
    description:
      "Tim Draper's six-region proposal pursued for the 2016 ballot. " +
      "California's 58 counties are assigned to Jefferson, North " +
      "California, Silicon Valley, Central California, West California, " +
      "and South California. The original California state identity is removed.",
    source: {
      title: "Six Californias, Initiative No. 13-0063",
      url: SIX_CALIFORNIAS_SOURCE,
    },
    states: SIX_REGIONS.map(
      ({ countyCodes, ...state }) => ({
        ...state,
        kind: "state",
      })
    ),
    moves,
    removeStates: [{
      id: "state:CA",
      destinationId: "custom:preset:six-californias:west",
    }],
  });
}

export function createCorePresets(dataset) {
  return [
    createPlymouth(dataset),
    createSixCalifornias(dataset),
  ];
}