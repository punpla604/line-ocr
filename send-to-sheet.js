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

  let privateKey =
    GOOGLE_PRIVATE_KEY

  // รองรับกรณี Render เก็บ \n เป็นตัวอักษร
  privateKey =
    privateKey.replace(/\\n/g, '\n')

  // รองรับกรณีมี quote ครอบทั้งค่า
  privateKey =
    privateKey.replace(/^"|"$/g, '')

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
    !privateKey.includes(
      '-----END PRIVATE KEY-----'
    )
  ) {
    throw new Error(
      '❌ GOOGLE_PRIVATE_KEY ไม่มี -----END PRIVATE KEY-----'
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
//
// Sheet1:
//
// A timestamp
// B employeeCode
// C bn
// D dateText
// E timeText
// F hn
// G name
// H paymentType
// I vat
// J total
// K doctorFee
// L hospital&nursing
// M other
// N itemJson
// O raw
//
// ==================================================

function toSheetRow(data) {
  const itemsJson =
    JSON.stringify(
      data.items || []
    )

  return [
    // A - timestamp
    data.timestamp ||
      new Date().toISOString(),

    // B - employeeCode
    data.employeeCode || '',

    // C - bn
    data.bn || data.receiptNo || '',

    // D - dateText
    data.receiptDateRaw || '',

    // E - timeText
    data.timeText || '',

    // F - hn
    data.hn || '',

    // G - name
    data.patientName || '',

    // H - paymentType
    data.paymentType || '',

    // I - vat
    data.vat || '',

    // J - total
    data.total || '',

    // K - doctorFee
    data.doctorFee || '',

    // L - hospital&nursing
    data.hospitalNursing || '',

    // M - other
    data.other || '',

    // N - itemJson
    itemsJson,

    // O - raw
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