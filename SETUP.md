# Setup (about 20 minutes, once)

| Part | What it does | Runs where |
|---|---|---|
| **Engine** (`apps-script/`) | Sends emails and follow-ups, catches replies, bounces and "no thanks", keeps the database | Google Apps Script, 24/7, free |
| **Dashboard + preview sites** (`sites/`) | Your command centre at `/app/`, plus every concept site at `/<slug>/` | Cloudflare Pages, free |
| **AI routine** (already scheduled in Claude) | Finds leads, audits sites, writes every message, answers replies, builds previews, flags what needs you | Your Claude plan: 6:42am, 11:42am, 3:42pm, Mon–Sat |

---

## 1. Engine (15 min)

**Decide which Google account sends.**
- If michael@ferrnagency.com is a **Google Workspace** mailbox, do everything below signed in to it. Best option.
- If it's hosted elsewhere (cPanel, Zoho…), use your Gmail, but first add it as a sender: Gmail → Settings → Accounts → **Send mail as** → *Add another email address* → michael@ferrnagency.com → SMTP details from your email host → confirm the code. Until then, emails go from your Gmail address.

1. Open **sheets.new** and name it **Ferrn Command Centre**.
2. **Extensions → Apps Script.**
3. ⚙️ **Project Settings** → tick **Show "appsscript.json" manifest file in editor**.
4. In **Editor**:
   - `appsscript.json` → replace everything with `apps-script/appsscript.json`
   - `Code.gs` → replace everything with `apps-script/Code.gs`
   - **Save** 💾
5. Choose **setup** in the function menu → **Run** → **Review permissions → your account → Advanced → Go to Ferrn (unsafe) → Allow**. ("Unsafe" only means Google hasn't reviewed your own private script.)
6. **Deploy → New deployment →** ⚙️ **Web app** → Execute as: **Me** → Who has access: **Anyone** → **Deploy**. Copy the **Web app URL**.
   *"Anyone" is needed so your Cloudflare dashboard can reach it. Nothing is readable without your access key.*
7. In the sheet's **Settings** tab:
   - copy **API_KEY** (you need it in step 2)
   - fill **OWNER_WHATSAPP** (e.g. 2348012345678)
   - set **DAILY_CAP_FIRST** to **10** for the first week, then 25. New sending addresses need to warm up.
   - set **PREVIEW_BASE_URL** to your Cloudflare address (e.g. `https://leadshunter.pages.dev`)

**Deliverability (5 min at your domain host):** ferrnagency.com needs **SPF** and **DKIM** records for whoever sends your mail (Google Workspace: Admin → Apps → Gmail → Authenticate email). Without them, cold email lands in spam.

## 2. Connect the dashboard

Open `https://<your-cloudflare-address>/app/` → **Connect your engine** → paste the **Web app URL** and **API_KEY**. They're saved only in that browser. Do it once on your laptop and once on your phone (add it to your home screen).

## 3. Let the AI publish previews

claude.ai → Settings → Connectors → GitHub → make sure **Boymyke/leadshunter** is allowed. The AI pushes new previews to `sites/<slug>/` and Cloudflare publishes them in about a minute.

**Pinterest inspiration:** upload screenshots to `moodboard/`, named by niche (`realestate-luxury.png`, `clinic-calm.jpg`, `any-bold.png`). The next previews follow them.

---

## Daily rhythm

- **6:42am:** the AI answers replies, builds up to 3 previews, finds 15 new leads, writes all emails + 3 follow-ups, and drops one batch file into Drive.
- **Every 10 min:** the engine loads it, holds new first emails 30 minutes (Hold / Edit / Send now on the dashboard), then sends 8am–5pm weekdays, capped per day. Follow-ups go on day 3, 7 and 14 **in the same thread** and stop the moment they reply.
- **11:42am and 3:42pm:** the AI answers replies. Pricing, calls, contracts and anything unusual wait under **Needs you**.
- **You:** handle **Needs you**, tap **Open WhatsApp** for phone-only leads, take the calls, mark deals **Won**.

Pause everything: dashboard → Settings → Auto-send off.
