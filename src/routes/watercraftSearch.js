import { Router } from 'express';
import { d3Query, d3QueryWithAuth } from '../adapters/d3Socket.js';
import {
  boatNameSearch, boatBizNameSearch, boatTXNSearch,
  boatHINSearch, boatMotorSearch, boatAddrSearch,
} from '../adapters/wsDaveService.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

/**
 * Helper: Log watercraft transaction trace via D3 (only if results found)
 */
async function logTrace(session, tcode, db, searchId, auditValue) {
  const qs = `Search_Type=web.logrequest&TCODE=${tcode}&DB=${db}&SearchID=${encodeURIComponent(searchId)}&AuditValue=${encodeURIComponent(auditValue)}&DoTrans=Yes`;
  await d3QueryWithAuth(qs, session);
}

/**
 * Helper: Determine if ZipCity is a city name or zip code
 */
function parseZipCity(zipCity) {
  if (!zipCity) return { zip: '', city: '' };
  if (/^[a-zA-Z\s]+$/.test(zipCity)) {
    return { zip: '', city: zipCity };
  }
  return { zip: zipCity, city: '' };
}

/**
 * GET /api/search/watercraft/name
 * Personal or commercial watercraft name search.
 */
router.get('/name', async (req, res) => {
  try {
    const { LastName, FirstName, MiddleName, Company, ZipCity } = req.query;

    const isCommercial = !!Company && !LastName;

    if (!isCommercial && !LastName) {
      return res.status(400).json({ success: false, error: 'LastName or Company is required.' });
    }

    const { zip, city } = parseZipCity(ZipCity);
    let results;

    if (isCommercial) {
      results = await boatBizNameSearch(Company, zip, city);
    } else {
      results = await boatNameSearch(LastName, FirstName, MiddleName, zip, city);
    }

    // Log transaction trace only if results found
    if (results.length > 0) {
      const searchId = isCommercial
        ? Company.toUpperCase()
        : `${(LastName || '')}\\${(FirstName || '')}\\${(MiddleName || '')}`.toUpperCase();
      await logTrace(req.session, '7213', 'WTN', searchId, 'Watercraft Name Search');
    }

    res.json({
      success: true,
      resultCount: results.length,
      searchType: 'WatercraftName',
      database: 'Watercraft',
      data: results,
    });
  } catch (err) {
    console.error('Watercraft Name Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/watercraft/txn
 */
router.get('/txn', async (req, res) => {
  try {
    const { TXN } = req.query;
    if (!TXN) return res.status(400).json({ success: false, error: 'TXN is required.' });

    const results = await boatTXNSearch(TXN);

    if (results.length > 0) {
      await logTrace(req.session, '7216', 'WTT', TXN.toUpperCase(), 'Watercraft TXN Search');
    }

    res.json({
      success: true,
      resultCount: results.length,
      searchType: 'WatercraftTXN',
      database: 'Watercraft',
      data: results,
    });
  } catch (err) {
    console.error('Watercraft TXN Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/watercraft/hin
 */
router.get('/hin', async (req, res) => {
  try {
    const { HIN } = req.query;
    if (!HIN) return res.status(400).json({ success: false, error: 'HIN is required.' });

    const results = await boatHINSearch(HIN);

    if (results.length > 0) {
      await logTrace(req.session, '7215', 'WTH', HIN.toUpperCase(), 'Watercraft HIN Search');
    }

    res.json({
      success: true,
      resultCount: results.length,
      searchType: 'WatercraftHIN',
      database: 'Watercraft',
      data: results,
    });
  } catch (err) {
    console.error('Watercraft HIN Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/watercraft/motor
 */
router.get('/motor', async (req, res) => {
  try {
    const { MotorSerial } = req.query;
    if (!MotorSerial) return res.status(400).json({ success: false, error: 'MotorSerial is required.' });

    const results = await boatMotorSearch(MotorSerial);

    if (results.length > 0) {
      await logTrace(req.session, '7217', 'WTM', MotorSerial.toUpperCase(), 'Watercraft Motor Serial Search');
    }

    res.json({
      success: true,
      resultCount: results.length,
      searchType: 'WatercraftMotor',
      database: 'Watercraft',
      data: results,
    });
  } catch (err) {
    console.error('Watercraft Motor Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/watercraft/address
 * Two-step: D3 GET.INDEXADDR → WSDaveService BoatAddrSearch
 */
router.get('/address', async (req, res) => {
  try {
    const { ZipCity, StreetNumber, StreetName, Apt, Box, Route, AddressType } = req.query;

    if (!ZipCity) return res.status(400).json({ success: false, error: 'ZipCity is required.' });

    // Format address based on type
    let hdrAddr = '';
    const addrType = AddressType || 'standard';

    if (addrType === 'pobox') {
      if (!Box) return res.status(400).json({ success: false, error: 'Box is required for PO Box search.' });
      hdrAddr = `PO Box ${Box}`.toUpperCase();
    } else if (addrType === 'rural') {
      if (!Route) return res.status(400).json({ success: false, error: 'Route is required for rural search.' });
      hdrAddr = `Route ${Route} Box ${Box || ''}`.toUpperCase();
    } else {
      if (!StreetName) return res.status(400).json({ success: false, error: 'StreetName is required.' });
      hdrAddr = `${StreetNumber || ''} ${StreetName} ${Apt || ''}`.toUpperCase().trim();
    }

    // Step 1: D3 index lookup — D3 expects raw spaces, not URL-encoded
    const addrQuery = `Search_Type=GET.INDEXADDR&Address=${hdrAddr.trim()}&ZipCode=${ZipCity}`;
    const indexAddr = await d3Query(addrQuery);

    // Check if D3 found an index address
    const cleanIndex = indexAddr.trim();
    if (!cleanIndex || cleanIndex === '-') {
      return res.json({
        success: true, resultCount: 0,
        searchType: 'WatercraftAddress', database: 'Watercraft', data: [],
      });
    }

    // Step 2: Web service search
    const results = await boatAddrSearch(cleanIndex);

    if (results.length > 0) {
      const searchId = `${ZipCity}\\${hdrAddr.trim()}\\`;
      await logTrace(req.session, '7214', 'WTA', searchId, 'Watercraft Address Search');
    }

    res.json({
      success: true,
      resultCount: results.length,
      searchType: 'WatercraftAddress',
      database: 'Watercraft',
      data: results,
    });
  } catch (err) {
    console.error('Watercraft Address Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
