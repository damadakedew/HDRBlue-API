import soap from 'soap';

const WS_DAVE_URL = process.env.WS_DAVE_URL || 'https://portal2.hdr.com/MGCrim/Search.asmx';
const WSDL_URL = `${WS_DAVE_URL}?WSDL`;

let soapClient = null;

/**
 * Get or create a SOAP client for WSDaveService.
 * Caches the client after first creation.
 */
async function getClient() {
  if (soapClient) return soapClient;

  soapClient = await soap.createClientAsync(WSDL_URL, {
    wsdl_options: { rejectUnauthorized: false },
    forceSoap12Headers: false,
  });

  return soapClient;
}

/**
 * Call a WSDaveService method and return the result.
 * @param {string} method - Method name (e.g., 'BoatNameSearch')
 * @param {object} args - Arguments object
 * @returns {Promise<any>} Parsed result
 */
async function callService(method, args) {
  const client = await getClient();

  return new Promise((resolve, reject) => {
    client[method](args, (err, result) => {
      if (err) {
        reject(new Error(`WSDaveService.${method} failed: ${err.message}`));
      } else {
        resolve(result);
      }
    });
  });
}

// ========================
// Watercraft Search Methods
// ========================

/**
 * Boat Name Search (Personal)
 */
export async function boatNameSearch(lastName, firstName, middleName, zip, city) {
  const result = await callService('BoatNameSearch', {
    Last: lastName || '',
    First: firstName || '',
    Middle: middleName || '',
    Zip: zip || '',
    City: city || '',
    partial: 'yes',
  });
  return parseBoaterSummaryResult(result);
}

/**
 * Boat Business Name Search (Commercial)
 */
export async function boatBizNameSearch(company, zip, city) {
  const result = await callService('BoatBizNameSearch', {
    Company: company || '',
    Zip: zip || '',
    City: city || '',
    partial: 'yes',
  });
  return parseBoaterSummaryResult(result);
}

/**
 * Boat TXN Search
 */
export async function boatTXNSearch(txn) {
  // Strip "TX" prefix if present
  const cleanTxn = txn.toUpperCase().replace('TX', '');
  const result = await callService('BoatTXNSearch', { TXN: cleanTxn });
  return parseBoaterSummaryResult(result);
}

/**
 * Boat HIN Search
 */
export async function boatHINSearch(hin) {
  const result = await callService('BoatHINSearch', { HIN: hin });
  return parseBoaterSummaryResult(result);
}

/**
 * Boat Motor Search
 */
export async function boatMotorSearch(motorSerial) {
  const result = await callService('BoatMotorSearch', {
    MotorSerial: motorSerial.toUpperCase(),
  });
  return parseBoaterSummaryResult(result);
}

/**
 * Boat Address Search — requires D3 index lookup first (done by caller)
 */
export async function boatAddrSearch(indexAddr) {
  const result = await callService('BoatAddrSearch', { IndexAddr: indexAddr });
  return parseBoaterSummaryResult(result);
}

/**
 * Boat HDR Search — for HDR Report watercraft append
 */
export async function boatHDRSearch(indexAddr) {
  const result = await callService('BoatHDRSearch', { IndexAddr: indexAddr });
  return parseBoaterHDRResult(result);
}

/**
 * Boat Record Detail
 */
export async function boatRecord(txn) {
  const result = await callService('BoatRecord', { id: txn });
  return parseBoatRecordResult(result);
}

// ========================
// Criminal Detail Methods
// ========================

/**
 * Criminal Header — profile + TRN list + custody records
 */
export async function mgCrimHeader(personId) {
  const result = await callService('MGCrimHeader', { PersonID: personId });
  // Returns JSON string — parse it
  const jsonStr = extractStringResult(result, 'MGCrimHeaderResult');
  return JSON.parse(jsonStr);
}

/**
 * Criminal Detail for a specific TRN (arrest)
 */
export async function mgCrimHeaderOne(personId, trnId) {
  const result = await callService('MGCrimHeaderOne', {
    PersonID: personId,
    TRNId: trnId,
  });
  const jsonStr = extractStringResult(result, 'MGCrimHeaderOneResult');
  return JSON.parse(jsonStr);
}

