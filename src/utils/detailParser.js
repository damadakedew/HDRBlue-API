/**
 * Parse D3 detail response (char(254)/char(253) delimited key-value pairs).
 *
 * D3 detail responses use:
 * - char(254) = 0xFE as field separator
 * - char(253) = 0xFD as key-value separator within each field
 */

const FIELD_DELIMITER = String.fromCharCode(254);
const KV_DELIMITER = String.fromCharCode(253);

/**
 * Parse a D3 detail response into a key-value map.
 * @param {string} raw - Raw D3 response
 * @returns {Map<string, string>} Key-value pairs
 */
export function parseDetailResponse(raw) {
  const data = new Map();
  if (!raw) return data;

  const fields = raw.split(FIELD_DELIMITER);

  for (const field of fields) {
    if (!field.trim()) continue;
    const parts = field.split(KV_DELIMITER);
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts[1].trim();
      data.set(key, value);
    }
  }

  return data;
}

/**
 * Parse DLAddrList from driver detail.
 * Format: exclamation-separated rows, pipe-separated columns: date|addr|city|zip|src|hdr$
 * @param {string} raw
 * @returns {object[]}
 */
export function parseDriverAddressList(raw) {
  if (!raw) return [];
  const rows = raw.split('!').filter(r => r.trim());
  return rows.map(row => {
    const cols = row.split('|');
    return {
      date: (cols[0] || '').trim(),
      address: (cols[1] || '').trim(),
      city: (cols[2] || '').trim(),
      zip: (cols[3] || '').trim(),
      source: (cols[4] || '').trim(),
      hdr: (cols[5] || '').replace('$', '').trim(),
    };
  });
}

/**
 * Parse DLNameList from driver detail.
 * Format: pipe-separated rows, colon-separated: NameDate:NameSrc:NameItem
 * @param {string} raw
 * @returns {object[]}
 */
export function parseDriverNameList(raw) {
  if (!raw) return [];
  const rows = raw.split('|').filter(r => r.trim());
  return rows.map(row => {
    const cols = row.split(':');
    return {
      date: (cols[0] || '').trim(),
      source: (cols[1] || '').trim(),
      name: (cols[2] || '').trim(),
    };
  });
}

/**
 * Parse DLUpdHistList from driver detail.
 * Format: pipe-separated rows, exclamation-separated: date!item
 * @param {string} raw
 * @returns {object[]}
 */
export function parseDriverHistoryList(raw) {
  if (!raw) return [];
  const rows = raw.split('|').filter(r => r.trim());
  return rows.map(row => {
    const parts = row.split('!');
    return {
      date: (parts[0] || '').trim(),
      item: (parts[1] || '').trim(),
    };
  });
}

/**
 * Parse TTAddrList from title detail.
 * Format: exclamation-separated rows, pipe-separated: date|name|addr|city|state|zip
 * @param {string} raw
 * @returns {object[]}
 */
export function parseTitleAddressList(raw) {
  if (!raw) return [];
  const rows = raw.split('!').filter(r => r.trim());
  return rows.map(row => {
    const cols = row.split('|');
    return {
      date: (cols[0] || '').trim(),
      name: (cols[1] || '').trim(),
      address: (cols[2] || '').trim(),
      city: (cols[3] || '').trim(),
      state: (cols[4] || '').trim(),
      zip: (cols[5] || '').trim(),
    };
  });
}

/**
 * Parse TTNameList from title detail.
 * Format: pipe-separated owner names
 * @param {string} raw
 * @returns {string[]}
 */
export function parseTitleNameList(raw) {
  if (!raw) return [];
  return raw.split('|').filter(r => r.trim());
}

/**
 * Parse TitleLienInfo.
 * Format: pipe-separated: date|name|addr|city,state|zip
 * @param {string} raw
 * @returns {object|null}
 */
export function parseLienInfo(raw) {
  if (!raw) return null;
  const parts = raw.split('|');
  if (parts.length < 5) return null;

  const cityState = (parts[3] || '').trim();
  const cityStateParts = cityState.split(',');

  return {
    date: (parts[0] || '').trim(),
    name: (parts[1] || '').trim(),
    address: (parts[2] || '').trim(),
    city: (cityStateParts[0] || '').trim(),
    state: (cityStateParts[1] || '').trim(),
    zip: (parts[4] || '').trim(),
  };
}

/**
 * Parse PlateList or VinData.
 * Format: pipe-separated values
 * @param {string} raw
 * @returns {string[]}
 */
export function parsePipeList(raw) {
  if (!raw) return [];
  return raw.split('|').filter(r => r.trim());
}
