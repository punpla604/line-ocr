require('dotenv').config()
const express = require('express')
const axios = require('axios')
const FormData = require('form-data')

const sendToSheet = require('./send-to-sheet')

const app = express()
app.use(express.json())

const LINE_TOKEN = process.env.LINE_TOKEN
const OCRSPACE_KEY = process.env.OCRSPACE_KEY
const SHEET_URL = process.env.SHEET_URL
const SHEET_SECRET = process.env.SHEET_SECRET

// ================== เก็บสถานะผู้ใช้ ==================
const userState = new Map()

function defaultState() {
  return {
    mode: 'idle',
    step: 'idle',

    employeeCode: '',

    // upload
    waitingSince: null,

    // search
    searchType: '',
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
  const s = defaultState()
  userState.set(userId, s)
  return s
}

// ================== helper: cancel ==================
function isCancelMessage(text) {
  const t = (text || '').trim().toLowerCase()

  return [
    'ยกเลิก',
    'cancel',
    'ออก',
    'เลิก'
  ].includes(t)
}

// ================== helper: help ==================
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

// ================== employeeCode ==================
function normalizeEmployeeCode(text) {
  return (text || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

function isValidEmployeeCode(code) {
  if (!/^A\d{4}$/.test(code)) return false

  const num = parseInt(code.slice(1), 10)

  return num >= 1 && num <= 2000
}

// ================== timeouts ==================
const WAIT_IMAGE_MS = 60 * 1000
const WAIT_SEARCH_MS = 60 * 1000

function isExpired(ts, ms) {
  if (!ts) return false

  return Date.now() - ts > ms
}

// ================== English Months ==================
const ENGLISH_MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER'
]

// ================== Levenshtein ==================
function levenshteinDistance(a, b) {
  const matrix = Array.from(
    { length: b.length + 1 },
    () => Array(a.length + 1).fill(0)
  )

  for (let i = 0; i <= b.length; i++) {
    matrix[i][0] = i
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }

  return matrix[b.length][a.length]
}

// ================== normalize month ==================
function normalizeMonth(text) {
  const input = (text || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')

  if (!input) return ''

  // อ่านได้ตรง
  if (ENGLISH_MONTHS.includes(input)) {
    return input
  }

  // หาเดือนที่ใกล้เคียงที่สุด
  let bestMonth = ''
  let bestDistance = Infinity

  for (const month of ENGLISH_MONTHS) {
    const distance = levenshteinDistance(input, month)

    if (distance < bestDistance) {
      bestDistance = distance
      bestMonth = month
    }
  }

  // ไม่เดามั่ว
  const maxDistance =
    input.length >= 7 ? 2 :
    input.length >= 5 ? 1 :
    0

  return bestDistance <= maxDistance
    ? bestMonth
    : ''
}

// ================== OCR ==================
async function ocrImage(imageBuffer) {
  const form = new FormData()

  form.append('apikey', OCRSPACE_KEY)
  form.append('language', 'eng')
  form.append('OCREngine', '2')
  form.append('scale', 'true')

  // สำคัญ:
  // ขอข้อมูลตำแหน่งของคำกลับมาด้วย
  form.append('isOverlayRequired', 'true')

  form.append('file', imageBuffer, {
    filename: 'image.jpg'
  })

  const res = await axios.post(
    'https://api.ocr.space/parse/image',
    form,
    {
      headers: form.getHeaders(),
      timeout: 30000
    }
  )

  const result = res.data?.ParsedResults?.[0]

  return {
    text: result?.ParsedText || '',
    overlay: result?.TextOverlay || null
  }
}

// ================== Receipt format check ==================
function isOurReceipt(ocrText) {
  const t = (ocrText || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')

  const mustHave = [
    'receipt',
    'asoke skin hospital'
  ]

  return mustHave.every(k => t.includes(k))
}

// ================== money helper ==================
function findMoney(text) {
  const m = (text || '').match(
    /([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/
  )

  return m ? m[1] : ''
}

// ================== Receipt parser ==================
function parseReceipt(ocrText, overlay) {
  const raw = ocrText || ''

  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

  const findLineIncludes = (keyword) => {
    const k = keyword.toLowerCase()

    return lines.find(
      l => l.toLowerCase().includes(k)
    ) || ''
  }

  // ================== BN ==================
  let bn = ''

  {
    const bnLine = findLineIncludes('bn')

    const m = bnLine.match(
      /BN\.?\s*([A-Z0-9\-]+)/i
    )

    if (m) {
      bn = m[1].trim()
    }
  }

  // ================== HN ==================
  let hn = ''

  {
    const hnLine = findLineIncludes('hn')

    const m = hnLine.match(
      /HN\.?\s*([0-9\-]+)/i
    )

    if (m) {
      hn = m[1].trim()
    }
  }

  // ================== Date + Time ==================
  let receiptDateRaw = ''
  let timeText = ''

  {
    const idx = lines.findIndex(
      l => l.toLowerCase().startsWith('date')
    )

    if (idx !== -1) {
      const line = lines[idx]

      // ตัวอย่าง:
      // Date 31 January 2026 Time 18:01:02
      const mDateTime = line.match(
        /Date\s+(.+?)\s+Time\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i
      )

      if (mDateTime) {
        receiptDateRaw = (
          mDateTime[1] || ''
        ).trim()

        timeText = (
          mDateTime[2] || ''
        ).trim()
      } else {
        const mDate = line.match(
          /Date\s+(.+)/i
        )

        if (mDate) {
          receiptDateRaw = mDate[1].trim()
        }

        const mTime = line.match(
          /Time\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i
        )

        if (mTime) {
          timeText = mTime[1].trim()
        }
      }
    } else {
      // fallback
      const dtLine = lines.find(
        l =>
          l.toLowerCase().includes('date') &&
          l.toLowerCase().includes('time')
      ) || ''

      const mTime = dtLine.match(
        /Time\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i
      )

      if (mTime) {
        timeText = mTime[1].trim()
      }
    }
  }

  // ================== Date month correction ==================
  {
    const monthMatch = receiptDateRaw.match(
      /\b([A-Za-z?]+)\b/
    )

    if (monthMatch) {
      const originalMonth = monthMatch[1]

      const normalized = normalizeMonth(
        originalMonth
      )

      if (normalized) {
        receiptDateRaw = receiptDateRaw.replace(
          originalMonth,
          normalized
        )
      }
    }
  }

  // ================== Name ==================
  let patientName = ''

  {
    const idx = lines.findIndex(
      l => l.toLowerCase().startsWith('name')
    )

    if (idx !== -1) {
      const next = (
        lines[idx + 1] || ''
      ).trim()

      const next2 = (
        lines[idx + 2] || ''
      ).trim()

      if (/^(mr|ms|mrs)\.?$/i.test(next)) {
        patientName = next2
      } else {
        const m = lines[idx].match(
          /Name\s+(.+)/i
        )

        patientName = m
          ? m[1].trim()
          : next
      }
    }
  }

  // ================== Payment ==================
  let paymentType = ''

  {
    const payLine = findLineIncludes(
      'type of payment'
    )

    const m = payLine.match(
      /Type of Payment\s*:\s*(.+)/i
    )

    if (m) {
      paymentType = m[1].trim()
    }
  }

  // ================== VAT ==================
  let vat = ''

  {
    const vatLine = lines.find(
      l => l.toLowerCase().includes('vat')
    ) || ''

    const m = vatLine.match(
      /([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/
    )

    if (m) {
      vat = m[1]
    }
  }

  // ================== Items ==================
  //
  // รอบนี้ยังใช้ parser เดิมก่อน
  // แต่เราจะเก็บ overlay เอาไว้เพื่อทำ
  // X/Y matching ในขั้นต่อไป
  //
  const items = []

  {
    const startIdx = lines.findIndex(
      l =>
        l.toLowerCase().includes(
          'description'
        )
    )

    const endIdx = lines.findIndex(
      l =>
        /^(creditcard|total|signature|cashier|vat)/i.test(
          l.trim()
        )
    )

    if (startIdx !== -1) {
      const tableLines = lines.slice(
        startIdx + 1,
        endIdx !== -1
          ? endIdx
          : startIdx + 80
      )

      const cleaned = tableLines
        .map(l => l.trim())
        .filter(Boolean)
        .filter(
          l =>
            !/^(no\.?|baht|anau)$/i.test(l)
        )
        .filter(
          l => !/^\d+$/.test(l)
        )
        .filter(
          l => !/^page/i.test(l)
        )

      const moneyRegex =
        /^[0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}$/

      const dashRegex = /^-+$/

      const descList = []
      const priceList = []

      for (const l of cleaned) {
        const s = l
          .replace(/\s+/g, ' ')
          .trim()

        // เงิน
        if (moneyRegex.test(s)) {
          priceList.push(s)
          continue
        }

        // dash
        if (dashRegex.test(s)) {
          priceList.push('-')
          continue
        }

        // text + price ในบรรทัดเดียว
        const mInline = s.match(
          /(.+?)\s+([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})$/
        )

        if (mInline) {
          descList.push(
            mInline[1].trim()
          )

          priceList.push(
            mInline[2].trim()
          )

          continue
        }

        // description
        descList.push(s)
      }

      const n = Math.min(
        descList.length,
        priceList.length
      )

      for (let i = 0; i < n; i++) {
        const desc = descList[i]
        const p = priceList[i]

        items.push({
          desc,
          price: p === '-'
            ? null
            : p
        })
      }
    }
  }

  // ================== Total ==================
  let total = ''

  {
    const allMoney = lines
      .map(l => findMoney(l))
      .filter(Boolean)

    if (allMoney.length > 0) {
      total = allMoney[
        allMoney.length - 1
      ]
    }
  }

  return {
    timestamp: new Date().toISOString(),

    receiptNo: bn,
    bn,
    hn,

    receiptDateRaw,
    timeText,

    patientName,
    paymentType,
    vat,
    total,

    items,

    // เก็บ raw OCR
    raw,

    // เก็บ overlay เอาไว้ตรวจสอบ
    // ยังไม่ได้ส่งไป Sheet
    ocrOverlay: overlay || null
  }
}

// ================== LINE REPLY ==================
async function reply(replyToken, text) {
  return axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken,
      messages: [
        {
          type: 'text',
          text
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

// ================== QUERY SHEET ==================
async function querySheet(params) {
  if (!SHEET_URL) {
    throw new Error(
      'Missing env: SHEET_URL'
    )
  }

  if (!SHEET_SECRET) {
    throw new Error(
      'Missing env: SHEET_SECRET'
    )
  }

  const url =
    `${SHEET_URL}?secret=${encodeURIComponent(SHEET_SECRET)}`

  const res = await axios.get(
    url,
    {
      timeout: 20000,
      params
    }
  )

  return res.data
}

// ================== WEBHOOK ==================
app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0]

  if (!event) {
    return res.sendStatus(200)
  }

  const userId =
    event.source?.userId

  let state = getState(userId)

  try {
    // ================== TEXT ==================
    if (event.message?.type === 'text') {
      const text = (
        event.message.text || ''
      ).trim()

      // timeout upload
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
          state = resetState(userId)

          await reply(
            event.replyToken,
            '⏱️ รอรูปเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะส่งใหม่ พิมพ์ "ส่งเอกสาร"'
          )

          return res.sendStatus(200)
        }
      }

      // timeout search
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
          state = resetState(userId)

          await reply(
            event.replyToken,
            '⏱️ รอคำตอบเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะค้นหาใหม่ พิมพ์ "ค้นหา"'
          )

          return res.sendStatus(200)
        }
      }

      // cancel
      if (isCancelMessage(text)) {
        if (state.mode === 'idle') {
          await reply(
            event.replyToken,
            'ตอนนี้ยังไม่ได้เริ่มอะไรครับ 🙂\nพิมพ์ "ส่งเอกสาร" หรือ "ค้นหา" ได้เลย'
          )

          return res.sendStatus(200)
        }

        state = resetState(userId)

        await reply(
          event.replyToken,
          '❌ ยกเลิกเรียบร้อยครับ'
        )

        return res.sendStatus(200)
      }

      // help
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
3) ส่งรูปใบเสร็จ "ทีละ 1 รูป"
ระบบจะบันทึกให้ทันที

(ถ้ารอรูปเกิน 1 นาที ระบบจะยกเลิกให้อัตโนมัติ)

🔎 ค้นหา
1) พิมพ์ "ค้นหา"
2) ใส่รหัสพนักงาน
3) เลือกประเภทการค้นหาโดยพิมพ์เลข
1) BN
2) HN
3) NAME
4) DATE (11/02/2026)

