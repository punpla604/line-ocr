require('dotenv').config()

const express = require('express')
const axios = require('axios')

const sendToSheet = require('./send-to-sheet')

const {
  ocrImage,
  parseReceipt
} = require('./ocr')

const app = express()

app.use(express.json())

const LINE_TOKEN = process.env.LINE_TOKEN
const SHEET_ID = process.env.SHEET_ID
const SHEET_SECRET = process.env.SHEET_SECRET

// ==================================================
// USER STATE
// ==================================================

const userState = new Map()

function defaultState() {
  return {
    mode: 'idle',
    step: 'idle',

    // upload
    employeeCode: '',
    waitingSince: null,

    // search
    searchType: '',
    searchMonth: '',
    searchYear: '',
    searchWaitingSince: null
  }
}

function getState(userId) {
  if (!userState.has(userId)) {
    userState.set(userId, defaultState())
  }

  return userState.get(userId)
}

function resetState(userId) {
  const state = defaultState()
  userState.set(userId, state)
  return state
}

// ==================================================
// CANCEL
// ==================================================

function isCancelMessage(text) {
  const t = (text || '').trim().toLowerCase()

  return [
    'ยกเลิก',
    'cancel',
    'ออก',
    'เลิก'
  ].includes(t)
}

// ==================================================
// HELP
// ==================================================

function isHelpMessage(text) {
  const t = (text || '').trim()

  const keywords = [
    'ทำไง',
    'ส่งไง',
    'ส่งยังไง',
    'ต้องทำไง',
    'ต้องทำยังไง',
    'ทำยังไง',
    'วิธีส่ง',
    'วิธีทำ',
    'ช่วย',
    'เริ่มยังไง',
    'วิธีใช้'
  ]

  return keywords.some(k => t.includes(k))
}

// ==================================================
// EMPLOYEE CODE
// ==================================================

