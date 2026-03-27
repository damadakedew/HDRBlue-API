import { Router } from 'express';
import { d3Query } from '../adapters/d3Socket.js';

const router = Router();

/**
 * POST /api/auth/login
 * Authenticates against D3 using session_V2.
 *
 * D3 Query: Search_Type=session_V2&CName={username}&CNack={password}&RemoteIP={ip}&InboundHost={host}
 * D3 Response: HOST|PORT|DIR|ACCOUNT|AUDIT|TRACKING|INS_FLAG|CUST_NAME|Allow_Mobile_YN|Ckey_{ID}
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required.',
      });
    }

    // Get client IP from request
    const remoteIP = req.ip || req.connection?.remoteAddress || '127.0.0.1';
    const inboundHost = req.hostname || 'localhost';

    // Build D3 query — password is simply URL-encoded
    const queryString = `Search_Type=session_V2&CName=${encodeURIComponent(username)}&CNack=${encodeURIComponent(password)}&RemoteIP=${encodeURIComponent(remoteIP)}&InboundHost=${encodeURIComponent(inboundHost)}`;

    const response = await d3Query(queryString);

    // Check for error responses
    if (!response || response.indexOf('|') === -1) {
      return res.status(401).json({
        success: false,
        error: 'Login failure. Please check your username and password.',
      });
    }

    // Parse pipe-delimited response
    // HOST|PORT|DIR|ACCOUNT|AUDIT|TRACKING|INS_FLAG|CUST_NAME|Allow_Mobile_YN|Ckey_{ID}
    const parts = response.trim().split('|');

    if (parts.length < 8) {
      return res.status(401).json({
        success: false,
        error: 'Invalid response from authentication server.',
      });
    }

    // Store session data
    req.session.host = parts[0];
    req.session.port = parts[1];
    req.session.dir = parts[2];
    req.session.cname = parts[3];
    req.session.audit = parts[4];
    req.session.tracking = parts[5];
    req.session.insFlag = parts[6];
    req.session.customerName = parts[7];
    req.session.allowMobile = parts[8] || 'N';
    req.session.clientKey = parts[9] || '';
    req.session.username = username;
    req.session.password = password;

    // Extract email, phone, client key from extended response fields
    for (let i = 10; i < parts.length; i++) {
      const part = parts[i] || '';
      if (part.startsWith('WUEmail_')) req.session.email = part.replace('WUEmail_', '');
      if (part.startsWith('WUPhone_')) req.session.phone = part.replace('WUPhone_', '');
      if (part.startsWith('Client_Key_')) req.session.clientKey = part.replace('Client_Key_', '');
    }
    req.session.lastActivity = Date.now();

    res.json({
      success: true,
      data: {
        account: parts[3],
        customerName: parts[7],
        allowMobile: parts[8] || 'N',
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);

    if (err.message.includes('D3 socket')) {
      return res.status(503).json({
        success: false,
        error: 'Authentication server is unavailable. Please try again later.',
      });
    }

    res.status(500).json({
      success: false,
      error: 'An error occurred during login.',
    });
  }
});

/**
 * GET /api/auth/session
 * Returns current session status.
 */
router.get('/session', (req, res) => {
  if (!req.session || !req.session.cname) {
    return res.json({ success: true, data: { authenticated: false } });
  }

  res.json({
    success: true,
    data: {
      authenticated: true,
      account: req.session.cname,
      customerName: req.session.customerName,
    },
  });
});

/**
 * POST /api/auth/logout
 * Destroys the session.
 */
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

export default router;
