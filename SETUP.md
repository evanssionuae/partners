# Evanssion Partner Portal: setup guide

Address: **partners.evanssion.com**. Everything runs free on Cloudflare (Pages, D1 database, KV file storage) plus Resend for email, which you already use.

## What it does
- Partners request access; **you approve** each one (email sent on approval).
- Approved partners see **Sales, Presales, Technical, SPIFF programmes, Deal registration**.
- Deal registrations are reviewed by you: approve (90-day protection), reject, or ask for more information. Same-customer conflicts are flagged.
- Admin pages manage users, deals and content (upload files, add links, set SPIFF dates and rewards).

## One-time setup (about 20 minutes)

**1. New GitHub repository.** Create `evanssionuae/partners` (private). Upload the *contents* of this folder (not the folder itself): `public`, `functions`, `src`, `schema.sql`, `package.json`, `SETUP.md`.

**2. Create the database (D1).** Cloudflare dashboard → Storage & databases → D1 → Create database → name `evanssion-partners`. Open it → Console → paste the whole of `schema.sql` → Execute.

**3. Create the file store (KV).** Storage & databases → KV → Create a namespace → name `evanssion-partner-files`.

**4. Create the Pages project.** Workers & Pages → Create → Pages → Connect to Git → pick `evanssionuae/partners`.
- Framework preset: None
- Build command: *leave empty*
- Build output directory: `public`
Deploy.

**5. Connect the database and file store.** Pages project → Settings → Bindings → Add:
- D1 database → variable name `DB` → `evanssion-partners`
- KV namespace → variable name `FILES` → `evanssion-partner-files`
Add them for **Production** (and Preview if you like).

**6. Variables and secrets.** Settings → Variables and secrets (Production):
- `SETUP_TOKEN` (secret): any long random string. You use it once, then delete it.
- `RESEND_API_KEY` (secret): your Resend key. Use a **new** key, since the old one was exposed in a screenshot.
- `PORTAL_FROM`: `noreply@evanssion.com`
- `PORTAL_ADMIN_EMAIL`: where access requests and deal registrations arrive (for example `sales@evanssion.com`)

**7. Redeploy.** Deployments → latest → Retry deployment (bindings and variables only apply to new deployments).

**8. Custom domain.** Pages project → Custom domains → Set up a domain → `partners.evanssion.com`. Cloudflare adds the DNS record for you.

**9. Create your administrator.** Open `https://partners.evanssion.com/`. It sends you to the first-time setup page. Enter the setup token, your name, email and password (10+ characters).

**10. Lock it down.** Delete `SETUP_TOKEN` in Cloudflare and redeploy. Setup already refuses to run once an admin exists; this removes the secret as well.

**11. Link from the main website.** Upload `site-portal-link-update.zip` (replace `build.js`), so "Partner login" points to partners.evanssion.com.

## Daily use
- **Approve a partner:** Admin → Access requests & users → check the company name → Approve.
- **Add content:** Admin → Content → choose the section (Sales / Presales / Technical / SPIFF), vendor, title, then upload a file (max 25 MB; PDF, PowerPoint, Word, Excel, ZIP, images) or paste an https link. SPIFF items also take a reward and start/end dates; they move from "Starting soon" to "Active now" to "Ended" automatically.
- **Hide without deleting:** untick "Visible to partners".
- **Large files (videos, big decks):** share them as a link (SharePoint, Drive, Vimeo) and add the link here.
- **Deal registrations:** Admin → Deal registrations. Partners are emailed the decision.

## Limits (free plans)
- KV free tier: 1 GB of files, 100,000 downloads a day. D1 free tier is far more than this needs.
- Resend free tier: 3,000 emails a month.
- If you outgrow KV, files can move to R2 later without changing the partners' experience.

## Security notes
- Passwords are hashed (PBKDF2-SHA256). Sessions are HttpOnly, Secure, SameSite=Strict cookies lasting 7 days.
- Six wrong passwords locks sign-in for that email and network for 15 minutes. Registration is limited to 5 per hour per network.
- Partners can only see their own deals. Files are served only to signed-in, approved users. Nothing is indexed by search engines.
- Suspending a user signs them out immediately.
