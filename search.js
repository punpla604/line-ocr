const { google } = require('googleapis')

// ==================================================
// CONFIG
// ==================================================

const GOOGLE_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL

const GOOGLE_PRIVATE_KEY =
  process.env.GOOGLE_PRIVATE_KEY

const SHEET_ID =
  process.env.SHEET_ID

const SHEET_NAME = 'Sheet1'

const DATA_START_ROW = 2
const MAX_RESULT = 10


// ==================================================
// GOOGLE AUTH
// ==================================================

function getGoogleAuth() {

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    throw new Error(
      'Missing env: GOOGLE_SERVICE_ACCOUNT_EMAIL'
    )
  }

  if (!GOOGLE_PRIVATE_KEY) {
    throw new Error(
      'Missing env: GOOGLE_PRIVATE_KEY'
    )
  }

  if (!SHEET_ID) {
    throw new Error(
      'Missing env: SHEET_ID'
    )
  }

  let privateKey =
    GOOGLE_PRIVATE_KEY

  privateKey =
    privateKey.replace(/\\n/g, '\n')

  privateKey =
    privateKey.replace(/^"|"$/g, '')

  if (
    !privateKey.startsWith(
      '-----BEGIN PRIVATE KEY-----'
    )
  ) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY ไม่ได้ขึ้นต้นด้วย -----BEGIN PRIVATE KEY-----'
    )
  }

  if (
    !privateKey.includes(
      '-----END PRIVATE KEY-----'
    )
  ) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY ไม่มี -----END PRIVATE KEY-----'
    )
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email:
        GOOGLE_SERVICE_ACCOUNT_EMAIL,

      private_key:
        privateKey
    },

    scopes: [
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  })
}


// ==================================================
// GOOGLE SHEETS CLIENT
// ==================================================

function getSheets() {

  const auth =
    getGoogleAuth()

  return google.sheets({
    version: 'v4',
    auth
  })
}


// ==================================================
// READ SHEET
// ==================================================

async function readSheet() {

  const sheets =
    getSheets()

  const response =
    await sheets.spreadsheets.values.get({

      spreadsheetId:
        SHEET_ID,

      range:
        `${SHEET_NAME}!A:T`,

      valueRenderOption:
        'FORMATTED_VALUE'

    })

  return response.data.values || []
}


// ==================================================
// NORMALIZE HEADER
// ==================================================

function normalizeHeader(value) {

  return cleanText(value)
    .toLowerCase()
    .replace(/[\s_\-&]+/g, '')
}


// ==================================================
// HEADER -> INDEX
// ==================================================

function getColumnMap(header) {

  const map = {}

  header.forEach(
    function (value, index) {

      const key =
        normalizeHeader(value)

      if (key) {
        map[key] = index
      }

    }
  )

  return map
}


// ==================================================
// GET COLUMN
// ==================================================

function getColumn(row, map, names) {

  for (
    let i = 0;
    i < names.length;
    i++
  ) {

    const key =
      normalizeHeader(
        names[i]
      )

    if (
      map[key] !== undefined
    ) {

      return cleanText(
        row[map[key]]
      )

    }

  }

  return ''
}


// ==================================================
// READ DATA ROWS
// ==================================================

async function readRows() {

  const allRows =
    await readSheet()

  if (
    !allRows.length
  ) {
    return []
  }

  const header =
    allRows[0]

  const map =
    getColumnMap(header)

  console.log(
    'GOOGLE SHEET HEADER:',
    header
  )

  console.log(
    'GOOGLE SHEET COLUMN MAP:',
    map
  )

  const dataRows =
    allRows.slice(
      DATA_START_ROW - 1
    )

  return dataRows.map(
    function (row) {

      return rowToObject(
        row,
        map
      )

    }
  )
}


// ==================================================
// ROW -> OBJECT
// ==================================================

