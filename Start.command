#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
fi
if [ "$(uname -s)" = Darwin ]; then
  exec caffeinate -i .venv/bin/python run.py
fi
exec .venv/bin/python run.py
