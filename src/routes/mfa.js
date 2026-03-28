import { Router } from 'express';
import axios from 'axios';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// SAAS API base URL for MFA operations — TOTP data lives in MongoDB
const SAAS_API_URL = process.env.SAAS_MFA_URL || 'https://portal2.hdr.com/HDRSaasServices-Node/v1.0';

/**
 * Get the SAAS client key from the session (stored during D3 login)
 */
function getClientKey(req) {
  return req.session?.clientKey || process.env.SAAS_CLIENT_KEY || '';
}

/**
 * GET /api/mfa/verify
 * Verify a TOTP code against the SAAS API.
 * Called during login when TOTP is enabled.
 */
router.get('/verify', async (req, res) => {
  try {
    const { username, password, code } = req.query;

    if (!username || !password || !code) {
      return res.status(400).json({ success: false, error: 'Username, password, and code are required.' });
    }

    let encodedPassword = encodeURIComponent(password);
    encodedPassword = encodedPassword.replace(/!/g, '%21');

    const response = await axios.get(
      `${SAAS_API_URL}/SAAS_VerifyMFA?username=${encodeURIComponent(username)}&password=${encodedPassword}&code=${encodeURIComponent(code)}`,
      {
        timeout: 30000,
        headers: { Accept: 'application/json', 'saas-settings': getClientKey(req) },
      }
    );

    res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('MFA verify error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/mfa/check
 * Check if TOTP is enabled for a user by querying SAAS AccountActivity.
 */
router.get('/check', async (req, res) => {
  try {
    const { username, password } = req.query;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }

    let encodedPassword = encodeURIComponent(password);
    encodedPassword = encodedPassword.replace(/!/g, '%21');

    const response = await axios.get(
      `${SAAS_API_URL}/SAAS_AccountActivity?username=${encodeURIComponent(username)}&password=${encodedPassword}`,
      {
        timeout: 30000,
        headers: { Accept: 'application/json', 'saas-settings': getClientKey(req) },
      }
    );

    res.json({
      success: true,
      data: { totpEnabled: response.data?.totpEnabled || false },
    });
  } catch (err) {
    console.error('MFA check error:', err.message);
    res.json({ success: true, data: { totpEnabled: false } });
  }
});

/**
 * POST /api/mfa/store-secret
 * Store TOTP secret on the SAAS API.
 */
router.post('/store-secret', requireAuth, async (req, res) => {
  try {
    const { secret } = req.body;
    if (!secret) return res.status(400).json({ success: false, error: 'Secret is required.' });

    let encodedPassword = encodeURIComponent(req.session.password || '');
    encodedPassword = encodedPassword.replace(/!/g, '%21');

    const response = await axios.get(
      `${SAAS_API_URL}/SAAS_AccountUpdate?totpSecret=${encodeURIComponent(secret)}&username=${encodeURIComponent(req.session.username)}&password=${encodedPassword}`,
      {
        timeout: 30000,
        headers: { Accept: 'application/json', 'saas-settings': getClientKey(req) },
      }
    );

    res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('MFA store secret error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/mfa/enable
 * Enable TOTP on the account via SAAS API.
 */
router.post('/enable', requireAuth, async (req, res) => {
  try {
    let encodedPassword = encodeURIComponent(req.session.password || '');
    encodedPassword = encodedPassword.replace(/!/g, '%21');

    const response = await axios.get(
      `${SAAS_API_URL}/SAAS_AccountUpdate?totpEnabled=true&username=${encodeURIComponent(req.session.username)}&password=${encodedPassword}`,
      {
        timeout: 30000,
        headers: { Accept: 'application/json', 'saas-settings': getClientKey(req) },
      }
    );

    res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('MFA enable error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
