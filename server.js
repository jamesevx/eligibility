import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { OpenAI } from 'openai';

config();
const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/evaluate', async (req, res) => {
  const { formData } = req.body;

  const userPrompt = `Project Info:\n${JSON.stringify(formData, null, 2)}\n\nEstimate eligibility.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are an EV charging funding expert. Estimate eligibility in these categories: Utility, Federal, State, Local, Tax Credits, and Other. Provide ranges and short rationale. Add a disclaimer.`
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      temperature: 0.3
    });

    const responseText = completion.choices[0].message.content;
    res.json({ result: responseText });
  } catch (error) {
    console.error('OpenAI error:', error);
    res.status(500).json({ error: 'Failed to evaluate funding eligibility' });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
//app.listen(3001, () => console.log('API running on http://localhost:3001'));
