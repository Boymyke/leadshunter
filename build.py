#!/usr/bin/env python3
"""
Ferrn preview-site generator.

    python build.py content/lyon-grand-cargo.json      # build one site
    python build.py --all                              # build every file in content/

Each content JSON describes ONE business (copy, services, contact, niche, preset).
Output: sites/<slug>/index.html  (a single self-contained page, no external images)

Niches with their own hero widget + signature section:
    logistics   → instant quote form + shipment-tracking demo
    realestate  → property search + listings grid + inspection booking
    school      → admissions enquiry / school tour + "a day at school" + admission steps
    clinic      → appointment request + how booking works + emergency strip + hours
Style presets live in presets.json (the AI routine picks one, or tweaks colours from moodboard/).
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PRESETS = json.loads((ROOT / "presets.json").read_text())
E = lambda s: html.escape(str(s if s is not None else ""), quote=True)

# ───────────────────────── icons (inline SVG, stroke style) ─────────────────────────
ICONS = {
    "plane": '<path d="M2 16l20-6-20-6 4 6-4 6z"/>',
    "ship": '<path d="M3 17l2 4h14l2-4M5 17V9h14v8M9 9V5h6v4"/>',
    "truck": '<path d="M1 6h13v10H1zM14 10h5l3 3v3h-8"/><circle cx="5" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    "warehouse": '<path d="M3 21V9l9-6 9 6v12M7 21v-7h10v7"/>',
    "box": '<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8"/>',
    "globe": '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
    "home": '<path d="M3 11l9-7 9 7v10H3zM9 21v-6h6v6"/>',
    "key": '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
    "pin": '<path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    "building": '<path d="M4 21V3h10v18M14 9h6v12M8 7h2M8 11h2M8 15h2M17 13h0M17 17h0"/>',
    "book": '<path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-5a3 3 0 00-3 3"/><path d="M20 4v14h-6"/>',
    "users": '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6M16 4a3.5 3.5 0 010 7M18 14c2.5.5 4 2.8 4 6"/>',
    "star": '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>',
    "shield": '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "heart": '<path d="M12 20s-8-4.5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 9c0 6.5-8 11-8 11z"/>',
    "steth": '<path d="M6 3v6a5 5 0 0010 0V3M11 14v2a5 5 0 0010 0v-2"/><circle cx="21" cy="12" r="2"/>',
    "calendar": '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    "phone": '<path d="M5 3h4l2 5-3 2a12 12 0 006 6l2-3 5 2v4a2 2 0 01-2 2A18 18 0 013 5a2 2 0 012-2z"/>',
    "check": '<path d="M5 12l5 5L20 7"/>',
    "chart": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    "spark": '<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4"/>',
    "flask": '<path d="M9 3h6M10 3v6L4 20h16L14 9V3"/>',
    "tooth": '<path d="M7 3c-3 0-4 3-3 6 1 2 1 4 1.5 7S7 21 8.5 21 10 16 12 16s2 5 3.5 5S18 19 18.5 16 19 11 20 9c1-3 0-6-3-6-2 0-3 1-5 1S9 3 7 3z"/>',
    "baby": '<circle cx="12" cy="7" r="4"/><path d="M6 21c0-4 2.7-7 6-7s6 3 6 7"/>',
    "bus": '<rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 11h16M8 21v-3M16 21v-3"/>',
    "palette": '<path d="M12 3a9 9 0 100 18c1 0 1.5-.8 1.5-1.5 0-1.5-1.5-1.5-1.5-3 0-1 .8-1.5 2-1.5h2a5 5 0 005-5c0-4-4-7-9-7z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
    "ball": '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/>',
    "laptop": '<rect x="4" y="5" width="16" height="11" rx="1"/><path d="M2 20h20"/>',
}


def icon(name, size=22):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            f'{ICONS.get(name, ICONS["spark"])}</svg>')


WA_SVG = ('<svg width="28" height="28" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.6-.3.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.6-.1 1.3z"/></svg>')

# ───────────────────────── niche defaults (used when content leaves them out) ─────────────────────────
NICHE = {
    "logistics": {
        "primary_cta": "Get a quote", "secondary_cta": "Track a shipment", "secondary_href": "#track",
        "chips_title": "Where we deliver", "form_title": "Get a shipping quote",
        "form_sub": "Tell us what you're sending. We reply on WhatsApp within working hours.",
        "form_button": "Request my quote",
        "nav": [("Services", "#services"), ("Track", "#track"), ("Coverage", "#coverage"), ("Why us", "#why"), ("Contact", "#contact")],
    },
    "realestate": {
        "primary_cta": "Find a property", "secondary_cta": "Book an inspection", "secondary_href": "#inspect",
        "chips_title": "Areas we cover", "form_title": "Find your next property",
        "form_sub": "Tell us what you want. Our team sends matching listings on WhatsApp.",
        "form_button": "Show me properties",
        "nav": [("Listings", "#listings"), ("Services", "#services"), ("Areas", "#coverage"), ("Why us", "#why"), ("Contact", "#contact")],
    },
    "school": {
        "primary_cta": "Start admission", "secondary_cta": "Book a school tour", "secondary_href": "#admissions",
        "chips_title": "Our programmes", "form_title": "Admissions enquiry",
        "form_sub": "Book a tour or ask about places. Our admissions office replies within one working day.",
        "form_button": "Book a school tour",
        "nav": [("Programmes", "#services"), ("Admissions", "#admissions"), ("School life", "#day"), ("Why us", "#why"), ("Contact", "#contact")],
    },
    "clinic": {
        "primary_cta": "Book an appointment", "secondary_cta": "Our services", "secondary_href": "#services",
        "chips_title": "Specialties", "form_title": "Request an appointment",
        "form_sub": "Choose a department and a day. We confirm by phone or WhatsApp.",
        "form_button": "Request appointment",
        "nav": [("Services", "#services"), ("Book", "#book"), ("Hours", "#hours"), ("Why us", "#why"), ("Contact", "#contact")],
    },
}


# ───────────────────────── CSS ─────────────────────────
def css(p):
    dark = p.get("hero") == "dark"
    fonts = sorted({p["head_font"], p["body_font"]})
    hf = f"'{p['head_font']}', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif"
    if p["head_font"] in ("Fraunces",):
        hf = f"'{p['head_font']}', Georgia, 'Times New Roman', serif"
    bf = f"'{p['body_font']}', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif"
    hero_bg = "var(--ink)" if dark else "var(--paper)"
    hero_fg = "#fff" if dark else "var(--ink)"
    hero_sub = "rgba(255,255,255,.72)" if dark else "var(--muted)"
    grid_line = "rgba(255,255,255,.035)" if dark else "rgba(0,0,0,.035)"
    font_link = "https://fonts.googleapis.com/css2?" + "&".join(
        f"family={f.replace(' ', '+')}:wght@400;500;600;700;800" for f in fonts) + "&display=swap"
    return font_link, f"""
