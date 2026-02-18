import type { ManifestEntry } from '../types';
import { fetchXml } from '../utils/http';
import { getDiscoveryState, setDiscoveryState } from '../storage/kv';

const SOURCE_ID = 'cbs-xml-api';
const API_URL = 'https://api.cbs.gov.il/index/data/price_selected?format=xml&download=false&lang=he';

export async function discoverCbsXmlApi(kv: KVNamespace): Promise<ManifestEntry[]> {
  const state = await getDiscoveryState(kv, SOURCE_ID);
  const manifest: ManifestEntry[] = [];

  try {
    const xmlText = await fetchXml(API_URL);

    // Real CBS XML format: <date year="2026" month="ינואר"> ... </date>
    const dateMatch = xmlText.match(/<date\s+year="(\d+)"\s+month="([^"]+)"/);
    if (!dateMatch) {
      console.log('CBS XML API: No period data found');
      return manifest;
    }

    const year = dateMatch[1];
    const monthHe = dateMatch[2];
    const latestPeriod = `${year}-${monthHe}`;

    // Check if this is new data
    if (state?.latest_period === latestPeriod) {
      console.log(`CBS XML API: No new data (latest period: ${latestPeriod})`);
      return manifest;
    }

    // Count how many index codes exist
    const codeCount = (xmlText.match(/<code\s+code="/g) || []).length;

    // New data available — add manifest entry
    manifest.push({
      source: SOURCE_ID,
      url: API_URL,
      filename: `price_selected_${new Date().toISOString().slice(0, 10)}.xml`,
      format: 'xml',
      publication_id: `cbs-xml-api-${latestPeriod}`,
      publish_date: new Date().toISOString(),
      metadata: {
        latest_period: latestPeriod,
        year,
        month_he: monthHe,
        indices_count: codeCount,
        raw_xml_length: xmlText.length,
        _xml_content: xmlText,
      },
      is_new: true,
    });

    // Update KV state
    await setDiscoveryState(kv, SOURCE_ID, {
      last_check: new Date().toISOString(),
      latest_period: latestPeriod,
    });
  } catch (err) {
    console.error('CBS XML API discovery failed:', err);
    throw err;
  }

  return manifest;
}
