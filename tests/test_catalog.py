import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch,Mock
from catalog import Cache,parse_record,price_store,synchronize,storage_of
from scrapers import CatalogError

class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.cache=Cache(Path(self.tmp.name)/'db.sqlite')
        self.record=parse_record('iPeople',Path('tests/fixtures/ipeople_product.html').read_text(),'https://ipeople.ua/products/test')
    def tearDown(self):self.tmp.cleanup()
    def test_record(self):
        self.assertEqual(self.record['sim'],'physical');self.assertEqual(self.record['price'],'35799')
        self.assertEqual(storage_of('iPhone 16 1 TB'),'1TB')
    def test_cache_survives_restart_and_never_fetches(self):
        self.cache.replace_store('iPeople',[self.record])
        with patch('requests.Session.get',side_effect=AssertionError('must not fetch')):
            other=Cache(self.cache.path)
            self.assertEqual(other.records()[0]['price'],'35799')
            self.assertEqual(len(other.snapshot()['products']),1)
    def test_rate_persistence_and_user_isolation(self):
        self.cache.set_rate(1,'42,5');self.cache.set_rate(2,'45')
        self.assertEqual(Cache(self.cache.path).get_rate(1),'42.5');self.assertEqual(self.cache.get_rate(2),'45')
        with self.assertRaises(ValueError):self.cache.set_rate(1,'NaN')
    def test_full_replace_preserves_historical_prices(self):
        self.cache.replace_store('iPeople',[self.record]);other={**self.record,'store':'Jabko','url':'https://jabko.ua/product/test'}
        self.cache.replace_store('Jabko',[other]);self.cache.replace_store('iPeople',[])
        self.assertEqual(self.cache.records('iPeople')[0]['price'],'35799')
        self.assertEqual(self.cache.records('iPeople')[0]['status'],'unavailable')
        self.assertEqual(self.cache.records('Jabko')[0]['price'],other['price'])
    def test_prices_do_not_change_identity(self):
        self.cache.replace_store('iPeople',[self.record]);self.cache.prices('iPeople',[{**self.record,'model':'WRONG','price':'40000'}])
        record=self.cache.records()[0];self.assertEqual(record['model'],'15');self.assertEqual(record['price'],'40000')
    def test_failure_preserves_models_but_hides_prices(self):
        self.cache.replace_store('iPeople',[self.record]);self.cache.fail_store('iPeople','http_403')
        record=self.cache.records()[0];self.assertEqual(record['model'],'15');self.assertEqual(record['status'],'error')
    @patch('catalog.Client')
    def test_prices_only_visit_known_url(self,client):
        client.return_value.__enter__.return_value.get.return_value=Path('tests/fixtures/ipeople_product.html').read_text()
        result=price_store('iPeople',[self.record])
        client.return_value.__enter__.return_value.get.assert_called_once_with(self.record['url'])
        self.assertEqual(result[0]['price'],'35799')
    @patch('catalog.full_store')
    def test_partial_update(self,full):
        self.cache.replace_store('Jabko',[{**self.record,'store':'Jabko','url':'https://jabko.ua/product/test'}])
        full.side_effect=lambda store,progress:[self.record] if store=='iPeople' else (_ for _ in ()).throw(CatalogError('http_403'))
        result=synchronize(self.cache,'catalog')
        self.assertEqual(result['status'],'partial');self.assertEqual(self.cache.records('Jabko')[0]['status'],'error')

class SwatchEncodingTests(unittest.TestCase):
    def test_double_encoded_unicode(self):
        from scrapers import swatch_data
        import json
        result=swatch_data(json.dumps({'stock_status_name':r'\u0412 \u043d\u0430\u044f\u0432\u043d\u043e\u0441\u0442\u0456','price_uah':r'35799 \u0433\u0440\u043d'}))
        self.assertEqual(result['stock_status_name'],'В наявності');self.assertEqual(result['price_uah'],'35799 грн')

class StockTests(unittest.TestCase):
    def test_verified_low_stock(self):
        html=Path('tests/fixtures/jabko_low_stock.html').read_text()
        record=parse_record('Jabko',html,'https://jabko.ua/iphone/apple-iphone-16/apple-iphone-16-128gb-white')
        self.assertEqual(record['status'],'ok');self.assertEqual(record['price'],'40399')
    def test_preorder_not_in_stock(self):
        html=Path('tests/fixtures/ipeople_product.html').read_text().replace('В наявності','Під замовлення')
        record=parse_record('iPeople',html,'https://ipeople.ua/products/test')
        self.assertEqual(record['status'],'preorder');self.assertEqual(record['price'],'35799')

