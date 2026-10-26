# IREME — Rwanda Agriculture Intelligence (Full-stack starter)

This package includes the React/Vite frontend and a FastAPI + SQLite backend. It is a runnable full-stack starter, not yet a production-hosted service.

## What the backend provides

- Persistent SQLite storage for crop indicator records.
- Admin login returning a signed, expiring bearer token.
- Protected create/delete endpoints for crop records.
- Readable crop records with filters for district, year, season and crop.
- Ask IREME agriculture knowledge endpoint with chat logging.
- Server-side Teachable Machine model URL configuration and a restricted asset proxy, so the public model-provider URL is not displayed in the user interface or shipped in the frontend bundle.
- Crop scan prediction logging (image inference runs in the browser through the backend model-asset proxy).
- Farmer-submitted crop, area, harvest, season, district and farm-problem records stored in SQLite; public submission endpoint plus protected admin listing endpoint.
- Protected admin endpoints for scan and chat logs.
- Interactive API documentation at `/docs`.

## Project layout

```text
IREME/
├── backend/
│   ├── app/main.py
│   ├── data/                 # SQLite database is created here
│   ├── requirements.txt
│   ├── .env.example
│   └── run.py
└── frontend/
    ├── src/main.jsx
    ├── src/style.css
    ├── public/ireme-logo.jpg
    ├── public/crop-scan-background.png  # Shared agriculture background across pages
    ├── public/sign-videos/   # Add reviewed MP4 clips here
    └── package.json
```

## 1. Start the backend (Windows PowerShell)

Open a terminal in the extracted `backend` folder:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
```

Open `backend/.env` and set a private admin password and a long random secret. Example only:

```dotenv
IREME_ADMIN_PASSWORD=choose-a-strong-password
IREME_SECRET_KEY=put-a-long-random-secret-here
IREME_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
IREME_DATABASE_PATH=./data/ireme.db
IREME_TM_MODEL_URL=https://teachablemachine.withgoogle.com/models/es52NDWZW/
```

Then run:

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check `http://127.0.0.1:8000/api/health` and open `http://127.0.0.1:8000/docs` to explore the API.

**Important:** if you do not create `.env`, the development fallback admin password is `123` and the signing secret is insecure. Never deploy with those defaults. Do not expose the development server directly to the public internet.

## 2. Start the frontend

Open a second terminal in the extracted `frontend` folder:

```powershell
npm install
npm run dev
```

Open the local URL Vite prints, normally `http://localhost:5173`.

The frontend expects the backend at `http://127.0.0.1:8000`. To use a different API URL, create `frontend/.env` containing:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Restart Vite after changing environment variables.

## 3. Admin workflow

1. Open **Admin data** in IREME.
2. Enter the password set in `backend/.env`.
3. Add a crop, district, year, area, and production. New entries are stored in SQLite and survive a restart.
4. Use **Lock admin** to remove the current browser token.
5. The model provider URL is configured server-side using `IREME_TM_MODEL_URL` in `backend/.env`; it is not shown in the public interface. Scan and chat logs can be reviewed through the protected API docs (`GET /api/scan-logs`, `GET /api/chat-logs`).

The bearer token is held in browser local storage for this starter. For a public production app, consider secure HttpOnly cookies, rate limiting, audit controls, HTTPS, CSRF protections where applicable, stronger user management and backups.

## 4. Farmer data submission

The **Farmer data** page uses simple large controls for district, crop, season, land area, harvest quantity and optional farm problems. Submissions are saved through `POST /api/farmer-submissions`. An authenticated administrator can review records using `GET /api/farmer-submissions`. Farmer-submitted records are not official NISR statistics until checked and validated.

## 5. Teachable Machine crop scan

The model provider URL is configured in `backend/.env` as `IREME_TM_MODEL_URL`. The frontend requests `model.json`, `metadata.json`, and `weights.bin` through the backend proxy, so the original provider URL is not placed in the frontend bundle or shown in the interface. Image classification runs in the browser; the backend stores prediction and confidence for later review. A URL cannot be treated as a secret if it is requested directly by a browser, so the proxy keeps the provider URL server-side. A model prediction is not a confirmed diagnosis. Do not show chemical treatment recommendations unless the predicted class has been verified and matched to authoritative Rwanda-specific guidance.

## 6. Data and limitations

