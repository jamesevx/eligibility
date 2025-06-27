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

// Simple helper to extract US state abbreviation from address
function extractState(address = '') {
  const stateMatch = address.match(/,\s*([A-Z]{2})\s*\d{5}/);
  return stateMatch ? stateMatch[1] : '';
}

// Build custom search queries
function buildSearchQueries(formData) {
  const state = extractState(formData.siteAddress);
  const usage = (formData.usageTypes || []).join(', ');
  const chargerType = formData.chargerType || '';
  const utility = formData.utilityProvider || '';

  const queries = [];

  if (usage && utility && state) {
    queries.push(`"${usage}" EV charging rebates "${utility}" "${state}"`);
  }

  if (state && chargerType) {
    queries.push(`"${state}" EV charging rebates "${chargerType}"`);
  }

  if (state && usage) {
    queries.push(`"${state}" EV charging rebates "${usage}"`);
  }

  if (state) {
    queries.push(`"${state}" EV charging tax credits`);
  }

  queries.push(`IRS30C Tax Credit`);

  return queries;
}

// SERP API search
async function searchFundingPrograms(queries) {
  const allLinks = new Set();

  const fetches = queries.map(async (query) => {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}&num=5`;
    try {
      const res = await axios.get(url);
      const results = res.data.organic_results || [];
      results.forEach(result => allLinks.add(result.link));
    } catch (err) {
      console.error(`Search failed for query "${query}":`, err.message);
    }
  });

  await Promise.all(fetches);
  return [...allLinks].slice(0, 8); // limit to top 8 links
}

// Scrape HTML or PDF
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
    console.error(`Failed to scrape ${url}:`, err.message);
    return '';
  }
}

// Main endpoint
app.post('/api/evaluate', async (req, res) => {
  const { formData } = req.body;

  const searchQueries = buildSearchQueries(formData);
  const urls = await searchFundingPrograms(searchQueries);
  const texts = await Promise.all(urls.map(url => scrapePageText(url)));
  const webContent = texts.filter(Boolean).join('\n\n') || 'No relevant web content found.';

  const formattedInput = JSON.stringify(formData, null, 2);

  const messages = [
    {
      role: 'system',
      content: `
You are a highly paid, expert-level clean energy funding consultant with access to real-time search via the SERP API. Your role is to assess a single EV charging project site and provide a clear, accurate, and thorough one-page summary of **all potential funding opportunities** available to that project.

You must return a one-page report with sections for:
- Federal Funding
- State Funding
- Utility Incentives
- Local/Regional Programs
- Private/Other Incentives

Only describe general program eligibility (e.g. “Up to $4,000 per L2 charger through utility rebate”). Do not name specific programs. Include a disclaimer.
`
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
