import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { OpenAI } from 'openai';
import axios from 'axios';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

config();
const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SERP_API_KEY = process.env.SERP_API_KEY;

async function searchFundingPrograms(address) {
  const query = `EV charging rebates incentives site:.gov "${address}"`;
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}&num=5`;

  try {
    const res = await axios.get(url);
    const results = res.data.organic_results || [];
    return results
      .map(result => result.link)
      .filter(link => !link.toLowerCase().endsWith('.pdf')) // skip PDFs
      .slice(0, 3);
  } catch (err) {
    console.error('Search failed:', err.message);
    return [];
  }
}

async function scrapePageText(url) {
  try {
    const res = await axios.get(url, { timeout: 8000 });
    const $ = cheerio.load(res.data);
    return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 4000);
  } catch (err) {
    console.error(`Failed to scrape ${url}:`, err.message);
    return '';
  }
}

app.post('/api/evaluate', async (req, res) => {
  const { formData } = req.body;
  const address = formData.siteAddress || formData.address || '';

  const userPrompt = `Project Info:\n${JSON.stringify(formData, null, 2)}\n\nEstimate eligibility.`;

  try {
    const urls = await searchFundingPrograms(address);
    const texts = await Promise.all(urls.map(url => scrapePageText(url)));
    const webContent = texts.filter(Boolean).join('\n\n') || 'No relevant web content found.';

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an EV charging funding expert. Based on the project info and supplemental internet results, estimate eligibility in the following categories: Utility, Federal, State, Local, Tax Credits, and Other. Provide US$ funding ranges and a short rationale. Include a disclaimer.'
        },
        {
          role: 'user',
          content: `${userPrompt}\n\nRelevant Internet Findings:\n${webContent}`
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