function rowToObject(row, map) {

  return {

    timestamp:
      getColumn(
        row,
        map,
        [
          'timestamp'
        ]
      ),

    employeeCode:
      getColumn(
        row,
        map,
        [
          'employeeCode',
          'employee code'
        ]
      ).toUpperCase(),

    doctorID:
      getColumn(
        row,
        map,
        [
          'doctorID',
          'doctorId',
          'doctor id',
          'doctorCode',
          'doctor code'
        ]
      ),

    doctorName:
      getColumn(
        row,
        map,
        [
          'doctorName',
          'doctor name'
        ]
      ),

    bn:
      getColumn(
        row,
        map,
        [
          'bn',
          'receiptNo',
          'receipt no'
        ]
      ),

    dateText:
      getColumn(
        row,
        map,
        [
          'dateText',
          'date',
          'receiptDate',
          'receipt date'
        ]
      ),

    timeText:
      getColumn(
        row,
        map,
        [
          'timeText',
          'time'
        ]
      ),

    hn:
      getColumn(
        row,
        map,
        [
          'hn'
        ]
      ),

    name:
      getColumn(
        row,
        map,
        [
          'name',
          'patientName',
          'patient name'
        ]
      ),

    paymentType:
      getColumn(
        row,
        map,
        [
          'paymentType',
          'payment type'
        ]
      ),

    vat:
      getColumn(
        row,
        map,
        [
          'vat'
        ]
      ),

    amount:
      getColumn(
        row,
        map,
        [
          'amount'
        ]
      ),

    discount:
      getColumn(
        row,
        map,
        [
          'discount'
        ]
      ),

    discountByDoctor:
      getColumn(
        row,
        map,
        [
          'discountByDoctor',
          'discount by doctor'
        ]
      ),

    total:
      getColumn(
        row,
        map,
        [
          'total'
        ]
      ),

    doctorFee:
      getColumn(
        row,
        map,
        [
          'doctorFee',
          'doctor fee'
        ]
      ),

    hospitalNursing:
      getColumn(
        row,
        map,
        [
          'hospitalNursing',
          'hospital&nursing',
          'hospital nursing'
        ]
      ),

    other:
      getColumn(
        row,
        map,
        [
          'other'
        ]
      ),

    items:
      safeParseJson(
        getColumn(
          row,
          map,
          [
            'itemJson',
            'item json',
            'items'
          ]
        )
      ),

    raw:
      getColumn(
        row,
        map,
        [
          'raw'
        ]
      )

  }
}


// ==================================================
// FILTER EMPLOYEE + MONTH + YEAR
// ==================================================

async function getFilteredRows(
  employeeCode,
  month,
  year
) {

  const rows =
    await readRows()

  const targetEmployee =
    normalizeSearch(
      employeeCode
    )

  const targetMonth =
    String(month || '')
      .trim()
      .padStart(2, '0')

  const targetYear =
    String(year || '')
      .trim()

  const result = []

  for (
    let i = 0;
    i < rows.length;
    i++
  ) {

    const r =
      rows[i]

    if (
      normalizeSearch(
        r.employeeCode
      ) !==
      targetEmployee
    ) {
      continue
    }

    const parsedDate =
      parseSheetDate(
        r.dateText
      )

    if (!parsedDate) {

      console.log(
        'INVALID DATE:',
        {
          row: i + DATA_START_ROW,
          raw:
            r.dateText,
          bn:
            r.bn
        }
      )

      continue
    }

    if (
      parsedDate.month !==
      targetMonth
    ) {
      continue
    }

    if (
      parsedDate.year !==
      targetYear
    ) {
      continue
    }

    result.push({
      ...r,

      _date:
        parsedDate
    })

  }

  console.log(
    'FILTER RESULT:',
    {
      employeeCode:
        targetEmployee,

      month:
        targetMonth,

      year:
        targetYear,

      count:
        result.length
    }
  )

  return result
}


// ==================================================
// FORMAT RESULT
// ==================================================