function normalizeEmployeeCode(text) {
  return (text || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

function isValidEmployeeCode(code) {
  if (!/^A\d{4}$/.test(code)) {
    return false
  }

  const num = parseInt(code.slice(1), 10)

  return num >= 1 && num <= 2000
}

// ==================================================
// TIMEOUT
// ==================================================

const WAIT_IMAGE_MS = 60 * 1000
const WAIT_SEARCH_MS = 60 * 1000

function isExpired(ts, ms) {
  if (!ts) {
    return false
  }

  return Date.now() - ts > ms
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
    return '0'
  }

  const text = String(value)
    .replace(/,/g, '')
    .trim()

  const num = Number(text)

  if (Number.isNaN(num)) {
    return String(value)
  }

  return num.toLocaleString('en-US')
}

// ==================================================
// FORMAT SEARCH RESULT
// ==================================================

function formatResultItem(d, index) {
  return `🧾 รายการที่ ${index + 1}

BN: ${d.bn || '-'}

HN: ${d.hn || '-'}

Name: ${d.name || '-'}

Date: ${d.dateText || d.dateShort || '-'}

Payment: ${d.paymentType || '-'}

Total: ${formatNumber(d.total)}

Doctor Fee: ${formatNumber(d.doctorFee)}

Hospital & Nursing: ${formatNumber(
    d.hospitalNursing ||
    d.hospitalNursingFee ||
    d.hospital_nursing
  )}

Other: ${formatNumber(d.other)}`
}

// ==================================================
// LINE REPLY
// ==================================================

async function reply(replyToken, text) {
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
        Authorization: `Bearer ${LINE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  )
}

// ==================================================
// QUERY GOOGLE SHEET
// ==================================================

async function querySheet(params = {}) {
  if (!SHEET_ID) {
    throw new Error('Missing env: SHEET_ID')
  }

  if (!SHEET_SECRET) {
    throw new Error('Missing env: SHEET_SECRET')
  }

  const queryParams = {
    ...params,
    sheetId: SHEET_ID,
    secret: SHEET_SECRET
  }

  console.log('SHEET QUERY:', queryParams)

  try {
    const res = await axios.get(
      process.env.SHEET_URL || '',
      {
        params: queryParams,
        timeout: 60000
      }
    )

    console.log('SHEET RESPONSE:', res.data)

    return res.data

  } catch (err) {
    console.error(
      'SHEET QUERY ERROR:',
      err.response?.data || err.message
    )

    throw err
  }
}

// ==================================================
// VALIDATE MONTH
// ==================================================

function isValidMonth(text) {
  return /^(0[1-9]|1[0-2])$/.test(text)
}

// ==================================================
// VALIDATE YEAR
// ==================================================

function isValidYear(text) {
  if (!/^\d{4}$/.test(text)) {
    return false
  }

  const currentYear = new Date().getFullYear()
  const minYear = currentYear - 5
  const year = Number(text)

  return (
    year >= minYear &&
    year <= currentYear
  )
}

// ==================================================
// YEAR RANGE
// ==================================================

function getYearRangeText() {
  const currentYear = new Date().getFullYear()
  const minYear = currentYear - 5

  return `${minYear} - ${currentYear}`
}

// ==================================================
// VALIDATE DATE
// ==================================================

function isValidDate(text) {
  const dateRegex =
    /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/

  if (!dateRegex.test(text)) {
    return false
  }

  const [day, month, year] =
    text.split('/').map(Number)

  const date = new Date(
    year,
    month - 1,
    day
  )

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}

// ==================================================
// WEBHOOK
// ==================================================

app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0]

  if (!event) {
    return res.sendStatus(200)
  }

  const userId = event.source?.userId

  if (!userId) {
    return res.sendStatus(200)
  }

  let state = getState(userId)

  try {

    // ==================================================
    // TEXT
    // ==================================================

    if (event.message?.type === 'text') {

      const text =
        (event.message.text || '').trim()

      // ==================================================
      // UPLOAD TIMEOUT
      // ==================================================

      if (
        state.mode === 'upload' &&
        state.step === 'waitingImage'
      ) {

        if (
          isExpired(
            state.waitingSince,
            WAIT_IMAGE_MS
          )
        ) {

          resetState(userId)

          await reply(
            event.replyToken,
            '⏱️ รอรูปเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะส่งใหม่ พิมพ์ "ส่งเอกสาร"'
          )

          return res.sendStatus(200)
        }
      }

      // ==================================================
      // SEARCH TIMEOUT
      // ==================================================

      if (
        state.mode === 'search' &&
        state.step !== 'idle'
      ) {

        if (
          isExpired(
            state.searchWaitingSince,
            WAIT_SEARCH_MS
          )
        ) {

          resetState(userId)

          await reply(
            event.replyToken,
            '⏱️ รอคำตอบเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะค้นหาใหม่ พิมพ์ "ค้นหา"'
          )

          return res.sendStatus(200)
        }
      }

      // ==================================================
      // CANCEL
      // ==================================================

      if (isCancelMessage(text)) {

        if (state.mode === 'idle') {

          await reply(
            event.replyToken,
            'ตอนนี้ยังไม่ได้เริ่มอะไรครับ 🙂\nพิมพ์ "ส่งเอกสาร" หรือ "ค้นหา" ได้เลย'
          )

          return res.sendStatus(200)
        }

        resetState(userId)

        await reply(
          event.replyToken,
          '❌ ยกเลิกเรียบร้อยครับ'
        )

        return res.sendStatus(200)
      }

      // ==================================================
      // HELP
      // ==================================================

      if (
        isHelpMessage(text) ||
        text === 'วิธีใช้'
      ) {

        await reply(
          event.replyToken,
          `📌 วิธีใช้งาน

🟦 ส่งเอกสาร

1) พิมพ์ "ส่งเอกสาร"

2) ใส่รหัสพนักงาน

3) ส่งรูปใบเสร็จทีละ 1 รูป

🔎 ค้นหา

1) พิมพ์ "ค้นหา"

2) ใส่รหัสพนักงาน

3) เลือกเดือน

4) เลือกปี

5) เลือกประเภท

ประเภทค้นหา:

