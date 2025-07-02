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

// -------------------- State Abbreviation → Full Name --------------------
const stateMap = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',MS: 'Mississippi', MO: 'Missouri',MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia'
};

// Helper: return full state name, or the original input if not found
function getFullStateName(abbr = '') {
  return stateMap[abbr.toUpperCase()] || abbr;
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
    ? `${numChargers} ${chargerType || ''} chargers rated at ${chargerKW} kW each,`
    : '';

  const portStr = numPorts && portKW
    ? `with ${numPorts} total ports delivering up to ${portKW} kW per port`
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

# ACCURACY PRINCIPLE
Treat every numeric incentive value as “best evidence ± 25 %”.  
Never present a single-point dollar figure.  
When sources conflict, cite the lower officially published amount.

---

## Web Search Instructions
Issue *at least* these three searches (add more as needed):

1. "${formData.usageType} ${formData.utilityProvider} EV charger rebates for ${formData.chargerType} charging ${formData.vehicleType} in ${extractState(formData.siteAddress)} ${todayLong()}"
2. "${extractCity(formData.siteAddress)} ${extractState(formData.siteAddress)} public ${formData.chargerType} charging incentives and rebates ${todayLong()}"
3. "${formData.chargerType} rebates ${getFullStateName(extractState(formData.siteAddress))} ${todayLong()}"
4. "${getFullStateName(extractState(formData.siteAddress))} ${formData.chargerType} charger rebate programs available in ${extractCity(formData.siteAddress)} site:.gov OR site:.org ${todayLong()}"
5. "${formData.utilityProvider} ${formData.usageType} ${formData.chargerType} rebate incentive chart pdf site:${formData.utilityProvider.split(' ')[0].toLowerCase()}* ${todayLong()}"
6. "${formData.utilityProvider} ${formData.usageType} ${formData.chargerType} rebate program guide pdf site:${formData.utilityProvider.split(' ')[0].toLowerCase()}* ${todayLong()}"

Follow the research rules for these and any additional searches.

---

### RANGE RULE (mandatory)
For any computed estimate **X**:  
• *Lower*  = round(X × 0.75, −3)   // nearest $1 000  
• *Upper*  = round(X × 1.25, −3)  
Display ranges as **$\${Lower/1000}k–$\${Upper/1000}k**.  
*Example*: 120 000 → **$90k–$150k**

**Exception:**  
Do **not** apply this rule to statutory percentage credits (e.g., “30 % of eligible costs, up to $100 000 per charger” under IRS 30C). Leave those figures unchanged.
---

### INPUT FORMAT
• Each request may include multiple sites for review.  
• Input may contain landing pages or attachments (PDF, Excel, images).  
• Thoroughly examine attachments for hidden terms, caps, or eligibility logic.

---

### RESEARCH RULES
✅ Allowed Sources  
 • Utility incentives: official utility domains (coned.com, sce.com, ladwp.com, etc.)  
 • State/local funding: *.gov* or trusted *.org* portals  
 • Federal programs: IRS, DOE, FHWA, FHWA, etc.  
 • Private: foundation or verified clean-energy organizations (e.g., Bloomberg, CALSTART)

❌ Forbidden Sources  
 • Blogs, third-party aggregators, vendor marketing pages  
 • PDFs not hosted on allowed domains  
 → If data comes from a non-official source, mark: “Not found on official source.”

---
### STATE PROGRAM CHECK
If your first pass finds no state-level incentives, perform an extra search:
  "${getFullStateName(extractState(formData.siteAddress))} EV charging incentives ${formData.chargerType}"
If still none are found, state “Not found on official source” in the output
but keep the section in place.

---

### RECENCY RULE
Only cite documents that list a “last updated,” “revised,” or publication date **within the last 18 months**.  
If no date exists, prefer the newest URL (e.g., 2025-, 2024-).  
If two versions conflict, cite both and keep the newer one for calculations.

---

### ELIGIBILITY CRITERIA TO MATCH
• Number of chargers / ports  
• Charger type (L2 / DCFC) and kW rating  
• Public-access status  
• DAC eligibility  
• Use case (fleet, multifamily, office, etc.)  
• Utility territory & network requirement  
• Zoning / transportation proximity (if applicable)

If any value is unknown, flag it under **Missing Information**.

---

### CALCULATION RULES
• Apply exact multiplier math when source data gives $/port, $/charger, or $/kW.  
  (e.g., 6 ports × $68 750 if DAC & 240 kW output)  
• Provide conservative estimates when eligibility is uncertain.  
• Only show incentives above $1 000.  
• Collapse tiers & adders into a single total range (use RANGE RULE).

---

### STACKING LOGIC
• State whether each incentive can be stacked.  
• If stacking is prohibited or unclear, flag: “❌ Cannot be stacked” or “Stacking rule unclear – proceed with caution.”  
• Add a **Stacking Recommendation** block suggesting the optimal combination.

---

### IRS 30C RULE
Display **only**:  
“30 % of eligible costs, up to $100 000 per charger”  
⚠️ “Project must meet prevailing wage + apprenticeship requirements.”  
Link: https://mtgis-portal.geo.census.gov/arcgis/apps/experiencebuilder/experience/?id=dfcab6665ce74efe8cf257aab47ebee1

---

### DOCUMENT PARSING
• Read every PDF fully; quote key terms with section refs.  
• When a utility landing page references an “Incentive Chart,” “Program Brochure,” or similar PDF, open it and parse dollar caps before concluding no numeric data exists
• When data conflicts, cite both but adopt the lower confirmed amount.  
• Never assume which doc is more accurate without proof.

### ELIGIBILITY VERIFICATION
• Do **not** infer DAC, zoning, or utility status; provide verification links.  
• Do not pause for user confirmation – just flag and proceed.

### PROGRAM STRUCTURE & TIMING
• Note pre-application or timing rules.  
• Flag programs that are paused, exhausted, or pending relaunch.

---

## OUTPUT FORMAT (Client-Ready)

1. 📍 **Project Summary** – brief, plain-language snapshot using: ${formattedInput}.  

2. 💰 **Funding Estimate (By Source)**  
   *Example template (use RANGE RULE):*  
   **Utility Funding:** $225k–$375k  
   6 DCFC ports × **$25k–$40k** per port. DAC required; apply pre-install.  
   Source: ladwp.com | Updated Apr 2025  
   “Applicants must …”

3. **Incentive Funding Summary**  
   Utility: $225k–$375k (Can be stacked)  
   State:  $75k–$125k (Cannot be stacked)  
   State Tax Credits: up to $5 000 / port  
   Federal Tax Credit: 30 % of eligible costs

4. 🔗 **Citations**  
   • URL  
   • Domain  
   • Quote  
   • Last-updated date

5. ❌ **Missing Information** – list all unknowns clearly.

6. 📌 **Stacking Recommendation** – optimal path with caveats.

7. ⚠️ **Disclaimer** – “Funding availability is subject to change …”

---

### FINAL VALIDATION (perform before responding)
• Confirm **every** dollar value is a range following RANGE RULE.  
• Ensure each range cites an allowed domain.  
• If any violations exist, fix them before sending the answer.

Avoid hallucinations. NEVER assume funding details not on official sources.
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
