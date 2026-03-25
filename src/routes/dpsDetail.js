import { Router } from 'express';
import { d3QueryWithAuth } from '../adapters/d3Socket.js';
import {
  parseDetailResponse,
  parseDriverAddressList, parseDriverNameList, parseDriverHistoryList,
  parseTitleAddressList, parseTitleNameList, parseLienInfo, parsePipeList,
} from '../utils/detailParser.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/detail/driver
 * Driver license detail.
 * The query string is passed through from the summary result's detail URL.
 */
router.get('/driver', async (req, res) => {
  try {
    // Build query from the detail parameters
    // The frontend sends the DBViewItem or DLID from the summary selection
    const queryParams = { ...req.query };
    // Remove any auth params (we add them server-side)
    delete queryParams.CName;
    delete queryParams.Audit;

    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const raw = await d3QueryWithAuth(qs, req.session);

    if (!raw || raw.trim() === '') {
      return res.status(404).json({ success: false, error: 'No detail record found.' });
    }

    const data = parseDetailResponse(raw);

    // Extract special list fields
    const addrList = parseDriverAddressList(data.get('DLAddrList'));
    const nameList = parseDriverNameList(data.get('DLNameList'));
    const histList = parseDriverHistoryList(data.get('DLUpdHistList'));
    const tabData = data.get('TabData') || '';

    // Remove list fields from main data to avoid duplication
    data.delete('DLAddrList');
    data.delete('DLNameList');
    data.delete('DLUpdHistList');
    data.delete('TabData');

    // Build flat response object from remaining key-value pairs
    const detail = {};
    for (const [key, value] of data) {
      detail[key] = value;
    }

    // Strip (TTAG) from any fields
    for (const key of Object.keys(detail)) {
      if (typeof detail[key] === 'string' && detail[key].indexOf('(TTAG)') >= 0) {
        detail[key] = detail[key].replace('(TTAG)', '').trim();
      }
    }

    res.json({
      success: true,
      data: {
        ...detail,
        addressHistory: addrList,
        nameHistory: nameList,
        updateHistory: histList,
        tabData,
      },
    });
  } catch (err) {
    console.error('Driver Detail error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/detail/title
 * Vehicle/title detail.
 */
router.get('/title', async (req, res) => {
  try {
    const queryParams = { ...req.query };
    delete queryParams.CName;
    delete queryParams.Audit;

    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const raw = await d3QueryWithAuth(qs, req.session);

    if (!raw || raw.trim() === '') {
      return res.status(404).json({ success: false, error: 'No detail record found.' });
    }

    const data = parseDetailResponse(raw);

    // Extract special fields
    const addrList = parseTitleAddressList(data.get('TTAddrList'));
    const nameList = parseTitleNameList(data.get('TTNameList'));
    const lienInfo = parseLienInfo(data.get('TitleLienInfo'));
    const plateList = parsePipeList(data.get('PlateList'));
    const vinData = parsePipeList(data.get('VinData'));
    const tabData = data.get('TabData') || '';

    data.delete('TTAddrList');
    data.delete('TTNameList');
    data.delete('TitleLienInfo');
    data.delete('PlateList');
    data.delete('VinData');
    data.delete('TabData');

    const detail = {};
    for (const [key, value] of data) {
      detail[key] = value;
    }

    // Strip (TTAG)
    for (const key of Object.keys(detail)) {
      if (typeof detail[key] === 'string' && detail[key].indexOf('(TTAG)') >= 0) {
        detail[key] = detail[key].replace('(TTAG)', '').trim();
      }
    }

    res.json({
      success: true,
      data: {
        ...detail,
        addressHistory: addrList,
        ownerNames: nameList,
        lienInfo,
        plateList,
        vinData,
        tabData,
      },
    });
  } catch (err) {
    console.error('Title Detail error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