1) BN

2) HN

3) NAME

4) DATE

DATE ตัวอย่าง:

11/02/2026

พิมพ์ "ยกเลิก" ได้ทุกขั้นตอน`
        )

        return res.sendStatus(200)
      }

      // ==================================================
      // START UPLOAD
      // ==================================================

      if (text === 'ส่งเอกสาร') {

        state = resetState(userId)

        state.mode = 'upload'
        state.step = 'waitingEmployeeCode'

        await reply(
          event.replyToken,
          '🟦 ส่งเอกสาร\nกรุณาพิมพ์รหัสพนักงานครับ 👤'
        )

        return res.sendStatus(200)
      }

      // ==================================================
      // START SEARCH
      // ==================================================

      if (text === 'ค้นหา') {

        state = resetState(userId)

        state.mode = 'search'
        state.step = 'waitingEmployeeCodeForSearch'
        state.searchWaitingSince = Date.now()

        await reply(
          event.replyToken,
          '🔎 ค้นหา\nกรุณาพิมพ์รหัสพนักงานก่อนครับ 👤'
        )

        return res.sendStatus(200)
      }

      // ==================================================
      // UPLOAD MODE
      // ==================================================

      if (state.mode === 'upload') {

        // ==================================================
        // EMPLOYEE CODE
        // ==================================================

        if (
          state.step === 'waitingEmployeeCode'
        ) {

          const code =
            normalizeEmployeeCode(text)

          if (!isValidEmployeeCode(code)) {

            await reply(
              event.replyToken,
              '❌ รหัสพนักงานไม่ถูกต้องครับ\nกรุณาพิมพ์ใหม่อีกครั้ง\nหรือพิมพ์ "ยกเลิก"'
            )

            return res.sendStatus(200)
          }

          state.employeeCode = code
          state.step = 'waitingImage'
          state.waitingSince = Date.now()

          await reply(
            event.replyToken,
            `โอเคครับ 👤 ${code}

ส่งรูปใบเสร็จมาได้เลยครับ (ทีละ 1 รูป) 🧾`
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // WAITING IMAGE
        // ==================================================

        if (
          state.step === 'waitingImage'
        ) {

          await reply(
            event.replyToken,
            'ตอนนี้รอรูปใบเสร็จอยู่นะครับ 🧾\nส่งรูปมาได้เลย หรือพิมพ์ "ยกเลิก"'
          )

          return res.sendStatus(200)
        }
      }

      // ==================================================
      // SEARCH MODE
      // ==================================================

      if (state.mode === 'search') {

        // ==================================================
        // SEARCH EMPLOYEE CODE
        // ==================================================

        if (
          state.step ===
          'waitingEmployeeCodeForSearch'
        ) {

          const code =
            normalizeEmployeeCode(text)

          if (!isValidEmployeeCode(code)) {

            await reply(
              event.replyToken,
              '❌ รหัสพนักงานไม่ถูกต้องครับ\nกรุณาพิมพ์ใหม่อีกครั้ง\nหรือพิมพ์ "ยกเลิก"'
            )

            return res.sendStatus(200)
          }

          state.employeeCode = code
          state.step = 'waitingSearchMonth'
          state.searchWaitingSince = Date.now()

          await reply(
            event.replyToken,
            `โอเคครับ 👤 ${code}

กรุณาเลือกเดือนที่ต้องการค้นหา

พิมพ์เลขเดือน 01 - 12

ตัวอย่าง:

01 = มกราคม`
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // SEARCH MONTH
        // ==================================================

        if (
          state.step === 'waitingSearchMonth'
        ) {

          const month = text.trim()

          if (month === 'แก้เดือน') {

            state.step = 'waitingSearchMonth'
            state.searchWaitingSince = Date.now()

            await reply(
              event.replyToken,
              `📅 แก้เดือน

กรุณาพิมพ์เดือน 01 - 12

ตัวอย่าง:

01 = มกราคม

