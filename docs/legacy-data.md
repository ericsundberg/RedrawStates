# Legacy data provenance and compatibility

This document records the interpretation of the inherited RedrawStates
datasets. The original source files remain unchanged and are preserved
in the repository's Git history.

## Dataset inventory

The inherited application provides datasets for 2004, 2008, 2012, 2016,
2016 Income, 2020, 2020 with newer populations, and 2024.

The ordinary datasets contain 3,113 usable geographic records in the
current legacy inventory. These records are not a complete, modern
county-equivalent inventory. The original data-generation pipeline
includes geographic simplifications, mergers, and exclusions.

The 2016 Income source contains 3,115 geometries. Two are empty
source-only shells, leaving 3,113 usable records.

The automated audit is implemented in scripts/audit-datasets.mjs.

## 2016 Income: measurement definition

The original income-generation work was committed on November 30, 2016:

https://github.com/khwilson/RedrawStates/commit/eefc063901060c44a8c8c52344f2697ba3a35353

The historical notebook is:

https://github.com/khwilson/RedrawStates/blob/eefc063901060c44a8c8c52344f2697ba3a35353/Process%20Population.ipynb

It reads the following Census files:

- ACS_14_5YR_B19301_with_ann.csv
- ACS_14_5YR_B01003_with_ann.csv

The notebook multiplies the per-capita income value by the corresponding
total-population estimate. The resulting value was written into the
legacy field named `population`.

B19301 is per-capita income in the past 12 months in 2014
inflation-adjusted dollars. B01003 is total population. The resulting
product is an estimated aggregate-personal-income proxy, not a count of
people and not a directly observed aggregate-income total. The original
per-capita values are rounded estimates.

The new adapter stores this value as:

    county.measures.incomeWeightDollars

For this dataset, `county.population` is null until a separately verified
population series is joined. The historical income-weighting behavior
must be implemented as an explicit simulation mode. It must not be used
as ordinary population for density calculations or population-based
electoral allocation.

Census table reference:
https://data.census.gov/table/ACSDT5Y2014.B19301

## Empty source-only geometries

The complete source audit found two empty, unassigned geometries in the
2016 Income dataset:

| GEOID | Description | Treatment |
| --- | --- | --- |
| 15005 | Kalawao County, Hawaii | Preserve source geometry; exclude from usable legacy inventory |
| 51515 | Former Bedford independent city, Virginia | Preserve source geometry; exclude from usable legacy inventory |

Both have empty properties and no population or vote measurements.
No values are transferred, inferred, or replaced with zero.

Bedford independent city became a town within Bedford County effective
July 1, 2013. The Census documents the deletion of county-equivalent
identifier 51515 and its incorporation into Bedford County 51019.

Census county changes:
https://www.census.gov/programs-surveys/geography/technical-documentation/county-changes.2010.html

If a future source contains a populated record with one of these
identifiers but no state assignment, the adapter raises an error rather
than silently excluding it.

## Geographic limitations

The inherited pipeline combines Alaska into one geographic unit. It
also contains historical county-equivalent simplifications and special
handling for Connecticut. These decisions must be revisited when the
application receives a complete modern geographic inventory.

The current adapter preserves the original TopoJSON. It does not derive
areas from simplified polygons and does not fabricate missing
measurements.

The new geographic dataset will use authoritative county-equivalent
identifiers and land and water area measurements, with explicit
geography vintages and reconciliation rules. Historical election
results will be joined only where the geographic relationship is
documented and valid.

## Vote data

The inherited browser files contain fixed aggregate vote buckets:
Democrat, GOP, Green, Libertarian, Unaffiliated, and Other.

These buckets do not necessarily preserve every individual candidate.
The adapter retains the source values without claiming candidate-level
detail that is not present.

A future candidate-neutral dataset will maintain separate candidate
identities and explicit completeness metadata.

## Missing data

Missing population, area, and vote measurements are represented by
null. They are not silently converted to zero.

A state aggregate is unavailable when one of its required constituent
measurements is missing. Source-only geometries that contain no data
are recorded separately and are not treated as zero-population counties.

The audit reports source geometry counts, usable county counts,
exclusions, measurement types, and missing values. It does not modify
the source data.