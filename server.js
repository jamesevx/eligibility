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

// Build search query using both address and utility
async function searchFundingPrograms(address, utility) {
  const query = `What EV charging rebates or incentives are available at "${address}" the utility company is "${utility}"`;
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}&num=5`;

  try {
    const res = await axios.get(url);
    const results = res.data.organic_results || [];
    return results
      .map(result => result.link)
      .slice(0, 5); // limit to top 5
  } catch (err) {
    console.error('Search failed:', err.message);
    return [];
  }
}

async function scrapePageText(url) {
  try {
    if (url.toLowerCase().endsWith('.pdf')) {
      console.log(`Scraping PDF: ${url}`);
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
      const data = await pdf(res.data);
      return data.text.replace(/\s+/g, ' ').trim().slice(0, 4000);
    } else {
      console.log(`Scraping HTML: ${url}`);
      const res = await axios.get(url, { timeout: 8000 });
      const $ = cheerio.load(res.data);
      return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 4000);
    }
  } catch (err) {
    console.error(`Failed to scrape ${url}:`, err.message);
    return '';
  }
}

app.post('/api/evaluate', async (req, res) => {
  const { formData } = req.body;

  const address = formData?.siteAddress || formData?.address || '';
  const utility = formData?.utilityProvider || formData?.utility || '';

  const formattedInput = JSON.stringify(formData, null, 2);

  try {
    const urls = await searchFundingPrograms(address, utility);
    const texts = await Promise.all(urls.map(url => scrapePageText(url)));
    const webContent = texts.filter(Boolean).join('\n\n') || 'No relevant web content found.';

    const messages = [
      {
        role: 'system',
        content: `You are an EV charging funding expert.

Use the customer's inputs and supplemental web findings to estimate likely EV charging incentives and rebates.

Provide:
- Estimated funding **ranges in USD** per category: Utility, Federal, State, Local, Tax Credits, and Other.
- **Program names or references** where possible.
- A brief rationale for each estimate.
- A disclaimer that this is an estimate, not a guarantee.`
      },
      {
        role: 'user',
        content: `Customer Project Details:\n${formattedInput}\n\nRelevant Internet Findings (address: "${address}", utility: "${utility}"):\n${webContent}`
      }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
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