- Seed data includes selected published NISR values: Season A 2024 maize, beans and paddy rice; and selected Season B 2025 production totals.
- Where a source value for planted area was not seeded, area is set to `0` and yield is returned as `null`; do not interpret this as zero hectares. Update these records with the exact values from the full official report before analytical use.
- The Dashboard is now a farmer-friendly project overview with large shortcuts rather than the statistics charts. Detailed filters and charts are in Statistics. Some charts still contain illustrative indicator values and should be reviewed before public release. National statistics are not district statistics; the district filter only filters records with a district-specific value.
- The Forecast page uses Open-Meteo for a district-coordinate-based daily forecast of up to 16 days and derives cautious rainfall/planting guidance. It also shows a three-month farm planner with preparation suggestions; months 2 and 3 are not presented as guaranteed monthly weather forecasts. Check Rwanda Meteorology Agency advisories for longer-term decisions.
- Crop Scan warms and caches the Teachable Machine model when the page opens, so later photo checks can reuse the loaded model. The camera option uses the device camera/file picker (camera support depends on browser/device).
- Ask IREME includes a larger curated Rwanda-focused knowledge base for seasons, crop management, disease precautions, soil, fertilizer, irrigation, harvest, storage, markets and NISR survey indicators. It is not a generative AI model or substitute for agricultural extension services.
- Admin password is configurable via environment, but this starter has one admin password rather than a full user/role-management system.
- Sign-language clips are optional and user-supplied. Put reviewed clips in `frontend/public/sign-videos/`; see `docs/SIGN_VIDEO_GUIDE.md` for page and chart filename conventions. Voice reads the current page one content section at a time and highlights the section being spoken. The separate Read page button starts this guided reading; Voice assistance enables spoken navigation commands. Kinyarwanda voice availability depends on the device. The interface translates common controls and key content, but not every technical label and data value is yet translated.

## 7. Official data sources to validate and expand

- NISR Seasonal Agricultural Survey: https://www.statistics.gov.rw/data-sources/surveys/Seasonal-Agricultural-Survey
- NISR SAS 2024 annual report: https://www.statistics.gov.rw/statistical-publications/agriculture-environment/seasonal-agricultural-survey-2024-annual-report-2024
- MINAGRI: https://www.minagri.gov.rw/
- Rwanda Agriculture and Animal Resources Development Board (RAB): https://www.rab.gov.rw/

## 8. Weather and disease-reference notes

- Open-Meteo documents up to 16 forecast days in its Weather Forecast API: https://open-meteo.com/en/docs
- Rwanda-focused crop disease background (cassava mosaic/brown streak, fall armyworm and potato late blight): https://rabp.aatf-africa.org/faqs.php
- Confirm crop disease diagnosis and pesticide choices with RAB or a district agronomist; the image classifier is a screening aid only.

## Smart Farm Advisor additions
- Statistics now includes a schematic Rwanda district locator that links to the Smart Farm Advisor and weather page.
- Smart Farm Advisor combines the available crop records with the selected district's short-range Open-Meteo forecast, offers evidence-labelled recommendations, and displays production and weather charts.
- The map is intentionally labelled schematic. Do not use it as an official crop-suitability or climate-change map until verified Rwanda district boundaries, soil, elevation, historical climate and crop-calendar GIS layers are added.
- Climate-change analysis requires long-term historical observations (ideally 20–30+ years); a 16-day weather forecast is not evidence of a climate trend.
- The sign-language player is fixed to the viewport's bottom-right corner. Extra bottom padding is reserved while it is enabled to reduce content obstruction; on small screens the player is reduced in size.

## Voice navigation and accessibility

Choose **Voice assistance** on the welcome screen, then select **Continue to IREME**. Allow microphone access when the browser asks. While voice assistance is on, say commands such as:

- `Go to crop scan` / `Scan my plant`
- `Go to dashboard`
- `Open statistics`
- `Open weather` / `Open forecast`
- `Open Smart Farm Advisor`
- `Ask IREME`
- `Change language to Kinyarwanda` / `Change language to English`
- `Read this page`
- `Help`
- `Stop listening`

IREME confirms recognized commands aloud and shows the current listening status. Voice recognition uses the browser's Web Speech API; it works best in a supported browser such as desktop Chrome and requires microphone permission. Speech-recognition availability and Kinyarwanda language support vary by browser/device. Speech synthesis and speech recognition are separate browser features, so a browser may be able to read text aloud without being able to recognize spoken commands. Voice is processed by the browser's speech service, not by the IREME backend.

## NISR-trained Smart Farm Advisor and Statistics (new)

