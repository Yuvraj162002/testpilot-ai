# One container: FastAPI serves the API, the demo shop and the built React app.
# Build:  docker build -t testpilot .
# Run:    docker run -p 8000:8000 --env-file backend/.env testpilot   -> http://localhost:8000
# Hosted demo: Hugging Face Spaces (see README "Deploy"), or Fly.io with fly.toml
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Playwright image already has Chromium and its system libraries.
FROM mcr.microsoft.com/playwright/python:v1.55.0-noble
WORKDIR /app/backend
# The image's Python is the system one (Ubuntu 24.04 refuses plain pip installs there); this container is ours alone.
ENV PIP_BREAK_SYSTEM_PACKAGES=1
COPY backend/requirements.txt ./
# --with-deps: pip may install a newer Playwright than the image, whose Chromium needs newer libraries
RUN pip install --no-cache-dir -r requirements.txt && playwright install --with-deps chromium
COPY backend/ ./
# Hosts like Hugging Face Spaces run the container as a non-root user (uid 1000): it must be able to write here.
RUN mkdir -p data runs && chmod -R a+rwX data runs
COPY --from=web /app/frontend/dist /app/frontend/dist
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
