import asyncio
import logging
import os
from pathlib import Path
from decimal import Decimal, InvalidOperation
from html import escape
from dotenv import load_dotenv
from telegram import Update, ReplyKeyboardMarkup, ReplyKeyboardRemove, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, MenuButtonWebApp
from telegram.ext import Application, CommandHandler, ConversationHandler, MessageHandler, ContextTypes, filters
from scrapers import CatalogError, MODELS, STORAGES, fetch_jabko, fetch_ipeople, render

RATE, MODEL, STORAGE, SIM = range(4)
log = logging.getLogger(__name__)

class SecretFilter(logging.Filter):
    def __init__(self, token):
        super().__init__()
        self.token = token
    def filter(self, record):
        message = record.getMessage()
        if self.token:
            message = message.replace(self.token, '[REDACTED]')
        import re
        record.msg = re.sub(r'bot\d+:[A-Za-z0-9_-]+', 'bot[REDACTED]', message)
        record.args = ()
        # Exception tracebacks can contain authenticated request URLs.
        record.exc_info = None
        record.exc_text = None
        return True

def configure_logging(token):
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    for handler in logging.getLogger().handlers:
        handler.addFilter(SecretFilter(token))
    for name in ('httpx', 'httpcore', 'telegram'):
        logging.getLogger(name).setLevel(logging.WARNING)
    logging.getLogger('telegram.ext.Application').setLevel(logging.INFO)

async def ready(application):
    log.info("Telegram authenticated: @%s", application.bot.username)
    url=os.getenv('MINIAPP_URL','').strip()
    if url and os.getenv('ENABLE_MINIAPP')=='1':
        await application.bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text='Открыть приложение',web_app=WebAppInfo(url=url)))
        log.info('Mini App menu configured')

async def error_handler(update, context):
    if update is None:
        log.warning('Telegram polling error: %s', type(context.error).__name__)
        return
    log.error('Telegram handler failed: %s', type(context.error).__name__)
    if update and update.effective_message:
        try:
            await update.effective_message.reply_text('Ошибка обработки. Повторите /start.')
        except Exception:
            log.warning('Could not deliver error notification')


def keyboard(items,columns=3):
    return ReplyKeyboardMarkup([items[i:i+columns] for i in range(0,len(items),columns)],resize_keyboard=True)

async def start(update:Update,context:ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    await update.message.reply_text('Курс доллара (грн за $1)? Например: 42.5',reply_markup=ReplyKeyboardRemove())
    return RATE

async def rate_step(update,context):
    try:
        rate=Decimal(update.message.text.strip().replace(',','.'))
        if not rate.is_finite() or not 1 <= rate <= 1000: raise ValueError()
    except (ValueError, InvalidOperation):
        await update.message.reply_text('Введите положительный курс, например 42.5')
        return RATE
    context.user_data['rate']=rate
    await update.message.reply_text('Модель iPhone:',reply_markup=keyboard(MODELS,3))
    return MODEL

async def model_step(update,context):
    value=update.message.text.strip()
    if value not in MODELS:
        await update.message.reply_text('Выберите модель кнопкой.')
        return MODEL
    context.user_data['model']=value
    await update.message.reply_text('Память:',reply_markup=keyboard(STORAGES,3))
    return STORAGE

async def storage_step(update,context):
    value=update.message.text.strip().upper()
    if value not in STORAGES:
        await update.message.reply_text('Выберите объём памяти кнопкой.')
        return STORAGE
    context.user_data['storage']=value
    await update.message.reply_text('Тип SIM:',reply_markup=keyboard(['eSIM','Обычная SIM'],2))
    return SIM

async def sim_step(update,context):
    if update.message.text not in ('eSIM','Обычная SIM'):
        await update.message.reply_text('Выберите тип SIM кнопкой.')
        return SIM
    sim='esim' if update.message.text=='eSIM' else 'physical'
    model=context.user_data['model']; storage=context.user_data['storage'];rate=context.user_data['rate']
    jobs=[asyncio.to_thread(fetch_ipeople,model,storage,sim),asyncio.to_thread(fetch_jabko,model,storage,sim)]
    results=await asyncio.gather(*jobs,return_exceptions=True)
    offers=[]; errors=[]
    for name,result in zip(('iPeople','Jabko'),results):
        if isinstance(result,Exception):
            log.warning('%s catalog failed: %s',name,str(result) if isinstance(result,CatalogError) else type(result).__name__)
            errors.append(name)
        else: offers.extend(result)
    result=render(model,storage,sim,rate,offers,errors)
    # Telegram message limit 4096 chars; split at line boundaries.
    chunk=''
    for line in result.splitlines():
        if len(chunk)+len(line)+1>3800:
            await update.message.reply_text('<pre>'+escape(chunk)+'</pre>',parse_mode='HTML')
            chunk=''
        chunk+=line+'\n'
    if chunk: await update.message.reply_text('<pre>'+escape(chunk.rstrip())+'</pre>',parse_mode='HTML',reply_markup=ReplyKeyboardRemove())
    log.info('Comparison delivered: %s %s %s; confirmed offers=%s', model, storage, sim, len(offers))
    return ConversationHandler.END

async def cancel(update,context):
    await update.message.reply_text('Отменено.',reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END

async def mini_start(update,context):
    url=os.getenv('MINIAPP_URL','').strip()
    await update.message.reply_text('iPhone Compare',reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton('Открыть приложение',web_app=WebAppInfo(url=url))]]))

def main():
    load_dotenv(Path(__file__).with_name('.env'))
    token=os.getenv('TELEGRAM_BOT_TOKEN','').strip()
    if not token or token=='PASTE_NEW_TOKEN_HERE':
        raise SystemExit('Set TELEGRAM_BOT_TOKEN in .env (see .env.example)')
    configure_logging(token)
    app=(Application.builder().token(token).concurrent_updates(False)
         .connect_timeout(10).read_timeout(30).write_timeout(30).pool_timeout(15)
         .get_updates_connect_timeout(10).get_updates_read_timeout(30)
         .get_updates_write_timeout(30).get_updates_pool_timeout(15)
         .post_init(ready).build())
    app.add_error_handler(error_handler)
    flow=ConversationHandler(entry_points=[CommandHandler('start',start)],states={
        RATE:[MessageHandler(filters.TEXT & ~filters.COMMAND,rate_step)],
        MODEL:[MessageHandler(filters.TEXT & ~filters.COMMAND,model_step)],
        STORAGE:[MessageHandler(filters.TEXT & ~filters.COMMAND,storage_step)],
        SIM:[MessageHandler(filters.TEXT & ~filters.COMMAND,sim_step)]},
        fallbacks=[CommandHandler('cancel',cancel)],allow_reentry=True)
    if os.getenv('ENABLE_MINIAPP')=='1':
        from urllib.parse import urlsplit
        if urlsplit(os.getenv('MINIAPP_URL','')).scheme!='https':
            raise SystemExit('MINIAPP_URL must be HTTPS')
        app.add_handler(CommandHandler('start',mini_start))
        app.add_handler(CommandHandler('app',mini_start))
    else:
        app.add_handler(flow)
    try:
        app.run_polling(drop_pending_updates=False)
    except Exception as exc:
        log.error('Telegram startup failed: %s', type(exc).__name__)
        raise SystemExit('Telegram startup failed; check token and network access.') from None

if __name__=='__main__':
    try:
        main()
    except Exception as exc:
        log.error('Startup failed: %s', type(exc).__name__)
        raise SystemExit('Startup failed; check dependencies and network access.') from None
