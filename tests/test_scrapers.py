import logging
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import Mock, patch
import requests
import scrapers as s

class MatchingTests(unittest.TestCase):
    def test_models(self):
        for model in s.MODELS:
            with self.subTest(model=model): self.assertTrue(s.model_ok('Apple iPhone '+model+' 256GB Black',model))
        self.assertFalse(s.model_ok('iPhone 16 Pro Max 256GB','16 Pro'))
        self.assertFalse(s.model_ok('iPhone 16 Pro 256GB','16'))
        self.assertFalse(s.model_ok('iPhone 16e 128GB','16'))
    def test_storage(self):
        self.assertTrue(s.storage_ok('iPhone 16 256 GB','256GB'))
        self.assertFalse(s.storage_ok('iPhone 16 1256GB','256GB'))
        self.assertTrue(s.storage_ok('iPhone 16 1 ТБ','1TB'))
    def test_sim(self):
        self.assertIsNone(s.sim_type('iPhone 16 Black'))
        self.assertFalse(s.sim_ok('iPhone 16 Black','physical'))
        self.assertEqual(s.sim_type('Nano-SIM + eSIM'),'physical')
        self.assertEqual(s.sim_type('2 e-SIM'),'esim')
    def test_condition(self):
        for title in ['б/у iPhone','iPhone (Як Новий)','refurbished iPhone','iPhone Ultra']:
            self.assertFalse(s.new_product(title))
    def test_color(self):
        self.assertEqual(s.color_of('iPhone 16 Pro (Black Titanium) (MYNH3)'),'Black Titanium')
        self.assertNotEqual(s.color_of('Black Titanium'),s.color_of('Black'))
        self.assertIsNone(s.color_of('iPhone 16 Pro (MYNH3)'))
        self.assertEqual(s.color_of('iPhone 17 256GB Mist Blue'),'Mist Blue')
        self.assertIsNone(s.color_of('iPhone 17 256GB Unknown Blue'))
    def test_prices(self):
        self.assertEqual(s.price_from_text('35\u202f799 грн.'),Decimal('35799'))
        self.assertEqual(s.price_from_text('35799,50 грн'),Decimal('35799.50'))
        self.assertIsNone(s.price_from_text('40000 грн 35000 грн'))
        self.assertIsNone(s.money('NaN'))
        self.assertIsNone(s.price_from_text('SKU 35799'))
    def test_render(self):
        a=s.Offer('iPeople','Black',Decimal(42000),'https://ipeople.ua/p','16','256GB','physical')
        b=s.Offer('Jabko','Black',Decimal(43000),'https://jabko.ua/p','16 Pro','256GB','physical')
        self.assertEqual(s.render('16','256GB','physical',42,[a,b]),'16 256GB Black\niPeople | Jabko\n  42000 |       —\n  $1000 |       —')
        self.assertNotIn('Недоступно',s.render('16','256GB','physical',42,[],['Jabko']))
    def test_rate(self):
        for rate in ['NaN','Infinity','0','-1']:
            with self.assertRaises(ValueError): s.render('16','256GB','esim',rate,[])

class RealFixtureTests(unittest.TestCase):
    def test_live_ipeople_snapshot(self):
        html=Path('tests/fixtures/ipeople_product.html').read_text()
        offer=s.product_ipeople(html,'https://ipeople.ua/products/test','15','128GB','physical')
        self.assertEqual(offer.color,'Black');self.assertEqual(offer.price,35799)
        self.assertIsNone(s.product_ipeople(html,'https://ipeople.ua/products/test','15','128GB','esim'))
        self.assertIsNone(s.product_ipeople(html,'https://ipeople.ua/products/test','15 Pro','128GB','physical'))
    def test_no_stock_or_price(self):
        html=Path('tests/fixtures/ipeople_product.html').read_text()
        self.assertIsNone(s.product_ipeople(html.replace('В наявності','Немає в наявності'),'https://ipeople.ua/p','15','128GB','physical'))
        self.assertIsNone(s.product_ipeople(html.replace('35 799 грн.','????'),'https://ipeople.ua/p','15','128GB','physical'))

