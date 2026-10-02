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
// DOCUMENT EMPLOYEE FLEX
// ==================================================

function buildDocumentEmployeeFlex() {

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

          text: '🧾 ส่งเอกสาร',

          weight: 'bold',

          size: 'xl',

          color: '#111111'
        },

        {
          type: 'text',

          text:
            'กรุณาพิมพ์รหัสพนักงานเพื่อเริ่มส่งเอกสาร',

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
          type: 'text',

          text: 'ตัวอย่างรหัสพนักงาน',

          size: 'sm',

          color: '#555555',

          margin: 'lg'
        },

        {
          type: 'text',

          text: 'A0001',

          size: 'lg',

          weight: 'bold',

          color: '#0369A1',

          margin: 'xs'
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
// DOCTOR INPUT FLEX
// ==================================================

function buildDoctorInputFlex(
  employeeCode
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

          text: '🩺 ข้อมูลแพทย์',

          weight: 'bold',

          size: 'xl',

          color: '#111111'
        },

        {
          type: 'text',

          text:
            `👤 พนักงาน: ${employeeCode}`,

          size: 'sm',

          color: '#555555',

          margin: 'md'
        },

        {
          type: 'separator',

          margin: 'lg'
        },

        {
          type: 'text',

          text:
            'กรุณาพิมพ์ Doctor ID',

          size: 'md',

          weight: 'bold',

          margin: 'lg'
        },

        {
          type: 'text',

          text:
            'ระบบจะตรวจสอบกับข้อมูลแพทย์ใน Sheet4',

          size: 'sm',

          color: '#777777',

          margin: 'sm',

          wrap: true
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

              text: '🩺 Doctor ID',

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
            'ข้อมูลถูกต้องหรือไม่ครับ?',

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

            label: '✏️ แก้ไข Doctor ID',

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
// WAITING IMAGE FLEX
// ==================================================

function buildWaitingImageFlex(
  state
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

          text: '📷 พร้อมรับใบเสร็จ',

          weight: 'bold',

          size: 'xl',

          color: '#0369A1'
        },

        {
          type: 'separator',

          margin: 'lg'
        },

        {
          type: 'text',

          text:
            `👤 พนักงาน: ${state.employeeCode}`,

          size: 'sm',

          margin: 'lg'
        },

        {
          type: 'text',

          text:
            `🩺 Doctor ID: ${state.doctorID}`,

          size: 'sm',

          margin: 'sm'
        },

        {
          type: 'text',

          text:
            `👨‍⚕️ ${state.doctorName}`,

          size: 'sm',

          weight: 'bold',

          margin: 'sm',

          wrap: true
        },

        {
          type: 'text',

          text:
            'ส่งรูปใบเสร็จได้เลยครับ\nครั้งละ 1 รูป 🧾',

          size: 'md',

          color: '#0369A1',

          weight: 'bold',

          margin: 'xl',

          align: 'center',

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

          style: 'secondary',

          action: {

            type: 'message',

            label: '❌ จบการส่ง',

            text: 'ยกเลิก'
          }
        }

      ]
    }
  }
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
            `🩺 Doctor ID: ${doctorID}`,

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
            'ส่งรูปใบเสร็จถัดไปได้เลยครับ 🧾',

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

            label: '🧾 ส่งรูปถัดไป',

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
  replyToken,
  state
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

  await replyFlex(
    replyToken,

    '🧾 ส่งเอกสาร',

    buildDocumentEmployeeFlex()
  )
}

// ==================================================
// HANDLE DOCUMENT TEXT
// ==================================================

