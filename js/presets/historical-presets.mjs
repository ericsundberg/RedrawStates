/**
 * Historical and contemporary boundary-arrangement presets.
 *
 * These are hypothetical arrangements for a county-based simulator.
 * Historical boundaries are not silently represented as exact when
 * they cross the modern county inventory.
 */

import {
  normalizePreset,
  presetGeography,
  PRESET_FORMAT,
  PRESET_VERSION,
} from "./preset-model.mjs";

import {
  countyIdsByName,
  countyIdsSouthOfLatitude,
} from "./preset-geography.mjs";

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

function definition(id, name, abbreviation) {
  return {
    id,
    name,
    abbreviation,
    kind: "state",
  };
}

function movesForNames(dataset, stateCode, names, destinationId) {
  return countyIdsByName(dataset, stateCode, names).map(
    (countyId) => [countyId, destinationId]
  );
}

function originalCountyIds(dataset, stateCode) {
  return dataset.counties
    .filter(
      (county) =>
        county.originalStateId === `state:${stateCode}`
    )
    .map((county) => county.id)
    .sort();
}

function assertPartition(dataset, stateCode, groups) {
  const expected = originalCountyIds(dataset, stateCode);
  const actual = groups.flatMap((group) => group.countyIds);
  const unique = new Set(actual);

  if (
    actual.length !== expected.length ||
    unique.size !== expected.length ||
    expected.some((id) => !unique.has(id))
  ) {
    throw new Error(
      `The ${stateCode} preset does not partition the inherited inventory.`
    );
  }
}

function createCal3(dataset) {
  const northId = "custom:preset:cal3:north";
  const centralId = "custom:preset:cal3:california";
  const southId = "custom:preset:cal3:south";

  const central = countyIdsByName(dataset, "CA", [
    "Los Angeles",
    "Monterey",
    "San Benito",
    "San Luis Obispo",
    "Santa Barbara",
    "Ventura",
  ]);

  const southern = countyIdsByName(dataset, "CA", [
    "Fresno",
    "Imperial",
    "Inyo",
    "Kern",
    "Kings",
    "Madera",
    "Mono",
    "Orange",
    "Riverside",
    "San Bernardino",
    "San Diego",
    "Tulare",
  ]);

  const occupied = new Set([...central, ...southern]);

  const northern = originalCountyIds(dataset, "CA")
    .filter((id) => !occupied.has(id));

  const groups = [
    { id: northId, countyIds: northern },
    { id: centralId, countyIds: central },
    { id: southId, countyIds: southern },
  ];

  assertPartition(dataset, "CA", groups);

  if (
    northern.length !== 40 ||
    central.length !== 6 ||
    southern.length !== 12
  ) {
    throw new Error("The Cal 3 county grouping is incomplete.");
  }

  return makePreset(dataset, {
    id: "builtin:cal3-2018",
    name: "Cal 3 (2018)",
    description:
      "The final 2018 three-state initiative: Northern California " +
      "(40 counties), California (six), and Southern California (12). " +
      "The original California identity is replaced by three distinct " +
      "hypothetical identities. Custom abbreviations distinguish this " +
      "preset from Six Californias. The measure was removed from the ballot.",
    source: {
      title: "California Secretary of State — Cal 3",
      url:
        "https://www.sos.ca.gov/administration/news-releases-and-advisories/" +
        "2018-news-releases-and-advisories/new-measure-eligible-californias-" +
        "november-2018-ballot-division-california-three-states-initiative-statute",
    },
    states: [
      definition(northId, "Northern California", "NC3"),
      definition(centralId, "California", "CA3"),
      definition(southId, "Southern California", "SC3"),
    ],
    moves: groups.flatMap((group) =>
      group.countyIds.map((id) => [id, group.id])
    ),
    removeStates: [{
      id: "state:CA",
      destinationId: northId,
    }],
  });
}

