#!/usr/bin/env python3
"""
OCR-based recipe PDF parser for KLM supply chain system.
Usage: python3 ocr_recipe.py <pdf_path>
Outputs JSON to stdout.
"""

import sys
import json
import re
import subprocess
import tempfile
import os

try:
    import fitz
except ImportError:
    print(json.dumps({"error": "PyMuPDF not installed"}))
    sys.exit(1)


# ─── Number utilities ──────────────────────────────────────────────────────────

def parse_num(tok: str):
    """
    Parse a token as a positive float.
    Handles Russian comma-decimal and OCR artifacts like '60,.126' → 60.126.
    """
    t = tok.replace(' ', '').replace(',', '.')
    # Collapse multiple consecutive dots (e.g. '60..126' → '60.126')
    t = re.sub(r'\.{2,}', '.', t)
    # Strip trailing/leading dots
    t = t.strip('.')
    if not t:
        return None
    try:
        v = float(t)
        return v if v > 0 else None
    except Exception:
        return None


def extract_numbers_from_str(text: str):
    """
    Extract positive numbers from OCR text.
    Handles comma-decimal; does NOT allow spaces inside a number token.
    """
    # Replace artifacts (including spaces) with space — keeps commas/periods
    clean = re.sub(r'[|\[\]—©*^~`_\s]', ' ', text)
    # Match numeric tokens: must start and end with a digit, may contain , or .
    tokens = re.findall(r'\d[\d,.]*\d|\d', clean)
    result = []
    for tok in tokens:
        v = parse_num(tok)
        if v is not None:
            result.append(v)
    return result


# ─── Code-prefix & name cleanup ────────────────────────────────────────────────

# Code prefix with letter start: Д204_, М26_, Ан20_, Д223_, Д!08
LETTER_CODE_RE = re.compile(
    r'^[А-ЯA-Za-zА-Яа-яЁё][А-ЯA-Za-zА-Яа-яЁё0-9]{0,4}[_!-]\s*\d*\s*',
    re.UNICODE,
)

# Code prefix with digit start: 4108_, 4н16-
DIGIT_CODE_RE = re.compile(
    r'^\d[\dА-Яа-яA-Za-z]*[_!-]\s*\d*\s*',
    re.UNICODE,
)


def strip_code_prefix(text: str) -> str:
    m = LETTER_CODE_RE.match(text)
    if m:
        return text[m.end():]
    m = DIGIT_CODE_RE.match(text)
    if m:
        return text[m.end():]
    return text


# Name junk patterns
NAME_KLM_RE     = re.compile(r'\s+(КЛМ|КЛ|лм|клм)\b.*$', re.IGNORECASE | re.UNICODE)
BRAND_RE        = re.compile(r'\s+ЭКСТРАСИЛ\w*', re.IGNORECASE | re.UNICODE)
TRAILING_RE     = re.compile(r'[\s\-—|_.]+$')
LEADING_RE      = re.compile(r'^[\s\-—|_.]+')


def clean_name(raw: str) -> str:
    name = NAME_KLM_RE.sub('', raw)
    name = BRAND_RE.sub('', name)
    name = TRAILING_RE.sub('', name)
    name = LEADING_RE.sub('', name)
    return name.strip().upper()


# ─── Row tokeniser ─────────────────────────────────────────────────────────────

PURE_NUM_RE = re.compile(r'^\d[\d,.]*$')