The advisor and statistics are now trained on the NISR **Agricultural Household Survey (AHS) 2024** microdata
(37,819 plot-level crop records, 30 districts, 17 modelled crops).

- `backend/scripts/build_nisr_insights.py` reads the `.dta` files, cleans them, computes survey-weighted yield
  statistics and trains one transparent regression per crop (district, season, improved seed, fertilizer, compost,
  crop protection, irrigation, anti-erosion, intercropping, planting window, plot size), with 5-fold cross-validated R²
  and bootstrap confidence intervals. Output: `backend/data/nisr_insights.json` (also copied to `frontend/public/`).
- Rebuild after new data: `pip install pandas numpy` then
  `python backend/scripts/build_nisr_insights.py --data "<folder with AHS2024 .dta files>"` and copy the JSON to `frontend/public/nisr_insights.json`.
- API: `GET /api/nisr/insights`, `/api/nisr/crops`, `/api/nisr/yields?crop=Maize`, `/api/nisr/advice?crop=Maize&district=Musanze&season=A&improved_seed=true`.
- The app computes advice in the browser from the same JSON (`frontend/src/nisr/engine.js`) so it also works offline; the
  Python (`backend/app/nisr_advisor.py`) and JavaScript versions give identical numbers.
- Honest limits: effects are associations in survey data, not guarantees; plots in the survey are small; fertilizer doses are never
  suggested; every result shows its evidence and sample size.

## Voice mode and reading mode (default)

On the welcome screen **Voice assistance** is preselected. Press **Enter** (the Continue button is focused) or click Continue and IREME
enters in voice mode + reading mode: it greets you, listens through the microphone, and reads every page with highlighting.

- Say `help` on any page for the commands of that page. Examples: `go to statistics`, `advice for maize in Huye`, `weather in Musanze`,
  `ask IREME`, `stop`, `pause`, `resume`, `next section`, `read faster`, `bigger text`, `reading mode off`, `Kinyarwanda`.
- **Ask IREME**: arrive there and just speak your question; IREME answers and reads the answer back, then listens for the next question.
  Say `read answer`, `new question`, or `go to dashboard`.
- Accuracy: command synonyms in English and Kinyarwanda, typo-tolerant matching, mis-hearings of "IREME" are fixed, up to 5 alternatives per phrase,
  echo filter (IREME ignores its own voice), instant `stop`, automatic microphone restart.
- `Esc` stops speech. Browsers only allow speech after a click or key press, so the first Enter/click is required. Kinyarwanda recognition is
  not available in every browser; IREME then listens in English and says so.

## Real map of Rwanda for agriculture (new)

The two schematic SVG maps (Statistics page and Smart Farm Advisor page) are replaced by a real, interactive map
(`frontend/src/map/RwandaAgriMap.js`, Leaflet + OpenStreetMap).

- Colours show NISR AHS 2024 values for all 30 districts: typical yield of any crop, use of improved seed / fertilizer / compost /
  crop protection / irrigation / anti-erosion, and reported soil threats (erosion, falling fertility, waterlogging, landslide).
  Tap a district for its summary, best crops, "Read aloud", farm advice and weather.
- District outlines load from `frontend/public/rwanda_districts.geojson` if present, otherwise from geoBoundaries (open data).
  If neither is reachable the real basemap still shows, with markers at approximate district centres, and the map says so.
  To work fully offline, run once on a computer with internet: `python backend/scripts/fetch_rwanda_boundaries.py`.
- Run `npm install` after updating (adds `leaflet`). Basemap tiles need internet and credit OpenStreetMap contributors.
- Voice: on any page say `show fertilizer map`, `yield map for maize`, `erosion map in Musanze`, `landslide map`; IREME reads the summary.

## Dark mode, smarter advice, install as an app (new)

- **Dark mode**: button in the header (or say `dark mode` / `light mode`). Remembers your choice and follows the device setting the first time.
  `frontend/src/dark.css` is generated from `style.css` (`python frontend/tools/generate_dark_theme.py`); light mode is unchanged.
- **Advisor uses weather, crop, growth stage, irrigation and soil**: 16-day Open-Meteo forecast (rain, temperature, evapotranspiration) is combined with the
  crop's water needs (FAO-56 method) to give an irrigation schedule (or what to protect if you only have rain), planting readiness, heavy-rain / disease /
  heat / cold alerts, best days to spray, harvest and work, plus growth-stage tips. NISR survey evidence still ranks seed, fertilizer, compost and timing.
  Logic: `frontend/src/nisr/agronomy.js` (tested in Node).
