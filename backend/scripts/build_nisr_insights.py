"""
Build IREME's NISR insight file from the Agricultural Household Survey (AHS) 2024 microdata.

What it does
------------
1. Reads the plot-level crop file (Sections 3-4: crops, seeds, harvest, fertilizer, pesticide,
   irrigation, anti-erosion) from the NISR microdata (.dta).
2. Cleans it (planted crops with a positive harvest, plausible yields) and computes
   survey-weighted yield statistics by crop / season / district.
3. "Trains" one small, transparent regression model per major crop:
        log(yield) ~ district + season + improved seed + inorganic fertilizer
                     + organic fertilizer + pesticide + irrigation + anti-erosion
                     + intercropping + planting window + log(plot size)
   Out-of-sample quality (5-fold cross-validated R2) and bootstrap confidence intervals for each
   practice effect are stored next to the coefficients, so the advisor can say how sure it is.
4. Writes backend/data/nisr_insights.json. The FastAPI backend and the React app only read this
   file at run time - pandas/numpy are NOT needed to run IREME.

Usage
-----
    pip install pandas numpy
    python scripts/build_nisr_insights.py --data "/path/to/Microdata" --out data/nisr_insights.json

`--data` is the folder that contains AHS2024_Section3_4_CROP GROWN, SEEDS AND PRODUCTION & ...dta

Important: the model describes statistical associations in survey data. It is not a randomised
experiment, so IREME presents effects as "farmers who did X had about Y% higher yield", never as a
guarantee.
"""
from __future__ import annotations
import argparse, json, datetime as dt
from pathlib import Path
import numpy as np
import pandas as pd

CROP_FILE = 'AHS2024_Section3_4_CROP GROWN, SEEDS AND PRODUCTION & AGRICULTURAL INPUTS AND PRACTICES.dta'
SLOTS = range(1, 8)
MIN_MODEL_N = 150       # plots needed to train a crop model
MIN_STAT_N = 30         # plots needed to publish a crop/season statistic
MIN_DISTRICT_N = 20     # plots needed to publish a district statistic
RNG = np.random.default_rng(2024)

PRACTICES = ['improved_seed', 'inorganic', 'organic', 'pesticide', 'irrigation', 'anti_erosion', 'intercrop']
PRACTICE_LABELS = {
    'improved_seed': 'Improved seed', 'inorganic': 'Inorganic fertilizer', 'organic': 'Organic fertilizer / compost',
    'pesticide': 'Pesticide / fungicide', 'irrigation': 'Irrigation', 'anti_erosion': 'Anti-erosion measures',
    'intercrop': 'Intercropping (mixed with other crops)'}

# Sowing windows. Codes come from the questionnaire value labels; each season has its own ladder.
SOWING_GROUPS = {
    'A': {'early': [1, 2, 3, 4, 5], 'main': [6, 7], 'late': [8, 9, 10]},      # before 31/08 | Sep | Oct+
    'B': {'early': [12, 13, 14], 'main': [15, 16], 'late': [17, 18, 19]},     # up to Jan | Feb | Mar+
}
SOWING_TEXT = {
    'A': {'early': 'before 1 September', 'main': 'in September', 'late': 'in October or later'},
    'B': {'early': 'in January or earlier', 'main': 'in February', 'late': 'in March or later'},
}
SOIL_THREATS = {1: 'erosion', 2: 'fertility_loss', 3: 'waterlogging', 4: 'salinization', 5: 'landslide', 7: 'none'}


# ----------------------------------------------------------------------------- helpers
def wquantile(x, w, q):
    x = np.asarray(x, float); w = np.asarray(w, float)
    if len(x) == 0: return None
    o = np.argsort(x); x = x[o]; w = w[o]
    c = np.cumsum(w) - 0.5 * w
    c /= w.sum()
    return float(np.interp(q, c, x))


def wshare(mask, w):
    w = np.asarray(w, float)
    return float((np.asarray(mask, float) * w).sum() / w.sum()) if w.sum() else None


