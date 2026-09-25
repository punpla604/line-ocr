const { google } = require('googleapis')

const SHEET_ID =
  process.env.SHEET_ID

const GOOGLE_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL

const GOOGLE_PRIVATE_KEY =
  process.env.GOOGLE_PRIVATE_KEY?.replace(
    /\\n/g,
    '\n'
  )

const SUMMARY_PASSWORD =
  process.env.SUMMARY_PASSWORD

const MAX_ATTEMPTS = 3

// ==================================================
// GOOGLE SHEETS CLIENT
// ==================================================

let sheetsClient = null

function getSheetsClient() {
  if (sheetsClient) {
    return sheetsClient
  }

  if (!SHEET_ID) {
    throw new Error(
      'Missing env: SHEET_ID'
    )
  }

  const auth =
    new google.auth.GoogleAuth({
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

  sheetsClient =
    google.sheets({
      version: 'v4',
      auth
    })

  return sheetsClient
}

// ==================================================
// READ SHEET3
// ==================================================

async function getAuthRows() {
  const sheets =
    getSheetsClient()

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId:
        SHEET_ID,
      range:
        'Sheet3!A:D',
      majorDimension:
        'ROWS'
    })

  return (
    response.data.values || []
  )
}

// ==================================================
// FIND USER
// ==================================================

async function findUser(
  userId
) {
  const rows =
    await getAuthRows()

  if (
    rows.length <= 1
  ) {
    return null
  }

  for (
    let i = 1;
    i < rows.length;
    i++
  ) {
    const row =
      rows[i]

    const rowUserId =
      String(
        row[0] || ''
      ).trim()

    if (
      rowUserId === userId
    ) {
      return {
        rowNumber: i + 1,
        userId: rowUserId,
        failedAttempts:
          Number(
            row[1] || 0
          ),
        locked:
          String(
            row[2] || ''
          ).toUpperCase() ===
          'TRUE',
        lockedAt:
          row[3] || ''
      }
    }
  }

  return null
}

// ==================================================
// CREATE USER
// ==================================================

async function createUser(
  userId
) {
  const sheets =
    getSheetsClient()

  await sheets.spreadsheets.values.append({
    spreadsheetId:
      SHEET_ID,
    range:
      'Sheet3!A:D',
    valueInputOption:
      'USER_ENTERED',
    insertDataOption:
      'INSERT_ROWS',
    requestBody: {
      values: [
        [
          userId,
          0,
          false,
          ''
        ]
      ]
    }
  })

  return {
    userId,
    failedAttempts: 0,
    locked: false,
    lockedAt: ''
  }
}

// ==================================================
// CHECK USER
// ==================================================

async function checkUser(
  userId
) {
  let user =
    await findUser(userId)

  if (!user) {
    user =
      await createUser(
        userId
      )
  }

  return user
}

// ==================================================
// UPDATE USER
// ==================================================

async function updateUser(
  user,
  failedAttempts,
  locked,
  lockedAt
) {
  const sheets =
    getSheetsClient()

  await sheets.spreadsheets.values.update({
    spreadsheetId:
      SHEET_ID,
    range:
      `Sheet3!A${user.rowNumber}:D${user.rowNumber}`,
    valueInputOption:
      'USER_ENTERED',
    requestBody: {
      values: [
        [
          user.userId,
          failedAttempts,
          locked,
          lockedAt
        ]
      ]
    }
  })
}

// ==================================================
// CHECK PASSWORD
// ==================================================

async function verifySummaryPassword(
  userId,
  password
) {
  let user =
    await checkUser(userId)

  // --------------------------------------------------
  // ALREADY LOCKED
  // --------------------------------------------------

  if (user.locked) {
    return {
      success: false,
      locked: true,
      attempts: user.failedAttempts,
      remaining: 0
    }
  }

  // --------------------------------------------------
  // CORRECT PASSWORD
  // --------------------------------------------------

  if (
    String(password).trim() ===
    String(SUMMARY_PASSWORD).trim()
  ) {
    // Reset failed attempts
    await updateUser(
      user,
      0,
      false,
      ''
    )

    return {
      success: true,
      locked: false,
      attempts: 0,
      remaining:
        MAX_ATTEMPTS
    }
  }

  // --------------------------------------------------
  // WRONG PASSWORD
  // --------------------------------------------------

  const attempts =
    user.failedAttempts + 1

  const remaining =
    Math.max(
      MAX_ATTEMPTS - attempts,
      0
    )

  // --------------------------------------------------
  // LOCK
  // --------------------------------------------------

  if (
    attempts >=
    MAX_ATTEMPTS
  ) {
    const lockedAt =
      new Date().toISOString()

    await updateUser(
      user,
      attempts,
      true,
      lockedAt
    )

    return {
      success: false,
      locked: true,
      attempts,
      remaining: 0
    }
  }

  // --------------------------------------------------
  // NOT LOCKED
  // --------------------------------------------------

  await updateUser(
    user,
    attempts,
    false,
    ''
  )

  return {
    success: false,
    locked: false,
    attempts,
    remaining
  }
}

module.exports = {
  checkUser,
  verifySummaryPassword
}