/*
 * data-loader.js
 * ------------------------------------------------------------------
 * Loads every processed FL DOE / ACPS dataset in data/processed/,
 * normalizes them onto a single school-code key, and exposes one
 * merged per-school-per-year record set for the story page's charts.
 *
 * WHY THIS EXISTS: each source file comes from a different FL DOE
 * report, built in a different year, by a different team at the
 * state. They don't agree on:
 *   - year format ("2024" vs "2023-24" for the same school year)
 *   - school code padding ("31" vs "0031" for the same school)
 * This file is the one place those inconsistencies get fixed, so
 * every chart downstream can just ask for a school by code and year and
 * get a straight answer.
 *
 * DATA HONESTY NOTES (read before trusting a chart):
 *   - FRPL (free/reduced lunch) data only exists for 2024-2026.
 *     Charts that need FRPL + another metric are single-year only.
 *   - ESSA per-pupil funding is real for 2021-2024; the 2025 file
 *     FL DOE published is entirely "N/A" (not yet populated) and is
 *     excluded here rather than shown as zero.
 *   - membership_alachua.json is the only source with a full
 *     2014-2025 run; it's what the districtwide enrollment trend
 *     (see districtTotals() below) is built from.
 *   - There is no independently-verified school BUILDING CAPACITY
 *     number in this project. The zone GeoJSON files carry a
 *     Capacity2025 field from ACPS's rezoning consultant (JBPro),
 *     but it has not been cross-checked against a second, official
 *     source (FL DOE's FISH capacity program publishes district-
 *     level totals only, not per-school). Any chart using capacity
 *     must say "per ACPS rezoning consultant" and not "official."
 * ------------------------------------------------------------------
 */

const DATA_BASE = 'data/processed/';
const ZONES_BASE = 'data/raw/zones/';

/** Zero-pad a school code to FL DOE's standard 4 digits ("31" -> "0031"). */
function padCode(code) {
  return String(code).trim().padStart(4, '0');
}

/** Convert a school-year label to the two formats datasets use.
 *  "2023-24" -> {long: "2023-24", short: "2024"} and vice versa. */
