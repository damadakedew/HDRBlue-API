import { Router } from 'express';
import { d3QueryWithAuth } from '../adapters/d3Socket.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

/**
 * POST /api/transaction-log
 * Log a transaction trace for billing/analytics.
 * Used for enrichment links (maps, presumed value) and watercraft/criminal billing.
 *
 * D3: Search_Type=web.logrequest&TCODE={tcode}&DB={db}&ItemID={itemId}&AuditValue={auditValue}&DoTrans=Yes
 */
router.post('/', async (req, res) => {
  try {
    const { tcode, db, itemId, searchId, auditValue } = req.body;

    if (!tcode || !auditValue) {
      return res.status(400).json({ success: false, error: 'tcode and auditValue are required.' });
    }

    let qs = `Search_Type=web.logrequest&TCODE=${encodeURIComponent(tcode)}&DB=${encodeURIComponent(db || '')}&DoTrans=Yes`;

    if (itemId) qs += `&ItemID=${encodeURIComponent(itemId)}`;
    if (searchId) qs += `&SearchID=${encodeURIComponent(searchId)}`;
    qs += `&AuditValue=${encodeURIComponent(auditValue)}`;

    await d3QueryWithAuth(qs, req.session);

    res.json({ success: true });
  } catch (err) {
    console.error('Transaction log error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
