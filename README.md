# Redraw the States

Redraw the States is an interactive application for exploring hypothetical
United States state boundaries by reassigning counties and county equivalents.

This repository is a public development fork of
[khwilson/RedrawStates](https://github.com/khwilson/RedrawStates), originally
created by Kevin Hayes Wilson and contributors. The fork is maintained by
Eric Sundberg and is intended to preserve the original work, extend its
capabilities, and make reusable improvements available to the upstream project.

## Current capabilities

The inherited application allows users to select counties, move them between
existing states, inspect county and state data, change election datasets, and
share a configuration through a URL.

The current election engine is a simplified model. It is not a complete
reproduction of official historical election procedures or results. Data
coverage and modeling limitations will be documented as the application is
modernized.

## Development goals

The planned extensions include:

- Creating, renaming, and dissolving hypothetical states.
- Maintaining a dynamic registry of states rather than a fixed list.
- Displaying county and state population, land area, water area, total area,
  and population density.
- Visualizing demographic measurements independently of election results.
- Supporting candidate-neutral vote aggregation and explicit tie handling.
- Separating geographic assignments, data aggregation, electoral allocation,
  and map rendering into modular components.
- Preserving data provenance, geography vintages, and reproducible builds.
- Providing a static application that can be deployed at a domain root or
  within a nested website directory.

These items are development goals, not a list of completed features.

## Run locally

The browser application lives at the repository root. Python 3 is sufficient
to serve the existing static files:

    cd ~/Documents/github/redraw-states
    python3 -m http.server 8789

Open:

    http://127.0.0.1:8789/

The application must be served over HTTP rather than opened as a file:// URL,
because the map loads JSON data.

The browser application does not require the Python data-generation
dependencies merely to run the existing datasets.

## Build for deployment

Run:

    python3 scripts/build-site.py

The builder creates `dist/` containing only:

    index.html
    clippy.svg
    css/
    js/
    data/

Upload the contents of `dist/` into the intended website directory. For
example, uploading those contents into `/tests/redraw-states/` makes the
application available at:

    https://example.com/tests/redraw-states/

The URL does not require `/public/`, a redirect, or a special server rewrite.

Do not upload the entire development repository to a public web directory.
The `dist/` directory is generated and should not be committed.

## Tests

Run the standard-library static-site tests:

    python3 -m unittest discover -s tests -p 'test-*.py' -v

These tests validate local asset references, available datasets, the deployment
builder, and HTTP paths at root and nested locations. Browser interaction
testing is still required for map selection, county movement, zoom, year
selection, and sharing.

## Data generation

The existing Python tools remain under `src/redraw/`. To regenerate datasets,
install the dependencies documented in `pyproject.toml` and `uv.lock`:

    uv sync
    npm install

A Census API key is required for the existing population-generation commands.
Consult the original upstream README and the current CLI help for source-specific
requirements.

The output paths now target the root-level `data/` directory:

    uv run redraw 2016 data/us.json
    uv run redraw 2020 data/us2020.json
    uv run redraw 2024 data/us2024.json

Historical MIT-based datasets can be generated with the existing `mit`
subcommand and the appropriate source CSV:

    uv run redraw mit 2012 countypres_2000-2016.csv data/us2012.json
    uv run redraw mit 2008 countypres_2000-2016.csv data/us2008.json
    uv run redraw mit 2004 countypres_2000-2016.csv data/us2004.json

Regenerating data is separate from building the static website. The original
data files remain committed until replacement datasets have been validated.

## Project organization

The repository uses the following responsibilities:

- `index.html`, `css/`, `js/`, and `data/`: browser application and static data.
- `src/redraw/`: Python data acquisition and generation.
- `scripts/`: repeatable development and deployment utilities.
- `tests/`: automated regression tests.
- `dist/`: generated, disposable deployment output.

Future JavaScript changes will be separated into focused modules with
lowercase-kebab-case file and directory names. Existing functionality will be
preserved and tested while the monolithic map engine is refactored.

## Contributing and upstream collaboration

Development takes place in feature branches. Changes should be narrowly
scoped, documented, and tested before being merged into this fork's `main`.

Reusable improvements may be submitted to the original project through pull
requests. The fork preserves the original Git history and attribution, and
upstream changes should be incorporated without unnecessarily rewriting
history.

## Original project and acknowledgments

Original repository:
https://github.com/khwilson/RedrawStates

The original project was created by Kevin Hayes Wilson. Its contributors
include @herbiemarkwort and @Euonia. The original README and Git history
contain the project's background and additional acknowledgments.

The inherited application uses D3, TopoJSON, Bootstrap, jQuery, and
Clipboard.js. Original data sources include the U.S. Census Bureau, the New
York Times, and historical county-election datasets. The original repository
also acknowledges Mike Bostock, Lee Howorko, FiveThirtyEight, and the
CT Data Collaborative's Connecticut crosswalk.

New datasets will receive explicit source, vintage, processing, and reuse
documentation before being incorporated.

## License

The original project README specifies GPL v3. The fork retains the original
copyright notices and license terms. A dedicated license file and detailed
third-party data and dependency notices will be added after verifying the
upstream licensing history and applicable redistribution terms.