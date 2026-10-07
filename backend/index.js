import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Allow your React app to communicate with this server
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// The endpoint your React app will hit
app.post('/api/chat', async (req, res) => {
  try {
    const { message, language, level, conversationHistory } = req.body;
    
    console.log(`Received message: "${message}" for ${language} (${level})`);

    // We will plug Gemini or Claude in right here in the next step
    const mockAiReply = `This is a test reply from your secure Express server! I see you said: ${message}`;

    res.json({ reply: mockAiReply });
    
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process chat' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Secure Lingua Lab server running on http://localhost:${PORT}`);
});
