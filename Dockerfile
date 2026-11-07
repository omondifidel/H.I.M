# Stage 1: Build Frontend
FROM node:20 AS frontend
WORKDIR /app/frontend

# Install build tools required for native C++ node modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY frontend/package*.json ./

# Increase memory limit for Node.js to prevent out-of-memory crashes on free tiers
ENV NODE_OPTIONS="--max_old_space_size=4096"

# Force install, completely ignore secondary crashing scripts, and disable heavy audits
RUN npm install --force --ignore-scripts --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# Stage 2: Python Backend & Final Container
FROM python:3.12-slim
WORKDIR /app

COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY --from=frontend /app/frontend/out ./frontend/out

WORKDIR /app/backend
ENV PYTHONPATH=/app/backend

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]