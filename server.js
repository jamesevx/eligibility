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
      model: 'gpt-4o',
      tools: [{ type: 'web_search_preview', search_context_size: "high"}],
      input: `Estimate available EV charging incentives for the following project:

${formattedInput}

Please categorize funding into:
- Federal Tax Credits (Look up information on IRS 30C)
- State Tax Credits
- State Funding
- Utility Incentives
- Local/Regional Programs
- Private/Other Incentives

Your analysis must:
- Identify **charger quantity, kW rating**, and **port count/output**
- Check if internet findings mention per-kW, per-port, or per-charger incentives
- Also check if the internet findings mention different per port funding calculations based on all criteria including but not limited to: Disadvantaged communities, project type (commercial, multifamily, etc.)
- Estimate **total potential funding** by matching all of the above information to the customer's project description
- Also, make sure to check if the funding can be stacked. For instance, the Utility money may be available, and so is state funding, but it CANNOT be stacked together. If so mention that and don't add them in the total together, itemize them separately mentioning they are not stackable.
- Do NOT count Nevi funding as the project has been paused, do not mention it or factor it in

As an Example: If internet content for utility funding “$68,750 per 150 to 274 kW port for DAC projects & $55,000 per 150 to 274 kW ports for NON DAC projects”, and customer has 6 ports at 240 kW in a DAC, then total utility incentive = 6 × $68,750. Use this type of logic to formulate the estimating funding for each of the categories I've described. However, since we are not 100% certain that this is accurate, lets show an approximate range. So if tier below $68,750/port is 55,000/port, we show a utility funding range of $330k-412.5k. Use this same logic for all other funding categories (EXCEPT for federal tax  credit funding) by showing an estimated range of funding.

For Federal we DO NOT want to show a range. We do not know the exact project cost based on the user input. So instead list out the IRS30C tax credit benefits (ex: 30% of project costs capped at $100,000 per charger). Include a disclaimer about needing to meet prevailing wage and apprenticeship requirements and that to be eligible they need to check if they’re in a census tract. As a bonus, if you’re able to, navigate through the US census track website and check if their address is in an eligible census track: https://mtgis-portal.geo.census.gov/arcgis/apps/experiencebuilder/experience/?id=dfcab6665ce74efe8cf257aab47ebee1

In each category make sure to consider DAC status, public access, utility name, and use case.

Provide approximate dollar amount ranges (100-200k), justification, and source citations where possible.

For your output, Do the following:

- Provide a brief summary of the project using formatProjectDescription.
- Then summarize the funding in each category like this, shown below:
Utility: $300k–400k
*Utility Funding explanation: Provide a brief summary of the utility funding details. DO NOT name the utility program or disclose critical program details. Mention whether the funding can be stacked with other programs

Once you've listed out all of the categories of funding, show a final summary of all incentive funding like this example below:

Incentive Funding Summary:
Utility: $300-$400k (Can be stacked)
State: $100k (Cannot be stacked)
Federal Tax Credits: $0
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
