# 📦 EFL File Share — Vercel + Supabase version

Excel files **Site → Client → Inbound / Outbound** විදිහට share කරන system එක.
Upload කරන අයට සහ Download කරන අයට **වෙන වෙනම user base**.

```
🏭 Site (BIYAGAMA)            🏭 Site (KATUNAYAKE)
 ├─ 🏢 DONALDSON               ├─ 🏢 HAFELE
 │    ├─ ⬇ Inbound             │    ├─ ⬇ Inbound
 │    └─ ⬆ Outbound            │    └─ ⬆ Outbound
 └─ 🏢 VIP …                   └─ …
```

* Admin එකෙන් **Sites** හදලා, හැම site එකකම handle කරන **clients** තෝරනවා.
* හැම user කෙනෙකුටම **sites**, **clients**, **channels (Inbound/Outbound)** තුනම assign කරනවා — ඒ තුනටම ගැලපෙන files විතරයි පේන්නේ / upload කරන්න පුළුවන්.
* Upload: ① Site → ② Client (ඒ site එකේ clients විතරක් පේනවා) → ③ Inbound/Outbound → files.
* Download: Site bar → Client bar → Inbound/Outbound tabs, හැම එකකම **NEW** ගණන.
* Storage එකේ files තියෙන්නෙත් ඒ විදිහමයි: `BIYAGAMA/DONALDSON/inbound/2026/11/<id>.xlsx`

```
 Uploader browser ──(1) "upload කරන්න අවසර?" ──► Vercel API ──► Supabase DB
        │                                        (login, permissions, file list)
        └──(2) Excel file එක කෙලින්ම ──────────► Supabase Storage (private bucket)

 Downloader browser ──► Vercel API (permission check + log) ──► 60s link ──► file download
```

* **Vercel** → website එක + API (`api/index.js`)
* **Supabase** → Database (users, clients, files list) + Storage (Excel files)
* Files Vercel හරහා යන්නේ නැති නිසා Vercel 4.5 MB limit එක බලපාන්නේ නෑ (25 MB දක්වා OK).

---

## ✅ Setup — පියවර 5යි (විනාඩි 15–20)

ඕනේ වෙන්නේ: **GitHub**, **Supabase**, **Vercel** accounts 3 විතරයි. Computer එකේ මොනවත් install කරන්න ඕනේ නෑ.

---

### පියවර 1 — Supabase project එක හදන්න

1. https://supabase.com → **Sign in** → **New project**
2. Name: `efl-fileshare` · **Database Password** එකක් දාලා **ඒක ලියාගන්න** (පස්සේ ඕනේ)
3. Region: **Southeast Asia (Singapore)** (ලංකාවට ළඟම) → **Create new project** → විනාඩි 1–2 ඉන්න

### පියවර 2 — Tables + Storage හදන්න (එක click එකයි)

1. වම් පැත්තේ **SQL Editor** → **New query**
2. මේ zip එකේ තියෙන **`supabase-setup.sql`** file එක open කරලා **සම්පූර්ණයෙන්ම copy** කරලා paste කරන්න
3. **Run** ▶ → `Success` කියලා එනවා

මේකෙන් tables, private storage bucket (`efl-files`), clients 4 (Donaldson, VIP, Häfele, Helen Kaminski) සහ `MAIN` කියලා default site එකක් හැදෙනවා.

> කලින් version එකේ SQL එක දැනටමත් run කරලා නම් — **ඒ SQL එකම ආයේ run කරන්න**. Data මැකෙන්නේ නෑ; sites කොටස add වෙනවා, පරණ files `MAIN` site එකට යනවා, පරණ users ලට "All sites" ලැබෙනවා.

### පියවර 3 — Supabase එකෙන් keys 3ක් copy කරගන්න

Notepad එකක දාගන්න:

| මොකක්ද | කොහෙන්ද | Vercel එකේ නම |
|---|---|---|
| **Project URL** (`https://xxxx.supabase.co`) | Project Settings → **Data API** (හෝ **API**) | `SUPABASE_URL` |
| **Secret key** (`sb_secret_...`) හෝ පරණ **service_role** key | Project Settings → **API Keys** | `SUPABASE_SERVICE_ROLE_KEY` |
| **Connection string** — *Transaction pooler* | උඩ තියෙන **Connect** button → **Connection String** → **Transaction pooler** → URI copy | `DATABASE_URL` |

⚠️ Connection string එකේ `[YOUR-PASSWORD]` කියන තැනට පියවර 1 දී දාපු database password එක දාන්න.
(Port එක **6543** වෙන්න ඕනේ — ඒක තමයි Transaction pooler එක.)

⚠️ Secret / service_role key එක **කාටවත් දෙන්න එපා**, GitHub එකට දාන්නත් එපා.

### පියවර 4 — Code එක GitHub එකට දාන්න

