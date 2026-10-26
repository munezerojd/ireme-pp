# IREME — Project Requirements & Runbook

## 1. Product requirements

IREME is an accessible agriculture AI/data platform for Rwanda. The application must:
- preserve the Stitch-inspired visual language and responsive layout;
- provide a landing page, dashboard, crop scan, forecast, statistics, Ask IREME, admin and accessibility settings;
- use real backend data for dashboard statistics, charts, tables, filters and insights;
- support camera and image upload for crop diagnosis;
- allow the owner to paste a Google Teachable Machine TensorFlow.js model URL;
- provide browser text-to-speech/audio readout;
- support English/Kinyarwanda labels and accessible controls;
- provide a sign-language video library integration point;
- allow authorized administrators to create/delete agricultural records;
- provide CSV export;
- expose a documented REST API;
- support mobile, tablet and desktop layouts;
- show loading, empty, success and error states.

## 2. Development requirements

### Software
- Windows 10/11, macOS or Linux
- Python 3.11+
- Node.js 20+ LTS recommended
- npm 10+
- Git recommended
- Modern Chromium, Firefox or Safari browser
- Internet access for `npm install` and for loading Google-hosted model assets

### Hardware
- 4 GB RAM minimum; 8 GB+ recommended
- 2 GB free disk space for development dependencies
- Webcam for camera diagnosis
- Microphone/speakers are optional; speakers/headphones are recommended for audio accessibility

## 3. Frontend stack
- React 18
- Vite 6
- React Router
- Axios
- Recharts
- Lucide React
- TensorFlow.js / Teachable Machine image library
- CSS responsive design

## 4. Backend stack
- Python
- FastAPI
- Uvicorn
- SQLAlchemy
- Pydantic
- Pandas
- NumPy
- SQLite for local development
- PostgreSQL recommended for production

## 5. Required environment

Create `frontend/.env` if the API is not on the default port:

```env
VITE_API_URL=http://127.0.0.1:8000/api
```

Backend `.env` values should include a production database URL and a strong secret key. Never commit real secrets.

## 6. Local startup

### Backend
```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API: `http://127.0.0.1:8000`
Swagger: `http://127.0.0.1:8000/docs`

### Frontend
Open another terminal:
```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`.

## 7. Crop AI requirements

1. Build/train an image model in Google Teachable Machine.
2. Export the model for TensorFlow.js.
3. Copy the model URL ending in `/`.
4. Open IREME → Crop Scan.
5. Paste the URL and click **Load AI model**.
6. Start the camera or upload an image.

The application does not claim a diagnosis unless the connected model returns a prediction.

## 8. Accessibility requirements
- keyboard-accessible controls;
- visible focus states;
- readable contrast;
- semantic labels;
- alt text for images;
- browser text-to-speech;
- large-text setting;
- bilingual UI labels;
- sign-language integration point;
- responsive mobile controls.

## 9. Production requirements
Before public deployment, add:
- JWT/OAuth authentication;
- role-based authorization for admin endpoints;
- password hashing if local accounts are introduced;
- PostgreSQL;
- HTTPS;
- secure cookies/tokens;
- rate limiting;
- upload size/type validation and malware scanning;
- audit logs;
- managed object storage for datasets/media;
- production monitoring and backups;
- real weather API credentials stored server-side;
- approved English/Kinyarwanda and ASL/RSL video assets with licensing/attribution;
- automated CI tests.

## 10. Testing checklist
- `GET /api/health` returns OK;
- dashboard loads;
- filters change statistics;
- CSV export works;
- admin add/delete works locally;
- camera permission error is handled;
- Teachable Machine URL validation is handled;
- image upload prediction works with a valid model;
- audio readout works in a supported browser;
- mobile navigation opens/closes;
- frontend production build completes;
- backend tests pass.
