import { Router } from 'express';
import { d3Query, d3QueryWithAuth } from '../adapters/d3Socket.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/account/billing
 * Billing activity summary.
 * D3: Search_type=web.billing.sum3
 * Response: 4 pipe-delimited fields per row (header + data rows)
 */
router.get('/billing', async (req, res) => {
  try {
    const qs = `Search_type=web.billing.sum3`;
    const raw = await d3QueryWithAuth(qs, req.session);

    if (!raw || raw.indexOf('Network Error') >= 0) {
      return res.json({ success: true, data: [] });
    }

    const lines = raw.split('\n');
    const items = [];
    let totalCount = 0;

    // Skip header row (line 0), skip empty last line
    for (let i = 1; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = line.split('|').map(f => f.replace(/\0/g, ' ').trim());
      if (fields.length >= 2) {
        const description = (fields[0] || '').replace(/<[^>]+>/g, '').trim();
        const count = (fields[1] || '').replace(/<[^>]+>/g, '').trim();

        items.push({ description, count });

        // Track total (first and last rows often show "Current Billing Total")
        if (description.indexOf('Current Billing Total') >= 0 && count) {
          totalCount = parseInt(count, 10) || 0;
        }
      }
    }

    res.json({
      success: true,
      data: { items, totalCount },
    });
  } catch (err) {
    console.error('Billing error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/account/info
 * Get account info (email, phone, client key) from session.
 */
router.get('/info', (req, res) => {
  // These come from the login response stored in session
  // The full accountInfo array has email at [16], phone at [17], client key at [18]
  res.json({
    success: true,
    data: {
      username: req.session.username || '',
      account: req.session.cname || '',
      customerName: req.session.customerName || '',
      email: req.session.email || '',
      phone: req.session.phone || '',
      clientKey: req.session.clientKey || '',
    },
  });
});

/**
 * POST /api/account/update
 * Update email and/or phone.
 * D3: Search_Type=WEBUSER.UPD&CName={user}&CNack={pass}&RemoteIP={ip}&WUEmail={email}&WUPhone={phone}
 */
router.post('/update', async (req, res) => {
  try {
    const { email, phone } = req.body;

    if (!email && !phone) {
      return res.status(400).json({ success: false, error: 'Email or phone is required.' });
    }

    const remoteIP = req.ip || '127.0.0.1';
    const qs = `Search_Type=WEBUSER.UPD&CName=${encodeURIComponent(req.session.username)}&CNack=${encodeURIComponent(req.session.password || '')}&RemoteIP=${encodeURIComponent(remoteIP)}&WUEmail=${encodeURIComponent(email || '')}&WUPhone=${encodeURIComponent(phone || '')}`;

    const raw = await d3Query(qs);
    const result = raw.trim();

    if (result === 'UPDATED') {
      // Update session with new values
      if (email) req.session.email = email;
      if (phone) req.session.phone = phone;
      res.json({ success: true, message: 'Account updated successfully.' });
    } else if (result === 'VOID_NON_UNIQUE_EMAIL') {
      res.json({ success: false, error: 'Email already in use. Must be unique.' });
    } else if (result === 'NOTUPDATED') {
      res.json({ success: false, error: 'No update applied.' });
    } else {
      res.json({ success: false, error: 'Update rejected. Contact Support.' });
    }
  } catch (err) {
    console.error('Account update error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