function createWestFlorida(dataset) {
  const stateId = "custom:preset:west-florida";

  // Expanded British boundary, 1764–1783: 32°28′ N.
  // Modern counties are assigned by centroid, not split on the line.
  const northernLatitude = 32 + 28 / 60;

  const alabama = countyIdsSouthOfLatitude(
    dataset,
    "AL",
    northernLatitude
  );

  const mississippi = countyIdsSouthOfLatitude(
    dataset,
    "MS",
    northernLatitude
  );

  // The eight modern Louisiana Florida Parishes.
  const louisiana = countyIdsByName(dataset, "LA", [
    "East Baton Rouge",
    "East Feliciana",
    "Livingston",
    "St. Helena",
    "St. Tammany",
    "Tangipahoa",
    "Washington",
    "West Feliciana",
  ]);

  // Panhandle counties predominantly west of the
  // Apalachicola–Chattahoochee river boundary.
  const florida = countyIdsByName(dataset, "FL", [
    "Bay",
    "Calhoun",
    "Escambia",
    "Gulf",
    "Holmes",
    "Jackson",
    "Okaloosa",
    "Santa Rosa",
    "Walton",
    "Washington",
  ]);

  const countyIds = [
    ...alabama,
    ...mississippi,
    ...louisiana,
    ...florida,
  ];

  if (new Set(countyIds).size !== countyIds.length) {
    throw new Error("West Florida contains duplicate counties.");
  }

  return makePreset(dataset, {
    id: "builtin:british-west-florida-1764",
    name: "British West Florida (1764–1783 approximation)",
    description:
      "A whole-county reconstruction of the expanded British " +
      "province, using its northern boundary of approximately " +
      "32°28′ N. Alabama and Mississippi counties are selected by " +
      "their centroid; the eight Louisiana Florida Parishes and ten " +
      "western Florida Panhandle counties are explicitly included. " +
      "The historical boundary crossed modern counties, and the " +
      "province's borders changed between 1763 and 1821. This preset " +
      "is an approximation, not an exact historical survey.",
    source: {
      title: "Newberry Library — Florida Historical Boundary Chronology",
      url:
        "https://publications.newberry.org/ahcb/documents/" +
        "FL_Consolidated_Chronology.htm",
    },
    states: [
      definition(stateId, "West Florida", "WFL"),
    ],
    moves: countyIds.map((id) => [id, stateId]),
  });
}

function createFranklin(dataset) {
  const stateId = "custom:preset:franklin";

  const names = [
    "Blount",
    "Sevier",
    "Jefferson",
    "Hamblen",
    "Hawkins",
    "Sullivan",
    "Johnson",
    "Carter",
    "Unicoi",
    "Washington",
    "Greene",
    "Cocke",
  ];

  return makePreset(dataset, {
    id: "builtin:franklin",
    name: "State of Franklin",
    description:
      "A modern-county interpretation of the historical State of " +
      "Franklin, using the exact twelve Tennessee counties specified " +
      "for this sandbox preset. All other Tennessee counties remain " +
      "unchanged.",
    source: {
      title: "State of Franklin — Historical County Map",
      url:
        "https://commons.wikimedia.org/wiki/File:8FranklinCounties.png",
    },
    states: [
      definition(stateId, "Franklin", "FRK"),
    ],
    moves: movesForNames(dataset, "TN", names, stateId),
  });
}

function createAbsaroka(dataset) {
  const stateId = "custom:preset:absaroka";

  // Editorial whole-county reconstruction of the 1939 region.
  // This is not a verified transcription of one of the changing
  // historical maps. The documented northern Fremont County portion
  // is omitted rather than assigning the entire county.
  const counties = {
    WY: [
      "Big Horn",
      "Campbell",
      "Crook",
      "Hot Springs",
      "Johnson",
      "Park",
      "Sheridan",
      "Teton",
      "Washakie",
      "Weston",
    ],
    MT: [
      "Big Horn",
      "Carter",
      "Custer",
      "Powder River",
    ],
    SD: [
      "Butte",
      "Corson",
      "Custer",
      "Fall River",
      "Haakon",
      "Harding",
      "Jackson",
      "Lawrence",
      "Meade",
      "Pennington",
      "Perkins",
      "Ziebach",
    ],
  };

  return makePreset(dataset, {
    id: "builtin:absaroka-1939",
    name: "Absaroka (1939 regional reconstruction)",
    description:
      "An editorial whole-county reconstruction of the 1939 " +
      "Absaroka statehood movement in northern Wyoming, southeastern " +
      "Montana, and western South Dakota. Historical boundaries changed " +
      "and were not formally surveyed. This selection is not claimed " +
      "to be an exact transcription of a particular 26-county version. " +
      "The documented northern portion of Fremont County is omitted " +
      "rather than moving all of Fremont. Review the historical map " +
      "and adjust counties for a more specific interpretation.",
    source: {
      title: "Sheridan Press — Proposed Absaroka Map, March 5, 1939",
      url:
        "https://commons.wikimedia.org/wiki/" +
        "File:Absaroka_map_from_contemporary_newspaper.jpg",
    },
    states: [
      definition(stateId, "Absaroka", "ABS"),
    ],
    moves: Object.entries(counties).flatMap(
      ([stateCode, names]) =>
        movesForNames(dataset, stateCode, names, stateId)
    ),
  });
}

