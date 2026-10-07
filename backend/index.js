import "cross-fetch/dist/node-polyfill.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/api/chat", async (req, res) => {
  try {
    const {
      message,
      language = "English",
      level = "Beginner",
      conversationHistory = [],
    } = req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      systemInstruction: `You are a helpful language tutor. The user is practicing ${language} at a ${level} level. Respond naturally in ${language}. Correct them gently if needed.`,
    });

    const history = conversationHistory.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);

    res.json({ reply: result.response.text() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to process chat with Gemini" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Secure Lingua Lab server running on http://localhost:${PORT}`);
});
