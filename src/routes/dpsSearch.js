import { Router } from 'express';
import { d3QueryWithAuth } from '../adapters/d3Socket.js';
import { parseSummaryResponse } from '../utils/summaryParser.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All DPS search routes require authentication
router.use(requireAuth);

/**
 * GET /api/search/dps/name
 * DPS Name Search — Personal or Commercial.
 * Merges results from driver and vehicle databases.
 *
 * D3: Search_Type=web.find.allname.tdc.blue&Database=DLN
 */
router.get('/name', async (req, res) => {
  try {
    const {
      LastName, FirstName, MiddleName, Year, ZipCity,
      Alias, QueryDatabase, RecordsToSearch, Company,
    } = req.query;

    // Determine personal vs commercial
    const isCommercial = !!Company && !LastName;

    if (!isCommercial && !LastName) {
      return res.status(400).json({
        success: false,
        error: 'LastName is required for personal search. Company is required for commercial search.',
      });
    }

    // Build query string — D3 requires ALL fields present, even when empty
    let qs = 'Search_Type=web.find.allname.tdc.blue&Database=DLN&RtnCount=0&NamePartial=ON';

    if (isCommercial) {
      qs += `&Company=${encodeURIComponent(Company)}`;
    } else {
      qs += `&LastName=${encodeURIComponent(LastName)}`;
      qs += `&FirstName=${FirstName ? encodeURIComponent(FirstName) : ''}`;
      qs += `&MiddleName=${MiddleName ? encodeURIComponent(MiddleName) : ''}`;
      qs += `&Year=${Year ? encodeURIComponent(Year) : ''}`;
      qs += `&Alias=${Alias ? encodeURIComponent(Alias) : 'OFF'}`;
    }

    qs += `&ZipCity=${ZipCity ? encodeURIComponent(ZipCity) : ''}`;
    qs += `&QueryDatabase=${QueryDatabase ? encodeURIComponent(QueryDatabase) : 'ALL'}`;
    qs += `&RecordsToSearch=${RecordsToSearch ? encodeURIComponent(RecordsToSearch) : 'All'}`;

    const raw = await d3QueryWithAuth(qs, req.session);

    // Check for network errors
    if (raw.indexOf('Network Error') >= 0) {
      return res.json({
        success: false,
        timeout: true,
        error: 'Search did not complete in the allotted time. Consider revising the parameters.',
        data: [],
      });
    }

    const { results, timeout } = parseSummaryResponse(raw, 'Name', 'DL');

    res.json({
      success: true,
      timeout,
      resultCount: results.length,
      searchType: 'Name',
      database: 'DPS/DMV',
      data: results,
    });
  } catch (err) {
    console.error('DPS Name Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/dps/address
 * DPS Address Search — Standard, PO Box, or Rural Route.
 *
 * D3: Search_Type=web.find.alladdr.tdc.blue&Database=DLA
 */
router.get('/address', async (req, res) => {
  try {
    const {
      ZipCity, StreetNumber, StreetName, Apt,
      Box, Route, AddressType,
      QueryDatabase, RecordsToSearch, DoHDR,
    } = req.query;

    if (!ZipCity) {
      return res.status(400).json({ success: false, error: 'ZipCity is required.' });
    }

    let qs = 'Search_Type=web.find.alladdr.tdc.blue&Database=DLA&RtnCount=0';

    if (DoHDR !== undefined) qs += `&DoHDR=${DoHDR}`;

    const addrType = AddressType || 'standard';

    if (addrType === 'pobox') {
      if (!Box) return res.status(400).json({ success: false, error: 'Box is required for PO Box search.' });
      qs += `&ZipCity=${encodeURIComponent(ZipCity)}&Box=${encodeURIComponent(Box)}`;
    } else if (addrType === 'rural') {
      if (!Route) return res.status(400).json({ success: false, error: 'Route is required for rural search.' });
      qs += `&ZipCity=${encodeURIComponent(ZipCity)}&Route=${encodeURIComponent(Route)}`;
      if (Box) qs += `&Box=${encodeURIComponent(Box)}`;
    } else {
      if (!StreetName) return res.status(400).json({ success: false, error: 'StreetName is required.' });
      qs += `&ZipCity=${encodeURIComponent(ZipCity)}`;
      if (StreetNumber) qs += `&StreetNumber=${encodeURIComponent(StreetNumber)}`;
      qs += `&StreetName=${encodeURIComponent(StreetName)}`;
      if (Apt) qs += `&Apt=${encodeURIComponent(Apt)}`;
    }

    if (QueryDatabase) qs += `&QueryDatabase=${encodeURIComponent(QueryDatabase)}`;
    if (RecordsToSearch) qs += `&RecordsToSearch=${encodeURIComponent(RecordsToSearch)}`;

    const raw = await d3QueryWithAuth(qs, req.session);

    if (raw.indexOf('Network Error') >= 0) {
      return res.json({ success: false, timeout: true, error: 'Search timed out.', data: [] });
    }

    const { results, timeout } = parseSummaryResponse(raw, 'Address', 'DL');

    res.json({
      success: true,
      timeout,
      resultCount: results.length,
      searchType: 'Address',
      database: 'DPS/DMV',
      data: results,
    });
  } catch (err) {
    console.error('DPS Address Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/dps/plate
 * DPS Plate Search.
 *
 * D3: Search_Type=web.find.tag.tdc.blue&Database=DLP
 */
router.get('/plate', async (req, res) => {
  try {
    const { Plate, Year, ZipCity, Color, RecordsToSearch } = req.query;

    if (!Plate) {
      return res.status(400).json({ success: false, error: 'Plate is required.' });
    }

    // D3 requires ALL fields to be present, even when empty (legacy behavior)
    let qs = `Search_Type=web.find.tag.tdc.blue&Database=DLP&RtnCount=0`;
    qs += `&Plate=${encodeURIComponent(Plate)}`;
    qs += `&ZipCity=${ZipCity ? encodeURIComponent(ZipCity) : ''}`;
    qs += `&Color=${Color ? encodeURIComponent(Color) : ''}`;
    qs += `&RecordsToSearch=${RecordsToSearch ? encodeURIComponent(RecordsToSearch) : 'All'}`;
    qs += `&Year=${Year ? encodeURIComponent(Year) : ''}`;

    const raw = await d3QueryWithAuth(qs, req.session);

    if (raw.indexOf('Network Error') >= 0) {
      return res.json({ success: false, timeout: true, error: 'Search timed out.', data: [] });
    }

    const { results, timeout } = parseSummaryResponse(raw, 'Plate', 'DL');

    res.json({
      success: true, timeout,
      resultCount: results.length,
      searchType: 'Plate',
      database: 'DPS/DMV',
      data: results,
    });
  } catch (err) {
    console.error('DPS Plate Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/dps/vin
 * DPS VIN Search.
 *
 * D3: Search_Type=web.find.allid.tdc.blue&Database=DLV
 */
router.get('/vin', async (req, res) => {
  try {
    const { VIN, Year, ZipCity, RecordsToSearch } = req.query;

    if (!VIN) {
      return res.status(400).json({ success: false, error: 'VIN is required.' });
    }

    // D3 requires ALL fields present, even when empty
    let qs = `Search_Type=web.find.allid.tdc.blue&Database=DLV&RtnCount=0`;
    qs += `&VIN=${encodeURIComponent(VIN)}`;
    qs += `&Year=${Year ? encodeURIComponent(Year) : ''}`;
    qs += `&ZipCity=${ZipCity ? encodeURIComponent(ZipCity) : ''}`;
    qs += `&RecordsToSearch=${RecordsToSearch ? encodeURIComponent(RecordsToSearch) : 'All'}`;

    const raw = await d3QueryWithAuth(qs, req.session);

    if (raw.indexOf('Network Error') >= 0) {
      return res.json({ success: false, timeout: true, error: 'Search timed out.', data: [] });
    }

    const { results, timeout } = parseSummaryResponse(raw, 'Vin', 'DL');

    res.json({
      success: true, timeout,
      resultCount: results.length,
      searchType: 'VIN',
      database: 'DPS/DMV',
      data: results,
    });
  } catch (err) {
    console.error('DPS VIN Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/dps/license
 * DPS Driver License Search.
 *
 * D3: Search_Type=web.find.allid.tdc.blue&Database=DLL
 */
router.get('/license', async (req, res) => {
  try {
    let { DLID, ZipCity, ZipPartial, RecordsToSearch } = req.query;

    if (!DLID) {
      return res.status(400).json({ success: false, error: 'DLID is required.' });
    }

    // Strip leading zeros (legacy behavior)
    DLID = String(parseInt(DLID, 10) || DLID);

    // D3 requires ALL fields present, even when empty
    let qs = `Search_Type=web.find.allid.tdc.blue&Database=DLL&RtnCount=0`;
    qs += `&DLID=${encodeURIComponent(DLID)}`;
    qs += `&ZipCity=${ZipCity ? encodeURIComponent(ZipCity) : ''}`;
    qs += `&ZipPartial=${ZipPartial ? encodeURIComponent(ZipPartial) : 'OFF'}`;
    qs += `&RecordsToSearch=${RecordsToSearch ? encodeURIComponent(RecordsToSearch) : 'All'}`;

    const raw = await d3QueryWithAuth(qs, req.session);

    if (raw.indexOf('Network Error') >= 0) {
      return res.json({ success: false, timeout: true, error: 'Search timed out.', data: [] });
    }

    const { results, timeout } = parseSummaryResponse(raw, 'License', 'DL');

    res.json({
      success: true, timeout,
      resultCount: results.length,
      searchType: 'License',
      database: 'DPS/DMV',
      data: results,
    });
  } catch (err) {
    console.error('DPS License Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
