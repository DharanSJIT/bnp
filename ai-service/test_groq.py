import os
from groq import Groq

def test():
    client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
    res = client.chat.completions.create(
        model="llama3-8b-8192",
        messages=[{"role": "user", "content": "Hello!"}]
    )
    print(res.choices[0].message.content)

if __name__ == "__main__":
    test()
