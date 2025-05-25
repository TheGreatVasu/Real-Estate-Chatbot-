import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: "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", // your real key
});

const run = async () => {
  try {
    const result = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Hello, how are you?" }],
    });
    console.log("✅ OpenAI Response:", result.choices[0].message.content);
  } catch (err) {
    console.error("❌ API Error:", err.message);
  }
};

run();