class SnapshotTests(unittest.TestCase):
    def test_restore_preserves_timestamps_and_does_not_import_user_rates(self):
        import json
        with tempfile.TemporaryDirectory() as tmp:
            source=Cache(Path(tmp)/'source.sqlite')
            record=parse_record('iPeople',Path('tests/fixtures/ipeople_product.html').read_text(),'https://ipeople.ua/products/test')
            source.replace_store('iPeople',[record]);source.set_rate('private-user',42)
            dump=Path(tmp)/'snapshot.json';dump.write_text(json.dumps(source.snapshot()))
            restored=Cache(Path(tmp)/'restored.sqlite')
            with patch('requests.Session.get',side_effect=AssertionError('No network')):restored.restore_snapshot(dump)
            self.assertEqual(restored.records(),source.records());self.assertEqual(restored.snapshot()['stores'],source.snapshot()['stores'])
            self.assertIsNone(restored.get_rate('private-user'))

class PriceFailureTests(unittest.TestCase):
    @patch('catalog.Client')
    def test_one_failed_url_preserves_successful_prices(self,client):
        html=Path('tests/fixtures/ipeople_product.html').read_text()
        record=parse_record('iPeople',html,'https://ipeople.ua/products/first')
        other={**record,'url':'https://ipeople.ua/products/second'}
        client.return_value.__enter__.return_value.get.side_effect=[html,CatalogError('network_error')]
        records=price_store('iPeople',[record,other])
        self.assertEqual(records[0]['status'],'ok');self.assertEqual(records[0]['price'],'35799')
        self.assertEqual(records[1]['status'],'error');self.assertEqual(records[1]['price'],'35799');self.assertEqual(records[1]['last_success_at'],other['checked_at'])
        self.assertEqual(records.errors,['network_error'])
    @patch('catalog.Client')
    def test_404_is_not_a_fabricated_price(self,client):
        record=parse_record('iPeople',Path('tests/fixtures/ipeople_product.html').read_text(),'https://ipeople.ua/products/gone')
        client.return_value.__enter__.return_value.get.side_effect=CatalogError('http_404')
        result=price_store('iPeople',[record])
        self.assertEqual(result[0]['status'],'unavailable');self.assertEqual(result[0]['price'],'35799');self.assertEqual(result[0]['last_success_at'],record['checked_at'])

class NewCardTests(unittest.TestCase):
    def test_jabko18_without_condition_picker(self):
        html=Path('tests/fixtures/jabko18_product.html').read_text()
        url='https://jabko.ua/product/apple-iphone-18-pro-256gb-burgundy'
        p=parse_record('Jabko',html,url)
        self.assertEqual((p['model'],p['sim'],p['price']),('18 Pro','physical','79999'))
        self.assertIsNone(parse_record('Jabko',html.replace('Apple iPhone 18 Pro', 'Apple iPhone 18 Pro (Як Новий)'),url))
    def test_schema_identity_required(self):
        html=Path('tests/fixtures/jabko18_product.html').read_text()
        from bs4 import BeautifulSoup
        soup=BeautifulSoup(html,'html.parser')
        for x in soup.select('script'):x.decompose()
        self.assertIsNone(parse_record('Jabko',str(soup),'https://jabko.ua/product/test'))


class LastPriceTests(CatalogTests):
    def test_null_observation_preserves_price_and_verification_time(self):
        self.cache.replace_store('iPeople',[self.record])
        self.cache.prices('iPeople',[{**self.record,'price':None,'status':'error','checked_at':'2030-01-01T00:00:00Z'}])
        p=self.cache.records()[0]
        self.assertEqual(p['price'],'35799')
        self.assertEqual(p['last_success_at'],self.record['checked_at'])
        self.assertEqual(p['status'],'error')
        self.assertEqual(p['checked_at'],'2030-01-01T00:00:00Z')
    def test_full_catalog_does_not_reuse_wrong_identity_price(self):
        self.cache.replace_store('iPeople',[self.record])
        changed={**self.record,'model':'18 Pro Max','price':None,'status':'error'}
        self.cache.replace_store('iPeople',[changed])
        self.assertIsNone(self.cache.records()[0]['price'])
    def test_alias_limited_to_verified_family(self):
        from scrapers import canonical_color
        self.assertEqual(canonical_color('18 Pro Max','Glacier'),'Glacier Blue')
        self.assertEqual(canonical_color('18 Pro','Glacier'),'Glacier Blue')
        self.assertEqual(canonical_color('17','Glacier'),'Glacier')

