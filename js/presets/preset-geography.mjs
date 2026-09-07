/**
 * Geographic helpers for sparse historical presets.
 *
 * County names are resolved against the inherited inventory.
 * Centroids are approximate planar centroids in longitude/latitude,
 * intended only for explicitly labeled whole-county reconstructions.
 */

function normalizeName(value) {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]/g, "");
}

export function countyIdsByName(dataset, stateCode, names) {
  if (!Array.isArray(names)) {
    throw new TypeError("County names must be an array.");
  }

  const stateId = `state:${stateCode}`;

  const counties = dataset.counties.filter(
    (county) => county.originalStateId === stateId
  );

  const byName = new Map();

  for (const county of counties) {
    const key = normalizeName(county.name);

    if (byName.has(key)) {
      throw new Error(
        `Ambiguous county name in ${stateCode}: ${county.name}`
      );
    }

    byName.set(key, county);
  }

  const result = [];
  const seen = new Set();

  for (const name of names) {
    const county = byName.get(normalizeName(name));

    if (!county) {
      throw new Error(
        `County ${name}, ${stateCode} is not in the loaded inventory.`
      );
    }

    if (seen.has(county.id)) {
      throw new Error(`Duplicate preset county: ${county.id}`);
    }

    seen.add(county.id);
    result.push(county.id);
  }

  return result.sort();
}

function createArcReader(topology) {
  const cache = new Map();
  const transform = topology.transform;

  function decode(index) {
    const arcIndex = index < 0 ? ~index : index;

    if (!cache.has(arcIndex)) {
      const source = topology.arcs[arcIndex];

      if (!Array.isArray(source)) {
        throw new Error(`Unknown TopoJSON arc: ${arcIndex}`);
      }

      let x = 0;
      let y = 0;

      const points = source.map(([first, second]) => {
        if (transform) {
          x += first;
          y += second;

          return [
            x * transform.scale[0] + transform.translate[0],
            y * transform.scale[1] + transform.translate[1],
          ];
        }

        return [first, second];
      });

      cache.set(arcIndex, points);
    }

    const points = cache.get(arcIndex);

    return index < 0
      ? [...points].reverse()
      : points;
  }

  return decode;
}

function joinRing(arcIds, readArc) {
  const result = [];

  for (const index of arcIds) {
    const points = readArc(index);

    if (result.length === 0) {
      result.push(...points);
    } else {
      result.push(...points.slice(1));
    }
  }

  return result;
}

function ringCentroid(points) {
  if (points.length === 0) {
    throw new Error("Cannot calculate the centroid of an empty ring.");
  }

  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];

    const cross =
      current[0] * next[1] - next[0] * current[1];

    twiceArea += cross;
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }

  if (Math.abs(twiceArea) < 1e-12) {
    const average = points.reduce(
      (sum, point) => [
        sum[0] + point[0],
        sum[1] + point[1],
      ],
      [0, 0]
    );

    return {
      point: [
        average[0] / points.length,
        average[1] / points.length,
      ],
      weight: 0,
    };
  }

  return {
    point: [
      x / (3 * twiceArea),
      y / (3 * twiceArea),
    ],
    weight: Math.abs(twiceArea),
  };
}

function geometryCentroid(geometry, readArc) {
  const polygons = geometry.type === "Polygon"
    ? [geometry.arcs]
    : geometry.type === "MultiPolygon"
      ? geometry.arcs
      : null;

  if (!polygons) {
    throw new Error(
      `Unsupported county geometry: ${geometry.type}`
    );
  }

  const centroids = polygons
    .filter((polygon) => polygon.length > 0)
    .map((polygon) =>
      ringCentroid(joinRing(polygon[0], readArc))
    );

  if (centroids.length === 0) {
    throw new Error("County geometry has no exterior rings.");
  }

  const weight = centroids.reduce(
    (sum, item) => sum + item.weight,
    0
  );

  if (weight === 0) {
    return centroids[0].point;
  }

  return centroids.reduce(
    (sum, item) => [
      sum[0] + item.point[0] * item.weight / weight,
      sum[1] + item.point[1] * item.weight / weight,
    ],
    [0, 0]
  );
}

export function createCountyCentroidReader(dataset) {
  if (
    !dataset.topology ||
    !dataset.geometriesById ||
    typeof dataset.geometriesById.get !== "function"
  ) {
    throw new Error(
      "The dataset does not expose its original county geometry."
    );
  }

  const readArc = createArcReader(dataset.topology);
  const cache = new Map();

  return function countyCentroid(countyId) {
    if (!cache.has(countyId)) {
      const geometry = dataset.geometriesById.get(countyId);

      if (!geometry) {
        throw new Error(`Unknown county geometry: ${countyId}`);
      }

      cache.set(
        countyId,
        geometryCentroid(geometry, readArc)
      );
    }

    return [...cache.get(countyId)];
  };
}

/**
 * Select whole counties by their representative centroid.
 *
 * The result is not a historical survey and does not split counties
 * crossed by the supplied latitude.
 */
export function countyIdsSouthOfLatitude(
  dataset,
  stateCode,
  latitude
) {
  if (!Number.isFinite(latitude)) {
    throw new TypeError("Latitude must be a finite number.");
  }

  const centroid = createCountyCentroidReader(dataset);
  const stateId = `state:${stateCode}`;

  return dataset.counties
    .filter((county) => county.originalStateId === stateId)
    .filter((county) => centroid(county.id)[1] <= latitude)
    .map((county) => county.id)
    .sort();
}