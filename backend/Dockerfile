# backend/Dockerfile
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install dependencies first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Applies pending Alembic migrations before the app starts serving traffic —
# schema evolution is no longer create_all-on-boot (see auth.py::init_auth).
# Use PORT env var (DigitalOcean sets this automatically)
CMD alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}