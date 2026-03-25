/**
 * Parse D3 summary response (pipe-delimited rows) into structured JSON.
 * D3 returns: header row\ndata rows\n (9 fields per row, pipe-delimited)
 *
 * CRITICAL: D3 embeds raw HTML in fields. This parser strips HTML and extracts
 * structured data from the embedded SELECT dropdowns in FIELD8.
 */

/**
 * Parse a D3 summary response string into an array of result objects.
 * @param {string} raw - Raw D3 response
 * @param {string} searchType - Search type code (e.g., 'Name', 'Address', 'Plate', 'Vin', 'License')
 * @param {string} database - Database code (e.g., 'DL', 'CR')
 * @returns {{ results: object[], timeout: boolean }}
 */
export function parseSummaryResponse(raw, searchType, database) {
  if (!raw || raw.trim() === '') {
    return { results: [], timeout: false };
  }

  const lines = raw.split('\n');
  // First line is header, last may be empty. Need at least 3 lines for data.
  if (lines.length <= 2) {
    return { results: [], timeout: false };
  }

  let timeout = false;
  const results = [];

  // Skip first line (header), skip last line (usually empty)
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i];

    if (line.indexOf('TIMEOUT') >= 0) {
      timeout = true;
      break;
    }

    const fields = line.split('|');
    if (fields.length < 9) continue;

    // Clean null chars from all fields
    const cleaned = fields.map(f => f.replace(/\0/g, ' ').trim());

    // Parse FIELD8 (Selections dropdown HTML) to extract detail identifiers
    const detailInfo = parseField8(cleaned[7]);

    // Parse FIELD2 for HTML content (bold tags, address+name)
    const field2Info = parseField2(cleaned[1], searchType);

    // Strip (TTAG) from FIELD4
    let field4 = cleaned[3];
    if (field4.indexOf('(TTAG)') >= 0) {
      field4 = field4.split('(')[0].trim();
    }

    const record = {
      seq: cleaned[0],
      isCurrent: field2Info.isCurrent,
      updateDate: cleaned[2],
      dobTag: field4,
      zip: cleaned[5],
      type: cleaned[6],
      detailId: detailInfo.detailId,
      detailType: detailInfo.detailType,
      hdrParams: detailInfo.hdrParams,
      additional: cleaned[8] || '',
    };

    // Search-type-specific field naming
    if (searchType === 'Address') {
      record.address = field2Info.primaryText;
      record.ownerName = field2Info.secondaryText;
      record.city = cleaned[4];
    } else {
      record.name = field2Info.primaryText;
      if (database === 'DL') {
        // Column 5 meaning varies by search type
        if (searchType === 'Vin') {
          record.vin = cleaned[4];
        } else if (searchType === 'License') {
          record.license = cleaned[4];
        } else {
          record.city = cleaned[4];
        }
      } else if (database === 'CR') {
        record.stateId = cleaned[4];
        record.nameType = cleaned[5];
        record.zip = undefined; // CR uses field 6 for NType, not zip
      } else {
        record.city = cleaned[4];
      }
    }

    results.push(record);
  }

  return { results, timeout };
}

/**
 * Parse FIELD8 — D3 sends a raw HTML <SELECT> dropdown.
 * Extract the detail URL parameters and determine route type.
 *
 * Example FIELD8 content (after pipe-split from D3):
 * <SELECT style="color:blue" onchange="submitForm(this)">
 *   <OPTION>Selections
 *   <OPTION VALUE="DriverDetail.aspx?...&DBViewItem=12345">Detail Report</OPTION>
 *   <OPTION VALUE="HDRReport.html?...">HDR Report</OPTION>
 * </SELECT>
 */
