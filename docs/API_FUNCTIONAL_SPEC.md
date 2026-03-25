# HDR Blue Horizon API Functional Specification

**Version:** 2.0.0
**Date:** 2026-03-25
**Status:** DRAFT
**System:** Node.js API wrapping Legacy D3 Socket Protocol and WSDaveService Web Services

---

## Table of Contents

1. [Infrastructure](#1-infrastructure)
2. [Authentication](#2-authentication)
3. [DPS/DMV Searches](#3-dpsdmv-searches)
4. [Criminal Searches](#4-criminal-searches)
5. [Watercraft Searches](#5-watercraft-searches)
6. [Detail Endpoints](#6-detail-endpoints)
7. [HDR Report](#7-hdr-report)
8. [Transaction Logging](#8-transaction-logging)
9. [External Services](#9-external-services)
10. [Legacy Reference](#10-legacy-reference)
11. [Endpoint Summary](#11-endpoint-summary)
12. [Adapter Migration Strategy](#12-adapter-migration-strategy)

---

## 1. Infrastructure

### 1.1 D3 Socket Protocol

The legacy system communicates with a D3 database via raw TCP sockets.

| Property | Value |
|---|---|
| **Host** | hdrd301 |
| **Port** | 9001 |
| **Transport** | Raw TCP socket |
| **Request Format** | `GET /?{queryString}` |
| **Response Encoding** | Windows-1252 |
| **Response Prefix** | `xmlserver 3` (stripped before parsing) |
| **Timeout** | 180 seconds |

### 1.2 Data Source Routing

Searches route to one of two backends depending on the data domain:

| Domain | Backend | Protocol |
|---|---|---|
| DPS/DMV (DLN, DLA, DLP, DLV, DLL) | D3 Socket | TCP raw socket to hdrd301:9001 |
| Criminal Summary (CRN, CRI) | D3 Socket | TCP raw socket to hdrd301:9001 |
| Criminal Detail | WSDaveService | SOAP web service: MGCrimHeader, MGCrimHeaderOne |
| Watercraft Summary | WSDaveService | SOAP web service: BoatNameSearch, BoatBizNameSearch, etc. |
| Watercraft Detail | WSDaveService | SOAP web service: BoatRecord |
| Court Violations | TXDPS_Violations_v1 | SOAP web service |

### 1.3 Common Headers

All API requests require:

| Header | Type | Required | Description |
|---|---|---|---|
| `Authorization` | string | Yes | Bearer token or session token |
| `Content-Type` | string | Yes | `application/json` |

### 1.4 Common Server-Side Parameters

These are appended by the server to every D3 query string and are never sent by the client:

| Parameter | Description |
|---|---|
| `CName` | Client/account name, appended server-side |
| `Audit` | Audit trail identifier, appended server-side |

### 1.5 D3 Response HTML Stripping (CRITICAL)

The D3 server returns raw HTML embedded within pipe-delimited data fields. The Node.js response transformer MUST:

1. **FIELD8 (Selections)** — D3 returns a complete `<SELECT>` dropdown with `<OPTION VALUE="url">Label</OPTION>` tags. The transformer must:
   - Parse each `<OPTION>` to extract the URL and label
   - Extract navigation identifiers from URLs (e.g., `DBViewItem=`, `TXN=`, `DLID=`, `Vin=`)
   - Determine route type from URL pattern (DriverDetail vs TitleDetail vs WaterDetail vs CriminalDetail)
   - Return clean JSON: `{ "detailId": "12345", "detailType": "driver" }`

2. **FIELD2 (Name/Address)** — D3 may embed `<b>` or `<STRONG>` tags for emphasis. The transformer must:
   - Detect bold/strong tags and set an `isCurrent: true` flag on the record
   - Strip all HTML tags from the display value
   - For **address searches**: FIELD2 contains the address AND the owner name in parentheses on a second line (with `<br>` between). Split into separate `address` and `ownerName` JSON fields.

   **Note on current-record highlighting:** The legacy UI also highlights a specific column with a blue background (`highCell`). The highlighted column varies by search type:
   - Name search: column 1 (name)
   - Plate search: column 3 (DOB/Tag)
   - License search: column 4 (city/license)

   The JSON response should include a `highlightColumn` field in the metadata so the frontend can replicate this behavior.

3. **All fields** — Strip null chars (`\0`), HTML entities, and any remaining HTML tags.

### 1.6 Common JSON Response Envelope

All API responses use a standard envelope:

```json
{
  "success": true,
  "timeout": false,
  "resultCount": 25,
  "data": [ ... ],
  "error": null
}
```

- `timeout`: Set to `true` when D3 response contains the `TIMEOUT` marker (results may be incomplete)

---

## 2. Authentication

> **STATUS: NEW - must build**
> Authentication goes through D3 directly using the `session_V2` query. No MFA in the initial HDRBlue prototype.

### 2.1 Login

- **Route:** `POST /api/auth/login`
- **Priority:** P0 - Critical
- **Data Source:** D3 Socket

#### Request Body

| Parameter | Type | Required | Description |
|---|---|---|---|
| `username` | string | **Yes** | Account username |
| `password` | string | **Yes** | Password (URL-encoded only, no special encoding) |

#### Legacy D3 Query String

```
Search_Type=session_V2&CName={username}&CNack={urlEncodedPassword}&RemoteIP={clientIP}&InboundHost={inboundHost}
```

**Note:** `RemoteIP` is derived from the HTTP request headers server-side. `InboundHost` is the server hostname.

#### Legacy D3 Response

Pipe-delimited account info string:

```
HOST|PORT|DIR|ACCOUNT|AUDIT|TRACKING|INS_FLAG|CUST_NAME|Allow_Mobile_YN|Ckey_{ID}
```

#### Proposed JSON Response

```json
{
  "success": true,
  "data": {
    "sessionToken": "generated-server-side-token",
    "account": "ACCOUNT_NAME",
    "customerName": "HDR CUSTOMER",
    "allowMobile": "Y"
  }
}
```

**Server-side session stores:** `CName`, `Audit`, `Tracking`, `Host`, `Port` — appended to every subsequent D3 query.

#### Session Configuration

| Property | Value |
|---|---|
| Timeout | 5 minutes (configurable) |
| MFA | None (initial prototype) |

### 2.2 Session Validation

- **Route:** `GET /api/auth/session`
- **Priority:** P0 - Critical
- **Note:** Returns current session status. Server validates that session has not timed out (5-minute inactivity).

---

## 3. DPS/DMV Searches

All DPS searches submit to the legacy `CustomSummary.aspx` handler and communicate via D3 socket.

### 3.1 DPS Name Search - Personal

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/search/dps/name/personal`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `LastName` | string | **Yes** | - | Last name to search |
| `FirstName` | string | No | - | First name |
| `MiddleName` | string | No | - | Middle name |
| `Year` | string | No | - | Single year (1985), full DOB (01-12-1985), or year range (1960-1970) |
| `ZipCity` | string | No | - | Zip code or city name |
| `Alias` | string | No | `OFF` | `OFF` or `ON` - enables derivative matching on **first name only** |
| `QueryDatabase` | string | No | `ALL` | `ALL`, `DL`, or `TT` |
| `RecordsToSearch` | string | No | `All` | `All` or `Current` |

**Hidden/Fixed Parameters:**

| Parameter | Value | Description |
|---|---|---|
| `NamePartial` | `ON` | Always sent, hidden from user |
| `RtnCount` | `0` | Fixed value |

#### Legacy D3 Query String

```
Search_Type=web.find.allname.tdc.blue&Database=DLN&LastName={LastName}&FirstName={FirstName}&MiddleName={MiddleName}&Year={Year}&ZipCity={ZipCity}&Alias={Alias}&QueryDatabase={QueryDatabase}&RecordsToSearch={RecordsToSearch}&NamePartial=ON&RtnCount=0&CName={CName}&Audit={Audit}
```

#### Legacy Response Format

Newline-delimited rows, pipe-delimited fields (9 per row). First row is header (skipped). Last row may be empty. `TIMEOUT` string indicates incomplete results. `(TTAG)` marker in FIELD4 is stripped.

#### Field Mapping (D3 Position to JSON)

| D3 Position | D3 Column Header | JSON Field | Description |
|---|---|---|---|
| FIELD1 | Seq | `seq` | Sequence number |
| FIELD2 | Name | `name`, `isCurrent` | Full name. Bold `<b>` tags indicate current match → set `isCurrent: true` and strip HTML. |
| FIELD3 | UDate | `updateDate` | Last update date (MM-YYYY) |
| FIELD4 | DOB/Tag | `dobTag` | Date of birth or tag number. Strip `(TTAG)` marker. |
| FIELD5 | City | `city` | City |
| FIELD6 | Zip | `zip` | Zip code |
| FIELD7 | Type | `type` | Record type (DL, TAG, etc.) |
| FIELD8 | Selections | `detailId`, `detailType` | Parsed from `<SELECT>` HTML. Extract `DBViewItem`/`DLID`/`Vin`/`TXN` and route type. |
| FIELD9 | - | `additional` | Additional data |

#### Proposed JSON Response

```json
{
  "success": true,
  "timeout": false,
  "resultCount": 2,
  "data": [
    {
      "seq": "1",
      "name": "SMITH, JOHN A",
      "isCurrent": true,
      "updateDate": "03-2026",
      "dobTag": "DMFR64",
      "city": "DAWN",
      "zip": "79025",
      "type": "TAG",
      "detailId": "DMFR64",
      "detailType": "title",
      "additional": ""
    },
    {
      "seq": "2",
      "name": "SMITH, JOHN A",
      "isCurrent": false,
      "updateDate": "10-2023",
      "dobTag": "10-05-1968",
      "city": "WEATHERFORD",
      "zip": "76087",
      "type": "DL",
      "detailId": "12345678",
      "detailType": "driver",
      "additional": ""
    }
  ]
}
```

---

### 3.2 DPS Name Search - Commercial

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/search/dps/name/commercial`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `Company` | string | **Yes** | - | Company name to search |
| `ZipCity` | string | No | - | Zip code or city name |
| `RecordsToSearch` | string | No | `All` | `All` or `Current` |

**Hidden/Fixed Parameters:**

| Parameter | Value |
|---|---|
| `NamePartial` | `ON` |
| `RtnCount` | `0` |

#### Legacy D3 Query String

```
Search_Type=web.find.allname.tdc.blue&Database=DLN&Company={Company}&ZipCity={ZipCity}&RecordsToSearch={RecordsToSearch}&NamePartial=ON&RtnCount=0&CName={CName}&Audit={Audit}
```

#### Legacy Response Format

Same as DPS Name Search - Personal (9-field pipe-delimited rows).

#### Field Mapping

Same as Section 3.1.

---

### 3.3 DPS Address Search - Standard

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/search/dps/address/standard`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `ZipCity` | string | **Yes** | - | Zip code or city name |
| `StreetNumber` | string | No | - | Street number (Block) |
| `StreetName` | string | **Yes** | - | Street name |
| `Apt` | string | No | - | Apartment number |
| `QueryDatabase` | string | No | `ALL` | `ALL`, `DL`, or `TT` |
| `RecordsToSearch` | string | No | `All` | `All` or `Current` |

#### Legacy D3 Query String

```
Search_Type=web.find.alladdr.tdc.blue&Database=DLA&ZipCity={ZipCity}&StreetNumber={StreetNumber}&StreetName={StreetName}&Apt={Apt}&QueryDatabase={QueryDatabase}&RecordsToSearch={RecordsToSearch}&CName={CName}&Audit={Audit}
```

#### Field Mapping (D3 Position to JSON)

| D3 Position | D3 Column Header | JSON Field | Note |
|---|---|---|---|
| FIELD1 | Seq | `seq` | |
| FIELD2 | Address | `address`, `ownerName` | **Contains address + name in parentheses on second line. Split into two fields.** |
| FIELD3 | UDate | `updateDate` | |
| FIELD4 | DOB/Tag | `dobTag` | |
| FIELD5 | City | `city` | |
| FIELD6 | Zip | `zip` | |
| FIELD7 | Type | `type` | |
| FIELD8 | Selections | `detailId`, `detailType` | Parsed from HTML dropdown |
| FIELD9 | - | `additional` | |

**Address FIELD2 parsing example:**
- D3 returns: `123 MAIN ST<br>(SMITH, JOHN)`
- JSON: `"address": "123 MAIN ST", "ownerName": "SMITH, JOHN"`

---

### 3.4 DPS Address Search - PO Box

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/search/dps/address/pobox`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `ZipCity` | string | **Yes** | - | Zip code or city name |
| `Box` | string | **Yes** | - | PO Box number |
| `QueryDatabase` | string | No | `ALL` | `ALL`, `DL`, or `TT` |
| `RecordsToSearch` | string | No | `All` | `All` or `Current` |

#### Legacy D3 Query String

```
Search_Type=web.find.alladdr.tdc.blue&Database=DLA&ZipCity={ZipCity}&Box={Box}&QueryDatabase={QueryDatabase}&RecordsToSearch={RecordsToSearch}&CName={CName}&Audit={Audit}
```

#### Field Mapping

Same as Section 3.3.

---

### 3.5 DPS Address Search - Rural Route

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/search/dps/address/rural`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `ZipCity` | string | **Yes** | - | Zip code or city name |
| `Route` | string | **Yes** | - | Rural route number |
| `Box` | string | No | - | Box number |
| `QueryDatabase` | string | No | `ALL` | `ALL`, `DL`, or `TT` |
| `RecordsToSearch` | string | No | `All` | `All` or `Current` |

#### Legacy D3 Query String

```
Search_Type=web.find.alladdr.tdc.blue&Database=DLA&ZipCity={ZipCity}&Route={Route}&Box={Box}&QueryDatabase={QueryDatabase}&RecordsToSearch={RecordsToSearch}&CName={CName}&Audit={Audit}
```

#### Field Mapping

Same as Section 3.3.

---

### 3.6 DPS Plate Search

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/search/dps/plate`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `Plate` | string | **Yes** | - | License plate number |
| `Year` | string | No | - | Year (dropdown value) |
| `ZipCity` | string | No | - | Zip code or city name |
| `Color` | string | No | - | Pipe-delimited color codes (e.g., `BLU\|RED\|`) |
| `RecordsToSearch` | string | No | `All` | `All` or `Current` |

**Valid Color Codes (30):**

`AME`, `BLU`, `DBL`, `LBL`, `BGE`, `BLK`, `BRO`, `BRZ`, `CAM`, `COM`, `CPR`, `CRM`, `GLD`, `GRN`, `DGR`, `LGR`, `GRY`, `LAV`, `MAR`, `MUL`, `MVE`, `ONG`, `PLE`, `PNK`, `RED`, `SIL`, `TAN`, `TEA`, `TPE`, `TRQ`, `WHI`, `YEL`

#### Legacy D3 Query String

```
Search_Type=web.find.tag.tdc.blue&Database=DLP&Plate={Plate}&Year={Year}&ZipCity={ZipCity}&Color={Color}&RecordsToSearch={RecordsToSearch}&CName={CName}&Audit={Audit}
```

#### Field Mapping (D3 Position to JSON)

| D3 Position | D3 Column Header | JSON Field | Note |
|---|---|---|---|
| FIELD1 | Seq | `seq` | |
| FIELD2 | Name | `name` | |
| FIELD3 | UDate | `updateDate` | highCell=3 |
| FIELD4 | DOB/Tag | `dobTag` | |
| FIELD5 | City | `city` | |
| FIELD6 | Zip | `zip` | |
| FIELD7 | Type | `type` | |
| FIELD8 | Selections | `selections` | |
| FIELD9 | - | `additional` | |

---

### 3.7 DPS VIN Search

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/search/dps/vin`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `VIN` | string | **Yes** | - | Vehicle Identification Number |
| `Year` | string | No | - | Year (dropdown value) |
| `ZipCity` | string | No | - | Zip code or city name |
| `RecordsToSearch` | string | No | `All` | `All` or `Current` |

#### Legacy D3 Query String

```
Search_Type=web.find.allid.tdc.blue&Database=DLV&VIN={VIN}&Year={Year}&ZipCity={ZipCity}&RecordsToSearch={RecordsToSearch}&CName={CName}&Audit={Audit}
```

#### Field Mapping (D3 Position to JSON)

| D3 Position | D3 Column Header | JSON Field |
|---|---|---|
| FIELD1 | Seq | `seq` |
| FIELD2 | Name | `name` |
| FIELD3 | UDate | `updateDate` |
| FIELD4 | DOB/Tag | `dobTag` |
| FIELD5 | Vin | `vin` |
| FIELD6 | Zip | `zip` |
| FIELD7 | Type | `type` |
| FIELD8 | Selections | `selections` |
| FIELD9 | - | `additional` |

---

### 3.8 DPS Driver License Search

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/search/dps/license`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `DLID` | string | **Yes** | - | Driver license ID (leading zeros stripped) |
| `ZipCity` | string | No | - | Zip code or city name |
| `ZipPartial` | string | No | `OFF` | `OFF` or `ON` - partial zip matching |
| `RecordsToSearch` | string | No | `All` | `All` or `Current` |

**Processing Note:** Leading zeros are stripped from DLID before sending to D3.

#### Legacy D3 Query String

```
Search_Type=web.find.allid.tdc.blue&Database=DLL&DLID={DLID}&ZipCity={ZipCity}&ZipPartial={ZipPartial}&RecordsToSearch={RecordsToSearch}&CName={CName}&Audit={Audit}
```

#### Field Mapping (D3 Position to JSON)

| D3 Position | D3 Column Header | JSON Field |
|---|---|---|
| FIELD1 | Seq | `seq` |
| FIELD2 | Name | `name` |
| FIELD3 | UDate | `updateDate` |
| FIELD4 | DOB/Tag | `dobTag` |
| FIELD5 | License | `license` |
| FIELD6 | Zip | `zip` |
| FIELD7 | Type | `type` |
| FIELD8 | Selections | `selections` |
| FIELD9 | - | `additional` |

Note: highCell=4 for License search.

---

### 3.9 HDR Direct - Address

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/hdr-direct/address/standard`

Same parameters as Section 3.3 (DPS Address Search - Standard) with the addition of:

| Parameter | Value | Description |
|---|---|---|
| `DoHDR` | `0` | Fixed. Indicates HDR Direct mode |

#### Legacy D3 Query String

```
Search_Type=web.find.alladdr.tdc.blue&Database=DLA&DoHDR=0&ZipCity={ZipCity}&StreetNumber={StreetNumber}&StreetName={StreetName}&Apt={Apt}&QueryDatabase={QueryDatabase}&RecordsToSearch={RecordsToSearch}&CName={CName}&Audit={Audit}
```

---

### 3.10 HDR Direct - PO Box

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/hdr-direct/address/pobox`

Same parameters as Section 3.4 (DPS Address Search - PO Box) with `DoHDR=0`.

---

### 3.11 HDR Direct - Rural Route

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/hdr-direct/address/rural`

Same parameters as Section 3.5 (DPS Address Search - Rural Route) with `DoHDR=0`.

---

### 3.12 HDR Direct - Driver

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/hdr-direct/driver`

Same parameters as Section 3.8 (DPS Driver License Search) with `DoHDR=0`.

#### Legacy D3 Query String

```
Search_Type=web.find.allid.tdc.blue&Database=DLL&DoHDR=0&DLID={DLID}&ZipCity={ZipCity}&ZipPartial={ZipPartial}&RecordsToSearch={RecordsToSearch}&CName={CName}&Audit={Audit}
```

---

## 4. Criminal Searches

### 4.1 Criminal Name Search

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/search/criminal/name`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `LastName` | string | **Yes** | - | Last name |
| `FirstName` | string | No | - | First name |
| `MiddleName` | string | No | - | Middle name |
| `Year` | string | No | - | Full DOB (MM-DD-YYYY) |
| `Alias` | string | No | `OFF` | `OFF` or `ON` - derivative matching on **first name only** |

**Hidden/Fixed Parameters:**

| Parameter | Value |
|---|---|
| `NamePartial` | `ON` (checked default) |
| `RtnCount` | `0` |

**Note:** No ZipCity, QueryDatabase, or RecordsToSearch parameters for Criminal Name Search.

#### Legacy D3 Query String

```
Search_Type=web.find.allname.tdc.blue&Database=CRN&LastName={LastName}&FirstName={FirstName}&MiddleName={MiddleName}&Year={Year}&Alias={Alias}&NamePartial=ON&RtnCount=0&CName={CName}&Audit={Audit}
```

#### Field Mapping (D3 Position to JSON)

| D3 Position | D3 Column Header | JSON Field |
|---|---|---|
| FIELD1 | Seq | `seq` |
| FIELD2 | Name | `name` |
| FIELD3 | UDate | `updateDate` |
| FIELD4 | DOB | `dob` |
| FIELD5 | StateID | `stateId` |
| FIELD6 | NType | `nameType` |
| FIELD7 | Type | `type` |
| FIELD8 | Selections | `selections` |
| FIELD9 | - | `additional` |

---

### 4.2 Criminal SID Search

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/search/criminal/sid`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `SID` | string | **Yes** | - | State ID number |

**Note:** ZipCity, ZipPartial, and RecordsToSearch are hidden/not displayed in the legacy form.

#### Legacy D3 Query String

```
Search_Type=web.find.allid.tdc.blue&Database=CRI&SID={SID}&CName={CName}&Audit={Audit}
```

#### Field Mapping

Same as Section 4.1.

---

## 5. Watercraft Searches

All watercraft searches submit to the legacy `CustomSummaryMG.aspx` handler and communicate via **WSDaveService web services** (not D3 directly).

### 5.1 Watercraft Name Search - Personal

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/watercraft/name/personal`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `LastName` | string | **Yes** | - | Last name |
| `FirstName` | string | No | - | First name |
| `MiddleName` | string | No | - | Middle name |
| `ZipCity` | string | No | - | Zip code or city name |

**Legacy Routing:** SearchDB=WT, SearchTP=Name

#### Legacy Web Service Call

```
ws.BoatNameSearch(LastName, FirstName, MiddleName, Zip, City, "yes")
```

**Transaction Trace:** TCODE=7213, DB=WTN

#### Response Format

Returns `BoaterSummaryItem[]` array from the web service.

#### Field Mapping (BoaterSummaryItem to JSON)

| Service Field | JSON Field | Description |
|---|---|---|
| Seq | `seq` | Sequence number |
| Name | `name` | Full name |
| UpdDate | `updateDate` | Update date |
| DOBTag | `dobTag` | DOB or tag info |
| City | `city` | City |
| Zip | `zip` | Zip code |
| Type | `type` | Record type |
| DropDownItem | `selections` | Selection identifiers |
| Address | `address` | Address |

---

### 5.2 Watercraft Name Search - Commercial

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/watercraft/name/commercial`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `Company` | string | **Yes** | - | Company/business name |
| `ZipCity` | string | No | - | Zip code or city name |

**Legacy Routing:** SearchDB=WT, SearchTP=CompanyName

#### Legacy Web Service Call

```
ws.BoatBizNameSearch(Company, Zip, City, "yes")
```

**Transaction Trace:** TCODE=7213, DB=WTN

#### Field Mapping

Same as Section 5.1.

---

### 5.3 Watercraft Address Search - Standard

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/watercraft/address/standard`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `ZipCity` | string | **Yes** | - | Zip code or city name |
| `StreetNumber` | string | No | - | Street number |
| `StreetName` | string | **Yes** | - | Street name |
| `Apt` | string | No | - | Apartment number |

**Legacy Routing:** SearchDB=WT, SearchTP=Address

#### Legacy Service Call (Two-Step)

**Step 1:** D3 index lookup:
```
Search_Type=GET.INDEXADDR&Address={formatted_address}&ZipCode={zip}
```

**Step 2:** Web service call with result:
```
ws.BoatAddrSearch(IndexAddr)
```

**Transaction Trace:** TCODE=7214, DB=WTA

#### Field Mapping

Same as Section 5.1.

---

### 5.4 Watercraft Address Search - PO Box

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/watercraft/address/pobox`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `ZipCity` | string | **Yes** | - | Zip code or city name |
| `Box` | string | **Yes** | - | PO Box number |

**Legacy Routing:** SearchDB=WT, SearchTP=Address, AddrType=POBox

#### Legacy Service Call (Two-Step)

Same two-step process as Section 5.3 with PO Box address formatting.

**Transaction Trace:** TCODE=7214, DB=WTA

---

### 5.5 Watercraft Address Search - Rural Route

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/watercraft/address/rural`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `ZipCity` | string | **Yes** | - | Zip code or city name |
| `Route` | string | **Yes** | - | Rural route number |
| `Box` | string | No | - | Box number |

**Legacy Routing:** SearchDB=WT, SearchTP=Address, AddrType=RuralRoute

#### Legacy Service Call (Two-Step)

Same two-step process as Section 5.3 with Rural Route address formatting.

**Transaction Trace:** TCODE=7214, DB=WTA

---

### 5.6 Watercraft HIN Search

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/watercraft/hin`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `HIN` | string | **Yes** | - | Hull Identification Number |

**Legacy Routing:** SearchDB=WT, SearchTP=HIN

#### Legacy Web Service Call

```
ws.BoatHINSearch(HIN)
```

**Transaction Trace:** TCODE=7215, DB=WTH

#### Field Mapping Note

For HIN search, the `city` column header changes to "HIN" in legacy display.

---

### 5.7 Watercraft TXN Search

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/watercraft/txn`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `TXN` | string | **Yes** | - | TX Number ("TX" prefix stripped before sending) |

**Processing Note:** If TXN begins with "TX", the prefix is stripped before the web service call.

**Legacy Routing:** SearchDB=WT, SearchTP=TXN

#### Legacy Web Service Call

```
ws.BoatTXNSearch(TXN)
```

**Transaction Trace:** TCODE=7216, DB=WTT

#### Field Mapping Note

For TXN search, the `dobTag` column header changes to "TXN" in legacy display.

---

### 5.8 Watercraft Motor Search

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/search/watercraft/motor`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `MotorSerial` | string | **Yes** | - | Motor serial number (uppercased before sending) |

**Processing Note:** MotorSerial is uppercased before the web service call.

**Legacy Routing:** SearchDB=WT, SearchTP=Motor

#### Legacy Web Service Call

```
ws.BoatMotorSearch(MotorSerial)
```

**Transaction Trace:** TCODE=7217, DB=WTM

#### Field Mapping Note

For Motor search, the `dobTag` column header changes to "Motor" in legacy display.

---

## 6. Detail Endpoints

### 6.1 Driver Detail

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/detail/driver`

**Data Source:** D3 Socket (char(254) field separator, char(253) key-value separator)

#### Field Mapping (D3 Key to JSON)

| D3 Key | JSON Field | Description |
|---|---|---|
| License | `license` | Driver license number |
| DLClass | `dlClass` | License class |
| DLLastUpdate | `lastUpdate` | Last update date |
| DLName | `name` | Full name |
| DLAge | `age` | Age |
| DLDOB | `dob` | Date of birth |
| DLAddress | `address` | Street address |
| DLSex | `sex` | Sex |
| DLRace | `race` | Race |
| DLHeight | `height` | Height (formatted with ' and ") |
| DLCSZ | `cityStateZip` | City, State, Zip |
| DLEyeColor | `eyeColor` | Eye color |
| DLHairColor | `hairColor` | Hair color |
| DLType | `dlType` | License type |
| DLRestrictions | `restrictions` | License restrictions |
| DLWeight | `weight` | Weight (formatted with "lbs") |
| DLRemarks | `remarks` | Remarks |
| DLEndorsements | `endorsements` | Endorsements |
| DLOrigination | `origination` | Origination info |

#### Nested Data Structures

**DLUpdHistList** (Update History):
- D3 format: Pipe-separated rows, exclamation-separated `date!item`
- JSON:
```json
"updateHistory": [
  { "date": "01/15/2024", "item": "ADDRESS CHANGE" }
]
```

**DLNameList** (Name History):
- D3 format: Pipe-separated rows, colon-separated `NameDate:NameSrc:NameItem`
- JSON:
```json
"nameHistory": [
  { "date": "01/15/2024", "source": "DL", "name": "SMITH, JOHN A" }
]
```

**DLAddrList** (Address History):
- D3 format: Exclamation-separated rows, pipe-separated columns: `date|addr|city|zip|src|hdr$`
- JSON:
```json
"addressHistory": [
  {
    "date": "01/15/2024",
    "address": "123 MAIN ST",
    "city": "AUSTIN",
    "zip": "78701",
    "source": "DL",
    "hdr": "Y"
  }
]
```

**TabData** (Cross-link Data):
- Contains data for navigating to other detail tabs (Title, etc.)
- Parsed and included as `tabData` object

#### Proposed JSON Response

```json
{
  "success": true,
  "data": {
    "license": "12345678",
    "dlClass": "C",
    "lastUpdate": "01/15/2024",
    "name": "SMITH, JOHN A",
    "age": "44",
    "dob": "05/20/1980",
    "address": "123 MAIN ST",
    "sex": "M",
    "race": "W",
    "height": "5'10\"",
    "cityStateZip": "AUSTIN TX 78701",
    "eyeColor": "BRO",
    "hairColor": "BLK",
    "dlType": "OPERATOR",
    "restrictions": "NONE",
    "weight": "180 lbs",
    "remarks": "",
    "endorsements": "",
    "origination": "01/01/2000",
    "updateHistory": [],
    "nameHistory": [],
    "addressHistory": [],
    "tabData": {}
  }
}
```

---

### 6.2 Title Detail

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/detail/title`

**Data Source:** D3 Socket (char(254) field separator, char(253) key-value separator)

#### Field Mapping (D3 Key to JSON)

| D3 Key | JSON Field | Description |
|---|---|---|
| TitlePlate | `plate` | License plate |
| TitlePlateIssue | `plateIssue` | Plate issue date |
| TitleVIN | `vin` | Vehicle Identification Number |
| TitleExpiration | `expiration` | Registration expiration |
| TitleTerritory | `territory` | Territory |
| TitleDate | `titleDate` | Title date |
| TitleNumber | `titleNumber` | Title number |
| TitleIR | `ir` | IR code |
| TitlePN | `pn` | PN code |
| TitleCounty | `county` | County |
| TitleSalesPrice | `salesPrice` | Sales price |
| TitleYearMakeModel | `yearMakeModel` | Year/Make/Model |
| AntiTheft | `antiTheft` | Anti-theft device |
| TitleOdometer | `odometer` | Odometer reading |
| ABS | `abs` | ABS indicator |
| BaseDetail | `baseDetail` | Base detail |
| FBumper | `frontBumper` | Front bumper |
| DriverAB | `driverAirbag` | Driver airbag |
| RBumper | `rearBumper` | Rear bumper |
| PassengerAB | `passengerAirbag` | Passenger airbag |
| TitleOwnerName | `ownerName` | Owner name |
| TitleLienholderName | `lienholderName` | Lienholder name |
| TitleAddress | `address` | Address |
| TitlePreviousOwner2 | `previousOwner2` | Previous owner 2 |
| TitlePreviousOwner3 | `previousOwner3` | Previous owner 3 |
| TitleColor | `color` | Vehicle color |
| TitleRenewal | `renewal` | Renewal info |
| LoadDate | `loadDate` | Data load date |
| TitleCSZ | `cityStateZip` | City, State, Zip |

#### Nested Data Structures

**TTNameList** (Owner Name List):
- D3 format: Pipe-separated owner names
- JSON:
```json
"ownerNames": ["SMITH, JOHN A", "SMITH, JANE B"]
```

**TTAddrList** (Address History):
- D3 format: Exclamation-separated rows, pipe-separated: `date|name|addr|city|state|zip`
- JSON:
```json
"addressHistory": [
  {
    "date": "01/15/2024",
    "name": "SMITH, JOHN A",
    "address": "123 MAIN ST",
    "city": "AUSTIN",
    "state": "TX",
    "zip": "78701"
  }
]
```

**TitleLienInfo** (Lienholder Info):
- D3 format: Pipe-separated: `date|name|addr|city,state|zip`
- JSON:
```json
"lienInfo": {
  "date": "01/15/2024",
  "name": "FIRST NATIONAL BANK",
  "address": "456 BANK ST",
  "cityState": "DALLAS, TX",
  "zip": "75201"
}
```

**PlateList**:
- D3 format: Pipe-separated plate numbers
- JSON:
```json
"plateList": ["ABC1234", "XYZ5678"]
```

**VinData** (VIN Descriptive Items):
- D3 format: Pipe-separated descriptive items
- JSON:
```json
"vinData": ["4DR", "SEDAN", "2.0L", "GAS"]
```

**Note:** `(TTAG)` marker is stripped from display values.

---

### 6.3 Criminal Detail — Profile & Arrest List

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/detail/criminal/profile`

**Data Source:** WSDaveService web service (NOT D3 directly) + D3 for transaction trace

**Transaction Trace:** TCODE=7083, DB=CR (logged via D3 on first load only)

**UI Structure:** Criminal Detail is a three-tier interactive page:
- **Tier 1 — Profile Header:** Person info, photo, alias names
- **Tier 2 — Arrest Summary:** List of arrests (TRNs). User selects an arrest sequence → drives Tier 3.
- **Tier 3 — Arrest Detail Tabs:** Offense, Prosecution, Court, Custody (loaded per selected arrest)

#### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `PersonId` | string | **Yes** | Criminal record person ID (pipe chars stripped) |

#### Web Service Call

```
wss.MGCrimHeader(PersonId)
```

Returns JSON deserialized to `CrimHeader`.

#### CrimHeader Field Mapping

| Service Field | JSON Field | Description |
|---|---|---|
| Id | `id` | Person ID |
| Name | `name` | Full name (Names[] with Type != "S" is primary) |
| DOB | `dob` | Date of birth (reformatted from DDMMYYYY to MM/DD/YYYY) |
| DpsNumber | `dpsNumber` | DPS number |
| Sex | `sex` | Sex (strip prefix before `)`, e.g. "M) MALE" → "MALE") |
| Race | `race` | Race (strip prefix before `)`) |
| Ethnicity | `ethnicity` | Ethnicity |
| Height | `height` | Height (insert `'` after first char, append `"`, e.g. "510" → "5'10\"") |
| Weight | `weight` | Weight (append "lbs") |
| Hair | `hair` | Hair color (strip prefix before `)`) |
| Eye | `eye` | Eye color (strip prefix before `)`) |
| PhotoFileName | `photoFileName` | Photo file name |

**Photo URL Construction:**
- Path: `CrimImages/{c1}/{c2}/{c3}/{c4}/{c5}/{c6}/{PhotoFileName}.jpg`
- Uses first 6 characters of filename as nested directory structure
- If photo doesn't exist, frontend shows "No Image Available" placeholder

**Age Calculation:** Computed from DOB and current date (not stored in D3).

#### Nested Arrays in Profile Response

**Names[] (Alias Names):**

| Service Field | JSON Field | Description |
|---|---|---|
| Id | `id` | Name record ID |
| FullName | `fullName` | Full name |
| FirstName | `firstName` | First name |
| LastName | `lastName` | Last name |
| Type | `type` | "S" = alias/secondary, other = primary name |

**TRNs[] (Arrest Records — drives Tier 2 selector):**

| Service Field | JSON Field | Description |
|---|---|---|
| Agency | `agency` | Arresting agency |
| Id | `id` | TRN ID (used to fetch arrest detail) |
| DateOfArrest | `dateOfArrest` | Arrest date (age at arrest computed client-side) |
| ArrestSeq | `arrestSeq` | Arrest sequence number |
| TrackingNumber | `trackingNumber` | Tracking number |

**CustodyRecords[] (from Header, NOT from arrest detail):**

| Service Field | JSON Field | Description |
|---|---|---|
| Id | `id` | Record ID |
| DateOfOffense | `dateOfOffense` | Date of offense |
| TrackingNumber | `trackingNumber` | Tracking number |
| Agency | `agency` | Agency |
| PidNumber | `pidNumber` | PID number |
| SentenceExpiresOn | `sentenceExpiresOn` | Sentence expiration (nullable) |
| CountyOfCommitment | `countyOfCommitment` | County |
| CustodyStartDate | `custodyStartDate` | Custody start |
| SupervisionNumber | `supervisionNumber` | Supervision number |
| SupervisionLiteral | `supervisionLiteral` | Supervision description |
| ReceivingAgency | `receivingAgency` | Receiving agency |
| ParoledUntil | `paroledUntil` | Parole end date (nullable) |

**Note:** Custody has its own sequence selector if multiple records exist.

#### Proposed JSON Response (Profile)

```json
{
  "success": true,
  "data": {
    "id": "12345",
    "name": "SMITH, JOHN A",
    "dob": "05/20/1980",
    "age": 45,
    "dpsNumber": "TX12345678",
    "sex": "MALE",
    "race": "WHITE",
    "ethnicity": "NON-HISPANIC",
    "height": "5'10\"",
    "weight": "180 lbs",
    "hair": "BLACK",
    "eye": "BROWN",
    "photoUrl": "CrimImages/1/2/3/4/5/6/123456.jpg",
    "aliasNames": ["SMITH, J D", "SMITHE, JOHN"],
    "trns": [
      {
        "id": "7890",
        "agency": "HARRIS COUNTY SO",
        "dateOfArrest": "03/15/2020",
        "ageAtArrest": 39,
        "arrestSeq": "1",
        "trackingNumber": "TRK001"
      }
    ],
    "custodyRecords": [
      {
        "id": "456",
        "dateOfOffense": "03/15/2020",
        "agency": "TDCJ",
        "countyOfCommitment": "HARRIS",
        "custodyStartDate": "06/01/2020",
        "sentenceExpiresOn": "06/01/2025",
        "paroledUntil": null
      }
    ]
  }
}
```

---

### 6.4 Criminal Detail — Arrest Detail (per TRN)

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/detail/criminal/arrest`

**Data Source:** WSDaveService web service

#### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `PersonId` | string | **Yes** | Criminal record person ID |
| `TRNId` | string | **Yes** | Arrest/TRN ID from profile response |

#### Web Service Call

```
wss.MGCrimHeaderOne(PersonId, TRNId)
```

Returns JSON deserialized to `CrimDetail`. Contains four sections, each with its own sub-sequence selector.

#### Offense Fields

| Service Field | JSON Field | Description |
|---|---|---|
| Id | `id` | Offense ID |
| TRSId | `trsId` | TRS ID |
| Agency | `agency` | Agency |
| DateOfOffense | `dateOfOffense` | Offense date |
| AON | `aon` | Arrest offense name (may contain pipe: `AON\|Citation` — split into `aon` + `citation`) |
| AOL | `aol` | Arrest offense level |
| LevelDegree | `levelDegree` | Level/degree |
| GOC | `goc` | General offense code |
| ADN | `adn` | Additional name |
| ADD | `add` | Additional description |
| ADADt | `adaDt` | ADA date |
| REF | `ref` | Reference |
| IPN | `ipn` | IPN |
| ICA | `ica` | ICA |
| DMV | `dmv` | DMV reference |

**Note:** Criminal photo is displayed in the Offense tab when available.

#### Prosecution Fields (multiple per arrest, own sequence selector)

| Service Field | JSON Field | Description |
|---|---|---|
| Id | `id` | Prosecution ID |
| TRSId | `trsId` | TRS ID |
| Agency | `agency` | Agency |
| ACTDt | `actDate` | Action date |
| GOC | `goc` | General offense code |
| PON | `pon` | Prosecution offense name |
| POL | `pol` | Prosecution offense level |
| LDP | `ldp` | LDP |
| PAF | `paf` | PAF |
| DMV | `dmv` | DMV reference |

#### Court Fields (multiple per arrest, own sequence selector)

| Service Field | JSON Field | Description |
|---|---|---|
| Id | `id` | Court record ID |
| TRSId | `trsId` | TRS ID |
| Agency | `agency` | Agency |
| CDN | `cdn` | Court docket number |
| CAU | `cau` | Cause |
| FPO | `fpo` | FPO |
| DOSDt | `dosDate` | Date of sentence |
| GOC | `goc` | General offense code |
| CON | `con` | Court offense name (may contain pipe: `CON\|COD` — split into `con` + `cod`) |
| COL | `col` | Court offense level |
| LDC | `ldc` | LDC |
| FCD | `fcd` | FCD |
| DCADt | `dcaDt` | DCA date |
| CMT | `cmt` | Comments |
| CPN | `cpn` | CPN |
| CPR | `cpr` | CPR |
| CSS | `css` | CSS |
| CFN | `cfn` | CFN |
| CSF | `csf` | CSF |
| CPL | `cpl` | CPL |
| CST | `cst` | CST |
| CDDDt | `cddDt` | CDD date |
| DDA | `dda` | DDA |
| CSC | `csc` | CSC |
| ARC | `arc` | ARC |
| MCC | `mcc` | MCC |
| DMV | `dmv` | DMV reference |

#### Proposed JSON Response (Arrest Detail)

```json
{
  "success": true,
  "data": {
    "id": "7890",
    "trnId": "7890",
    "offenses": [
      {
        "id": "100",
        "agency": "HARRIS COUNTY SO",
        "dateOfOffense": "03/15/2020",
        "aon": "THEFT",
        "citation": "TC-2020-1234",
        "aol": "FELONY",
        "levelDegree": "STATE JAIL FELONY",
        "goc": "2399"
      }
    ],
    "prosecutions": [
      {
        "id": "200",
        "agency": "HARRIS COUNTY DA",
        "goc": "2399",
        "pon": "THEFT",
        "pol": "SJF"
      }
    ],
    "courtStats": [
      {
        "id": "300",
        "agency": "338TH DIST COURT",
        "cdn": "1234567",
        "dosDate": "09/15/2020",
        "con": "THEFT",
        "cod": "CONVICTED",
        "col": "SJF"
      }
    ]
  }
}
```

---

### 6.5 Criminal Photo

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/detail/criminal/photo/:photoFileName`

**Data Source:** Local file system (hosted criminal images)

Serves the mugshot image for a criminal record. Photo path is constructed from the filename:

```
CrimImages/{c1}/{c2}/{c3}/{c4}/{c5}/{c6}/{photoFileName}.jpg
```

Where `c1` through `c6` are the first 6 characters of the filename used as nested directory names.

**Response:** Image file (JPEG) or 404 if not found. Frontend shows "No Image Available" placeholder on 404.

**Note:** Photos are displayed in the Offense tab of the Criminal Detail page.

---

### 6.6 Watercraft Detail

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/detail/watercraft`

**Data Source:** WSDaveService web service (NOT D3 directly)

**Transaction Trace:** TCODE=7218, DB=WTN

#### Web Service Call

```
WSDaveService.BoatRecord(TXN)
```

#### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `TXN` | string | **Yes** | TX Number |

#### Field Mapping (Boater Object to JSON)

| Service Field | JSON Field | Description |
|---|---|---|
| TX_Number | `txNumber` | TX registration number |
| Business_Name | `businessName` | Business name |
| Last_Name | `lastName` | Last name |
| First_Name | `firstName` | First name |
| MI | `middleInitial` | Middle initial |
| Address_Line_1 | `address` | Street address |
| City | `city` | City |
| State | `state` | State |
| Zip | `zip` | Zip code |
| Make | `make` | Vessel make |
| Model | `model` | Vessel model |
| Model_Year | `modelYear` | Model year |
| Year_Built | `yearBuilt` | Year built |
| Length_Ft | `lengthFt` | Length in feet |
| Length_In | `lengthIn` | Length in inches |
| HIN_MIN | `hinMin` | Hull Identification Number |
| Hull_Description | `hullDescription` | Hull description |
| Engine_Type | `engineType` | Engine type |
| Fuel_Description | `fuelDescription` | Fuel description |
| Vessel_Type | `vesselType` | Vessel type |
| Vessel_Use | `vesselUse` | Vessel use |
| State_Principal_Op | `statePrincipalOp` | State of principal operation |
| Propulsion | `propulsion` | Propulsion type |
| Motor_1_Horsepower | `motor1Horsepower` | Motor 1 horsepower |
| Motor_1_Serial_No | `motor1SerialNo` | Motor 1 serial number |
| Motor_2_Horsepower | `motor2Horsepower` | Motor 2 horsepower |
| Motor_2_Serial_No | `motor2SerialNo` | Motor 2 serial number |
| Original_Registration_Date | `originalRegistrationDate` | Original registration date |
| Title_Date | `titleDate` | Title date |
| Renewal_Date | `renewalDate` | Renewal date |
| County_Code | `countyCode` | County code |
| County_Name | `countyName` | County name |

#### Proposed JSON Response

```json
{
  "success": true,
  "data": {
    "txNumber": "1234567",
    "businessName": "",
    "lastName": "SMITH",
    "firstName": "JOHN",
    "middleInitial": "A",
    "address": "123 MAIN ST",
    "city": "AUSTIN",
    "state": "TX",
    "zip": "78701",
    "make": "BAYLINER",
    "model": "185",
    "modelYear": "2020",
    "yearBuilt": "2020",
    "lengthFt": "18",
    "lengthIn": "5",
    "hinMin": "USBYH123A020",
    "hullDescription": "FIBERGLASS",
    "engineType": "INBOARD/OUTBOARD",
    "fuelDescription": "GASOLINE",
    "vesselType": "OPEN",
    "vesselUse": "PLEASURE",
    "statePrincipalOp": "TX",
    "propulsion": "PROPELLER",
    "motor1Horsepower": "150",
    "motor1SerialNo": "1B234567",
    "motor2Horsepower": "",
    "motor2SerialNo": "",
    "originalRegistrationDate": "03/15/2020",
    "titleDate": "03/15/2020",
    "renewalDate": "03/15/2024",
    "countyCode": "227",
    "countyName": "TRAVIS"
  }
}
```

---

## 7. HDR Report

> **STATUS: NEW - must build**
> **Priority:** P0 - Critical

**Route:** `GET /api/report/hdr`

**Data Source:** D3 Socket (DPS data) + WSDaveService (Watercraft data appended)

**Note:** The HDR Report lists drivers, vehicles, AND watercraft found at an address. Each name in the report is a clickable link to the corresponding detail page. **Viewing a detail from the HDR Report is a billable transaction.**

### Response Format

D3 returns newline+pipe delimited data with **7 fields per row** (not 9 like summary). Two sections: Drivers and Vehicles.

**Section Identification:** Driver rows have `NAME *` marker in the name field.

#### Driver Row Field Mapping

| Position | JSON Field | Description |
|---|---|---|
| 1 | `seq` | Sequence number |
| 2 | `name` | Name (linked, contains `NAME *` marker) |
| 3 | `license` | Driver license number |
| 4 | `dob` | Date of birth |
| 5 | `age` | Age |
| 6 | `address` | Address |
| 7 | - | Additional/empty |

#### Vehicle Row Field Mapping

| Position | JSON Field | Description |
|---|---|---|
| 1 | `seq` | Sequence number |
| 2 | `name` | Name (linked) |
| 3 | `plate` | License plate |
| 4 | `year` | Vehicle year |
| 5 | `make` | Make |
| 6 | `model` | Model |
| 7 | `address` | Address |

#### Watercraft Append

Watercraft HDR data is appended via a separate web service call:
```
ws.BoatHDRSearch(IndexAddr)
```

#### Proposed JSON Response

```json
{
  "success": true,
  "data": {
    "drivers": [
      {
        "seq": "1",
        "name": "SMITH, JOHN A",
        "license": "12345678",
        "dob": "05/20/1980",
        "age": "44",
        "address": "123 MAIN ST AUSTIN TX 78701"
      }
    ],
    "vehicles": [
      {
        "seq": "1",
        "name": "SMITH, JOHN A",
        "plate": "ABC1234",
        "year": "2020",
        "make": "TOYOTA",
        "model": "CAMRY",
        "address": "123 MAIN ST AUSTIN TX 78701"
      }
    ],
    "watercraft": []
  }
}
```

---

## 8. Transaction Logging

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** Internal middleware (no public endpoint)

Every search and detail request must log a transaction trace for audit and billing purposes.

### Transaction Trace Codes

| TCODE | Operation | Database |
|---|---|---|
| 7083 | Criminal Profile | CR |
| 7090 | Map Search | - |
| 7091 | Presumed Value | - |
| 7213 | Watercraft Name Search | WTN |
| 7214 | Watercraft Address Search | WTA |
| 7215 | Watercraft HIN Search | WTH |
| 7216 | Watercraft TXN Search | WTT |
| 7217 | Watercraft Motor Search | WTM |
| 7218 | Watercraft Detail | WTN |

**Important Rules:**
- DPS transaction codes are handled within the D3 protocol itself (server-side). The Node.js API must ensure watercraft and criminal TCODEs are explicitly logged.
- **Transaction traces only fire if results are found.** Empty searches are NOT billed.
- HDR Report detail link clicks are separately billable transactions.

---

## 9. External Services

### 9.1 Court Violations / Court Data

> **STATUS: NEW - must build**
> **Priority:** P2 - Medium

**Route:** `GET /api/detail/driver/violations`

**Data Source:** TXDPS_Violations_v1 SOAP web service

#### Web Service Call

```
TXDPS_Violations_v1(user, password, license, dob)
```

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `license` | string | **Yes** | Driver license number |
| `dob` | string | **Yes** | Date of birth |

Note: `user` and `password` are server-side credentials, not client-supplied.

#### Response Field Mapping

| Service Field | JSON Field | Description |
|---|---|---|
| CourtName | `courtName` | Court name |
| CourtAddress | `courtAddress` | Court address |
| CourtCSZ | `courtCityStateZip` | Court city/state/zip |
| CourtPhone | `courtPhone` | Court phone number |
| Docket | `docket` | Docket number |
| OffenseDate | `offenseDate` | Date of offense |
| OffenseDescription | `offenseDescription` | Offense description |
| Fine | `fine` | Fine amount |
| CourtCost | `courtCost` | Court cost |
| Other | `other` | Other charges |
| AmountDue | `amountDue` | Total amount due |
| Disposition | `disposition` | Disposition |
| DisposedDate | `disposedDate` | Disposition date |

### 9.2 MVR Eligibility Check

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `GET /api/mvr/eligibility`

**Data Source:** D3 Socket

**Billing Note:** MVR is the ONLY service requiring prepaid deposit balance. All other searches use deferred end-of-month (EOM) billing. HDR pays the state per MVR request, so customers must have sufficient funds on deposit before requesting.

#### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `DLNumber` | string | **Yes** | Driver license number |

#### Legacy D3 Query String

```
Search_Type=MVR.USER&DLNumber={DLNumber}&CName={CName}
```

#### Legacy D3 Response

Dollar-terminated, pipe-delimited: `{canRequest}|{existingMVR}$`

- `canRequest`: "0" = insufficient balance, "1" = can proceed
- `existingMVR`: "0" = no existing MVR on file, "1" = existing MVR available

#### Proposed JSON Response

```json
{
  "success": true,
  "data": {
    "canRequest": true,
    "existingMvrAvailable": true
  }
}
```

#### Frontend Logic

- If `canRequest` is false → show "Insufficient MVR Balance for request. Contact HDR Support."
- If `existingMvrAvailable` is false → hide "Use Existing MVR" checkbox
- If driver's DLRemarks contains "no violations" → show warning "No violation for 4 years. MVR may not be required."
- MVR link is hidden if DLType is "ID" (ID card) or DLRemarks contains "BEEN DELETED"

---

### 9.3 MVR Request

> **STATUS: NEW - must build**
> **Priority:** P1 - High

**Route:** `POST /api/mvr/request`

**Data Source:** MVRService web service (separate from WSDaveService)

#### Request Body

| Parameter | Type | Required | Description |
|---|---|---|---|
| `DLNumber` | string | **Yes** | Driver license number |
| `LastName` | string | **Yes** | Driver last name |
| `DOB` | string | **Yes** | Date of birth |
| `UseExistingMVR` | string | No | "ON" to use existing MVR if available |
| `XML_TYPE` | string | **Yes** | "MVR.DETAIL" |

**Server-side additions:** `IPAddr` (from request), `Request_Type=Live`, `CName`

#### Legacy Web Service Call

```
MVRService.GetMVRData(passString)
```

Returns XML with structure: `//SERVER/RESPONSE/SUMMARY`, `//SERVER/RESPONSE/VIOLATION[]`, `//SERVER/RESPONSE/MESSAGE[]`

#### Proposed JSON Response

```json
{
  "success": true,
  "data": {
    "summary": {
      "LICENSE_NUMBER": "12345678",
      "LAST_NAME": "SMITH",
      "FIRST_NAME": "JOHN",
      "DATE_OF_BIRTH": "05/20/1980",
      "LICENSE_CLASS": "C",
      "LICENSE_TYPE": "OPERATOR",
      "STATUS": "ELIGIBLE"
    },
    "violations": [
      {
        "EVENT_DESCRIPTION": "SPEEDING 10% ABOVE POSTED LIMIT",
        "CONVICTION_DATE": "03/15/2020",
        "COURT_NAME": "HARRIS COUNTY JP",
        "FINE_AMOUNT": "$200.00"
      }
    ],
    "messages": [
      {
        "MESSAGE_TEXT": "Record is current as of 03/2026"
      }
    ]
  }
}
```

**Note:** MVR report display uses `MVRREPORT_SCHEMA.XML` to define field layout. The schema defines three categories (Summary, Violations, Messages) with field-level rendering instructions. The Node.js API should return the raw data; the frontend handles layout.

---

### 9.5 Map Search

> **STATUS: NEW - must build**
> **Priority:** P3 - Low

**Transaction Trace:** TCODE=7090

Details to be determined from legacy implementation.

### 9.6 Presumed Value

> **STATUS: NEW - must build**
> **Priority:** P3 - Low

**Transaction Trace:** TCODE=7091

Details to be determined from legacy implementation.

---

## 10. Legacy Reference

### 10.1 D3 Socket Protocol Details

| Property | Value |
|---|---|
| **Connection** | TCP socket to hdrd301:9001 |
| **Request** | `GET /?{queryString}` |
| **Encoding** | Windows-1252 |
| **Prefix** | Strip `xmlserver 3` from response start |
| **Timeout** | 180 seconds |

### 10.2 Response Delimiters

| Delimiter | Character Code | Usage |
|---|---|---|
| Newline | `\n` | Row separator (summary responses) |
| Pipe | `\|` | Field separator (summary: 9 fields DPS/Criminal, 7 fields HDR) |
| char(254) | `\xFE` | Field separator (detail responses) |
| char(253) | `\xFD` | Key-value separator (detail responses) |
| Exclamation | `!` | Row separator (DLAddrList, TTAddrList, DLUpdHistList) |
| Colon | `:` | Field separator (DLNameList: NameDate:NameSrc:NameItem) |

### 10.3 Database Codes

| Code | Description | Search Type Value |
|---|---|---|
| DLN | DPS Name | web.find.allname.tdc.blue |
| DLA | DPS Address | web.find.alladdr.tdc.blue |
| DLP | DPS Plate | web.find.tag.tdc.blue |
| DLV | DPS VIN | web.find.allid.tdc.blue |
| DLL | DPS Driver License | web.find.allid.tdc.blue |
| CRN | Criminal Name | web.find.allname.tdc.blue |
| CRI | Criminal SID | web.find.allid.tdc.blue |
| WT | Watercraft (SearchDB) | N/A (web service) |
| WTN | Watercraft Name (trace) | N/A |
| WTA | Watercraft Address (trace) | N/A |
| WTH | Watercraft HIN (trace) | N/A |
| WTT | Watercraft TXN (trace) | N/A |
| WTM | Watercraft Motor (trace) | N/A |

### 10.4 Search_Type Values

| Value | Used By |
|---|---|
| `session_V2` | Authentication login |
| `web.find.allname.tdc.blue` | DPS Name (DLN), Criminal Name (CRN) |
| `web.find.alladdr.tdc.blue` | DPS Address (DLA), HDR Direct Address |
| `web.find.tag.tdc.blue` | DPS Plate (DLP) |
| `web.find.allid.tdc.blue` | DPS VIN (DLV), DPS License (DLL), Criminal SID (CRI) |
| `Web.Hdr.Blue` | HDR Report |
| `GET.INDEXADDR` | Watercraft Address index lookup (D3 step) |
| `web.logrequest` | Transaction trace logging (all TCODEs) |
| `WEBUSER.UPD` | User profile update (email/phone) |

### 10.5 Special Markers and Processing Rules

| Marker/Rule | Description |
|---|---|
| `TIMEOUT` | String in response indicates incomplete results |
| `(TTAG)` | Marker in FIELD4 that must be stripped from display |
| `NAME *` | Marker in HDR report name field indicating a driver row |
| `xmlserver 3` | Prefix in D3 response that must be stripped |
| Leading zeros | Stripped from DLID before sending to D3 |
| `TX` prefix | Stripped from TXN before watercraft web service call |
| MotorSerial | Uppercased before watercraft web service call |
| Color codes | Pipe-delimited with trailing pipe (e.g., `BLU\|RED\|`) |

---

## 11. Endpoint Summary

| # | Endpoint | Method | Route | Status | Priority | Data Source |
|---|---|---|---|---|---|---|
| 1 | Auth Login | POST | /api/auth/login | NEW | P0 | D3 Socket (session_V2) |
| 2 | Auth Session | GET | /api/auth/session | NEW | P0 | Server-side session |
| 3 | DPS Name Personal | GET | /api/search/dps/name/personal | NEW | P0 | D3 Socket |
| 4 | DPS Name Commercial | GET | /api/search/dps/name/commercial | NEW | P0 | D3 Socket |
| 5 | DPS Address Standard | GET | /api/search/dps/address/standard | NEW | P0 | D3 Socket |
| 6 | DPS Address PO Box | GET | /api/search/dps/address/pobox | NEW | P0 | D3 Socket |
| 7 | DPS Address Rural | GET | /api/search/dps/address/rural | NEW | P0 | D3 Socket |
| 8 | DPS Plate | GET | /api/search/dps/plate | NEW | P0 | D3 Socket |
| 9 | DPS VIN | GET | /api/search/dps/vin | NEW | P0 | D3 Socket |
| 10 | DPS License | GET | /api/search/dps/license | NEW | P0 | D3 Socket |
| 11 | HDR Direct Address | GET | /api/search/hdr-direct/address/standard | NEW | P1 | D3 Socket |
| 12 | HDR Direct PO Box | GET | /api/search/hdr-direct/address/pobox | NEW | P1 | D3 Socket |
| 13 | HDR Direct Rural | GET | /api/search/hdr-direct/address/rural | NEW | P1 | D3 Socket |
| 14 | HDR Direct Driver | GET | /api/search/hdr-direct/driver | NEW | P1 | D3 Socket |
| 15 | Criminal Name | GET | /api/search/criminal/name | NEW | P0 | D3 Socket |
| 16 | Criminal SID | GET | /api/search/criminal/sid | NEW | P0 | D3 Socket |
| 17 | Watercraft Name Personal | GET | /api/search/watercraft/name/personal | NEW | P1 | WSDaveService |
| 18 | Watercraft Name Commercial | GET | /api/search/watercraft/name/commercial | NEW | P1 | WSDaveService |
| 19 | Watercraft Address Standard | GET | /api/search/watercraft/address/standard | NEW | P1 | D3 + WSDaveService |
| 20 | Watercraft Address PO Box | GET | /api/search/watercraft/address/pobox | NEW | P1 | D3 + WSDaveService |
| 21 | Watercraft Address Rural | GET | /api/search/watercraft/address/rural | NEW | P1 | D3 + WSDaveService |
| 22 | Watercraft HIN | GET | /api/search/watercraft/hin | NEW | P1 | WSDaveService |
| 23 | Watercraft TXN | GET | /api/search/watercraft/txn | NEW | P1 | WSDaveService |
| 24 | Watercraft Motor | GET | /api/search/watercraft/motor | NEW | P1 | WSDaveService |
| 25 | Driver Detail | GET | /api/detail/driver | NEW | P0 | D3 Socket |
| 26 | Title Detail | GET | /api/detail/title | NEW | P0 | D3 Socket |
| 27 | Criminal Profile | GET | /api/detail/criminal/profile | NEW | P0 | D3 (trace) + WSDaveService |
| 28 | Criminal Arrest Detail | GET | /api/detail/criminal/arrest | NEW | P0 | WSDaveService |
| 29 | Criminal Photo | GET | /api/detail/criminal/photo/:file | NEW | P1 | Local file system |
| 30 | Watercraft Detail | GET | /api/detail/watercraft | NEW | P1 | WSDaveService |
| 31 | HDR Report | GET | /api/report/hdr | NEW | P0 | D3 + WSDaveService |
| 32 | Court Violations | GET | /api/detail/driver/violations | NEW | P2 | TXDPS_Violations_v1 |
| 33 | MVR Eligibility | GET | /api/mvr/eligibility | NEW | P1 | D3 Socket |
| 34 | MVR Request | POST | /api/mvr/request | NEW | P1 | MVRService |
| 35 | Map Search | - | TBD | NEW | P3 | TBD |
| 36 | Presumed Value | - | TBD | NEW | P3 | TBD |

---

### Billing Model

| Service Type | Billing | Mechanism |
|---|---|---|
| All searches (DPS, Criminal, Watercraft) | Deferred EOM | Transaction trace logs usage |
| Detail views | Deferred EOM | Transaction trace logs usage |
| HDR Report detail links | Deferred EOM (per click) | Each detail link is a separate billable transaction |
| MVR Requests | **Prepaid deposit required** | Balance checked before request; HDR pays state per request |
| Empty searches (no results) | **Not billed** | Transaction trace not created |

---

**Total Endpoints:** 36
**All NEW (must build):** 36
**P0 Critical:** 18 | **P1 High:** 14 | **P2 Medium:** 1 | **P3 Low:** 3

---

## 12. Adapter Migration Strategy

### 12.1 Overview

Each search type supports swappable data adapters. In Phase 1, all adapters use the legacy D3 socket protocol. As MongoDB becomes available, adapters are swapped per search type without frontend redeployment.

### 12.2 Migration Phases (Per Search Type)

| Phase | Adapter | Status | Description |
|---|---|---|---|
| 1 | Legacy (D3) | Production | Current implementation, serving real users |
| 2 | MongoDB (1-1 parity) | Validation | Same params, same response shape, results validated against legacy |
| 3 | MongoDB (enhanced) | Production | New params (synonyms, fuzzy, etc.), legacy adapter retired |

During validation (Phase 2), up to 3 adapters may temporarily coexist for a single search type. This is a short overlap window — just long enough to confirm data parity.

### 12.3 Adapter Switching

Adapter selection is config-driven (environment variable or database setting per search type):

```
DPS_NAME_ADAPTER=legacy        # Phase 1
DPS_NAME_ADAPTER=mongo-parity  # Phase 2 (validation)
DPS_NAME_ADAPTER=mongo-enhanced # Phase 3 (final)
```

The route handler delegates to whichever adapter is configured. The frontend is unaware of which adapter is active.

### 12.4 Frontend Feature Gating (No Rollbacks)

**The frontend never needs to be rolled back.** Instead, a capabilities API controls which features are visible.

#### Capabilities Endpoint

**Route:** `GET /api/config/capabilities`

Returns the active adapter mode and available features per search type. Called once at login.

#### Example Response

```json
{
  "searchCapabilities": {
    "dpsName": {
      "adapter": "mongo-enhanced",
      "features": ["derivative", "yearRange", "synonym", "fuzzyMatch"]
    },
    "dpsAddress": {
      "adapter": "legacy",
      "features": ["derivative"]
    },
    "criminalName": {
      "adapter": "legacy",
      "features": ["derivative"]
    }
  }
}
```

#### Frontend Behavior

- Search forms are built with ALL fields (including future enhanced fields)
- Extra fields (synonyms, fuzzy matching, etc.) are hidden/shown based on the capabilities response
- Switching the backend adapter mode automatically enables/disables frontend features
- No frontend redeployment needed — config is entirely server-side

#### Fallback

If the enhanced adapter has issues, the config is switched back to `mongo-parity` or `legacy`. The frontend automatically hides the enhanced fields. No code changes, no rollback.

### 12.5 JSON Response Contract

**Critical rule:** All adapters for the same search type MUST return the same JSON response shape. The frontend renders the same structure regardless of which adapter produced it.

Legacy and MongoDB parity adapters return identical JSON. The enhanced adapter may add new fields to the response but must not remove or rename existing fields.

```
Legacy adapter    →  { seq, name, isCurrent, updateDate, dobTag, city, zip, type, detailId, detailType }
Mongo parity      →  { seq, name, isCurrent, updateDate, dobTag, city, zip, type, detailId, detailType }
Mongo enhanced    →  { seq, name, isCurrent, updateDate, dobTag, city, zip, type, detailId, detailType, matchScore, ... }
```
