require('dotenv').config()

const express = require('express')
const axios = require('axios')
const { google } = require('googleapis')
const sendToSheet = require('./send-to-sheet')

const {
  ocrImage,
  parseReceipt
} = require('./ocr')

const {
  getMonthlySummary
} = require('./summary')

const {
  buildSummaryFlex
} = require('./summary-flex')

const {
  SEARCH_PAGE_SIZE,
  buildEmployeeConfirmFlex,
  buildMonthFlex,
  buildYearFlex,
  buildSearchTypeFlex,
  buildSearchListFlex,
  buildSearchDetailFlex
} = require('./search-flex')

const {
  verifySummaryPassword
} = require('./summary-auth')

const app = express()

app.use(express.json())

const LINE_TOKEN = process.env.LINE_TOKEN
const SHEET_ID = process.env.SHEET_ID

const GOOGLE_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL

const GOOGLE_PRIVATE_KEY =
  process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')

const WAIT_IMAGE_MS = 60 * 1000
const WAIT_SEARCH_MS = 60 * 1000

const userState = new Map()

// ==================================================
// GOOGLE SHEETS
// ==================================================

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
// STATE
// ==================================================

function defaultState() {
  return {
    mode: 'idle',
    step: 'idle',

    employeeCode: '',

    waitingSince: null,

    searchType: '',
    searchMonth: '',
    searchYear: '',
    searchWaitingSince: null,

    searchResults: [],
    searchPage: 1,
    searchTotal: 0,

    summaryMonth: '',
    summaryYear: '',
    summaryWaitingSince: null
  }
}

function getState(userId) {
  if (!userState.has(userId)) {
    userState.set(
      userId,
      defaultState()
    )
  }

  return userState.get(userId)
}

function resetState(userId) {
  const state = defaultState()

  userState.set(
    userId,
    state
  )

  return state
}

// ==================================================
// HELPERS
// ==================================================

function isCancelMessage(text) {
  const t =
    String(text || '')
      .trim()
      .toLowerCase()

  return [
    'ยกเลิก',
    'cancel',
    'ออก',
    'เลิก'
  ].includes(t)
}

