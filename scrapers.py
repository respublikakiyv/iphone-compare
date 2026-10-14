"""Conservative public catalog readers. Unknown variants are never inferred."""
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.parse import urljoin, urlsplit
import json
import logging
import re
import threading
import time
import requests
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)
HEADERS = {'User-Agent': 'PriceComparisonBot/2.0', 'Accept-Language': 'uk-UA,uk;q=0.9'}
MODELS = ['18 Pro Max','18 Pro','18','17 Pro Max','17 Pro','17 Air','17','17e','16 Pro Max','16 Pro','16 Plus','16e','16','15 Pro Max','15 Pro','15 Plus','15','14 Pro Max','14 Pro','14 Plus','14','13 Pro Max','13 Pro','13 mini','13']
STORAGES = ['64GB','128GB','256GB','512GB','1TB','2TB']
HOSTS = {'iPeople': 'ipeople.ua', 'Jabko': 'jabko.ua'}
LOCKS = {name: threading.Lock() for name in HOSTS}

class CatalogError(Exception):
    """Safe status code for display/logging; never contains a response or token."""

@dataclass(frozen=True)
class Offer:
    store: str
    color: str
    price: Decimal
    url: str
    model: str
    storage: str
    sim: str
    edition: str = 'Standard'


def normalized(s):
    return re.sub(r'\s+', ' ', str(s).replace('\xa0', ' ')).strip()


def model_of(title):
    m = re.search(r'\biphone\s+((?:\d{2}(?:e\b|\s+(?:pro\s+max|pro|plus|air|mini)\b)?)|Air\b|Duo\b|SE\s*2022\b)', title, re.I)
    if not m: return None
    value=normalized(m.group(1))
    return next((x for x in MODELS if x.casefold()==value.casefold()),value.title())


def model_ok(title, model):
    found=model_of(title)
    return found is not None and found.casefold()==model.casefold()


def storage_ok(title, storage):
    m = re.search(r'(?<!\w)(\d+)\s*(GB|TB|ГБ|ТБ)\b', title, re.I)
    if not m: return False
    unit = m.group(2).upper().replace('ГБ','GB').replace('ТБ','TB')
    return m.group(1) + unit == storage


def sim_type(value):
    value = normalized(value).lower()
    if re.search(r'nano[ -]?sim|physical\s+sim|фізич\w*\s+sim|физич\w*\s+sim|звичайна\s+sim|sim\s*\+\s*e[ -]?sim', value):
        return 'physical'
    if re.search(r'\be[ -]?sim\b', value): return 'esim'
    return None


def sim_ok(title, sim):
    return sim_type(title) == sim


COLORS = ['Glacier Blue','Sky Blue','Red Cherry','Mist Blue','Light Blue','Lavender','Sage','Light Gold','Space Gray','Space Grey','Natural Titanium','Desert Titanium','Black Titanium','White Titanium','Blue Titanium','Deep Blue','Space Black','Cosmic Orange','Midnight','Starlight','Ultramarine','Teal','Pink','Purple','Yellow','Green','Silver','Gold','White','Black','Blue','Red','Glacier','Burgundy']
ALIASES = {'чорний':'Black','черный':'Black','білий':'White','белый':'White','синій':'Blue','синий':'Blue','зелений':'Green','рожевий':'Pink'}

def canonical_color(model,color):
    # Store labels verified against matching Apple SKUs MJRT4 and MJXW4.
    if model in ('18 Pro','18 Pro Max') and color in ('Glacier','Glacier Blue'):return 'Glacier Blue'
    return color


def color_of(title, model='', storage=''):
    palette={color.casefold():color for color in COLORS}
    palette.update(ALIASES)
    value=normalized(title)
    if value.casefold() in palette: return palette[value.casefold()]
    groups=re.findall(r'\(([^()]+)\)',value)
    for group in groups:
        color=palette.get(normalized(group).casefold())
        if color: return color
    memory=re.search(r'(?<!\w)\d+\s*(?:GB|TB|ГБ|ТБ)\b',value,re.I)
    if not memory: return None
    tail=value[memory.end():]
    tail=re.sub(r'\([A-Z0-9]{5,12}\)','',tail)
    tail=re.sub(r'(?i)\(?e[ -]?sim\)?','',tail)
    return palette.get(normalized(tail.strip(' ()')).casefold())


def new_product(title):
    return not re.search(r'б\s*[/.-]?\s*у|\bused\b|refurb|як новий|как новый|економ|эконом|відновлен|восстановлен|вживан|\bpreowned\b|\bultra\b', title, re.I)


def money(value):
    try:
        result = Decimal(re.sub(r'\s','',str(value)).replace(',','.'))
        return result if result.is_finite() and 3000 <= result <= 300000 else None
    except InvalidOperation: return None


