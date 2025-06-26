// server.js
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { OpenAI } from 'openai';
import axios from 'axios';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cheerio = require('cheerio');
const pdf = require('pdf-parse');

config();
const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SERP_API_KEY = process.env.SERP_API_KEY;

async function searchFundingPrograms(address, utility) {
  const queries = [
    `EV charger funding incentives ${address} ${utility}`,
    `EV charging site rebates ${address} ${utility}`,
    `EVSE make-ready incentives ${utility} site:.gov`,
    `EV charging tax credits ${address}`,
    `EV infrastructure funding programs ${utility}`
  ];

  const results = [];
  for (const query of queries) {
    try {
      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}&num=5`;
      const res = await axios.get(url);
      const links = (res.data.organic_results || []).map(r => r.link);
      results.push(...links);
    } catch (err) {
      console.error('Search error:', err.message);
    }
  }

  // Remove duplicates and limit to top 7
  return [...new Set(results)].slice(0, 7);
}

async function scrapePageText(url) {
  try {
    if (url.toLowerCase().endsWith('.pdf')) {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
      const data = await pdf(res.data);
      return data.text.replace(/\s+/g, ' ').trim().slice(0, 4000);
    } else {
      const res = await axios.get(url, { timeout: 8000 });
      const $ = cheerio.load(res.data);
      return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 4000);
    }
  } catch (err) {
    console.error(`Scrape failed for ${url}:`, err.message);
    return '';
  }
}

app.post('/api/evaluate', async (req, res) => {
  const { formData } = req.body;
  const address = formData?.siteAddress || formData?.address || '';
  const utility = formData?.utilityProvider || formData?.utility || '';

  const urls = await searchFundingPrograms(address, utility);
  const texts = await Promise.all(urls.map(scrapePageText));
  const webContent = texts.filter(Boolean).join('\n\n') || 'No relevant online content found.';

  const formattedInput = JSON.stringify(formData, null, 2);

  const messages = [
    {
      role: 'system',
      content: `You are a highly paid, expert-level clean energy funding consultant with access to real-time search via the SERP API. Your role is to assess a single EV charging project site and provide a clear, accurate, and thorough one-page summary of all potential funding opportunities available to that project.\n\nUse the provided project input and internet findings to identify likely support under:\n\n- Federal Funding\n- State Funding\n- Utility Incentives\n- Local/Regional Programs\n- Private/Other Incentives\n\nDo not name programs. Describe eligibility types using conservative ranges, note required missing info (e.g. DAC status), and end with a short disclaimer. Keep the language professional and executive-ready.`
    },
    {
      role: 'user',
      content: `Customer Project Details:\n${formattedInput}\n\nRelevant Internet Findings:\n${webContent}`
    }
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
      temperature: 0.2
    });

    const responseText = completion.choices[0].message.content;
    res.json({ result: responseText });
  } catch (error) {
    console.error('OpenAI error:', error);
    res.status(500).json({ error: 'Failed to evaluate funding eligibility.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
