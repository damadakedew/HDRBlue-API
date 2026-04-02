import { Router } from 'express';
import { getTestDataDb, getDb } from '../adapters/mongoClient.js';

const router = Router();

const MAX_RESULTS = 300;

// Pick epoch: Dec 31, 1967
const PICK_EPOCH = new Date(1967, 11, 31);

/**
 * Convert Pick internal date (days since Dec 31, 1967) to a formatted string.
 * @param {number|string} internal - Pick internal date value
 * @param {string} format - 'MM-YYYY' or 'MM-DD-YYYY'
 */
function pickDateToString(internal, format = 'MM-YYYY') {
  const days = parseInt(internal, 10);
  if (isNaN(days)) return '';
  const ms = PICK_EPOCH.getTime() + days * 86400000;
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  if (format === 'MM-DD-YYYY') return `${mm}-${dd}-${yyyy}`;
  return `${mm}-${yyyy}`;
}

/**
 * Map of endpoint names to whether they are enabled.
 * Extend this as more search types are ported to MongoDB.
 */
const ENABLED_SEARCHES = {
  name: true,
};

/**
 * GET /api/search/mongo/capabilities
 * Returns which mongo-backed search endpoints are available.
 */
router.get('/capabilities', (req, res) => {
  res.json({ success: true, data: { ...ENABLED_SEARCHES } });
});

/**
 * GET /api/search/mongo/name
 * Atlas Search name query against IndexMergeNumeric,
 * enriched with TT-MASTER detail fields.
 *
 * Accepts the same query params as /api/search/dps/name:
 *   LastName, FirstName, MiddleName, Year, ZipCity, Company,
 *   QueryDatabase (ALL|DL|TT), RecordsToSearch (All|Current)
 */
