from fastapi.testclient import TestClient
from app.main import app
client=TestClient(app)
def test_health():
    r=client.get('/api/health');assert r.status_code==200;assert r.json()['status']=='ok'
def test_dashboard():
    r=client.get('/api/dashboard');assert r.status_code==200;assert 'health' in r.json()
def test_statistics():
    r=client.get('/api/statistics');assert r.status_code==200;assert r.json()['total']>0
def test_login_remember_keeps_device_signed_in_longer():
    import os
    pw=os.getenv('IREME_ADMIN_PASSWORD','123')
    short=client.post('/api/auth/login',json={'password':pw}).json()
    long=client.post('/api/auth/login',json={'password':pw,'remember':True}).json()
    assert short['expires_in']==8*3600 and long['expires_in']==30*24*3600
    assert client.get('/api/auth/me',headers={'Authorization':'Bearer '+long['access_token']}).json()['role']=='admin'
    assert client.get('/api/auth/me').status_code==401