หรือพิมพ์ "ยกเลิก"`
            )

            return res.sendStatus(200)
          }

          if (!isValidMonth(month)) {

            await reply(
              event.replyToken,
              '❌ เดือนไม่ถูกต้องครับ\nต้องเป็น 01 ถึง 12 เท่านั้น\nหรือพิมพ์ "ยกเลิก"'
            )

            return res.sendStatus(200)
          }

          state.searchMonth = month
          state.step = 'waitingSearchYear'
          state.searchWaitingSince = Date.now()

          await reply(
            event.replyToken,
            `📅 เดือน ${month}

กรุณาพิมพ์ปี ค.ศ. 4 หลัก

ปีที่สามารถค้นหาได้:

${getYearRangeText()}

ตัวอย่าง:

2026

ถ้าต้องการแก้เดือน พิมพ์ "แก้เดือน"`
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // SEARCH YEAR
        // ==================================================

        if (
          state.step === 'waitingSearchYear'
        ) {

          const year = text.trim()

          if (year === 'แก้ปี') {

            state.step = 'waitingSearchYear'
            state.searchWaitingSince = Date.now()

            await reply(
              event.replyToken,
              `📅 แก้ปี

กรุณาพิมพ์ปี ค.ศ. 4 หลัก

ปีที่สามารถค้นหาได้:

${getYearRangeText()}

ตัวอย่าง:

2026

หรือพิมพ์ "ยกเลิก"`
            )

            return res.sendStatus(200)
          }

          if (!isValidYear(year)) {

            const currentYear =
              new Date().getFullYear()

            const minYear =
              currentYear - 5

            await reply(
              event.replyToken,
              `❌ ปีไม่ถูกต้องครับ

ปีต้องอยู่ระหว่าง ${minYear} - ${currentYear}

ไม่สามารถเลือกปีอนาคตได้

และย้อนหลังเกิน 5 ปีไม่ได้

กรุณาพิมพ์ปีใหม่อีกครั้ง

หรือพิมพ์ "แก้เดือน"

หรือ "ยกเลิก"`
            )

            return res.sendStatus(200)
          }

          state.searchYear = year
          state.step = 'chooseSearchType'
          state.searchWaitingSince = Date.now()

          await reply(
            event.replyToken,
            `📅 ช่วงค้นหา

เดือน: ${state.searchMonth}

ปี: ${state.searchYear}

เลือกประเภทค้นหา (พิมพ์เลข):

1) BN

2) HN

3) NAME

4) DATE

ถ้าต้องการแก้เดือน พิมพ์ "แก้เดือน"

ถ้าต้องการแก้ปี พิมพ์ "แก้ปี"`
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // CHOOSE SEARCH TYPE
        // ==================================================

        if (
          state.step === 'chooseSearchType'
        ) {

          const t = text.trim()

          const map = {
            '1': 'BN',
            '2': 'HN',
            '3': 'NAME',
            '4': 'DATE'
          }

          if (!map[t]) {

            await reply(
              event.replyToken,
              '❌ กรุณาพิมพ์แค่ 1 / 2 / 3 / 4\nหรือพิมพ์ "ยกเลิก"'
            )

            return res.sendStatus(200)
          }

          state.searchType = map[t]
          state.step = 'waitingSearchValue'
          state.searchWaitingSince = Date.now()

          let hint = ''

          if (state.searchType === 'BN') {
            hint =
              'พิมพ์เลข BN เช่น L69-01-003-761'
          }

          if (state.searchType === 'HN') {
            hint =
              'พิมพ์เลข HN เช่น 01-01-26-047'
          }

          if (state.searchType === 'NAME') {
            hint =
              'พิมพ์ชื่อคนไข้'
          }

          if (state.searchType === 'DATE') {
            hint =
              'พิมพ์วันที่รูปแบบ DD/MM/YYYY เช่น 11/02/2026'
          }

          await reply(
            event.replyToken,
            `🔎 ประเภท: ${state.searchType}

เดือน: ${state.searchMonth}

ปี: ${state.searchYear}

${hint}