function yearForms(label) {
  if (/^\d{4}-\d{2}$/.test(label)) {
    const shortYear = '20' + label.slice(5);
    return { long: label, short: shortYear };
  }
  if (/^\d{4}$/.test(label)) {
    // "2024" means the school year ending in 2024, i.e. "2023-24"
    return { long: `${Number(label) - 1}-${label.slice(2)}`, short: label };
  }
  throw new Error(`Unrecognized year label: ${label}`);
}

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Loads all datasets and returns a single object:
 * {
 *   years: { "2023-24": { "<code>": mergedSchoolRecord, ... }, ... },
 *   zones: { current: {elem, middle, high}, draft: {elem, middle, high} },
 *   meta:  { loadedAt, sources: [...] }
 * }
 *
 * mergedSchoolRecord fields (any may be undefined if that source
 * doesn't cover that year for that school):
 *   school_name
 *   enrollment_as9           <- membership_alachua.json (sum of grades' total_as9;
 *                                every suppressed subgroup counted as 9, its max
 *                                possible value under FL DOE's <10 masking rule).
 *                                One confident number, not a guess at the true value.
 *   enrollment_excluded      <- membership_alachua.json (sum of grades' total_excluded;
 *                                suppressed subgroups dropped entirely rather than
 *                                estimated). Use ENROLLMENT_MODE below to pick which
 *                                of these two the rest of the app should treat as
 *                                "enrollment_total".
 *   essa_total_per_pupil     <- essa_per_pupil_alachua.json (total_per_pupil)
 *   essa_total_funding       <- essa_total_per_pupil * enrollment_total (derived,
 *                                using whichever enrollment mode is active)
 *   infield_pct              <- infield_outfield_alachua.json (pct_in_field, 0-1)
 *   outfield_pct             <- infield_outfield_alachua.json (pct_out_of_field, 0-1)
 *   total_classes            <- infield_outfield_alachua.json (raw class count,
 *                                needed to weight district-wide averages correctly)
 *   out_of_field             <- infield_outfield_alachua.json (raw out-of-field count)
 *   grad_rate_total          <- gradrates_category_alachua.json ("Total Federal Graduation Rate")
 *   frpl_rate                <- FRLPStatus-*.json (frpl_rate, 0-1)
 *   frpl_count                <- FRLPStatus-*.json (frpl_count)
 */

/** Which suppressed-cell handling mode charts should use by default.
 *  'as9': treat every FL DOE-masked (<10 student) subgroup as 9 students.
 *  'excluded': drop masked subgroups from the total entirely.
 *  Call setEnrollmentMode() to flip this before/after loadACPSData(). */
// Default to 'excluded', not 'as9': cross-checked against the FRL file's
// independent student_count field (Lake Forest 2023-24: FRL says 286;
// 'as9' mode says 434, a 52% overstatement; 'excluded' says 218, an
// undercount but much closer). 'as9' is not "a single confident number"
// -- it's the true mathematical ceiling, which is a different thing.
let ENROLLMENT_MODE = 'excluded';
function setEnrollmentMode(mode) {
  if (mode !== 'as9' && mode !== 'excluded') throw new Error(`Unknown enrollment mode: ${mode}`);
  ENROLLMENT_MODE = mode;
}
async function loadACPSData() {
  const sourceFiles = [
    'essa_per_pupil_alachua.json',
    'membership_alachua.json',
    'infield_outfield_alachua.json',
    'gradrates_category_alachua.json',
    'FRLPStatus-AlachuaCountyPublicSchools_2024.json',
    'FRLPStatus-AlachuaCountyPublicSchools_2025.json',
    'FRLPStatus-AlachuaCountyPublicSchools_2026.json',
  ];
  // All 7 files are committed together as one dataset -- if any one is
  // missing/broken, the merge below can't produce a trustworthy result,
  // so fail loudly and name exactly which file, rather than let a bare
  // Promise.all rejection surface as an opaque "Failed to fetch."
  let essa, membership, infield, gradCategory, frl2024, frl2025, frl2026;
  try {
    [essa, membership, infield, gradCategory, frl2024, frl2025, frl2026] =
      await Promise.all(sourceFiles.map(f => fetchJSON(DATA_BASE + f)));
  } catch (err) {
    throw new Error(`loadACPSData: failed to load one of [${sourceFiles.join(', ')}] -- ${err.message}`);
  }

  const frlByShortYear = {
    '2024': frl2024['2024'],
    '2025': frl2025['2025'],
    '2026': frl2026['2026'],
  };

  // Union of every "long" (YYYY-YY) school year across all sources.
  const longYears = new Set([
    ...Object.keys(membership),
    ...Object.keys(infield),
    ...Object.keys(gradCategory),
  ]);
  Object.keys(essa).forEach(shortY => longYears.add(yearForms(shortY).long));
  Object.keys(frlByShortYear).forEach(shortY => {
    if (frlByShortYear[shortY]) longYears.add(yearForms(shortY).long);
  });

  const years = {};

  for (const longYear of longYears) {
    const { short: shortYear } = yearForms(longYear);
    const schools = {};

    const memYear = membership[longYear] || {};
    for (const [rawCode, rec] of Object.entries(memYear)) {
      const code = padCode(rawCode);
      const grades = Object.values(rec.grades);
      // Fail loudly on a schema mismatch instead of silently summing to 0 --
      // a stale membership_alachua.json (missing total_as9/total_excluded)
      // previously caused every enrollment number to quietly become 0.
      if (grades.length && grades[0].total_as9 === undefined) {
        throw new Error(
          `membership_alachua.json is missing "total_as9" -- it's using an old schema. ` +
          `Re-run: python3 data/convert_membership.py`
        );
      }
      const as9 = grades.reduce((sum, g) => sum + g.total_as9, 0);
      const excluded = grades.reduce((sum, g) => sum + g.total_excluded, 0);
      schools[code] = schools[code] || {};
      schools[code].school_name = rec.school_name;
      schools[code].enrollment_as9 = as9;
      schools[code].enrollment_excluded = excluded;
      schools[code].enrollment_total = ENROLLMENT_MODE === 'as9' ? as9 : excluded;
    }

    const infYear = infield[longYear] || {};
    for (const [rawCode, rec] of Object.entries(infYear)) {
      const code = padCode(rawCode);
      schools[code] = schools[code] || {};
      schools[code].school_name = schools[code].school_name || rec.school_name;
      schools[code].infield_pct = rec.pct_in_field;
      schools[code].outfield_pct = rec.pct_out_of_field;
      schools[code].total_classes = rec.total_classes;
      schools[code].out_of_field = rec.out_of_field;
    }

    const gradYear = gradCategory[longYear] || {};
    for (const [rawCode, rec] of Object.entries(gradYear)) {
      const code = padCode(rawCode);
      schools[code] = schools[code] || {};
      schools[code].school_name = schools[code].school_name || rec.school_name;
      const total = rec.subgroups['Total Federal Graduation Rate'];
      schools[code].grad_rate_total = total && !total.suppressed ? total.value : null;
    }

    const essaYear = essa[shortYear];
    if (essaYear) {
      for (const [rawCode, rec] of Object.entries(essaYear)) {
        const code = padCode(rawCode);
        if (rec.empty) continue; // FL DOE hasn't published real numbers for this year
        schools[code] = schools[code] || {};
        schools[code].school_name = schools[code].school_name || rec.school_name;
        schools[code].essa_total_per_pupil = rec.total_per_pupil;
      }
    }

    const frlYear = frlByShortYear[shortYear];
    if (frlYear) {
      for (const [rawCode, rec] of Object.entries(frlYear)) {
        const code = padCode(rawCode);
        schools[code] = schools[code] || {};
        schools[code].school_name = schools[code].school_name || rec.school_name;
        schools[code].frpl_rate = rec.frpl_rate;
        schools[code].frpl_count = rec.frpl_count;
        // FRL file's own enrollment count, kept separate from membership's
        // in case they diverge (different survey dates).
        schools[code].frpl_student_count = rec.student_count;
      }
    }

    // Derived field: total dollars into the school, not just per-pupil rate.
    for (const s of Object.values(schools)) {
      if (s.essa_total_per_pupil != null && s.enrollment_total != null) {
        s.essa_total_funding = s.essa_total_per_pupil * s.enrollment_total;
      }
    }

    years[longYear] = schools;
  }

  const zones = await loadZones();

  return {
    years,
    zones,
    meta: {
      loadedAt: new Date().toISOString(),
      sources: [
        'data/processed/essa_per_pupil_alachua.json — FL DOE ESSA per-pupil expenditures, 2021-2025 (2025 unpublished)',
        'data/processed/membership_alachua.json — FL DOE enrollment by school/grade/race, 2014-2025',
        'data/processed/infield_outfield_alachua.json — FL DOE in-field/out-of-field teaching, 2017-2024',
        'data/processed/gradrates_category_alachua.json — FL DOE federal graduation rates, 2017-2024',
        'data/processed/FRLPStatus-AlachuaCountyPublicSchools_{2024,2025,2026}.json — free/reduced lunch eligibility',
        'data/raw/zones/*.geojson — Alachua County GIS (current) and ACPS rezoning consultant JBPro (draft 2026-27, includes unverified capacity figures)',
      ],
    },
  };
}

async function loadZones() {
  const files = {
    currentElem: 'current_elem_zones.geojson',
    currentMiddle: 'current_middle_zones.geojson',
    currentHigh: 'current_high_zones.geojson',
    draftElem: 'draft_elem_zones.geojson',
    draftMiddle: 'draft_middle_zones.geojson',
    draftHigh: 'draft_high_zones.geojson',
    schools: 'schools_points.geojson',
  };
  const entries = await Promise.all(
    Object.entries(files).map(async ([key, filename]) => [key, await fetchJSON(ZONES_BASE + filename)])
  );
  return Object.fromEntries(entries);
}

/** Convenience: flatten one year's school map into an array, dropping
 *  schools missing the fields a specific chart needs. */
function schoolsWithFields(yearData, fields) {
  return Object.entries(yearData)
    .map(([code, rec]) => ({ code, ...rec }))
    .filter(rec => fields.every(f => rec[f] != null));
}

/** District-wide totals for a given year. Used instead of picking one
 *  representative school -- no single school's enrollment trend was clean
 *  enough to stand in for the whole district without cherry-picking
 *  (checked several candidates: all had real, noisy swings, not a smooth
 *  decline). Returns { enrollment_total, outfield_pct } with nulls where a
 *  source doesn't cover that year. outfield_pct is class-count-weighted
 *  (total out-of-field classes / total classes across the district), not
 *  an average of each school's rate -- a 20-student school and a
 *  2000-student school shouldn't count equally toward the district figure. */
function districtTotals(yearData) {
  const schools = Object.values(yearData);
  const withEnrollment = schools.filter(s => s.enrollment_total != null);
  const withOutfield = schools.filter(s => s.total_classes != null && s.out_of_field != null);

  const enrollment_total = withEnrollment.length
    ? withEnrollment.reduce((sum, s) => sum + s.enrollment_total, 0)
    : null;

  const totalClasses = withOutfield.reduce((sum, s) => sum + s.total_classes, 0);
  const totalOutfield = withOutfield.reduce((sum, s) => sum + s.out_of_field, 0);
  const outfield_pct = totalClasses > 0 ? totalOutfield / totalClasses : null;

  return { enrollment_total, outfield_pct, schoolCount: withEnrollment.length };
}
