# ACPS Dashboard — Status / Restart Notes

Hackathon project: visualize how Alachua County Public Schools (ACPS, Gainesville FL)
magnet/choice programs draw students from zoned neighborhood schools, and how that
correlates with underenrollment + funding, especially in East Gainesville / poorer areas.
Framing: NOT "poor schools get less funding" — it's "choice programs siphon enrollment,
which drives underfunding for kids who stay." Causal claim we can't prove; correlation we can.

## What's working right now

**Map dashboard**: `map.html` — open via `http://localhost:8765/map.html`
(must be served over HTTP, not opened as a file:// — fetch() of local geojson is blocked
under file://). Server command if it's not still running:
```
cd /Users/joshfix/Documents/GitHub/acps-dashboard && python3 -m http.server 8765
```

Leaflet.js map, real OSM tiles, toggleable zone layers (current vs. "2026-27 draft
rezoning scenario"), school location points. Zone polygons colored by % of capacity
on the draft layer (Capacity2025/Attendance2025/PctCap2025 fields).

**Bug history (all fixed)**: tiles were scattered/fading — root cause was a **missing
`<link>` to leaflet.css** (had the JS but not the stylesheet, so Leaflet had no tile
positioning CSS at all). Fixed. Also added: escaped popup HTML (XSS guard), `.catch()`
on all fetch chains (previously a failed load silently broke every layer toggle).

## Known limitation: "current" vs "draft" zones are NOT meaningfully different

Verified by comparing geometry directly — the two layers' polygons differ only by
floating-point noise (~0.0004%), not real boundary changes. Root cause: ACPS's live
zone GIS service was edited in place for the 2026 rezoning, no version history exposed.
There is **no clean single view of the pre-2026 zones** available:
- Wayback Machine never captured the actual FeatureServer data (only the static page shell)
- BoardDocs has no pre-2026 zone map PDF (searched, not found)
- NCES federal School Attendance Boundary Survey (SABS) is the only real "before" source,
  but only covers 2013-14/2015-16 — a decade old. Context: this is ACPS's **first
  comprehensive rezoning since 2003**, so zones were frozen ~23 years — the old NCES
  data is probably still representative, just not a crisp "right before" snapshot.
- Downloaded the full 718MB NCES nationwide zip to `/private/tmp/claude-502/.../scratchpad/nces/sabs_1516.zip`
  (in a session-specific temp dir, NOT in this project folder — re-download if needed:
  `https://nces.ed.gov/programs/edge/data/SABS_1516_SchoolLevels.zip`). NOT YET filtered
  down to just Alachua County (LEAID 4807890) or converted to something usable. That's
  the next step if you want the old-zones comparison.
- A site called zipdatamaps.com has pages labeled "2022" per-school — blocked automated
  fetch (403), never verified by a human. Worth checking manually if desired.

## GIS data files already pulled (live from ArcGIS FeatureServers)

All in this folder as GeoJSON:
- `current_elem_zones.geojson` / `current_middle_zones.geojson` / `current_high_zones.geojson`
  — from Alachua County's own GIS (`services1.arcgis.com/MiBZ4u97DWldovjI/.../schools_services/FeatureServer`)
  — fields: Facility, Address, code_elem/code_mid/code_high (reliable join key)
- `draft_elem_zones.geojson` / `draft_middle_zones.geojson` / `draft_high_zones.geojson`
  — from JBPro Group (ACPS's rezoning consultant) — `services.arcgis.com/UqEiJNEITE8ox8CF/.../ACPS_Rezoning_WebApUpdate_20260304/FeatureServer`
  — fields: same + Capacity2025, Attendance2025, PctCap2025 (high-zone layer uses
  `PctCapacity2025` instead — code already handles both names via `getPct()`)
  — **UNCONFIRMED what "Attendance2025" actually measures** — could be current real
  enrollment, or a projection under the new proposed boundaries. No methodology doc
  found. Matters a lot for the story — flagged, not resolved.
- `schools_points.geojson` — all 39 school locations, county GIS

## FL DOE ESSA per-pupil expenditure files (user downloaded manually, fldoe.org
blocks automated/bot fetches with a hard 403 — WebFetch and curl both fail)

In this folder, one workbook per year:
- `2021Scool-PerPupil-Expen.xlsx` — real data, 52 Alachua rows
- `ESSA22School-PerPupil-Expend.xlsx` (+ a duplicate `(1)` copy) — real data, 53 rows
- `ESSA23School-PerPupil-Expend (1).xlsx` — real data, 52 rows
- `ESSA24School-PerPupil-Expend (1).xlsx` — real data, 57 rows
- `ESSA-2025-School-Per-Pupil-Expenditures (1).xlsx` — **all values are "N/A"**, not
  yet populated by FL DOE despite the filename — don't treat as usable data yet

**User wants ONLY Alachua County rows extracted** (confirmed: ~52-57 rows per year,
easy to filter on column B == "ALACHUA").

**Confirmed real header/schema** (row 5 of each sheet, 0-indexed columns):
```
District Code | District Name | School Code | School Name |
School Costs Per Pupil: State and Local Funds | Federal Funds | State+Local+Federal |
District Indirect Costs Per Pupil: State and Local Funds | Federal Funds | State+Local+Federal |
Total Costs - State, Local and Federal Funds Per Pupil
```
Real example row (2021, Stephen Foster Elementary):
```
('01','ALACHUA','0041','STEPHEN FOSTER ELEMENTARY SCHOOL', 8839,1667,10506, 1024,375,1400, 11906)
```

## Next step (interrupted mid-task)

User asked to convert these xlsx files into JSON shaped like:
```json
{
  "2026": { "<school_number>": { ...all data... } },
  "2025": { "<school_number>": { ...all data... } }
}
```
I was about to show a short example (1-2 schools) for confirmation before converting
all years/rows — **do that first**, don't just dump the full conversion. Use School Code
as the key (e.g. "0041"), Alachua rows only, skip the all-N/A 2025 file or include it
flagged as unpopulated — ask the user which they'd prefer.

## Other open threads / things not yet done
- FRL / economically-disadvantaged per-school data — real current-year file exists at
  `fldoe.org/core/fileparse.php/7584/urlt/2425FS2-Lunch-Status-School.xlsx` but blocked
  by the same Akamai bot wall; user would need to download manually like they did for ESSA.
- Magnet program per-program demographic breakdown (not just district-wide 52%/40% White
  magnet-vs-district figure, which IS verified from the real BoardDocs PDF, Nov 2023
  workshop, slides 17 & 20) — granular per-program numbers reportedly on slides 22-26
  of that same PDF, not yet extracted.
- No FRL/demographics data has been joined to the zone/capacity data yet — that join
  (by school code) is the natural next step once the FRL file is in hand.