พิมพ์ค่าที่ต้องการค้นหาได้เลยครับ`
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // SEARCH VALUE
        // ==================================================

        if (
          state.step === 'waitingSearchValue'
        ) {

          const value = text.trim()

          const employeeCode =
            state.employeeCode

          const month =
            state.searchMonth

          const year =
            state.searchYear

          if (!value) {

            await reply(
              event.replyToken,
              '❌ ค่าว่างครับ พิมพ์ใหม่อีกครั้ง หรือพิมพ์ "ยกเลิก"'
            )

            return res.sendStatus(200)
          }

          // ==================================================
          // DATE VALIDATION
          // ==================================================

          if (
            state.searchType === 'DATE'
          ) {

            if (!isValidDate(value)) {

              await reply(
                event.replyToken,
                '❌ รูปแบบวันที่ไม่ถูกต้องครับ\nต้องเป็น DD/MM/YYYY\nตัวอย่าง 11/02/2026'
              )

              return res.sendStatus(200)
            }

            const [
              day,
              dateMonth,
              dateYear
            ] = value.split('/')

            if (
              dateMonth !== month ||
              dateYear !== year
            ) {

              await reply(
                event.replyToken,
                `❌ วันที่ไม่ตรงกับช่วงที่เลือกครับ

คุณเลือก:

เดือน ${month}

ปี ${year}

แต่วันที่ที่พิมพ์คือ:

${value}

กรุณาพิมพ์วันที่ที่อยู่ในเดือน ${month}/${year} ครับ`
              )

              return res.sendStatus(200)
            }
          }

          // ==================================================
          // COMMON SEARCH PARAMS
          // ==================================================

          const baseParams = {
            employeeCode,
            month,
            year
          }

          // ==================================================
          // BN
          // ==================================================

          if (
            state.searchType === 'BN'
          ) {

            console.log(
              'SEARCH BN:',
              {
                employeeCode,
                month,
                year,
                value
              }
            )

            const result =
              await querySheet({
                action: 'findByBN',
                ...baseParams,
                bn: value
              })

            console.log(
              'BN RESULT:',
              result
            )

            const list =
              Array.isArray(result?.list)
                ? result.list
                : []

            if (
              list.length === 0 &&
              result?.found === true &&
              result?.data
            ) {
              list.push(result.data)
            }

            resetState(userId)

            if (list.length === 0) {

              await reply(
                event.replyToken,
                `❌ ไม่พบข้อมูลครับ 😅

Employee: ${employeeCode}

Month: ${month}

Year: ${year}

BN: ${value}

ลองตรวจสอบข้อมูลอีกครั้งครับ`
              )

              return res.sendStatus(200)
            }

            const messages =
              list
                .map((d, i) =>
                  formatResultItem(d, i)
                )
                .join(
                  '\n\n--------------------\n\n'
                )

            await reply(
              event.replyToken,
              `🔎 พบทั้งหมด ${list.length} รายการ

Employee: ${employeeCode}

Month: ${month}

Year: ${year}

BN: ${value}

${messages}

พิมพ์ "ค้นหา" เพื่อค้นหาใหม่`
            )

            return res.sendStatus(200)
          }

          // ==================================================
          // HN
          // ==================================================

          if (
            state.searchType === 'HN'
          ) {

            console.log(
              'SEARCH HN:',
              {
                employeeCode,
                month,
                year,
                value
              }
            )

            const result =
              await querySheet({
                action: 'findByHN',
                ...baseParams,
                hn: value
              })

            console.log(
              'HN RESULT:',
              result
            )

            const list =
              Array.isArray(result?.list)
                ? result.list
                : []

            resetState(userId)

            if (list.length === 0) {

              await reply(
                event.replyToken,
                `❌ ไม่พบข้อมูลครับ 😅

Employee: ${employeeCode}

Month: ${month}

Year: ${year}

HN: ${value}

ลองตรวจสอบข้อมูลอีกครั้งครับ

