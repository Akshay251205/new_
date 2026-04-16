

import streamlit as st
import google.generativeai as genai

# Set API key
genai.configure(api_key="AIzaSyBdk9T44KKLVT5Y1T1GTt52i05_PI6SWwk")

# Create model
model = genai.GenerativeModel(model_name="gemini-1.5-flash")

st.title("Science Experiment Chatbot")

user_input = st.text_input("Ask your question:")

if st.button("Send"):
    if user_input.strip() == "":
        st.write("Please enter something")
    else:
        try:
            response = model.generate_content(user_input)
            st.write(response.text)
        except Exception as e:
            st.write("Error:", e)