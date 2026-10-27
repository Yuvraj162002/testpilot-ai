# One container: FastAPI serves the API, the demo shop and the built React app.
# Build:  docker build -t testpilot .
# Run:    docker run -p 8000:8000 --env-file backend/.env testpilot   -> http://localhost:8000
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Playwright image already has Chromium and its system libraries.
FROM mcr.microsoft.com/playwright/python:v1.55.0-noble
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && playwright install chromium
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
