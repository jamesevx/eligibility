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
  const usage = formData.usageType || '';
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

You will be given a complete project input from the user filling the form including (but not limited to):
- Site address
- Number and type of chargers (e.g., 7 Level 2, 19.2 kW)
- Use case (e.g., commercial, multifamily, workplace, office, government/municipal,fleet)
- And additional information

Your job is to identify **every applicable funding opportunity** based on this input while cross referencing the users input to the data scrapped from the SERP google searches.
- Federal, state, and local government websites (*.gov)
- Utility program pages
- Verified clean energy nonprofits and foundations

You must cross reference all of the information that the user is inputting with the data scrapped from SERP. Using all of this information, estimate to the best of your accuracy, how much money the customer is potentially elegible for.

Output must follow these formatting rules:

1. **Structure your response using the following 5 categories**:
   - Federal Tax Credits
   - State Tax Credits
   - State Funding
   - Utility Incentives
   - Local/Regional Programs
   - Private/Other Incentives (e.g., LCFC, private credits, etc.)

2. **For each category**, First give the funding estimate like this: "Utility: $200k-300k", then underneath that list the *type of potential funding* (e.g., rebate, voucher, tax credit) and indicate high-level eligibility **based on the provided site information**.

3. **Never list or name specific programs**. Instead, describe the general eligibility and format of potential support, e.g.:
   - “Up to $4,000 per Level 2 charger available through utility-backed make-ready programs”
   - “May be eligible for tax credits up to 30% of installation cost based on site type”

4. Do not speculate or assume any eligibility. If required data is missing, clearly state what is needed (e.g., “DAC status not confirmed – may affect eligibility for state multiplier incentives.”)

5. **Do not claim exact funding amounts.** Use conservative language like “up to,” “as high as,” “estimated range,” or “per charger/per port.”

6. The final report should be **concise, one-page maximum**, and written in clear, professional language appropriate for delivery to a client or executive stakeholder.
`
    },
    {
      role: 'user',
      content: `Customer Project Details:\n${formattedInput}\n\nRelevant Internet Findings:\n${webContent}`
    }
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
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
