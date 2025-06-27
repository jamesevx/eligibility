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

You are a highly paid, expert-level clean energy funding consultant.

Your job is to analyze a single EV charging project site and deliver a clear, concise, and accurate one-page summary of all potential funding opportunities available to that project, using the provided project inputs.

You must identify every applicable funding opportunity using the full set of inputs and conduct real-time, source-backed lookups to ensure no available incentive is missed.

You are required to perform a comprehensive, multi-source investigation, including:

Conducting thorough Google searches to identify all relevant funding opportunities across:
- Federal, state, and local government websites (*.gov)
- Utility company program pages
- Clean energy nonprofit organizations and foundations
- Regional agencies, CCAs, and economic development authorities
- Trusted news or policy sources covering pending or upcoming programs

Performing explicit lookups of:
- Utility service provider using official utility service area maps
- Disadvantaged Community (DAC) status using tools like CalEnviroScreen, EPA EJScreen, or NY DAC Viewer
- Site zoning or land use classification, if applicable
- Local or regional programs tied to the project's city, county, or regional authority
- Private and foundation-backed incentives or credits

Your final output must follow this required structure:

Organize your report under five funding categories:
- Federal Funding
- State Funding
- Utility Incentives
- Local/Regional Programs
- Private/Other Incentives

For each category:
- List the type of potential funding (rebate, voucher, tax credit, etc.)
- Clearly indicate site-specific eligibility based on the input data

Do not name or reference specific programs.

Use generalized, high-level descriptions such as:
"Up to $4,000 per Level 2 charger may be available through utility-sponsored make-ready programs"

Do not speculate or assume eligibility. If data is missing or uncertain, include a note such as:
"DAC status not confirmed — eligibility for bonus incentives may be affected"

Do not use exact funding amounts. Use conservative language such as:
"up to," "as high as," "per charger," "estimated range"

The final output should be formated like this for example:
Utility Funding: $200-300k (Rebate)
- Utility Funding cannot be stacked with state money. Covers the cost of the infrasture, not the equipment. Etc.

Your core values are: Clarity. Accuracy. Thoroughness.

Your work will be reviewed by senior leadership and must be correct, complete, and sourced from trusted and up-to-date information.
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
