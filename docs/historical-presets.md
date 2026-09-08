# Historical and contemporary presets

The built-in presets are hypothetical boundary arrangements. They are not
claims that a proposed state was admitted to the Union, that a current
movement has succeeded, or that historical boundaries match modern counties.

Presets contain only affected state definitions, county assignments, and
explicit state removals. They do not modify source votes, population, area,
or TopoJSON geometry.

## Geographic compatibility

The inherited datasets contain 3,113 usable geographic records. Presets
are validated against the loaded county inventory and its fingerprint.

The current simulator uses whole counties. Historical boundaries that cut
through counties cannot be represented exactly. A reconstruction must
identify its approximation method and must not invent missing measurements.

The area overlay is a separate dataset and is not used to infer historical
county boundaries.

## Cal 3 (2018)

Source: California Secretary of State, Initiative 17-0018.

https://www.sos.ca.gov/administration/news-releases-and-advisories/2018-news-releases-and-advisories/new-measure-eligible-californias-november-2018-ballot-division-california-three-states-initiative-statute

The final arrangement comprises Northern California (40 counties),
California (six counties), and Southern California (12 counties).

Central California:
Los Angeles, Monterey, San Benito, San Luis Obispo, Santa Barbara, Ventura.

Southern California:
Fresno, Imperial, Inyo, Kern, Kings, Madera, Mono, Orange, Riverside,
San Bernardino, San Diego, Tulare.

All remaining California counties are assigned to Northern California.

The original California identity is explicitly removed. Three new stable
identities are used, with custom abbreviations NC3, CA3, and SC3 to avoid
collisions with other California presets.

## British West Florida

Source: Newberry Library, Atlas of Historical County Boundaries.

https://publications.newberry.org/ahcb/documents/FL_Consolidated_Chronology.htm

The preset represents the expanded British province in 1764–1783, not one
unchanging territory throughout 1763–1821. The initial northern boundary
was approximately 31° N. The expanded boundary reached approximately
32°28′ N. Later Spanish and American boundary changes are not combined
into a fictional single historical jurisdiction.

Approximation:
- Alabama and Mississippi counties with a planar geographic centroid
  south of or on 32°28′ N are included.
- The eight Louisiana Florida Parishes are explicitly included.
- Ten western Florida Panhandle counties are explicitly included.
- Franklin and Liberty, Florida, are omitted because the historical
  Apalachicola boundary does not align with their modern county boundaries.

The centroid method is reproducible but is not an exact area-majority
calculation. A county crossing the historic line is assigned as a whole.
A future geometry-reconstruction milestone can replace this approximation
with historically accurate overlays.

## Franklin

The user-specified modern county list is authoritative for this sandbox
preset: Blount, Sevier, Jefferson, Hamblen, Hawkins, Sullivan, Johnson,
Carter, Unicoi, Washington, Greene, and Cocke, Tennessee.

This is a modern-county interpretation of the historical State of Franklin.
It does not attempt to reconstruct the original eighteenth-century county
boundaries.

## Absaroka

Source: Sheridan Press, March 5, 1939, contemporary proposal map.

https://commons.wikimedia.org/wiki/File:Absaroka_map_from_contemporary_newspaper.jpg

Additional local history:
https://county10.com/americas-playground-absaroka-the-49th-state/

The boundaries changed during the movement and were not formally surveyed.
One historical version is described as containing ten Wyoming, four Montana,
and twelve South Dakota counties.

The implemented selection is an editorial whole-county regional
reconstruction, not a verified transcription of that exact historical
roster. It uses ten northern Wyoming counties, four southeastern Montana
counties, and twelve western South Dakota counties. Northern Fremont
County is documented as partly within the proposed area but is omitted
because the simulator cannot split it.

Future work should georeference a selected contemporary map, identify
the precise version, and replace the reconstruction with an audited
county-overlap method. Do not describe the current list as an exact
historical survey.

## Greater Idaho

Source: Citizens for Greater Idaho, official FAQ.

https://www.greateridaho.org/faq

The preset uses the complete-county core published by the movement:
14 Oregon counties and Asotin, Columbia, and Garfield in Washington.

The following are not represented by moving entire counties:
- portions of Wasco, Jefferson, and Deschutes, Oregon;
- Waitsburg in Walla Walla County, Washington;
- Uniontown in Whitman County, Washington.

Optional southwestern Oregon and California expansion areas are excluded.
The proposal may change, so its date and scope should be reviewed before
future updates. This preset is not a claim that any transfer has occurred.

## South Florida (2014)

Source: South Miami Resolution 203-14-14297, adopted October 7, 2014.

https://desdemonadespair.net/2014/11/threatened-with-rising-sea-leve/

The 24 counties are Brevard, Broward, Charlotte, Collier, DeSoto, Glades,
Hardee, Hendry, Highlands, Hillsborough, Indian River, Lee, Manatee,
Martin, Miami-Dade, Monroe, Okeechobee, Orange, Osceola, Palm Beach,
Pinellas, Polk, Sarasota, and St. Lucie.

The original Florida identity is renamed North Florida and retains
state:FL and the FL abbreviation. South Florida receives a new identity.

## Jefferson (1941)

Source: Oregon Encyclopedia, State of Jefferson.

https://www.oregonencyclopedia.org/articles/state_of_jefferson/

The historical core uses Curry County, Oregon, and Del Norte, Siskiyou,
Modoc, and Trinity counties, California.

The preset does not combine the 1941 movement with larger modern revival
proposals. A separate, source-dated modern Jefferson preset may be added
later with its own documented county list.

## Composition

The stack is shown in priority order. The bottom layer loads first and the
top layer loads last. Explicit county assignments in a later layer override
earlier assignments.

State definitions and removals are separate operations. A preset does not
automatically delete hypothetical states created by another preset merely
because all their counties have moved elsewhere. This is intentional:
removal must be explicit.

Full California partition presets may therefore leave empty state
identities from a lower-priority partition in the registry. Their county
assignments remain governed by priority order. Empty states can be removed
through Manage states. Future stack tooling may offer an explicit reviewed
cleanup operation, but should never silently delete unrelated custom states.

All changes are transactional. A failed preset plan leaves the current
session unchanged.