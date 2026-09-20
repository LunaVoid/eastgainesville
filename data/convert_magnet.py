"""Convert FL DOE 'Number of Magnet Schools/Programs by District' xlsx files
into data/processed/magnet_counts_alachua.json, shaped:
{ "<school_year>": { "total_magnet_schools": <int>, "florida_total": <int> } }

Note: this report is DISTRICT-LEVEL ONLY (a single count for all of Alachua),
not per-school. Only 4 years of this report were ever published by FL DOE
(2018-19 through 2021-22) -- this is the complete available set, not a partial pull.
"""
import openpyxl, json, re, glob, os

def year_label(fname):
    m = re.search(r"Magnet(\d{2})(\d{2})", os.path.basename(fname))
    return f"20{m.group(1)}-{m.group(2)}"

def convert(fname):
    wb = openpyxl.load_workbook(fname, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))

    florida_total = None
    alachua_total = None
    for r in rows:
        if not r or len(r) < 3:
            continue
        name = r[1]
        if name == "FLORIDA":
            florida_total = r[2]
        elif name == "ALACHUA":
            alachua_total = r[2]

    return {"total_magnet_schools": alachua_total, "florida_total": florida_total}

def main():
    raw_dir = os.path.join(os.path.dirname(__file__), "raw", "magnet")
    out_dir = os.path.join(os.path.dirname(__file__), "processed")
    os.makedirs(out_dir, exist_ok=True)

    files = sorted(glob.glob(os.path.join(raw_dir, "Magnet*.xlsx")))
    result = {}
    for f in files:
        yr = year_label(f)
        print(f"{yr}: {os.path.basename(f)}")
        result[yr] = convert(f)
        print(f"  -> Alachua: {result[yr]['total_magnet_schools']}, FL: {result[yr]['florida_total']}")

    out_path = os.path.join(out_dir, "magnet_counts_alachua.json")
    with open(out_path, "w") as fh:
        json.dump(result, fh, indent=2)
    print(f"\nwrote {out_path}")

if __name__ == "__main__":
    main()