class NetworkTests(unittest.TestCase):
    def response(self,status=200,text='',location=None):
        r=Mock(status_code=status,text=text,content=text.encode(),headers={'Location':location} if location else {})
        return r
    def test_robots_real(self):
        rules,_=s.robots_rules(Path('tests/fixtures/ipeople_robots.txt').read_text())
        self.assertFalse(s.permitted('https://ipeople.ua/index.php?route=product/search&search=iphone',rules))
        self.assertTrue(s.permitted('https://ipeople.ua/apple-ua/iphone/',rules))
    def test_allow_precedence(self):
        rules,delay=s.robots_rules('User-agent: *\nDisallow: /private/*\nAllow: /private/public$\nCrawl-delay: 2')
        self.assertFalse(s.permitted('https://ipeople.ua/private/a',rules))
        self.assertTrue(s.permitted('https://ipeople.ua/private/public',rules));self.assertEqual(delay,2)
    def test_specific_robot_group(self):
        rules,_=s.robots_rules('User-agent: *\nDisallow: /\nUser-agent: PriceComparisonBot\nAllow: /')
        self.assertTrue(s.permitted('https://ipeople.ua/a',rules))
    @patch('scrapers.time.sleep')
    def test_timeout_retry(self,_):
        c=s.Client('iPeople');c.session.get=Mock(side_effect=requests.Timeout)
        with self.assertRaisesRegex(s.CatalogError,'network_error'): c.get('https://ipeople.ua/a')
        self.assertEqual(c.session.get.call_count,3);c.session.close()
    @patch('scrapers.time.sleep')
    def test_no_retry_block(self,_):
        c=s.Client('Jabko');c.session.get=Mock(return_value=self.response(403))
        with self.assertRaisesRegex(s.CatalogError,'http_403'): c.get('https://jabko.ua/a')
        self.assertEqual(c.session.get.call_count,1);c.session.close()
    @patch('scrapers.time.sleep')
    def test_redirect_restrictions(self,_):
        c=s.Client('iPeople');c.rules=[('disallow','/secret')]
        c.session.get=Mock(return_value=self.response(302,location='/secret'))
        with self.assertRaisesRegex(s.CatalogError,'robots_denied'): c.get('https://ipeople.ua/a')
        c.session.get=Mock(return_value=self.response(302,location='https://evil.test/p'))
        with self.assertRaisesRegex(s.CatalogError,'foreign_url'): c.get('https://ipeople.ua/a')
        c.session.close()
    @patch('scrapers.time.sleep')
    def test_unavailable_robots_closes_session(self,_):
        c=s.Client('Jabko');c.session.get=Mock(return_value=self.response(403));c.session.close=Mock()
        with self.assertRaises(s.CatalogError): c.__enter__()
        c.session.close.assert_called_once()


class JabkoFixtureTests(unittest.TestCase):
    def test_selected_sim_and_current_price(self):
        html=Path('tests/fixtures/jabko_product.html').read_text()
        offer=s.product_jabko(html,'https://jabko.ua/product/apple-iphone-17-256gb-white','17','256GB','physical')
        self.assertEqual(offer.price,45599);self.assertEqual(offer.color,'White')
        self.assertIsNone(s.product_jabko(html,'https://jabko.ua/product/apple-iphone-17-256gb-white','17','256GB','esim'))
    def test_swatches_cannot_supply_other_variant_price(self):
        html=Path('tests/fixtures/jabko_product.html').read_text()
        html=html.replace('45 599 грн','44 999 грн',1)
        self.assertIsNone(s.product_jabko(html,'https://jabko.ua/product/apple-iphone-17-256gb-white','17','256GB','physical'))


class AdditionalRegressionTests(unittest.TestCase):
    def test_precise_identity(self):
        offers=[s.Offer('iPeople','White',Decimal(40000),'https://ipeople.ua/'+str(i),*identity) for i,identity in enumerate([('16','128GB','esim'),('16','256GB','esim'),('16','128GB','physical'),('16 Pro','128GB','esim')])]
        self.assertEqual(len(s.compare_rows(offers)),4)
    def test_current_price_ignores_old_and_discount(self):
        html=Path('tests/fixtures/jabko_product.html').read_text()
        html+='<span class="price-old__uah">48 849 грн</span><span class="price-new__uah-discount">-3 250 грн</span>'
        self.assertEqual(s.product_jabko(html,'https://jabko.ua/product/apple-iphone-17-256gb-white','17','256GB','physical').price,45599)
    def test_jabko_condition_verified(self):
        html=Path('tests/fixtures/jabko_product.html').read_text().replace('data-label="Новий"','data-label="Як Новий"')
        self.assertIsNone(s.product_jabko(html,'https://jabko.ua/product/apple-iphone-17-256gb-white','17','256GB','physical'))
    def test_jabko_out_of_stock(self):
        html=Path('tests/fixtures/jabko_product.html').read_text().replace('В наявності','Немає в наявності').replace('\\u0412 \\u043d\\u0430\\u044f\\u0432\\u043d\\u043e\\u0441\\u0442\\u0456','Немає в наявності')
        self.assertIsNone(s.product_jabko(html,'https://jabko.ua/product/apple-iphone-17-256gb-white','17','256GB','physical'))

if __name__=='__main__': unittest.main()

class RetryRecoveryTests(NetworkTests):
    @patch('scrapers.time.sleep')
    def test_transient_server_failure_recovers(self,sleep):
        c=s.Client('iPeople');c.session.get=Mock(side_effect=[self.response(503),self.response(200)])
        c.get('https://ipeople.ua/a')
        self.assertEqual(c.session.get.call_count,2)
        self.assertIn(2,[x.args[0] for x in sleep.call_args_list]);c.session.close()
    @patch('scrapers.time.sleep')
    def test_rate_limit_never_retried(self,sleep):
        c=s.Client('Jabko');c.session.get=Mock(return_value=self.response(429))
        with self.assertRaisesRegex(s.CatalogError,'http_429'):c.get('https://jabko.ua/a')
        self.assertEqual(c.session.get.call_count,1);c.session.close()
