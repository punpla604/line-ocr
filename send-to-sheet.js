const { google } = require('googleapis')

// ==================================================
// GOOGLE SERVICE ACCOUNT
// ==================================================

const GOOGLE_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL

const GOOGLE_PRIVATE_KEY =
  process.env.GOOGLE_PRIVATE_KEY

const SHEET_ID =
  process.env.SHEET_ID

const SHEET_NAME = 'Sheet1'

// ==================================================
// GOOGLE AUTH
// ==================================================

function getGoogleAuth() {

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    throw new Error(
      '❌ Missing env: GOOGLE_SERVICE_ACCOUNT_EMAIL'
    )
  }

  if (!GOOGLE_PRIVATE_KEY) {
    throw new Error(
      '❌ Missing env: GOOGLE_PRIVATE_KEY'
    )
  }

  if (!SHEET_ID) {
    throw new Error(
      '❌ Missing env: SHEET_ID'
    )
  }

  // รองรับทั้ง:
  // 1. -----BEGIN PRIVATE KEY-----\nxxxxx\n-----END PRIVATE KEY-----
  // 2. -----BEGIN PRIVATE KEY-----
  //    xxxxx
  //    -----END PRIVATE KEY-----

  const privateKey = GOOGLE_PRIVATE_KEY
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

  console.log(
    'GOOGLE SERVICE ACCOUNT:',
    GOOGLE_SERVICE_ACCOUNT_EMAIL
  )

  console.log(
    'PRIVATE KEY FORMAT:',
    privateKey.startsWith('-----BEGIN PRIVATE KEY-----')
      ? 'OK'
      : 'INVALID'
  )

  console.log(
    'PRIVATE KEY END:',
    privateKey.endsWith('-----END PRIVATE KEY-----')
      ? 'OK'
      : 'INVALID'
  )

  if (
    !privateKey.startsWith(
      '-----BEGIN PRIVATE KEY-----'
    )
  ) {
    throw new Error(
      '❌ GOOGLE_PRIVATE_KEY ไม่ได้ขึ้นต้นด้วย -----BEGIN PRIVATE KEY-----'
    )
  }

  if (
    !privateKey.endsWith(
      '-----END PRIVATE KEY-----'
    )
  ) {
    throw new Error(
      '❌ GOOGLE_PRIVATE_KEY ไม่ได้ลงท้ายด้วย -----END PRIVATE KEY-----'
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
// CONVERT DATA TO SHEET ROW
// ==================================================

function toSheetRow(data) {

  const itemsJson =
    JSON.stringify(data.items || [])

  return [

    // A - Timestamp
    data.timestamp ||
      new Date().toISOString(),

    // B - Employee Code
    data.employeeCode || '',

    // C - Receipt No
    data.receiptNo ||
      data.bn ||
      '',

    // D - BN
    data.bn || '',

    // E - HN
    data.hn || '',

    // F - Receipt Date
    data.receiptDateRaw || '',

    // G - Time
    data.timeText || '',

    // H - Patient Name
    data.patientName || '',

    // I - Payment Type
    data.paymentType || '',

    // J - VAT
    data.vat || '',

    // K - Total
    data.total || '',

    // L - Doctor Fee
    data.doctorFee || '',

    // M - Hospital & Nursing
    data.hospitalNursing || '',

    // N - Other
    data.other || '',

    // O - Items JSON
    itemsJson,

    // P - Raw OCR
    data.raw || ''

  ]
}

// ==================================================
// SEND TO GOOGLE SHEET
// ==================================================

async function sendToSheet(data) {

  const auth =
    getGoogleAuth()

  const sheets =
    google.sheets({
      version: 'v4',
      auth
    })

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
          `${SHEET_NAME}!A:P`,

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
      '=============================='
    )

    console.log(
      '✅ GOOGLE SHEET SAVE SUCCESS'
    )

    console.log(
      'UPDATED RANGE:',
      response.data.updates?.updatedRange
    )

    console.log(
      'UPDATED ROWS:',
      response.data.updates?.updatedRows
    )

    console.log(
      '=============================='
    )

    return response.data

  } catch (err) {

    console.error(
      '=============================='
    )

    console.error(
      '❌ GOOGLE SHEET SAVE ERROR'
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

    console.error(
      '=============================='
    )

    throw err

  }

}

// ==================================================
// EXPORT
// ==================================================

module.exports =
  sendToSheet