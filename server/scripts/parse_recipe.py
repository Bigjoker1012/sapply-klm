#!/usr/bin/env python3
"""PDF recipe parser — tesseract OCR + pymupdf. Outputs JSON to stdout."""
import sys, os, json, re, subprocess, tempfile
from collections import defaultdict

try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({"error": "pymupdf not installed"}))
    sys.exit(1)

def ocr_page(page):
    """Convert page to image, run tesseract, return list of (text, x, y, w, h)."""
    pix = page.get_pixmap(dpi=300)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        pix.save(f.name)
        img_path = f.name
    try:
        # Run tesseract with tsv output for coordinates
        result = subprocess.run(
            ["tesseract", img_path, "stdout", "--psm", "6", "-l", "rus+eng", "tsv"],
            capture_output=True, text=True, timeout=60
        )
        blocks = []
        for line in result.stdout.strip().split("\n"):
            parts = line.split("\t")
            if len(parts) >= 12 and parts[0] != "level":
                try:
                    level = int(parts[0])
                    text = parts[11].strip()
                    if level == 5 and text:  # word level
                        x = int(parts[6])
                        y = int(parts[7])
                        w = int(parts[8])
                        h = int(parts[9])
                        conf = float(parts[10])
                        blocks.append({"text": text, "x": x, "y": y, "w": w, "h": h, "conf": conf})
                except (ValueError, IndexError):
                    pass
        return blocks
    finally:
        os.unlink(img_path)

def group_rows(blocks, tol=8):
    """Group blocks into rows by Y coordinate."""
    blocks.sort(key=lambda b: (b["y"], b["x"]))
    rows = []
    for b in blocks:
        merged = False
        for row in rows:
            if abs(b["y"] - row["y"]) <= tol:
                row["blocks"].append(b)
                row["y"] = min(row["y"], b["y"])
                merged = True
                break
        if not merged:
            rows.append({"y": b["y"], "blocks": [b]})
    for row in rows:
        row["blocks"].sort(key=lambda b: b["x"])
        row["text"] = " ".join(b["text"] for b in row["blocks"])
    return sorted(rows, key=lambda r: r["y"])

INGR_KW = [
    "ВИТАМИН", "КОБАЛЬТ", "ЙОДАТ", "БИОПЛЕКС", "СЕЛ-ПЛЕКС", "СЕЛЕНИТ",
    "ОКСИД", "СУЛЬФАТ", "КАРБОНАТ", "ХЛОРИД", "ХЕЛАТ",
    "ОКСИКАП", "СОЛЬ", "ИЗВЕСТНЯК", "БИКАРБОНАТ", "МОНОКАЛЬ",
    "ОТРУБИ", "МИАЛАКТО", "СОДА", "ПИЩЕВАЯ", "ВЫВАРОЧН",
    "ПШЕНИЧН", "РЖАН", "МУКА", "ФОСФАТ", "НАТРИЙ", "МАГНИЙ СЕРНОКИСЛ"
]

SKIP_RE = re.compile(
    r"ИТОГО|СТОИМ|ПРОИЗВ|СЕБЕСТОИМ|ПРИБЫЛЬ|ЦЕНА|НДС|"
    r"СЫРОЙ ПРОТЕИН|СЫРОЙ ЖИР|СЫРАЯ КЛЕТЧАТК|"
    r"ВИТАМИНЫ ИТОГО|МИКРОЭЛЕМЕНТЫ ИТОГО|"
    r"СТОИМ СЫРЬЯ|ПР\. ИЗД|КХП"
)

def is_skip(text):
    return bool(SKIP_RE.search(text.upper()))

def has_kw(text):
    t = text.upper()
    return any(kw in t for kw in INGR_KW)

CODE_RE = re.compile(r"^([A-Za-zА-Яа-яЁё]{1,3})(\d{1,3})([а-яё]{0,2})")

def extract_code(text):
    clean = re.sub(r"^[\[\]|]+", "", text).strip()
    if not clean:
        return None
    # OCR fix: 8→В at start
    if clean[0].isdigit() and len(clean) >= 3:
        m = re.match(r"^(\d{1,3})([_\s]|$)", clean)
        if m:
            after = clean[m.end():]
            if after and not after[0].isdigit():
                if clean[0] == "8":
                    clean = "В" + clean[1:]
                else:
                    clean = "Д" + clean
    m = CODE_RE.match(clean)
    if not m:
        m2 = re.match(r"^([A-Za-zА-Яа-яЁё]{1,2})(\d{0,0})", clean)
        if m2 and len(m2.group(1)) >= 2:
            return m2.group(1)
        return None
    code = m.group(1) + m.group(2) + m.group(3)
    skip = {"тыс", "Тыс", "мг", "МГ", "кг", "КГ", "МЕ", "ПРО", "RPO", "МДЖ", "ВИ", "КА"}
    if code in skip or m.group(1) in skip:
        return None
    return code

def extract_name(raw, code):
    cm = re.search(re.escape(code) + r"[_\s]?", raw)
    if not cm:
        return ""
    after = raw[cm.end():].lstrip("_ |[")
    dm = re.search(r"\s(\d{1,3},\d{3,4})\b", after)
    if dm:
        name = after[:dm.start()].strip()
    else:
        fm = re.search(r"\s(\d+[.,]?\d*/\d+[.,]?\d*)", after)
        if fm:
            name = after[:fm.start()].strip()
        else:
            nm = re.search(r"\s+\d", after)
            name = after[:nm.start()].strip() if nm else after.strip()
    name = re.sub(r"[_\[\]|:]+$", "", name).strip()
    name = re.sub(r"\s+", " ", name)
    return name

