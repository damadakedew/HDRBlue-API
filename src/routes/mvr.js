import { Router } from 'express';
import { DOMParser } from '@xmldom/xmldom';
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

    // Parse D3 XML response: //SERVER/RESPONSE/SUMMARY, VIOLATION[], MESSAGE[]
    const summary = {};
    const violations = [];
    const messages = [];

    try {
      const doc = new DOMParser().parseFromString(raw, 'text/xml');

      // Parse Summary
      const summaryNodes = doc.getElementsByTagName('SUMMARY');
      if (summaryNodes.length > 0) {
        const children = summaryNodes[0].childNodes;
        for (let i = 0; i < children.length; i++) {
          const node = children[i];
          if (node.nodeType === 1) {
            summary[node.nodeName] = node.textContent || '';
          }
        }
      }

      // Parse Violations
      const violationNodes = doc.getElementsByTagName('VIOLATION');
      for (let v = 0; v < violationNodes.length; v++) {
        const viol = {};
        const children = violationNodes[v].childNodes;
        for (let i = 0; i < children.length; i++) {
          const node = children[i];
          if (node.nodeType === 1) {
            viol[node.nodeName] = node.textContent || '';
          }
        }
        violations.push(viol);
      }

      // Parse Messages
      const messageNodes = doc.getElementsByTagName('MESSAGE');
      for (let m = 0; m < messageNodes.length; m++) {
        const children = messageNodes[m].childNodes;
        for (let i = 0; i < children.length; i++) {
          const node = children[i];
          if (node.nodeType === 1 && node.nodeName === 'MESSAGE_TEXT') {
            messages.push({ MESSAGE_TEXT: node.textContent || '' });
          }
        }
      }
    } catch (parseErr) {
      console.error('MVR XML parse error:', parseErr.message);
    }

    res.json({
      success: true,
      data: { summary, violations, messages },
    });
  } catch (err) {
    console.error('MVR request error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