def split_row(inner: str):
    """
    Split an OCR table row (leading '[' already stripped) into
    (material_name, list_of_numbers).

    Strategy:
    - Strip code prefix.
    - Replace OCR artifacts with spaces.
    - Split into tokens.
    - The first "purely numeric" token marks the start of the data columns.
    - The name is everything before that token.
    - Numbers are extracted from everything from that token onward,
      BUT we stop collecting numbers as soon as we hit 2+ consecutive
      non-numeric, non-junk tokens (to avoid including nutritional data
      from adjacent columns).
    """
    no_code = strip_code_prefix(inner)

    # Replace artifacts with spaces; keep comma (decimal sep) untouched
    clean = re.sub(r'[|\[\]—©*^~`_]', ' ', no_code)
    tokens = clean.split()

    name_toks  = []
    rest_toks  = []
    found_split = False

    for tok in tokens:
        if not found_split and PURE_NUM_RE.match(tok):
            found_split = True
        if found_split:
            rest_toks.append(tok)
        else:
            name_toks.append(tok)

    if not found_split:
        return clean_name(' '.join(name_toks)), []

    name = clean_name(' '.join(name_toks))

    # Build rest string but stop early when we hit letter tokens
    # (those are from adjacent nutritional-value columns that pollute our numbers)
    useful_rest = []
    letter_run  = 0
    for tok in rest_toks:
        if PURE_NUM_RE.match(tok) or re.match(r'^\d', tok):
            useful_rest.append(tok)
            letter_run = 0
        else:
            letter_run += 1
            if letter_run >= 2:
                break  # Two consecutive non-numeric tokens → stop

    rest_str = ' '.join(useful_rest)
    numbers  = extract_numbers_from_str(rest_str)

    # Hard-cap: only keep the first 6 numbers (activity, %, г/т, kg, price, cost)
    numbers = numbers[:6]

    return name, numbers


# ─── % ввода / расход кг detection ────────────────────────────────────────────

def find_pct_and_kg(numbers, batch_kg: float):
    """
    Return (pct_vvoda, raskhod_kg) from a list of at most 6 numbers.

    Validation: расход_kg ≈ pct × batch_kg / 100  (within 15 %).

    Handles:
    - Activity column before % ввода (e.g. MgO 65% activity then 40% ввода).
    - OCR comma-drop: "4032" is really 4.032 kg → try divisors [1, 1000, 0.001].
    - Limit search to next 4 numbers after candidate % (not the whole list),
      to avoid false positives from nutritional data appended by OCR.
    """
    for i, pct_cand in enumerate(numbers):
        if not (0.001 <= pct_cand <= 100.0):
            continue

        expected  = pct_cand * batch_kg / 100.0
        # Only look at the NEXT 4 numbers for the kg value
        remaining = numbers[i + 1: i + 5]

        best_adj = None
        best_err = 1e9

        for kg_cand in remaining:
            if kg_cand <= 0:
                continue
            for divisor in (1.0, 1000.0, 0.001):
                adj = kg_cand / divisor
                if expected > 0:
                    err = abs(adj - expected) / expected
                    if err < 0.15 and err < best_err:
                        best_err = err
                        best_adj = adj

        if best_adj is not None:
            return pct_cand, round(best_adj, 3)

    # Fallback 1: use first valid % and derive kg from it
    for pct_cand in numbers:
        if 0.001 <= pct_cand <= 100.0:
            return pct_cand, round(pct_cand * batch_kg / 100.0, 3)

    # Fallback 2: OCR may merge columns (e.g. "40,0000|400 000" → "4000001400000").
    # Try dividing each large number by powers of 10 to recover a valid %;
    # ONLY accept if we also find a corroborating kg value in the remaining numbers.
    for i, raw_n in enumerate(numbers):
        for factor in (10.0, 100.0, 1000.0):
            pct_cand = raw_n / factor
            if not (0.001 <= pct_cand <= 100.0):
                continue
            expected  = pct_cand * batch_kg / 100.0
            remaining = numbers[i + 1: i + 5]
            for kg_cand in remaining:
                for divisor in (1.0, 1000.0, 0.001):
                    adj = kg_cand / divisor
                    if expected > 0 and abs(adj - expected) / expected < 0.15:
                        return round(pct_cand, 4), round(adj, 3)

    return None, None


# ─── Skip logic ────────────────────────────────────────────────────────────────

SKIP_KW = (
    'ИТОГО', 'ВСЕГО', 'МИКРОЭЛЕМ', 'МИНЕРАЛ', 'КОРМОВЫЕ', 'ПЛАНОВАЯ',
    'КАЛЬКУЛ', 'ЦЕНА', 'СТОИМ', 'НАШЕН', 'НАИМЕН', 'ВВОДА',
    'ВИТАМИН', 'СОСТАВ', 'СОГЛАСОВ', 'УТВЕРЖ',
    'НАЧАЛЬНИК', 'ГЛ.', 'ИНЖЕНЕР', 'БУХГАЛТЕР', 'ДИРЕКТОР', 'ИСПОЛН',
)


