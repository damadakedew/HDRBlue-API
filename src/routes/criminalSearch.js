import { Router } from 'express';
import { d3QueryWithAuth } from '../adapters/d3Socket.js';
import { parseSummaryResponse } from '../utils/summaryParser.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/search/criminal/name
 * Criminal Name Search.
 *
 * D3: Search_Type=web.find.allname.tdc.blue&Database=CRN
 */
router.get('/name', async (req, res) => {
  try {
    const { LastName, FirstName, MiddleName, Year, Alias } = req.query;

    if (!LastName) {
      return res.status(400).json({ success: false, error: 'LastName is required.' });
    }

    // D3 requires ALL fields present, even when empty
    let qs = `Search_Type=web.find.allname.tdc.blue&Database=CRN&RtnCount=0&NamePartial=ON`;
    qs += `&LastName=${encodeURIComponent(LastName)}`;
    qs += `&FirstName=${FirstName ? encodeURIComponent(FirstName) : ''}`;
    qs += `&MiddleName=${MiddleName ? encodeURIComponent(MiddleName) : ''}`;
    qs += `&Year=${Year ? encodeURIComponent(Year) : ''}`;
    qs += `&Alias=${Alias ? encodeURIComponent(Alias) : 'OFF'}`;

    const raw = await d3QueryWithAuth(qs, req.session);

    if (raw.indexOf('Network Error') >= 0) {
      return res.json({ success: false, timeout: true, error: 'Search timed out.', data: [] });
    }

    const { results, timeout } = parseSummaryResponse(raw, 'Name', 'CR');

    res.json({
      success: true, timeout,
      resultCount: results.length,
      searchType: 'CriminalName',
      database: 'Criminal',
      data: results,
    });
  } catch (err) {
    console.error('Criminal Name Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/search/criminal/sid
 * Criminal State ID Search.
 *
 * D3: Search_Type=web.find.allid.tdc.blue&Database=CRI
 */
router.get('/sid', async (req, res) => {
  try {
    const { SID } = req.query;

    if (!SID) {
      return res.status(400).json({ success: false, error: 'SID is required.' });
    }

    // D3 requires ALL fields present, even when empty
    const qs = `Search_Type=web.find.allid.tdc.blue&Database=CRI&RtnCount=0&SID=${encodeURIComponent(SID)}&ZipCity=&ZipPartial=OFF&RecordsToSearch=All`;

    const raw = await d3QueryWithAuth(qs, req.session);

    if (raw.indexOf('Network Error') >= 0) {
      return res.json({ success: false, timeout: true, error: 'Search timed out.', data: [] });
    }

    const { results, timeout } = parseSummaryResponse(raw, 'Name', 'CR');

    res.json({
      success: true, timeout,
      resultCount: results.length,
      searchType: 'CriminalSID',
      database: 'Criminal',
      data: results,
    });
  } catch (err) {
    console.error('Criminal SID Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
