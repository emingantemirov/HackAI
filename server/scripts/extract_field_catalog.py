#!/usr/bin/env python3
"""Extrahiert den Feldkatalog (Stellen, Länge, Typ, Art, Name) aus der Verfahrensbeschreibung
DTA EEL (pdftotext -layout Ausgabe). Ergebnis: server/data/eel-field-catalog.json

Jedes Feld behält Seiten-/Zeilenbezug zur Quelle. Nichts wird ergänzt, was nicht im Text steht.
Aufruf: extract_field_catalog.py <verfahren.txt> <out.json> <sha256-der-pdf>
"""
import json, re, sys

txt_path, out_path, src_sha = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(txt_path, encoding='utf-8').read().split('\n')

BLOCK_RE = re.compile(r'^\s*(?:Datenbaustein|Datensatz)\s+(DSLW|DBNA|DBAN|DBAL|DBAE|DBZA|DBEE|DBAW|DBFR|DBUN|DBMU|DBVO|DBHE|DBBE|DBLT|DBSF|DBTK|DBAP|DBID|DBSD|DBFE)\b(?!.*\.{4})')
ROW_RE = re.compile(r'^\s*(\d{3})\s*[-–]?\s+(\d{3})\s+(an|n|N|AN)\s+([Mm])\s{2,}(.+?)(?:\s{2,}(.*))?$')
PAGE_RE = re.compile(r'Seite (\d+) von 168')
END_RE = re.compile(r'^\s*(\d{3})\s{2,}(\S.*)?$')

current_block = None
page = None
fields = []
for i, line in enumerate(lines):
    m = PAGE_RE.search(line)
    if m:
        page = int(m.group(1))
    b = BLOCK_RE.match(line)
    if b:
        current_block = b.group(1)
        continue
    r = ROW_RE.match(line)
    if not r or not current_block:
        continue
    start, length, typ, art, name, rest = r.groups()
    name = name.strip()
    # Namensfortsetzung in der Folgezeile (Zeile mit Endposition + Rest des Namens)
    if name.endswith('-') or (rest is None and False):
        for j in range(i + 1, min(i + 4, len(lines))):
            e = END_RE.match(lines[j])
            if e and e.group(2):
                cont = re.split(r'\s{2,}', e.group(2).strip())[0]
                name = name + cont
                break
    # Ende steht allein in der Folgezeile; wir berechnen aus Start+Länge
    s, l = int(start), int(length)
    fields.append({
        'block': current_block, 'start': s, 'length': l, 'end': s + l - 1,
        'type': typ.lower(), 'kind': 'M' if art == 'M' else 'm',
        'name': name.replace('„', '"').replace('“', '"'),
        'repeating': ('nn' in name.lower()),
        'source': {'document': 'Verfahrensbeschreibung DTA EEL V13.4', 'sha256': src_sha, 'page': page},
    })

NAME_FIX = {
    'AKTENZEICHEN -SV': 'AKTENZEICHEN-SV',
    'MODIFIKATIONS-IDEN-TIFIER': 'MODIFIKATIONS-IDENTIFIER',
    'BBNR-ABRECHNUNGS-STELLE': 'BBNR-ABRECHNUNGSSTELLE',
    'RUECKMELDUNG-ENT-GELTERSATZLEISTUNG': 'RUECKMELDUNG-ENTGELTERSATZLEISTUNG',
    'ABRECHNUNGSPRO-GRAMM': 'ABRECHNUNGSPROGRAMM',
    'AKTENZEICHEN-VER-URSACHER': 'AKTENZEICHEN-VERURSACHER',
    'DATENSATZ-ID-UR-SPRUNGSMELDUNG': 'DATENSATZ-ID-URSPRUNGSMELDUNG',
    'TEIL-ANR-AU-BE-GINN-"nn"': 'TEIL-ANR-AU-BEGINN-"nn"',
}
for f in fields:
    n = f['name']
    if n.startswith('AKTENZEICHEN-VERUR-'):
        n = 'AKTENZEICHEN-VERURSACHER'
    f['name'] = NAME_FIX.get(n, n)
    f['curated_name'] = n != f['name'] or f['name'] in NAME_FIX.values()

# Deduplizieren (Seitenumbrüche können Zeilen wiederholen) – eindeutig über Block+Start+Name
seen, out = set(), []
for f in fields:
    k = (f['block'], f['start'], f['name'])
    if k in seen:
        continue
    seen.add(k)
    out.append(f)

by_block = {}
for f in out:
    by_block.setdefault(f['block'], []).append(f)
for b in by_block.values():
    b.sort(key=lambda f: f['start'])

by_block.setdefault('DSLW', []).append({
    'block': 'DSLW', 'start': 206, 'length': 19, 'end': 224, 'type': 'opaque', 'kind': 'm',
    'name': 'NICHT-KOMMENTIERT-206-224', 'repeating': False, 'curated_name': True,
    'source': {'document': 'Verfahrensbeschreibung DTA EEL V13.4', 'sha256': src_sha, 'page': 49,
               'quote_ref': 'Von einer Kommentierung der weiteren Stellen 206 – 224 des DSLW wurde abgesehen.'}})
for gap in ('DBNA', 'DBAN', 'DBAP'):
    by_block.setdefault(gap, [])
json.dump({'generated_from': 'Verfahrensbeschreibung DTA EEL Version 13.4 (pdftotext -layout)',
           'note': 'Maschinell extrahiert; vor fachlicher Nutzung prüfen. Feldpositionen 001-004 jedes Bausteins = Kennung.',
           'blocks': by_block}, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for k, v in by_block.items():
    print(k, len(v), 'Felder, letzte Stelle', max((f['end'] for f in v), default='-- (nicht kommentiert)'))