// ========================
// Response Parsers
// ========================

/**
 * Extract a string result from a SOAP response.
 * SOAP wraps results in {MethodNameResult: 'string'}
 */
function extractStringResult(result, key) {
  if (!result) return '{}';
  if (typeof result === 'string') return result;
  if (result[key]) return result[key];
  // Try first key
  const keys = Object.keys(result);
  if (keys.length > 0 && typeof result[keys[0]] === 'string') {
    return result[keys[0]];
  }
  return JSON.stringify(result);
}

/**
 * Parse BoaterSummaryItem[] from SOAP response into clean JSON array.
 */
function parseBoaterSummaryResult(result) {
  if (!result) return [];

  // SOAP may return the array under various keys
  let items = result.BoatNameSearchResult ||
              result.BoatBizNameSearchResult ||
              result.BoatTXNSearchResult ||
              result.BoatHINSearchResult ||
              result.BoatMotorSearchResult ||
              result.BoatAddrSearchResult ||
              result;

  // Handle diffgram/dataset wrapping
  if (items && items.BoaterSummaryItem) {
    items = items.BoaterSummaryItem;
  }

  if (!Array.isArray(items)) {
    items = items ? [items] : [];
  }

  return items.map((item, idx) => ({
    seq: item.Seq || String(idx + 1),
    name: item.Name || '',
    updateDate: item.UpdDate || '',
    dobTag: item.DOBTag || '',
    city: item.City || '',
    zip: item.Zip || '',
    type: item.Type || 'WAT',
    detailId: item.DropDownItem || '',
    detailType: 'watercraft',
    address: item.Address || '',
  }));
}

/**
 * Parse BoaterHDRSummaryItem[] for HDR Report watercraft append.
 */
function parseBoaterHDRResult(result) {
  if (!result) return [];

  let items = result.BoatHDRSearchResult || result;
  if (items && items.BoaterHDRSummaryItem) {
    items = items.BoaterHDRSummaryItem;
  }

  if (!Array.isArray(items)) {
    items = items ? [items] : [];
  }

  return items.map((item, idx) => ({
    seq: String(idx + 1),
    name: item.Name || '',
    txn: item.id || '',
    year: item.Year || '',
    make: item.Make || '',
    model: item.Model || '',
    address: item.Address || '',
  }));
}

/**
 * Parse a single Boater record for detail view.
 */
function parseBoatRecordResult(result) {
  if (!result) return null;

  const rec = result.BoatRecordResult || result;

  return {
    txNumber: (rec.TX_Number || '').toUpperCase(),
    businessName: (rec.Business_Name || '').toUpperCase(),
    lastName: (rec.Last_Name || '').toUpperCase(),
    firstName: (rec.First_Name || '').toUpperCase(),
    middleInitial: (rec.MI || '').toUpperCase(),
    address: (rec.Address_Line_1 || '').toUpperCase(),
    city: (rec.City || '').toUpperCase(),
    state: (rec.State || '').toUpperCase(),
    zip: rec.Zip || '',
    make: rec.Make || '',
    model: rec.Model || '',
    modelYear: rec.Model_Year || '',
    yearBuilt: rec.Year_Built || '',
    lengthFt: rec.Length_Ft || '',
    lengthIn: rec.Length_In || '',
    hinMin: rec.HIN_MIN || '',
    hullDescription: rec.Hull_Description || '',
    engineType: rec.Engine_Type || '',
    fuelDescription: rec.Fuel_Description || '',
    vesselType: rec.Vessel_Type || '',
    vesselUse: rec.Vessel_Use || '',
    statePrincipalOp: rec.State_Principal_Op || '',
    propulsion: rec.Propulsion || '',
    motor1Horsepower: rec.Motor_1_Horsepower || '',
    motor1SerialNo: rec.Motor_1_Serial_No || '',
    motor2Horsepower: rec.Motor_2_Horsepower || '',
    motor2SerialNo: rec.Motor_2_Serial_No || '',
    originalRegistrationDate: rec.Original_Registration_Date || '',
    titleDate: rec.Title_Date || '',
    renewalDate: rec.Renewal_Date || '',
    countyCode: rec.County_Code || '',
    countyName: rec.County_Name || '',
  };
}