- **More statistics**: key findings per crop, season comparison, yield spread, farmer-reported trend, fertilizer types, cooperatives / farmer groups /
  insurance / credit (NISR AHS 2024 sections 0, 6 and credits), and a district table you can download as CSV.
- **Sign-language panel**: shows the placeholder picture whenever no video is playing (also before play and after a video ends).
  Replace `frontend/public/sign-videos/sign-idle-placeholder.png` to use another picture.
- **Voice**: saying "go to <page>" opens it and starts reading it. On Ask IREME speak your question (in one or several parts), then say `enter`
  (or `send`, `done`); IREME answers and reads the answer. The text box also sends on the Enter key. `ask IREME <question>` still sends immediately.
- **Install as an app (PWA)**: `npm run build`, then serve `frontend/dist` over HTTPS (or `npm run preview` on localhost). In Chrome/Edge use the
  **Install app** button (or say `install app`); on iPhone use Share, then Add to Home Screen. Installed IREME starts offline (pages, statistics, advisor
  data); weather, map tiles and the backend API need internet. The service worker is `frontend/public/sw.js` (change `CACHE` to force an update).

## Sign-language videos per page, and admin sign-in (updated)

- The sign-language panel is open by default. When you open a page it plays that page's video automatically (muted, no player controls, filling its frame);
  when you leave the page the video stops and the next page's video starts. If a page has no video yet, or a video ends, the placeholder picture
  `frontend/public/sign-videos/sign-idle-placeholder.png` is shown. The × button hides the panel; the header Sign language button brings it back.
- Put your videos in `frontend/public/sign-videos/` named `<lang>_<page>.mp4`, where lang is `en` or `rw`, for example:
  `en_dashboard.mp4`, `en_farmer_data.mp4`, `en_statistics.mp4`, `en_smart_farm_advisor.mp4`, `en_forecast.mp4`, `en_crop_scan.mp4`, `en_ask_ireme.mp4`,
  `en_admin_data.mp4` and the same with the `rw_` prefix. Chart explanations use `<lang>_<chart_title>.mp4` (lower case, underscores).
- Admin data: after one login the browser stays signed in for 30 days (the page opens straight into data management) and the browser can auto-fill the
  password. The password itself is never stored in the app code. Set it in `backend/.env` (`IREME_ADMIN_PASSWORD`). Use **Lock admin** to sign out.

## Kinyarwanda voice and reading: "Iracyari kubakwa" (under development)

Good Kinyarwanda text-to-speech and speech recognition are not yet available in browsers, so for now IREME shows a notice
("Iracyari kubakwa / Under development") whenever someone tries voice or reading aloud in Kinyarwanda: turning on voice, reading mode, Read page,
Speak your question, Read explanation, choosing voice mode on the welcome screen, or switching to Kinyarwanda while voice is on.
Voice and reading are switched off in that case and the notice offers "Use English". The Kinyarwanda text and the sign-language videos keep working.
When a good Kinyarwanda voice and recogniser exist, set `RW_VOICE_READY = true` in `frontend/src/voice/speech.js` to turn the feature back on.

## Deploy on Render

1. Push the project to a GitHub repository (the included `.gitignore` keeps `.env` and the local database out).
2. In Render: **New > Blueprint**, pick the repo; it reads `render.yaml` and creates `ireme-api` (Python web service, root `backend`) and `ireme-web`
   (static site, root `frontend`, build `npm install && npm run build`, publish `dist`).
3. Enter `IREME_ADMIN_PASSWORD`; leave the other two blank for now. After the first deploy copy both public URLs.
4. On `ireme-web` set `VITE_API_BASE_URL` = the API URL, then **Manual Deploy > Clear build cache & deploy** (the value is baked in at build time).
5. On `ireme-api` set `IREME_CORS_ORIGINS` = the app URL; it restarts by itself.
6. Check `<api-url>/api/health`, then open the app URL. Free instances sleep after ~15 minutes idle and their disk is wiped on every restart;
   for permanent admin data use a paid plan with a disk (see comments in `render.yaml`).

## Phone layout (checked at 390 px wide)

Rendering the app at phone size showed three things, now fixed: the header buttons are compact and wrap into rows; the left icon rail shows **all**
pages (before, phones only showed the current page, so you could not reach other pages by touch); the sign-language panel is a small corner thumbnail on
phones - tap it to enlarge or shrink. `RW_VOICE_READY`, dark mode and the notice all work on phones.
