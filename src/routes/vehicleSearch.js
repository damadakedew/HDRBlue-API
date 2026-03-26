import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { d3QueryWithAuth } from '../adapters/d3Socket.js';
import { parseSummaryResponse } from '../utils/summaryParser.js';
import { requireAuth } from '../middleware/auth.js';
import soap from 'soap';

const router = Router();
router.use(requireAuth);

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DATA_DIR = join(__dirname, '..', '..', 'data', 'AppData');

const WS_DAVE_URL = process.env.WS_DAVE_URL || 'https://portal2.hdr.com/MGCrim/Search.asmx';
const WSDL_URL = `${WS_DAVE_URL}?WSDL`;
let soapClient = null;

async function getClient() {
  if (soapClient) return soapClient;
  soapClient = await soap.createClientAsync(WSDL_URL, {
    wsdl_options: { rejectUnauthorized: false },
  });
  return soapClient;
}

/**
 * Vehicle type code mapping
 */
const TYPE_CODES = {
  'Automobile': 'auto',
  'Motorcycle': 'moto',
  'Trailer': 'trlr',
  'Tractor-Trailer': 'ttrlr',
  'Bus': 'bus',
  'Other': 'oth',
};

/**
 * Read a cached text file. Returns array of non-empty trimmed lines.
 */
function readCacheFile(filename) {
  const filePath = join(APP_DATA_DIR, filename);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  return content.split('\n').map(l => l.replace('\r', '').trim()).filter(Boolean);
}

/**
 * GET /api/search/dps/vehicle-type/makes
 * Get the list of makes for a vehicle type.
 * Reads from cached file first, falls back to SOAP.
 */
router.get('/makes', async (req, res) => {
  try {
    const { VehicleType } = req.query;
    const typeCode = TYPE_CODES[VehicleType] || 'auto';

    // Try cached file first
    const cached = readCacheFile(`Makes_${typeCode}_Makes.txt`);
    if (cached && cached.length > 0) {
      return res.json({ success: true, data: cached.sort() });
    }

    // Fall back to SOAP
    const client = await getClient();
    const [result] = await client.getMakeListAsync({ Type: typeCode });
    const makeStr = result?.getMakeListResult?.MakeIds || '';
    const makes = makeStr
      .replace(/"/g, '')
      .trim()
      .split(String.fromCharCode(254))
      .filter(m => m.trim())
      .sort();

    res.json({ success: true, data: makes });
  } catch (err) {
    console.error('Vehicle getMakeList error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/dps/vehicle-type/models
 * Get model + year pairs for a make.
 * Reads from cached file first, falls back to SOAP.
 * File format: year_model per line (e.g., "2020_CAMRY")
 */
router.get('/models', async (req, res) => {
  try {
    const { Make, VehicleType } = req.query;
    if (!Make) return res.status(400).json({ success: false, error: 'Make is required.' });

    const typeCode = TYPE_CODES[VehicleType] || 'auto';
    // File naming: Models_{type}_{MAKE}.txt — spaces in make replaced with underscores
    const makeFile = Make.replace(/ /g, '_');
    const cached = readCacheFile(`Models_${typeCode}_${makeFile}.txt`);

    let pairs;
    if (cached && cached.length > 0) {
      pairs = cached;
    } else {
      // Fall back to SOAP
      const client = await getClient();
      const [result] = await client.getModelListAsync({ Make });
      const modelStr = result?.getModelListResult?.ModelIds || '';
      pairs = modelStr
        .replace(/"/g, '')
        .trim()
        .split(String.fromCharCode(254))
        .filter(p => p.trim());
    }

    // Parse year_model pairs into separate lists
    const models = new Set();
    const years = new Set();

    for (const pair of pairs) {
      const parts = pair.split('_');
      if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
        years.add(parts[0].trim());
        models.add(parts.slice(1).join('_').trim());
      }
    }

    res.json({
      success: true,
      data: {
        models: [...models].sort(),
        years: [...years].sort(),
      },
    });
  } catch (err) {
    console.error('Vehicle getModelList error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/dps/vehicle-type/model-years
 * Get available years for a specific make + model.
 * SOAP: getModelYears(Make, Model)
 */
router.get('/model-years', async (req, res) => {
  try {
    const { Make, Model } = req.query;
    if (!Make || !Model) return res.status(400).json({ success: false, error: 'Make and Model are required.' });

    const client = await getClient();
    const [result] = await client.getModelYearsAsync({ Make, Model });

    const yearStr = result?.getModelYearsResult || '';
    const years = yearStr
      .replace(/"/g, '')
      .split(String.fromCharCode(254))
      .filter(y => y.trim())
      .sort();

    res.json({ success: true, data: years });
  } catch (err) {
    console.error('Vehicle getModelYears error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/dps/vehicle-type
 * Execute vehicle type search.
 * D3: Search_Type=WEB.FIND.VED.TDC.BLUE&Database=DVV
 */
router.get('/', async (req, res) => {
  try {
    const { Make, ModelList, YearFrom, YearTo, ZipCity, Color } = req.query;

    if (!Make) return res.status(400).json({ success: false, error: 'Make is required.' });

    // D3 requires all fields present — no URL encoding on ModelList (commas must stay raw)
    let qs = `Search_Type=WEB.FIND.VED.TDC.BLUE&Database=DVV`;
    qs += `&Make=${Make || ''}`;
    qs += `&ModelList=${ModelList || ''}`;
    qs += `&YearFrom=${YearFrom || ''}`;
    qs += `&YearTo=${YearTo || ''}`;
    qs += `&ZipCity=${ZipCity || ''}`;
    qs += `&ZipPartial=`;
    qs += `&Color=${Color || ''}`;

    const raw = await d3QueryWithAuth(qs, req.session);

    if (raw.indexOf('Network Error') >= 0) {
      return res.json({ success: false, timeout: true, error: 'Search timed out.', data: [] });
    }

    const { results, timeout } = parseSummaryResponse(raw, 'Name', 'DL');

    res.json({
      success: true, timeout,
      resultCount: results.length,
      searchType: 'VehicleType',
      database: 'Vehicle',
      data: results,
    });
  } catch (err) {
    console.error('Vehicle Type Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