function normalizeEmployeeCode(text) {
  return String(text || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

function isValidEmployeeCode(code) {
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

function isExpired(ts, ms) {
  if (!ts) {
    return false
  }

  return Date.now() - ts > ms
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

  const num = Number(text)

  if (Number.isNaN(num)) {
    return String(value)
  }

  return num.toLocaleString('en-US')
}

function isValidMonth(text) {
  return /^(0[1-9]|1[0-2])$/.test(
    String(text || '').trim()
  )
}

function isValidYear(text) {
  if (!/^\d{4}$/.test(text)) {
    return false
  }

  const currentYear =
    new Date().getFullYear()

  const minYear =
    currentYear - 5

  const year =
    Number(text)

  return (
    year >= minYear &&
    year <= currentYear
  )
}

function getYearRangeText() {
  const currentYear =
    new Date().getFullYear()

  return `${
    currentYear - 5
  } - ${currentYear}`
}

function isValidDate(text) {
  const regex =
    /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/

  if (!regex.test(text)) {
    return false
  }

  const [
    day,
    month,
    year
  ] =
    text
      .split('/')
      .map(Number)

  const date =
    new Date(
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
// LINE REPLY
// ==================================================

async function reply(
  replyToken,
  text
) {
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
// SHOW SEARCH RESULTS
// ==================================================

async function showSearchResults(
  replyToken,
  state
) {
  const list =
    Array.isArray(
      state.searchResults
    )
      ? state.searchResults
      : []

  if (list.length === 0) {
    await reply(
      replyToken,

      `❌ ไม่พบข้อมูลครับ 😅

Employee: ${state.employeeCode}
Month: ${state.searchMonth}
Year: ${state.searchYear}

พิมพ์ "ค้นหา" เพื่อค้นหาใหม่`
    )

    return
  }

  await replyFlex(
    replyToken,

    `รายการเอกสาร ${list.length} รายการ`,

    buildSearchListFlex(state)
  )
}

// ==================================================
// SHOW SEARCH DETAIL
// ==================================================

async function showSearchDetail(
  replyToken,
  state,
  index
) {
  const list =
    Array.isArray(
      state.searchResults
    )
      ? state.searchResults
      : []

  const item =
    list[index]

  if (!item) {
    await reply(
      replyToken,
      '⚠️ ไม่พบรายการนี้แล้วครับ\nกรุณากลับไปค้นหาใหม่'
    )

    return
  }

  await replyFlex(
    replyToken,

    `รายละเอียดรายการที่ ${index + 1}`,

    buildSearchDetailFlex(
      item,
      index,
      state.searchPage || 1
    )
  )
}

// ==================================================
// QUERY GOOGLE SHEET
// ==================================================

async function querySheet(params = {}) {
  const sheets =
    getSheetsClient()

  const action =
    String(
      params.action || ''
    ).trim()

  const employeeCode =
    String(
      params.employeeCode || ''
    ).trim()

  const month =
    String(
      params.month || ''
    ).trim()

  const year =
    String(
      params.year || ''
    ).trim()

  const bn =
    String(
      params.bn || ''
    ).trim()

  const hn =
    String(
      params.hn || ''
    ).trim()

  const name =
    String(
      params.name || ''
    ).trim()

  const date =
    String(
      params.date || ''
    ).trim()

  console.log(
    'GOOGLE SHEET QUERY:',
    {
      action,
      employeeCode,
      month,
      year,
      bn,
      hn,
      name,
      date
    }
  )

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,

      range:
        process.env.SHEET_RANGE ||
        'Sheet1!A:Z',

      majorDimension: 'ROWS'
    })

  const rows =
    response.data.values || []

  if (rows.length === 0) {
    return {
      found: false,
      list: []
    }
  }

  const headers =
    rows[0].map(header =>
      String(header || '')
        .trim()
        .toLowerCase()
    )

  const dataRows =
    rows.slice(1)

  function getColumn(
    row,
    possibleNames
  ) {
    for (
      const possibleName of possibleNames
    ) {
      const index =
        headers.indexOf(
          String(possibleName)
            .trim()
            .toLowerCase()
        )

      if (index !== -1) {
        return String(
          row[index] || ''
        ).trim()
      }
    }

    return ''
  }

  function rowToObject(row) {
    return {
      employeeCode:
        getColumn(row, [
          'employeecode',
          'employee code',
          'employee',
          'รหัสพนักงาน'
        ]),

      bn:
        getColumn(row, [
          'bn',
          'receiptno',
          'receipt no'
        ]),

      dateText:
        getColumn(row, [
          'datetext',
          'date text',
          'date',
          'receiptdate',
          'receipt date'
        ]),

      date:
        getColumn(row, [
          'datetext',
          'date text',
          'date',
          'receiptdate',
          'receipt date'
        ]),

      time:
        getColumn(row, [
          'timetext',
          'time text',
          'time'
        ]),

      hn:
        getColumn(row, ['hn']),

      name:
        getColumn(row, [
          'name',
          'patientname',
          'patient name',
          'ชื่อ'
        ]),

      paymentType:
        getColumn(row, [
          'paymenttype',
          'payment type',
          'payment'
        ]),

      vat:
        getColumn(row, ['vat']),

      amount:
        getColumn(row, [
          'amount'
        ]),

      discount:
        getColumn(row, [
          'discount'
        ]),

      discountByDoctor:
        getColumn(row, [
          'discountbydoctor',
          'discount by doctor',
          'discount_by_doctor'
        ]),

      total:
        getColumn(row, [
          'total'
        ]),

      doctorFee:
        getColumn(row, [
          'doctorfee',
          'doctor fee'
        ]),


      hospitalNursing:
        getColumn(row, [
          'hospital&nursing',
          'hospital & nursing',
          'hospitalnursing',
          'hospital nursing',
          'hospital and nursing service'
        ]),

      other:
        getColumn(row, ['other']),

      itemJson:
        getColumn(row, [
          'itemjson',
          'item json'
        ]),

      raw:
        getColumn(row, ['raw']),

      month: '',
      year: ''
    }
  }

  const data =
    dataRows.map(row =>
      rowToObject(row)
    )

  function normalizeText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
  }

  function getRowMonthYear(item) {
    const rawDate =
      String(
        item.dateText ||
        item.date ||
        ''
      ).trim()

    let match =
      rawDate.match(
        /^(\d{4})-(\d{1,2})-(\d{1,2})$/
      )

    if (match) {
      return {
        year: match[1],
        month:
          String(match[2])
            .padStart(2, '0')
      }
    }

    match =
      rawDate.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
      )

    if (match) {
      return {
        year: match[3],
        month:
          String(match[2])
            .padStart(2, '0')
      }
    }

    const parsedDate =
      new Date(rawDate)

    if (
      !Number.isNaN(
        parsedDate.getTime()
      )
    ) {
      return {
        year:
          String(
            parsedDate.getFullYear()
          ),

        month:
          String(
            parsedDate.getMonth() + 1
          ).padStart(2, '0')
      }
    }

    return {
      year:
        String(item.year || '')
          .trim(),

      month:
        String(item.month || '')
          .trim()
          .padStart(2, '0')
    }
  }

  let filtered =
    data.filter(item => {

      if (
        employeeCode &&
        normalizeText(
          item.employeeCode
        ) !==
          normalizeText(
            employeeCode
          )
      ) {
        return false
      }

      if (month || year) {
        const rowDate =
          getRowMonthYear(item)

        if (
          month &&
          rowDate.month !==
            String(month)
              .padStart(2, '0')
        ) {
          return false
        }

        if (
          year &&
          rowDate.year !==
            String(year)
        ) {
          return false
        }
      }

      return true
    })

  if (
    action === 'findByBN'
  ) {
    filtered =
      filtered.filter(item =>
        normalizeText(item.bn) ===
        normalizeText(bn)
      )
  }

  if (
    action === 'findByHN'
  ) {
    filtered =
      filtered.filter(item =>
        normalizeText(item.hn) ===
        normalizeText(hn)
      )
  }

  if (
    action === 'findByName'
  ) {
    filtered =
      filtered.filter(item =>
        normalizeText(item.name)
          .includes(
            normalizeText(name)
          )
      )
  }

  if (
    action === 'findByDate'
  ) {
    filtered =
      filtered.filter(item => {

        const sheetDate =
          normalizeText(
            item.dateText ||
            item.date
          )

        if (
          sheetDate ===
          normalizeText(date)
        ) {
          return true
        }

        const parsed =
          new Date(
            item.dateText ||
            item.date
          )

        if (
          Number.isNaN(
            parsed.getTime()
          )
        ) {
          return false
        }

        const day =
          String(
            parsed.getDate()
          ).padStart(2, '0')

        const monthValue =
          String(
            parsed.getMonth() + 1
          ).padStart(2, '0')

        const yearValue =
          String(
            parsed.getFullYear()
          )

        return (
          `${day}/${monthValue}/${yearValue}` ===
          date
        )
      })
  }

  return {
    found:
      filtered.length > 0,

    list:
      filtered
  }
}

// ==================================================
// WEBHOOK
// ==================================================

app.post(
  '/webhook',
  async (req, res) => {

    const event =
      req.body.events?.[0]

    if (!event) {
      return res.sendStatus(200)
    }

    const userId =
      event.source?.userId

    if (!userId) {
      return res.sendStatus(200)
    }

    let state =
      getState(userId)

    try {

      // ==================================================
      // POSTBACK
      // ==================================================

      if (
        event.type === 'postback'
      ) {

        const data =
          String(
            event.postback?.data || ''
          ).trim()

        console.log(
          'POSTBACK:',
          data
        )

        // --------------------------------------------------
        // NO OP
        // --------------------------------------------------

        if (
          data === 'search_noop'
        ) {
          return res.sendStatus(200)
        }

        // --------------------------------------------------
        // SEARCH CHOOSE MONTH
        // --------------------------------------------------

        if (
          data === 'search_choose_month'
        ) {

          if (
            state.mode !== 'search'
          ) {
            await reply(
              event.replyToken,
              '⏱️ session การค้นหาหมดอายุแล้วครับ\nพิมพ์ "ค้นหา" เพื่อเริ่มใหม่'
            )

            return res.sendStatus(200)
          }

          state.step =
            'waitingSearchMonth'

          state.searchWaitingSince =
            Date.now()

          await replyFlex(
            event.replyToken,
            '📅 กรุณาเลือกเดือน',
            buildMonthFlex('search')
          )

          return res.sendStatus(200)
        }

        // --------------------------------------------------
        // SEARCH MONTH
        // --------------------------------------------------

        if (
          data.startsWith(
            'search_month:'
          )
        ) {

          if (
            state.mode !== 'search'
          ) {
            await reply(
              event.replyToken,
              '⏱️ session การค้นหาหมดอายุแล้วครับ\nพิมพ์ "ค้นหา" เพื่อเริ่มใหม่'
            )

            return res.sendStatus(200)
          }

          const month =
            data.split(':')[1]

          if (
            !isValidMonth(month)
          ) {
            return res.sendStatus(200)
          }

          state.searchMonth =
            month

          state.step =
            'waitingSearchYear'

          state.searchWaitingSince =
            Date.now()

          await replyFlex(
            event.replyToken,

            `📅 เดือน ${month}\nกรุณาเลือกปี`,

            buildYearFlex('search')
          )

          return res.sendStatus(200)
        }

        // --------------------------------------------------
        // SEARCH YEAR
        // --------------------------------------------------

        if (
          data.startsWith(
            'search_year:'
          )
        ) {

          if (
            state.mode !== 'search'
          ) {
            await reply(
              event.replyToken,
              '⏱️ session การค้นหาหมดอายุแล้วครับ\nพิมพ์ "ค้นหา" เพื่อเริ่มใหม่'
            )

            return res.sendStatus(200)
          }

          const year =
            data.split(':')[1]

          if (
            !isValidYear(year)
          ) {
            return res.sendStatus(200)
          }

          state.searchYear =
            year

          state.step =
            'chooseSearchType'

          state.searchWaitingSince =
            Date.now()

          await replyFlex(
            event.replyToken,

            `📅 ${state.searchMonth}/${state.searchYear}\nเลือกประเภทการค้นหา`,

            buildSearchTypeFlex()
          )

          return res.sendStatus(200)
        }

        // --------------------------------------------------
        // SEARCH TYPE
        // --------------------------------------------------

        if (
          data.startsWith(
            'search_type:'
          )
        ) {

          if (
            state.mode !== 'search'
          ) {
            return res.sendStatus(200)
          }

          const searchType =
            data.split(':')[1]

          const allowedTypes = [
            'BN',
            'HN',
            'NAME',
            'DATE'
          ]

          if (
            !allowedTypes.includes(
              searchType
            )
          ) {
            return res.sendStatus(200)
          }

          state.searchType =
            searchType

          state.step =
            'waitingSearchValue'

          state.searchWaitingSince =
            Date.now()

          let hint = ''

          if (
            searchType === 'BN'
          ) {
            hint =
              'พิมพ์เลข BN เช่น L69-01-003-761'
          }

          if (
            searchType === 'HN'
          ) {
            hint =
              'พิมพ์เลข HN เช่น 01-01-26-047'
          }

          if (
            searchType === 'NAME'
          ) {
            hint =
              'พิมพ์ชื่อคนไข้'
          }

          if (
            searchType === 'DATE'
          ) {
            hint =
              'พิมพ์วันที่ DD/MM/YYYY เช่น 11/02/2026'
          }

          await reply(
            event.replyToken,

            `🔎 ประเภท: ${searchType}

👤 Employee: ${state.employeeCode}

📅 เดือน: ${state.searchMonth}
📅 ปี: ${state.searchYear}

${hint}

พิมพ์ค่าที่ต้องการค้นหาได้เลยครับ`
          )

          return res.sendStatus(200)
        }

        // --------------------------------------------------
        // SEARCH DISABLED
        // --------------------------------------------------

        if (
          data === 'search_disabled'
        ) {
          return res.sendStatus(200)
        }

        // --------------------------------------------------
        // SEARCH PAGE
        // --------------------------------------------------

        if (
          data.startsWith(
            'search_page:'
          )
        ) {

          if (
            state.mode !== 'search'
          ) {
            return res.sendStatus(200)
          }

          const page =
            Number(
              data.split(':')[1]
            )

          if (
            !Number.isInteger(page) ||
            page < 1
          ) {
            return res.sendStatus(200)
          }

          const total =
            Array.isArray(
              state.searchResults
            )
              ? state.searchResults.length
              : 0

          const totalPages =
            Math.max(
              1,
              Math.ceil(
                total /
                SEARCH_PAGE_SIZE
              )
            )

          if (
            page > totalPages
          ) {
            return res.sendStatus(200)
          }

          state.searchPage =
            page

          state.searchWaitingSince =
            Date.now()

          await showSearchResults(
            event.replyToken,
            state
          )

          return res.sendStatus(200)
        }


        // --------------------------------------------------
        // SEARCH DETAIL
        // --------------------------------------------------

        if (
          data.startsWith(
            'search_detail:'
          )
        ) {

          if (
            state.mode !== 'search'
          ) {
            return res.sendStatus(200)
          }

          const index =
            Number(
              data.split(':')[1]
            )

          if (
            !Number.isInteger(index) ||
            index < 0
          ) {
            return res.sendStatus(200)
          }

          state.searchWaitingSince =
            Date.now()

          await showSearchDetail(
            event.replyToken,
            state,
            index
          )

          return res.sendStatus(200)
        }

        // --------------------------------------------------
        // SUMMARY MONTH
        // --------------------------------------------------

        if (
          data.startsWith(
            'summary_month:'
          )
        ) {

          if (
            state.mode !== 'summary'
          ) {
            return res.sendStatus(200)
          }

          const month =
            data.split(':')[1]

          if (
            !isValidMonth(month)
          ) {
            return res.sendStatus(200)
          }

          state.summaryMonth =
            month

          state.step =
            'waitingSummaryYear'

          state.summaryWaitingSince =
            Date.now()

          await replyFlex(
            event.replyToken,

            `📅 เดือน ${month}\nกรุณาเลือกปี`,

            buildYearFlex('summary')
          )

          return res.sendStatus(200)
        }

        // --------------------------------------------------
        // SUMMARY YEAR
        // --------------------------------------------------

        if (
          data.startsWith(
            'summary_year:'
          )
        ) {

          if (
            state.mode !== 'summary'
          ) {
            return res.sendStatus(200)
          }

          const year =
            data.split(':')[1]

          if (
            !isValidYear(year)
          ) {
            return res.sendStatus(200)
          }

          const month =
            state.summaryMonth

          state.summaryYear =
            year

          state.summaryWaitingSince =
            Date.now()

          try {

            console.log(
              'SUMMARY REQUEST:',
              {
                month,
                year
              }
            )

            const summary =
              await getMonthlySummary(
                month,
                year
              )

            console.log(
              'SUMMARY RESULT:',
              summary
            )

            resetState(userId)

            if (
              Number(
                summary?.count || 0
              ) === 0
            ) {

              await reply(
                event.replyToken,

                `📊 สรุปยอดรวม

เดือน: ${month}
ปี: ${year}

❌ ไม่พบข้อมูลในเดือนนี้ครับ

ลองตรวจสอบเดือน / ปีอีกครั้งครับ

พิมพ์ "สรุปยอดรวม" เพื่อค้นหาใหม่`
              )

              return res.sendStatus(200)
            }

            await replyFlex(
              event.replyToken,

              `📊 สรุปยอดรวม ${month}/${year}`,

              buildSummaryFlex(
                summary,
                month,
                year
              )
            )

            return res.sendStatus(200)

          } catch (summaryError) {

            console.error(
              'SUMMARY ERROR:',
              summaryError.response?.data ||
              summaryError.message
            )

            resetState(userId)

            await reply(
              event.replyToken,

              '⚠️ ไม่สามารถคำนวณสรุปยอดได้ครับ\nกรุณาลองใหม่อีกครั้ง'
            )

            return res.sendStatus(200)
          }
        }

        return res.sendStatus(200)
      }

      // ==================================================
      // TEXT
      // ==================================================

      if (
        event.message?.type === 'text'
      ) {

        const text =
          String(
            event.message.text || ''
          ).trim()

        // --------------------------------------------------
        // TIMEOUT
        // --------------------------------------------------

        if (
          state.mode === 'upload' &&
          state.step === 'waitingImage' &&
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

        if (
          state.mode === 'search' &&
          state.step !== 'idle' &&
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

        if (
          state.mode === 'summary' &&
          state.step !== 'idle' &&
          isExpired(
            state.summaryWaitingSince,
            WAIT_SEARCH_MS
          )
        ) {

          resetState(userId)

          await reply(
            event.replyToken,

            '⏱️ รอคำตอบเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะสรุปยอดใหม่ พิมพ์ "สรุปยอดรวม"'
          )

          return res.sendStatus(200)
        }

        // --------------------------------------------------
        // CANCEL
        // --------------------------------------------------

        if (
          isCancelMessage(text)
        ) {

          if (
            state.mode === 'idle'
          ) {

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

        // --------------------------------------------------
        // START UPLOAD
        // --------------------------------------------------

        if (
          text === 'ส่งเอกสาร'
        ) {

          state =
            resetState(userId)

          state.mode =
            'upload'

          state.step =
            'waitingEmployeeCode'

          await reply(
            event.replyToken,

            '🟦 ส่งเอกสาร\nกรุณาพิมพ์รหัสพนักงานครับ 👤'
          )

          return res.sendStatus(200)
        }

        // --------------------------------------------------
        // START SEARCH
        // --------------------------------------------------

        if (
          text === 'ค้นหา'
        ) {

          state =
            resetState(userId)

          state.mode =
            'search'

          state.step =
            'waitingEmployeeCodeForSearch'

          state.searchWaitingSince =
            Date.now()

          await reply(
            event.replyToken,

            '🔎 ค้นหา\nกรุณาพิมพ์รหัสพนักงานก่อนครับ 👤'
          )

          return res.sendStatus(200)
        }

        // --------------------------------------------------
        // START SUMMARY
        // --------------------------------------------------

        if (
          text === 'สรุปยอดรวม'
        ) {

          const auth =
            await require('./summary-auth')
              .checkUser(userId)

          if (
            auth.locked
          ) {

            await reply(
              event.replyToken,

              '🔒 บัญชีนี้ถูกล็อกไม่ให้เข้าดูสรุปยอดรวมแล้วครับ\nกรุณาติดต่อผู้ดูแลระบบ'
            )

            return res.sendStatus(200)
          }

          state =
            resetState(userId)

          state.mode =
            'summary'

          state.step =
            'waitingSummaryPassword'

          state.summaryWaitingSince =
            Date.now()

          await reply(
            event.replyToken,

            '🔐 สรุปยอดรวม\n\nกรุณาใส่รหัสผ่านเพื่อดำเนินการต่อครับ'
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // UPLOAD MODE
        // ==================================================

        if (
          state.mode === 'upload'
        ) {

          if (
            state.step ===
            'waitingEmployeeCode'
          ) {

            const code =
              normalizeEmployeeCode(text)

            if (
              !isValidEmployeeCode(code)
            ) {

              await reply(
                event.replyToken,

                '❌ รหัสพนักงานไม่ถูกต้องครับ\nกรุณาพิมพ์ใหม่อีกครั้ง\nหรือพิมพ์ "ยกเลิก"'
              )

              return res.sendStatus(200)
            }

            state.employeeCode =
              code

            state.step =
              'waitingImage'

            state.waitingSince =
              Date.now()

            await reply(
              event.replyToken,

              `โอเคครับ 👤 ${code}

ส่งรูปใบเสร็จมาได้เลยครับ (ทีละ 1 รูป) 🧾`
            )

            return res.sendStatus(200)
          }

          if (
            state.step ===
            'waitingImage'
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

        if (
          state.mode === 'search'
        ) {

          if (
            state.step ===
            'waitingEmployeeCodeForSearch'
          ) {

            const code =
              normalizeEmployeeCode(text)

            if (
              !isValidEmployeeCode(code)
            ) {

              await reply(
                event.replyToken,

                '❌ รหัสพนักงานไม่ถูกต้องครับ\nกรุณาพิมพ์ใหม่อีกครั้ง\nหรือพิมพ์ "ยกเลิก"'
              )

              return res.sendStatus(200)
            }

            state.employeeCode =
              code

            state.step =
              'waitingSearchMonth'

            state.searchWaitingSince =
              Date.now()

            await replyFlex(
              event.replyToken,

              `เลือกรหัสพนักงาน ${code}`,

              buildEmployeeConfirmFlex(
                code
              )
            )

            return res.sendStatus(200)
          }

          if (
            state.step ===
            'waitingSearchMonth'
          ) {

            const month =
              text.trim()

            if (
              month === 'แก้เดือน'
            ) {

              await replyFlex(
                event.replyToken,

                '📅 เลือกเดือนใหม่',

                buildMonthFlex('search')
              )

              state.searchWaitingSince =
                Date.now()

              return res.sendStatus(200)
            }

            if (
              !isValidMonth(month)
            ) {

              await reply(
                event.replyToken,

                '❌ เดือนไม่ถูกต้องครับ\nต้องเป็น 01 ถึง 12 เท่านั้น\nหรือพิมพ์ "ยกเลิก"'
              )

              return res.sendStatus(200)
            }

            state.searchMonth =
              month

            state.step =
              'waitingSearchYear'

            state.searchWaitingSince =
              Date.now()

            await replyFlex(
              event.replyToken,

              `📅 เดือน ${month}\nกรุณาเลือกปี`,

              buildYearFlex('search')
            )

            return res.sendStatus(200)
          }

          if (
            state.step ===
            'waitingSearchYear'
          ) {

            const year =
              text.trim()

            if (
              year === 'แก้ปี'
            ) {

              await replyFlex(
                event.replyToken,

                '📅 เลือกปีใหม่',

                buildYearFlex('search')
              )

              state.searchWaitingSince =
                Date.now()

              return res.sendStatus(200)
            }

            if (
              !isValidYear(year)
            ) {

              await reply(
                event.replyToken,

                `❌ ปีไม่ถูกต้องครับ

ปีต้องอยู่ระหว่าง ${getYearRangeText()}

ไม่สามารถเลือกปีอนาคตได้
และย้อนหลังเกิน 5 ปีไม่ได้

กรุณาพิมพ์ปีใหม่อีกครั้ง`
              )

              return res.sendStatus(200)
            }

            state.searchYear =
              year

            state.step =
              'chooseSearchType'

            state.searchWaitingSince =
              Date.now()

            await replyFlex(
              event.replyToken,

              `📅 ${state.searchMonth}/${state.searchYear}\nเลือกประเภทการค้นหา`,

              buildSearchTypeFlex()
            )

            return res.sendStatus(200)
          }

          if (
            state.step ===
            'chooseSearchType'
          ) {

            const map = {
              '1': 'BN',
              '2': 'HN',
              '3': 'NAME',
              '4': 'DATE'
            }

            const type =
              map[text.trim()]

            if (!type) {

              await reply(
                event.replyToken,

                '❌ กรุณาพิมพ์ 1 / 2 / 3 / 4 หรือใช้ปุ่มเลือกประเภทการค้นหา'
              )

              return res.sendStatus(200)
            }

            state.searchType =
              type

            state.step =
              'waitingSearchValue'

            state.searchWaitingSince =
              Date.now()

            let hint = ''

            if (type === 'BN') {
              hint =
                'พิมพ์เลข BN เช่น L69-01-003-761'
            }

            if (type === 'HN') {
              hint =
                'พิมพ์เลข HN เช่น 01-01-26-047'
            }

            if (type === 'NAME') {
              hint =
                'พิมพ์ชื่อคนไข้'
            }

            if (type === 'DATE') {
              hint =
                'พิมพ์วันที่ DD/MM/YYYY เช่น 11/02/2026'
            }

            await reply(
              event.replyToken,

              `🔎 ประเภท: ${type}

เดือน: ${state.searchMonth}
ปี: ${state.searchYear}

${hint}

พิมพ์ค่าที่ต้องการค้นหาได้เลยครับ`
            )

            return res.sendStatus(200)
          }

          if (
            state.step ===
            'waitingSearchValue'
          ) {

            const value =
              text.trim()

            if (!value) {

              await reply(
                event.replyToken,

                '❌ ค่าว่างครับ พิมพ์ใหม่อีกครั้ง หรือพิมพ์ "ยกเลิก"'
              )

              return res.sendStatus(200)
            }

            if (
              state.searchType ===
              'DATE'
            ) {

              if (
                !isValidDate(value)
              ) {

                await reply(
                  event.replyToken,

                  '❌ รูปแบบวันที่ไม่ถูกต้องครับ\nต้องเป็น DD/MM/YYYY\nตัวอย่าง 11/02/2026'
                )

                return res.sendStatus(200)
              }

              const [
                ,
                dateMonth,
                dateYear
              ] =
                value.split('/')

              if (
                dateMonth !==
                  state.searchMonth ||
                dateYear !==
                  state.searchYear
              ) {

                await reply(
                  event.replyToken,

                  `❌ วันที่ไม่ตรงกับช่วงที่เลือกครับ

คุณเลือก:
เดือน ${state.searchMonth}
ปี ${state.searchYear}

แต่วันที่ที่พิมพ์คือ:
${value}`
                )

                return res.sendStatus(200)
              }
            }

            const baseParams = {
              employeeCode:
                state.employeeCode,

              month:
                state.searchMonth,

              year:
                state.searchYear
            }

            let result = null

            if (
              state.searchType === 'BN'
            ) {

              result =
                await querySheet({
                  action: 'findByBN',
                  ...baseParams,
                  bn: value
                })

            } else if (
              state.searchType === 'HN'
            ) {

              result =
                await querySheet({
                  action: 'findByHN',
                  ...baseParams,
                  hn: value
                })

            } else if (
              state.searchType === 'NAME'
            ) {

              result =
                await querySheet({
                  action: 'findByName',
                  ...baseParams,
                  name: value
                })

            } else if (
              state.searchType === 'DATE'
            ) {

              result =
                await querySheet({
                  action: 'findByDate',
                  ...baseParams,
                  date: value
                })
            }

            const list =
              Array.isArray(
                result?.list
              )
                ? result.list
                : []

            state.searchResults =
              list

            state.searchTotal =
              list.length

            state.searchPage =
              1

            state.searchWaitingSince =
              Date.now()

            await showSearchResults(
              event.replyToken,
              state
            )

            return res.sendStatus(200)
          }
        }

        // ==================================================
        // SUMMARY MODE
        // ==================================================

        if (
          state.mode === 'summary'
        ) {

          // ------------------------------------------------
          // SUMMARY PASSWORD
          // ------------------------------------------------

          if (
            state.step ===
            'waitingSummaryPassword'
          ) {

            const password =
              text.trim()

            try {

              const result =
                await verifySummaryPassword(
                  userId,
                  password
                )

              if (
                result.locked
              ) {

                resetState(userId)

                await reply(
                  event.replyToken,

                  '❌ รหัสผ่านไม่ถูกต้องครบ 3 ครั้ง\n\n🔒 บัญชีนี้ถูกล็อกไม่ให้เข้าดูสรุปยอดรวมแล้วครับ\nกรุณาติดต่อผู้ดูแลระบบ'
                )

                return res.sendStatus(200)
              }

              if (
                result.success
              ) {

                state.step =
                  'waitingSummaryMonth'

                state.summaryWaitingSince =
                  Date.now()

                await replyFlex(
                  event.replyToken,

                  '📊 กรุณาเลือกเดือน',

                  buildMonthFlex('summary')
                )

                return res.sendStatus(200)
              }

              await reply(
                event.replyToken,

                `❌ รหัสผ่านไม่ถูกต้องครับ

เหลือโอกาสอีก ${result.remaining} ครั้ง

กรุณาลองใหม่อีกครั้ง
หรือพิมพ์ "ยกเลิก"`
              )

              return res.sendStatus(200)

            } catch (authError) {

              console.error(
                'SUMMARY AUTH ERROR:',
                authError.response?.data ||
                authError.message
              )

              await reply(
                event.replyToken,

                '⚠️ ไม่สามารถตรวจสอบสิทธิ์ได้ครับ\nกรุณาลองใหม่อีกครั้ง'
              )

              return res.sendStatus(200)
            }
          }

          // ------------------------------------------------
          // SUMMARY MONTH FROM TEXT
          // ------------------------------------------------

          if (
            state.step ===
            'waitingSummaryMonth'
          ) {

            const month =
              text.trim()

            if (
              !isValidMonth(month)
            ) {

              await replyFlex(
                event.replyToken,

                '📊 กรุณาเลือกเดือน',

                buildMonthFlex('summary')
              )

              return res.sendStatus(200)
            }

            state.summaryMonth =
              month

            state.step =
              'waitingSummaryYear'

            state.summaryWaitingSince =
              Date.now()

            await replyFlex(
              event.replyToken,

              `📅 เดือน ${month}\nกรุณาเลือกปี`,

              buildYearFlex('summary')
            )

            return res.sendStatus(200)
          }

          // ------------------------------------------------
          // SUMMARY YEAR FROM TEXT
          // ------------------------------------------------

          if (
            state.step ===
            'waitingSummaryYear'
          ) {

            const year =
              text.trim()

            if (
              !isValidYear(year)
            ) {

              await replyFlex(
                event.replyToken,

                '📊 กรุณาเลือกปี',

                buildYearFlex('summary')
              )

              return res.sendStatus(200)
            }

            state.summaryYear =
              year

            await processSummary(
              event.replyToken,
              userId,
              state.summaryMonth,
              state.summaryYear
            )

            return res.sendStatus(200)
          }
        }

        // ==================================================
        // DEFAULT
        // ==================================================

        await reply(
          event.replyToken,

          `👋 สวัสดีครับ

📌 เลือกเมนูที่ต้องการได้เลย

🧾 "ส่งเอกสาร"
สำหรับส่งใบเสร็จเข้าระบบ

🔎 "ค้นหา"
สำหรับค้นหาข้อมูลใบเสร็จ

📊 "สรุปยอดรวม"
สำหรับดูยอดรวม`
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

        const ocrText =
          await ocrImage(
            imageRes.data
          )

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

        const receiptText =
          String(ocrText)
            .toLowerCase()
            .replace(
              /\s+/g,
              ' '
            )

        const isReceipt =
          receiptText.includes(
            'receipt'
          ) &&
          receiptText.includes(
            'asoke skin hospital'
          )

        if (!isReceipt) {

          await reply(
            event.replyToken,

            '❌ รูปนี้ไม่ใช่ใบเสร็จรูปแบบที่รองรับครับ\nกรุณาส่งใบเสร็จ Asoke Skin Hospital เท่านั้น 🧾'
          )

          return res.sendStatus(200)
        }

        const parsed =
          parseReceipt(
            ocrText
          )

        parsed.employeeCode =
          state.employeeCode
          
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

        await sendToSheet(
          parsed
        )

        state.waitingSince =
          Date.now()

        await reply(
          event.replyToken,

          `✅ บันทึกเรียบร้อยครับ

👤 รหัสพนักงาน: ${state.employeeCode}

BN: ${parsed.bn || '-'}

Date: ${parsed.receiptDateRaw || '-'}

HN: ${parsed.hn || '-'}

Amount: ${formatNumber(parsed.amount)}

Discount: ${formatNumber(parsed.discount)}

Discount by Doctor: ${formatNumber(parsed.discountByDoctor)}

Total: ${formatNumber(parsed.total)}

Doctor Fee: ${formatNumber(parsed.doctorFee)}

Hospital & Nursing: ${formatNumber(parsed.hospitalNursing)}

Other: ${formatNumber(parsed.other)}

ส่งรูปต่อไปได้เลย 🧾

หรือพิมพ์ "ยกเลิก" เพื่อจบ`
        )

        return res.sendStatus(200)
      }

      return res.sendStatus(200)

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

      return res.sendStatus(200)
    }
  }
)

// ==================================================
// SUMMARY PROCESS
// ==================================================

async function processSummary(
  replyToken,
  userId,
  month,
  year
) {

  try {

    console.log(
      'SUMMARY REQUEST:',
      {
        month,
        year
      }
    )

    const summary =
      await getMonthlySummary(
        month,
        year
      )

    console.log(
      'SUMMARY RESULT:',
      summary
    )

    resetState(userId)

    if (
      Number(
        summary?.count || 0
      ) === 0
    ) {

      await reply(
        replyToken,

        `📊 สรุปยอดรวม

เดือน: ${month}
ปี: ${year}

❌ ไม่พบข้อมูลในเดือนนี้ครับ

ลองตรวจสอบเดือน / ปีอีกครั้งครับ

พิมพ์ "สรุปยอดรวม" เพื่อค้นหาใหม่`
      )

      return
    }

    await replyFlex(
      replyToken,

      `📊 สรุปยอดรวม ${month}/${year}`,

      buildSummaryFlex(
        summary,
        month,
        year
      )
    )

  } catch (summaryError) {

    console.error(
      'SUMMARY ERROR:',
      summaryError.response?.data ||
      summaryError.message
    )

    resetState(userId)

    await reply(
      replyToken,

      '⚠️ ไม่สามารถคำนวณสรุปยอดได้ครับ\nกรุณาลองใหม่อีกครั้ง'
    )
  }
}

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
