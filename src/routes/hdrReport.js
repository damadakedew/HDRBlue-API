import { Router } from 'express';
import { d3Query, d3QueryWithAuth } from '../adapters/d3Socket.js';
import { boatHDRSearch } from '../adapters/wsDaveService.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/report/hdr
 * HDR Report — all drivers, vehicles, and watercraft at an address.
 * Each detail link from this report is a billable transaction.
 *
 * Combines D3 response (7-field rows, drivers + vehicles) with
 * WSDaveService BoatHDRSearch (watercraft append).
 */
router.get('/', async (req, res) => {
  try {
    const queryParams = { ...req.query };
    delete queryParams.CName;
    delete queryParams.Audit;

    // Build D3 query from params
    let qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    qs += '&PageName=HDRReportStd.cs';

    const raw = await d3QueryWithAuth(qs, req.session);

    // Parse D3 response — 7 fields per row, newline+pipe delimited
    const drivers = [];
    const vehicles = [];

    if (raw && raw.trim() !== '') {
      const lines = raw.split('\n');

      for (let i = 1; i < lines.length - 1; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const fields = line.split('|').map(f => f.replace(/\0/g, ' ').trim());
        if (fields.length < 6) continue;

        // Strip HTML from name field (field[1] contains links)
        const nameRaw = fields[1] || '';
        const name = nameRaw.replace(/<[^>]+>/g, '').trim();

        // Detect driver vs vehicle by NAME * marker or field content
        const isDriver = nameRaw.indexOf('NAME *') >= 0 ||
                          nameRaw.indexOf('Surname Match') >= 0;

        // Strip (TTAG) from field[2]
        let field2 = fields[2] || '';
        if (field2.indexOf('(TTAG)') >= 0) {
          field2 = field2.split('(')[0].trim();
        }

        // Extract detail link info from name HTML
        const detailMatch = nameRaw.match(/(?:DriverDetail|TitleDetail|WaterDetail)\.aspx\?[^"']*/i);
        let detailUrl = detailMatch ? detailMatch[0] : null;

        if (isDriver) {
          drivers.push({
            seq: fields[0],
            name,
            license: field2,
            dob: fields[3] || '',
            age: fields[4] || '',
            address: fields[5] || '',
            detailUrl,
          });
        } else {
          vehicles.push({
            seq: fields[0],
            name,
            plate: field2,
            year: fields[3] || '',
            make: fields[4] || '',
            model: fields[5] || '',
            address: fields[6] || '',
            detailUrl,
          });
        }
      }
    }

    // Append watercraft via WSDaveService
    let watercraft = [];
    try {
      const address = queryParams.MATCHADDR || '';
      const zip = queryParams.QUERYZIP || '';

      if (address && zip) {
        // Get index address from D3
        const addrQuery = `Search_Type=GET.INDEXADDR&Address=${encodeURIComponent(address)}&ZipCode=${encodeURIComponent(zip)}`;
        const indexAddr = await d3Query(addrQuery);

        if (indexAddr && indexAddr.trim()) {
          watercraft = await boatHDRSearch(indexAddr.trim());
        }
      }
    } catch (wcErr) {
      console.error('HDR watercraft append error:', wcErr.message);
      // Non-fatal — return drivers/vehicles without watercraft
    }

    res.json({
      success: true,
      data: {
        drivers,
        vehicles,
        watercraft,
      },
    });
  } catch (err) {
    console.error('HDR Report error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
