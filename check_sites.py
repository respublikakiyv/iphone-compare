"""Explicit live check, separate from deterministic offline tests."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import logging
from scrapers import MODELS, STORAGES, CatalogError, fetch_ipeople, fetch_jabko

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--model',default='15',choices=MODELS)
    parser.add_argument('--storage',default='128GB',choices=STORAGES)
    parser.add_argument('--sim',default='physical',choices=['physical','esim'])
    args=parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    report={'checked_at':datetime.now(timezone.utc).isoformat(),'model':args.model,'storage':args.storage,'sim':args.sim,'stores':{}}
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs={name:pool.submit(fn,args.model,args.storage,args.sim) for name,fn in [('iPeople',fetch_ipeople),('Jabko',fetch_jabko)]}
        for name,future in jobs.items():
            try:
                offers=future.result()
                report['stores'][name]={'status':'ok','offers':[{'color':o.color,'uah':str(o.price),'url':o.url} for o in offers]}
            except Exception as exc:
                report['stores'][name]={'status':str(exc) if isinstance(exc,CatalogError) else type(exc).__name__,'offers':[]}
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if all(x['status']=='ok' for x in report['stores'].values()) else 1

if __name__=='__main__': raise SystemExit(main())
