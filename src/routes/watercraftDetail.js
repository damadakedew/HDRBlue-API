import { Router } from 'express';
import { d3QueryWithAuth } from '../adapters/d3Socket.js';
import { boatRecord } from '../adapters/wsDaveService.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/detail/watercraft
 * Watercraft detail record.
 * Transaction trace: TCODE=7218, DB=WTN
 */
router.get('/', async (req, res) => {
  try {
    const { TXN } = req.query;

    if (!TXN) {
      return res.status(400).json({ success: false, error: 'TXN is required.' });
    }

    // Fetch detail from WSDaveService
    const detail = await boatRecord(TXN);

    if (!detail) {
      return res.status(404).json({ success: false, error: 'No watercraft record found.' });
    }

    // Log transaction trace
    const traceQs = `Search_Type=web.logrequest&TCODE=7218&DB=WTN&ItemID=${encodeURIComponent(detail.txNumber)}&AuditValue=Watercraft Name Search&DoTrans=Yes`;
    await d3QueryWithAuth(traceQs, req.session);

    res.json({
      success: true,
      data: detail,
    });
  } catch (err) {
    console.error('Watercraft Detail error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
