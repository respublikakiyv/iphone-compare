FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 DATA_DIR=/app/data ENABLE_MINIAPP=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY bot.py scrapers.py catalog.py sync_agent.py run.py ./
COPY evidence/ ./evidence/
RUN mkdir -p /app/data
CMD ["python", "run.py"]
