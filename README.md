# 📦 EFL File Share — Cloudflare version

Excel files **Site → Client → Inbound / Outbound** විදිහට share කරන system එක.
Upload කරන අයට සහ Download කරන අයට **වෙන වෙනම user base**.
**සියල්ලම Cloudflare එකේ** — website, database (D1), files (R2). Free plan එක business වැඩ වලටත් OK.

```
🏭 Site (BIYAGAMA)            🏭 Site (KATUNAYAKE)
 ├─ 🏢 DONALDSON               ├─ 🏢 HAFELE
 │    ├─ ⬇ Inbound             │    ├─ ⬇ Inbound
 │    └─ ⬆ Outbound            │    └─ ⬆ Outbound
 └─ 🏢 VIP …                   └─ …
```

| කොටස | Cloudflare එකේ නම | කරන දේ |
|---|---|---|
| Website + API | **Pages** | Login, upload, download pages |
| Database | **D1** (`DB`) | Users, sites, clients, file list, download log |
| File storage | **R2** (`FILES`) | Excel files (`BIYAGAMA/DONALDSON/inbound/2026/11/...`) |

---

## ✅ Setup — Dashboard එකෙන්ම, පියවර 6යි

ඕනේ වෙන්නේ **GitHub** account එකක් සහ **Cloudflare** account එකක් විතරයි. Computer එකේ මොනවත් install කරන්න ඕනේ නෑ.
(R2 enable කරන්න Cloudflare එකට card එකක් add කරන්න වෙනවා — 10 GB දක්වා free, ඒ ගාණට වඩා ගියොත් විතරයි charge වෙන්නේ.)

---

### පියවර 1 — Code එක GitHub එකට දාන්න

1. https://github.com/new → Name: `efl-fileshare` → **Private** → **Create repository**
2. **"uploading an existing file"** link එක click කරන්න
3. Zip එක extract කරලා, **`efl-fileshare` folder එක ඇතුළේ තියෙන හැම file/folder එකක්ම** drag & drop කරන්න
   (`functions`, `public`, `migrations`, `schema.sql`, `package.json`, `README.md` …)
4. **Commit changes**

---

### පියවර 2 — Database (D1) හදන්න

1. https://dash.cloudflare.com → login
2. වම් menu එකේ **Storage & Databases** → **D1 SQL Database** → **Create**
3. Name: `efl-fileshare-db` → **Create**
4. හැදුණු database එක open කරලා **Console** tab එකට යන්න
5. **`schema.sql`** file එක Notepad එකෙන් open කරලා **සම්පූර්ණයෙන්ම copy** කරලා Console එකට paste කරන්න → **Execute**

✔ Tables, clients 4 (Donaldson, VIP, Häfele, Helen Kaminski) සහ `MAIN` කියලා default site එකක් හැදෙනවා.

> Error එකක් ආවොත්: schema.sql එක කොටස් 2–3කට කඩලා (එක `CREATE TABLE … ;` එකක් සම්පූර්ණයෙන්ම එක කොටසක තියෙන්න) එකින් එක Execute කරන්න.

---

### පියවර 3 — File storage (R2) හදන්න

1. වම් menu එකේ **Storage & Databases** → **R2 Object Storage**
2. පළමු පාරට නම් **Enable / Purchase R2** (free plan) → card details දාන්න
3. **Create bucket** → Name: `efl-fileshare-files` → Location: **Automatic** → **Create bucket**

---

### පියවර 4 — Website එක (Pages) GitHub එකට connect කරන්න

1. වම් menu එකේ **Workers & Pages** → **Create** (හෝ *Create application*)
2. **Pages** tab එක තෝරන්න → **Import an existing Git repository** / **Connect to Git**
   (Workers screen එකක් ආවොත් පල්ලෙහාට ගිහින් *"Looking to deploy Pages? Get started"* link එක click කරන්න)
3. GitHub account එක connect කරලා `efl-fileshare` repo එක තෝරන්න → **Begin setup**
4. Settings:
   * **Project name:** `efl-fileshare` (simple අකුරු, හිස්තැන් නැතුව)
   * **Framework preset:** `None`
   * **Build command:** *(හිස්ව තියන්න)*
   * **Build output directory:** `public`
5. **Save and Deploy** → විනාඩියක් ඉන්න

⚠️ මේ වෙලාවේ site එක open කළොත් වැඩ කරන්නේ නෑ — ඊළඟ පියවර දෙක ඉවර කරන්න.

---

### පියවර 5 — Database + Storage, website එකට සම්බන්ධ කරන්න (Bindings)

**Workers & Pages** → `efl-fileshare` → **Settings** → **Bindings** → **Add**

| Add කරන්නේ | Variable name (හරියටම මෙහෙම) | තෝරන්නේ |
|---|---|---|
| **D1 database** | `DB` | `efl-fileshare-db` |
| **R2 bucket** | `FILES` | `efl-fileshare-files` |

