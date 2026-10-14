"""Run the Telegram bot and remote catalog worker together on one device."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parent

def main():
    os.chdir(ROOT)
    data_dir=Path(os.getenv('DATA_DIR',str(ROOT/'data')))
    data_dir.mkdir(parents=True,exist_ok=True)
    lock=open(data_dir/'runner.lock','a+')
    try:
        if os.name=='nt':
            import msvcrt
            lock.seek(0);lock.write('0');lock.flush();lock.seek(0)
            msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError:
        raise SystemExit('Already running on this device.')
    from dotenv import load_dotenv
    load_dotenv(ROOT/'.env')
    if not all(os.getenv(k) for k in ('TELEGRAM_BOT_TOKEN','MINIAPP_URL','SYNC_WORKER_KEY')):
        raise SystemExit('Configure TELEGRAM_BOT_TOKEN, MINIAPP_URL and SYNC_WORKER_KEY in .env first.')
    stopping=False
    def stop(*_):
        nonlocal stopping
        stopping=True
    for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,stop)
    children={};deadlines={};failures={}
    try:
        while not stopping:
            for name in ('bot.py','sync_agent.py'):
                child=children.get(name)
                if child is not None and child.poll() is not None:
                    failures[name]=failures.get(name,0)+1
                    deadlines[name]=time.monotonic()+min(60,2**min(failures[name],6))
                    children.pop(name)
                    print(name+' exited; restarting shortly.',flush=True)
                if name not in children and time.monotonic()>=deadlines.get(name,0):
                    children[name]=subprocess.Popen([sys.executable,str(ROOT/name)],cwd=ROOT)
            time.sleep(.5)
    finally:
        for child in children.values():
            if child.poll() is None:child.terminate()
        for child in children.values():
            try:child.wait(timeout=15)
            except subprocess.TimeoutExpired:child.kill();child.wait()
        lock.close()

if __name__=='__main__':main()