def extract_numbers(blocks, skip_block=None):
    nums = []
    for b in blocks:
        if skip_block and b["text"] == skip_block["text"]:
            continue
        for n in re.findall(r"\d+[.,]?\d*(?:/\d+[.,]?\d*)?", b["text"]):
            nc = n.replace(",", ".")
            if "/" in nc:
                for p in nc.split("/"):
                    try: nums.append(float(p))
                    except: pass
            else:
                try: nums.append(float(nc))
                except: pass
    return nums

def find_pct_and_kg(numbers, batch_kg):
    """Find (percentage, kg) from numbers list, validating kg ≈ pct * batch_kg / 100."""
    for i, pct in enumerate(numbers):
        if not (0.001 <= pct <= 100.0):
            continue
        expected = pct * batch_kg / 100.0
        for kg_cand in numbers[i+1:i+5]:
            if kg_cand <= 0:
                continue
            for div in (1.0, 1000.0, 0.001):
                adj = kg_cand / div
                if expected > 0 and abs(adj - expected) / expected < 0.15:
                    return pct, round(adj, 3)
    # Fallback: first valid %, derive kg
    for pct in numbers:
        if 0.001 <= pct <= 100.0:
            return pct, round(pct * batch_kg / 100.0, 3)
    return None, None

def parse_header(rows):
    """Extract recipe code, name, date, batch_kg from header rows."""
    code, name, date, batch_kg = "", "", "", 1000.0
    for row in rows[:40]:
        t = row["text"]
        if not code:
            m = re.search(r"[А-ЯA-ZА-Яа-яa-z0-9Ёё\-./]+ПЛЦ[-\s]?\d", t, re.IGNORECASE)
            if m and len(t) < 60:
                code = t.strip()
        if not date:
            m = re.search(r"(\d{2}[.\-/]\d{2}[.\-/]\d{4})", t)
            if m:
                date = m.group(1)
        if not batch_kg or batch_kg == 1000.0:
            m = re.search(r"Выработка[:\s]*([\d,.\s]+)\s*т", t, re.IGNORECASE)
            if m:
                try:
                    batch_kg = float(m.group(1).replace(",", ".").replace(" ", "")) * 1000
                except:
                    pass
        if not name:
            m = re.search(r"Для\s+(.+)$", t, re.IGNORECASE)
            if m:
                name = m.group(1).strip()
    return code, name, date, batch_kg

def parse_pdf(fpath):
    doc = fitz.open(fpath)
    all_rows = []
    all_ingredients = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        blocks = ocr_page(page)
        rows = group_rows(blocks)

        # Header on first page
        if page_num == 0:
            h_code, h_name, h_date, h_batch = parse_header(rows)
            all_rows.extend(rows)

        # Find header
        header_y = None
        for row in rows:
            if "Норма" in row["text"] and "%" in row["text"]:
                header_y = row["y"]
                break

        used_codes = set()
        used_idxs = set()

        for ri, row in enumerate(rows):
            if header_y and row["y"] <= header_y + 80:
                continue
            if ri in used_idxs:
                continue
            if is_skip(row["text"]):
                continue

            code = None
            code_block = None
            code_idx = -1
            for bi, b in enumerate(row["blocks"][:3]):
                c = extract_code(b["text"])
                if c:
                    code, code_block, code_idx = c, b, bi
                    break
            if not code:
                continue
            if not has_kw(row["text"]) and not re.search(r"\d+[.,]\d+/\d+[.,]\d+", row["text"]):
                continue
            if code in used_codes:
                continue
            used_codes.add(code)

            name = extract_name(row["text"], code)
            all_blocks = list(row["blocks"])

            # Continuation rows
            for ci in range(ri + 1, min(ri + 4, len(rows))):
                nr = rows[ci]
                if abs(nr["y"] - row["y"]) > 25:
                    break
                next_has_code = any(extract_code(nb["text"]) for nb in nr["blocks"][:2])
                if next_has_code:
                    break
                if is_skip(nr["text"]):
                    continue
                all_blocks.extend(nr["blocks"])
                used_idxs.add(ci)

            numbers = extract_numbers(all_blocks, code_block)
            raw = " ".join(b["text"] for b in all_blocks)[:300]

            all_ingredients.append({
                "code": code,
                "name": name,
                "numbers": numbers,
                "raw_text": raw,
            })

    doc.close()

    # Convert to expected format: {code, name, date, batchKg, rows}
    batch_kg = h_batch if 'h_batch' in dir() else 1000.0
    recipe_rows = []
    for ing in all_ingredients:
        pct, kg = find_pct_and_kg(ing["numbers"], batch_kg)
        if pct and kg:
            recipe_rows.append({
                "rawName": ing["name"] or ing["code"],
                "percentage": round(pct, 4),
                "quantityKg": round(kg, 3),
            })

    return {
        "code": h_code if 'h_code' in dir() else "",
        "name": h_name if 'h_name' in dir() else "",
        "date": h_date if 'h_date' in dir() else "",
        "batchKg": round(batch_kg, 1),
        "rows": recipe_rows,
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: parse_recipe.py <input.pdf> [output.json]"}))
        sys.exit(1)
    fpath = sys.argv[1]
    result = parse_pdf(fpath)
    output = json.dumps(result, ensure_ascii=False, indent=2)
    if len(sys.argv) >= 3:
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            f.write(output)
        print(json.dumps({"ok": True, "file": sys.argv[2], "ingredients": len(result["ingredients"])}))
    else:
        print(output)