พิมพ์ "ยกเลิก" ได้ทุกขั้นตอน`
        )

        return res.sendStatus(200)
      }

      // ================== Rich menu triggers ==================
      if (text === 'ส่งเอกสาร') {
        state = resetState(userId)

        state.mode = 'upload'
        state.step =
          'waitingEmployeeCode'

        await reply(
          event.replyToken,
          '🟦 ส่งเอกสาร\nกรุณาพิมพ์รหัสพนักงานครับ 👤'
        )

        return res.sendStatus(200)
      }

      if (text === 'ค้นหา') {
        state = resetState(userId)

        state.mode = 'search'
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

      // ================== UPLOAD MODE ==================
      if (state.mode === 'upload') {
        if (
          state.step ===
          'waitingEmployeeCode'
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
          state.step =
            'waitingImage'

          state.waitingSince =
            Date.now()

          await reply(
            event.replyToken,
            `โอเคครับ 👤 ${code}\nส่งรูปใบเสร็จมาได้เลยครับ (ทีละ 1 รูป) 🧾`
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

      // ================== SEARCH MODE ==================
      if (state.mode === 'search') {
        // employeeCode
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
          state.step =
            'chooseSearchType'

          state.searchWaitingSince =
            Date.now()

          await reply(
            event.replyToken,
            `โอเคครับ 👤 ${code}