def price_from_text(text):
    values = re.findall(r'(\d[\d\s\u00a0\u202f]*(?:[.,]\d{2})?)\s*(?:грн|₴|UAH)', text, re.I)
    prices = {money(v) for v in values} - {None}
    return next(iter(prices)) if len(prices) == 1 else None


def robots_rules(text, agent='PriceComparisonBot'):
    groups=[]; agents=[]; rules=[]; delay=1.0; started=False
    for raw in text.splitlines()+['User-agent: __end__']:
        line=raw.split('#',1)[0].strip()
        if ':' not in line: continue
        key,value=[x.strip() for x in line.split(':',1)];key=key.lower()
        if key=='user-agent':
            if started:
                groups.append((agents,rules,delay));agents=[];rules=[];delay=1.0;started=False
            agents.append(value.lower())
        elif agents:
            started=True
            if key in ('allow','disallow') and value: rules.append((key,value))
            if key=='crawl-delay':
                try: delay=max(1.0,float(value))
                except ValueError: pass
    specific=[g for g in groups if any(a!='*' and a in agent.lower() for a in g[0])]
    selected=specific or [g for g in groups if '*' in g[0]]
    return [r for g in selected for r in g[1]], max([1.0]+[g[2] for g in selected])


def permitted(url, rules):
    part=urlsplit(url);target=part.path+('?' + part.query if part.query else '')
    matches=[]
    for kind,rule in rules:
        end=rule.endswith('$');body=rule[:-1] if end else rule
        pattern='^'+re.escape(body).replace(r'\*','.*')+('$' if end else '')
        if re.search(pattern,target): matches.append((len(body.replace('*','')),kind=='allow'))
    return max(matches)[1] if matches else True


class Client:
    def __init__(self, store, timeout=12, max_requests=35, max_seconds=150):
        self.store=store;self.origin='https://'+HOSTS[store];self.timeout=timeout
        self.session=requests.Session();self.last=0;self.deadline=time.monotonic()+max_seconds
        self.max_requests=max_requests
        self.count=0;self.rules=[];self.delay=1.0
    def __enter__(self):
        try:
            text=self._request(self.origin+'/robots.txt',robots=True)
            if text.lstrip().startswith('<'): raise CatalogError('robots_unavailable')
            self.rules,self.delay=robots_rules(text)
            return self
        except Exception:
            self.session.close();raise
    def __exit__(self,*args): self.session.close()
    def get(self,url):
        if not permitted(url,self.rules): raise CatalogError('robots_denied')
        return self._request(url)
    def _request(self,url,robots=False,redirects=0):
        host=urlsplit(url)
        if host.scheme!='https' or host.netloc!=HOSTS[self.store]: raise CatalogError('foreign_url')
        for attempt in range(3):
            if self.count>=self.max_requests or time.monotonic()>self.deadline: raise CatalogError('request_budget')
            wait=max(0,self.delay-(time.monotonic()-self.last))
            if wait>30: raise CatalogError('crawl_delay_too_long')
            time.sleep(wait);self.count+=1;self.last=time.monotonic()
            try:
                r=self.session.get(url,headers=HEADERS,timeout=(5,self.timeout),allow_redirects=False)
            except (requests.Timeout,requests.ConnectionError):
                if attempt<2:
                    log.info('%s network retry %s/2',self.store,attempt+1)
                    time.sleep(2 ** (attempt+1));continue
                raise CatalogError('network_error') from None
            except requests.RequestException: raise CatalogError('network_error') from None
            log.info('%s HTTP %s',self.store,r.status_code)
            if r.status_code in (301,302,303,307,308):
                if redirects >= 4: raise CatalogError('redirect_limit')
                destination=urljoin(url,r.headers.get('Location',''))
                if not robots and not permitted(destination,self.rules): raise CatalogError('robots_denied')
                return self._request(destination,robots,redirects+1)
            if r.status_code==404 and robots: return ''
            if r.status_code in (500,502,503,504) and attempt<2:
                log.info('%s HTTP retry %s/2',self.store,attempt+1)
                time.sleep(2 ** (attempt+1));continue
            if r.status_code!=200: raise CatalogError('http_'+str(r.status_code))
            if len(r.content)>5_000_000: raise CatalogError('response_too_large')
            return r.text
        raise CatalogError('network_error')