function formatResult(r) {

  const doctorID =
    cleanText(
      r.doctorID
    )

  const doctorName =
    cleanText(
      r.doctorName
    )

  return {

    bn:
      cleanText(r.bn),

    doctorID:
      doctorID || '-',

    doctorCode:
      doctorID || '-',

    doctorName:
      doctorName || '-',

    doctor:
      doctorName || '-',

    hn:
      cleanText(r.hn),

    name:
      cleanText(r.name),

    dateText:
      cleanText(r.dateText),

    dateShort:
      r._date
        ? r._date.short
        : toDateShort(
            r.dateText
          ),

    timeText:
      cleanText(r.timeText),

    paymentType:
      cleanText(r.paymentType),

    vat:
      cleanText(r.vat),

    amount:
      formatNumber(
        r.amount
      ),

    discount:
      formatNumber(
        r.discount
      ),

    discountByDoctor:
      formatNumber(
        r.discountByDoctor
      ),

    total:
      formatNumber(
        r.total
      ),

    doctorFee:
      formatNumber(
        r.doctorFee
      ),

    hospitalNursing:
      formatNumber(
        r.hospitalNursing
      ),

    other:
      formatNumber(
        r.other
      ),

    items:
      r.items || [],

    employeeCode:
      cleanText(
        r.employeeCode
      )

  }
}


// ==================================================
// FIND BY BN
// ==================================================

async function findByBN({
  employeeCode,
  month,
  year,
  bn
}) {

  if (!bn) {
    throw new Error(
      'bn is required'
    )
  }

  const rows =
    await getFilteredRows(
      employeeCode,
      month,
      year
    )

  const target =
    normalizeSearch(bn)

  const matched =
    rows.filter(
      function (r) {

        return (
          normalizeSearch(
            r.bn
          ) ===
          target
        )

      }
    )

  const list =
    matched
      .slice(0, MAX_RESULT)
      .map(formatResult)

  console.log(
    'FIND BN:',
    {
      bn,
      matched:
        matched.length,

      result:
        list.map(
          function (x) {

            return {
              doctorID:
                x.doctorID,

              doctorName:
                x.doctorName
            }

          }
        )
    }
  )

  return {

    ok: true,

    found:
      list.length > 0,

    count:
      matched.length,

    list

  }
}


// ==================================================
// FIND BY HN
// ==================================================

async function findByHN({
  employeeCode,
  month,
  year,
  hn
}) {

  if (!hn) {
    throw new Error(
      'hn is required'
    )
  }

  const rows =
    await getFilteredRows(
      employeeCode,
      month,
      year
    )

  const target =
    normalizeSearch(hn)

  const list = []

  for (
    let i = 0;
    i < rows.length;
    i++
  ) {

    if (
      normalizeSearch(
        rows[i].hn
      ) !==
      target
    ) {
      continue
    }

    list.push(
      formatResult(
        rows[i]
      )
    )

    if (
      list.length >=
      MAX_RESULT
    ) {
      break
    }

  }

  return {

    ok: true,

    found:
      list.length > 0,

    count:
      list.length,

    list

  }
}


// ==================================================
// FIND BY NAME
// ==================================================

async function findByName({
  employeeCode,
  month,
  year,
  name
}) {

  if (!name) {
    throw new Error(
      'name is required'
    )
  }

  const rows =
    await getFilteredRows(
      employeeCode,
      month,
      year
    )

  const target =
    normalizeSearch(name)

  const matched =
    rows.filter(
      function (r) {

        return normalizeSearch(
          r.name
        ).includes(
          target
        )

      }
    )

  const list =
    matched
      .slice(0, MAX_RESULT)
      .map(formatResult)

  return {

    ok: true,

    found:
      list.length > 0,

    count:
      matched.length,

    list

  }
}


// ==================================================
// FIND BY DATE
// ==================================================

