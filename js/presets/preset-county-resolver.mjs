/**
 * Resolve county and county-equivalent references for presets.
 *
 * Exact names are preferred. A loose name is accepted only when it
 * identifies one record. Five-digit FIPS IDs provide an unambiguous
 * alternative for independent cities and similarly named counties.
 */

function normalizeName(value) {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function looseName(value) {
  return normalizeName(value)
    .replace(/^city of /, "")
    .replace(/ (county|city)$/, "");
}

function addIndex(index, key, county) {
  if (!index.has(key)) {
    index.set(key, []);
  }

  index.get(key).push(county);
}

function uniqueMatch(matches, label, stateCode) {
  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    const choices = matches
      .map((county) => `${county.name} (${county.id})`)
      .join(", ");

    throw new Error(
      `Ambiguous county name in ${stateCode}: ${label}. ` +
      `Use a five-digit FIPS ID. Matches: ${choices}`
    );
  }

  return matches[0];
}

export function resolvePresetCounties(dataset, stateCode, names) {
  if (!Array.isArray(names)) {
    throw new TypeError("County references must be an array.");
  }

  if (
    typeof stateCode !== "string" ||
    !/^[A-Z]{2}$/.test(stateCode)
  ) {
    throw new Error("State code must be a two-letter abbreviation.");
  }

  const stateId = `state:${stateCode}`;
  const records = dataset.counties.filter(
    (county) => county.originalStateId === stateId
  );

  const byId = new Map();
  const exact = new Map();
  const loose = new Map();

  for (const county of records) {
    byId.set(county.id, county);

    addIndex(exact, normalizeName(county.name), county);
    addIndex(loose, looseName(county.name), county);
  }

  const result = [];
  const seen = new Set();

  for (const reference of names) {
    if (typeof reference !== "string" || !reference.trim()) {
      throw new Error("County references must be nonempty strings.");
    }

    const requested = reference.trim();
    let county;

    if (/^\d{5}$/.test(requested)) {
      county = byId.get(requested) ?? null;
    } else {
      county = uniqueMatch(
        exact.get(normalizeName(requested)) ?? [],
        requested,
        stateCode
      );

      if (!county) {
        county = uniqueMatch(
          loose.get(looseName(requested)) ?? [],
          requested,
          stateCode
        );
      }
    }

    if (!county) {
      throw new Error(
        `${requested}, ${stateCode} is missing from the inherited inventory.`
      );
    }

    if (seen.has(county.id)) {
      throw new Error(`Duplicate county in preset: ${county.id}`);
    }

    seen.add(county.id);
    result.push(county.id);
  }

  return result.sort();
}