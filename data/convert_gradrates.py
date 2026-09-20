"""Convert FL DOE 'Federal Graduation Rates by School' xls files (Alachua only)
into two separate JSONs (different subgroup schemas, joinable later by school number):
  data/processed/gradrates_category_alachua.json  -- FRL/ELL/ESE/at-risk/gender
  data/processed/gradrates_race_alachua.json       -- race/ethnicity

Shape: { "<school_year>": { "<school_number>": { "school_name": ..., "subgroups": {...} } } }
"""
import xlrd, json, re, glob, os

def year_label(fname):
    m = re.search(r"(\d{2})(\d{2})\.xls$", fname)
    return f"20{m.group(1)}-{m.group(2)}"

def find_header_row(ws):
    for i in range(ws.nrows):
        row = ws.row_values(i)
        if row and str(row[0]).strip() == "District Number":
            return i
    raise ValueError("header row not found")

def parse_cell(v):
    """Return (numeric_or_None, suppressed_bool)."""
    if v == "" or v is None:
        return 0, False
    if isinstance(v, str) and v.strip().startswith("*"):
        return None, True
    return v, False

def convert(fname):
    wb = xlrd.open_workbook(fname)
    ws = wb.sheet_by_name([s for s in wb.sheet_names() if s.endswith("-School")][0])
    hdr_idx = find_header_row(ws)
    headers = [str(h).strip() for h in ws.row_values(hdr_idx)]

    # locate the fixed id columns, everything after "School Name" (skipping "Version"/
    # "Virtual Provider Number" if present) is a subgroup metric
    name_col = headers.index("School Name")
    dist_name_col = headers.index("District Name")
    num_col = headers.index("School Number")

    metric_cols = [
        i for i, h in enumerate(headers)
        if i > name_col and h not in ("Version", "")
    ]

    schools = {}
    for r in range(hdr_idx + 1, ws.nrows):
        row = ws.row_values(r)
        if not row or row[dist_name_col] != "ALACHUA":
            continue
        school_num = str(row[num_col]).strip()
        school_name = row[name_col]
        if not school_num:
            continue

        subgroups = {}
        for i in metric_cols:
            key = headers[i]
            num, is_supp = parse_cell(row[i])
            subgroups[key] = {"value": num, "suppressed": is_supp}

        schools[school_num] = {"school_name": school_name, "subgroups": subgroups}
    return schools

def main():
    raw_dir = os.path.join(os.path.dirname(__file__), "raw", "gradrates")
    out_dir = os.path.join(os.path.dirname(__file__), "processed")
    os.makedirs(out_dir, exist_ok=True)

    for prefix, outname in [
        ("FedGradRateCategory", "gradrates_category_alachua.json"),
        ("FedGradRateRace", "gradrates_race_alachua.json"),
    ]:
        files = sorted(glob.glob(os.path.join(raw_dir, f"{prefix}*.xls")))
        result = {}
        for f in files:
            yr = year_label(f)
            print(f"{yr}: {os.path.basename(f)}")
            result[yr] = convert(f)
            print(f"  -> {len(result[yr])} Alachua schools")

        out_path = os.path.join(out_dir, outname)
        with open(out_path, "w") as fh:
            json.dump(result, fh, indent=2)
        print(f"wrote {out_path}\n")

if __name__ == "__main__":
    main()
