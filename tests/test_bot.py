import unittest
import logging
from decimal import Decimal
from unittest.mock import AsyncMock, Mock
import bot

class BotTests(unittest.IsolatedAsyncioTestCase):
    def setup_message(self,text):
        return Mock(message=Mock(text=text,reply_text=AsyncMock())),Mock(user_data={})
    async def test_invalid_rates(self):
        for rate in ['NaN','Infinity','0','abc']:
            u,c=self.setup_message(rate)
            self.assertEqual(await bot.rate_step(u,c),bot.RATE)
            self.assertNotIn('rate',c.user_data)
    async def test_flow(self):
        u,c=self.setup_message('42,5')
        self.assertEqual(await bot.rate_step(u,c),bot.MODEL)
        self.assertEqual(c.user_data['rate'],Decimal('42.5'))
        u.message.text='16 Pro';self.assertEqual(await bot.model_step(u,c),bot.STORAGE)
        u.message.text='256GB';self.assertEqual(await bot.storage_step(u,c),bot.SIM)
    async def test_failed_stores_compact_table(self):
        from unittest.mock import patch
        from scrapers import CatalogError
        u,c=self.setup_message('eSIM');c.user_data={'model':'16 Pro','storage':'256GB','rate':Decimal(42)}
        with patch('bot.fetch_ipeople',side_effect=CatalogError('network_error')),patch('bot.fetch_jabko',side_effect=CatalogError('http_403')):
            self.assertEqual(await bot.sim_step(u,c),bot.ConversationHandler.END)
        text=u.message.reply_text.call_args.args[0]
        self.assertIn('iPeople | Jabko',text);self.assertNotIn('http_',text)
    async def test_secret_filter(self):
        record=logging.LogRecord('httpx',20,'',0,'POST /bot%s/getMe',('123:FAKE_TOKEN',),None)
        bot.SecretFilter('123:FAKE_TOKEN').filter(record)
        self.assertNotIn('FAKE_TOKEN',record.getMessage())
        record=logging.LogRecord('x',40,'',0,'Error',(),(Exception,Exception('secret'),None))
        bot.SecretFilter('secret').filter(record);self.assertIsNone(record.exc_info)