def r0(v): return None if v is None or (isinstance(v, float) and np.isnan(v)) else int(round(v))
def r3(v): return None if v is None or (isinstance(v, float) and np.isnan(v)) else round(float(v), 3)


def load(data_dir: Path):
    path = data_dir / CROP_FILE
    reader = pd.io.stata.StataReader(str(path))
    value_labels = reader.value_labels()
    df = reader.read(convert_categoricals=False)
    crop_names = {int(k): v.strip() for k, v in value_labels['S3_Q4_1'].items()}
    district_names = {int(k): v.strip() for k, v in value_labels['s1q2'].items()}
    fert_names = {int(k): v.strip() for k, v in value_labels['S4_Q6'].items()}
    return df, crop_names, district_names, fert_names


def to_long(df, crop_names, district_names):
    base = ['hhid', 'province', 'district', 'Season', 's2q1', 's2q2', 'weight', 's4_q1', 's4_q4', 's4_q12',
            's4_q22', 's4_q19', 's4_q18_1', 's4_q18_2', 's4_q18_3', 's4_q6', 's4_q6_2']
    parts = []
    for i in SLOTS:
        def col(name, i=i):
            n = name.format(i)
            return df[n] if n in df.columns else pd.Series(np.nan, index=df.index)
        sub = df[base].copy()
        sub['crop_code'] = col('s3_q4_{}')
        sub['prop'] = col('s3_q4_{}a')
        sub['planted'] = col('s3_q7_{}a')
        sub['sow'] = col('s3_q7_{}')
        sub['seed'] = col('s3_q9_{}')
        sub['harvest_kg'] = col('s3_q20_{}')
        sub['trend'] = col('s2q23_{}')
        parts.append(sub[sub['crop_code'].notna()])
    L = pd.concat(parts, ignore_index=True)
    L['crop'] = L['crop_code'].astype(int).map(crop_names)
    L['district_name'] = L['district'].astype(int).map(district_names)
    L['season'] = L['Season'].map({1: 'A', 2: 'B', 3: 'C'})
    L['crop_area_ha'] = (L['s2q2'] / 10000.0) * L['prop'] / 100.0
    L['yield_kg_ha'] = L['harvest_kg'] / L['crop_area_ha']
    # practice flags (questionnaire coding: 1 = yes)
    L['improved_seed'] = L['seed'].isin([2, 3]).astype(int)
    L['inorganic'] = (L['s4_q4'] == 1).astype(int)
    L['organic'] = (L['s4_q1'] == 1).astype(int)
    L['pesticide'] = (L['s4_q12'] == 1).astype(int)
    L['irrigation'] = (L['s4_q22'] == 1).astype(int)
    L['anti_erosion'] = (L['s4_q19'] == 1).astype(int)
    L['intercrop'] = (L['prop'] < 100).astype(int)
    # sowing window
    L['sow_window'] = None
    for s, groups in SOWING_GROUPS.items():
        for g, codes in groups.items():
            L.loc[(L['season'] == s) & L['sow'].isin(codes), 'sow_window'] = g
    return L


def clean_yields(L):
    x = L[(L['planted'] == 1) & (L['harvest_kg'] > 0) & (L['crop_area_ha'] > 0.0005)].copy()
    keep = []
    for crop, g in x.groupby('crop'):
        lo, hi = g['yield_kg_ha'].quantile([0.01, 0.99])
        keep.append(g[(g['yield_kg_ha'] >= lo) & (g['yield_kg_ha'] <= hi)])
    return pd.concat(keep, ignore_index=True)


def summarise(g):
    y, w = g['yield_kg_ha'].values, g['weight'].values
    avg = float((g['harvest_kg'] * w).sum() / (g['crop_area_ha'] * w).sum())   # ratio of weighted totals
    return {'n': int(len(g)), 'median': r0(wquantile(y, w, .5)), 'p25': r0(wquantile(y, w, .25)),
            'p75': r0(wquantile(y, w, .75)), 'avg': r0(avg)}


