"""Install device-local background startup. Run on the actual host device."""
from pathlib import Path
import platform
import plistlib
import subprocess
import sys

root=Path(__file__).resolve().parent
system=platform.system()
if system=='Darwin':
    target=Path.home()/'Library/LaunchAgents/ua.iphonecompare.runner.plist'
    logs=root/'logs';logs.mkdir(exist_ok=True)
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(plistlib.dumps(dict(Label='ua.iphonecompare.runner',ProgramArguments=[sys.executable,str(root/'run.py')],WorkingDirectory=str(root),RunAtLoad=True,KeepAlive=True,ThrottleInterval=30,StandardOutPath=str(logs/'runner.log'),StandardErrorPath=str(logs/'runner-error.log'))))
    target.chmod(0o600)
    import os
    domain='gui/'+str(os.getuid())
    subprocess.run(['launchctl','bootout',domain,str(target)],capture_output=True)
    subprocess.run(['launchctl','bootstrap',domain,str(target)],check=True)
elif system=='Linux':
    # Quote paths according to systemd's unit syntax.
    def quote(p):return '"'+str(p).replace('\\','\\\\').replace('"','\\"').replace('%','%%')+'"'
    target=Path.home()/'.config/systemd/user/iphonecompare.service'
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text('[Unit]\nDescription=iPhone Compare bot and updater\nAfter=network-online.target\n\n[Service]\nWorkingDirectory='+quote(root)+'\nExecStart='+quote(sys.executable)+' '+quote(root/'run.py')+'\nRestart=always\nRestartSec=10\n\n[Install]\nWantedBy=default.target\n')
    subprocess.run(['systemctl','--user','daemon-reload'],check=True)
    subprocess.run(['systemctl','--user','enable','--now','iphonecompare.service'],check=True)
else:
    raise SystemExit('Windows: run python run.py; configure Task Scheduler to run it at logon.')
print('Background startup enabled on this device.')
