"""Convert FL DOE 'Membership by School by Grade by Race/Ethnicity' xlsx files
(Alachua County only) into data/processed/membership_alachua.json, shaped:
{ "<school_year>": { "<school_number>": { "school_name": ..., "grades": { "<grade>": {race: count_or_null, "suppressed": [...] } } } } }
"""
import openpyxl, json, re, glob, os

RACE_COLS = [
    "White", "Black or African American", "Hispanic/Latino", "Asian",
    "Native Hawaiian or Other Pacific Islander", "American Indian or Alaska Native",
    "Two or More Races",
]
RACE_KEYS = ["white", "black", "hispanic", "asian", "pacific_islander", "native_american", "two_or_more"]

def year_label(fname):
    m = re.match(r"(\d{2})(\d{2})", os.path.basename(fname))
    return f"20{m.group(1)}-{m.group(2)}"

def find_header_row(rows):
    for i, r in enumerate(rows):
        if r and isinstance(r[0], str) and r[0].strip().rstrip("#").strip().lower() in ("district", "dist"):
            return i
    raise ValueError("header row not found")

def parse_cell(v):
    """Return (numeric_or_None, suppressed_bool)."""
    if v is None:
        return 0, False
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return 0, False
        if s.startswith("*"):
            return None, True
        raise ValueError(f"unexpected string cell: {v!r}")
    return v, False

def convert(fname):
    wb = openpyxl.load_workbook(fname, read_only=True, data_only=True)
    ws = wb["School"]
    rows = list(ws.iter_rows(values_only=True))
    hdr_idx = find_header_row(rows)
    data_rows = rows[hdr_idx + 1:]

    schools = {}
    for r in data_rows:
        if not r or r[1] != "ALACHUA":
            continue
        _, _, school_num, school_name, grade = r[0], r[1], r[2], r[3], r[4]
        if school_num is None:
            continue
        grade = str(grade).strip()

        race_counts = {}
        suppressed = []
        for col_idx, key in zip(range(5, 12), RACE_KEYS):
            val = r[col_idx] if col_idx < len(r) else None
            num, is_supp = parse_cell(val)
            race_counts[key] = num
            if is_supp:
                suppressed.append(key)

        known_total = sum(v for v in race_counts.values() if v is not None)

        school = schools.setdefault(school_num, {"school_name": school_name, "grades": {}})
        school["grades"][grade] = {
            **race_counts,
            "suppressed": suppressed,
            "known_total": known_total,
        }
    return schools

def main():
    raw_dir = os.path.join(os.path.dirname(__file__), "raw", "membership")
    out_dir = os.path.join(os.path.dirname(__file__), "processed")
    os.makedirs(out_dir, exist_ok=True)

    files = sorted(glob.glob(os.path.join(raw_dir, "*MembBySchoolByGrade*.xlsx")))
    result = {}
    for f in files:
        yr = year_label(f)
        print(f"{yr}: {os.path.basename(f)}")
        result[yr] = convert(f)
        print(f"  -> {len(result[yr])} Alachua schools")

    out_path = os.path.join(out_dir, "membership_alachua.json")
    with open(out_path, "w") as fh:
        json.dump(result, fh, indent=2)
    print(f"\nwrote {out_path}")

if __name__ == "__main__":
    main()
