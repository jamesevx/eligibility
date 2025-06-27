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

// Extract US state from address
function extractState(address = '') {
  const match = address.match(/,\s*([A-Z]{2})\s*\d{5}/);
  return match ? match[1] : '';
}

// Format form data into natural project description
function formatProjectDescription(formData) {
  const {
    siteAddress,
    utilityProvider,
    numChargers,
    chargerType,
    chargerKW,
    numPorts,
    portKW,
    publicAccess,
    disadvantagedCommunity,
    usageType
  } = formData;

  const chargerStr = numChargers && chargerKW
    ? `${numChargers} ${chargerType || ''} chargers rated at ${chargerKW} kW each`
    : '';

  const portStr = numPorts && portKW
    ? `with ${numPorts} ports delivering up to ${portKW} kW each`
    : '';

  const dacStr = disadvantagedCommunity === 'Yes'
    ? `The site is located in a Disadvantaged Community.`
    : disadvantagedCommunity === 'No'
    ? `The site is not located in a Disadvantaged Community.`
    : '';

  return `
This EV charging project is located at ${siteAddress || 'an unspecified address'} and is served by utility ${utilityProvider || 'unknown'}.
The project includes ${chargerStr} ${portStr}.
It is intended for ${usageType || 'general'} use and provides ${publicAccess || 'unknown'} access to the public.
${dacStr}
`.trim();
}

// Custom search query builder
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

// Scrape HTML or PDF page content
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
  return [...allLinks].slice(0, 8); // Limit to top 8
}

// Main API endpoint
app.post('/api/evaluate', async (req, res) => {
  const { formData } = req.body;

  const searchQueries = buildSearchQueries(formData);
  const urls = await searchFundingPrograms(searchQueries);
  const texts = await Promise.all(urls.map(url => scrapePageText(url)));
  const webContent = texts.filter(Boolean).join('\n\n') || 'No relevant web content found.';

  const formattedInput = formatProjectDescription(formData);

  const messages = [
    {
      role: 'system',
      content: `
You are a clean energy funding consultant. Your task is to:
1. Carefully read the customer’s EV charging project details.
2. Carefully review relevant internet content (HTML/PDF).
3. **Cross-reference** both to identify any clearly matching rebate values, tax credit percentages, or funding limits.

Your analysis must:
- Identify **charger quantity, kW rating**, and **port count/output**
- Check if internet findings mention per-kW, per-port, or per-charger incentives
- Also check if the internet findings and the per port calculations mention other criteria like DAC, project type (commercial, multifamily, etc.)
- Estimate **total potential funding** by matching that to the customer's project size

Example: If internet content says “$68,750 per 240 kW port”, and customer has 6 ports at 240 kW, then total utility incentive = 6 × $68,750

Also consider DAC status, public access, utility name, and use case.

Structure your output:
- Federal Tax Credits
- State Tax Credits
- State Funding
- Utility Incentives
- Local/Regional Programs
- Private/Other Incentives

For these outputs structure them like the following:
Utility: $240k-300k
*explanation of reasoning

Always explain your assumptions, match logic, and note any missing data.
End with a disclaimer.`
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
