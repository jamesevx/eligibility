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
    usageType,
    vehicleType
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

  const vehicleStr = vehicleType
    ? `The chargers will service ${vehicleType} vehicles.`
    : '';

  return `
This EV charging project is located at ${siteAddress || 'an unspecified address'} and is served by utility ${utilityProvider || 'unknown'}.
The project includes ${chargerStr} ${portStr}.
It is intended for ${usageType || 'general'} use and provides ${publicAccess || 'unknown'} access to the public.
${dacStr} ${vehicleStr}`.trim();
}

// Main API endpoint using OpenAI's web_search_preview tool
app.post('/api/evaluate', async (req, res) => {
  const { formData } = req.body;
  const formattedInput = formatProjectDescription(formData);

  try {
    const response = await openai.responses.create({
      model: 'gpt-4o',
      temperature: 0.1,
      tools: [{ type: 'web_search_preview', search_context_size: "high"}],
      input: `Estimate available EV charging incentives for the following project:

${formattedInput}

---

## Web Search Instructions

You must search for relevant EV charging incentives using the following phrases:

- "${formData.usageType} ${formData.utilityProvider} EV charger rebates for ${formData.chargerType} charging ${formData.vehicleType} in ${extractState(formData.siteAddress)}"
- "${formData.usageType} EV charging incentives and rebates for ${formData.chargerType} in ${extractState(formData.siteAddress)}"

## Utility Incentive Rule (MANDATORY)

For **utility incentive funding**, you MUST ONLY use data from the **official utility provider website** (e.g., coned.com, sce.com, psegli.com).  
❌ DO NOT USE: 3rd-party aggregators, vendors, blogs, or PDFs unless the URL is clearly from the utility's own domain.  
✅ ONLY ACCEPT information from the **utility's official website** for utility funding.  

## State Incentive Rule (UPDATED)
For state-level funding:
- ✅ Prioritize .gov and .org, state incentive sites (e.g., nyserda.ny.gov), and trusted official sources.
- ⚠️ If no .gov source is found, **use reputable nonprofit sites .org sites such as (e.g., caletc.org, cleancities.org, calevip.org)**.
- ❌ Do NOT use blogs, random PDFs, or installer marketing pages.

## State Tax Credit Rule
- ✅ Prioritize searching .gov and .org websites or state agency portals for state tax credits, for example www.tax.ny.gov.
- ❌ Avoid using third party websites if you can.
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
  - Vehicle type (light-duty vs medium or heavy duty)

- Use **exact multiplier math** when internet content provides:
  - $ per port
  - $ per charger
  - $ per kW

  *(e.g., 6 ports × $68,750 if DAC and 240kW output)*

- If you are not 100% certain what funding amount the customer qualifies for, provide a funding range (e.g., $55k–$68.75k).
- For each funding category, categorize the funding amounts by funding available for chargers or for make-ready/infrastructure costs.

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

**State Tax Credits:** $5000 per port
*State Tax Credit explanation*

3. **Incentive Funding Summary**

Example:

Incentive Funding Summary:  
Utility: $300-$400k (Can be stacked)  
State: $100k (Cannot be stacked)
State Tax Credits: up to $5000 per port
Federal Tax Credits: $0

---

## Final Instruction

Double-check all web search results before using them. For Utility funding, if a page is not from the **official utility website**, it must not be used for funding estimates. 

If no official source is found, clearly state:
- “No utility incentive funding found on [Utility Name] official website.”

Always include a URL in your citations and state the domain name of the source used (e.g., "coned.com").

Avoid hallucinations. NEVER assume funding details that are not explicitly stated on eligible sources.
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
