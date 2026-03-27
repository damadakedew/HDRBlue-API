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
 * D3 Response format:
 * Line 0: FIELD1|FIELD2|FIELD3|FIELD4|FIELD5|FIELD6|FIELD7 (skip)
 * Line 1: Seq|NAME *Surname Match*|Type|License#|DOB|Age|Address (driver section header)
 * Lines 2-N: Driver data rows with <p> tags containing detail links
 * Line N+1: Seq|NAME *Surname Match*|Plate|Year|Make|Model|Address (vehicle section header)
 * Lines N+2-M: Vehicle data rows with <p> tags
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

    const drivers = [];
    const vehicles = [];

    if (raw && raw.trim() !== '') {
      const lines = raw.split('\n');
      let section = null; // 'driver' or 'vehicle'

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const fields = line.split('|').map(f => f.replace(/\0/g, ' ').trim());

        // Skip the very first header line (FIELD1|FIELD2|...)
        if (fields[0] === 'FIELD1') continue;

        // Detect section headers — they contain "NAME *Surname Match*"
        if (fields[1] && fields[1].indexOf('NAME *') >= 0) {
          // Determine section by checking field[2]
          if (fields[2] === 'Type' || fields[2] === 'License#') {
            section = 'driver';
          } else if (fields[2] === 'Plate') {
            section = 'vehicle';
          }
          continue; // Skip the header row itself
        }

        if (fields.length < 6) continue;

        // Parse name from HTML <p> tag
        const nameRaw = fields[1] || '';
        const name = nameRaw
          .replace(/<[^>]+>/g, '')  // Strip HTML tags
          .replace(/^"/, '')        // Strip leading quote
          .replace(/"$/, '')        // Strip trailing quote
          .trim();

        // Extract detail link from <p value="...">
        const detailMatch = nameRaw.match(/value=([^">\s]+)/i);
        let detailId = null;
        let detailType = null;

        if (detailMatch) {
          const url = detailMatch[1];
          const idMatch = url.match(/DBViewItem=([^&]+)/);
          if (idMatch) detailId = idMatch[1];

          if (url.indexOf('DriverDetail') >= 0) {
            detailType = 'driver';
          } else if (url.indexOf('TitleDetail') >= 0) {
            detailType = 'title';
          } else if (url.indexOf('WaterDetail') >= 0) {
            detailType = 'watercraft';
          }
        }

        // Determine if current record is bold (current resident)
        const isCurrent = nameRaw.indexOf('<b>') >= 0 || nameRaw.indexOf('<B>') >= 0 ||
                          (fields[6] && fields[6].indexOf('Previous') < 0);

        if (section === 'driver') {
          drivers.push({
            seq: fields[0],
            name,
            type: fields[2] || '',
            license: fields[3] || '',
            dob: fields[4] || '',
            age: fields[5] || '',
            address: fields[6] || '',
            detailId,
            detailType: detailType || 'driver',
            isCurrent,
          });
        } else if (section === 'vehicle') {
          // Strip (TTAG) from plate field
          let plate = fields[2] || '';
          if (plate.indexOf('(TTAG)') >= 0) {
            plate = plate.split('(')[0].trim();
          }

          vehicles.push({
            seq: fields[0],
            name,
            plate,
            year: fields[3] || '',
            make: fields[4] || '',
            model: fields[5] || '',
            address: fields[6] || '',
            detailId,
            detailType: detailType || 'title',
            isCurrent,
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
        // D3 index lookup needs raw spaces
        const addrQuery = `Search_Type=GET.INDEXADDR&Address=${decodeURIComponent(address)}&ZipCode=${zip}`;
        const indexAddr = await d3Query(addrQuery);

        const cleanIndex = (indexAddr || '').trim();
        if (cleanIndex && cleanIndex !== '-') {
          watercraft = await boatHDRSearch(cleanIndex);
        }
      }
    } catch (wcErr) {
      console.error('HDR watercraft append error:', wcErr.message);
    }

    res.json({
      success: true,
      data: {
        address: decodeURIComponent(queryParams.MATCHADDR || ''),
        zip: queryParams.QUERYZIP || '',
        city: decodeURIComponent(queryParams.QUERYCITY || ''),
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
