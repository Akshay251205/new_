FROM python:3.12-slim

WORKDIR /app

COPY chatbot/chatbottttt/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY chatbot/chatbottttt /app

ENV PYTHONUNBUFFERED=1
ENV PORT=5000

CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:5000", "--workers", "2"]