เลือกประเภทค้นหา (พิมพ์เลข):
1) BN
2) HN
3) NAME
4) DATE (11/02/2026)`
          )

          return res.sendStatus(200)
        }

        // choose type
        if (
          state.step ===
          'chooseSearchType'
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
          state.step =
            'waitingSearchValue'

          state.searchWaitingSince =
            Date.now()

          const hint =
            state.searchType === 'BN'
              ? 'พิมพ์เลข BN เช่น L69-01-003-761'
              : state.searchType === 'HN'
                ? 'พิมพ์เลข HN เช่น 01-01-26-047'
                : state.searchType === 'NAME'
                  ? 'พิมพ์ชื่อคนไข้ เช่น Pun Kung'
                  : 'พิมพ์วันที่รูปแบบ 11/02/2026'

          await reply(
            event.replyToken,
            `พิมพ์ค่าที่ต้องการค้นหาได้เลยครับ\n${hint}`
          )

          return res.sendStatus(200)
        }

        // value -> query
        if (
          state.step ===
          'waitingSearchValue'
        ) {
          const value = text.trim()
          const employeeCode =
            state.employeeCode

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
              !/^\d{2}\/\d{2}\/\d{4}$/.test(
                value
              )
            ) {
              await reply(
                event.replyToken,
                '❌ รูปแบบวันที่ไม่ถูกต้องครับ ต้องเป็น 11/02/2026'
              )

              return res.sendStatus(200)
            }
          }

          let result

          if (
            state.searchType === 'BN'
          ) {
            result =
              await querySheet({
                action: 'findByBN',
                employeeCode,
                bn: value
              })

            state = resetState(userId)

            if (!result.found) {
              await reply(
                event.replyToken,
                'ไม่พบข้อมูลครับ 😅'
              )

              return res.sendStatus(200)
            }

            const d =
              result.data || {}

            await reply(
              event.replyToken,
              `🧾 พบใบเสร็จ 1 รายการ