function createGreaterIdaho(dataset) {
  const destinationId = "state:ID";

  const oregon = [
    "Baker",
    "Crook",
    "Gilliam",
    "Grant",
    "Harney",
    "Klamath",
    "Lake",
    "Malheur",
    "Morrow",
    "Sherman",
    "Umatilla",
    "Union",
    "Wallowa",
    "Wheeler",
  ];

  const washington = [
    "Asotin",
    "Columbia",
    "Garfield",
  ];

  return makePreset(dataset, {
    id: "builtin:greater-idaho-current",
    name: "Greater Idaho (current complete-county core)",
    description:
      "The complete-county core of the movement's published proposal: " +
      "14 Oregon counties and three Washington counties. Partial-county " +
      "claims in Wasco, Jefferson, and Deschutes, Oregon, and the " +
      "Waitsburg and Uniontown areas of Washington are excluded. " +
      "Optional southwestern Oregon and California expansion areas are " +
      "also excluded. The preset assigns territory to the existing " +
      "Idaho identity and does not create a new state.",
    source: {
      title: "Greater Idaho — Official FAQ",
      url: "https://www.greateridaho.org/faq",
    },
    moves: [
      ...movesForNames(dataset, "OR", oregon, destinationId),
      ...movesForNames(dataset, "WA", washington, destinationId),
    ],
  });
}

function createSouthFlorida(dataset) {
  const stateId = "custom:preset:south-florida";

  const names = [
    "Brevard",
    "Broward",
    "Charlotte",
    "Collier",
    "DeSoto",
    "Glades",
    "Hardee",
    "Hendry",
    "Highlands",
    "Hillsborough",
    "Indian River",
    "Lee",
    "Manatee",
    "Martin",
    "Miami-Dade",
    "Monroe",
    "Okeechobee",
    "Orange",
    "Osceola",
    "Palm Beach",
    "Pinellas",
    "Polk",
    "Sarasota",
    "St. Lucie",
  ];

  const moves = movesForNames(
    dataset,
    "FL",
    names,
    stateId
  );

  if (moves.length !== 24) {
    throw new Error("The South Florida preset requires 24 counties.");
  }

  return makePreset(dataset, {
    id: "builtin:south-florida-2014",
    name: "South Florida (2014)",
    description:
      "The 24-county arrangement advocated by South Miami in " +
      "Resolution 203-14-14297, adopted October 7, 2014. The " +
      "remaining original Florida identity is renamed North Florida " +
      "and retains its stable ID and FL abbreviation. Orange County " +
      "is included; Volusia County is not.",
    source: {
      title: "South Miami Resolution 203-14-14297",
      url:
        "https://desdemonadespair.net/2014/11/" +
        "threatened-with-rising-sea-leve/",
    },
    states: [
      definition("state:FL", "North Florida", "FL"),
      definition(stateId, "South Florida", "SFL"),
    ],
    moves,
  });
}

function createJefferson(dataset) {
  const stateId = "custom:preset:jefferson-1941";

  return makePreset(dataset, {
    id: "builtin:jefferson-1941",
    name: "Jefferson (1941 historical core)",
    description:
      "The five-county historical core of the 1941 Jefferson " +
      "statehood movement: Curry County, Oregon, and Del Norte, " +
      "Siskiyou, Modoc, and Trinity counties in California. " +
      "This is not a larger modern revival proposal. Jackson, " +
      "Josephine, Douglas, and other southwestern Oregon counties " +
      "are not silently added.",
    source: {
      title: "Oregon Encyclopedia — State of Jefferson",
      url:
        "https://www.oregonencyclopedia.org/articles/" +
        "state_of_jefferson/",
    },
    states: [
      definition(stateId, "Jefferson", "JFR"),
    ],
    moves: [
      ...movesForNames(
        dataset,
        "OR",
        ["Curry"],
        stateId
      ),
      ...movesForNames(
        dataset,
        "CA",
        ["Del Norte", "Siskiyou", "Modoc", "Trinity"],
        stateId
      ),
    ],
  });
}

export function createHistoricalPresets(dataset) {
  return [
    createCal3(dataset),
    createWestFlorida(dataset),
    createFranklin(dataset),
    createAbsaroka(dataset),
    createGreaterIdaho(dataset),
    createSouthFlorida(dataset),
    createJefferson(dataset),
  ];
}