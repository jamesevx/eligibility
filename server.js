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

Your analysis must:
- Identify **charger quantity, kW rating**, and **port count/output**
- Check if internet findings mention per-kW, per-port, or per-charger incentives
- Also check if the internet findings mention different per port funding calculations based on all criteria including but not limited to: Disadvanted communities, project type (commercial, multifamily, etc.)
- Estimate **total potential funding** by matching all of the above information to the customer's project description
- Also, make sure to check if the funding can be stacked. For instance, the Utility money may be available, and so is state funding, but it CANNOT be stacked together. If so mention that and don't add them in the total together, itemize them seperately mentioning they are not stackable.

As an Example: If internet content says “$68,750 per 150 to 274 kW port for DAC projects”, and customer has 6 ports at 240 kW in a DAC, then total utility incentive = 6 × $68,750. Use this type of logic to formulate the estimating funding for each of the categories I've described. However, since we are not 100% certain that this is accurate, lets show an approximate range. So if tier below $68,750/port is 55,000/port, we show a utility funding range of $330k-412.5k. Use this same logic for all other funding categories by showing an estimated range of funding.

Also consider DAC status, public access, utility name, and use case.

Provide approximate dollar amount ranges (100-200k), justification, and source citations where possible.

Format the output like this for example:
Utility: $300k–400k
*Utility Funding explanation/details:
`
    });

    // ✅ FIX: Properly extract assistant message from OpenAI response
    let content = 'No response.';
    if (response && Array.isArray(response.output)) {
      const messageItem = response.output.find(item => item.type === 'message');
      if (messageItem?.content?.[0]?.text) {
        content = messageItem.content[0].text;
      }
    }

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