async function handleDocumentText(
  replyToken,
  userId,
  state,
  text
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

      await replyFlex(

        replyToken,

        '❌ รหัสพนักงานไม่ถูกต้อง',

        buildImageErrorFlex(
          'รูปแบบรหัสพนักงานต้องเป็น A0001 - A2000 ครับ\nกรุณาพิมพ์รหัสใหม่อีกครั้ง'
        )
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

    await replyFlex(

      replyToken,

      '🩺 กรุณาใส่ Doctor ID',

      buildDoctorInputFlex(
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
    'waitingDoctorID'
  ) {

    const doctorID =
      normalizeDoctorID(
        value
      )

    if (!doctorID) {

      await replyFlex(

        replyToken,

        '❌ กรุณาใส่ Doctor ID',

        buildImageErrorFlex(
          'กรุณาพิมพ์ Doctor ID เพื่อให้ระบบตรวจสอบกับ Sheet4 ครับ'
        )
      )

      return true
    }

    try {

      const doctor =
        await findDoctor(
          doctorID
        )

      if (!doctor) {

        await replyFlex(

          replyToken,

          '❌ ไม่พบรหัสแพทย์',

          {
            type: 'bubble',

            size: 'mega',

            body: {

              type: 'box',

              layout: 'vertical',

              paddingAll: '20px',

              contents: [

                {
                  type: 'text',

                  text:
                    '❌ ไม่พบรหัสแพทย์',

                  weight: 'bold',

                  size: 'xl',

                  color: '#DC2626'
                },

                {
                  type: 'text',

                  text:
                    `Doctor ID: ${doctorID}`,

                  size: 'md',

                  margin: 'lg',

                  color: '#111111'
                },

                {
                  type: 'text',

                  text:
                    'ไม่พบข้อมูล Doctor ID นี้ใน Sheet4',

                  size: 'sm',

                  color: '#777777',

                  margin: 'sm',

                  wrap: true
                },

                {
                  type: 'text',

                  text:
                    'กรุณาตรวจสอบแล้วใส่ Doctor ID ใหม่ครับ',

                  size: 'sm',

                  color: '#555555',

                  margin: 'lg',

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

                  action: {

                    type: 'message',

                    label: '✏️ ใส่ Doctor ID ใหม่',

                    text: 'แก้ไข Doctor ID'
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

      await replyFlex(

        replyToken,

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

      await replyFlex(

        replyToken,

        '⚠️ ตรวจสอบ Doctor ID ไม่สำเร็จ',

        buildImageErrorFlex(
          'ระบบไม่สามารถตรวจสอบข้อมูลแพทย์จาก Sheet4 ได้ครับ\nกรุณาลองใหม่อีกครั้ง'
        )
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

    await replyFlex(

      replyToken,

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

      state.waitingSince =
        Date.now()

      await replyFlex(

        replyToken,

        '📷 พร้อมรับรูปถัดไป',

        buildWaitingImageFlex(
          state
        )
      )

      return true
    }

    await replyFlex(

      replyToken,

      '📷 รอรูปใบเสร็จ',

      buildWaitingImageFlex(
        state
      )
    )

    return true
  }

  return false
}

// ==================================================
// HANDLE DOCUMENT POSTBACK
// ==================================================

async function handleDocumentPostback(
  replyToken,
  userId,
  state,
  data
) {

  if (
    state.mode !== 'upload'
  ) {
    return false
  }

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

      await replyFlex(

        replyToken,

        '❌ ข้อมูลไม่ครบ',

        buildImageErrorFlex(
          'ข้อมูลพนักงานหรือข้อมูลแพทย์ไม่ครบครับ กรุณาเริ่มใหม่'
        )
      )

      return true
    }

    state.step =
      'waitingImage'

    state.waitingSince =
      Date.now()

    await replyFlex(

      replyToken,

      '📷 พร้อมรับใบเสร็จ',

      buildWaitingImageFlex(
        state
      )
    )

    return true
  }

  // ==================================================
  // EDIT
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

    await replyFlex(

      replyToken,

      '✏️ แก้ไข Doctor ID',

      buildDoctorInputFlex(
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
  replyToken,
  userId,
  state,
  messageId
) {

  if (
    state.mode !== 'upload' ||
    state.step !== 'waitingImage' ||
    !state.employeeCode ||
    !state.doctorID ||
    !state.doctorName
  ) {

    await replyFlex(

      replyToken,

      '❌ ยังไม่พร้อมรับรูป',

      buildImageErrorFlex(
        'กรุณาพิมพ์ "ส่งเอกสาร" แล้วกรอกรหัสพนักงานและยืนยันข้อมูลแพทย์ก่อนครับ'
      )
    )

    return true
  }

  if (
    isExpired(
      state.waitingSince
    )
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

    await replyFlex(

      replyToken,

      '⏱️ หมดเวลา',

      buildImageErrorFlex(
        'รอรูปเกิน 1 นาทีแล้วครับ\nกรุณาพิมพ์ "ส่งเอกสาร" เพื่อเริ่มใหม่'
      )
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

      await replyFlex(

        replyToken,

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

      await replyFlex(

        replyToken,

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
    // KEEP SESSION
    // ==================================================

    state.waitingSince =
      Date.now()

    // ==================================================
    // SUCCESS FLEX
    // ==================================================

    await replyFlex(

      replyToken,

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

    await replyFlex(

      replyToken,

      '⚠️ เกิดข้อผิดพลาด',

      buildImageErrorFlex(
        'ระบบไม่สามารถประมวลผลใบเสร็จได้ครับ\nกรุณาลองส่งรูปใหม่อีกครั้ง'
      )
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

  buildDocumentEmployeeFlex,

  buildDoctorConfirmFlex,

  buildWaitingImageFlex,

  buildDocumentSuccessFlex
}