# ----------------------------------------------------------------------------- modelling
def design(g, districts, seasons):
    cols, names = [], []
    for d in districts:
        cols.append((g['district_name'] == d).astype(float).values); names.append('d:' + d)
    for s in seasons[1:]:
        cols.append((g['season'] == s).astype(float).values); names.append('s:' + s)
    for p in PRACTICES:
        cols.append(g[p].astype(float).values); names.append('p:' + p)
    for sw in ('early', 'late'):                       # 'main' window is the reference
        cols.append((g['sow_window'] == sw).astype(float).values); names.append('w:' + sw)
    cols.append(np.log(g['crop_area_ha'].values) - np.log(g['crop_area_ha'].median())); names.append('log_area')
    X = np.column_stack(cols)
    return X, names


def ridge(X, y, alpha=3.0):
    Xb = np.column_stack([np.ones(len(X)), X])
    pen = np.eye(Xb.shape[1]) * alpha; pen[0, 0] = 0
    return np.linalg.solve(Xb.T @ Xb + pen, Xb.T @ y)


def predict(X, beta): return beta[0] + X @ beta[1:]


def fit_crop(g):
    g = g.copy()
    seasons = sorted(g['season'].unique(), key=lambda s: 'ABC'.index(s))
    dist_counts = g['district_name'].value_counts()
    districts = [d for d, c in dist_counts.items() if c >= 15]
    g.loc[~g['district_name'].isin(districts), 'district_name'] = 'Other'
    districts = districts + (['Other'] if (g['district_name'] == 'Other').any() else [])
    # districts with a window group missing are fine - the dummies are simply all zero
    X, names = design(g, districts, seasons)
    y = np.log(g['yield_kg_ha'].values)
    beta = ridge(X, y)
    resid = y - predict(X, beta)
    # 5-fold cross-validated R2 (versus predicting the crop's mean log-yield)
    idx = RNG.permutation(len(y)); folds = np.array_split(idx, 5)
    sse = sst = 0.0
    for f in folds:
        tr = np.setdiff1d(idx, f)
        b = ridge(X[tr], y[tr])
        sse += ((y[f] - predict(X[f], b)) ** 2).sum()
        sst += ((y[f] - y[tr].mean()) ** 2).sum()
    cv_r2 = 1 - sse / sst
    # bootstrap confidence intervals of practice and window effects
    B = 200; boots = []
    for _ in range(B):
        ii = RNG.integers(0, len(y), len(y))
        boots.append(ridge(X[ii], y[ii]))
    boots = np.array(boots)
    effects = {}
    for j, nme in enumerate(names):
        if nme.startswith(('p:', 'w:', 's:')):
            col = boots[:, j + 1]
            pct = lambda v: (np.exp(v) - 1) * 100
            effects[nme] = {'pct': round(float(pct(beta[j + 1])), 1),
                            'lo': round(float(pct(np.percentile(col, 10))), 1),
                            'hi': round(float(pct(np.percentile(col, 90))), 1)}
    smear = float(np.mean(np.exp(resid)))
    coefs = {'intercept': round(float(beta[0]), 4)}
    for j, nme in enumerate(names): coefs[nme] = round(float(beta[j + 1]), 4)
    return {
        'n': int(len(y)), 'cv_r2': round(float(cv_r2), 3), 'smearing': round(smear, 4),
        'resid_q': {q: round(float(np.quantile(resid, q)), 4) for q in (0.1, 0.25, 0.75, 0.9)},
        'median_area_ha': round(float(g['crop_area_ha'].median()), 5),
        'coef': coefs, 'effects': effects, 'seasons': seasons,
        'districts': [d for d in districts if d != 'Other'],
    }


