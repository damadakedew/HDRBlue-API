import { Router } from 'express';
import { d3QueryWithAuth } from '../adapters/d3Socket.js';
import { mgCrimHeader, mgCrimHeaderOne } from '../adapters/wsDaveService.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

/**
 * Format criminal physical description fields.
 * Strip parenthetical prefixes: "W) WHITE" → "WHITE"
 * Format height: "510" → "5'10\""
 * Format weight: "180" → "180 lbs"
 */
function formatPhysical(header) {
  const stripPrefix = (val) => {
    if (!val || typeof val !== 'string') return val || '';
    const idx = val.indexOf(')');
    return idx >= 0 ? val.substring(idx + 1).trim() : val;
  };

  const formatHeight = (val) => {
    if (!val || val.length < 2) return val || '';
    return `${val.substring(0, 1)}'${val.substring(1)}"`;
  };

  return {
    sex: stripPrefix(header.Sex),
    race: stripPrefix(header.Race),
    hair: stripPrefix(header.Hair),
    eye: stripPrefix(header.Eye),
    height: formatHeight(header.Height),
    weight: header.Weight ? `${header.Weight} lbs` : '',
    ethnicity: header.Ethnicity || '',
  };
}

/**
 * Build photo URL from PhotoFileName.
 * Path: CrimImages/{c1}/{c2}/{c3}/{c4}/{c5}/{c6}/{filename}.jpg
 */
function buildPhotoUrl(photoFileName) {
  if (!photoFileName) return null;
  let path = 'CrimImages/';
  const len = Math.min(photoFileName.length, 6);
  for (let i = 0; i < len; i++) {
    path += photoFileName.charAt(i) + '/';
  }
  return path + photoFileName + '.jpg';
}

/**
 * Parse .NET JSON date format: /Date(1268352000000)/
 * Returns MM/DD/YYYY string or original value if not a .NET date.
 */
