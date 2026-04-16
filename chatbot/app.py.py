from flask import Flask, request, jsonify
import openai

app = Flask(__name__)

openai.api_key = "YOUR_API_KEY"

science_keywords = [
    "experiment", "science", "physics", "chemistry",
    "biology", "lab", "reaction", "project", "hypothesis",
    "observation", "result"
]

def is_science_query(user_input):
    user_input = user_input.lower()
    return any(word in user_input for word in science_keywords)

@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    user_input = data.get("message")

    if not is_science_query(user_input):
        return jsonify({
            "response": "I can only answer science experiment related queries."
        })

    response = openai.ChatCompletion.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are a science experiment assistant. Only answer questions related to science experiments. If the question is outside this domain, refuse politely."
            },
            {
                "role": "user",
                "content": user_input
            }
        ],
        temperature=0.3,
        top_p=0.7,
        max_tokens=300
    )

    return jsonify({
        "response": response["choices"][0]["message"]["content"]
    })

if __name__ == "__main__":
    app.run(debug=True)