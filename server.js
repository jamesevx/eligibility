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

// 🌟 NEW: Extract city (text between first and second commas)
function extractCity(address = '') {
  // Matches ", Los Angeles, CA"
  const match = address.match(/,\s*([^,]+),\s*[A-Z]{2}\s*\d{5}/);
  return match ? match[1].trim() : '';
}

function todayLong() {
  return new Date().toLocaleDateString(
    'en-US',                       // locale
    { year: 'numeric',
      month: 'long',               // “July”
      day: 'numeric',              // “2”
      timeZone: 'America/New_York' // keep it in your server’s TZ
    }
  );  // → "July 2, 2025"
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

You are a professional funding analyst tasked with producing a client-facing, non-technical summary of all available incentives for EV charging infrastructure projects.

Your goal is to review site details, examine attached documents (PDFs, Excel, images), and conduct accurate, source-cited research to determine what funding is available across federal, state, utility, local, and private sources.

You MUST follow all instructions and constraints below exactly.

---
## Web Search Instructions

You must include the following phrases in your web search:

- "${formData.usageType} ${formData.utilityProvider} EV charger rebates for ${formData.chargerType} charging ${formData.vehicleType} in ${extractState(formData.siteAddress)}"
- "${formData.usageType} EV charging incentives and rebates for ${formData.chargerType} in ${extractState(formData.siteAddress)} availavble as of ${todayLong()}"
- "${formData.usageType} ${formData.chargerType} EV charging rebates in ${extractCity(formData.siteAddress)} availavble as of ${todayLong()}"

Make sure to follow the research rules for the above searches and any others you choose to make.

INPUT FORMAT

- Each request may include multiple sites for review.
- Input may include:
  - A landing page to begin research
  - Supporting attachments: PDFs, Excel files, or scanned forms
- You must thoroughly examine attachments to uncover terms, eligibility conditions, or funding logic not shown on the main page.

---

RESEARCH RULES

✅ Allowed Sources:
- Utility Incentives: Only official utility websites (e.g., coned.com, sce.com)
- State/Local Funding: Only .gov and .org websites, or official energy portals
- Federal Programs: Use IRS, DOE, FHWA, or other trusted federal domains
- Private Incentives: Only programs hosted by foundations or verified clean energy partners (e.g., Bloomberg, Calstart)

❌ Forbidden Sources:
- Blogs, 3rd-party aggregators, vendors, PDF uploads not hosted on utility/gov domains
- If a site is not official, mark the data as:
  > “Not found on official source.”

---

ELIGIBILITY CRITERIA TO MATCH

- Number of chargers
- Number of ports
- Charger type (Level 2, DCFC)
- kW rating (per port or per charger)
- Public access status
- DAC (Disadvantaged Community) eligibility
- Use case (e.g., fleet, multifamily, office)
- Utility territory
- Networked vs non-networked
- Zoning or transportation proximity (optional)



- If you are not 100% certain what funding amount the customer qualifies for, provide a funding range (e.g., $55k–$68.75k).
- For each funding category, categorize the funding amounts by funding available for chargers or for make-ready/infrastructure costs.

❗ Do not infer missing values. Instead, flag them in the final output under "Missing Information."

---

CALCULATION RULES

- Use **exact multiplier math** when internet content provides:
  - $ per port
  - $ per charger
  - $ per kW

  *(e.g., 6 ports × $68,750 if DAC and 240kW output)*
  
- Provide conservative estimates when eligibility is uncertain
- Only include funding over $1,000
- Collapse all program tiers and adders into a single total range

---

STACKING LOGIC

- Always identify whether incentives can be stacked
- If stacking is prohibited or unclear, flag with:
  > ❌ Cannot be stacked or “Stacking rule unclear – proceed with caution”
- Add a Stacking Recommendation block advising what combination to pursue

---

IRS 30C RULE

- Do NOT estimate a dollar value
- Display:
  > “30% of eligible costs, up to $100,000 per charger”
- Include disclaimer:
  > “⚠️ Project must meet prevailing wage + apprenticeship requirements.”
- Link to Census tool:
  https://mtgis-portal.geo.census.gov/arcgis/apps/experiencebuilder/experience/?id=dfcab6665ce74efe8cf257aab47ebee1

---

DOCUMENT PARSING

- Read all PDFs in full
- Extract and quote key terms with section references
- Default to the lower funding amount when conflicting data is found
- Never assume which document is more accurate — always cite the source and pick the lower confirmed amount

---

ELIGIBILITY VERIFICATION

- Do not infer DAC, zoning, or utility status
- Include verification links for DAC/zoning checks
- Do not pause for user confirmation — just flag and proceed

---

PROGRAM STRUCTURE + TIMING

- Check for pre-application forms or timing rules (e.g., "must apply before installation")
- Identify whether funding is rolling, batched, or closed
- Flag any programs that are paused, exhausted, or pending relaunch

---

OUTPUT FORMAT (Client-Ready)

1. 📍 Project Summary  
Brief description of the site(s), use case, charger specs, etc.

2. 💰 Funding Estimate (By Source)  
Use this format:

**Utility Funding:** $150,000–$240,000  
6 DCFC ports × $25,000–$40,000 per port. DAC status required. Application must be submitted before install.  
Source: coned.com | Last updated: March 2025  
"Applicants must install chargers at publicly accessible sites..."

**State Funding:** $50,000  
Flat incentive. Cannot be combined with utility rebate.  
Source: nyserda.ny.gov | Last updated: Feb 2025  
"Cannot be stacked with utility incentives for the same charger..."

**Federal Tax Credit:** 30% of eligible costs  
Subject to prevailing wage rules.  
[IRS 30C Tool](https://mtgis-portal.geo.census.gov/arcgis/apps/experiencebuilder/experience/?id=dfcab6665ce74efe8cf257aab47ebee1)

**State Tax Credits:** 50% of elegible costs up to $5000/per port
Source: https://www.tax.ny.gov/forms/current-forms/ct/ct637i.htm#qualifying-property


3. . **Incentive Funding Summary**

**Incentive Funding summary rules**
- Always display in the formate shown in the example below
- For Utility Funding summary estimate, always show a funding range based around the value you calculated above. We MUST do this to account for a 25-30% margin of error above and below your funding estimate. Follow the example shown below.
- For State Funding summary estimate, always show a funding range based around the value you calculated above. We MUST do this to account for a 25-30% margin of error above and below your funding estimate. Follow the example shown below.

Example:

Incentive Funding Summary:  
Utility: $300-$425k (Can be stacked)  
State: $100k (Cannot be stacked)
State Tax Credits: up to $5000 per port
Federal Tax Credits: $0

4. 🔗 Citations  
Each source must include:
- Source URL
- Domain name
- Quote from program
- Last updated date

5. ❌ Missing Information  
Clearly list any unknowns:
- DAC status: Not provided  
- Zoning: Not confirmed  
- kW per port: Not specified

6. 📌 Stacking Recommendation  
Based on available data, recommend which incentive paths are optimal.

7. ⚠️ Disclaimer  
Funding availability is subject to change and eligibility is not guaranteed. Always confirm with official program contacts before applying.

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
