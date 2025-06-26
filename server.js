import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { OpenAI } from 'openai';
import axios from 'axios';
import { createRequire } from 'module';
import https from 'https';

const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

config();
const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SERP_API_KEY = process.env.SERP_API_KEY;

// Axios instance that ignores invalid SSL certificates
const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 8000
});

async function searchFundingPrograms(address) {
  const query = `EV charging rebates incentives site:.gov "${address}"`;
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}&num=5`;

  const res = await axiosInstance.get(url);
  const results = res.data.organic_results || [];

  return results.map(result => result.link).slice(0, 3);
}

async function scrapePageText(url) {
  try {
    if (url.endsWith('.pdf')) {
      console.warn('Skipping PDF:', url);
      return '[PDF link skipped: not supported for scraping]';
    }

    const res = await axiosInstance.get(url);
    const $ = cheerio.load(res.data);
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return text.slice(0, 4000); // limit to 4000 chars
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
    const webContent = texts.filter(Boolean).join('\n\n');

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
