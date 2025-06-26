
import { useState } from 'react';

export default function EligibilityTool() {
  const [formData, setFormData] = useState({
    siteAddress: '',
    utilityProvider: '',
    disadvantagedCommunity: '',
    numChargers: '',
    chargerType: '',
    chargerKW: '',
    numPorts: '',
    portKW: '',
    usageTypes: [],
    publicAccess: '',
    name: '',
    email: '',
    company: ''
  });

  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (type === 'checkbox') {
      setFormData(prev => {
        const newArr = checked
          ? [...prev.usageTypes, value]
          : prev.usageTypes.filter(item => item !== value);
        return { ...prev, usageTypes: newArr };
      });
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const estimateFunding = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formData })
      });
      const data = await response.json();
      setResults(data.result);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: 'auto' }}>
      <h2>EV Charging Incentive Eligibility Tool</h2>
      {Object.entries({
        'Site Address': 'siteAddress',
        'Utility Provider': 'utilityProvider',
        'Number of Chargers': 'numChargers',
        'Charger Type': 'chargerType',
        'Charger kW Rating': 'chargerKW',
        'Number of Charging Ports': 'numPorts',
        'Port kW Output': 'portKW',
        'Name': 'name',
        'Company': 'company',
        'Email': 'email'
      }).map(([label, name]) => (
        <div key={name}>
          <label>{label}</label><br />
          <input name={name} value={formData[name]} onChange={handleChange} /><br />
        </div>
      ))}
      <div>
        <label>Disadvantaged Community?</label>
        <select name="disadvantagedCommunity" onChange={handleChange}>
          <option value="">Select</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          <option value="Not sure">Not sure</option>
        </select>
      </div>
      <div>
        <label>Who will use the chargers?</label><br />
        {['Private fleet', 'Workplace charging', 'Public access'].map(opt => (
          <label key={opt}>
            <input type="checkbox" value={opt} checked={formData.usageTypes.includes(opt)} onChange={handleChange} /> {opt}<br />
          </label>
        ))}
      </div>
      <div>
        <label>Public Access?</label>
        <select name="publicAccess" onChange={handleChange}>
          <option value="">Select</option>
          <option value="Yes – 24/7 public">Yes – 24/7 public</option>
          <option value="Yes – Limited public access">Yes – Limited public access</option>
          <option value="No">No</option>
        </select>
      </div>
      <button onClick={estimateFunding} disabled={loading}>
        {loading ? 'Estimating...' : 'Estimate Funding'}
      </button>
      {results && (
        <div>
          <h3>Estimated Funding Ranges:</h3>
          <pre>{results}</pre>
        </div>
      )}
    </div>
  );
}
