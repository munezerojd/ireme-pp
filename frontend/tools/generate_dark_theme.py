"""Generate src/dark.css from src/style.css.

Every colour in the existing stylesheet is mapped to a dark-theme equivalent (same hue, inverted lightness, so layout, look and
contrast relationships stay the same) and emitted under  html[data-theme="dark"] .  Light mode is untouched.
Re-run after changing style.css:   python tools/generate_dark_theme.py
"""
import colorsys, re, sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / 'src' / 'style.css'
OUT = Path(__file__).resolve().parent.parent / 'src' / 'dark.css'
NAMED = {'white': '#ffffff', 'black': '#000000'}
COLOR_RE = re.compile(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b')
PROPS = ('color', 'background', 'background-color', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color',
         'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color', 'fill', 'stroke', 'outline', 'outline-color', 'text-decoration-color', 'caret-color', 'accent-color')


def parse(c):
    c = c.strip().lower()
    if c in NAMED: c = NAMED[c]
    if c.startswith('#'):
        h = c[1:]
        if len(h) in (3, 4): h = ''.join(x * 2 for x in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return r, g, b, a
    m = re.match(r'rgba?\(([^)]*)\)', c)
    parts = [p.strip() for p in re.split(r'[,\s/]+', m.group(1)) if p.strip()]
    vals = [float(p.rstrip('%')) * (2.55 if p.endswith('%') else 1) for p in parts[:3]]
    a = float(parts[3]) if len(parts) > 3 else 1.0
    return vals[0], vals[1], vals[2], a


def fmt(r, g, b, a):
    r, g, b = [max(0, min(255, int(round(x)))) for x in (r, g, b)]
    return f'#{r:02x}{g:02x}{b:02x}' if a >= 0.999 else f'rgba({r},{g},{b},{round(a, 3)})'


def map_color(c, prop):
    r, g, b, a = parse(c)
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    is_text = prop in ('color', 'fill', 'caret-color', 'text-decoration-color')
    is_border = prop.startswith('border') or prop.startswith('outline') or prop == 'stroke'
    if is_text:
        if l < 0.62: nl = min(0.93, 0.95 - l * 0.55); s = min(s, 0.45)      # dark text -> light text
        else: return fmt(r, g, b, a)                                         # light text stays (on dark/coloured areas)
    elif is_border:
        if l >= 0.55: nl = 0.17 + (1 - l) * 0.35; s = min(s, 0.25)
        else: return fmt(r, g, b, a)
    else:                                                                    # backgrounds
        if l >= 0.5:                                                         # light surface -> dark green-tinted surface
            nl = 0.075 + (1 - l) * 0.18; s = min(s, 0.3)
            if s < 0.1: h, s = 0.40, 0.16
        else: return fmt(r, g, b, a)                                         # saturated / dark brand colours stay
    nr, ng, nb = colorsys.hls_to_rgb(h, nl, s)
    return fmt(nr * 255, ng * 255, nb * 255, a)


def map_decl(prop, value):
    prop_l = prop.strip().lower()
    if prop_l not in PROPS: return None
    important = '!important' in value
    v = value.replace('!important', '').strip()
    if 'url(' in v and prop_l in ('background', 'background-color'):
        # keep the photo but darken it by multiplying with a dark tint
        v = COLOR_RE.sub(lambda m: '#3a4d41', v)
        return f'{prop_l}:{v}{" !important" if important else ""};background-blend-mode:multiply'
    if not COLOR_RE.search(v): return None
    new = COLOR_RE.sub(lambda m: map_color(m.group(0), prop_l), v)   # unchanged values are emitted too, to keep the original cascade
    return f'{prop_l}:{new}{" !important" if important else ""}'


def strip_comments(css): return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def blocks(css):
    """Yield (prelude, body) pairs at the current nesting level."""
    i, n = 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0: break
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == '{': depth += 1
            elif css[k] == '}': depth -= 1
            k += 1
        yield css[i:j].strip(), css[j + 1:k - 1]
        i = k


def scope(selector):
    out = []
    for s in selector.split(','):
        s = s.strip()
        if not s: continue
        if s.startswith(('html', ':root')):
            out.append(re.sub(r'^(html|:root)', r'html[data-theme="dark"]', s, count=1))
        else:
            out.append('html[data-theme="dark"] ' + s)
    return ','.join(out)


def convert(css):
    out = []
    for prelude, body in blocks(css):
        if prelude.startswith('@media') or prelude.startswith('@supports'):
            inner = convert(body)
            if inner.strip(): out.append(f'{prelude}{{{inner}}}')
        elif prelude.startswith('@'):
            continue
        else:
            decls = []
            for d in body.split(';'):
                if ':' not in d: continue
                prop, value = d.split(':', 1)
                m = map_decl(prop, value)
                if m: decls.append(m)
            if decls: out.append(f'{scope(prelude)}{{{";".join(decls)}}}')
    return '\n'.join(out)


EXTRA = r'''
/* ---- dark theme: things the generated colour mapping cannot reach (libraries and form controls) ---- */
html[data-theme="dark"]{color-scheme:dark}
html[data-theme="dark"] body{color:#e3efe6}
html[data-theme="dark"] input,html[data-theme="dark"] select,html[data-theme="dark"] textarea{background-color:#1a2a21;color:#e3efe6;border-color:#34503f}
html[data-theme="dark"] input::placeholder,html[data-theme="dark"] textarea::placeholder{color:#8fa597}
html[data-theme="dark"] option{background:#1a2a21;color:#e3efe6}
html[data-theme="dark"] a{color:#8fd8ae}
html[data-theme="dark"] .recharts-text,html[data-theme="dark"] .recharts-cartesian-axis-tick-value{fill:#c5d8cb}
html[data-theme="dark"] .recharts-cartesian-grid line{stroke:#2f4538}
html[data-theme="dark"] .recharts-legend-item-text{color:#d6eadc!important}
html[data-theme="dark"] .recharts-default-tooltip{background-color:#1b2a22!important;border-color:#34503f!important}
html[data-theme="dark"] .recharts-tooltip-label,html[data-theme="dark"] .recharts-tooltip-item{color:#e3efe6!important}
html[data-theme="dark"] .recharts-tooltip-cursor{fill:rgba(255,255,255,.06)}
html[data-theme="dark"] .leaflet-container{background:#17211b;color:#e3efe6}
html[data-theme="dark"] .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.92) contrast(.9)}
html[data-theme="dark"] .leaflet-tooltip{background:#1b2a22;color:#e3efe6;border-color:#34503f}
html[data-theme="dark"] .leaflet-tooltip-top:before{border-top-color:#1b2a22}
html[data-theme="dark"] .leaflet-bar a,html[data-theme="dark"] .leaflet-control-attribution{background:#1b2a22;color:#cfe3d5;border-color:#34503f}
html[data-theme="dark"] .leaflet-control-attribution a{color:#8fd8ae}
html[data-theme="dark"] ::-webkit-scrollbar{background:#14201a}
html[data-theme="dark"] ::-webkit-scrollbar-thumb{background:#34503f;border-radius:8px}
html[data-theme="dark"] .agri-legend i,html[data-theme="dark"] .agri-map-frame{border-color:#34503f}
html[data-theme="dark"] .nisr-table th{background:#1a2a21;color:#c5d8cb}
html[data-theme="dark"] .nisr-table td{border-color:#2a3d32}
'''

if __name__ == '__main__':
    css = strip_comments(SRC.read_text(encoding='utf-8'))
    body = convert(css)
    OUT.write_text('/* AUTO-GENERATED by tools/generate_dark_theme.py from style.css - do not edit by hand. */\n' + body + '\n' + EXTRA, encoding='utf-8')
    print('Wrote', OUT, len(body), 'bytes of mapped rules')