function parseDotNetDate(val) {
  if (!val) return '';
  const str = String(val);
  const match = str.match(/\/Date\((-?\d+)\)\//);
  if (match) {
    const d = new Date(parseInt(match[1], 10));
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  }
  if (str.includes(' ')) return str.split(' ')[0];
  return str;
}

/**
 * Calculate age from DOB string and optional reference date.
 */
function calculateAge(dobStr, refDate) {
  if (!dobStr) return null;
  try {
    const ref = refDate ? new Date(refDate) : new Date();
    // DOB may be in DDMMYYYY or MM/DD/YYYY format
    let dob;
    if (dobStr.includes('/')) {
      dob = new Date(dobStr);
    } else {
      // DDMMYYYY format
      const dd = dobStr.substring(0, 2);
      const mm = dobStr.substring(2, 4);
      const yyyy = dobStr.substring(4, 8);
      dob = new Date(`${mm}/${dd}/${yyyy}`);
    }

    let age = ref.getFullYear() - dob.getFullYear();
    const mDiff = ref.getMonth() - dob.getMonth();
    if (mDiff < 0 || (mDiff === 0 && ref.getDate() < dob.getDate())) {
      age--;
    }
    return age;
  } catch {
    return null;
  }
}

/**
 * Reformat DOB from DDMMYYYY to MM/DD/YYYY
 */
function reformatDob(dob) {
  if (!dob || dob.includes('/')) return dob;
  if (dob.length >= 8) {
    return `${dob.substring(2, 4)}/${dob.substring(0, 2)}/${dob.substring(4, 8)}`;
  }
  return dob;
}

/**
 * GET /api/detail/criminal/profile
 * Criminal profile — header, TRN list, custody, alias names, photo.
 * Transaction trace: TCODE=7083, DB=CR (logged on first load)
 */
router.get('/profile', async (req, res) => {
  try {
    const { PersonId } = req.query;

    if (!PersonId) {
      return res.status(400).json({ success: false, error: 'PersonId is required.' });
    }

    // Clean PersonId (strip pipes)
    const cleanId = PersonId.replace(/\|/g, '');

    // Log transaction trace
    const traceQs = `Search_Type=web.logrequest&TCODE=7083&DB=CR&ItemID=${encodeURIComponent(cleanId)}&AuditValue=Criminal Profile&DoTrans=Yes`;
    await d3QueryWithAuth(traceQs, req.session);

    // Fetch profile from WSDaveService
    const header = await mgCrimHeader(cleanId);

    const physical = formatPhysical(header);
    const dob = reformatDob(header.DOB);
    const age = calculateAge(dob);
    const photoUrl = buildPhotoUrl(header.PhotoFileName);

    // Separate primary name from aliases
    const aliasNames = [];
    let primaryName = header.Name || '';
    if (header.Names && header.Names.length > 0) {
      for (const n of header.Names) {
        if (n.Type === 'S') {
          aliasNames.push(n.FullName);
        } else {
          primaryName = n.FullName;
        }
      }
    }

    // Build TRN list with age-at-arrest
    const trns = (header.TRNs || []).map((trn, idx) => {
      const arrestDate = parseDotNetDate(trn.DateOfArrest);
      return {
        id: trn.Id,
        index: idx + 1,
        agency: trn.Agency || '',
        dateOfArrest: arrestDate,
        ageAtArrest: calculateAge(dob, arrestDate),
        arrestSeq: trn.ArrestSeq || '',
        trackingNumber: trn.TrackingNumber || '',
      };
    });

    // Custody records (from header, not detail)
    const custody = (header.CustodyRecords || []).map(cr => ({
      id: cr.Id || '',
      dateOfOffense: parseDotNetDate(cr.DateOfOffense),
      trackingNumber: cr.TrackingNumber || '',
      agency: cr.Agency || '',
      pidNumber: cr.PidNumber || '',
      sentenceExpiresOn: parseDotNetDate(cr.SentenceExpiresOn),
      countyOfCommitment: cr.CountyOfCommitment || '',
      custodyStartDate: parseDotNetDate(cr.CustodyStartDate),
      supervisionNumber: cr.SupervisionNumber || '',
      supervisionLiteral: cr.SupervisionLiteral || '',
      receivingAgency: cr.ReceivingAgency || '',
      paroledUntil: parseDotNetDate(cr.ParoledUntil),
    }));

    res.json({
      success: true,
      data: {
        id: cleanId,
        name: primaryName,
        dob,
        age,
        dpsNumber: header.DpsNumber || '',
        ...physical,
        photoUrl,
        aliasNames,
        trns,
        custodyRecords: custody,
      },
    });
  } catch (err) {
    console.error('Criminal Profile error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/detail/criminal/arrest
 * Criminal arrest detail — offenses, prosecutions, court stats for a specific TRN.
 */
router.get('/arrest', async (req, res) => {
  try {
    const { PersonId, TRNId } = req.query;

    if (!PersonId || !TRNId) {
      return res.status(400).json({ success: false, error: 'PersonId and TRNId are required.' });
    }

    const cleanId = PersonId.replace(/\|/g, '');
    const detail = await mgCrimHeaderOne(cleanId, TRNId);

    // Parse offenses — AON may contain pipe: "AON|Citation"
    const offenses = (detail.Offenses || []).map(o => {
      let aon = o.AON || '';
      let citation = '';
      if (aon.includes('|')) {
        const parts = aon.split('|');
        aon = parts[0];
        citation = parts[1] || '';
      }
      return {
        id: o.Id || '',
        trsId: o.TRSId || '',
        agency: o.Agency || '',
        dateOfOffense: o.DateOfOffense ? o.DateOfOffense.toString().split(' ')[0] : '',
        aon,
        citation,
        aol: o.AOL || '',
        levelDegree: o.LevelDegree || '',
        goc: o.GOC || '',
        adn: o.ADN || '',
        add: o.ADD || '',
        adaDt: o.ADADt ? o.ADADt.toString().split(' ')[0] : '',
        ref: o.REF || '',
        ipn: o.IPN || '',
        ica: o.ICA || '',
        dmv: o.DMV || '',
      };
    });

    // Parse prosecutions
    const prosecutions = (detail.Prosecutions || []).map(p => ({
      id: p.Id || '',
      trsId: p.TRSId || '',
      agency: p.Agency || '',
      actDate: p.ACTDt ? p.ACTDt.toString().split(' ')[0] : '',
      goc: p.GOC || '',
      pon: p.PON || '',
      pol: p.POL || '',
      ldp: p.LDP || '',
      paf: p.PAF || '',
      dmv: p.DMV || '',
    }));

    // Parse court stats — CON may contain pipe: "CON|COD"
    const courtStats = (detail.CourtStats || []).map(c => {
      let con = c.CON || '';
      let cod = '';
      if (con.includes('|')) {
        const parts = con.split('|');
        con = parts[0];
        cod = parts[1] || '';
      }
      return {
        id: c.Id || '',
        trsId: c.TRSId || '',
        agency: c.Agency || '',
        cdn: c.CDN || '',
        cau: c.CAU || '',
        fpo: c.FPO || '',
        dosDate: c.DOSDt ? c.DOSDt.toString().split(' ')[0] : '',
        goc: c.GOC || '',
        con,
        cod,
        col: c.COL || '',
        ldc: c.LDC || '',
        fcd: c.FCD || '',
        dcaDt: c.DCADt ? c.DCADt.toString().split(' ')[0] : '',
        cmt: c.CMT || '',
        cpn: c.CPN || '',
        cpr: c.CPR || '',
        css: c.CSS || '',
        cfn: c.CFN || '',
        csf: c.CSF || '',
        cpl: c.CPL || '',
        cst: c.CST || '',
        cddDt: c.CDDDt ? c.CDDDt.toString().split(' ')[0] : '',
        dda: c.DDA || '',
        csc: c.CSC || '',
        arc: c.ARC || '',
        mcc: c.MCC || '',
        dmv: c.DMV || '',
      };
    });

    res.json({
      success: true,
      data: {
        id: detail.Id || '',
        trnId: TRNId,
        offenses,
        prosecutions,
        courtStats,
      },
    });
  } catch (err) {
    console.error('Criminal Arrest Detail error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
