# 🔬 AI Science Experiment Advisor

Simple Python + Flask chatbot that ONLY answers science experiment questions.

---

## Setup & Run

### Step 1 — Install dependencies
```bash
pip install -r requirements.txt
```

### Step 2 — Add your Groq API key
Create a `.env` file at the project root with:
```env
GROQ_API_KEY=your-groq-api-key-here
FLASK_SECRET_KEY=replace-with-a-secure-random-value
FLASK_DEBUG=true
```

### Step 3 — Run locally
```bash
python app.py
```

### Step 4 — Open in browser
Go to: http://localhost:5000

### Production deployment
Use a WSGI server such as Gunicorn:
```bash
gunicorn app:app --bind 0.0.0.0:5000
```

If you deploy to a cloud host, set environment variables instead of editing `app.py`.

### Deploy to Render
1. Push this repository to GitHub.
2. Create a free Render account at https://render.com.
3. Connect Render to your GitHub repository.
4. Let Render detect the Python service, or use the following settings:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn app:app --bind 0.0.0.0:$PORT`
5. In Render dashboard, add environment variables:
   - `GROQ_API_KEY`
   - `FLASK_SECRET_KEY`
   - `DATABASE_PATH` (optional, defaults to `chat_history.db`)
6. Deploy the service and open the generated URL.

The app now stores the current session's science chat history in a local SQLite database, so the chatbot can use recent session messages as context for the next science answer. A new history UI is available through the `History` button in the header.

The project also includes a `Dockerfile` and `Procfile` for container-compatible deployment.

---

## How it works
1. User types a question
2. Python checks if it contains science keywords
3. If YES → sends to Groq AI chat API → shows answer
4. If NO  → shows "Sorry, I can only assist with science experiment-related questions."
