"""Persistent phone cache and explicit updates; comparison never visits stores."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
import json
import logging
import os
import re
import sqlite3
import threading
import time
from urllib.parse import urljoin, urlsplit
from bs4 import BeautifulSoup
from scrapers import (Client, CatalogError, HOSTS, LOCKS, model_of, model_ok,
                      storage_ok, new_product, normalized, color_of, sim_type,
                      product_ipeople, product_jabko, swatch_data, jabko_new, canonical_color)

log=logging.getLogger(__name__)

def now(): return datetime.now(timezone.utc).isoformat()

def storage_of(title):
    m=re.search(r'(?<!\w)(\d+)\s*(GB|TB|ГБ|ТБ)\b',title,re.I)
    if not m:return None
    return m.group(1)+m.group(2).upper().replace('ГБ','GB').replace('ТБ','TB')


def product_name(soup,title):
    # Apple part number in the exact heading or matching product schema only.
    groups=re.findall(r'\(([^)]*)(?:\)|$)',title)
    codes=[g for g in groups if re.fullmatch(r'[A-Z0-9]{5,12}(?:/[A-Z])?(?:\s*[,/|]\s*[A-Z0-9]{5,12}(?:/[A-Z])?)*',g)]
    sku=codes[-1] if codes else None
    for script in soup.select('script[type="application/ld+json"]'):
        try:data=json.loads(script.get_text())
        except ValueError:continue
        if not isinstance(data,dict) or data.get('@type')!='Product':continue
        if normalized(data.get('name',''))!=title:continue
        value=next((str(data.get(k,'')) for k in ('model','sku') if re.fullmatch(r'[A-Z0-9]{5,12}(?:/[A-Z])?',str(data.get(k,''))) and any(c.isalpha() for c in str(data.get(k,'')))), '')
        if re.fullmatch(r'[A-Z0-9]{5,12}(?:/[A-Z])?',value) and any(c.isalpha() for c in value):
            if sku and value not in re.split(r'\s*[,|]\s*',sku):return title,None
            sku=value
    if not sku:
        for link in soup.select('a.crosslink.activ[data-swatch]'):
            try:swatch=swatch_data(link['data-swatch'])
            except ValueError:continue
            value=str(swatch.get('model',''))
            if normalized(swatch.get('name',''))==title and re.fullmatch(r'[A-Z0-9]{5,12}(?:/[A-Z])?',value) and any(c.isalpha() for c in value):sku=value
    full_title=title+')' if title.count('(')==title.count(')')+1 and sku else title
    return full_title,sku


def parse_record(store,html,url):
    """Keep verified identity even when sold out; never infer missing SIM."""
    soup=BeautifulSoup(html,'html.parser')
    heading=soup.select_one('h1.product-info__title' if store=='Jabko' else 'h1')
    title=normalized(heading.get_text()) if heading else ''
    model=model_of(title);storage=storage_of(title)
    if not model or not storage or not new_product(title):return None
    full_title,sku=product_name(soup,title)
    color=color_of(title)
    if store=='iPeople':
        attrs={}
        for row in soup.select('.sc-product-content-attributes-list-item'):
            cells=row.find_all('div',recursive=False)
            if len(cells)==2:attrs[normalized(cells[0].get_text())]=normalized(cells[1].get_text())
        sim=sim_type(attrs.get('Кількість SIM-карт',attrs.get('Тип SIM-карти','')))
        color=color or color_of(attrs.get('Колір',''))
        offer=product_ipeople(html,url,model,storage,sim) if sim else None
        known_absent=any(normalized(x.get_text()) in ('Немає в наявності','Немає в наявностi','Нет в наличии','Немає на складі','Під замовлення','Передзамовлення','Очікується') for x in soup.select('.sc-module-sticker'))
    else:
        labels={x.get('data-label') for x in soup.select('a.crosslink.activ[data-label]')}
        if not jabko_new(soup):return None
        active=[x for x in soup.select('a.crosslink.activ[data-label]') if x.get('data-label') in ('Фізична SIM','eSIM')]
        if len(active)!=1:return None
        sim='physical' if active[0]['data-label']=='Фізична SIM' else 'esim'
        try:swatch=swatch_data(active[0].get('data-swatch','{}'))
        except ValueError:return None
        if normalized(swatch.get('name',''))!=title:return None
        offer=product_jabko(html,url,model,storage,sim)
        known_absent=swatch.get('stock_status_name') in ('Немає в наявності','Немає на складі','Нет в наличии')
    if not color or not sim or (sim_type(title)=='esim' and sim=='physical'):return None
    preorder=False
    if store=='iPeople' and not offer and known_absent:
        stickers=soup.select('.sc-module-sticker')
        preorder=any(normalized(x.get_text()) in ('Під замовлення','Передзамовлення') for x in stickers)
        if preorder:
            for x in stickers:
                if normalized(x.get_text()) in ('Під замовлення','Передзамовлення'):
                    x.string='В наявності';x['class']=['sc-module-sticker','sc-module-sticker-green']
            offer=product_ipeople(str(soup),url,model,storage,sim)
    status=('preorder' if preorder else 'ok') if offer else ('unavailable' if known_absent else 'error')
    return dict(store=store,url=url,model=model,storage=storage,sim=sim,color=canonical_color(model,color),
                edition='Standard',full_title=full_title,sku=sku,price=str(offer.price) if offer else None,status=status,checked_at=now())


class Cache:
    def __init__(self,path=None):
        is_default=path is None
        self.path=Path(path or Path(os.getenv('DATA_DIR',str(Path(__file__).with_name('data'))))/'catalog.sqlite3')
        fresh=not self.path.exists()
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS products(store TEXT NOT NULL,url TEXT NOT NULL,model TEXT NOT NULL,storage TEXT NOT NULL,sim TEXT NOT NULL,color TEXT NOT NULL,edition TEXT NOT NULL,price TEXT,status TEXT NOT NULL,checked_at TEXT NOT NULL,PRIMARY KEY(store,url));
                CREATE TABLE IF NOT EXISTS stores(store TEXT PRIMARY KEY,status TEXT NOT NULL,message TEXT NOT NULL,updated_at TEXT NOT NULL,full_updated_at TEXT);
                CREATE TABLE IF NOT EXISTS rates(user_id TEXT PRIMARY KEY,rate TEXT NOT NULL);''')
        with self.connect() as db:
            columns={r['name'] for r in db.execute('PRAGMA table_info(products)')}
            if 'last_success_at' not in columns:
                db.execute('ALTER TABLE products ADD COLUMN last_success_at TEXT')
                db.execute("UPDATE products SET last_success_at=checked_at WHERE price IS NOT NULL")
            for name in ('full_title','sku'):
                if name not in columns:db.execute('ALTER TABLE products ADD COLUMN '+name+' TEXT')
        with self.connect() as db:
            db.execute("UPDATE products SET color='Glacier Blue' WHERE model IN ('18 Pro','18 Pro Max') AND color='Glacier'")
        snapshot=Path(__file__).with_name('evidence')/'catalog_snapshot.json'
        if fresh and is_default and snapshot.exists():self.restore_snapshot(snapshot)
    def restore_snapshot(self,path):
        data=json.loads(Path(path).read_text())
        products=data.get('products',[])
        if not isinstance(products,list) or len(products)>10000:raise ValueError('Invalid snapshot')
        for record in products:
            if record.get('store') not in HOSTS or record.get('sim') not in ('physical','esim') or urlsplit(record.get('url','')).netloc!=HOSTS[record['store']]:raise ValueError('Invalid product')
        with self.connect() as db:
            for record in products:self._put(db,record)
            for store,info in data.get('stores',{}).items():
                if store not in HOSTS:raise ValueError('Invalid store')
                db.execute('INSERT OR REPLACE INTO stores VALUES(?,?,?,?,?)',(store,info['status'],info['message'],info['updated_at'],info.get('full_updated_at')))
    def connect(self):
        db=sqlite3.connect(self.path,timeout=30);db.row_factory=sqlite3.Row;db.execute('PRAGMA journal_mode=WAL');return db
    def records(self,store=None):
        with self.connect() as db:
            return [dict(r) for r in db.execute('SELECT * FROM products'+(' WHERE store=?' if store else ''), (store,) if store else ())]
    def replace_store(self,store,records):
        with self.connect() as db:
            incoming={p['url'] for p in records}
            # Missing catalog cards become historical offers, never fabricated stock.
            for old in db.execute('SELECT * FROM products WHERE store=?',(store,)).fetchall():
                if old['url'] not in incoming:
                    db.execute("UPDATE products SET status='unavailable',checked_at=? WHERE store=? AND url=?",(now(),store,old['url']))
            for p in records:self._put(db,p)
            stamp=now();db.execute('INSERT INTO stores VALUES(?,?,?,?,?) ON CONFLICT(store) DO UPDATE SET status=excluded.status,message=excluded.message,updated_at=excluded.updated_at,full_updated_at=excluded.full_updated_at',(store,'ok',f'{len(records)} товаров',stamp,stamp))
    def _put(self,db,p):
        p=dict(p)
        p['color']=canonical_color(p['model'],p['color'])
        old=db.execute('SELECT * FROM products WHERE store=? AND url=?',(p['store'],p['url'])).fetchone()
        identity=('model','storage','sim','color','edition')
        same=old and all(p[k]==old[k] for k in identity)
        for field in ('full_title','sku'):
            p[field]=p.get(field) or (old[field] if same else None)
        if p['price'] is None and same:
            p['price']=old['price']
            p['last_success_at']=old['last_success_at']
        elif p['price'] is not None:
            p['last_success_at']=p.get('last_success_at') or p['checked_at']
        else:p['last_success_at']=None
        keys=('store','url','model','storage','sim','color','edition','price','status','checked_at','last_success_at','full_title','sku')
        db.execute('INSERT OR REPLACE INTO products('+','.join(keys)+') VALUES('+','.join('?' for _ in keys)+')',tuple(p[k] for k in keys))
    def prices(self,store,records):
        with self.connect() as db:
            for p in records:
                old=db.execute('SELECT * FROM products WHERE store=? AND url=?',(store,p['url'])).fetchone()
                if old:
                    # Identity stays immutable. Null observations never erase a price.
                    self._put(db,{**dict(old),'price':p['price'],'status':p['status'],'checked_at':p['checked_at'],
                                  'last_success_at':p.get('last_success_at') if p['price'] is not None else old['last_success_at'],
                                  'full_title':p.get('full_title') or old['full_title'],'sku':p.get('sku') or old['sku']})
            db.execute('INSERT INTO stores(store,status,message,updated_at) VALUES(?,?,?,?) ON CONFLICT(store) DO UPDATE SET status=excluded.status,message=excluded.message,updated_at=excluded.updated_at',(store,'ok',f'{len(records)} товаров проверено',now()))
    def fail_store(self,store,message):
        with self.connect() as db:
            db.execute("UPDATE products SET status='error' WHERE store=?",(store,))
            db.execute('INSERT INTO stores(store,status,message,updated_at) VALUES(?,?,?,?) ON CONFLICT(store) DO UPDATE SET status=excluded.status,message=excluded.message,updated_at=excluded.updated_at',(store,'error',message,now()))
    def snapshot(self):
        with self.connect() as db:
            products=[dict(x) for x in db.execute('SELECT * FROM products ORDER BY model,storage,sim,color,store')]
            stores={x['store']:dict(x) for x in db.execute('SELECT * FROM stores')}
        return {'products':products,'stores':stores,'updated_at':max([v['updated_at'] for v in stores.values()],default=None)}
    def seed(self,path):
        if self.records():return
        report=json.loads(Path(path).read_text())
        for store,info in report['stores'].items():
            records=[dict(store=store,url=x['url'],model=report['model'],storage=report['storage'],sim=report['sim'],color=x['color'],edition='Standard',price=x['uah'],status='ok',checked_at=report['checked_at']) for x in info['offers']]
            self.replace_store(store,records)
            with self.connect() as db:db.execute('UPDATE stores SET updated_at=?,full_updated_at=NULL,message=? WHERE store=?',(report['checked_at'],'Первичная проверенная выборка',store))
    def set_rate(self,user_id,rate):
        from decimal import Decimal
        r=Decimal(str(rate).replace(',','.'))
        if not r.is_finite() or not 1<=r<=1000:raise ValueError('Invalid rate')
        with self.connect() as db:db.execute('INSERT INTO rates VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET rate=excluded.rate',(str(user_id),str(r)))
    def get_rate(self,user_id):
        with self.connect() as db:
            row=db.execute('SELECT rate FROM rates WHERE user_id=?',(str(user_id),)).fetchone()
        return row['rate'] if row else None


def next_page(soup,url):
    match=re.search(r'[?&]page=(\d+)',url);current=int(match.group(1)) if match else 1
    pages={int(m.group(1)):urljoin(url,a['href']) for a in soup.select('.pagination a[href]') if (m:=re.search(r'[?&]page=(\d+)',a['href']))}
    return pages.get(current+1)


def read_record(client,store,url,expected=None):
    """Retry successful-but-incomplete cards; Client retries transient HTTP errors.

    Explicit sold-out cards and mismatched variants never trigger extra requests.
    Each retry still goes through robots rules, throttling and request budgets.
    """
    for attempt in range(3):
        html=client.get(url)
        record=parse_record(store,html,url)
        if record:
            if expected and any(record[k]!=expected[k] for k in ('model','storage','sim','color','edition')):
                return html,record
            if record['price'] is not None or record['status']=='unavailable':return html,record
        if attempt<2:
            log.info('%s incomplete price; retry %s/2',store,attempt+1)
            time.sleep(2 ** (attempt+1))
    return html,record


def full_store(store,progress=lambda *_:None):
    root='https://'+HOSTS[store]+('/apple-ua/iphone/' if store=='iPeople' else '/iphone/')
    selector='a.sc-module-title[href]' if store=='iPeople' else 'a.catalog-product-item--title[href]'
    with LOCKS[store],Client(store,max_requests=2000,max_seconds=7200) as client:
        page=root;seen=set();candidates={};records={}
        while page:
            if page in seen:raise CatalogError('pagination_loop')
            seen.add(page);soup=BeautifulSoup(client.get(page),'html.parser')
            anchors=soup.select(selector)
            if not anchors:raise CatalogError('layout_changed')
            for a in anchors:
                title=normalized(a.get_text());url=urljoin(page,a['href'])
                if model_of(title) and storage_of(title) and new_product(title):candidates[url]=title
            progress(store,f'Страниц каталога: {len(seen)} · товаров найдено: {len(candidates)}',min(10,len(seen)))
            page=next_page(soup,page)
        pending=list(candidates);done=set()
        while pending:
            url=pending.pop(0)
            if url in done:continue
            done.add(url);html,record=read_record(client,store,url)
            if record:records[url]=record
            if store=='Jabko':
                product=BeautifulSoup(html,'html.parser')
                # Variant links refer to real product pages, not AJAX/private APIs.
                for a in product.select('a.crosslink[data-label][href]'):
                    if a.get('data-label') not in ('Фізична SIM','eSIM'):continue
                    target=urljoin(url,a['href'])
                    if target not in done and target not in pending and urlsplit(target).netloc==HOSTS[store]:pending.append(target)
            progress(store,f'Карточек проверено: {len(done)} · вариантов сохранено: {len(records)}',round(10+80*len(done)/(len(done)+len(pending))))
        if candidates and not records:raise CatalogError('no_verified_variants')
        return list(records.values())


class PriceBatch(list):
    def __init__(self,records,errors):
        super().__init__(records)
        self.errors=errors


def price_store(store,known,progress=lambda *_:None):
    with LOCKS[store],Client(store,max_requests=2000,max_seconds=7200) as client:
        result=[];errors=[];consecutive=0
        for index,old in enumerate(known):
            try:
                _,record=read_record(client,store,old['url'],old)
                identity=('model','storage','sim','color','edition')
                if record and all(record[x]==old[x] for x in identity):result.append(record)
                else:
                    result.append({**old,'last_success_at':old.get('last_success_at') or (old['checked_at'] if old['price'] is not None else None),'status':'error','checked_at':now()})
                    errors.append('identity_or_layout')
                consecutive=0
            except CatalogError as exc:
                reason=str(exc)
                if reason=='http_404':
                    result.append({**old,'last_success_at':old.get('last_success_at') or (old['checked_at'] if old['price'] is not None else None),'status':'unavailable','checked_at':now()});consecutive=0
                else:
                    errors.append(reason);consecutive+=1
                    result.append({**old,'last_success_at':old.get('last_success_at') or (old['checked_at'] if old['price'] is not None else None),'status':'error','checked_at':now()})
                    log.warning('%s price record failed: %s',store,reason)
                    if consecutive>=3 or reason in ('http_403','http_429','robots_denied','request_budget'):
                        for pending in known[index+1:]:result.append({**pending,'last_success_at':pending.get('last_success_at') or (pending['checked_at'] if pending['price'] is not None else None),'status':'error','checked_at':now()})
                        break
            progress(store,f'Цен проверено: {index+1} из {len(known)}',round(90*(index+1)/max(1,len(known))))
        return PriceBatch(result,errors)


def synchronize(cache,kind,progress=lambda *_:None):
    if kind not in ('catalog','prices'):raise ValueError('Unknown refresh')
    def run(store):
        try:
            records=full_store(store,progress) if kind=='catalog' else price_store(store,cache.records(store),progress)
            if kind=='catalog':cache.replace_store(store,records)
            else:
                cache.prices(store,records)
                if records.errors:
                    status='partial' if any(x['status']=='ok' for x in records) else 'error'
                    with cache.connect() as db:db.execute('UPDATE stores SET status=?,message=? WHERE store=?',(status,f'{len(records.errors)} ошибок; подтверждённые цены сохранены',store))
                    progress(store,'Обновление с ошибками; проверенные цены сохранены',100)
                    return store,False,len(records)
            progress(store,f'{len(records)} товаров сохранено',100)
            return store,True,len(records)
        except Exception as exc:
            reason=str(exc) if isinstance(exc,CatalogError) else type(exc).__name__
            log.warning('%s refresh failed: %s',store,reason);cache.fail_store(store,reason)
            progress(store,'Ошибка обновления',100)
            return store,False,0
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=[future.result() for future in as_completed([pool.submit(run,store) for store in HOSTS])]
    has_verified=any(p['status'] in ('ok','unavailable') for p in cache.records())
    return {'stores':results,'status':'succeeded' if all(ok for _,ok,_ in results) else 'partial' if any(ok for _,ok,_ in results) or has_verified else 'failed'}
