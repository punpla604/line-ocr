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
// CONVERT DATA TO SHEET ROW
// ==================================================

function toSheetRow(data) {

  const itemsJson =
    JSON.stringify(
      data.items || []
    )

  return [

    data.timestamp ||
      new Date().toISOString(),

    data.employeeCode || '',

    data.bn ||
      data.receiptNo ||
      '',

    data.receiptDateRaw || '',

    data.timeText || '',

    data.hn || '',

    data.patientName || '',

    data.paymentType || '',

    data.vat || '',

    data.total || '',

    data.doctorFee || '',

    data.hospitalNursing || '',

    data.other || '',

    itemsJson,

    data.raw || ''

  ]
}


// ==================================================
// SAVE RECEIPT
// ==================================================

async function saveReceipt(data) {

  if (!data) {
    throw new Error(
      'Missing receipt data'
    )
  }

  const sheets =
    getSheets()

  const row =
    toSheetRow(data)

  try {

    console.log(
      '=============================='
    )

    console.log(
      'GOOGLE SHEET SAVE'
    )

    console.log(
      'SHEET ID:',
      SHEET_ID
    )

    console.log(
      'SHEET NAME:',
      SHEET_NAME
    )

    console.log(
      'ROW:',
      row
    )

    console.log(
      '=============================='
    )

    const response =
      await sheets.spreadsheets.values.append({

        spreadsheetId:
          SHEET_ID,

        range:
          `${SHEET_NAME}!A:O`,

        valueInputOption:
          'USER_ENTERED',

        insertDataOption:
          'INSERT_ROWS',

        requestBody: {
          values: [
            row
          ]
        }

      })

    console.log(
      'GOOGLE SHEET SAVE SUCCESS'
    )

    console.log(
      'UPDATED RANGE:',
      response.data.updates?.updatedRange
    )

    console.log(
      'UPDATED ROWS:',
      response.data.updates?.updatedRows
    )

    return response.data

  } catch (err) {

    console.error(
      'GOOGLE SHEET SAVE ERROR'
    )

    if (err.response) {

      console.error(
        'STATUS:',
        err.response.status
      )

      console.error(
        'DATA:',
        err.response.data
      )

    } else {

      console.error(
        'MESSAGE:',
        err.message
      )

    }

    throw err
  }
}


// ==================================================
// READ SHEET DATA
// ==================================================

async function readRows() {

  const sheets =
    getSheets()

  const response =
    await sheets.spreadsheets.values.get({

      spreadsheetId:
        SHEET_ID,

      range:
        `${SHEET_NAME}!A${DATA_START_ROW}:O`

    })

  return response.data.values || []
}


// ==================================================
// ROW -> OBJECT
// ==================================================

function rowToObject(r) {

  return {

    timestamp:
      r[0] || '',

    employeeCode:
      cleanText(r[1])
        .toUpperCase(),

    bn:
      cleanText(r[2]),

    dateText:
      r[3] || '',

    timeText:
      cleanText(r[4]),

    hn:
      cleanText(r[5]),

    name:
      cleanText(r[6]),

    paymentType:
      cleanText(r[7]),

    vat:
      cleanText(r[8]),

    total:
      cleanText(r[9]),

    doctorFee:
      cleanText(r[10]),

    hospitalNursing:
      cleanText(r[11]),

    other:
      cleanText(r[12]),

    items:
      safeParseJson(r[13]),

    raw:
      cleanText(r[14])

  }
}


// ==================================================
// GET ROWS
// Employee + Month + Year
// ==================================================

async function getFilteredRows(
  employeeCode,
  month,
  year
) {

  const rows =
    await readRows()

  const normalizedEmployee =
    normalizeSearch(
      employeeCode
    )

  const normalizedMonth =
    String(month || '')
      .trim()

  const normalizedYear =
    String(year || '')
      .trim()

  return rows

    .map(rowToObject)

    .filter(function (r) {

      if (
        normalizeSearch(
          r.employeeCode
        ) !==
        normalizedEmployee
      ) {
        return false
      }

      const shortDate =
        toDateShort(
          r.dateText
        )

      if (!shortDate) {
        return false
      }

      const parts =
        shortDate.split('/')

      if (parts[1] !== normalizedMonth) {
        return false
      }

      if (parts[2] !== normalizedYear) {
        return false
      }

      return true
    })
}


// ==================================================
// FORMAT RESULT
// ==================================================