def product_ipeople(html,url,model,storage,sim):
    soup=BeautifulSoup(html,'html.parser');heading=soup.select_one('h1')
    title=normalized(heading.get_text(' ',strip=True)) if heading else ''
    if not (model_ok(title,model) and storage_ok(title,storage) and new_product(title)): return None
    attrs={}
    for row in soup.select('.sc-product-content-attributes-list-item'):
        cells=row.find_all('div',recursive=False)
        if len(cells)==2: attrs[normalized(cells[0].get_text())]=normalized(cells[1].get_text())
    confirmed=sim_type(attrs.get('Кількість SIM-карт',attrs.get('Тип SIM-карти','')))
    if confirmed!=sim: return None
    title_color=color_of(title)
    attribute_color=color_of(attrs.get('Колір',''))
    if title_color and attribute_color and title_color!=attribute_color and attribute_color.casefold() not in title_color.casefold().split(): return None
    color=title_color or attribute_color
    if sim_type(title)=='esim' and confirmed=='physical': return None
    prices={price_from_text(x.get_text()) for x in soup.select('.sc-module-price.uah')} - {None}
    available=any(normalized(x.get_text())=='В наявності' for x in soup.select('.sc-module-sticker-green'))
    if not color or len(prices)!=1 or not available: return None
    return Offer('iPeople',color,next(iter(prices)),url,model,storage,sim)


def fetch_ipeople(model,storage,sim,timeout=12):
    with LOCKS['iPeople'], Client('iPeople',timeout) as c:
        root=c.origin+'/apple-ua/iphone/'
        soup=BeautifulSoup(c.get(root),'html.parser')
        category=next((urljoin(root,a['href']) for a in soup.select('a[href]') if normalized(a.get_text()).casefold()==('iPhone '+model).casefold()),None)
        url=category or root;seen=set();products=set();offers=[]
        while url:
            if url in seen: raise CatalogError('pagination_loop')
            seen.add(url);soup=BeautifulSoup(c.get(url),'html.parser')
            anchors=soup.select('a.sc-module-title[href]')
            if not anchors: raise CatalogError('layout_changed')
            for a in anchors:
                title=normalized(a.get_text())
                if not(model_ok(title,model) and storage_ok(title,storage) and new_product(title)): continue
                product=urljoin(url,a['href'])
                if product in products: continue
                products.add(product)
                offer=product_ipeople(c.get(product),product,model,storage,sim)
                if offer: offers.append(offer)
            current=int(re.search(r'[?&]page=(\d+)',url).group(1)) if re.search(r'[?&]page=(\d+)',url) else 1
            pages={int(m.group(1)):urljoin(url,a['href']) for a in soup.select('.pagination a[href]') if (m:=re.search(r'[?&]page=(\d+)',a['href']))}
            url=pages.get(current+1)
        return offers


def swatch_data(raw):
    value=json.loads(raw)
    if not isinstance(value,dict):raise ValueError('Invalid swatch')
    return {key:re.sub(r'\\u([0-9a-fA-F]{4})',lambda m:chr(int(m.group(1),16)),item).replace('\\/','/') if isinstance(item,str) else item for key,item in value.items()}


def jabko_new(soup):
    labels={a.get('data-label') for a in soup.select('a.crosslink.activ[data-label]')}
    condition_labels={a.get('data-label') for a in soup.select('a.crosslink[data-label]')} & {'Новий','Як Новий','Ultra','Б/У'}
    if condition_labels:return 'Новий' in labels and not (labels & {'Як Новий','Ultra','Б/У'})
    # Single-condition cards have no picker. Require matching product schema and
    # a regular iPhone category breadcrumb; reject used/refurbished categories.
    heading=soup.select_one('h1.product-info__title')
    title=normalized(heading.get_text()) if heading else ''
    product=False;category=False
    for script in soup.select('script[type="application/ld+json"]'):
        try:data=json.loads(script.get_text())
        except ValueError:continue
        if not isinstance(data,dict):continue
        if data.get('@type')=='Product' and normalized(data.get('name',''))==title:
            condition=str(data.get('itemCondition',data.get('offers',{}).get('itemCondition','')))
            if condition and not condition.endswith('/NewCondition'):return False
            product=new_product(title)
        if data.get('@type')=='BreadcrumbList':
            entries=data.get('itemListElement',[])
            if any(not new_product(str(x.get('name',''))) for x in entries):return False
            category=any(str(x.get('item','')).startswith('https://jabko.ua/iphone/apple-iphone-') for x in entries)
    return product and category


