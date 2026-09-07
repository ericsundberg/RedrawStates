#!/usr/bin/env python3
"""Build a verified 2019 area overlay for the legacy map inventory."""

import argparse
import csv
import hashlib
import io
import json
import tempfile
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

SOURCE_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "2019_Gazetteer/2019_Gaz_counties_national.zip"
)

DATASETS = {
    "2020": "data/us2020.json",
    "2020s": "data/us2020-new-pop.json",
    "2024": "data/us2024.json",
}

OUTPUT = ROOT / "data" / "areas" / "2019.json"
CACHE = ROOT / ".redraw_cache" / "gazetteer" / "2019-counties.zip"


def normalize_id(value):
    text = str(value).strip()

    if not text.isdigit() or len(text) > 5:
        raise ValueError(f"Invalid geographic identifier: {value!r}")

    return text.zfill(5)


def read_inventory(path):
    with path.open(encoding="utf-8") as stream:
        topology = json.load(stream)

    geometries = topology["objects"]["counties"]["geometries"]
    identifiers = []

    for geometry in geometries:
        properties = geometry.get("properties") or {}

        if not properties.get("state"):
            continue

        raw_id = geometry.get("id", properties.get("id"))

        if raw_id is None:
            raise ValueError(f"Assigned geometry lacks an ID in {path}")

        identifiers.append(normalize_id(raw_id))

    if len(identifiers) != len(set(identifiers)):
        raise ValueError(f"Duplicate geographic identifiers in {path}")

    return set(identifiers)


def read_gazetteer(archive_bytes):
    rows = {}

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        names = [
            name for name in archive.namelist()
            if name.lower().endswith(".txt")
        ]

        if len(names) != 1:
            raise ValueError("Expected one county Gazetteer text file.")

        with archive.open(names[0]) as source:
            text = io.TextIOWrapper(source, encoding="utf-8-sig")
            reader = csv.DictReader(text, delimiter="\t")

            required = {"GEOID", "ALAND", "AWATER"}

            if not required.issubset(reader.fieldnames or []):
                raise ValueError(
                    f"Unexpected Gazetteer columns: {reader.fieldnames}"
                )

            for row in reader:
                identifier = normalize_id(row["GEOID"])
                land = int(row["ALAND"].strip())
                water = int(row["AWATER"].strip())

                if land < 0 or water < 0:
                    raise ValueError(f"Negative area for {identifier}")

                if identifier in rows:
                    raise ValueError(f"Duplicate source ID: {identifier}")

                rows[identifier] = [land, water]

    return rows


def load_archive(source_path=None):
    if source_path is not None:
        data = source_path.read_bytes()
    elif CACHE.exists():
        data = CACHE.read_bytes()
    else:
        request = urllib.request.Request(
            SOURCE_URL,
            headers={"User-Agent": "RedrawStates area-data builder"},
        )

        with urllib.request.urlopen(request, timeout=90) as response:
            data = response.read()

        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_bytes(data)

    return data


def build_overlay(source_rows, inventory, source_hash):
    missing = sorted(
        identifier for identifier in inventory
        if identifier != "02000" and identifier not in source_rows
    )

    if missing:
        raise ValueError(
            "The Gazetteer does not cover the legacy inventory:\n"
            + "\n".join(missing)
        )

    alaska_ids = sorted(
        identifier for identifier in source_rows
        if identifier.startswith("02")
    )

    if not alaska_ids:
        raise ValueError("No Alaska county-equivalent records were found.")

    alaska_land = sum(source_rows[id][0] for id in alaska_ids)
    alaska_water = sum(source_rows[id][1] for id in alaska_ids)

    areas = {}

    for identifier in sorted(inventory):
        if identifier == "02000":
            areas[identifier] = [alaska_land, alaska_water]
        else:
            areas[identifier] = source_rows[identifier]

    if "02000" not in inventory:
        raise ValueError("The expected legacy Alaska unit is absent.")

    return {
        "schema": "redraw-area-v1",
        "geographyVintage": 2019,
        "datasetIds": list(DATASETS),
        "source": {
            "publisher": "U.S. Census Bureau",
            "title": "2019 National Counties Gazetteer File",
            "url": SOURCE_URL,
            "sha256": source_hash,
            "units": "square meters",
        },
        "coverage": {
            "kind": "legacy-inventory",
            "recordCount": len(areas),
            "alaskaSourceIds": alaska_ids,
            "sourceOnlyExclusions": ["15005"],
            "note": (
                "Matches the inherited county inventory. Alaska is "
                "aggregated into 02000; Kalawao is absent from the "
                "legacy map. This is not a complete modern county-"
                "equivalent geography."
            ),
        },
        "areas": areas,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        help="Optional already-downloaded Gazetteer ZIP.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT,
    )
    args = parser.parse_args()

    inventories = {
        dataset_id: read_inventory(ROOT / filename)
        for dataset_id, filename in DATASETS.items()
    }

    baseline = inventories["2024"]

    for dataset_id, inventory in inventories.items():
        if inventory != baseline:
            missing = sorted(baseline - inventory)
            extra = sorted(inventory - baseline)
            raise ValueError(
                f"{dataset_id} does not match the 2024 inventory. "
                f"Missing: {missing}; extra: {extra}"
            )

    archive_bytes = load_archive(args.source)
    source_hash = hashlib.sha256(archive_bytes).hexdigest()
    source_rows = read_gazetteer(archive_bytes)

    overlay = build_overlay(source_rows, baseline, source_hash)

    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=output.parent,
        prefix=".area-build-",
        suffix=".json",
        delete=False,
    ) as stream:
        temporary = Path(stream.name)
        json.dump(overlay, stream, separators=(",", ":"))
        stream.write("\n")

    temporary.replace(output)

    total_land = sum(value[0] for value in overlay["areas"].values())
    total_water = sum(value[1] for value in overlay["areas"].values())

    print(f"Source SHA-256: {source_hash}")
    print(f"Validated records: {len(overlay['areas']):,}")
    print(f"Legacy Alaska source units: {len(overlay['coverage']['alaskaSourceIds'])}")
    print(f"Land area (m²): {total_land:,}")
    print(f"Water area (m²): {total_water:,}")
    print(f"Created: {output}")


if __name__ == "__main__":
    main()