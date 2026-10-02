require('dotenv').config()

const express = require('express')
const axios = require('axios')
const { google } = require('googleapis')

const {
  getMonthlySummary,
  getDailySummary
} = require('./summary')

const {
  buildSummaryFlex,
  buildSummaryTypeFlex,
  buildDailySummaryFlex
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
  startDocument,
  handleDocumentText,
  handleDocumentPostback,
  handleDocumentImage
} = require('./document')

const {
  verifySummaryPassword,
  checkUser
} = require('./summary-auth')

const app = express()

app.use(express.json())

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
  process.env.GOOGLE_PRIVATE_KEY?.replace(
    /\\n/g,
    '\n'
  )

const WAIT_SEARCH_MS =
  60 * 1000

const WAIT_SUMMARY_MS =
  60 * 1000

// ==================================================
// STATE
// ==================================================

const userState =
  new Map()

function defaultState() {

  return {
    mode: 'idle',
    step: 'idle',

    // DOCUMENT
    employeeCode: '',
    doctorID: '',
    doctorName: '',
    waitingSince: null,

    // SUMMARY
    summaryType: '',
    summaryDay: '',
    summaryMonth: '',
    summaryYear: '',
    summaryWaitingSince: null,

    // SEARCH
    searchType: '',
    searchMonth: '',
    searchYear: '',
    searchWaitingSince: null,

    searchResults: [],
    searchPage: 1,
    searchTotal: 0
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

  const state =
    defaultState()

  userState.set(
    userId,
    state
  )

  return state
}

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

  if (
    !/^A\d{4}$/.test(code)
  ) {
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

function isExpired(
  timestamp,
  timeoutMs
) {

  if (!timestamp) {
    return false
  }

  return (
    Date.now() -
    timestamp >
    timeoutMs
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

  const num =
    Number(text)

  if (
    Number.isNaN(num)
  ) {
    return String(value)
  }

  return num.toLocaleString(
    'en-US'
  )
}

function isValidMonth(text) {

  return /^(0[1-9]|1[0-2])$/.test(
    String(text || '').trim()
  )
}

function getCurrentYear() {

  return new Date()
    .getFullYear()
}

function isValidYear(text) {

  const value =
    String(text || '').trim()

  if (
    !/^\d{4}$/.test(value)
  ) {
    return false
  }

  const currentYear =
    getCurrentYear()

  const minYear =
    currentYear - 5

  const year =
    Number(value)

  return (
    year >= minYear &&
    year <= currentYear
  )
}

function getYearRangeText() {

  const currentYear =
    getCurrentYear()

  return `${currentYear - 5} - ${currentYear}`
}

function isValidSearchDay(
  text,
  month,
  year
) {

  const dayText =
    String(text || '').trim()

  if (
    !/^\d{1,2}$/.test(dayText)
  ) {
    return false
  }

  const day =
    Number(dayText)

  if (
    day < 1 ||
    day > 31
  ) {
    return false
  }

  const monthNum =
    Number(month)

  const yearNum =
    Number(year)

  const date =
    new Date(
      yearNum,
      monthNum,
      0
    )

  const daysInMonth =
    date.getDate()

  return (
    day <= daysInMonth
  )
}

// ==================================================
// DATE HELPERS
// ==================================================

function normalizeDateText(value) {

  return String(
    value || ''
  )
    .trim()
    .replace(/\s+/g, '')
}

function normalizeDateForCompare(
  value
) {

  const source =
    normalizeDateText(
      value
    )

  if (!source) {
    return ''
  }

  // YYYY-MM-DD
  let match =
    source.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    )

  if (match) {

    return (
      `${match[3].padStart(2, '0')}/` +
      `${match[2].padStart(2, '0')}/` +
      `${match[1]}`
    )
  }

  // DD/MM/YYYY
  match =
    source.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    )

  if (match) {

    return (
      `${match[1].padStart(2, '0')}/` +
      `${match[2].padStart(2, '0')}/` +
      `${match[3]}`
    )
  }

  // DD-MM-YYYY
  match =
    source.match(
      /^(\d{1,2})-(\d{1,2})-(\d{4})$/
    )

  if (match) {

    return (
      `${match[1].padStart(2, '0')}/` +
      `${match[2].padStart(2, '0')}/` +
      `${match[3]}`
    )
  }

  return source
}

function dateMatches(
  sheetDate,
  targetDate
) {

  const source =
    normalizeDateForCompare(
      sheetDate
    )

  const target =
    normalizeDateForCompare(
      targetDate
    )

  return (
    source !== '' &&
    source === target
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
// DOCUMENT CONTEXT
// ==================================================

function getDocumentContext() {

  return {
    lineToken:
      LINE_TOKEN,

    sheetId:
      SHEET_ID,

    getSheetsClient,

    reply,

    replyFlex,

    resetState,

    isExpired,

    formatNumber,

    normalizeEmployeeCode,

    isValidEmployeeCode
  }
}

// ==================================================
// SEARCH RESULT
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

  if (
    list.length === 0
  ) {

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

    buildSearchListFlex(
      state
    )
  )
}

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

async function querySheet(
  params = {}
) {

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

  if (
    rows.length === 0
  ) {
    return {
      found: false,
      list: []
    }
  }

  const normalizeHeader =
    value =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/_/g, '')

  const headers =
    rows[0].map(
      normalizeHeader
    )

  const dataRows =
    rows.slice(1)

  function getColumn(
    row,
    possibleNames
  ) {

    for (
      const possibleName
      of possibleNames
    ) {

      const index =
        headers.indexOf(
          normalizeHeader(
            possibleName
          )
        )

      if (
        index !== -1
      ) {

        return String(
          row[index] ?? ''
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
        getColumn(row, [
          'hn'
        ]),

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
        getColumn(row, [
          'vat'
        ]),

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
        getColumn(row, [
          'other'
        ]),

      itemJson:
        getColumn(row, [
          'itemjson',
          'item json'
        ]),

      raw:
        getColumn(row, [
          'raw'
        ]),

      month: '',
      year: ''
    }
  }

  const data =
    dataRows.map(
      row =>
        rowToObject(row)
    )

  function normalizeText(value) {

    return String(value || '')
      .trim()
      .toLowerCase()
  }

  function getRowMonthYear(
    item
  ) {

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

    match =
      rawDate.match(
        /^(\d{1,2})-(\d{1,2})-(\d{4})$/
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
        String(
          item.year || ''
        ).trim(),

      month:
        String(
          item.month || ''
        )
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

      if (
        month ||
        year
      ) {

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

  // ==================================================
  // FIND BY BN
  // ==================================================

  if (
    action === 'findByBN'
  ) {

    filtered =
      filtered.filter(
        item =>
          normalizeText(
            item.bn
          ) ===
          normalizeText(
            bn
          )
      )
  }

  // ==================================================
  // FIND BY HN
  // ==================================================

  if (
    action === 'findByHN'
  ) {

    filtered =
      filtered.filter(
        item =>
          normalizeText(
            item.hn
          ) ===
          normalizeText(
            hn
          )
      )
  }

  // ==================================================
  // FIND BY NAME
  // ==================================================

  if (
    action === 'findByName'
  ) {

    filtered =
      filtered.filter(
        item =>
          normalizeText(
            item.name
          ).includes(
            normalizeText(
              name
            )
          )
      )
  }

  // ==================================================
  // FIND BY DATE
  // ==================================================

  if (
    action === 'findByDate'
  ) {

    filtered =
      filtered.filter(
        item =>
          dateMatches(
            item.dateText ||
            item.date,
            date
          )
      )
  }

  return {
    found:
      filtered.length > 0,

    list:
      filtered
  }
}

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

  } catch (
    summaryError
  ) {

    console.error(
      'SUMMARY ERROR:',
      summaryError.response?.data ||
      summaryError.stack ||
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
// DAILY SUMMARY PROCESS
// ==================================================

async function processDailySummary(
  replyToken,
  userId,
  day,
  month,
  year
) {

  try {

    console.log(
      'DAILY SUMMARY REQUEST:',
      {
        day,
        month,
        year
      }
    )

    const summary =
      await getDailySummary(
        day,
        month,
        year
      )

    console.log(
      'DAILY SUMMARY RESULT:',
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

        `📊 สรุปยอดรายวัน

วันที่: ${day}/${month}/${year}

❌ ไม่พบข้อมูลในวันที่เลือกครับ

ลองตรวจสอบวันที่อีกครั้งครับ

พิมพ์ "สรุปยอดรวม" เพื่อค้นหาใหม่`
      )

      return
    }

    await replyFlex(
      replyToken,

      `📊 สรุปยอดรายวัน ${day}/${month}/${year}`,

      buildDailySummaryFlex(
        summary,
        day,
        month,
        year
      )
    )

  } catch (
    summaryError
  ) {

    console.error(
      'DAILY SUMMARY ERROR:',
      summaryError.response?.data ||
      summaryError.stack ||
      summaryError.message
    )

    resetState(userId)

    await reply(
      replyToken,

      '⚠️ ไม่สามารถคำนวณสรุปยอดรายวันได้ครับ\nกรุณาลองใหม่อีกครั้ง'
    )
  }
}

// ==================================================
// WEBHOOK
// ==================================================

app.post(
  '/webhook',
  async (
    req,
    res
  ) => {

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

    const documentContext =
      getDocumentContext()

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

        // ==================================================
        // DOCUMENT POSTBACK
        // ==================================================

        if (
          state.mode === 'upload'
        ) {

          const handled =
            await handleDocumentPostback(
              event,
              userId,
              state,
              documentContext
            )

          if (
            handled
          ) {
            return res.sendStatus(200)
          }
        }

        // ==================================================
        // SEARCH NO OP
        // ==================================================

        if (
          data === 'search_noop'
        ) {
          return res.sendStatus(200)
        }

        // ==================================================
        // SEARCH CONFIRM EMPLOYEE
        // ==================================================

        if (
          data === 'search_confirm_employee'
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

          if (
            !isValidEmployeeCode(
              state.employeeCode
            )
          ) {

            await reply(
              event.replyToken,

              '❌ ไม่พบรหัสพนักงานที่ถูกต้องครับ\nพิมพ์ "ค้นหา" เพื่อเริ่มใหม่'
            )

            return res.sendStatus(200)
          }

          state.step =
            'waitingSearchMonth'

          state.searchWaitingSince =
            Date.now()

          await replyFlex(
            event.replyToken,

            `👤 Employee: ${state.employeeCode}\n📅 กรุณาเลือกเดือน`,

            buildMonthFlex(
              'search'
            )
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // SEARCH CHOOSE MONTH
        // ==================================================

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

            buildMonthFlex(
              'search'
            )
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // SEARCH MONTH
        // ==================================================

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

            buildYearFlex(
              'search'
            )
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // SEARCH YEAR
        // ==================================================

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

        // ==================================================
        // SEARCH TYPE
        // ==================================================

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
              'พิมพ์วันที่ DD เช่น 02'
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

        // ==================================================
        // SEARCH DISABLED
        // ==================================================

        if (
          data === 'search_disabled'
        ) {
          return res.sendStatus(200)
        }

        // ==================================================
        // SEARCH PAGE
        // ==================================================

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

        // ==================================================
        // SEARCH DETAIL
        // ==================================================

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

        // ==================================================
        // SUMMARY TYPE
        // ==================================================

        if (
          data.startsWith(
            'summary_type:'
          )
        ) {

          if (
            state.mode !== 'summary'
          ) {

            await reply(
              event.replyToken,

              '⏱️ session สรุปยอดหมดอายุแล้วครับ\nพิมพ์ "สรุปยอดรวม" เพื่อเริ่มใหม่'
            )

            return res.sendStatus(200)
          }

          const summaryType =
            data.split(':')[1]

          if (
            ![
              'daily',
              'monthly'
            ].includes(
              summaryType
            )
          ) {
            return res.sendStatus(200)
          }

          state.summaryType =
            summaryType

          state.summaryMonth = ''
          state.summaryYear = ''
          state.summaryDay = ''

          state.step =
            'waitingSummaryMonth'

          state.summaryWaitingSince =
            Date.now()

          const title =
            summaryType === 'daily'
              ? '📊 สรุปยอดรายวัน'
              : '📊 สรุปยอดรายเดือน'

          await replyFlex(
            event.replyToken,

            `${title}\n📅 กรุณาเลือกเดือน`,

            buildMonthFlex(
              'summary'
            )
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // SUMMARY MONTH
        // ==================================================

        if (
          data.startsWith(
            'summary_month:'
          )
        ) {

          if (
            state.mode !== 'summary'
          ) {

            await reply(
              event.replyToken,

              '⏱️ session สรุปยอดหมดอายุแล้วครับ\nพิมพ์ "สรุปยอดรวม" เพื่อเริ่มใหม่'
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

          state.summaryMonth =
            month

          state.step =
            'waitingSummaryYear'

          state.summaryWaitingSince =
            Date.now()

          await replyFlex(
            event.replyToken,

            `📅 เดือน ${month}\nกรุณาเลือกปี`,

            buildYearFlex(
              'summary'
            )
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // SUMMARY YEAR
        // ==================================================

        if (
          data.startsWith(
            'summary_year:'
          )
        ) {

          if (
            state.mode !== 'summary'
          ) {

            await reply(
              event.replyToken,

              '⏱️ session สรุปยอดหมดอายุแล้วครับ\nพิมพ์ "สรุปยอดรวม" เพื่อเริ่มใหม่'
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

          state.summaryYear =
            year

          state.summaryWaitingSince =
            Date.now()

          if (
            state.summaryType ===
            'daily'
          ) {

            state.step =
              'waitingSummaryDay'

            await reply(
              event.replyToken,

              `📊 สรุปยอดรายวัน

เดือน: ${state.summaryMonth}
ปี: ${state.summaryYear}

กรุณาพิมพ์วันที่ เช่น 15`
            )

            return res.sendStatus(200)
          }

          if (
            state.summaryType ===
            'monthly'
          ) {

            await processSummary(
              event.replyToken,
              userId,
              state.summaryMonth,
              state.summaryYear
            )

            return res.sendStatus(200)
          }

          return res.sendStatus(200)
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

        // ==================================================
        // CANCEL
        // ==================================================

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

        // ==================================================
        // START DOCUMENT
        // ==================================================

        if (
          text === 'ส่งเอกสาร'
        ) {

          state =
            resetState(userId)

          state.mode =
            'upload'

          await startDocument(
            event,
            userId,
            state,
            documentContext
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // DOCUMENT MODE
        // ==================================================

        if (
          state.mode === 'upload'
        ) {

          const handled =
            await handleDocumentText(
              event,
              userId,
              state,
              text,
              documentContext
            )

          if (
            handled
          ) {
            return res.sendStatus(200)
          }
        }

        // ==================================================
        // TIMEOUT SEARCH
        // ==================================================

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

        // ==================================================
        // TIMEOUT SUMMARY
        // ==================================================

        if (
          state.mode === 'summary' &&
          state.step !== 'idle' &&
          isExpired(
            state.summaryWaitingSince,
            WAIT_SUMMARY_MS
          )
        ) {

          resetState(userId)

          await reply(
            event.replyToken,

            '⏱️ รอคำตอบเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะสรุปยอดใหม่ พิมพ์ "สรุปยอดรวม"'
          )

          return res.sendStatus(200)
        }

        // ==================================================
        // START SEARCH
        // ==================================================

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

        // ==================================================
        // START SUMMARY
        // ==================================================

        if (
          text === 'สรุปยอดรวม'
        ) {

          try {

            const auth =
              await checkUser(
                userId
              )

            if (
              auth?.locked
            ) {

              await reply(
                event.replyToken,

                '🔒 บัญชีนี้ถูกล็อกไม่ให้เข้าดูสรุปยอดรวมแล้วครับ\nกรุณาติดต่อผู้ดูแลระบบ'
              )

              return res.sendStatus(200)
            }

          } catch (
            authCheckError
          ) {

            console.error(
              'SUMMARY CHECK USER ERROR:',
              authCheckError.response?.data ||
              authCheckError.stack ||
              authCheckError.message
            )

            await reply(
              event.replyToken,

              '⚠️ ไม่สามารถตรวจสอบสิทธิ์ได้ครับ\nกรุณาลองใหม่อีกครั้ง'
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
        // SEARCH MODE
        // ==================================================

        if (
          state.mode === 'search'
        ) {

          // ------------------------------------------------
          // EMPLOYEE CODE
          // ------------------------------------------------

          if (
            state.step ===
            'waitingEmployeeCodeForSearch'
          ) {

            const code =
              normalizeEmployeeCode(
                text
              )

            if (
              !isValidEmployeeCode(
                code
              )
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

          // ------------------------------------------------
          // SEARCH MONTH
          // ------------------------------------------------

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

                buildMonthFlex(
                  'search'
                )
              )

              state.searchWaitingSince =
                Date.now()

              return res.sendStatus(200)
            }

            if (
              !isValidMonth(
                month
              )
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

              buildYearFlex(
                'search'
              )
            )

            return res.sendStatus(200)
          }

          // ------------------------------------------------
          // SEARCH YEAR
          // ------------------------------------------------

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

                buildYearFlex(
                  'search'
                )
              )

              state.searchWaitingSince =
                Date.now()

              return res.sendStatus(200)
            }

            if (
              !isValidYear(
                year
              )
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

          // ------------------------------------------------
          // SEARCH TYPE
          // ------------------------------------------------

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

            if (
              type === 'BN'
            ) {
              hint =
                'พิมพ์เลข BN เช่น L69-01-003-761'
            }

            if (
              type === 'HN'
            ) {
              hint =
                'พิมพ์เลข HN เช่น 01-01-26-047'
            }

            if (
              type === 'NAME'
            ) {
              hint =
                'พิมพ์ชื่อคนไข้'
            }

            if (
              type === 'DATE'
            ) {
              hint =
                'พิมพ์วันที่ DD เช่น 02'
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

          // ------------------------------------------------
          // SEARCH VALUE
          // ------------------------------------------------

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
                !isValidSearchDay(
                  value,
                  state.searchMonth,
                  state.searchYear
                )
              ) {

                await reply(
                  event.replyToken,

                  `❌ วันที่ไม่ถูกต้องครับ

คุณเลือก:
เดือน ${state.searchMonth}
ปี ${state.searchYear}

กรุณาพิมพ์เฉพาะวันที่ เช่น
01`
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
              state.searchType ===
              'BN'
            ) {

              result =
                await querySheet({
                  action: 'findByBN',
                  ...baseParams,
                  bn: value
                })
            }

            else if (
              state.searchType ===
              'HN'
            ) {

              result =
                await querySheet({
                  action: 'findByHN',
                  ...baseParams,
                  hn: value
                })
            }

            else if (
              state.searchType ===
              'NAME'
            ) {

              result =
                await querySheet({
                  action: 'findByName',
                  ...baseParams,
                  name: value
                })
            }

            else if (
              state.searchType ===
              'DATE'
            ) {

              const searchDate =
                `${value.padStart(2, '0')}/${state.searchMonth}/${state.searchYear}`

              result =
                await querySheet({
                  action: 'findByDate',
                  ...baseParams,
                  date: searchDate
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
          // PASSWORD
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

                resetState(
                  userId
                )

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
                  'waitingSummaryType'

                state.summaryWaitingSince =
                  Date.now()

                await replyFlex(
                  event.replyToken,

                  '📊 เลือกประเภทสรุปยอด',

                  buildSummaryTypeFlex()
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

            } catch (
              authError
            ) {

              console.error(
                'SUMMARY AUTH ERROR:',
                authError.response?.data ||
                authError.stack ||
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
          // SUMMARY MONTH
          // ------------------------------------------------

          if (
            state.step ===
            'waitingSummaryMonth'
          ) {

            const month =
              text.trim()

            if (
              !isValidMonth(
                month
              )
            ) {

              await replyFlex(
                event.replyToken,

                '📊 กรุณาเลือกเดือน',

                buildMonthFlex(
                  'summary'
                )
              )

              state.summaryWaitingSince =
                Date.now()

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

              buildYearFlex(
                'summary'
              )
            )

            return res.sendStatus(200)
          }

          // ------------------------------------------------
          // SUMMARY YEAR
          // ------------------------------------------------

          if (
            state.step ===
            'waitingSummaryYear'
          ) {

            const year =
              text.trim()

            if (
              !isValidYear(
                year
              )
            ) {

              await replyFlex(
                event.replyToken,

                '📊 กรุณาเลือกปี',

                buildYearFlex(
                  'summary'
                )
              )

              state.summaryWaitingSince =
                Date.now()

              return res.sendStatus(200)
            }

            state.summaryYear =
              year

            state.summaryWaitingSince =
              Date.now()

            if (
              state.summaryType ===
              'monthly'
            ) {

              await processSummary(
                event.replyToken,
                userId,
                state.summaryMonth,
                state.summaryYear
              )

              return res.sendStatus(200)
            }

            if (
              state.summaryType ===
              'daily'
            ) {

              state.step =
                'waitingSummaryDay'

              await reply(
                event.replyToken,

                `📊 สรุปยอดรายวัน

เดือน: ${state.summaryMonth}
ปี: ${state.summaryYear}

กรุณาพิมพ์วันที่ เช่น 15`
              )

              return res.sendStatus(200)
            }

            return res.sendStatus(200)
          }

          // ------------------------------------------------
          // SUMMARY DAY
          // ------------------------------------------------

          if (
            state.step ===
            'waitingSummaryDay'
          ) {

            const day =
              text.trim()

            if (
              !isValidSearchDay(
                day,
                state.summaryMonth,
                state.summaryYear
              )
            ) {

              await reply(
                event.replyToken,

                `❌ วันที่ไม่ถูกต้องครับ

คุณเลือก:
เดือน ${state.summaryMonth}
ปี ${state.summaryYear}

กรุณาพิมพ์วันที่ เช่น 01`
              )

              return res.sendStatus(200)
            }

            state.summaryDay =
              day.padStart(
                2,
                '0'
              )

            state.summaryWaitingSince =
              Date.now()

            await processDailySummary(
              event.replyToken,
              userId,
              state.summaryDay,
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
        event.message?.type ===
        'image'
      ) {

        if (
          state.mode === 'upload'
        ) {

          await handleDocumentImage(
            event,
            userId,
            state,
            documentContext
          )

          return res.sendStatus(200)
        }

        await reply(
          event.replyToken,

          'ก่อนส่งรูป กรุณาพิมพ์ "ส่งเอกสาร" แล้วทำตามขั้นตอนก่อนครับ 🙂'
        )

        return res.sendStatus(200)
      }

      return res.sendStatus(200)

    } catch (
      err
    ) {

      console.error(
        'WEBHOOK ERROR:',
        err.response?.data ||
        err.stack ||
        err.message
      )

      try {

        await reply(
          event.replyToken,

          '⚠️ ระบบเกิดข้อผิดพลาดครับ\nกรุณาลองใหม่อีกครั้ง'
        )

      } catch (
        replyErr
      ) {

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
// START SERVER
// ==================================================

const PORT =
  process.env.PORT || 3000

app.listen(
  PORT,
  () => {

    console.log(
      `🚀 LINE webhook running on port ${PORT}`
    )
  }
)