def should_skip(text: str) -> bool:
    u = text.upper()
    return any(kw in u for kw in SKIP_KW)


# ─── Header ────────────────────────────────────────────────────────────────────

def parse_header(lines):
    recipe_code = ''
    recipe_name = ''
    recipe_date = ''
    batch_kg    = 1000.0

    for line in lines[:35]:
        line = line.strip()

        if 'РЕЦЕПТ' in line.upper() and not recipe_code:
            m = re.search(r'Д-[А-ЯA-ZА-Яа-яa-z0-9Ёё\-./]+', line)
            if m:
                recipe_code = m.group().rstrip('.')

        m = re.search(r'(\d{2}[.\-/]\d{2}[.\-/]\d{4})', line)
        if m and not recipe_date:
            recipe_date = m.group(1)

        m = re.search(r'Выработка[:\s]*([\d,.\s]+)\s*т', line, re.IGNORECASE)
        if m:
            try:
                batch_kg = float(m.group(1).replace(',', '.').replace(' ', '')) * 1000
            except Exception:
                pass

        if 'ДЛЯ' in line.upper() and len(line) > 10 and not recipe_name:
            cleaned = re.sub(r'^Для\s*\|?\s*', '', line, flags=re.IGNORECASE).strip()
            recipe_name = cleaned

    return recipe_code, recipe_name, recipe_date, batch_kg


# ─── Main parse ────────────────────────────────────────────────────────────────

def parse_recipe_text(text: str):
    lines = text.split('\n')
    recipe_code, recipe_name, recipe_date, batch_kg_base = parse_header(lines)

    # Actual input batch is ~0.8 % larger than output (moisture losses)
    batch_kg = batch_kg_base * 1.008

    rows  = []
    seen  = set()

    for raw_line in lines:
        line = raw_line.strip()
        if not line.startswith('['):
            continue

        inner = line.lstrip('[').rstrip(']').strip()

        name, numbers = split_row(inner)

        if not name or len(name) < 3:
            continue
        # Skip based on NAME only (not the full OCR line which may contain
        # nutritional column text like ВИТАМИНВ5 that pollutes the line)
        if should_skip(name):
            continue
        if name in seen:
            continue
        if not numbers:
            continue

        pct, kg = find_pct_and_kg(numbers, batch_kg)
        if pct is None or pct <= 0 or kg is None or kg <= 0:
            continue

        seen.add(name)
        rows.append({
            'rawName'    : name,
            'percentage' : round(pct, 4),
            'quantityKg' : round(kg, 3),
        })

    return {
        'code'   : recipe_code,
        'name'   : recipe_name or recipe_code,
        'date'   : recipe_date,
        'batchKg': round(batch_kg, 1),
        'rows'   : rows,
    }


# ─── OCR runner ────────────────────────────────────────────────────────────────

def run_ocr(img_path: str) -> str:
    result = subprocess.run(
        ['tesseract', img_path, 'stdout', '-l', 'rus', '--psm', '6'],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f'Tesseract exited {result.returncode}: {result.stderr[:300]}'
        )
    return result.stdout


# ─── Entry point ───────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: ocr_recipe.py <pdf_path>'}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print(json.dumps({'error': f'File not found: {pdf_path}'}))
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmpdir:
        img_path = os.path.join(tmpdir, 'recipe.png')

        try:
            doc  = fitz.open(pdf_path)
            page = doc[0]
            mat  = fitz.Matrix(2.5, 2.5)
            pix  = page.get_pixmap(matrix=mat, colorspace=fitz.csGRAY)
            pix.save(img_path)
            doc.close()
        except Exception as exc:
            print(json.dumps({'error': f'PDF render failed: {exc}'}))
            sys.exit(1)

        try:
            ocr_text = run_ocr(img_path)
        except Exception as exc:
            print(json.dumps({'error': str(exc)}))
            sys.exit(1)

    recipe = parse_recipe_text(ocr_text)
    print(json.dumps(recipe, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