function formatResult(r) {

  return {

    bn:
      cleanText(r.bn),

    hn:
      cleanText(r.hn),

    name:
      cleanText(r.name),

    dateText:
      r.dateText || '',

    dateShort:
      toDateShort(
        r.dateText
      ),

    timeText:
      cleanText(r.timeText),

    paymentType:
      cleanText(r.paymentType),

    vat:
      cleanText(r.vat),

    total:
      formatNumber(r.total),

    doctorFee:
      formatNumber(r.doctorFee),

    hospitalNursing:
      formatNumber(
        r.hospitalNursing
      ),

    other:
      formatNumber(r.other),

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

  const filteredRows =
    await getFilteredRows(
      employeeCode,
      month,
      year
    )

  const searchBN =
    normalizeSearch(bn)

  const matchedRows =
    filteredRows.filter(
      function (r) {

        return (
          normalizeSearch(r.bn) ===
          searchBN
        )

      }
    )

  const list =
    matchedRows
      .slice(0, MAX_RESULT)
      .map(formatResult)

  return {

    ok: true,

    found:
      list.length > 0,

    count:
      matchedRows.length,

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

  const filteredRows =
    await getFilteredRows(
      employeeCode,
      month,
      year
    )

  const searchHN =
    normalizeSearch(hn)

  const list = []

  for (
    let i = 0;
    i < filteredRows.length;
    i++
  ) {

    const r =
      filteredRows[i]

    const rowHN =
      normalizeSearch(r.hn)

    if (
      rowHN !== searchHN
    ) {
      continue
    }

    list.push(
      formatResult(r)
    )

    if (
      list.length >= MAX_RESULT
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

  const filteredRows =
    await getFilteredRows(
      employeeCode,
      month,
      year
    )

  const searchName =
    normalizeSearch(name)

  const matchedRows =
    filteredRows.filter(
      function (r) {

        return (
          normalizeSearch(r.name)
            .includes(searchName)
        )

      }
    )

  const list =
    matchedRows
      .slice(0, MAX_RESULT)
      .map(formatResult)

  return {

    ok: true,

    found:
      list.length > 0,

    count:
      matchedRows.length,

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

  const searchDate =
    toDateShort(date)

  if (!searchDate) {
    throw new Error(
      'Invalid date format. Use DD/MM/YYYY'
    )
  }

  const filteredRows =
    await getFilteredRows(
      employeeCode,
      month,
      year
    )

  const matchedRows =
    filteredRows.filter(
      function (r) {

        return (
          toDateShort(
            r.dateText
          ) === searchDate
        )

      }
    )

  const list =
    matchedRows
      .slice(0, MAX_RESULT)
      .map(formatResult)

  return {

    ok: true,

    found:
      list.length > 0,

    count:
      matchedRows.length,

    date:
      searchDate,

    list

  }
}


// ==================================================
// COUNT BY DATE RECEIPT
// ==================================================

async function countByDateReceipt({
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

  const searchDate =
    toDateShort(date)

  if (!searchDate) {
    throw new Error(
      'Invalid date format. Use DD/MM/YYYY'
    )
  }

  const filteredRows =
    await getFilteredRows(
      employeeCode,
      month,
      year
    )

  const matchedRows =
    filteredRows.filter(
      function (r) {

        return (
          toDateShort(
            r.dateText
          ) === searchDate
        )

      }
    )

  return {

    ok: true,

    found:
      matchedRows.length > 0,

    count:
      matchedRows.length,

    date:
      searchDate

  }
}


// ==================================================
// CLEAN TEXT
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
    text.replace(/,/g, '')

  const number =
    Number(clean)

  if (isNaN(number)) {
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
// DATE -> DD/MM/YYYY
// ==================================================

function toDateShort(dateValue) {

  try {

    if (
      dateValue === null ||
      dateValue === undefined ||
      dateValue === ''
    ) {
      return ''
    }

    if (
      Object.prototype.toString.call(
        dateValue
      ) === '[object Date]'
    ) {

      if (
        isNaN(
          dateValue.getTime()
        )
      ) {
        return ''
      }

      const dd =
        String(
          dateValue.getDate()
        ).padStart(2, '0')

      const mm =
        String(
          dateValue.getMonth() + 1
        ).padStart(2, '0')

      const yyyy =
        String(
          dateValue.getFullYear()
        )

      return (
        dd +
        '/' +
        mm +
        '/' +
        yyyy
      )
    }

    const s =
      String(dateValue)
        .trim()

    if (!s) {
      return ''
    }

    let match =
      s.match(
        /^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/
      )

    if (match) {

      return normalizeDate(
        match[1],
        match[2],
        match[3]
      )
    }

    match =
      s.match(
        /^(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})$/
      )

    if (match) {

      return normalizeDate(
        match[1],
        match[2],
        match[3]
      )
    }

    match =
      s.match(
        /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/i
      )

    if (match) {

      const day =
        parseInt(match[1], 10)

      const month =
        getMonthNumber(
          match[2].toLowerCase()
        )

      const year =
        parseInt(match[3], 10)

      if (!month) {
        return ''
      }

      return normalizeDate(
        day,
        month,
        year
      )
    }

    match =
      s.match(
        /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i
      )

    if (match) {

      const month =
        getMonthNumber(
          match[1].toLowerCase()
        )

      const day =
        parseInt(match[2], 10)

      const year =
        parseInt(match[3], 10)

      if (!month) {
        return ''
      }

      return normalizeDate(
        day,
        month,
        year
      )
    }

    match =
      s.match(
        /^(\d{4})-(\d{1,2})-(\d{1,2})$/
      )

    if (match) {

      return normalizeDate(
        match[3],
        match[2],
        match[1]
      )
    }

    const d =
      new Date(s)

    if (
      isNaN(
        d.getTime()
      )
    ) {
      return ''
    }

    return normalizeDate(
      d.getDate(),
      d.getMonth() + 1,
      d.getFullYear()
    )

  } catch (err) {

    return ''
  }
}


// ==================================================
// NORMALIZE DATE
// ==================================================

function normalizeDate(
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
    return ''
  }

  const testDate =
    new Date(
      y,
      m - 1,
      d
    )

  if (
    testDate.getFullYear() !== y ||
    testDate.getMonth() !== m - 1 ||
    testDate.getDate() !== d
  ) {
    return ''
  }

  return (

    String(d).padStart(2, '0') +

    '/' +

    String(m).padStart(2, '0') +

    '/' +

    String(y)

  )
}


// ==================================================
// MONTH NAME -> NUMBER
// ==================================================

function getMonthNumber(monthName) {

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
    months[monthName] || 0
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