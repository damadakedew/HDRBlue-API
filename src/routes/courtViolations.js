import { Router } from 'express';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

const COURT_URL = process.env.COURT_VIOLATIONS_URL || 'https://www.texasfailuretoappear.com/search.php';

/**
 * GET /api/detail/driver/violations
 * Court violations — scrapes texasfailuretoappear.com
 * Same logic as TXCourtData.asmx.cs in the legacy system.
 */
router.get('/', async (req, res) => {
  try {
    const { license, dob } = req.query;

    if (!license || !dob) {
      return res.status(400).json({ success: false, error: 'license and dob are required.' });
    }

    // Pad license to 8 digits
    const paddedLicense = String(parseInt(license, 10)).padStart(8, '0');

    // Parse DOB
    const dobDate = new Date(dob);
    const birthMonth = String(dobDate.getMonth() + 1);
    const birthDay = String(dobDate.getDate());
    const birthYear = String(dobDate.getFullYear());

    // Step 1: GET the search page to grab cookies
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true }));

    await client.get(COURT_URL, { timeout: 4000 });

    // Step 2: POST the search form
    const postData = `fSubmitted=true&licenseid=${paddedLicense}&birthmonth=${birthMonth}&birthday=${birthDay}&birthyear=${birthYear}&submit=`;

    const response = await client.post(COURT_URL, postData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': COURT_URL,
      },
      timeout: 4000,
    });

    const html = response.data;

    // Step 3: Parse violations from HTML
    const violations = [];

    // Parse open cases
    parseViolationsTable(html, 'openCases', 'Outstanding', violations);

    // Parse closed cases
    parseViolationsTable(html, 'closedCases', null, violations);

    res.json({
      success: true,
      data: {
        license: paddedLicense,
        violations,
      },
    });
  } catch (err) {
    console.error('Court Violations error:', err.message);
    // Return empty rather than error — matches legacy behavior (silent catch)
    res.json({
      success: true,
      data: { license: req.query.license, violations: [] },
    });
  }
});

/**
 * Parse a violations table from the HTML response.
 * Replicates the parsing logic from TXCourtData.asmx.cs
 */
function parseViolationsTable(html, tableId, defaultDisposition, violations) {
  try {
    const tableRegex = new RegExp(`id="${tableId}"[^>]*class="cases"[^>]*>([\\s\\S]*?)</table>`, 'i');
    const tableMatch = html.match(tableRegex);
    if (!tableMatch) return;

    let tableHtml = tableMatch[1];

    if (tableHtml.indexOf('No Cases Found') >= 0) return;

    // Clean up HTML
    tableHtml = tableHtml.replace(/[\t\r\n]/g, '');
    tableHtml = tableHtml.replace(/<div class="location">/g, '');
    tableHtml = tableHtml.replace(/<br\s*\/?>/g, '|');
    tableHtml = tableHtml.replace(/<\/div>/g, '|');
    tableHtml = tableHtml.replace(/<div class="amount_breakdown">/g, '');
    tableHtml = tableHtml.replace(/style="text-align: right;">/g, '');

    // Split into rows
    const rows = tableHtml.split(/<tr>/i).slice(2); // Skip header row and empty first split

    for (const rowHtml of rows) {
      const cells = rowHtml.split(/<td[^>]*>/i).slice(1); // Skip empty first split
      if (cells.length < 4) continue;

      const cleanCell = (cell) => cell.replace(/<\/td>.*/i, '').replace(/<[^>]+>/g, '').trim();

      const item = {};

      if (tableId === 'openCases') {
        // Open cases: Court|Docket|OffenseDate|Description|Amounts
        if (cells.length >= 5) {
          const courtParts = cleanCell(cells[0]).split('|').map(s => s.trim());
          item.courtName = courtParts[0] || '';
          item.courtAddress = courtParts[1] || '';
          item.courtCSZ = courtParts[2] || '';
          item.courtPhone = courtParts[3] || '';

          item.docket = cleanCell(cells[1]);
          item.offenseDate = cleanCell(cells[2]);
          item.offenseDescription = cleanCell(cells[3]);

          const amountParts = cleanCell(cells[4]).split('|').map(s => s.trim());
          item.fine = parseAmount(amountParts[0]);
          item.courtCost = parseAmount(amountParts[1]);
          item.other = parseAmount(amountParts[2]);
          item.amountDue = parseAmount(amountParts[5] || amountParts[3]);

          item.disposition = 'Outstanding';
        }
      } else {
        // Closed cases: Court|Docket|Description|Disposition|DisposedDate
        if (cells.length >= 5) {
          const courtParts = cleanCell(cells[0]).split('|').map(s => s.trim());
          item.courtName = courtParts[0] || '';
          item.courtAddress = courtParts[1] || '';
          item.courtCSZ = courtParts[2] || '';
          item.courtPhone = courtParts[3] || '';

          item.docket = cleanCell(cells[1]);
          item.offenseDescription = cleanCell(cells[2]);
          item.disposition = cleanCell(cells[3]);
          item.disposedDate = cleanCell(cells[4]);
        }
      }

      if (item.courtName || item.docket) {
        violations.push(item);
      }
    }
  } catch {
    // Silent catch — matches legacy behavior
  }
}

/**
 * Extract dollar amount from string like "Fine $200.00"
 */
function parseAmount(str) {
  if (!str) return '';
  const match = str.match(/\$?([\d,]+\.?\d*)/);
  return match ? `$${match[1]}` : str.trim();
}

export default router;