# ----------------------------------------------------------------------------- household context
def household_context(data_dir: Path, district_names: dict):
    """Weighted district shares of households in cooperatives, farmer groups, with insurance, credit, etc.

    Sources: AHS2024 Section 0 (weights, district), Section 6 (extension and programmes), Credits.
    Returns {'national': {...}, 'district': {name: {...}}} or None when the files are missing.
    """
    import glob
    try:
        s0 = pd.read_stata(str(data_dir / 'AHS2024_Section0.dta'), convert_categoricals=False)
        s6 = pd.read_stata(glob.glob(str(data_dir / 'AHS2024_Section6_*.dta'))[0], convert_categoricals=False)
        cr = pd.read_stata(str(data_dir / 'AHS2024_Credits.dta'), convert_categoricals=False)
    except Exception:
        return None
    hh = s0[['hhid', 'district', 'weight']].drop_duplicates('hhid').copy()
    ext = s6.drop_duplicates('hhid').set_index('hhid')
    hh['cooperative'] = hh['hhid'].map(ext['s6q10'] == 1)
    hh['twigire'] = hh['hhid'].map(ext['s6q5'] == 1)
    hh['field_school'] = hh['hhid'].map(ext['s6q6'] == 1)
    hh['contract_farming'] = hh['hhid'].map(ext['s6q7'] == 1)
    hh['crop_insurance'] = hh['hhid'].map(ext['s6q8'] == 1)
    hh['kitchen_garden'] = hh['hhid'].map(ext['s6q13'] == 1)
    hh['support_received'] = hh['hhid'].map(ext['s6q14'] == 1)
    loan_try = cr.groupby('hhid')['s10aq1'].apply(lambda x: (x == 1).any())
    hh['loan_tried'] = hh['hhid'].map(loan_try)
    keys = ['cooperative', 'twigire', 'field_school', 'contract_farming', 'crop_insurance', 'kitchen_garden', 'support_received', 'loan_tried']

    def shares(g):
        w = g['weight'].values
        out = {k: r3(wshare(g[k].fillna(False).astype(bool).values, w)) for k in keys}
        out['n_households'] = int(len(g))
        return out
    res = {'national': shares(hh), 'district': {}}
    for d, g in hh.groupby('district'):
        name = district_names.get(int(d))
        if name and len(g) >= 20:
            res['district'][name] = shares(g)
    return res