හැම එකකටම **Save** කරන්න.
(Production / Preview කියලා අහනවා නම් **Production** එකට දාන්න.)

---

### පියවර 6 — Admin password එක දාලා Redeploy කරන්න

1. ඒ **Settings** එකේම **Variables and Secrets** → **Add**
   * Type: **Secret**
   * Variable name: `ADMIN_PASSWORD`
   * Value: ඔයා කැමති ශක්තිමත් password එකක් (Admin page එකට log වෙන්නේ මේකෙන්)
   * **Save**
2. **Deployments** tab → උඩම තියෙන deployment එක ළඟ **⋯** → **Retry deployment**
   (Bindings / Secret apply වෙන්නේ redeploy කළාට පස්සේ)

🎉 ඉවරයි! `https://efl-fileshare.pages.dev` (හෝ ඒ වගේ) link එක open කරන්න.

---

## 👤 පළමු පාවිච්චිය

1. Link එක open කරලා → යටින් **Admin login** → username: `admin` · password: `ADMIN_PASSWORD` එක
2. **🏢 Clients** — අවශ්‍ය clients add/edit කරන්න (code එක permanent, උදා `DONALDSON`)
3. **🏭 Sites** — warehouses add කරන්න (උදා `BIYAGAMA` – EFL Biyagama) → ඒ site එකේ handle කරන clients tick කරන්න.
   `MAIN` ඕනේ නැත්නම් Edit → නම වෙනස් කරන්න, නැත්නම් Active untick කරන්න.
4. **⬆️ Uploader users** → **＋ Add user** → නම, username, channels, **sites**, **clients** → password එක copy කරලා ඒ කෙනාට දෙන්න
5. **⬇️ Downloader users** → ඒ විදිහටම
6. Uploader: **Upload Portal** → ① Site → ② Client → ③ Inbound/Outbound → Excel files drag & drop → **Upload**
7. Downloader: **Download Portal** → Site / Client / Inbound-Outbound තෝරලා **NEW** files download කරනවා

User කෙනෙකුට පේන්නේ / upload කරන්න පුළුවන් **ඒ කෙනාට දීපු sites + clients + channels තුනටම ගැලපෙන** files විතරයි.

---

## 🔧 පස්සේ

* **Code වෙනස් කළොත්:** GitHub එකට upload/push කළාම Cloudflare auto redeploy කරනවා.
* **Limits වෙනස් කරන්න (optional):** Settings → Variables and Secrets → Add (type: Text):
  `MAX_FILE_MB` (default 25) · `ALLOWED_EXT` (default `xlsx,xls,xlsm,csv`) · `SESSION_HOURS` (default 12) → Redeploy
* **පරණ files auto delete කරන්න:** R2 → bucket → **Settings → Object lifecycle rules** → උදා දින 90කට පස්සේ delete
* **Custom domain:** Pages project → **Custom domains** → `files.yourcompany.com`
* **කලින් version එකක database එකක් දැනටමත් තියෙනවා නම්:** අලුත් schema.sql එක නෙවෙයි, `migrations/` folder එකේ files (`0002_clients.sql`, ඊට පස්සේ `0003_sites.sql`) D1 Console එකේ run කරන්න.

## 🛟 ප්‍රශ්න ආවොත්

| පේන දේ | විසඳුම |
|---|---|
| Login කරනකොට `Server error … DB` / `undefined` | පියවර 5 bindings නැහැ, නැත්නම් නම `DB` / `FILES` හරියටම නැහැ → හදලා **Retry deployment** |
| `ADMIN_PASSWORD secret is not set` | පියවර 6 → Secret දාලා **Retry deployment** |
| `no such table` | පියවර 2 schema.sql එක run වෙලා නැහැ |
| Upload එකේ `… FILES …` error | R2 bucket binding (`FILES`) නැහැ |
| Pages එකේ 404 | Build output directory එක `public` නැහැ → Settings → Builds → වෙනස් කරලා Retry |

## 🧪 Local test (developers only)
```bash
npm install
cp wrangler.toml.example wrangler.toml
echo 'ADMIN_PASSWORD="test-admin-123"' > .dev.vars
npx wrangler d1 execute efl-fileshare-db --local --file=schema.sql
npx wrangler pages dev        # → http://localhost:8788
```

## 📁 Files
```
public/              index.html (login) · upload.html · download.html · admin.html · assets/
functions/_lib/      util.js — hashing, cookies, site/client/channel helpers
functions/api/       _middleware.js (login + portal guard)
  auth/              login · logout · me
  upload.js          POST /api/upload                         (uploader)
  my-uploads/        GET / DELETE                             (uploader)
  files/             GET /api/files, /api/files/:id/download  (downloader)
  admin/             sites · clients · users · files
schema.sql           D1 Console එකේ එක පාරක් run කරන්න (fresh install)
migrations/          පරණ database එකක් upgrade කරන්න විතරයි
wrangler.toml.example  local test / CLI වලට විතරයි
```