function parseField8(field8) {
  const result = { detailId: null, detailType: null, hdrParams: null };
  if (!field8) return result;

  // Decode HTML entities if present
  const decoded = decodeHtmlEntities(field8);

  // Extract OPTION values using regex
  const optionRegex = /VALUE="([^"]+)"[^>]*>([^<]+)/gi;
  let match;

  while ((match = optionRegex.exec(decoded)) !== null) {
    const url = match[1];
    const label = match[2].trim();

    if (label === 'Selections') continue;

    if (label.indexOf('Detail') >= 0 || label.indexOf('detail') >= 0) {
      // Extract the detail identifier
      const dbViewMatch = url.match(/DBViewItem=([^&"]+)/);
      const dlidMatch = url.match(/DLID=([^&"]+)/);
      const vinMatch = url.match(/Vin=([^&"]+)/);
      const txnMatch = url.match(/TXN=([^&"]+)/);

      let rawId = (dbViewMatch && dbViewMatch[1]) ||
                  (dlidMatch && dlidMatch[1]) ||
                  (vinMatch && vinMatch[1]) ||
                  (txnMatch && txnMatch[1]) || null;

      // Clean up: decode URL encoding and strip pipe characters
      if (rawId) {
        rawId = decodeURIComponent(rawId).replace(/\|/g, '').trim();
      }
      result.detailId = rawId;

      // Determine route type from URL
      if (url.indexOf('DriverDetail') >= 0 || url.indexOf('Driver.blue') >= 0) {
        result.detailType = 'driver';
      } else if (url.indexOf('TitleDetail') >= 0 || url.indexOf('Title.blue') >= 0) {
        result.detailType = 'title';
      } else if (url.indexOf('WaterDetail') >= 0) {
        result.detailType = 'watercraft';
      } else if (url.indexOf('CriminalDetail') >= 0) {
        result.detailType = 'criminal';
      } else {
        result.detailType = 'title'; // default
      }
    }

    if (label.indexOf('HDR') >= 0) {
      // Extract HDR report parameters for later use
      try {
        const hdrUrl = new URL(url, 'http://localhost');
        result.hdrParams = {
          searchType: hdrUrl.searchParams.get('Search_Type'),
          fileType: hdrUrl.searchParams.get('FILETYPE'),
          queryZip: hdrUrl.searchParams.get('QUERYZIP'),
          queryItem: hdrUrl.searchParams.get('QUERYITEM'),
          matchAddr: hdrUrl.searchParams.get('MATCHADDR'),
          queryAddr: hdrUrl.searchParams.get('QUERYADDR'),
          queryCity: hdrUrl.searchParams.get('QUERYCITY'),
        };
      } catch {
        // URL parsing failed, skip HDR params
      }
    }
  }

  // Fallback: try to extract any identifier from raw string
  if (!result.detailId) {
    const fallback = decoded.match(/(?:DBViewItem|TXN|DLID|Vin)=([^&"<\s]+)/i);
    if (fallback) {
      result.detailId = fallback[1];
    }
  }

  return result;
}

/**
 * Parse FIELD2 — may contain HTML bold/strong tags and address+name format.
 * @param {string} field2 - Raw FIELD2 value
 * @param {string} searchType - 'Address', 'Name', etc.
 * @returns {{ primaryText: string, secondaryText: string|null, isCurrent: boolean }}
 */
function parseField2(field2, searchType) {
  if (!field2) return { primaryText: '', secondaryText: null, isCurrent: false };

  // Detect bold/strong tags = current record
  const isCurrent = /<b>|<B>|<strong>|<STRONG>/i.test(field2);

  // Strip all HTML tags
  let text = field2.replace(/<[^>]+>/g, '').trim();

  // For address searches, FIELD2 contains address + (name) separated by line break
  let primaryText = text;
  let secondaryText = null;

  if (searchType === 'Address') {
    // D3 may use <br> or actual newline between address and (name)
    const decoded = decodeHtmlEntities(field2);
    const stripped = decoded.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    const parts = stripped.split('\n').map(p => p.trim()).filter(Boolean);

    if (parts.length >= 2) {
      primaryText = parts[0];
      // Remove parentheses from name
      secondaryText = parts[1].replace(/^\(/, '').replace(/\)$/, '').trim();
    } else {
      primaryText = stripped.trim();
    }
  }

  return { primaryText, secondaryText, isCurrent };
}

/**
 * Decode HTML entities in a string.
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
