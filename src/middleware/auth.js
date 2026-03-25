/**
 * Authentication middleware.
 * Checks that a valid D3 session exists (CName + Audit from session_V2 login).
 */
export function requireAuth(req, res, next) {
  if (!req.session || !req.session.cname || !req.session.audit) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated. Please log in.',
    });
  }

  // Check session timeout (5 minutes inactivity)
  const now = Date.now();
  const timeout = parseInt(process.env.SESSION_TIMEOUT) || 300000;

  if (req.session.lastActivity && (now - req.session.lastActivity) > timeout) {
    req.session.destroy();
    return res.status(401).json({
      success: false,
      error: 'Session expired due to inactivity.',
    });
  }

  // Update last activity timestamp
  req.session.lastActivity = now;
  next();
}
