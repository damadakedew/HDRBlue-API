import { Router } from 'express';
import { d3QueryWithAuth } from '../adapters/d3Socket.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/mvr/eligibility
 * Check if user has sufficient MVR deposit balance.
 *
 * D3: Search_Type=MVR.USER&DLNumber={license}&CName={account}
 * Response: {canRequest}|{existingMVR}$
 */
router.get('/eligibility', async (req, res) => {
  try {
    const { DLNumber } = req.query;

    if (!DLNumber) {
      return res.status(400).json({ success: false, error: 'DLNumber is required.' });
    }

    const qs = `Search_Type=MVR.USER&DLNumber=${encodeURIComponent(DLNumber)}`;
    const raw = await d3QueryWithAuth(qs, req.session);

    // Parse response: canRequest|existingMVR$
    const cleaned = raw.split('$')[0];
    const parts = cleaned.split('|');

    res.json({
      success: true,
      data: {
        canRequest: parts[0] !== '0',
        existingMvrAvailable: parts[1] !== '0',
      },
    });
  } catch (err) {
    console.error('MVR eligibility error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/mvr/request
 * Execute an MVR request. Requires prepaid balance.
 *
 * D3 returns XML: //SERVER/RESPONSE/SUMMARY, //SERVER/RESPONSE/VIOLATION[], //SERVER/RESPONSE/MESSAGE[]
 */
router.post('/request', async (req, res) => {
  try {
    const { DLNumber, LastName, DOB, UseExistingMVR } = req.body;

    if (!DLNumber || !LastName || !DOB) {
      return res.status(400).json({ success: false, error: 'DLNumber, LastName, and DOB are required.' });
    }

    const remoteIP = req.ip || '127.0.0.1';
    let qs = `DLNumber=${encodeURIComponent(DLNumber)}&LastName=${encodeURIComponent(LastName)}&DOB=${encodeURIComponent(DOB)}`;
    qs += `&XML_TYPE=MVR.DETAIL&IPAddr=${encodeURIComponent(remoteIP)}&Request_Type=Live`;
    qs += `&UseExistingMVR=${UseExistingMVR === 'ON' ? 'ON' : ''}`;

    const raw = await d3QueryWithAuth(qs, req.session);

    // D3 returns XML — parse it
    // For now, return the raw XML. The full XML parser will be added
    // when we have sample data to validate the structure.
    // TODO: Parse XML into summary/violations/messages JSON structure.

    res.json({
      success: true,
      data: {
        rawXml: raw,
        // Parsed structure will be:
        // summary: {},
        // violations: [],
        // messages: [],
      },
    });
  } catch (err) {
    console.error('MVR request error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