class PriceRetryTests(unittest.TestCase):
    def setUp(self):
        self.html=Path('tests/fixtures/ipeople_product.html').read_text()
        self.url='https://ipeople.ua/products/test'
        self.old=parse_record('iPeople',self.html,self.url)
    @patch('catalog.time.sleep')
    def test_missing_price_recovers_on_retry(self,sleep):
        from catalog import read_record
        client=Mock();client.get.side_effect=[self.html.replace('35 799 грн.','????'),self.html]
        _,p=read_record(client,'iPeople',self.url,self.old)
        self.assertEqual(p['price'],'35799');self.assertEqual(client.get.call_count,2)
        sleep.assert_called_once_with(2)
    @patch('catalog.time.sleep')
    def test_incomplete_card_retries_twice_only(self,sleep):
        from catalog import read_record
        client=Mock();client.get.return_value=self.html.replace('35 799 грн.','????')
        _,p=read_record(client,'iPeople',self.url,self.old)
        self.assertIsNone(p['price']);self.assertEqual(client.get.call_count,3)
        self.assertEqual([x.args[0] for x in sleep.call_args_list],[2,4])
    @patch('catalog.time.sleep')
    def test_explicit_absence_does_not_retry(self,sleep):
        from catalog import read_record
        client=Mock();client.get.return_value=self.html.replace('В наявності','Немає в наявності')
        _,p=read_record(client,'iPeople',self.url,self.old)
        self.assertEqual(p['status'],'unavailable');self.assertEqual(client.get.call_count,1);sleep.assert_not_called()
    @patch('catalog.time.sleep')
    def test_wrong_variant_is_not_retried(self,sleep):
        from catalog import read_record
        client=Mock();client.get.return_value=self.html
        read_record(client,'iPeople',self.url,{**self.old,'sim':'esim'})
        self.assertEqual(client.get.call_count,1);sleep.assert_not_called()
    @patch('catalog.time.sleep')
    def test_block_and_404_never_retry_at_card_level(self,sleep):
        from catalog import read_record
        for reason in ('http_403','http_429','http_404','robots_denied','request_budget','network_error'):
            client=Mock();client.get.side_effect=CatalogError(reason)
            with self.assertRaises(CatalogError):read_record(client,'iPeople',self.url,self.old)
            self.assertEqual(client.get.call_count,1)
        sleep.assert_not_called()

class ProductNameTests(unittest.TestCase):
    def test_part_number_from_ipeople_heading(self):
        html=Path('tests/fixtures/ipeople_product.html').read_text()
        p=parse_record('iPeople',html,'https://ipeople.ua/products/test')
        self.assertEqual(p['full_title'],'iPhone 15 128GB Black (MTP03)')
        self.assertEqual(p['sku'],'MTP03')
    def test_part_number_from_matching_jabko_schema(self):
        html=Path('tests/fixtures/jabko18_product.html').read_text()
        p=parse_record('Jabko',html,'https://jabko.ua/product/apple-iphone-18-pro-256gb-burgundy')
        self.assertEqual(p['sku'],'MJRR4')
        self.assertEqual(p['full_title'],'Apple iPhone 18 Pro 256GB (Burgundy)')
    def test_names_survive_price_only_refresh_and_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=Cache(Path(tmp)/'db.sqlite')
            p=parse_record('iPeople',Path('tests/fixtures/ipeople_product.html').read_text(),'https://ipeople.ua/products/test')
            c.replace_store('iPeople',[p]);c.prices('iPeople',[{**p,'price':None,'status':'error'}])
            other=Cache(c.path).records()[0]
            self.assertEqual(other['sku'],'MTP03');self.assertEqual(other['full_title'],p['full_title'])

class MultiPartNumberTests(unittest.TestCase):
    def test_keep_all_codes_and_repair_missing_bracket(self):
        from catalog import product_name
        from bs4 import BeautifulSoup
        s=BeautifulSoup('','html.parser')
        title='Apple iPhone 17 Air 256GB Light Gold (MG2N4, MG1A4, MG294)'
        full,sku=product_name(s,title)
        self.assertEqual(full,title);self.assertEqual(sku,'MG2N4, MG1A4, MG294')
        full,sku=product_name(s,'Apple iPhone 17 Pro Max 2TB eSIM Deep Blue (MFXU4')
        self.assertEqual(sku,'MFXU4');self.assertTrue(full.endswith('(MFXU4)'))