router.get('/name', async (req, res) => {
  try {
    const {
      LastName, FirstName, MiddleName, Year, ZipCity,
      Company, QueryDatabase, RecordsToSearch,
    } = req.query;

    const isCommercial = !!Company && !LastName;

    if (!isCommercial && !LastName) {
      return res.status(400).json({
        success: false,
        error: 'LastName is required for personal search. Company is required for commercial search.',
      });
    }

    // Build Atlas Search compound query
    const mustClauses = [];

    if (isCommercial) {
      mustClauses.push({
        text: { query: Company.toUpperCase(), path: 'MGData.3' },
      });
    } else {
      // Last name — required
      mustClauses.push({
        text: { query: LastName.toUpperCase(), path: 'MGData.0' },
      });

      // First name — optional, with name synonyms
      if (FirstName) {
        mustClauses.push({
          text: {
            query: FirstName.toUpperCase(),
            path: 'MGData.1',
            synonyms: 'name_synonyms',
          },
        });
      }

      // Middle / given names — optional, with name synonyms
      if (MiddleName) {
        mustClauses.push({
          text: {
            query: MiddleName.toUpperCase(),
            path: 'MGData.2',
            synonyms: 'name_synonyms',
          },
        });
      }

      // Birth date / year filter
      if (Year) {
        mustClauses.push({
          text: { query: Year.toUpperCase(), path: 'MGData.5' },
        });
      }
    }

    // ZipCity — use city_zip_synonyms with TX. prefix
    if (ZipCity) {
      const val = ZipCity.toUpperCase().trim();
      // If it looks like a zip code (digits), search directly
      const isZip = /^\d+$/.test(val);
      if (isZip) {
        mustClauses.push({
          text: { query: val, path: 'MGData.4' },
        });
      } else {
        // City name — format as TX.CITY.NAME (dots replace spaces)
        const cityKey = 'TX.' + val.replace(/\s+/g, '.');
        mustClauses.push({
          text: {
            query: cityKey,
            path: 'MGData.4',
            synonyms: 'city_zip_synonyms',
          },
        });
      }
    }

    // Current-only filter: MGData.7 absent means current, "0" means not current
    const filterClauses = [];
    if (RecordsToSearch === 'Current') {
      filterClauses.push({
        compound: {
          mustNot: [{ exists: { path: 'MGData.7' } }],
        },
      });
    }

    // Database filter: TT or DL prefix in MGData.6
    if (QueryDatabase && QueryDatabase !== 'ALL') {
      filterClauses.push({
        text: { query: QueryDatabase.toUpperCase(), path: 'MGData.6' },
      });
    }

    const searchStage = {
      $search: {
        index: 'default',
        compound: {
          must: mustClauses,
          ...(filterClauses.length > 0 ? { filter: filterClauses } : {}),
        },
      },
    };

    const db = await getTestDataDb();
    const collection = db.collection('IndexMergeNumeric');

    const pipeline = [
      searchStage,
      { $limit: MAX_RESULTS },
    ];

    const searchResults = await collection.aggregate(pipeline).toArray();

    if (searchResults.length === 0) {
      return res.json({
        success: true,
        timeout: false,
        resultCount: 0,
        searchType: 'Name',
        database: 'MongoDB/Atlas',
        data: [],
      });
    }

    // Collect detail IDs for TT-MASTER enrichment
    const ttIds = [];
    const dlIds = [];
    for (const doc of searchResults) {
      const id = doc.MGData?.['6'];
      if (!id) continue;
      if (id.startsWith('TT')) ttIds.push(id);
      else if (id.startsWith('DL')) dlIds.push(id);
    }

    // Batch-fetch TT-MASTER records
    let ttMasterMap = {};
    if (ttIds.length > 0) {
      try {
        const ttDb = await getDb('TT_MASTER');
        const ttColl = ttDb.collection('TT-MASTER');
        const ttDocs = await ttColl.find({ _id: { $in: ttIds } }).toArray();
        for (const doc of ttDocs) {
          ttMasterMap[doc._id] = doc.MGData || {};
        }
      } catch (err) {
        console.error('TT-MASTER lookup error:', err.message);
      }
    }

    // DL-MASTER not available in test data — placeholder for future
    let dlMasterMap = {};
    if (dlIds.length > 0) {
      try {
        const dlDb = await getDb('DL_MASTER');
        const dlColl = dlDb.collection('DL-MASTER');
        const dlDocs = await dlColl.find({ _id: { $in: dlIds } }).toArray();
        for (const doc of dlDocs) {
          dlMasterMap[doc._id] = doc.MGData || {};
        }
      } catch (err) {
        console.error('DL-MASTER lookup error (expected in test):', err.message);
      }
    }

    // Build response matching the D3 summary shape
    const data = searchResults.map((doc, index) => {
      const mg = doc.MGData || {};
      const rawId = mg['6'] || null;
      const prefix = rawId ? rawId.substring(0, 2) : '';
      const detailId = rawId ? rawId.substring(2) : null;
      const isTT = prefix === 'TT';
      const isDL = prefix === 'DL';
      const masterData = isTT ? ttMasterMap[rawId] : isDL ? dlMasterMap[rawId] : {};

      // Form display name: "LAST, FIRST GIVEN"
      let nameParts = [mg['0'] || ''];
      const first = mg['1'] || '';
      const given = Array.isArray(mg['2']) ? mg['2'].join(' ') : (mg['2'] || '');
      const firstAndGiven = [first, given].filter(Boolean).join(' ');
      if (firstAndGiven) nameParts.push(firstAndGiven);
      const displayName = nameParts.join(', ');

      // isCurrent: MGData.7 absent = current, "0" = not current
      const isCurrent = mg['7'] === undefined || mg['7'] === null;

      // Enrichment from master — default empty when master not found
      const master = masterData || {};
      const updateDate = master['15'] ? pickDateToString(master['15'], 'MM-YYYY') : '';
      // dobTag: master field 6, take first value if array
      let dobTag = master['6'] || '';
      if (Array.isArray(dobTag)) dobTag = dobTag[0] || '';
      const city = master['2'] || '';

      // Zip: use query zip if full zip was specified, otherwise master field 3
      let zip = master['3'] || '';
      if (ZipCity && /^\d{5,}$/.test(ZipCity.trim())) {
        zip = ZipCity.trim();
      }

      // Type from prefix — legacy displays TAG instead of TT
      const type = prefix === 'TT' ? 'TAG' : prefix;

      // Detail type for frontend routing
      let detailType = 'title'; // default
      if (isDL) detailType = 'driver';
      else if (isTT) detailType = 'title';

      return {
        seq: String(index + 1),
        name: displayName,
        isCurrent,
        updateDate,
        dobTag,
        city,
        zip,
        type,
        detailId,
        detailType,
        hdrParams: null, // skipped for now
        additional: '',
      };
    });

    res.json({
      success: true,
      timeout: false,
      resultCount: data.length,
      searchType: 'Name',
      database: 'MongoDB/Atlas',
      data,
    });
  } catch (err) {
    console.error('Mongo Name Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