async function findByDate({
  employeeCode,
  month,
  year,
  date
}) {

  if (!date) {
    throw new Error(
      'date is required'
    )
  }

  const day =
    extractDay(date)

  if (!day) {
    throw new Error(
      'Invalid date'
    )
  }

  const targetMonth =
    String(month || '')
      .trim()
      .padStart(2, '0')

  const targetYear =
    String(year || '')
      .trim()

  const rows =
    await getFilteredRows(
      employeeCode,
      targetMonth,
      targetYear
    )

  console.log(
    'SEARCH DATE:',
    {
      employeeCode,
      month:
        targetMonth,
      year:
        targetYear,
      day,
      filtered:
        rows.length
    }
  )

  const matched =
    rows.filter(
      function (r) {

        if (!r._date) {
          return false
        }

        const same =
          r._date.day === day

        if (same) {

          console.log(
            'DATE MATCH:',
            {
              bn:
                r.bn,

              rawDate:
                r.dateText,

              normalized:
                r._date.short,

              doctorID:
                r.doctorID,

              doctorName:
                r.doctorName
            }
          )

        }

        return same
      }
    )

  const list =
    matched
      .slice(0, MAX_RESULT)
      .map(formatResult)

  console.log(
    'SEARCH DATE RESULT:',
    {
      target:
        `${day}/${targetMonth}/${targetYear}`,

      filtered:
        rows.length,

      matched:
        matched.length
    }
  )

  return {

    ok: true,

    found:
      list.length > 0,

    count:
      matched.length,

    date:
      `${day}/${targetMonth}/${targetYear}`,

    list

  }
}


// ==================================================
// COUNT BY DATE
// ==================================================

async function countByDateReceipt({
  employeeCode,
  month,
  year,
  date
}) {

  const result =
    await findByDate({
      employeeCode,
      month,
      year,
      date
    })

  return {

    ok: true,

    found:
      result.found,

    count:
      result.count,

    date:
      result.date

  }
}


// ==================================================
// EXTRACT DAY
// ==================================================

function extractDay(value) {

  const s =
    cleanText(value)

  if (!s) {
    return ''
  }

  if (
    /^\d{1,2}$/.test(s)
  ) {

    const d =
      parseInt(s, 10)

    if (
      d < 1 ||
      d > 31
    ) {
      return ''
    }

    return String(d)
      .padStart(2, '0')
  }

  let match =
    s.match(
      /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/
    )

  if (match) {

    return String(
      parseInt(
        match[1],
        10
      )
    ).padStart(2, '0')
  }

  match =
    s.match(
      /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/i
    )

  if (match) {

    return String(
      parseInt(
        match[1],
        10
      )
    ).padStart(2, '0')
  }

  match =
    s.match(
      /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i
    )

  if (match) {

    return String(
      parseInt(
        match[2],
        10
      )
    ).padStart(2, '0')
  }

  const parsed =
    parseSheetDate(s)

  return parsed
    ? parsed.day
    : ''
}


// ==================================================
// PARSE SHEET DATE
// ==================================================

function parseSheetDate(value) {

  const s =
    cleanText(value)

  if (!s) {
    return null
  }


  // ==================================================
  // DD/MM/YYYY
  // ==================================================

  let match =
    s.match(
      /^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/
    )

  if (match) {

    return makeDateInfo(
      match[1],
      match[2],
      match[3]
    )
  }


  // ==================================================
  // DD-MM-YYYY
  // ==================================================

  match =
    s.match(
      /^(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})$/
    )

  if (match) {

    return makeDateInfo(
      match[1],
      match[2],
      match[3]
    )
  }


  // ==================================================
  // DD Month YYYY
  // 31 August 2026
  // ==================================================

  match =
    s.match(
      /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/i
    )

  if (match) {

    const month =
      getMonthNumber(
        match[2]
      )

    if (!month) {
      return null
    }

    return makeDateInfo(
      match[1],
      month,
      match[3]
    )
  }


  // ==================================================
  // Month DD YYYY
  // August 31 2026
  // ==================================================

  match =
    s.match(
      /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i
    )

  if (match) {

    const month =
      getMonthNumber(
        match[1]
      )

    if (!month) {
      return null
    }

    return makeDateInfo(
      match[2],
      month,
      match[3]
    )
  }


  // ==================================================
  // YYYY-MM-DD
  // ==================================================

  match =
    s.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    )

  if (match) {

    return makeDateInfo(
      match[3],
      match[2],
      match[1]
    )
  }


  // ==================================================
  // GOOGLE SHEETS SERIAL
  // ==================================================

  if (
    /^\d+(\.\d+)?$/.test(s)
  ) {

    const serial =
      Number(s)

    if (
      serial > 20000 &&
      serial < 100000
    ) {

      const base =
        Date.UTC(
          1899,
          11,
          30
        )

      const date =
        new Date(
          base +
          Math.floor(serial) *
          86400000
        )

      return makeDateInfo(
        date.getUTCDate(),
        date.getUTCMonth() + 1,
        date.getUTCFullYear()
      )
    }
  }


  // ==================================================
  // ISO / OTHER
  // ==================================================

  const parsed =
    new Date(s)

  if (
    !isNaN(
      parsed.getTime()
    )
  ) {

    return makeDateInfo(
      parsed.getDate(),
      parsed.getMonth() + 1,
      parsed.getFullYear()
    )
  }

  return null
}


