"""Python updater for the hosted Mini App. Secrets stay in .env."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import logging
import os
from pathlib import Path
import time
from urllib.parse import urlsplit
import requests
from dotenv import load_dotenv
from catalog import Cache,synchronize,now

log=logging.getLogger(__name__)

class PendingPublication:
    """Keep a completed crawl until both remote writes are acknowledged."""
    def __init__(self,path):self.path=Path(path)
    def save(self,job,snapshot,result):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        temporary=self.path.with_suffix('.tmp')
        with temporary.open('w',encoding='utf-8') as stream:
            json.dump({'job':job,'snapshot':snapshot,'result':result},stream,ensure_ascii=False)
            stream.flush();os.fsync(stream.fileno())
        temporary.replace(self.path)
    def flush(self,remote):
        if not self.path.exists():return False
        payload=json.loads(self.path.read_text(encoding='utf-8'))
        remote.post('/api/internal/snapshot',payload['snapshot'])
        status=payload['result']['status']
        message='База обновлена.' if status=='succeeded' else 'Обновлено частично. Последние подтверждённые цены сохранены с датой проверки.'
        remote.post('/api/internal/progress',{'id':payload['job']['id'],'progress':100,'message':message,'status':status})
        self.path.unlink()
        log.info('Refresh completed: %s',status)
        return True

class Remote:
    def __init__(self):
        self.origin=os.getenv('MINIAPP_URL','').rstrip('/')
        if urlsplit(self.origin).scheme!='https':raise ValueError('MINIAPP_URL must be HTTPS')
        self.key=os.getenv('SYNC_WORKER_KEY','')
        if not self.key:raise ValueError('SYNC_WORKER_KEY required')
        self.session=requests.Session()
        self.headers={'X-Sync-Key':self.key}
        bypass=os.getenv('SITES_SERVICE_TOKEN','')
        if bypass:self.headers['OAI-Sites-Authorization']='Bearer '+bypass
    def post(self,path,data):
        response=self.session.post(self.origin+path,json=data,headers=self.headers,timeout=(10,45),allow_redirects=False)
        if response.status_code!=200:raise RuntimeError('Mini App HTTP '+str(response.status_code))
        return response.json()
    def publish(self,cache):return self.post('/api/internal/snapshot',cache.snapshot())

def execute(remote,cache,job,pending):
    messages={}
    def progress(store,message,percent=0):messages[store]=(message,percent)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(synchronize,cache,job['kind'],progress)
        while not future.done():
            message=' · '.join(f'{store}: {entry[0]}' for store,entry in list(messages.items())) or 'Читаем каталоги магазинов'
            try:remote.post('/api/internal/progress',{'id':job['id'],'progress':round(sum(x[1] for x in list(messages.values()))/2),'message':message,'status':'running'})
            except Exception as exc:log.warning('Progress update: %s',type(exc).__name__)
            time.sleep(10)
        result=future.result()
    pending.save(job,cache.snapshot(),result)
    pending.flush(remote)

def main():
    load_dotenv(Path(__file__).with_name('.env'))
    from bot import configure_logging
    configure_logging(os.getenv('TELEGRAM_BOT_TOKEN',''))
    parser=argparse.ArgumentParser();parser.add_argument('--once',choices=['catalog','prices']);parser.add_argument('--publish',action='store_true');parser.add_argument('--local',action='store_true');args=parser.parse_args()
    cache=Cache()
    if args.once:
        result=synchronize(cache,args.once,lambda store,msg,percent=0:log.info('%s %s',store,msg))
        if args.publish:Remote().publish(cache)
        print(json.dumps({'status':result['status'],'products':len(cache.records())}));return
    remote=Remote()
    pending=PendingPublication(cache.path.parent/'pending_publication.json')
    while True:
        try:
            # Do not claim another crawl while a completed snapshot is unsent.
            pending.flush(remote)
            job=remote.post('/api/internal/claim',{}).get('job')
            if job:execute(remote,cache,job,pending)
        except Exception as exc:log.warning('Updater connection: %s',str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__)
        time.sleep(5)

if __name__=='__main__':main()
