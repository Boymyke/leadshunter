# LeadsHunter: Ferrn Command Centre

Finds clients for Ferrn Digital Agency, builds them preview websites, emails and follows up automatically, reads replies, and flags the conversations that need Michael.

**Setup:** see [SETUP.md](SETUP.md).

```
apps-script/      the engine (Google Apps Script): sending, follow-ups, reply detection, database, API
  Code.gs           engine + JSON API for the dashboard
  Dashboard.html    the dashboard (also published at sites/app/)
  appsscript.json   permissions + Gmail service
ai-routine/       instructions the scheduled Claude runs follow (morning run, reply checks)
build.py          preview-site generator:  python build.py content/<slug>.json  |  python build.py --all
presets.json      style presets (midnight-gold, warm-editorial, clean-corporate, fresh-care, bold-mono)
content/          one JSON per business (copy, services, contact, niche, preset)
moodboard/        design inspiration screenshots the AI matches
sites/            what Cloudflare Pages serves: /app/ dashboard, /<slug>/ preview sites
test/             72 automated checks of the engine:  node test/run.js
wrangler.toml     Cloudflare Pages config (output dir: sites)
```

Niches with their own hero form and signature section: **logistics** (quote + tracking), **realestate** (property search + listings + inspections), **school** (admissions + school day), **clinic** (appointments + hours + emergency line).

Concept sites carry a "Concept by Ferrn, not the official website" banner and are `noindex`. Testimonials appear only when real ones are supplied.
