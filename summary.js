const { google } = require('googleapis')

const SHEET_ID = process.env.SHEET_ID

const GOOGLE_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL

const GOOGLE_PRIVATE_KEY =
  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')

let sheetsClient = null

function getSheetsClient() {
  if (sheetsClient) {
    return sheetsClient
  }

  if (!SHEET_ID) {
    throw new Error('Missing env: SHEET_ID')
  }

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

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email:
        GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:
        GOOGLE_PRIVATE_KEY
    },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  })

  sheetsClient = google.sheets({
    version: 'v4',
    auth
  })

  return sheetsClient
}

// ==================================================
// NUMBER
// ==================================================

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return 0
  }

  const number = Number(
    String(value)
      .replace(/,/g, '')
      .replace(/[^\d.-]/g, '')
      .trim()
  )

  return Number.isNaN(number)
    ? 0
    : number
}

// ==================================================
// DATE
// ==================================================

function getMonthYearFromDate(rawDate) {
  const text = String(
    rawDate || ''
  ).trim()

  if (!text) {
    return null
  }

  // YYYY-MM-DD
  let match = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/
  )

  if (match) {
    return {
      year: match[1],
      month: String(match[2]).padStart(2, '0')
    }
  }

  // DD/MM/YYYY
  match = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  )

  if (match) {
    return {
      year: match[3],
      month: String(match[2]).padStart(2, '0')
    }
  }

  // DD Month YYYY
  // เช่น 31 January 2026
  const parsedDate = new Date(text)

  if (
    !Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    return {
      year: String(
        parsedDate.getFullYear()
      ),
      month: String(
        parsedDate.getMonth() + 1
      ).padStart(2, '0')
    }
  }

  return null
}

// ==================================================
// MONTHLY SUMMARY
// ==================================================

async function getMonthlySummary(
  month,
  year
) {
  const sheets =
    getSheetsClient()

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId:
        SHEET_ID,

      range:
        process.env.SHEET_RANGE ||
        'Sheet1!A:Z',

      majorDimension:
        'ROWS'
    })

  const rows =
    response.data.values || []

  if (rows.length <= 1) {
    return {
      month,
      year,
      count: 0,
      doctorFee: 0,
      hospitalNursing: 0,
      other: 0,
      total: 0
    }
  }

  // ==================================================
  // HEADER
  // ==================================================

  const headers =
    rows[0].map(header =>
      String(header || '')
        .trim()
        .toLowerCase()
    )

  function getColumnIndex(
    possibleNames
  ) {
    for (
      const name
      of possibleNames
    ) {
      const index =
        headers.indexOf(
          name.toLowerCase()
        )

      if (index !== -1) {
        return index
      }
    }

    return -1
  }

  const dateIndex =
    getColumnIndex([
      'datetext',
      'date text',
      'date',
      'receiptdate',
      'receipt date'
    ])

  const doctorFeeIndex =
    getColumnIndex([
      'doctorfee',
      'doctor fee'
    ])

  const hospitalNursingIndex =
    getColumnIndex([
      'hospital&nursing',
      'hospital & nursing',
      'hospitalnursing',
      'hospital nursing'
    ])

  const otherIndex =
    getColumnIndex([
      'other'
    ])

  console.log(
    'SUMMARY COLUMN INDEX:',
    {
      dateIndex,
      doctorFeeIndex,
      hospitalNursingIndex,
      otherIndex
    }
  )

  if (dateIndex === -1) {
    throw new Error(
      'ไม่พบ column dateText ใน Sheet1'
    )
  }

  // ==================================================
  // SUM
  // ==================================================

  let count = 0

  let doctorFee = 0
  let hospitalNursing = 0
  let other = 0

  for (
    const row of rows.slice(1)
  ) {
    const rawDate =
      row[dateIndex] || ''

    const dateInfo =
      getMonthYearFromDate(
        rawDate
      )

    if (!dateInfo) {
      continue
    }

    if (
      dateInfo.month !==
      String(month).padStart(2, '0')
    ) {
      continue
    }

    if (
      dateInfo.year !==
      String(year)
    ) {
      continue
    }

    count++

    doctorFee +=
      toNumber(
        row[doctorFeeIndex]
      )

    hospitalNursing +=
      toNumber(
        row[
          hospitalNursingIndex
        ]
      )

    other +=
      toNumber(
        row[otherIndex]
      )
  }

  const total =
    doctorFee +
    hospitalNursing +
    other

  console.log(
    'MONTHLY SUMMARY:',
    {
      month,
      year,
      count,
      doctorFee,
      hospitalNursing,
      other,
      total
    }
  )

  return {
    month,
    year,
    count,
    doctorFee,
    hospitalNursing,
    other,
    total
  }
}

module.exports = {
  getMonthlySummary
}