BN: ${d.bn || '-'}
HN: ${d.hn || '-'}
Name: ${d.name || '-'}
Date: ${d.dateText || '-'}
Payment: ${d.paymentType || '-'}
Total: ${d.total || '-'}

(พิมพ์ "ค้นหา" เพื่อค้นหาใหม่)`
            )

            return res.sendStatus(200)
          }

          if (
            state.searchType === 'HN'
          ) {
            result =
              await querySheet({
                action: 'findByHN',
                employeeCode,
                hn: value
              })

            state = resetState(userId)

            const list =
              result.list || []

            if (list.length === 0) {
              await reply(
                event.replyToken,
                'ไม่พบข้อมูลครับ 😅'
              )

              return res.sendStatus(200)
            }

            const preview =
              list
                .slice(0, 10)
                .map(
                  (r, i) =>
                    `${i + 1}) ${r.dateShort || '-'} | BN ${r.bn || '-'} | Total ${r.total || '-'}`
                )
                .join('\n')

            await reply(
              event.replyToken,
              `🔎 พบทั้งหมด ${list.length} รายการ (HN: ${value})

${preview}

(แสดงสูงสุด 10 รายการ)`
            )

            return res.sendStatus(200)
          }

          if (
            state.searchType === 'NAME'
          ) {
            result =
              await querySheet({
                action: 'findByName',
                employeeCode,
                name: value
              })

            state = resetState(userId)

            const list =
              result.list || []

            if (list.length === 0) {
              await reply(
                event.replyToken,
                'ไม่พบข้อมูลครับ 😅'
              )

              return res.sendStatus(200)
            }

            const preview =
              list
                .slice(0, 10)
                .map(
                  (r, i) =>
                    `${i + 1}) ${r.dateShort || '-'} | BN ${r.bn || '-'} | Total ${r.total || '-'}`
                )
                .join('\n')

            await reply(
              event.replyToken,
              `🔎 พบทั้งหมด ${list.length} รายการ (NAME: ${value})