def product_jabko(html,url,model,storage,sim):
    soup=BeautifulSoup(html,'html.parser');heading=soup.select_one('h1.product-info__title')
    title=normalized(heading.get_text()) if heading else ''
    if not(model_ok(title,model) and storage_ok(title,storage) and new_product(title)): return None
    active_labels={a.get('data-label') for a in soup.select('a.crosslink.activ[data-label]')}
    if not jabko_new(soup): return None
    selected=[a for a in soup.select('a.crosslink.activ[data-label]') if a.get('data-label') in ('Фізична SIM','eSIM')]
    if len(selected)!=1: return None
    active=selected[0]
    confirmed='physical' if active['data-label']=='Фізична SIM' else 'esim'
    if confirmed!=sim or (sim_type(title)=='esim' and confirmed=='physical'): return None
    try: swatch=swatch_data(active.get('data-swatch','{}'))
    except ValueError: return None
    if normalized(swatch.get('name',''))!=title or swatch.get('stock_status_name') not in ('В наявності','Залишилось мало','Є в наявності'): return None
    allowed_paths={urlsplit(url).path.rstrip('/')}
    canonical=soup.select_one('link[rel="canonical"][href]')
    if canonical:
        target=urlsplit(urljoin(url,canonical['href']))
        if target.netloc==HOSTS['Jabko']:allowed_paths.add(target.path.rstrip('/'))
    if urlsplit(urljoin(url,active.get('href',''))).path.rstrip('/') not in allowed_paths:return None
    color=color_of(title)
    prices={price_from_text(x.get_text()) for x in soup.select('.product-info__price-new .price-new__uah')} - {None}
    if not color or len(prices)!=1: return None
    price=next(iter(prices))
    if price_from_text(swatch.get('price_uah',''))!=price: return None
    return Offer('Jabko',color,price,url,model,storage,sim)


def fetch_jabko(model,storage,sim,timeout=12):
    with LOCKS['Jabko'], Client('Jabko',timeout) as c:
        root=c.origin+'/iphone/'
        soup=BeautifulSoup(c.get(root),'html.parser')
        category=next((urljoin(root,a['href']) for a in soup.select('a[href]') if normalized(a.get_text()).casefold() in (('Apple iPhone '+model).casefold(),('iPhone '+model).casefold()) and '/iphone/apple-' in a['href']),None)
        if not category: raise CatalogError('category_not_found')
        url=category;seen=set();products=set();offers=[]
        while url:
            if url in seen: raise CatalogError('pagination_loop')
            seen.add(url);soup=BeautifulSoup(c.get(url),'html.parser')
            anchors=soup.select('a.catalog-product-item--title[href]')
            if not anchors: raise CatalogError('layout_changed')
            for a in anchors:
                title=normalized(a.get_text())
                if not(model_ok(title,model) and storage_ok(title,storage) and new_product(title)): continue
                product=urljoin(url,a['href'])
                if product in products: continue
                products.add(product);html=c.get(product)
                offer=product_jabko(html,product,model,storage,sim)
                if offer: offers.append(offer)
                else:
                    page=BeautifulSoup(html,'html.parser')
                    label='Фізична SIM' if sim=='physical' else 'eSIM'
                    for variant in page.select('a.crosslink[data-label]'):
                        if variant.get('data-label')!=label: continue
                        target=urljoin(product,variant.get('href',''))
                        if target in products: continue
                        products.add(target)
                        offer=product_jabko(c.get(target),target,model,storage,sim)
                        if offer: offers.append(offer)
            current=int(re.search(r'[?&]page=(\d+)',url).group(1)) if re.search(r'[?&]page=(\d+)',url) else 1
            pages={int(m.group(1)):urljoin(url,a['href']) for a in soup.select('.pagination a[href]') if (m:=re.search(r'[?&]page=(\d+)',a['href']))}
            url=pages.get(current+1)
        return list({o.url:o for o in offers}.values())


def compare_rows(offers):
    rows={}
    for o in offers:
        if o.store not in HOSTS: continue
        key=(o.model,o.storage,o.sim,o.color.casefold(),o.edition)
        row=rows.setdefault(key,{'color':o.color,'edition':o.edition,'iPeople':None,'Jabko':None})
        old=row[o.store]
        if old is None or o.price<old.price: row[o.store]=o
    return [rows[k] for k in sorted(rows)]


def render(model,storage,sim,rate,offers,errors=None):
    rate=Decimal(str(rate))
    if not rate.is_finite() or not 1<=rate<=1000: raise ValueError('Invalid exchange rate')
    rows=compare_rows(o for o in offers if (o.model,o.storage,o.sim)==(model,storage,sim))
    if not rows: return f'{model} {storage} {"eSIM" if sim=="esim" else "SIM"}\niPeople | Jabko\n      — |       —\n      — |       —'
    blocks=[]
    for row in rows:
        a,b=row['iPeople'],row['Jabko']
        def usd(o): return '$'+str((o.price/rate).quantize(Decimal('1'),rounding=ROUND_HALF_UP)) if o else '—'
        blocks.append(f'{model} {storage} {row["color"]}\niPeople | Jabko\n{str(a.price) if a else "—":>7} | {str(b.price) if b else "—":>7}\n{usd(a):>7} | {usd(b):>7}')
    return '\n\n'.join(blocks)
