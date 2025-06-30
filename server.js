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

---

## Web Search Instructions

You must search for relevant EV charging incentives using the following phrases:

- "${formData.usageType} ${formData.utilityProvider} EV charger rebates for ${formData.chargerType} in ${extractState(formData.siteAddress)}"
- "${formData.usageType} EV charging incentives and rebates for ${formData.chargerType} in ${extractState(formData.siteAddress)}"

ONLY USE INFORMATION FOUND ON **official utility websites** for utility funding information and **.gov websites** for state funding. MAKE SURE THE INFORMATION YOU ARE USING IS THE MOST UP TO DATE INFORMATION AVAILABLE ON THESE SITES.

**DO NOT USE DATA OR INFORMATION PULLED OFF OF unofficial blogs, PDFs, vendor websites, or third-party incentive websites.**

---

## Evaluation Criteria

You must categorize the incentives into the following groups:

1. **Federal Tax Credits** (e.g. IRS 30C)
2. **State Tax Credits**
3. **State Incentive Funding**
4. **Utility Incentives**
5. **Local or Regional Programs**
6. **Private or Other Incentives**

---

## Required Logic and Constraints

- Match incentives by:
  - Number of chargers
  - Charger Type
  - Charger kW rating
  - Number of ports
  - Port kW rating
  - Public access
  - DAC status
  - Use case (e.g. fleet, public, multifamily)

- Use **exact multiplier math** when internet content provides:
  - $ per port
  - $ per charger
  - $ per kW

  *(e.g., 6 ports × $68,750 if DAC and 240kW output)*

- If you are not 100% certain what funding amount the customer qualifies for, provide a funding rnage (e.g., $55k–$68.75k).
- For each funding category, categorize the funding amounts by funding for available for charegrs or for makeready/infrastucture costs

---

## Federal Tax Credit Rule

- **Do NOT estimate a dollar amount.**
- Instead, list IRS 30C rules: *30% of eligible costs, capped at $100,000 per charger.*
- Include disclaimer: Prevailing wage + apprenticeship required.
- Link to Census tool: https://mtgis-portal.geo.census.gov/arcgis/apps/experiencebuilder/experience/?id=dfcab6665ce74efe8cf257aab47ebee1

---

## Stacking Rules

- Identify whether any funding **cannot be combined** (e.g., state + utility).
- Clearly state "Cannot be stacked" and **do not add them together** in totals.

---

## Output Format

1. **Project Summary**  
Use the project description (already formatted above).

2. **Funding Estimates (with ranges):**

Example format:

**Utility:** $300,000–400,000  
*Utility Funding explanation. Do not name the program. Note stackability and requirements.*

**State:** $100,000  
*State Funding explanation...*

**Federal Tax Credits:** $0  
*IRS 30C eligibility info here...*

3. **Incentive Funding Summary**

Example:



Incentive Funding Summary:
Utility: $300-$400k (Can be stacked)
State: $100k (Cannot be stacked)
Federal Tax Credits: $0


---

## Final Instruction

Avoid hallucinations. If unsure or no information found, state “Unknown” or “Not found online.” Always include URLs in citations.

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
