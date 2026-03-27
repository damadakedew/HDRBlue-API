import { Router } from 'express';
import axios from 'axios';
import { d3QueryWithAuth } from '../adapters/d3Socket.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/spv
 * Standard Presumptive Value lookup.
 * Proxies a POST to the Texas DMV SPV calculator and returns the HTML result.
 * Also logs transaction trace (TCODE=7091) for analytics.
 */
router.get('/', async (req, res) => {
  try {
    const { vin, odo } = req.query;

    if (!vin) {
      return res.status(400).json({ success: false, error: 'VIN is required.' });
    }

    // Log transaction trace
    const traceQs = `Search_Type=web.logrequest&TCODE=7091&DB=TT&ItemID=${encodeURIComponent(vin)}&AuditValue=PresumedValue Search&DoTrans=Yes`;
    await d3QueryWithAuth(traceQs, req.session);

    // POST to Texas DMV SPV calculator (new URL as of 2025)
    const postData = `vin=${encodeURIComponent(vin)}&mileage=${encodeURIComponent(odo || '')}`;

    const response = await axios.post(
      'https://tools.txdmv.gov/tools/SPV/spv_lookup.php',
      postData,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );

    // Clean up the response HTML
    let html = response.data || '';
    html = html.replace('Perform another query', '');
    // Remove "Submit Another Query" button
    html = html.replace(/<button type="submit"[^>]*>Submit Another Query<\/button>/gi, '');
    // Remove the print button script block
    html = html.replace(/document\.write\([^)]*window\.print\(\)[^)]*\);/gi, '');
    // Remove the wrapping form around the submit button (but keep the result table)
    html = html.replace(/<form method="post">\s*<\/form>/gi, '');

    res.json({
      success: true,
      data: { html },
    });
  } catch (err) {
    console.error('SPV lookup error:', err.message);
    res.json({
      success: true,
      data: { html: '<b>DMV Value not available at this time. Try again later.</b>' },
    });
  }
});

export default router;