# ----------------------------------------------------------------------------- main build
def build(data_dir: Path):
    df, crop_names, district_names, fert_names = load(data_dir)
    L = to_long(df, crop_names, district_names)
    X = clean_yields(L)
    n_all = int(len(df))
    out = {
        'meta': {
            'source': 'NISR Agricultural Household Survey (AHS) 2024 microdata, plot-level crop, input and practice records',
            'built_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d'),
            'households_plots': n_all, 'crop_records_used': int(len(X)),
            'method': 'Survey-weighted medians; per-crop log-yield regression with bootstrap intervals',
            'caveat': ('Associations from survey data, not guarantees. Yields are farmer-reported harvest per hectare of crop '
                       'area on sampled plots and differ from NISR\'s official published national totals. Confirm inputs '
                       'with RAB or your district agronomist.'),
            'practice_labels': PRACTICE_LABELS, 'sowing_text': SOWING_TEXT,
        },
        'crops': {}, 'districts': {}, 'ranking': {},
    }
    counts = X.groupby('crop').size().sort_values(ascending=False)
    crops = [c for c, n in counts.items() if n >= MIN_STAT_N]
    trend_map = {1: 'up', 2: 'up', 3: 'same', 4: 'down', 5: 'down'}

    for crop in crops:
        g = X[X['crop'] == crop]
        node = {'n': int(len(g)), 'national': summarise(g), 'season': {}, 'district': {}, 'practices': {}, 'planting': {}}
        for s, gs in g.groupby('season'):
            if len(gs) >= MIN_STAT_N: node['season'][s] = summarise(gs)
        for d, gd in g.groupby('district_name'):
            if len(gd) >= MIN_DISTRICT_N:
                node['district'][d] = summarise(gd)
        # practice adoption and raw (unadjusted) yield gap
        for p in PRACTICES:
            share = wshare(g[p] == 1, g['weight'])
            yes, no = g[g[p] == 1], g[g[p] == 0]
            gap = None
            if len(yes) >= 25 and len(no) >= 25:
                gap = round((wquantile(yes['yield_kg_ha'], yes['weight'], .5) / wquantile(no['yield_kg_ha'], no['weight'], .5) - 1) * 100, 1)
            node['practices'][p] = {'share': r3(share), 'raw_gap_pct': gap, 'n_yes': int(len(yes))}
        # planting window
        for s in ('A', 'B'):
            gs = g[g['season'] == s]
            win = {}
            for w_name in ('early', 'main', 'late'):
                gw = gs[gs['sow_window'] == w_name]
                if len(gw) >= 25:
                    win[w_name] = {'n': int(len(gw)), 'median': r0(wquantile(gw['yield_kg_ha'], gw['weight'], .5)),
                                   'share': r3(len(gw) / max(1, gs['sow_window'].notna().sum()))}
            if len(win) >= 2: node['planting'][s] = win
        # farmer-reported trend of the crop's production
        tr = g['trend'].map(trend_map).dropna()
        if len(tr) >= 50:
            node['trend'] = {k: round(float((tr == k).mean()), 3) for k in ('up', 'same', 'down')}
        # which fertilisers are used with this crop (share of fertilised plots)
        fp = g[(g['inorganic'] == 1) & g['s4_q6'].notna()]
        if len(fp) >= 40:
            vc = fp['s4_q6'].astype(int).map(fert_names).value_counts(normalize=True).head(3)
            node['fertilizer_types'] = {k: round(float(v), 3) for k, v in vc.items()}
        if counts[crop] >= MIN_MODEL_N:
            node['model'] = fit_crop(g)
        out['crops'][crop] = node

    # district context: adoption, soil threats, irrigation barriers (all plots, weighted)
    P = L[L['planted'] == 1].drop_duplicates(['hhid', 's2q1', 'Season'])
    for d, gd in P.groupby('district_name'):
        w = gd['weight']
        threats = {}
        for code, name in SOIL_THREATS.items():
            m = ((gd['s4_q18_1'] == code) | (gd['s4_q18_2'] == code) | (gd['s4_q18_3'] == code))
            threats[name] = r3(wshare(m, w))
        out['districts'][d] = {
            'n_plots': int(len(gd)), 'province': int(gd['province'].mode().iloc[0]),
            'adoption': {p: r3(wshare(gd[p] == 1, w)) for p in PRACTICES if p != 'intercrop'},
            'soil_threats': threats,
            'irrigation_barriers': {
                'not_needed': r3(wshare(gd['s4_q22'] == 2, w)), 'cannot_afford': r3(wshare(gd['s4_q22'] == 3, w)),
                'no_water': r3(wshare(gd['s4_q22'] == 4, w))},
        }

    # best crops per district: yield relative to the national median of the same crop
    for d in out['districts']:
        rows = []
        for crop, node in out['crops'].items():
            dd = node['district'].get(d)
            nat = node['national']['median']
            if dd and dd['n'] >= 30 and nat:
                rows.append({'crop': crop, 'median': dd['median'], 'index': round(dd['median'] / nat, 2), 'n': dd['n']})
        rows.sort(key=lambda r: -r['index'])
        out['ranking'][d] = rows[:8]

    ctx = household_context(data_dir, district_names)
    if ctx:
        out['households'] = ctx
        out['meta']['households_surveyed'] = ctx['national']['n_households']
    out['meta']['crops_modelled'] = [c for c, n in out['crops'].items() if 'model' in n]
    out['meta']['districts'] = sorted(out['districts'])
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True, help='Folder with AHS2024 .dta files')
    ap.add_argument('--out', default=str(Path(__file__).resolve().parent.parent / 'data' / 'nisr_insights.json'))
    a = ap.parse_args()
    result = build(Path(a.data))
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('Wrote', a.out, '| crops:', len(result['crops']), '| modelled:', result['meta']['crops_modelled'])