พิมพ์ "ค้นหา" เพื่อค้นหาใหม่`
              )

              return res.sendStatus(200)
            }

            const preview =
              list
                .slice(0, 10)
                .map((d, i) =>
                  formatResultItem(d, i)
                )
                .join(
                  '\n\n--------------------\n\n'
                )

            const moreText =
              list.length > 10
                ? `\n\nแสดง 10 จาก ${list.length} รายการ`
                : ''

            await reply(
              event.replyToken,
              `🔎 พบทั้งหมด ${list.length} รายการ

Employee: ${employeeCode}

Month: ${month}

Year: ${year}

${preview}${moreText}

พิมพ์ "ค้นหา" เพื่อค้นหาใหม่`
            )

            return res.sendStatus(200)
          }

          // ==================================================
          // NAME
          // ==================================================

          if (
            state.searchType === 'NAME'
          ) {

            console.log(
              'SEARCH NAME:',
              {
                employeeCode,
                month,
                year,
                value
              }
            )

            const result =
              await querySheet({
                action: 'findByName',
                ...baseParams,
                name: value
              })

            console.log(
              'NAME RESULT:',
              result
            )

            const list =
              Array.isArray(result?.list)
                ? result.list
                : []

            resetState(userId)

            if (list.length === 0) {

              await reply(
                event.replyToken,
                `❌ ไม่พบข้อมูลครับ 😅

Employee: ${employeeCode}

Month: ${month}

Year: ${year}

NAME: ${value}

พิมพ์ "ค้นหา" เพื่อค้นหาใหม่`
              )

              return res.sendStatus(200)
            }

            const preview =
              list
                .slice(0, 10)
                .map((r, i) =>
                  formatResultItem(r, i)
                )
                .join(
                  '\n\n--------------------\n\n'
                )

            const moreText =
              list.length > 10
                ? `\n\nแสดง 10 จาก ${list.length} รายการ`
                : ''

            await reply(
              event.replyToken,
              `🔎 พบทั้งหมด ${list.length} รายการ

Employee: ${employeeCode}

Month: ${month}

Year: ${year}

NAME: ${value}

${preview}${moreText}

พิมพ์ "ค้นหา" เพื่อค้นหาใหม่`
            )

            return res.sendStatus(200)
          }

          // ==================================================
          // DATE
          // ==================================================

          if (
            state.searchType === 'DATE'
          ) {

            console.log(
              'SEARCH DATE:',
              {
                employeeCode,
                month,
                year,
                value
              }
            )

            const result =
              await querySheet({
                action: 'findByDate',
                ...baseParams,
                date: value
              })

            console.log(
              'DATE RESULT:',
              result
            )

            const list =
              Array.isArray(result?.list)
                ? result.list
                : []

            resetState(userId)

            if (list.length === 0) {

              await reply(
                event.replyToken,
                `❌ ไม่พบข้อมูลครับ 😅

Employee: ${employeeCode}

Month: ${month}

Year: ${year}

DATE: ${value}

พิมพ์ "ค้นหา" เพื่อค้นหาใหม่`
              )

              return res.sendStatus(200)
            }

            const messages =
              list
                .map((d, i) =>
                  formatResultItem(d, i)
                )
                .join(
                  '\n\n--------------------\n\n'
                )

            await reply(
              event.replyToken,
              `🔎 พบทั้งหมด ${list.length} รายการ

Employee: ${employeeCode}

Month: ${month}

Year: ${year}

DATE: ${value}

${messages}

