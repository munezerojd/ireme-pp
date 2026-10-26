from __future__ import annotations
import os, json, sqlite3, time, hmac, hashlib, base64, urllib.request, urllib.error
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')
DB_PATH = Path(os.getenv('IREME_DATABASE_PATH', str(BASE_DIR / 'data' / 'ireme.db')))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
ADMIN_PASSWORD = os.getenv('IREME_ADMIN_PASSWORD', '123')
SECRET_KEY = os.getenv('IREME_SECRET_KEY', 'dev-only-change-me-before-deployment')
TM_MODEL_BASE_URL = os.getenv('IREME_TM_MODEL_URL', 'https://teachablemachine.withgoogle.com/models/es52NDWZW/').rstrip('/') + '/'
ORIGINS = [x.strip() for x in os.getenv('IREME_CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',') if x.strip()]
app = FastAPI(title='IREME Rwanda Agriculture API', version='1.0.0', description='Backend API for the IREME agriculture intelligence web application.')
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_credentials=True, allow_methods=['*'], allow_headers=['*'])

class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    remember: bool = False        # keep this device signed in for 30 days instead of 8 hours
class CropIn(BaseModel):
    crop: str = Field(min_length=1, max_length=100)
    district: str = Field(min_length=1, max_length=100)
    year: int = Field(ge=2000, le=2100)
    season: str = Field(default='Annual', max_length=30)
    area: float = Field(ge=0)
    production: float = Field(ge=0)
    source: str = Field(default='Admin entered', max_length=300)
class ChatIn(BaseModel): question: str = Field(min_length=1, max_length=2000); language: str = 'EN'
class ScanLogIn(BaseModel): filename: str = ''; prediction: str = Field(min_length=1, max_length=200); confidence: Optional[float] = Field(default=None, ge=0, le=1); model_url: str = ''
class SettingIn(BaseModel): value: str = Field(min_length=1, max_length=2000)
class FarmerSubmissionIn(BaseModel):
    farmerName: str = Field(min_length=1, max_length=150)
    district: str = Field(min_length=1, max_length=100)
    sector: str = Field(default='', max_length=100)
    village: str = Field(default='', max_length=100)
    crop: str = Field(min_length=1, max_length=100)
    season: str = Field(default='A', max_length=20)
    area: Optional[float] = Field(default=None, ge=0)
    harvest: Optional[float] = Field(default=None, ge=0)
    unit: str = Field(default='kg', max_length=30)
    plantingDate: str = Field(default='', max_length=30)
    harvestDate: str = Field(default='', max_length=30)
    problem: str = Field(default='', max_length=100)
    phone: str = Field(default='', max_length=40)
    comment: str = Field(default='', max_length=2000)

def connect():
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db

def init_db():
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS crops (id INTEGER PRIMARY KEY AUTOINCREMENT, crop TEXT NOT NULL, district TEXT NOT NULL, year INTEGER NOT NULL, season TEXT NOT NULL, area REAL NOT NULL CHECK(area>=0), production REAL NOT NULL CHECK(production>=0), source TEXT NOT NULL DEFAULT 'Admin entered', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS scan_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, prediction TEXT NOT NULL, confidence REAL, model_url TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS chat_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT NOT NULL, language TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS farmer_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, district TEXT NOT NULL, sector TEXT, village TEXT, crop TEXT NOT NULL, season TEXT, area REAL, harvest REAL, unit TEXT, planting_date TEXT, harvest_date TEXT, problem TEXT, phone TEXT, farmer_name TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        ''')
        columns = {r['name'] for r in db.execute('PRAGMA table_info(farmer_submissions)').fetchall()}
        if 'farmer_name' not in columns: db.execute("ALTER TABLE farmer_submissions ADD COLUMN farmer_name TEXT NOT NULL DEFAULT ''")
        if 'comment' not in columns: db.execute("ALTER TABLE farmer_submissions ADD COLUMN comment TEXT NOT NULL DEFAULT ''")
        count = db.execute('SELECT COUNT(*) FROM crops').fetchone()[0]
        if count == 0:
            # Seeded figures explicitly trace to official NISR Seasonal Agricultural Survey publications.
            seed = [
                ('Maize','National',2024,'A',249435,507985,'NISR SAS Season A 2024'),
                ('Beans','National',2024,'A',329001,233142,'NISR SAS Season A 2024'),
                ('Paddy rice','National',2024,'A',17173,69098,'NISR SAS Season A 2024'),
                ('Maize','National',2025,'B',None if False else 0,117711,'NISR SAS Season B 2025; area not populated in this seed'),
                ('Paddy rice','National',2025,'B',0,72976,'NISR SAS Season B 2025; area not populated in this seed'),
                ('Cassava','National',2025,'B',0,852541,'NISR SAS Season B 2025; area not populated in this seed'),
                ('Sweet potato','National',2025,'B',0,652515,'NISR SAS Season B 2025; area not populated in this seed'),
                ('Irish potato','National',2025,'B',0,314093,'NISR SAS Season B 2025; area not populated in this seed'),
                ('Beans','National',2025,'B',0,240721,'NISR SAS Season B 2025; area not populated in this seed'),
                ('Cooking banana','National',2025,'B',0,527109,'NISR SAS Season B 2025; category production from NISR SAS Season B 2025'),
            ]
            db.executemany('INSERT INTO crops(crop,district,year,season,area,production,source) VALUES(?,?,?,?,?,?,?)', seed)
        db.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('teachable_machine_url','https://teachablemachine.withgoogle.com/models/es52NDWZW/')")
init_db()

def b64(data: bytes) -> str: return base64.urlsafe_b64encode(data).decode().rstrip('=')
def make_token(ttl_seconds: int = 60*60*8):
    payload = b64(json.dumps({'role':'admin','exp':int(time.time())+ttl_seconds}).encode())
    sig = b64(hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest())
    return payload+'.'+sig

def require_admin(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith('Bearer '): raise HTTPException(401, 'Admin authentication required')
    token = authorization[7:].strip()
    try:
        payload, signature = token.split('.', 1)
        expected = b64(hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected): raise ValueError('signature')
        data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        if data.get('role') != 'admin' or data.get('exp', 0) < time.time(): raise ValueError('expired')
    except Exception: raise HTTPException(401, 'Invalid or expired admin token')
    return True

@app.get('/')
def root(): return {'name':'IREME Rwanda Agriculture API','status':'ok','docs':'/docs'}
@app.get('/api/health')
def health(): return {'status':'ok','database':'sqlite','version':'1.0.0'}
@app.post('/api/auth/login')
def login(body: LoginIn):
    if not hmac.compare_digest(body.password, ADMIN_PASSWORD): raise HTTPException(401, 'Incorrect admin password')
    ttl = 60*60*24*30 if body.remember else 60*60*8
    return {'access_token':make_token(ttl),'token_type':'bearer','expires_in':ttl}
@app.get('/api/auth/me', dependencies=[Depends(require_admin)])
def auth_me(): return {'role':'admin'}
@app.get('/api/crops')
def list_crops(district: Optional[str]=None, year: Optional[int]=None, season: Optional[str]=None, crop: Optional[str]=None, limit: int=Query(500, ge=1, le=2000)):
    sql='SELECT * FROM crops WHERE 1=1'; args=[]
    for col, val in [('district',district),('year',year),('season',season),('crop',crop)]:
        if val is not None and val not in ('','All districts','All years','All seasons','All crops'):
            sql += f' AND {col}=?'; args.append(val)
    sql += ' ORDER BY year DESC, season, crop LIMIT ?'; args.append(limit)
    with connect() as db: rows=[dict(r) for r in db.execute(sql,args).fetchall()]
    for r in rows: r['yield'] = (r['production']/r['area']) if r['area'] else None
    return {'items':rows,'count':len(rows)}
@app.post('/api/crops', dependencies=[Depends(require_admin)], status_code=201)
def create_crop(body: CropIn):
    with connect() as db:
        cur=db.execute('INSERT INTO crops(crop,district,year,season,area,production,source) VALUES(?,?,?,?,?,?,?)',(body.crop.strip(),body.district.strip(),body.year,body.season.strip(),body.area,body.production,body.source.strip()))
        row=dict(db.execute('SELECT * FROM crops WHERE id=?',(cur.lastrowid,)).fetchone())
    row['yield']=row['production']/row['area'] if row['area'] else None
    return row
@app.delete('/api/crops/{crop_id}', dependencies=[Depends(require_admin)])
def delete_crop(crop_id: int):
    with connect() as db: cur=db.execute('DELETE FROM crops WHERE id=?',(crop_id,))
    if cur.rowcount == 0: raise HTTPException(404,'Crop record not found')
    return {'deleted':True,'id':crop_id}

KNOWLEDGE = [
('season','Rwanda generally uses three agricultural seasons: Season A (around September-February), Season B (around March-June), and Season C (around July-September). Exact planting dates depend on district rainfall and official seasonal advisories.'),
('maize','NISR reported Season A 2024 maize production of 507,985 tonnes from 249,435 hectares, with average yield 2 tonnes/ha. Use locally recommended certified seed, plant after reliable rains begin, weed early, rotate crops and scout for fall armyworm.'),
('beans','NISR reported Season A 2024 bean production of 233,142 tonnes from 329,001 hectares, with average yield 709 kg/ha. Avoid waterlogging, use suitable seed, rotate crops and inspect for anthracnose, angular leaf spot and bean fly.'),
('cassava','Cassava mosaic disease and cassava brown streak disease are important regional threats. They can spread through whiteflies and infected cuttings. Use clean planting material and varieties recommended by RAB; do not distribute cuttings from suspect plants.'),
('potato','Potato late blight can spread quickly in cool, wet conditions. Use healthy seed tubers, monitor leaves and stems after rain, avoid moving infected tubers and seek local advice about registered disease controls. Potato bacterial wilt also requires expert confirmation and strict field hygiene.'),
('banana','Banana production can be affected by banana Xanthomonas wilt, weevils and nematodes. Use clean planting material, clean tools, avoid moving suspect suckers and follow district agronomist guidance for removing infected plants.'),
('rice','Rice production depends on suitable varieties, water management, weed control and good post-harvest drying. Avoid harvesting or storing grain while too wet; follow local cooperative and extension recommendations.'),
('sweet potato','Use healthy vines, rotate fields where possible, maintain weed control and monitor for weevils and viral symptoms. Store roots in a cool, dry, ventilated place and follow local market/extension guidance.'),
('irish potato','Use certified or otherwise trusted healthy seed tubers, rotate fields, hill plants as recommended and monitor late blight during wet periods. Ask extension staff before applying fungicides.'),
('tomato','Tomatoes can be affected by early blight, late blight, bacterial spot, leaf mold, viruses and pests. Avoid prolonged leaf wetness, improve airflow, rotate crops and confirm the cause before applying a crop-protection product.'),
('coffee','Coffee health and yield depend on variety, plant nutrition, pruning, shade and pest/disease monitoring. For Rwanda-specific coffee advice, consult NAEB, RAB or a local extension officer; use current official figures for prices and exports.'),
('tea','Tea production is affected by rainfall, soil fertility, plucking management and field health. Consult the relevant cooperative, NAEB and local agronomists for area-specific management and market information.'),
('vegetable','For vegetables, use healthy seed, rotate crop families, avoid overwatering, scout weekly and harvest at suitable maturity. Keep records of planting date, input use, pest incidence and harvested quantity.'),
('soil erosion','Contour planting, grass strips, mulching, cover crops, terraces where suitable and maintaining soil cover can reduce erosion on Rwanda’s sloping land. Terrace layout should be designed with district agronomist advice.'),
('soil fertility','Combine organic matter with soil-test-based mineral fertilizer recommendations where available. Compost should be well decomposed. Do not guess fertilizer doses; rates depend on crop, soil, variety and local recommendation.'),
('fertilizer','NISR 2024 reported inorganic fertilizer use by 64.5% of farmers in Season A, 52.0% in Season B and 60.4% in Season C. These are survey usage percentages, not application rates. Follow soil-test and extension guidance.'),
('irrigation','Irrigate based on crop stage, soil moisture, water availability and local advice. Water early in the morning when practical, avoid waterlogging, maintain channels and do not contaminate water sources with chemicals.'),
('harvest','Harvest at crop-appropriate maturity, avoid unnecessary bruising, separate damaged produce, dry grains to safe storage moisture and keep storage areas clean, dry and pest-proof.'),
('storage','Store grain only after adequate drying. Use clean, dry, pest-resistant storage, elevate bags from the floor and inspect regularly. Follow food-safety advice and avoid mixing new grain with old infested grain.'),
('market','Before selling, compare local cooperative and market information, grade produce consistently, keep weight/quality records and calculate transport, storage and input costs. IREME does not provide live market prices unless a verified market data source is connected.'),
('livestock','For animal health, use clean water and housing, follow vaccination and veterinary guidance, quarantine sick animals where practical and contact a qualified veterinary professional for diagnosis and treatment.'),
('climate','Weather forecasts help with short-term planning but cannot guarantee rainfall. Use the forecast alongside Rwanda Meteorology Agency advisories, local observations and district extension recommendations.'),
('plant disease','An image model prediction is a screening aid, not a confirmed diagnosis. Compare symptoms across several plants, clean tools, avoid moving infected planting material and consult a trained agronomist before using pesticides. Follow product labels and local regulations.'),
('nisr','NISR’s Seasonal Agricultural Survey provides national agricultural indicators, crop area, production and yield, agricultural practices and other survey findings. For official reporting, cite the relevant NISR report, season and year; do not label demo or estimated values as official observations.')
]
RW_ANSWERS = {
'season':'Mu Rwanda hakunze gukoreshwa ibihe by’ihinga bitatu: Igihembwe A (nko muri Nzeri–Gashyantare), B (Werurwe–Kamena), na C (Nyakanga–Nzeri). Amatariki yo gutera imyaka aterwa n’imvura y’akarere n’inama z’inzego zibishinzwe.',
'maize':'Mu Igihembwe A cya 2024, NISR yagaragaje ko ibigori byatanze toni 507,985 ku buso bwa hegitari 249,435; umusaruro ugereranyije wari toni 2 kuri hegitari. Koresha imbuto zemewe zikwiriye akarere, tera imvura itangiye neza, rwangiza ibyatsi bibi hakiri kare kandi ukurikirane udusimba twangiza ibigori.',
'beans':'Mu Igihembwe A cya 2024, NISR yagaragaje toni 233,142 z’ibishyimbo ku buso bwa hegitari 329,001. Irinde amazi menshi mu murima, koresha imbuto nziza, uhinduranye ibihingwa kandi ugenzure indwara z’amababi n’udukoko.',
'cassava':'Indwara ya cassava mosaic n’indwara ya cassava brown streak ni ikibazo gikomeye mu karere. Zishobora gukwirakwizwa n’amasazi y’umweru n’uduti two gutera twanduye. Koresha uduti twiza n’amoko agirwa inama na RAB; ntukwirakwize uduti two ku bimera bikekwa ko birwaye.',
'potato':'Indwara ya late blight y’ibirayi ishobora gukwirakwira vuba mu gihe gikonje kandi cy’imvura. Koresha imbuto z’ibirayi nzima, genzura amababi nyuma y’imvura kandi ubaze umukozi w’ubuhinzi mbere yo gukoresha imiti.',
'soil erosion':'Mu kurwanya isuri, koresha gutera ukurikije imirongo y’ubutaka, ibyatsi bifata ubutaka, gutwikira ubutaka n’uturima tw’indinganire aho bikwiye. Imiterere y’indinganire igomba kugenwa n’umukozi w’ubuhinzi.',
'fertilizer':'Imibare ya NISR ya 2024 igaragaza ikoreshwa ry’ifumbire mvaruganda ku gipimo cya 64.5% mu gihembwe A, 52% mu B na 60.4% mu C. Iyi ni imibare y’abayikoresha, si ingano igomba gushyirwa ku murima. Kurikiza inama zishingiye ku butaka n’abajyanama b’ubuhinzi.',
'irrigation':'Koresha kuhira ukurikije igihingwa, uko ubutaka buteye, amazi ahari n’inama z’abajyanama. Irinde kurengera amazi no kwangiza amasoko y’amazi ukoresheje imiti.',
'harvest':'Sarura igihe igihingwa gikuze neza, irinde gukomeretsa umusaruro, kuma ibinyampeke bihagije mbere yo kubibika kandi ubibike ahantu humutse, hasukuye kandi harinzwe udukoko.',
'plant disease':'Icyo muderi ivuze ku ifoto ni igitekerezo cyo gufasha gusuzuma, si isuzuma ryemejwe. Gereranya ibimenyetso ku bimera byinshi, sukura ibikoresho kandi ubaze umukozi w’ubuhinzi mbere yo gukoresha imiti.',
'nisr':'NISR ikora ubushakashatsi ku buhinzi bukusanya imibare y’ubuso, umusaruro, umusaruro kuri hegitari n’imikorere y’ubuhinzi. Mu gutanga raporo zemewe, garagaza raporo ya NISR, igihembwe n’umwaka; ntukerekane imibare y’igerageza nk’imibare yemewe.',
'storage':'Bika ibinyampeke bimaze kuma bihagije. Koresha ububiko busukuye, bwumutse kandi burinzwe udukoko; shyira imifuka hejuru y’imbaho aho kuyishyira hasi kandi ugenzure ububiko buri gihe.',
'market':'Mbere yo kugurisha, gereranya amakuru y’isoko n’amakoperative, shyira umusaruro mu byiciro bimwe kandi ubare ikiguzi cy’ubwikorezi, ububiko n’inyongeramusaruro. IREME ntitanga ibiciro by’isoko by’ako kanya keretse hiyongerewe isoko ry’amakuru yizewe.',
'tomato':'Inyanya zishobora kwibasirwa na early blight, late blight, bacterial spot, leaf mold, virusi n’udukoko. Irinde ko amababi ahora atose, hinduranya ibihingwa kandi wemeze indwara mbere yo gukoresha umuti.',
'rice':'Umusaruro w’umuceri uterwa n’amoko y’imbuto, imicungire y’amazi, kurwanya ibyatsi bibi no kumisha neza nyuma yo gusarura. Ntubike umuceri utarumuka bihagije.',
'sweet potato':'Koresha imivyaro myiza, hinduranya ibihingwa aho bishoboka, rwangiza ibyatsi bibi kandi ugenzure udukoko. Bika ibijumba ahantu humutse, hakonje kandi hari umwuka.',
'coffee':'Ubuzima n’umusaruro wa kawa biterwa n’ubwoko, imirire y’igihingwa, gutema amashami no kugenzura udukoko n’indwara. Ku nama zerekeye kawa mu Rwanda, baza NAEB, RAB cyangwa umukozi w’ubuhinzi.',
'tea':'Umusaruro w’icyayi uterwa n’imvura, uburumbuke bw’ubutaka, uburyo bwo gusoroma n’ubuzima bw’ibihingwa. Baza koperative, NAEB n’abajyanama b’ubuhinzi ku nama zijyanye n’akarere.',
'vegetable':'Ku mboga, koresha imbuto nzima, hinduranya ibihingwa, irinde amazi menshi, genzura umurima buri cyumweru kandi sarura igihe gikwiye.'
}
@app.post('/api/farmer-submissions')
def create_farmer_submission(body: FarmerSubmissionIn):
    with connect() as db:
        cur = db.execute('INSERT INTO farmer_submissions(district,sector,village,crop,season,area,harvest,unit,planting_date,harvest_date,problem,phone,farmer_name,comment) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (body.district,body.sector,body.village,body.crop,body.season,body.area,body.harvest,body.unit,body.plantingDate,body.harvestDate,body.problem,body.phone,body.farmerName,body.comment))
        row = db.execute('SELECT id, district, sector, crop, season, area, harvest, unit, problem, created_at FROM farmer_submissions WHERE id=?', (cur.lastrowid,)).fetchone()
    return {'message':'Farmer information saved. It is not an official statistic until validated.','submission':dict(row)}

@app.get('/api/farmer-submissions', dependencies=[Depends(require_admin)])
def list_farmer_submissions(limit: int=Query(500, ge=1, le=2000), district: Optional[str]=None, crop: Optional[str]=None):
    sql='SELECT * FROM farmer_submissions WHERE 1=1'; args=[]
    if district and district!='All districts': sql += ' AND district=?'; args.append(district)
    if crop and crop!='All crops': sql += ' AND crop=?'; args.append(crop)
    sql += ' ORDER BY id DESC LIMIT ?'; args.append(limit)
    with connect() as db: rows=[dict(r) for r in db.execute(sql,args).fetchall()]
    return {'items':rows,'count':len(rows)}

@app.post('/api/chat')
def chat(body: ChatIn):
    q=body.question.casefold(); answer=None; matched=None
    rw_terms={'ibigori':'maize','ibishyimbo':'beans','imyumbati':'cassava','ibirayi':'potato','igitoki':'banana','umuceri':'rice','isuri':'soil erosion','ifumbire':'fertilizer','kuhira':'irrigation','gusaru':'harvest','kubika':'storage','igihembwe':'season','indwara':'plant disease','ikirere':'climate','amatungo':'livestock','NISR'.casefold():'nisr'}
    if body.language.upper() in ('RW','RW-RW','KIN','KINYARWANDA'):
        for local, english in rw_terms.items():
            if local in q: q += ' ' + english
        if 'cassava' in q and ('disease' in q or 'plant disease' in q): q += ' cassava mosaic'
    matches=[(key, text) for key, text in KNOWLEDGE if key in q]
    if matches:
        matched, answer=max(matches, key=lambda item: len(item[0]))
    if answer is None:
        answer='IREME can help with crop seasons, crop production, crop disease prevention, soil conservation, fertilizer, irrigation, harvest, storage, weather planning, livestock and agricultural survey indicators. Please specify the crop, district, season and problem for more useful guidance. For official statistics, consult the relevant NISR Seasonal Agricultural Survey report.'
        matched='general'
    if body.language.upper() in ('RW','RW-RW','KIN','KINYARWANDA'):
        answer=RW_ANSWERS.get(matched, 'IREME ishobora kugufasha ku bihe by’ihinga, umusaruro, indwara z’ibihingwa, kurwanya isuri, ifumbire, kuhira, gusarura no kubika umusaruro. Vuga igihingwa, akarere, igihembwe n’ikibazo kugira ngo ubone inama ifasha kurushaho.')
    with connect() as db: db.execute('INSERT INTO chat_logs(question,answer,language) VALUES(?,?,?)',(body.question,answer,body.language))
    return {'answer':answer,'topic':matched,'disclaimer':'General information only. Verify treatment and input decisions with a local agricultural professional.'}
@app.get('/api/teachable-machine/{asset}')
def proxy_teachable_machine_asset(asset: str):
    # Only proxy the fixed public model assets; never accept arbitrary upstream URLs.
    allowed = {'model.json', 'metadata.json', 'weights.bin', 'model.weights.bin', 'group1-shard1of1.bin'}
    # Teachable Machine manifests can name their weight shard differently. Permit only safe single filenames ending in .bin.
    if asset not in allowed and not (asset.endswith('.bin') and '/' not in asset and '\\' not in asset and '..' not in asset):
        raise HTTPException(404, 'Model asset not found')
    request = urllib.request.Request(TM_MODEL_BASE_URL + asset, headers={'User-Agent': 'IREME-Agriculture-App/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            content_type = response.headers.get('Content-Type', 'application/octet-stream')
    except urllib.error.HTTPError as exc:
        raise HTTPException(exc.code, 'Could not retrieve the configured Teachable Machine asset')
    except Exception:
        raise HTTPException(502, 'Teachable Machine model provider is unavailable')
    from fastapi.responses import Response
    return Response(content=raw, media_type=content_type, headers={'Cache-Control': 'public, max-age=300'})

@app.get('/api/settings/{key}', dependencies=[Depends(require_admin)])
def get_setting(key: str):
    with connect() as db: row=db.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()
    if not row: raise HTTPException(404,'Setting not found')
    return {'key':key,'value':row['value']}
@app.put('/api/settings/{key}', dependencies=[Depends(require_admin)])
def put_setting(key: str, body: SettingIn):
    with connect() as db: db.execute('INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP',(key,body.value))
    return {'key':key,'value':body.value}
@app.post('/api/scan-logs', status_code=201)
def log_scan(body: ScanLogIn):
    with connect() as db:
        cur=db.execute('INSERT INTO scan_logs(filename,prediction,confidence,model_url) VALUES(?,?,?,?)',(body.filename,body.prediction,body.confidence,body.model_url))
    return {'id':cur.lastrowid,'saved':True}
@app.get('/api/scan-logs', dependencies=[Depends(require_admin)])
def list_scan_logs(limit: int=Query(100, ge=1, le=1000)):
    with connect() as db: rows=[dict(r) for r in db.execute('SELECT * FROM scan_logs ORDER BY id DESC LIMIT ?',(limit,)).fetchall()]
    return {'items':rows,'count':len(rows)}
@app.get('/api/chat-logs', dependencies=[Depends(require_admin)])
def list_chat_logs(limit: int=Query(100, ge=1, le=1000)):
    with connect() as db: rows=[dict(r) for r in db.execute('SELECT * FROM chat_logs ORDER BY id DESC LIMIT ?',(limit,)).fetchall()]
    return {'items':rows,'count':len(rows)}


# ---------------------------------------------------------------------------------------------
# NISR-trained statistics and farm advisor (additive endpoints; nothing above is changed).
# Data comes from data/nisr_insights.json, built from the NISR AHS 2024 microdata by
# scripts/build_nisr_insights.py.
# ---------------------------------------------------------------------------------------------
from datetime import date as _date
from fastapi.responses import JSONResponse as _JSONResponse
from .nisr_advisor import load_insights as _nisr_load, advise as _nisr_advise, current_season as _nisr_season


def _nisr_or_503():
    ins = _nisr_load()
    if ins is None:
        raise HTTPException(503, 'NISR insights have not been built yet. Run scripts/build_nisr_insights.py')
    return ins


@app.get('/api/nisr/insights')
def nisr_insights():
    """Full trained insight file (yield statistics, practice effects, district context)."""
    return _JSONResponse(_nisr_or_503(), headers={'Cache-Control': 'public, max-age=3600'})


@app.get('/api/nisr/crops')
def nisr_crops():
    ins = _nisr_or_503()
    items = [{'crop': c, 'plots': n['n'], 'typical_yield_kg_ha': n['national']['median'],
              'average_yield_kg_ha': n['national']['avg'], 'advisor_model': 'model' in n}
             for c, n in ins['crops'].items()]
    items.sort(key=lambda r: -r['plots'])
    return {'items': items, 'count': len(items), 'districts': ins['meta']['districts'], 'source': ins['meta']['source']}


@app.get('/api/nisr/yields')
def nisr_yields(crop: str, season: Optional[str] = None):
    """Typical plot yield by district for one crop."""
    ins = _nisr_or_503()
    node = ins['crops'].get(crop)
    if not node: raise HTTPException(404, 'Crop not found in the NISR survey data')
    rows = [{'district': d, 'median_kg_ha': v['median'], 'plots': v['n']} for d, v in node['district'].items()]
    rows.sort(key=lambda r: -r['median_kg_ha'])
    return {'crop': crop, 'season': season, 'national': node['national'], 'districts': rows, 'source': ins['meta']['source']}


@app.get('/api/nisr/advice')
def nisr_advice(crop: str, district: Optional[str] = None, season: Optional[str] = None, area_ha: Optional[float] = Query(default=None, gt=0, le=1000),
                improved_seed: bool = False, inorganic: bool = False, organic: bool = False, pesticide: bool = False,
                irrigation: bool = False, anti_erosion: bool = False):
    """Expected yield range and ranked, evidence-labelled recommendations for a crop in a district."""
    ins = _nisr_or_503()
    if crop not in ins['crops']: raise HTTPException(404, 'Crop not found in the NISR survey data')
    if district and district not in ins['districts']: raise HTTPException(404, 'District not found in the NISR survey data')
    if season and season not in ('A', 'B', 'C'): raise HTTPException(422, 'season must be A, B or C')
    practices = {'improved_seed': improved_seed, 'inorganic': inorganic, 'organic': organic, 'pesticide': pesticide,
                 'irrigation': irrigation, 'anti_erosion': anti_erosion}
    return _nisr_advise(ins, crop, district, season or _nisr_season(_date.today().month), practices, area_ha)