**ලේසිම ක්‍රමය (command line නැතුව):**
1. https://github.com/new → Repository name: `efl-fileshare` → **Private** → **Create repository**
2. "uploading an existing file" link එක click කරන්න
3. Zip එක extract කරලා, **`efl-fileshare-vercel` folder එක ඇතුළේ තියෙන හැම file/folder එකක්ම** drag & drop කරන්න
   (`api`, `lib`, `public`, `package.json`, `vercel.json`, `supabase-setup.sql`, `README.md` …)
4. **Commit changes**

> Git පාවිච්චි කරනවා නම්: `git init && git add . && git commit -m "EFL File Share" && git branch -M main && git remote add origin https://github.com/<you>/efl-fileshare.git && git push -u origin main`

### පියවර 5 — Vercel එකට deploy කරන්න

1. https://vercel.com → **Continue with GitHub** (GitHub account එකෙන් login)
2. **Add New…** → **Project** → `efl-fileshare` repo එක ළඟ **Import**
3. **Framework Preset: Other** (වෙන කිසිම build setting එකක් වෙනස් කරන්න එපා)
4. **Environment Variables** කොටස open කරලා මේ 4 add කරන්න:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | පියවර 3 connection string එක (password එකත් එක්ක) |
   | `SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | secret / service_role key එක |
   | `ADMIN_PASSWORD` | Admin login එකට ඔයා කැමති ශක්තිමත් password එකක් |

5. **Deploy** → විනාඩියකින් `https://efl-fileshare-xxxx.vercel.app` වගේ link එකක් ලැබෙනවා 🎉

---

## 👤 පළමු පාවිච්චිය

1. Link එක open කරලා → යටින් **Admin login** → username: `admin` · password: `ADMIN_PASSWORD` එක
2. **🏢 Clients** — අවශ්‍ය clients add/edit කරන්න (code එක permanent, උදා `DONALDSON`)
3. **🏭 Sites** — warehouses add කරන්න (උදා `BIYAGAMA` – EFL Biyagama) → ඒ site එකේ handle කරන clients tick කරන්න.
   `MAIN` site එක ඕනේ නැත්නම් Edit → නම වෙනස් කරන්න, නැත්නම් Active untick කරන්න.
4. **⬆️ Uploader users** → **＋ Add user** → නම, username, channels, **sites**, **clients** තෝරන්න → password එක copy කරලා ඒ කෙනාට දෙන්න
5. **⬇️ Downloader users** → ඒ විදිහටම
6. Uploader කෙනෙක් **Upload Portal** එකෙන් log වෙලා **Site → Client → Inbound/Outbound** තෝරලා Excel upload කරනවා
7. Downloader කෙනෙක් **Download Portal** එකෙන් log වෙලා, **NEW** badge තියෙන files download කරනවා

---

## 🔧 පස්සේ වෙනස් කරන්න ඕනේ නම්

* **Code වෙනස් කළොත්:** GitHub එකට push / upload කළාම Vercel auto redeploy කරනවා.
* **Environment variable එකක් වෙනස් කළොත්:** Vercel → Project → Settings → Environment Variables → වෙනස් කරලා → **Deployments → … → Redeploy**.
* **Optional variables:** `MAX_FILE_MB` (default 25), `ALLOWED_EXT` (default `xlsx,xls,xlsm,csv`), `SESSION_HOURS` (default 12), `STORAGE_BUCKET` (default `efl-files`).
  25 MB වඩා වැඩි කරනවා නම් `supabase-setup.sql` එකේ bucket `file_size_limit` එකත් වැඩි කරන්න (Supabase free plan එකේ උපරිමය 50 MB).
* **Custom domain:** Vercel → Project → Settings → **Domains** → `files.yourcompany.com`

## 🛟 ප්‍රශ්න ආවොත්

| ප්‍රශ්නය | විසඳුම |
|---|---|
| Login එකේ `Server error: DATABASE_URL…` | Vercel env variable එක නැහැ / වැරදියි → හදලා **Redeploy** |
| `password authentication failed` | Connection string එකේ password එක වැරදියි (`[YOUR-PASSWORD]` replace කළාද?) |
| Upload එකේ `Storage sign upload failed` | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` වැරදියි, නැත්නම් SQL එක run කරලා නෑ (bucket නෑ) |
| Upload එකේ `storage error 413` | File එක bucket limit එකට වඩා ලොකුයි |
| Supabase project එක "Paused" | Free plan එකේ දින 7ක් පාවිච්චි නොකළොත් pause වෙනවා → Dashboard එකෙන් **Restore** |

## 📁 Files

```
api/index.js          සියලු API routes (login, upload, download, admin)
lib/util.js           password hashing, cookies, client/channel helpers
lib/db.js             Supabase Postgres connection
lib/storage.js        Supabase Storage (signed upload / download links)
public/               login · upload · download · admin pages
supabase-setup.sql    Supabase SQL Editor එකේ එක පාරක් run කරන්න
vercel.json           routing + security headers
```
