FROM python:3.11-slim
WORKDIR /app
# Copy and install requirements first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Copy app code
COPY . .
# Create data dir in case it doesn't exist
RUN mkdir -p data static
# Hugging Face Spaces requires port 7860 and non-root
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 7860
ENV PORT=7860
CMD ["python", "main.py"]