// ==================================================
// MAKE DATE INFO
// ==================================================

function makeDateInfo(
  day,
  month,
  year
) {

  const d =
    parseInt(day, 10)

  const m =
    parseInt(month, 10)

  const y =
    parseInt(year, 10)

  if (
    !d ||
    !m ||
    !y ||
    d < 1 ||
    d > 31 ||
    m < 1 ||
    m > 12
  ) {
    return null
  }

  const test =
    new Date(
      y,
      m - 1,
      d
    )

  if (
    test.getFullYear() !== y ||
    test.getMonth() !== m - 1 ||
    test.getDate() !== d
  ) {
    return null
  }

  return {

    day:
      String(d)
        .padStart(2, '0'),

    month:
      String(m)
        .padStart(2, '0'),

    year:
      String(y),

    short:
      `${String(d).padStart(2, '0')}/` +
      `${String(m).padStart(2, '0')}/` +
      `${y}`

  }
}


// ==================================================
// DATE SHORT
// ==================================================

function toDateShort(value) {

  const result =
    parseSheetDate(value)

  return result
    ? result.short
    : ''
}


// ==================================================
// MONTH
// ==================================================

function getMonthNumber(
  monthName
) {

  const months = {

    january: 1,
    jan: 1,

    february: 2,
    feb: 2,

    march: 3,
    mar: 3,

    april: 4,
    apr: 4,

    may: 5,

    june: 6,
    jun: 6,

    july: 7,
    jul: 7,

    august: 8,
    aug: 8,

    september: 9,
    sep: 9,
    sept: 9,

    october: 10,
    oct: 10,

    november: 11,
    nov: 11,

    december: 12,
    dec: 12

  }

  return (
    months[
      String(monthName)
        .toLowerCase()
        .trim()
    ] || 0
  )
}


// ==================================================
// CLEAN
// ==================================================

function cleanText(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return ''
  }

  return String(value)

    .replace(
      /\u00A0/g,
      ' '
    )

    .replace(
      /\u200B/g,
      ''
    )

    .replace(
      /\r/g,
      ''
    )

    .replace(
      /\n/g,
      ' '
    )

    .trim()
}


// ==================================================
// NORMALIZE SEARCH
// ==================================================

function normalizeSearch(value) {

  return cleanText(value)

    .replace(
      /\s+/g,
      ' '
    )

    .toUpperCase()
}


// ==================================================
// FORMAT NUMBER
// ==================================================

function formatNumber(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return ''
  }

  const text =
    cleanText(value)

  if (!text) {
    return ''
  }

  if (text === '-') {
    return '-'
  }

  const clean =
    text
      .replace(/,/g, '')
      .replace(/บาท/g, '')
      .trim()

  const number =
    Number(clean)

  if (
    isNaN(number)
  ) {
    return text
  }

  return number.toLocaleString(
    'en-US',
    {
      minimumFractionDigits:
        Number.isInteger(number)
          ? 0
          : 2,

      maximumFractionDigits:
        2
    }
  )
}


// ==================================================
// SAFE JSON
// ==================================================

function safeParseJson(value) {

  try {

    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return []
    }

    if (
      typeof value === 'object'
    ) {
      return value
    }

    const parsed =
      JSON.parse(value)

    return Array.isArray(parsed)
      ? parsed
      : []

  } catch (err) {

    return []

  }
}


// ==================================================
// EXPORT
// ==================================================

module.exports = {

  saveReceipt,

  findByBN,

  findByHN,

  findByName,

  findByDate,

  countByDateReceipt

}