:root{{--ink:{p['ink']};--ink2:{p['ink2']};--paper:{p['paper']};--card:{p['card']};--line:{p['line']};
--accent:{p['accent']};--accent-ink:{p['accent_ink']};--muted:{p['muted']};--r:{p['radius']};--ok:#2e9e6a}}
*{{box-sizing:border-box;margin:0;padding:0}}
html{{scroll-behavior:smooth}}
body{{font-family:{bf};color:var(--ink);background:var(--paper);line-height:1.6;-webkit-font-smoothing:antialiased}}
a{{color:inherit;text-decoration:none}}
.wrap{{max-width:1160px;margin:0 auto;padding:0 20px}}
h1,h2,h3,.logo{{font-family:{hf};letter-spacing:-.02em;line-height:1.08;font-weight:{p['head_weight']}}}
.concept{{background:var(--accent);color:var(--accent-ink);font-size:13px;font-weight:600;text-align:center;padding:8px 16px}}
.concept a{{text-decoration:underline}}
nav.top{{background:{'var(--ink)' if dark else 'rgba(255,255,255,.92)'};color:{hero_fg};position:sticky;top:0;z-index:20;
border-bottom:1px solid {'rgba(255,255,255,.08)' if dark else 'var(--line)'};backdrop-filter:blur(8px)}}
nav.top .wrap{{display:flex;align-items:center;justify-content:space-between;height:68px;gap:16px}}
.logo{{display:flex;align-items:center;gap:10px;font-size:19px;white-space:nowrap}}
.logo-mark{{width:36px;height:36px;border-radius:calc(var(--r)/2);background:var(--accent);display:grid;place-items:center;
color:var(--accent-ink);font-size:14px;font-family:{bf};font-weight:800;letter-spacing:0}}
.links{{display:flex;gap:26px;font-size:14px;opacity:.8}}
.links a:hover{{opacity:1;color:var(--accent)}}
.btn{{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;padding:13px 22px;font-weight:600;
font-size:15px;border:0;cursor:pointer;transition:transform .15s,filter .15s;font-family:inherit}}
.btn:hover{{transform:translateY(-1px);filter:brightness(1.05)}}
.btn-accent{{background:var(--accent);color:var(--accent-ink)}}
.btn-line{{border:1px solid {'rgba(255,255,255,.3)' if dark else 'var(--ink)'};color:{hero_fg};background:transparent}}
.btn-ink{{background:var(--ink);color:#fff}}
.nav-cta{{padding:10px 18px;font-size:14px}}
.hero{{background:{hero_bg};color:{hero_fg};position:relative;overflow:hidden}}
.hero::before{{content:"";position:absolute;inset:0;background:
radial-gradient(900px 420px at 85% 0%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 60%),
repeating-linear-gradient(90deg,{grid_line} 0 1px,transparent 1px 80px);pointer-events:none}}
.hero .wrap{{position:relative;display:grid;grid-template-columns:1.1fr .9fr;gap:48px;padding-top:72px;padding-bottom:84px;align-items:center}}
.hero .wrap>*{{min-width:0}}
.eyebrow{{display:inline-flex;gap:10px;align-items:center;font-size:13px;color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:.08em}}
.eyebrow::before{{content:"";width:22px;height:2px;background:var(--accent)}}
.hero h1{{font-size:clamp(38px,5.4vw,64px);margin:18px 0 20px}}
.hero h1 em{{font-style:normal;color:var(--accent)}}
.lead{{font-size:18px;color:{hero_sub};max-width:540px}}
.ctas{{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}}
.trust{{display:flex;gap:26px;margin-top:36px;flex-wrap:wrap;font-size:13px;color:{hero_sub}}}
.trust b{{color:{hero_fg};font-family:{hf};font-size:24px;display:block;font-weight:{p['head_weight']}}}
.formcard{{background:var(--card);color:var(--ink);border-radius:calc(var(--r) + 4px);padding:26px;
box-shadow:0 30px 60px rgba(0,0,0,{'.35' if dark else '.10'});border:1px solid var(--line)}}
.formcard h3{{font-size:22px;margin-bottom:4px}}
.formcard .sub{{font-size:14px;color:var(--muted);margin-bottom:18px}}
.seg{{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px;background:var(--paper);padding:5px;border-radius:12px;margin-bottom:16px}}
.seg button{{border:0;background:transparent;padding:9px 6px;border-radius:9px;font-weight:600;font-size:13px;cursor:pointer;color:var(--muted);font-family:inherit}}
.seg button.on{{background:var(--ink);color:#fff}}
.field{{margin-bottom:12px}}
.field label{{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}}
.field input,.field select{{width:100%;border:1px solid var(--line);border-radius:10px;padding:11px 12px;font:inherit;font-size:15px;background:#fff;color:var(--ink)}}
.field input:focus,.field select:focus{{outline:2px solid var(--accent);border-color:transparent}}
.row2{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
.formcard .btn{{width:100%;margin-top:6px}}
.note{{font-size:12px;color:var(--muted);margin-top:10px;text-align:center}}
.done{{display:none;text-align:center;padding:30px 6px}}
.done .tick{{width:54px;height:54px;border-radius:50%;background:#e4f5ec;color:var(--ok);display:grid;place-items:center;margin:0 auto 14px}}
section{{padding:88px 0}}
.head{{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:40px;flex-wrap:wrap}}
.head h2{{font-size:clamp(30px,3.6vw,44px);max-width:640px}}
.head p{{color:var(--muted);max-width:420px}}
.kicker{{font-size:13px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:10px}}
.cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:26px;transition:border-color .2s,transform .2s}}
.card:hover{{border-color:var(--accent);transform:translateY(-3px)}}
.ic{{width:48px;height:48px;border-radius:calc(var(--r)*.75);background:var(--ink);color:var(--accent);display:grid;place-items:center;margin-bottom:18px}}
.card h3{{font-size:20px;margin-bottom:8px}}
.card p{{color:var(--muted);font-size:15px}}
.card .meta{{margin-top:16px;font-size:13px;font-weight:700;color:var(--accent)}}
.band{{background:var(--card);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}}
.band .wrap{{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding-top:44px;padding-bottom:44px}}
.band b{{font-family:{hf};font-size:42px;display:block;line-height:1;font-weight:{p['head_weight']}}}
.band span{{color:var(--muted);font-size:14px}}
.panel{{background:var(--ink2);color:#fff;border-radius:calc(var(--r) + 6px);padding:42px;display:grid;grid-template-columns:.9fr 1.1fr;gap:40px;align-items:center}}
.panel>*{{min-width:0}}
.panel h2{{font-size:36px;margin:12px 0}}
.panel p{{color:rgba(255,255,255,.72)}}
.inline-form{{display:flex;gap:8px;margin-top:22px}}
.inline-form input{{flex:1;min-width:0;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff;border-radius:999px;padding:12px 18px;font:inherit}}
.inline-form input::placeholder{{color:rgba(255,255,255,.5)}}
.timeline{{background:var(--card);color:var(--ink);border-radius:var(--r);padding:24px}}
.tl-head{{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);margin-bottom:18px;gap:10px}}
.tl-head b{{color:var(--ink);font-size:16px}}
.step{{display:grid;grid-template-columns:22px 1fr auto;gap:12px;padding-bottom:18px;position:relative}}
.step:not(:last-child)::after{{content:"";position:absolute;left:10px;top:22px;bottom:2px;width:2px;background:var(--line)}}
.step.d:not(:last-child)::after{{background:var(--ok)}}
.dot{{width:22px;height:22px;border-radius:50%;border:2px solid var(--line);background:#fff;z-index:1}}
.d .dot{{background:var(--ok);border-color:var(--ok)}}
.now .dot{{border-color:var(--accent);box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 25%,transparent)}}
.step b{{display:block;font-size:15px}}
.step span,.step time{{font-size:13px;color:var(--muted)}}
.tag{{display:inline-block;font-size:11px;font-weight:700;background:var(--paper);color:var(--muted);padding:3px 8px;border-radius:6px;margin-left:6px;vertical-align:middle}}
.chips{{display:flex;flex-wrap:wrap;gap:10px}}
.chip{{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:10px 18px;font-weight:600;font-size:15px}}
.chip small{{color:var(--muted);font-weight:500;margin-left:6px}}
.why{{display:grid;grid-template-columns:repeat(4,1fr);gap:22px}}
.why div{{border-top:3px solid var(--accent);padding-top:18px}}
.why h3{{font-size:18px;margin-bottom:6px}}
.why p{{color:var(--muted);font-size:15px}}
.listings{{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}}
.listing{{background:var(--card);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}}
.listing .img{{height:200px;position:relative;display:grid;place-items:center;color:rgba(255,255,255,.85)}}
.listing .img .badge{{position:absolute;top:12px;left:12px;background:#fff;color:var(--ink);font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px}}
.listing .body{{padding:18px}}
.listing h3{{font-size:19px;margin-bottom:4px}}
.listing .loc{{color:var(--muted);font-size:14px;display:flex;align-items:center;gap:6px}}
.listing .foot{{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:14px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}}
.listing .price{{font-weight:800;color:var(--ink);font-size:17px}}
.steps4{{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;counter-reset:s}}
.steps4 div{{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:22px;counter-increment:s}}
.steps4 div::before{{content:counter(s,decimal-leading-zero);font-family:{hf};font-size:28px;color:var(--accent);display:block;margin-bottom:10px;font-weight:{p['head_weight']}}}
.steps4 h3{{font-size:17px;margin-bottom:6px}}
.steps4 p{{color:var(--muted);font-size:14px}}
.quote{{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:26px}}
.quote p{{font-size:17px;margin-bottom:14px}}
.quote b{{display:block}}
.quote span{{color:var(--muted);font-size:14px}}
.hours{{display:grid;grid-template-columns:1fr 1fr;gap:10px 30px;max-width:520px}}
.hours div{{display:flex;justify-content:space-between;border-bottom:1px dashed var(--line);padding-bottom:8px}}
.emergency{{background:#fdecec;border:1px solid #f6c9c9;color:#8a1c1c;border-radius:var(--r);padding:18px 22px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;font-weight:600}}
.cta{{background:var(--accent);color:var(--accent-ink);border-radius:calc(var(--r) + 6px);padding:48px;display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap}}
.cta h2{{font-size:clamp(28px,3.4vw,40px);max-width:600px}}
footer{{background:var(--ink);color:rgba(255,255,255,.65);padding:56px 0 28px;font-size:14px}}
footer .grid{{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:30px;margin-bottom:36px}}
footer h4{{color:#fff;margin-bottom:12px;font-size:15px}}
footer li{{list-style:none;margin-bottom:8px}}
footer .base{{border-top:1px solid rgba(255,255,255,.1);padding-top:20px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:13px}}
.wa{{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;background:#25d366;display:grid;place-items:center;box-shadow:0 10px 25px rgba(0,0,0,.25);z-index:30}}
@media(max-width:900px){{
.links{{display:none}}
.hero .wrap,.panel{{grid-template-columns:1fr}}
.cards,.listings{{grid-template-columns:1fr 1fr}}
.why,.band .wrap,.steps4{{grid-template-columns:1fr 1fr}}
footer .grid{{grid-template-columns:1fr 1fr}}
.panel{{padding:26px}}
}}
@media(max-width:560px){{
.cards,.listings,.row2,.hours{{grid-template-columns:1fr}}
.cta{{padding:30px}}
.hero .wrap{{padding-top:44px}}
.step{{grid-template-columns:22px 1fr}}
.step time{{grid-column:2}}
.nav-cta{{display:none}}
section{{padding:64px 0}}
}}
"""


# ───────────────────────── blocks ─────────────────────────
def options(items):
    return "".join(f"<option>{E(i)}</option>" for i in items)


def hero_widget(c, nd):
    n = c["niche"]
    title = c.get("form_title", nd["form_title"])
    sub = c.get("form_sub", nd["form_sub"])
    btn = c.get("form_button", nd["form_button"])
    phone_field = '<div class="field"><label>Your WhatsApp number</label><input type="tel" placeholder="080..."></div>'
    if n == "logistics":
        modes = c.get("modes", ["Air", "Sea", "Road"])
        dests = c.get("destinations") or [x if isinstance(x, str) else x[0] for x in c.get("chips", [])] or ["Within Nigeria"]
        seg = "".join('<button type="button" class="%s">%s</button>' % ("on" if i == 0 else "", E(m)) for i, m in enumerate(modes))
        body = (f'<div class="seg">{seg}</div>'
                f'<div class="row2"><div class="field"><label>From</label><input value="{E(c.get("origin", "Lagos, Nigeria"))}"></div>'
                f'<div class="field"><label>To</label><select>{options(dests)}</select></div></div>'
                f'<div class="row2"><div class="field"><label>Weight (kg)</label><input type="number" min="1" placeholder="e.g. 25"></div>'
                f'<div class="field"><label>What\'s inside</label><select>{options(c.get("cargo_types", ["Commercial goods", "Food items", "Documents", "Electronics", "Personal effects", "Other"]))}</select></div></div>'
                + phone_field)
    elif n == "realestate":
        body = (f'<div class="seg"><button type=button class="on">Buy</button><button type=button>Rent</button><button type=button>Land</button></div>'
                f'<div class="field"><label>Location</label><select>{options(c.get("locations", [x if isinstance(x, str) else x[0] for x in c.get("chips", [])] or ["Lekki", "Ikoyi", "Ajah"]))}</select></div>'
                f'<div class="row2"><div class="field"><label>Property type</label><select>{options(c.get("property_types", ["Apartment", "Terrace", "Detached house", "Land"]))}</select></div>'
                f'<div class="field"><label>Budget</label><select>{options(c.get("budgets", ["Under ₦50M", "₦50M – ₦150M", "₦150M – ₦400M", "Above ₦400M"]))}</select></div></div>'
                + phone_field)
    elif n == "school":
        body = (f'<div class="field"><label>Parent / guardian name</label><input placeholder="Your name"></div>'
                f'<div class="row2"><div class="field"><label>Class applying for</label><select>{options(c.get("classes", ["Creche", "Nursery", "Primary 1–3", "Primary 4–6", "JSS 1", "SS 1"]))}</select></div>'
                f'<div class="field"><label>Session</label><select>{options(c.get("sessions", ["This term", "Next term", "Next academic year"]))}</select></div></div>'
                + phone_field)
    else:  # clinic
        body = (f'<div class="field"><label>Department</label><select>{options(c.get("departments", [x if isinstance(x, str) else x[0] for x in c.get("chips", [])] or ["General consultation"]))}</select></div>'
                f'<div class="row2"><div class="field"><label>Preferred date</label><input type="date"></div>'
                f'<div class="field"><label>Time of day</label><select>{options(["Morning", "Afternoon", "Evening"])}</select></div></div>'
                f'<div class="field"><label>Patient name</label><input placeholder="Full name"></div>' + phone_field)
    company = E(c["company"])
    return (f'<div class="formcard" id="{ {"logistics": "quote", "realestate": "search", "school": "enquire", "clinic": "book"}[n] }">'
            f'<form class="f" onsubmit="return done(this)"><h3>{E(title)}</h3><p class="sub">{E(sub)}</p>{body}'
            f'<button class="btn btn-accent" type="submit">{E(btn)}</button>'
            f'<p class="note">{E(c.get("form_note", "No commitment. We reply fast."))}</p></form>'
            f'<div class="done"><div class="tick">{icon("check", 26)}</div><h3>Request received</h3>'
            f'<p class="sub" style="margin-top:6px">On the live site this goes straight to {company}\'s WhatsApp and inbox, so no enquiry gets lost.</p></div></div>')


def services_block(c):
    items = c.get("services", [])
    if not items:
        return ""
    cards = "".join(
        f'<div class="card"><div class="ic">{icon(s.get("icon", "spark"))}</div><h3>{E(s["title"])}</h3><p>{E(s.get("text", ""))}</p>'
        + (f'<div class="meta">{E(s["meta"])}</div>' if s.get("meta") else "") + "</div>" for s in items)
    return (f'<section id="services"><div class="wrap"><div class="head"><div><span class="kicker">{E(c.get("services_kicker", "What we do"))}</span>'
            f'<h2>{E(c.get("services_title", "Everything you need, handled by one team."))}</h2></div>'
            f'<p>{E(c.get("services_sub", ""))}</p></div><div class="cards">{cards}</div></div></section>')


def stats_band(c):
    st = c.get("stats", [])
    if len(st) < 2:
        return ""
    return '<div class="band"><div class="wrap">' + "".join(f"<div><b>{E(v)}</b><span>{E(l)}</span></div>" for v, l in st[:4]) + "</div></div>"


def chips_block(c, nd):
    ch = c.get("chips", [])
    if not ch:
        return ""
    def chip(x):
        if isinstance(x, str):
            return f'<span class="chip">{E(x)}</span>'
        return f'<span class="chip">{E(x[0])}<small>{E(x[1])}</small></span>'
    return (f'<section id="coverage" style="padding-top:{0 if c["niche"] == "clinic" else 88}px"><div class="wrap"><div class="head"><h2>{E(c.get("chips_title", nd["chips_title"]))}</h2>'
            f'<p>{E(c.get("chips_sub", ""))}</p></div><div class="chips">{"".join(chip(x) for x in ch)}</div></div></section>')


def features_block(c):
    f = c.get("features", [])
    if not f:
        return ""
    items = "".join("<div><h3>%s</h3><p>%s</p></div>" % (E(x["title"]), E(x["text"])) for x in f[:4])
    title = E(c.get("features_title", "Why clients choose " + c["company"]))
    return ('<section id="why" style="padding-top:0"><div class="wrap"><div class="head"><h2>%s</h2></div>'
            '<div class="why">%s</div></div></section>' % (title, items))


def testimonials_block(c):
    t = c.get("testimonials", [])  # only REAL testimonials, never invented
    if not t:
        return ""
    return (f'<section style="padding-top:0"><div class="wrap"><div class="head"><h2>What clients say</h2></div><div class="cards">'
            + "".join(f'<div class="quote"><p>“{E(x["quote"])}”</p><b>{E(x["name"])}</b><span>{E(x.get("role", ""))}</span></div>' for x in t[:3])
            + "</div></div></section>")


def signature_block(c):
    n = c["niche"]
    if n == "logistics":
        steps = c.get("tracking_steps", [
            ["Picked up", "Ikeja, Lagos", "Mon 09:12", "d"], ["Packed & weighed", "Our warehouse", "Mon 15:40", "d"],
            ["Departed Lagos", "Murtala Muhammed Airport", "Tue 22:05", "d"], ["Arrived destination", "Customs clearance", "Wed 06:30", "now"],
            ["Out for delivery", "Recipient address", "—", ""]])
        route = c.get("tracking_route", "Lagos → London · Air")
        tl = "".join(f'<div class="step {s[3]}"><div class="dot"></div><div><b>{E(s[0])}</b><span>{E(s[1])}</span></div><time>{E(s[2])}</time></div>' for s in steps)
        return (f'<section id="track"><div class="wrap"><div class="panel"><div><span class="eyebrow">Shipment tracking</span>'
                f'<h2>Know where your cargo is, without calling.</h2><p>Customers enter their tracking number and see every step. Fewer "where are my goods?" calls for your team.</p>'
                f'<form class="inline-form" onsubmit="return false"><input placeholder="Tracking number" value="{E(c.get("tracking_code", "TRK-24817"))}"><button class="btn btn-accent">Track</button></form></div>'
                f'<div class="timeline"><div class="tl-head"><div><b>{E(c.get("tracking_code", "TRK-24817"))}</b><span class="tag">DEMO</span><br>{E(route)}</div><div style="text-align:right">Est. delivery<br><b>Fri</b></div></div>{tl}</div></div></div></section>')
    if n == "realestate":
        ls = c.get("listings", [])
        grads = ["linear-gradient(135deg,#3b5249,#9caf88)", "linear-gradient(135deg,#5b4636,#c49a6c)", "linear-gradient(135deg,#2f3e57,#8aa1c1)",
                 "linear-gradient(135deg,#4a3b52,#b08fb8)", "linear-gradient(135deg,#3d4a3a,#a3b18a)", "linear-gradient(135deg,#55402f,#d4a373)"]
        cards = "".join(
            f'<article class="listing"><div class="img" style="background:{grads[i % len(grads)]}"><span class="badge">{E(l.get("tag", "For sale"))}</span>{icon("home", 56)}</div>'
            f'<div class="body"><h3>{E(l["title"])}</h3><div class="loc">{icon("pin", 15)} {E(l.get("location", ""))}</div>'
            f'<div class="foot"><span>{E(l.get("specs", ""))}</span><span class="price">{E(l.get("price", "Price on request"))}</span></div></div></article>'
            for i, l in enumerate(ls[:6]))
        listings = (f'<section id="listings"><div class="wrap"><div class="head"><div><span class="kicker">Featured</span><h2>{E(c.get("listings_title", "Homes and land worth seeing"))}</h2></div>'
                    f'<p>{E(c.get("listings_sub", "Sample layout. On the live site your real listings, photos and prices appear here, updated from one dashboard."))}</p></div>'
                    f'<div class="listings">{cards}</div></div></section>') if ls else ""
        inspect = (f'<section id="inspect" style="padding-top:{0 if ls else 88}px"><div class="wrap"><div class="panel"><div><span class="eyebrow">Inspections</span>'
                   f'<h2>See it in person this week.</h2><p>Pick a day and our agent meets you at the property. Confirmation comes on WhatsApp.</p></div>'
                   f'<form class="formcard" onsubmit="return done(this)" style="box-shadow:none"><div class="row2"><div class="field"><label>Property</label><input placeholder="Which listing?"></div>'
                   f'<div class="field"><label>Preferred day</label><input type="date"></div></div><div class="field"><label>WhatsApp number</label><input type="tel" placeholder="080..."></div>'
                   f'<button class="btn btn-accent" type="submit">Book inspection</button></form></div></div></section>')
        return listings + inspect
    if n == "school":
        day = c.get("day", [["7:30am", "Arrival & assembly"], ["8:00am", "Core lessons: literacy & numeracy"], ["10:30am", "Break & play"],
                            ["11:00am", "Science, ICT & creative arts"], ["1:00pm", "Lunch"], ["2:00pm", "Clubs, sports & music"], ["3:30pm", "Pick-up"]])
        tl = "".join(f'<div class="step d"><div class="dot"></div><div><b>{E(x[1])}</b></div><time>{E(x[0])}</time></div>' for x in day)
        adm = c.get("admission_steps", [["Enquire", "Send the form or call our admissions office."], ["Visit", "Tour the school and meet our teachers."],
                                        ["Assessment", "A friendly, age-appropriate assessment."], ["Offer", "Receive your offer and resumption pack."]])
        return (f'<section id="day"><div class="wrap"><div class="panel"><div><span class="eyebrow">School life</span><h2>{E(c.get("day_title", "A day at " + c["company"]))}</h2>'
                f'<p>{E(c.get("day_sub", "Structured learning, time to play, and clubs that help every child find what they love."))}</p></div><div class="timeline">{tl}</div></div></div></section>'
                f'<section id="admissions" style="padding-top:0"><div class="wrap"><div class="head"><div><span class="kicker">Admissions</span><h2>Four simple steps to a place</h2></div>'
                f'<p>{E(c.get("admissions_sub", "Admissions are open. Places in some classes are limited, so we recommend booking a tour early."))}</p></div>'
                f'<div class="steps4">{"".join(f"<div><h3>{E(a[0])}</h3><p>{E(a[1])}</p></div>" for a in adm)}</div></div></section>')
    if n == "clinic":
        c_phone = c.get("contact", {}).get("phone", "")
        how = c.get("booking_steps", [["Request", "Choose a department and a day online."], ["Confirm", "We call or WhatsApp you to confirm a time."],
                                      ["Visit", "Come in. Short waits, clean rooms, clear explanations."], ["Follow-up", "Results and reminders sent to your phone."]])
        hours = c.get("hours_table", [["Mon – Fri", "8:00am – 8:00pm"], ["Saturday", "9:00am – 4:00pm"], ["Sunday", "Emergencies only"], ["Public holidays", "Emergencies only"]])
        return (f'<section id="how" style="padding-top:0;margin-top:88px"><div class="wrap"><div class="head"><div><span class="kicker">Appointments</span><h2>Booking takes two minutes</h2></div>'
                f'<p>No queues to book, no guessing. You get a confirmed time before you leave home.</p></div>'
                f'<div class="steps4">{"".join(f"<div><h3>{E(a[0])}</h3><p>{E(a[1])}</p></div>" for a in how)}</div></div></section>'
                + (f'<div class="wrap" style="margin-bottom:88px"><div class="emergency"><span>{icon("phone", 18)} Emergency? Call us now, day or night.</span><a class="btn btn-ink" href="tel:{E(re.sub(r"[^0-9+]", "", c_phone))}">{E(c_phone)}</a></div></div>' if c_phone else "")
                + f'<section id="hours" style="padding-top:0"><div class="wrap"><div class="head"><h2>Opening hours</h2></div><div class="hours">'
                + "".join(f"<div><span>{E(h[0])}</span><b>{E(h[1])}</b></div>" for h in hours) + "</div></div></section>")
    return ""


def page(c):
    n = c.get("niche", "logistics")
    if n not in NICHE:
        raise SystemExit(f"Unknown niche {n}. Use one of {list(NICHE)}")
    c["niche"] = n
    nd = NICHE[n]
    preset_name = c.get("preset") or PRESETS["niche_defaults"][n]
    p = dict(PRESETS[preset_name])
    p.update(c.get("colors", {}))
    font_link, style = css(p)
    company = c["company"]
    logo = c.get("logo_text") or "".join(w[0] for w in re.findall(r"[A-Za-z]+", company)[:2]).upper()
    contact = c.get("contact", {})
    wa = re.sub(r"\D", "", contact.get("whatsapp") or contact.get("phone", ""))
    if wa.startswith("0") and len(wa) == 11:
        wa = "234" + wa[1:]
    primary_href = {"logistics": "#quote", "realestate": "#search", "school": "#enquire", "clinic": "#book"}[n]
    nav_links = "".join(f'<a href="{h}">{E(t)}</a>' for t, h in c.get("nav", nd["nav"]))
    trust = "".join(f"<div><b>{E(v)}</b>{E(l)}</div>" for v, l in c.get("hero_stats", c.get("stats", [])[:3]))
    h1 = E(c["hero_title"])
    if c.get("hero_highlight"):
        h1 += f' <em>{E(c["hero_highlight"])}</em>'
    concept = c.get("concept", True)
    banner_txt = (f"Ferrn niche template demo. {E(company)} is a fictional business." if c.get("demo")
                  else f"Concept redesign prepared by Ferrn Digital Agency for {E(company)}. Not the official website.")
    banner = (f'<div class="concept">{banner_txt} · '
              f'<a href="https://www.ferrnagency.com">ferrnagency.com</a></div>') if concept else ""
    services_list = "".join(f"<li>{E(s['title'])}</li>" for s in c.get("services", [])[:5])
    contact_list = "".join(f"<li>{E(v)}</li>" for v in [contact.get("phone"), contact.get("email"), contact.get("address")] if v)
    hours_list = "".join(f"<li>{E(h)}</li>" for h in contact.get("hours", []))
    body = f"""
{banner}
<nav class="top"><div class="wrap">
  <a class="logo" href="#"><span class="logo-mark">{E(logo)}</span>{E(company)}</a>
  <div class="links">{nav_links}</div>
  <a class="btn btn-accent nav-cta" href="{primary_href}">{E(c.get('primary_cta', nd['primary_cta']))}</a>
</div></nav>
<header class="hero"><div class="wrap">
  <div>
    <span class="eyebrow">{E(c.get('eyebrow', ''))}</span>
    <h1>{h1}</h1>
    <p class="lead">{E(c.get('hero_sub', ''))}</p>
    <div class="ctas"><a class="btn btn-accent" href="{primary_href}">{E(c.get('primary_cta', nd['primary_cta']))} →</a>
    <a class="btn btn-line" href="{c.get('secondary_href', nd['secondary_href'])}">{E(c.get('secondary_cta', nd['secondary_cta']))}</a></div>
    <div class="trust">{trust}</div>
  </div>
  {hero_widget(c, nd)}
</div></header>
{services_block(c)}
{stats_band(c) if n != 'clinic' else ''}
{signature_block(c)}
{chips_block(c, nd)}
{features_block(c)}
{testimonials_block(c)}
<section id="contact" style="padding-top:0"><div class="wrap"><div class="cta"><h2>{E(c.get('cta_title', 'Ready when you are. Let\'s talk today.'))}</h2>
<a class="btn btn-ink" href="{primary_href}">{E(c.get('primary_cta', nd['primary_cta']))} →</a></div></div></section>
<footer><div class="wrap">
  <div class="grid">
    <div><a class="logo" href="#" style="color:#fff"><span class="logo-mark">{E(logo)}</span>{E(company)}</a><p style="margin-top:14px;max-width:300px">{E(c.get('tagline', ''))}</p></div>
    <div><h4>Services</h4><ul>{services_list}</ul></div>
    <div><h4>Contact</h4><ul>{contact_list}</ul></div>
    <div><h4>Hours</h4><ul>{hours_list}</ul></div>
  </div>
  <div class="base"><span>© {E(company)}</span><span>{'Concept design by Ferrn Digital Agency' if concept else 'Website by Ferrn Digital Agency'}</span></div>
</div></footer>
{f'<a class="wa" href="https://wa.me/{wa}" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">{WA_SVG}</a>' if wa and not concept else f'<a class="wa" href="{primary_href}" aria-label="Chat on WhatsApp">{WA_SVG}</a>'}
"""
    script = """<script>
document.querySelectorAll('.seg').forEach(function(s){s.addEventListener('click',function(e){if(e.target.tagName!=='BUTTON')return;
s.querySelectorAll('button').forEach(function(b){b.classList.remove('on')});e.target.classList.add('on');});});
function done(f){var card=f.closest('.formcard')||f;var d=card.querySelector('.done');if(d){f.style.display='none';d.style.display='block';}
else{f.innerHTML='<p style="padding:20px;text-align:center;font-weight:600">Request received. We\\'ll confirm on WhatsApp.</p>';}return false;}
</script>"""
    desc = c.get("hero_sub", "")[:155]
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{'<meta name="robots" content="noindex, nofollow">' if concept else ''}
<title>{E(company)}{' — Concept by Ferrn' if concept else ''}</title>
<meta name="description" content="{E(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{font_link}" rel="stylesheet">
<style>{style}</style>
</head>
<body>{body}{script}</body>
</html>"""


def build(path):
    c = json.loads(Path(path).read_text())
    slug = c.get("slug") or re.sub(r"[^a-z0-9]+", "-", c["company"].lower()).strip("-")
    out = ROOT / "sites" / slug / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page(c))
    return slug, out


def sync_dashboard():
    """Copies the dashboard into sites/app/ so Cloudflare serves it at /app/."""
    src = ROOT / "apps-script" / "Dashboard.html"
    if src.exists():
        out = ROOT / "sites" / "app" / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(src.read_text())


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    files = sorted((ROOT / "content").glob("*.json")) if args == ["--all"] else [Path(a) for a in args]
    for f in files:
        slug, out = build(f)
        print(f"built {slug} -> {out.relative_to(ROOT)}")
    sync_dashboard()
