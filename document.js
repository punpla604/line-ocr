require('dotenv').config()

const axios = require('axios')
const { google } = require('googleapis')

const sendToSheet =
  require('./send-to-sheet')

const {
  ocrImage,
  parseReceipt
} = require('./ocr')

// ==================================================
// ENV
// ==================================================

const LINE_TOKEN =
  process.env.LINE_TOKEN

const SHEET_ID =
  process.env.SHEET_ID

const GOOGLE_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL

const GOOGLE_PRIVATE_KEY =
  process.env.GOOGLE_PRIVATE_KEY
    ?.replace(/\\n/g, '\n')

const WAIT_IMAGE_MS =
  60 * 1000

// ==================================================
// GOOGLE SHEETS
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
// HELPERS
// ==================================================

function normalizeEmployeeCode(
  text
) {

  return String(text || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

function isValidEmployeeCode(
  code
) {

  if (!/^A\d{4}$/.test(code)) {
    return false
  }

  const num =
    parseInt(
      code.slice(1),
      10
    )

  return (
    num >= 1 &&
    num <= 2000
  )
}

function normalizeDoctorID(
  text
) {

  return String(text || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

function isExpired(timestamp) {

  if (!timestamp) {
    return false
  }

  return (
    Date.now() -
    timestamp >
    WAIT_IMAGE_MS
  )
}

function formatNumber(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '0'
  }

  const text =
    String(value)
      .replace(/,/g, '')
      .trim()

  const number =
    Number(text)

  if (
    Number.isNaN(number)
  ) {
    return String(value)
  }

  return number.toLocaleString(
    'en-US'
  )
}

// ==================================================
// RESET DOCUMENT SESSION
// ==================================================

function resetDocumentState(
  state
) {

  state.mode =
    'idle'

  state.step =
    'idle'

  state.employeeCode =
    ''

  state.doctorID =
    ''

  state.doctorName =
    ''

  state.waitingSince =
    0
}

// ==================================================
// LINE REPLY
// ==================================================

async function reply(
  replyToken,
  text
) {

  if (!LINE_TOKEN) {
    throw new Error(
      'Missing env: LINE_TOKEN'
    )
  }

  if (
    typeof replyToken !== 'string' ||
    !replyToken.trim()
  ) {
    throw new Error(
      `Invalid LINE replyToken: ${typeof replyToken}`
    )
  }

  return axios.post(
    'https://api.line.me/v2/bot/message/reply',

    {
      replyToken,

      messages: [
        {
          type: 'text',
          text: String(text)
        }
      ]
    },

    {
      headers: {
        Authorization:
          `Bearer ${LINE_TOKEN}`,

        'Content-Type':
          'application/json'
      },

      timeout: 15000
    }
  )
}

async function replyFlex(
  replyToken,
  altText,
  contents
) {

  if (!LINE_TOKEN) {
    throw new Error(
      'Missing env: LINE_TOKEN'
    )
  }

  if (
    typeof replyToken !== 'string' ||
    !replyToken.trim()
  ) {
    throw new Error(
      `Invalid LINE replyToken: ${typeof replyToken}`
    )
  }

  return axios.post(
    'https://api.line.me/v2/bot/message/reply',

    {
      replyToken,

      messages: [
        {
          type: 'flex',
          altText,
          contents
        }
      ]
    },

    {
      headers: {
        Authorization:
          `Bearer ${LINE_TOKEN}`,

        'Content-Type':
          'application/json'
      },

      timeout: 15000
    }
  )
}

// ==================================================
// EMPLOYEE INPUT TEXT
// ==================================================

function buildEmployeeInputText() {

  return (
    '🧾 ส่งเอกสาร\n\n' +
    'กรุณาพิมพ์รหัสพนักงานครับ\n\n'
  )
}

// ==================================================
// DOCTOR INPUT TEXT
// ==================================================

function buildDoctorInputText(
  employeeCode
) {

  return (
    `👤 พนักงาน: ${employeeCode}\n\n` +
    '🩺 กรุณาพิมพ์ รหัสแพทย์ครับ'
  )
}

// ==================================================
// NEXT DOCTOR INPUT TEXT
// ==================================================

function buildNextDoctorInputText(
  employeeCode
) {

  return (
    '🧾 ใบเสร็จใบถัดไป\n\n' +
    `👤 พนักงาน: ${employeeCode}\n\n` +
    '🩺 กรุณาพิมพ์ รหัสแพทย์ใหม่ครับ'
  )
}

// ==================================================
// DOCTOR CONFIRM FLEX
// ==================================================

function buildDoctorConfirmFlex(
  employeeCode,
  doctorID,
  doctorName
) {

  return {

    type: 'bubble',

    size: 'mega',

    body: {

      type: 'box',

      layout: 'vertical',

      paddingAll: '20px',

      contents: [

        {
          type: 'text',

          text: '🧾 ตรวจสอบข้อมูล',

          weight: 'bold',

          size: 'xl',

          color: '#111111'
        },

        {
          type: 'text',

          text:
            'กรุณาตรวจสอบข้อมูลก่อนส่งรูป',

          size: 'sm',

          color: '#777777',

          margin: 'sm',

          wrap: true
        },

        {
          type: 'separator',

          margin: 'xl'
        },

        {
          type: 'box',

          layout: 'horizontal',

          margin: 'lg',

          contents: [

            {
              type: 'text',

              text: '👤 พนักงาน',

              size: 'sm',

              color: '#555555',

              flex: 1
            },

            {
              type: 'text',

              text: employeeCode,

              size: 'sm',

              weight: 'bold',

              color: '#111111',

              align: 'end'
            }

          ]
        },

        {
          type: 'box',

          layout: 'horizontal',

          margin: 'md',

          contents: [

            {
              type: 'text',

              text: '🩺 รหัสแพทย์',

              size: 'sm',

              color: '#555555',

              flex: 1
            },

            {
              type: 'text',

              text: doctorID,

              size: 'sm',

              weight: 'bold',

              color: '#111111',

              align: 'end'
            }

          ]
        },

        {
          type: 'box',

          layout: 'vertical',

          margin: 'md',

          contents: [

            {
              type: 'text',

              text: '👨‍⚕️ Doctor Name',

              size: 'sm',

              color: '#555555'
            },

            {
              type: 'text',

              text: doctorName || '-',

              size: 'md',

              weight: 'bold',

              color: '#111111',

              margin: 'xs',

              wrap: true
            }

          ]
        },

        {
          type: 'separator',

          margin: 'xl'
        },

        {
          type: 'text',

          text:
            'โปรดยืนยันข้อมูล',

          size: 'md',

          weight: 'bold',

          align: 'center',

          margin: 'xl',

          color: '#111111'
        }

      ]
    },

    footer: {

      type: 'box',

      layout: 'vertical',

      spacing: 'sm',

      contents: [

        {
          type: 'button',

          style: 'primary',

          color: '#16A34A',

          action: {

            type: 'postback',

            label: '✅ ยืนยัน',

            data:
              'document_confirm:yes'
          }
        },

        {
          type: 'button',

          style: 'secondary',

          action: {

            type: 'postback',

            label: '✏️ แก้ไข รหัสแพทย์',

            data:
              'document_confirm:no'
          }
        },

        {
          type: 'button',

          style: 'secondary',

          action: {

            type: 'message',

            label: '❌ ยกเลิก',

            text: 'ยกเลิก'
          }
        }

      ]
    }
  }
}

// ==================================================
// READY FOR IMAGE TEXT
// ==================================================

function buildReadyForImageText(
  state
) {

  return (
    '📷 พร้อมรับใบเสร็จครับ\n\n' +

    `👤 พนักงาน: ${state.employeeCode}\n` +

    `🩺 รหัสแพทย์: ${state.doctorID}\n` +

    `👨‍⚕️ ${state.doctorName}\n\n` +

    'กรุณาส่งรูปใบเสร็จได้เลยครับ\n' +

    '(ครั้งละ 1 รูป) 🧾'
  )
}

// ==================================================
// SUCCESS FLEX
// ==================================================

function buildDocumentSuccessFlex(
  employeeCode,
  doctorID,
  doctorName,
  parsed
) {

  return {

    type: 'bubble',

    size: 'mega',

    body: {

      type: 'box',

      layout: 'vertical',

      paddingAll: '20px',

      contents: [

        {
          type: 'text',

          text: '✅ บันทึกเรียบร้อย',

          weight: 'bold',

          size: 'xl',

          color: '#16A34A'
        },

        {
          type: 'separator',

          margin: 'lg'
        },

        {
          type: 'text',

          text:
            `👤 พนักงาน: ${employeeCode}`,

          size: 'sm',

          margin: 'lg'
        },

        {
          type: 'text',

          text:
            `🩺 รหัสแพทย์: ${doctorID}`,

          size: 'sm',

          margin: 'sm'
        },

        {
          type: 'text',

          text:
            `👨‍⚕️ ${doctorName}`,

          size: 'sm',

          weight: 'bold',

          margin: 'sm',

          wrap: true
        },

        {
          type: 'separator',

          margin: 'lg'
        },

        {
          type: 'text',

          text:
            `BN: ${parsed.bn || '-'}`,

          size: 'sm',

          margin: 'md'
        },

        {
          type: 'text',

          text:
            `Date: ${parsed.receiptDateRaw || '-'}`,

          size: 'sm',

          margin: 'sm'
        },

        {
          type: 'text',

          text:
            `HN: ${parsed.hn || '-'}`,

          size: 'sm',

          margin: 'sm'
        },

        {
          type: 'text',

          text:
            `Amount: ${formatNumber(parsed.amount)} บาท`,

          size: 'sm',

          margin: 'sm'
        },

        {
          type: 'text',

          text:
            `Discount: ${formatNumber(parsed.discount)} บาท`,

          size: 'sm',

          color: '#DC2626',

          margin: 'sm'
        },

        {
          type: 'text',

          text:
            `Discount by Doctor: ${formatNumber(parsed.discountByDoctor)} บาท`,

          size: 'sm',

          color: '#DC2626',

          margin: 'sm',

          wrap: true
        },

        {
          type: 'text',

          text:
            `Total: ${formatNumber(parsed.total)} บาท`,

          size: 'sm',

          weight: 'bold',

          margin: 'sm'
        },

        {
          type: 'text',

          text:
            `Doctor Fee: ${formatNumber(parsed.doctorFee)} บาท`,

          size: 'sm',

          margin: 'sm'
        },

        {
          type: 'text',

          text:
            `Hospital & Nursing: ${formatNumber(parsed.hospitalNursing)} บาท`,

          size: 'sm',

          margin: 'sm',

          wrap: true
        },

        {
          type: 'text',

          text:
            `Other: ${formatNumber(parsed.other)} บาท`,

          size: 'sm',

          margin: 'sm'
        },

        {
          type: 'text',

          text:
            'ต้องการส่งใบเสร็จใบถัดไปไหมครับ?',

          size: 'sm',

          color: '#0369A1',

          weight: 'bold',

          align: 'center',

          margin: 'xl',

          wrap: true
        }

      ]
    },

    footer: {

      type: 'box',

      layout: 'vertical',

      spacing: 'sm',

      contents: [

        {
          type: 'button',

          style: 'primary',

          color: '#0EA5E9',

          action: {

            type: 'message',

            label: '🧾 ส่งใบถัดไป',

            text: 'ส่งรูปถัดไป'
          }
        },

        {
          type: 'button',

          style: 'secondary',

          action: {

            type: 'message',

            label: '❌ จบการส่งเอกสาร',

            text: 'ยกเลิก'
          }
        }

      ]
    }
  }
}

// ==================================================
// ERROR FLEX
// ==================================================

function buildImageErrorFlex(
  message
) {

  return {

    type: 'bubble',

    size: 'mega',

    body: {

      type: 'box',

      layout: 'vertical',

      paddingAll: '20px',

      contents: [

        {
          type: 'text',

          text: '⚠️ ไม่สามารถบันทึกได้',

          weight: 'bold',

          size: 'xl',

          color: '#DC2626'
        },

        {
          type: 'text',

          text: message,

          size: 'sm',

          color: '#555555',

          margin: 'lg',

          wrap: true,

          align: 'center'
        }

      ]
    },

    footer: {

      type: 'box',

      layout: 'vertical',

      contents: [

        {
          type: 'button',

          style: 'secondary',

          action: {

            type: 'message',

            label: '❌ ยกเลิก',

            text: 'ยกเลิก'
          }
        }

      ]
    }
  }
}

// ==================================================
// FIND DOCTOR FROM SHEET4
// ==================================================

async function findDoctor(
  doctorID
) {

  const sheets =
    getSheetsClient()

  const response =
    await sheets.spreadsheets.values.get({

      spreadsheetId:
        SHEET_ID,

      range:
        process.env.DOCTOR_SHEET_RANGE ||
        'Sheet4!A:B',

      majorDimension:
        'ROWS'
    })

  const rows =
    response.data.values || []

  if (
    rows.length === 0
  ) {
    return null
  }

  const headers =
    rows[0].map(
      header =>
        String(header || '')
          .trim()
          .toLowerCase()
    )

  const doctorIDIndex =
    headers.indexOf(
      'doctorid'
    )

  const doctorNameIndex =
    headers.indexOf(
      'doctorname'
    )

  if (
    doctorIDIndex === -1
  ) {
    throw new Error(
      'ไม่พบ column doctorID ใน Sheet4'
    )
  }

  if (
    doctorNameIndex === -1
  ) {
    throw new Error(
      'ไม่พบ column doctorName ใน Sheet4'
    )
  }

  const searchID =
    normalizeDoctorID(
      doctorID
    )

  for (
    const row of rows.slice(1)
  ) {

    const rowDoctorID =
      normalizeDoctorID(
        row[doctorIDIndex]
      )

    if (
      rowDoctorID === searchID
    ) {

      return {

        doctorID:
          String(
            row[doctorIDIndex] || ''
          ).trim(),

        doctorName:
          String(
            row[doctorNameIndex] || ''
          ).trim()

      }
    }
  }

  return null
}

// ==================================================
// START DOCUMENT
// ==================================================

async function startDocument(
  event,
  userId,
  state,
  context
) {

  state.mode =
    'upload'

  state.step =
    'waitingEmployeeCode'

  state.employeeCode =
    ''

  state.doctorID =
    ''

  state.doctorName =
    ''

  state.waitingSince =
    Date.now()

  await context.reply(
    event.replyToken,

    buildEmployeeInputText()
  )
}

// ==================================================
// HANDLE DOCUMENT TEXT
// ==================================================

async function handleDocumentText(
  event,
  userId,
  state,
  text,
  context
) {

  const value =
    String(text || '').trim()

  // ==================================================
  // WAIT EMPLOYEE
  // ==================================================

  if (
    state.step ===
    'waitingEmployeeCode'
  ) {

    const employeeCode =
      normalizeEmployeeCode(
        value
      )

    if (
      !isValidEmployeeCode(
        employeeCode
      )
    ) {

      await context.reply(

        event.replyToken,

        '❌ รหัสพนักงานไม่ถูกต้อง\n\n' +
        'กรุณาพิมพ์รหัสพนักงานใหม่ครับ'
      )

      return true
    }

    state.employeeCode =
      employeeCode

    state.doctorID =
      ''

    state.doctorName =
      ''

    state.step =
      'waitingDoctorID'

    state.waitingSince =
      Date.now()

    await context.reply(

      event.replyToken,

      buildDoctorInputText(
        employeeCode
      )
    )

    return true
  }

  // ==================================================
  // WAIT DOCTOR
  // ==================================================

  if (
    state.step ===
    'waitingDoctorID' ||
    state.step ===
    'waitingNextDoctorID'
  ) {

    const doctorID =
      normalizeDoctorID(
        value
      )

    if (!doctorID) {

      await context.reply(

        event.replyToken,

        '❌ กรุณาพิมพ์ รหัสแพทย์ครับ'
      )

      return true
    }

    try {

      const doctor =
        await findDoctor(
          doctorID
        )

      if (!doctor) {

        await context.reply(

          event.replyToken,

          '❌ ไม่พบ รหัสแพทย์ นี้ในระบบ\n\n' +
          `รหัสแพทย์: ${doctorID}\n\n` +
          'กรุณาตรวจสอบแล้วพิมพ์ รหัสแพทย์ ใหม่ครับ'
        )

        state.waitingSince =
          Date.now()

        return true
      }

      state.doctorID =
        doctor.doctorID

      state.doctorName =
        doctor.doctorName

      state.step =
        'confirmDoctor'

      state.waitingSince =
        Date.now()

      await context.replyFlex(

        event.replyToken,

        '🩺 กรุณายืนยันข้อมูลแพทย์',

        buildDoctorConfirmFlex(

          state.employeeCode,

          state.doctorID,

          state.doctorName
        )
      )

    } catch (error) {

      console.error(
        'DOCUMENT DOCTOR QUERY ERROR:',
        error.response?.data ||
        error.message
      )

      await context.reply(

        event.replyToken,

        '⚠️ ระบบไม่สามารถตรวจสอบ รหัสแพทย์ จากระบบได้ครับ\n\n' +
        'กรุณาลองใหม่อีกครั้ง'
      )
    }

    return true
  }

  // ==================================================
  // CONFIRM DOCTOR
  // ==================================================

  if (
    state.step ===
    'confirmDoctor'
  ) {

    await context.replyFlex(

      event.replyToken,

      'กรุณากดยืนยันข้อมูลแพทย์',

      buildDoctorConfirmFlex(

        state.employeeCode,

        state.doctorID,

        state.doctorName
      )
    )

    return true
  }

  // ==================================================
  // WAIT IMAGE
  // ==================================================

  if (
    state.step ===
    'waitingImage'
  ) {

    if (
      value ===
      'ส่งรูปถัดไป'
    ) {

      state.doctorID =
        ''

      state.doctorName =
        ''

      state.step =
        'waitingNextDoctorID'

      state.waitingSince =
        Date.now()

      await context.reply(

        event.replyToken,

        buildNextDoctorInputText(
          state.employeeCode
        )
      )

      return true
    }

    await context.reply(

      event.replyToken,

      '📷 ตอนนี้ระบบกำลังรอรูปใบเสร็จครับ\n\n' +
      'กรุณาส่งรูปใบเสร็จได้เลยครับ'
    )

    return true
  }

  return false
}

// ==================================================
// HANDLE DOCUMENT POSTBACK
// ==================================================

async function handleDocumentPostback(
  event,
  userId,
  state,
  context
) {

  if (
    state.mode !== 'upload'
  ) {
    return false
  }

  const data =
    String(
      event.postback?.data || ''
    ).trim()

  // ==================================================
  // CONFIRM
  // ==================================================

  if (
    data ===
    'document_confirm:yes'
  ) {

    if (
      !state.employeeCode ||
      !state.doctorID ||
      !state.doctorName
    ) {

      await context.reply(

        event.replyToken,

        '❌ ข้อมูลไม่ครบครับ\nกรุณาเริ่มขั้นตอนใหม่'
      )

      return true
    }

    state.step =
      'waitingImage'

    state.waitingSince =
      Date.now()

    await context.reply(

      event.replyToken,

      buildReadyForImageText(
        state
      )
    )

    return true
  }

  // ==================================================
  // EDIT DOCTOR
  // ==================================================

  if (
    data ===
    'document_confirm:no'
  ) {

    state.doctorID =
      ''

    state.doctorName =
      ''

    state.step =
      'waitingDoctorID'

    state.waitingSince =
      Date.now()

    await context.reply(

      event.replyToken,

      buildDoctorInputText(
        state.employeeCode
      )
    )

    return true
  }

  return false
}

// ==================================================
// HANDLE DOCUMENT IMAGE
// ==================================================

async function handleDocumentImage(
  event,
  userId,
  state,
  context
) {

  const messageId =
    event.message?.id

  if (!messageId) {

    await context.reply(

      event.replyToken,

      '❌ ไม่พบ message ID ของรูปจาก LINE ครับ\n\n' +
      'กรุณาส่งรูปใหม่อีกครั้ง'
    )

    return true
  }

  if (
    state.mode !== 'upload' ||
    state.step !== 'waitingImage' ||
    !state.employeeCode ||
    !state.doctorID ||
    !state.doctorName
  ) {

    await context.reply(

      event.replyToken,

      '❌ ยังไม่พร้อมรับรูปครับ\n\n' +
      'กรุณากรอกรหัสพนักงาน → รหัสแพทย์ → ยืนยันข้อมูลแพทย์ก่อนครับ'
    )

    return true
  }

  if (
    isExpired(
      state.waitingSince
    )
  ) {

    resetDocumentState(
      state
    )

    await context.reply(

      event.replyToken,

      '⏱️ หมดเวลา\n\n' +
      'รอรูปเกิน 1 นาทีแล้วครับ\n' +
      'กรุณาพิมพ์ "ส่งเอกสาร" เพื่อเริ่มใหม่'
    )

    return true
  }

  try {

    // ==================================================
    // GET IMAGE FROM LINE
    // ==================================================

    const imageRes =
      await axios.get(

        `https://api-data.line.me/v2/bot/message/${messageId}/content`,

        {
          headers: {
            Authorization:
              `Bearer ${LINE_TOKEN}`
          },

          responseType:
            'arraybuffer',

          timeout: 20000
        }
      )

    // ==================================================
    // OCR
    // ==================================================

    const ocrText =
      await ocrImage(
        imageRes.data
      )

    console.log(
      'DOCUMENT OCR:',
      ocrText
    )

    if (!ocrText) {

      await context.replyFlex(

        event.replyToken,

        '❌ อ่านใบเสร็จไม่ได้',

        buildImageErrorFlex(
          'อ่านตัวอักษรจากรูปไม่ออกครับ\nกรุณาถ่ายรูปใหม่ให้ชัดขึ้น'
        )
      )

      return true
    }

    // ==================================================
    // RECEIPT VALIDATION
    // ==================================================

    const receiptText =
      String(ocrText)
        .toLowerCase()
        .replace(/\s+/g, ' ')

    const isReceipt =
      receiptText.includes(
        'receipt'
      ) &&
      receiptText.includes(
        'asoke skin hospital'
      )

    if (!isReceipt) {

      await context.replyFlex(

        event.replyToken,

        '❌ รูปไม่ใช่ใบเสร็จ',

        buildImageErrorFlex(
          'รูปนี้ไม่ใช่ใบเสร็จ Asoke Skin Hospital ที่ระบบรองรับครับ'
        )
      )

      return true
    }

    // ==================================================
    // PARSE RECEIPT
    // ==================================================

    const parsed =
      parseReceipt(
        ocrText
      )

    // ==================================================
    // ATTACH DOCUMENT DATA
    // ==================================================

    parsed.employeeCode =
      state.employeeCode

    parsed.doctorID =
      state.doctorID

    parsed.doctorName =
      state.doctorName

    parsed.amount =
      parsed.amount || ''

    parsed.discount =
      parsed.discount || ''

    parsed.discountByDoctor =
      parsed.discountByDoctor || ''

    parsed.doctorFee =
      parsed.doctorFee || ''

    parsed.hospitalNursing =
      parsed.hospitalNursing || ''

    parsed.other =
      parsed.other || ''

    // ==================================================
    // SAVE
    // ==================================================

    await sendToSheet(
      parsed
    )

    // ==================================================
    // KEEP EMPLOYEE
    // ==================================================

    state.waitingSince =
      Date.now()

    state.step =
      'waitingImage'

    // ==================================================
    // SUCCESS FLEX
    // ==================================================

    await context.replyFlex(

      event.replyToken,

      '✅ บันทึกใบเสร็จเรียบร้อย',

      buildDocumentSuccessFlex(

        state.employeeCode,

        state.doctorID,

        state.doctorName,

        parsed
      )
    )

    return true

  } catch (error) {

    console.error(
      'DOCUMENT IMAGE ERROR:',
      error.response?.data ||
      error.message
    )

    await context.reply(

      event.replyToken,

      '⚠️ เกิดข้อผิดพลาด\n\n' +
      'ระบบไม่สามารถประมวลผลใบเสร็จได้ครับ\n' +
      'กรุณาลองส่งรูปใหม่อีกครั้ง'
    )

    return true
  }
}

// ==================================================
// EXPORT
// ==================================================

module.exports = {

  startDocument,

  handleDocumentText,

  handleDocumentPostback,

  handleDocumentImage,

  buildDoctorConfirmFlex,

  buildDocumentSuccessFlex
}