${preview}

(แสดงสูงสุด 10 รายการ)`
            )

            return res.sendStatus(200)
          }

          if (
            state.searchType === 'DATE'
          ) {
            result =
              await querySheet({
                action:
                  'countByDateReceipt',
                employeeCode,
                date: value
              })

            state = resetState(userId)

            await reply(
              event.replyToken,
              `📅 วันที่ ${value}\nพนักงาน ${employeeCode} มีทั้งหมด ${result.count || 0} รายการครับ`
            )

            return res.sendStatus(200)
          }
        }
      }

      // ================== DEFAULT ==================
      await reply(
        event.replyToken,
        'พิมพ์ "ส่งเอกสาร" เพื่อส่งใบเสร็จ\nหรือพิมพ์ "ค้นหา" เพื่อค้นหาข้อมูล\nหรือพิมพ์ "วิธีใช้"'
      )

      return res.sendStatus(200)
    }

    // ================== IMAGE ==================
    if (event.message?.type === 'image') {
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
        state = resetState(userId)

        await reply(
          event.replyToken,
          '⏱️ รอรูปเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะส่งใหม่ พิมพ์ "ส่งเอกสาร"'
        )

        return res.sendStatus(200)
      }

      const messageId =
        event.message.id

      // 1) ดึงรูปจาก LINE
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

      // 2) OCR
      const ocrResult =
        await ocrImage(
          imageRes.data
        )

      const ocrText =
        ocrResult.text

      console.log(
        '========== OCR TEXT =========='
      )

      console.log(ocrText)

      console.log(
        '========== OCR OVERLAY =========='
      )

      console.log(
        JSON.stringify(
          ocrResult.overlay,
          null,
          2
        )
      )

      if (!ocrText) {
        await reply(
          event.replyToken,
          'อ่านตัวอักษรไม่ออกครับ 😅 กรุณาลองถ่ายใหม่ให้ชัดขึ้น'
        )

        return res.sendStatus(200)
      }

      // 3) เช็คว่าเป็นใบเสร็จเราไหม
      if (
        !isOurReceipt(ocrText)
      ) {
        await reply(
          event.replyToken,
          '❌ รูปนี้ไม่ใช่ใบเสร็จรูปแบบที่รองรับครับ\nกรุณาส่งใบเสร็จ Asoke Skin Hospital เท่านั้น 🧾'
        )

        return res.sendStatus(200)
      }

      // 4) parse
      const parsed =
        parseReceipt(
          ocrText,
          ocrResult.overlay
        )

      parsed.employeeCode =
        state.employeeCode

      // 5) save
      //
      // ตอนนี้ยังส่งโครงสร้างเดิมเข้า Sheet
      // เพื่อไม่ให้ Sheet พัง
      //
      await sendToSheet(parsed)

      // reset timer
      state.waitingSince =
        Date.now()

      // 6) reply result
      await reply(
        event.replyToken,
        `✅ บันทึกเรียบร้อยครับ

👤 รหัสพนักงาน: ${state.employeeCode}
BN: ${parsed.bn || '-'}
Date: ${parsed.receiptDateRaw || '-'} ${parsed.timeText ? `(${parsed.timeText})` : ''}
HN: ${parsed.hn || '-'}
Total: ${parsed.total || '-'}

ส่งรูปต่อไปได้เลย 🧾
หรือพิมพ์ "ยกเลิก" เพื่อจบ`
      )

      return res.sendStatus(200)
    }

  } catch (err) {
    console.error(
      err.response?.data ||
      err.message
    )
  }

  res.sendStatus(200)
})

// ================= START =================
app.listen(3000, () => {
  console.log(
    '🚀 LINE webhook running on port 3000'
  )
})