พิมพ์ "ค้นหา" เพื่อค้นหาใหม่`
            )

            return res.sendStatus(200)
          }
        }
      }

      // ==================================================
      // DEFAULT
      // ==================================================

      await reply(
        event.replyToken,
        'พิมพ์ "ส่งเอกสาร" เพื่อส่งใบเสร็จ\nหรือพิมพ์ "ค้นหา" เพื่อค้นหาข้อมูล\nหรือพิมพ์ "วิธีใช้"'
      )

      return res.sendStatus(200)
    }

    // ==================================================
    // IMAGE
    // ==================================================

    if (
      event.message?.type === 'image'
    ) {

      if (
        state.mode !== 'upload' ||
        state.step !== 'waitingImage' ||
        !state.employeeCode
      ) {

        await reply(
          event.replyToken,
          'ก่อนส่งรูป กรุณาพิมพ์ "ส่งเอกสาร" แล้วใส่รหัสพนักงานก่อนครับ 🙂'
        )

        return res.sendStatus(200)
      }

      // ==================================================
      // IMAGE TIMEOUT
      // ==================================================

      if (
        isExpired(
          state.waitingSince,
          WAIT_IMAGE_MS
        )
      ) {

        resetState(userId)

        await reply(
          event.replyToken,
          '⏱️ รอรูปเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะส่งใหม่ พิมพ์ "ส่งเอกสาร"'
        )

        return res.sendStatus(200)
      }

      const messageId =
        event.message.id

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

            timeout:
              20000
          }
        )

      // ==================================================
      // OCR
      // ==================================================

      const ocrText =
        await ocrImage(imageRes.data)

      console.log(
        'OCR result:',
        ocrText
      )

      if (!ocrText) {

        await reply(
          event.replyToken,
          'อ่านตัวอักษรไม่ออกครับ 😅 กรุณาลองถ่ายใหม่ให้ชัดขึ้น'
        )

        return res.sendStatus(200)
      }

      // ==================================================
      // CHECK RECEIPT
      // ==================================================

      const receiptText =
        (ocrText || '')
          .toLowerCase()
          .replace(/\s+/g, ' ')

      const isReceipt =
        receiptText.includes('receipt') &&
        receiptText.includes('asoke skin hospital')

      if (!isReceipt) {

        await reply(
          event.replyToken,
          '❌ รูปนี้ไม่ใช่ใบเสร็จรูปแบบที่รองรับครับ\nกรุณาส่งใบเสร็จ Asoke Skin Hospital เท่านั้น 🧾'
        )

        return res.sendStatus(200)
      }

      // ==================================================
      // PARSE
      // ==================================================

      const parsed =
        parseReceipt(ocrText)

      parsed.employeeCode =
        state.employeeCode

      parsed.doctorFee =
        parsed.doctorFee || ''

      parsed.hospitalNursing =
        parsed.hospitalNursing || ''

      parsed.other =
        parsed.other || ''

      console.log(
        'Parsed expense:',
        {
          doctorFee:
            parsed.doctorFee,

          hospitalNursing:
            parsed.hospitalNursing,

          other:
            parsed.other
        }
      )

      // ==================================================
      // SAVE
      // ==================================================

      await sendToSheet(parsed)

      state.waitingSince =
        Date.now()

      // ==================================================
      // REPLY
      // ==================================================

      await reply(
        event.replyToken,
        `✅ บันทึกเรียบร้อยครับ

👤 รหัสพนักงาน: ${state.employeeCode}

BN: ${parsed.bn || '-'}

Date: ${parsed.receiptDateRaw || '-'}

HN: ${parsed.hn || '-'}

Total: ${formatNumber(parsed.total)}

Doctor Fee: ${formatNumber(parsed.doctorFee)}

Hospital & Nursing: ${formatNumber(parsed.hospitalNursing)}

Other: ${formatNumber(parsed.other)}

ส่งรูปต่อไปได้เลย 🧾

หรือพิมพ์ "ยกเลิก" เพื่อจบ`
      )

      return res.sendStatus(200)
    }

  } catch (err) {

    console.error(
      'WEBHOOK ERROR:',
      err.response?.data ||
      err.message
    )

    try {

      await reply(
        event.replyToken,
        '⚠️ ระบบค้นหาหรือประมวลผลเกิดข้อผิดพลาดครับ\nกรุณาลองใหม่อีกครั้ง'
      )

    } catch (replyErr) {

      console.error(
        'LINE REPLY ERROR:',
        replyErr.response?.data ||
        replyErr.message
      )
    }
  }

  return res.sendStatus(200)
})

// ==================================================
// START
// ==================================================

app.listen(
  3000,
  () => {
    console.log(
      '🚀 LINE webhook running on port 3000'
    )
  }
)