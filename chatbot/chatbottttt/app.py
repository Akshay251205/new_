from flask import Flask, request, jsonify, render_template, session, redirect, url_for
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv
import os
import sqlite3
import uuid
from datetime import datetime

load_dotenv()

app = Flask(__name__)
CORS(app, supports_credentials=True)
secret_key = os.environ.get("FLASK_SECRET_KEY")
if not secret_key:
    secret_key = "change-this-secret-key"
    print("WARNING: FLASK_SECRET_KEY is not set. Using an insecure default secret key.")
app.secret_key = secret_key

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "chat_history.db"))


def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def save_chat_message(session_id, role, content):
    conn = get_db_connection()
    conn.execute(
        "INSERT INTO chat_history (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
        (session_id, role, content, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()


def get_recent_session_history(session_id, limit=12):
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT role, content, created_at FROM chat_history WHERE session_id = ? ORDER BY id DESC LIMIT ?",
        (session_id, limit),
    ).fetchall()
    conn.close()
    return [
        {"role": row["role"], "content": row["content"], "created_at": row["created_at"]}
        for row in reversed(rows)
    ]


@app.route("/history")
def session_history():
    session_id = session.get("chat_session_id")
    if not session_id:
        return jsonify({"history": []})
    history = get_recent_session_history(session_id, limit=30)
    return jsonify({"history": history})


@app.before_first_request
def initialize_database():
    init_db()


@app.before_request
def ensure_chat_session():
    if "chat_session_id" not in session:
        session["chat_session_id"] = str(uuid.uuid4())

# ── Your Groq API Key ─────────────────────────────────────────────────────
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("Missing GROQ_API_KEY environment variable. Set it before running the application.")
client = Groq(api_key=GROQ_API_KEY)

# ── Science keywords for filtering ────────────────────────────────────────
SCIENCE_KEYWORDS = [
    "experiment", "lab", "laboratory", "hypothesis", "procedure",
    "observation", "variable", "chemistry", "physics", "biology",
    "reaction", "chemical", "acid", "base", "solution", "mixture",
    "electricity", "magnet", "force", "gravity", "motion", "energy",
    "cell", "plant", "photosynthesis", "osmosis", "dna", "enzyme",
    "beaker", "flask", "titration", "distillation", "filtration",
    "crystal", "volcano", "static", "circuit", "battery", "current",
    "materials", "safety", "procedure", "result", "conclusion",
    "science", "scientific", "test", "measure", "observe", "investigate",
    "baking soda", "vinegar", "copper", "iron", "oxygen", "hydrogen",
    "temperature", "pressure", "density", "buoyancy", "wave", "optics",
    "germination", "seed", "bacteria", "microscope", "dissection",
    "slime", "chromatography", "electrolysis", "pendulum", "friction",
]

SYSTEM_PROMPT = """You are an AI Science Experiment Advisor.
You ONLY answer questions about science experiments.

When describing an experiment, use this format:
🎯 Objective
🧪 Materials
⚙️ Steps (numbered)
⚠️ Safety Warning (if needed)
📊 Expected Result
💡 Conclusion

If a question is NOT about science experiments, reply:
"Sorry, I can only assist with science experiment-related questions."
"""

def is_science_query(message):
    msg = message.lower()
    return any(keyword in msg for keyword in SCIENCE_KEYWORDS)

@app.route("/")
def home():
    return render_template("landing.html")

@app.route("/login", methods=["GET", "POST"])
def login_page():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")

        # Simple authentication - replace with proper auth in production
        if username == "admin" and password == "password":
            session['user'] = username
            session.pop('is_guest', None)  # Remove guest flag if upgrading

            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify({"success": True, "redirect": url_for('chatbot')})
            return redirect(url_for('chatbot'))
        else:
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify({"success": False, "error": "Invalid credentials"}), 401
            return render_template("login.html", error="Invalid credentials")

    if 'user' in session:
        return redirect(url_for('chatbot'))
    return render_template("login.html")

@app.route("/chatbot")
def chatbot():
    if 'user' not in session:
        return redirect(url_for('login_page'))
    return render_template("index.html")

@app.route("/guest")
def guest_login():
    session['user'] = 'guest'
    session['is_guest'] = True
    return redirect(url_for('chatbot'))

@app.route("/logout")
def logout():
    session.pop('user', None)
    session.pop('is_guest', None)
    return redirect(url_for('home'))

@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    message = data.get("message", "").strip()
    session_id = session.get("chat_session_id")

    if not message:
        return jsonify({"reply": "Please enter a message."})

    if not is_science_query(message):
        save_chat_message(session_id, "user", message)
        return jsonify({"reply": "Sorry, I can only assist with science experiment-related questions."})

    # Build history context from previous messages, then save the current user message.
    history = get_recent_session_history(session_id, limit=10)
    save_chat_message(session_id, "user", message)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *history,
        {"role": "user", "content": message},
    ]

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            max_tokens=1024,
            temperature=0.5,
        )
        reply_text = response.choices[0].message.content
        save_chat_message(session_id, "assistant", reply_text)
        return jsonify({"reply": reply_text})
    except Exception as e:
        return jsonify({"reply": f"Error: {str(e)}"})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    print(f"\n🔬 Science Advisor (Groq) running at http://localhost:{port}\n")
    app.run(host="0.0.0.0", debug=debug, port=port)
