# Area data and geographic coverage

RedrawStates stores area in square meters. Land area and water area are
separate measurements; total area is their sum.

Population density is calculated as population divided by land area.
Water is not included in the density denominator.

## 2019 area overlay

The first area overlay uses the U.S. Census Bureau's 2019 National
Counties Gazetteer File:

https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2019.html

The source provides GEOID, ALAND, and AWATER. The builder preserves the
source ZIP's SHA-256 digest and records the geography vintage.

Run:

    python3 scripts/build-county-areas.py

The generated file is:

    data/areas/2019.json

It is intended for the inherited 2020, 2020s, and 2024 datasets, which
share the legacy 2019 county inventory. The builder compares the complete
geographic identifiers before writing the overlay.

## Legacy coverage limitations

The inherited application merges Alaska into geographic unit 02000.
The area builder sums the source Alaska county-equivalent measurements
to match that unit.

Kalawao County, Hawaii, is omitted from the inherited map. The overlay
preserves that limitation rather than inventing a geometry or assigning
its area to another county. Consequently, these totals describe the
legacy map inventory and must not be labeled complete modern state areas.

A future geographic rebuild will restore the full county-equivalent
inventory and reconcile historical election data to the appropriate
geographic boundaries.

## Historical datasets

The older datasets use different geography vintages. Their area values
remain unavailable until matching source measurements are imported and
their identifiers and boundary changes are reconciled.

A matching GEOID alone is not sufficient evidence that two historical
geographies are identical.

## Population vintages

The inherited population series is retained separately from area.
Density displays must identify the population and area vintages when
they differ. No population is inferred from area, and no area is
calculated from the simplified map polygons.

The 2016 Income dataset's income-weight proxy is not a population count
and must not be used as the numerator for population density.