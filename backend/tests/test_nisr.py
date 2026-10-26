"""Tests for the NISR advisor. The pure-module tests need no web framework; endpoint tests need fastapi."""
import pytest
from app import nisr_advisor as na


@pytest.fixture(scope='module')
def ins():
    data = na.load_insights()
    assert data is not None, 'run scripts/build_nisr_insights.py first'
    return data


def test_crops_and_models(ins):
    assert 'Maize' in ins['crops'] and 'model' in ins['crops']['Maize']
    assert len(ins['meta']['districts']) == 30


def test_yield_is_close_to_published_nisr(ins):
    # NISR published Season A 2024 maize ~2.0 t/ha and beans 709 kg/ha; microdata ratio-of-totals should be close.
    assert 1800 <= ins['crops']['Maize']['season']['A']['avg'] <= 2400
    assert 600 <= ins['crops']['Bush bean']['season']['A']['avg'] <= 950


def test_inputs_raise_expected_yield(ins):
    base = na.predict_yield(ins, 'Maize', 'Musanze', 'A', {})
    better = na.predict_yield(ins, 'Maize', 'Musanze', 'A', {'improved_seed': True, 'inorganic': True})
    assert better['median'] > base['median'] * 1.3
    assert base['low'] < base['median'] < base['high']


def test_area_only_scales_totals(ins):
    a = na.predict_yield(ins, 'Maize', 'Huye', 'A', {}, area_ha=2)
    b = na.predict_yield(ins, 'Maize', 'Huye', 'A', {})
    assert a['median'] == pytest.approx(b['median'])
    assert a['total']['median'] == pytest.approx(2 * b['median'])


def test_advice_does_not_repeat_used_practices(ins):
    adv = na.advise(ins, 'Maize', 'Musanze', 'A', {'improved_seed': True})
    assert 'improved_seed' not in [r['key'] for r in adv['recommendations']]
    assert adv['recommendations'], 'maize should have at least one supported recommendation'


def test_unmodelled_crop_still_gets_benchmarks(ins):
    adv = na.advise(ins, 'Onion', None, 'A', {})
    assert adv['benchmarks']['national']['median'] > 0 and adv['recommendations'] == []


def test_endpoints():
    pytest.importorskip('fastapi'); pytest.importorskip('httpx')
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)
    assert c.get('/api/nisr/crops').json()['count'] >= 10
    r = c.get('/api/nisr/advice', params={'crop': 'Maize', 'district': 'Musanze', 'season': 'A', 'area_ha': 0.5})
    assert r.status_code == 200 and r.json()['expected']['total']['median'] > 0
    assert c.get('/api/nisr/advice', params={'crop': 'Nope'}).status_code == 404
    assert c.get('/api/nisr/yields', params={'crop': 'Maize'}).json()['districts']
