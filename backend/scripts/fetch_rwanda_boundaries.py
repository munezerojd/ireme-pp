"""Download Rwanda's 30 district outlines once, so the IREME map works offline.

Run this on a computer with internet access:
    python backend/scripts/fetch_rwanda_boundaries.py

Source: geoBoundaries (open data, CC BY 4.0), level ADM2 = districts.
Output: frontend/public/rwanda_districts.geojson - each feature gets a clean `name` equal to IREME's district name.
The app loads this file first and only falls back to the online source when it is missing.
"""
import json, re, sys, unicodedata, urllib.request
from pathlib import Path

API = 'https://www.geoboundaries.org/api/current/gbOpen/RWA/ADM2/'
OUT = Path(__file__).resolve().parents[2] / 'frontend' / 'public' / 'rwanda_districts.geojson'
DISTRICTS = ['Nyarugenge', 'Gasabo', 'Kicukiro', 'Kamonyi', 'Gicumbi', 'Bugesera', 'Nyanza', 'Gisagara', 'Nyaruguru', 'Huye',
             'Nyamagabe', 'Ruhango', 'Muhanga', 'Ngororero', 'Karongi', 'Rutsiro', 'Rusizi', 'Nyamasheke', 'Rubavu', 'Nyabihu',
             'Rulindo', 'Gakenke', 'Musanze', 'Burera', 'Rwamagana', 'Kirehe', 'Ngoma', 'Kayonza', 'Nyagatare', 'Gatsibo']


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', s or '').lower()
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z]+', '', s.replace('district', ''))


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def main():
    meta = get(API)
    url = meta.get('gjDownloadURL') or meta.get('simplifiedGeometryGeoJSON')
    if not url:
        sys.exit('geoBoundaries did not return a GeoJSON link: ' + json.dumps(meta)[:300])
    data = get(url)
    keys = {norm(d): d for d in DISTRICTS}
    kept, missing = [], set(DISTRICTS)
    for f in data.get('features', []):
        p = f.get('properties', {})
        name = keys.get(norm(p.get('shapeName') or p.get('name') or ''))
        if not name:
            continue
        kept.append({'type': 'Feature', 'properties': {'name': name, 'shapeISO': p.get('shapeISO'), 'source': 'geoBoundaries gbOpen RWA ADM2'}, 'geometry': f['geometry']})
        missing.discard(name)
    if len(kept) < 28:
        sys.exit(f'Only matched {len(kept)} districts; missing: {sorted(missing)}. Check the file and names.')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({'type': 'FeatureCollection', 'features': kept}, separators=(',', ':')), encoding='utf-8')
    print(f'Wrote {OUT} with {len(kept)} districts. Missing: {sorted(missing) or "none"}')


if __name__ == '__main__':
    main()
