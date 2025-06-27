// Updated server.js using OpenAI web_search_preview tool

import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { OpenAI } from 'openai';

config();
const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
${dacStr}`.trim();
}

// Main API endpoint using OpenAI's web_search_preview tool
app.post('/api/evaluate', async (req, res) => {
  const { formData } = req.body;
  const formattedInput = formatProjectDescription(formData);

  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1',
      tools: [{ type: 'web_search_preview' }],
      input: `Estimate available EV charging incentives for the following project:

${formattedInput}

Please categorize funding into:
- Federal Tax Credits
- State Tax Credits
- State Funding
- Utility Incentives
- Local/Regional Programs
- Private/Other Incentives

Provide approximate dollar amounts, justification, and source citations where possible.
Format the output like this for example:
Utility: $300k-400k
*utility explanation/details:
`
    });

    const messageItem = response.choices.find(item => item.type === 'message');
    const content = messageItem?.content?.[0]?.text || 'No response.';
    res.json({ result: content });
  } catch (error) {
    console.error('OpenAI error:', error);
    res.status(500).json({ error: 'Failed to evaluate funding eligibility' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
