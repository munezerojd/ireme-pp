"""NISR-trained farm advisor (server side).

Reads data/nisr_insights.json, produced by scripts/build_nisr_insights.py from the NISR Agricultural
Household Survey 2024 microdata. Pure Python - no pandas/numpy needed at run time.
The same maths is implemented in frontend/src/nisr/engine.js so the app also works offline.
"""
from __future__ import annotations
import json, math, os
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent
INSIGHTS_PATH = Path(os.getenv('IREME_NISR_INSIGHTS', str(BASE_DIR / 'data' / 'nisr_insights.json')))
PRACTICES = ['improved_seed', 'inorganic', 'organic', 'pesticide', 'irrigation', 'anti_erosion']
_cache: dict = {}


def load_insights() -> Optional[dict]:
    """Load (and cache by file modification time) the insight file; None when it has not been built."""
    try:
        mtime = INSIGHTS_PATH.stat().st_mtime
    except OSError:
        return None
    if _cache.get('mtime') != mtime:
        _cache['data'] = json.loads(INSIGHTS_PATH.read_text(encoding='utf-8'))
        _cache['mtime'] = mtime
    return _cache['data']


def current_season(month: int) -> str:
    if month >= 9 or month <= 2: return 'A'
    return 'B' if month <= 6 else 'C'


def predict_yield(ins: dict, crop: str, district: Optional[str], season: str = 'A',
                  practices: Optional[dict] = None, window: str = 'main', area_ha: Optional[float] = None) -> Optional[dict]:
    """Median expected yield (kg/ha) and the middle-half range for similar plots.

    Evaluated at the crop's typical survey plot size; area_ha only scales the harvest total.
    """
    practices = practices or {}
    node = ins['crops'].get(crop)
    model = node and node.get('model')
    if not model:
        return None
    c = model['coef']
    s = season if season in model['seasons'] else model['seasons'][0]
    z = c['intercept']
    z += c.get('d:' + str(district), c.get('d:Other', 0.0))
    z += c.get('s:' + s, 0.0)
    for p in PRACTICES:
        if practices.get(p): z += c.get('p:' + p, 0.0)
    if practices.get('intercrop'): z += c.get('p:intercrop', 0.0)
    if window == 'early': z += c.get('w:early', 0.0)
    if window == 'late': z += c.get('w:late', 0.0)
    rq = model['resid_q']
    out = {'median': math.exp(z), 'low': math.exp(z + rq['0.25']), 'high': math.exp(z + rq['0.75']), 'season': s}
    if area_ha and area_ha > 0:
        out['area_ha'] = area_ha
        out['total'] = {k: out[k] * area_ha for k in ('median', 'low', 'high')}
    return out


def advise(ins: dict, crop: str, district: Optional[str] = None, season: Optional[str] = None,
           practices: Optional[dict] = None, area_ha: Optional[float] = None) -> dict:
    practices = practices or {}
    node = ins['crops'][crop]
    model = node.get('model')
    s = season or 'A'
    d_node = node['district'].get(district) if district else None
    out = {
        'crop': crop, 'district': district, 'season': s,
        'benchmarks': {'district': d_node, 'national': node['national'], 'season': node['season'].get(s)},
        'recommendations': [], 'risks': [], 'notes': [],
        'source': ins['meta']['source'], 'caveat': ins['meta']['caveat'],
    }
    if model:
        out['model'] = {'n': model['n'], 'cv_r2': model['cv_r2']}
        out['expected'] = predict_yield(ins, crop, district, s, practices, area_ha=area_ha)
        cands = []
        for p in PRACTICES:
            if practices.get(p): continue
            e = model['effects'].get('p:' + p)
            n_yes = (node['practices'].get(p) or {}).get('n_yes', 0)
            if not e or (e['lo'] == 0 and e['hi'] == 0): continue
            if e['pct'] >= 8 and e['lo'] > 3 and n_yes >= 25:
                cands.append({'key': p, 'effect_pct': e['pct'], 'low_pct': e['lo'], 'high_pct': e['hi'],
                              'adoption_share': (node['practices'].get(p) or {}).get('share')})
        cands.sort(key=lambda r: -r['effect_pct'])
        out['recommendations'] = cands[:4]
        late = model['effects'].get('w:late')
        if late and late['hi'] < -5:
            out['recommendations'].append({'key': 'timing', 'effect_pct': late['pct'], 'low_pct': late['lo'], 'high_pct': late['hi'],
                                           'adoption_share': None})
        with_rec = dict(practices)
        for r in out['recommendations']:
            if r['key'] in PRACTICES: with_rec[r['key']] = True
        out['potential'] = predict_yield(ins, crop, district, s, with_rec, window='main', area_ha=area_ha)
    dist = ins['districts'].get(district) if district else None
    if dist:
        th = dist.get('soil_threats', {})
        allth = [x.get('soil_threats', {}) for x in ins['districts'].values()]
        def med(k):
            v = sorted((t.get(k) or 0) for t in allth)
            return v[len(v) // 2] if v else 0
        for k in ('erosion', 'fertility_loss', 'waterlogging', 'landslide'):
            v = th.get(k) or 0
            if v >= 0.05 and v >= 1.3 * med(k):
                out['risks'].append({'key': k, 'share': v})
        out['risks'] = sorted(out['risks'], key=lambda r: -r['share'])[:2]
        out['irrigation_barriers'] = dist.get('irrigation_barriers')
    out['best_crops_in_district'] = ins['ranking'].get(district, [])[:5] if district else []
    return out
