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
    mode: 'idle', // idle | upload | search
    step: 'idle',

    employeeCode: '',

    // upload
    waitingSince: null,

    // search
    searchType: '', // BN | HN | NAME | DATE
    searchWaitingSince: null
  }
}

function getState(userId) {
  if (!userState.has(userId)) userState.set(userId, defaultState())
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
  return ['ยกเลิก', 'cancel', 'ออก', 'เลิก'].includes(t)
}

// ================== helper: help ==================
function isHelpMessage(text) {
  const t = (text || '').trim()
  const keywords = [
    'ทำไง', 'ส่งไง', 'ส่งยังไง', 'ต้องทำไง', 'ต้องทำยังไง',
    'ทำยังไง', 'วิธีส่ง', 'วิธีทำ', 'ช่วย', 'เริ่มยังไง', 'วิธีใช้'
  ]
  return keywords.some(k => t.includes(k))
}

// ================== employeeCode ==================
function normalizeEmployeeCode(text) {
  return (text || '').trim().toUpperCase().replace(/\s+/g, '')
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

// ================== OCR ==================
async function ocrImage(imageBuffer) {
  const form = new FormData()
  form.append('apikey', OCRSPACE_KEY)
  form.append('language', 'eng')
  form.append('OCREngine', '2')
  form.append('scale', 'true')
  form.append('file', imageBuffer, { filename: 'image.jpg' })

  const res = await axios.post(
    'https://api.ocr.space/parse/image',
    form,
    { headers: form.getHeaders(), timeout: 30000 }
  )

  return res.data?.ParsedResults?.[0]?.ParsedText
}

// ================== Receipt format check ==================
function isOurReceipt(ocrText) {
  const t = (ocrText || '').toLowerCase().replace(/\s+/g, ' ')
  const mustHave = ['receipt', 'asoke skin hospital']
  return mustHave.every(k => t.includes(k))
}

// ================== money helper ==================
function findMoney(text) {
  const m = (text || '').match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/)
  return m ? m[1] : ''
}

// ================== Receipt parser ==================
function parseReceipt(ocrText) {
  const raw = ocrText || ''
  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

  const findLineIncludes = (keyword) => {
    const k = keyword.toLowerCase()
    return lines.find(l => l.toLowerCase().includes(k)) || ''
  }

  // BN
  let bn = ''
  {
    const bnLine = findLineIncludes('bn')
    const m = bnLine.match(/BN\.?\s*([A-Z0-9\-]+)/i)
    if (m) bn = m[1].trim()
  }

  // HN
  let hn = ''
  {
    const hnLine = findLineIncludes('hn')
    const m = hnLine.match(/HN\.?\s*([0-9\-]+)/i)
    if (m) hn = m[1].trim()
  }

  // Date + Time
  let receiptDateRaw = ''
  let timeText = ''
  {
    const idx = lines.findIndex(l => l.toLowerCase().startsWith('date'))
    if (idx !== -1) {
      const line = lines[idx]

      // Date 31 January 2026 Time 18:01:02
      const mDateTime = line.match(/Date\s+(.+?)\s+Time\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i)
      if (mDateTime) {
        receiptDateRaw = (mDateTime[1] || '').trim()
        timeText = (mDateTime[2] || '').trim()
      } else {
        const mDate = line.match(/Date\s+(.+)/i)
        if (mDate) receiptDateRaw = mDate[1].trim()

        const mTime = line.match(/Time\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i)
        if (mTime) timeText = mTime[1].trim()
      }
    } else {
      // fallback: หา line ที่มี time
      const dtLine = lines.find(l => l.toLowerCase().includes('date') && l.toLowerCase().includes('time')) || ''
      const mTime = dtLine.match(/Time\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i)
      if (mTime) timeText = mTime[1].trim()
    }
  }

  // Name
  let patientName = ''
  {
    const idx = lines.findIndex(l => l.toLowerCase().startsWith('name'))
    if (idx !== -1) {
      const next = (lines[idx + 1] || '').trim()
      const next2 = (lines[idx + 2] || '').trim()

      if (/^(mr|ms|mrs)\.?$/i.test(next)) {
        patientName = next2
      } else {
        const m = lines[idx].match(/Name\s+(.+)/i)
        patientName = m ? m[1].trim() : next
      }
    }
  }

  // Payment
  let paymentType = ''
  {
    const payLine = findLineIncludes('type of payment')
    const m = payLine.match(/Type of Payment\s*:\s*(.+)/i)
    if (m) paymentType = m[1].trim()
  }

  // VAT (บางใบ OCR จะไม่เจอเลขจริง)
  let vat = ''
  {
    const vatLine = lines.find(l => l.toLowerCase().includes('vat')) || ''
    const m = vatLine.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/)
    if (m) vat = m[1]
  }

  // ===== items: จับคู่ "บรรทัดก่อนหน้า" + "ราคา" =====
  // logic:
  // - ถ้าบรรทัดมีเงิน
  // - ให้เอาบรรทัดนั้นเป็นราคา
  // - แล้วเอาบรรทัดก่อนหน้า 1-2 บรรทัดเป็น desc
  // - ตัดพวก Total / VAT / Signature / CreditCard
  const items = []
  {
    const ignoreWords = ['total', 'vat', 'signature', 'cashier', 'page', 'receipt', 'creditcard']
    const isIgnored = (s) => ignoreWords.some(w => (s || '').toLowerCase().includes(w))

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      const price = findMoney(l)
      if (!price) continue

      // ถ้าเป็น line ที่มี total/vat -> ข้าม
      if (isIgnored(l)) continue

      // หา desc จากบรรทัดก่อนหน้า
      const prev1 = lines[i - 1] || ''
      const prev2 = lines[i - 2] || ''
      const prev3 = lines[i - 3] || ''

      // เลือก desc ที่ดูดีที่สุด
      const candidates = [prev1, prev2, prev3]
        .map(x => (x || '').trim())
        .filter(Boolean)
        .filter(x => !findMoney(x))
        .filter(x => x.length >= 3)
        .filter(x => !isIgnored(x))
        .filter(x => !/^(baht|no\.?|anau|description)$/i.test(x))

      const desc = candidates[0] || ''

      items.push({ desc, price })
    }

    // กัน item ซ้ำ (OCR มักซ้ำ)
    const uniq = []
    const seen = new Set()
    for (const it of items) {
      const key = `${it.desc}|${it.price}`
      if (seen.has(key)) continue
      seen.add(key)
      uniq.push(it)
    }

    // จำกัดไม่ให้ยาวเกินไป
    while (uniq.length > 30) uniq.pop()

    items.length = 0
    items.push(...uniq)
  }

  // ===== total: ใช้ "เงินตัวสุดท้ายในใบ" เป็น fallback =====
  let total = ''
  {
    const allMoney = lines
      .map(l => findMoney(l))
      .filter(Boolean)

    if (allMoney.length > 0) {
      total = allMoney[allMoney.length - 1]
    }
  }

  return {
    timestamp: new Date().toISOString(),

    // ให้ชื่อ field ตรง sheet
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
    raw
  }
}

// ================== LINE REPLY ==================
async function reply(replyToken, text) {
  return axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken,
      messages: [{ type: 'text', text }]
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

// ================== QUERY SHEET ==================
async function querySheet(params) {
  if (!SHEET_URL) throw new Error('Missing env: SHEET_URL')
  if (!SHEET_SECRET) throw new Error('Missing env: SHEET_SECRET')

  const url = `${SHEET_URL}?secret=${encodeURIComponent(SHEET_SECRET)}`

  const res = await axios.get(url, {
    timeout: 20000,
    params
  })

  return res.data
}

// ================== WEBHOOK ==================
app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0]
  if (!event) return res.sendStatus(200)

  const userId = event.source?.userId
  let state = getState(userId)

  try {
    // ================== TEXT ==================
    if (event.message?.type === 'text') {
      const text = (event.message.text || '').trim()

      // timeout: upload
      if (state.mode === 'upload' && state.step === 'waitingImage') {
        if (isExpired(state.waitingSince, WAIT_IMAGE_MS)) {
          state = resetState(userId)
          await reply(
            event.replyToken,
            '⏱️ รอรูปเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะส่งใหม่ พิมพ์ "ส่งเอกสาร"'
          )
          return res.sendStatus(200)
        }
      }

      // timeout: search
      if (state.mode === 'search' && state.step !== 'idle') {
        if (isExpired(state.searchWaitingSince, WAIT_SEARCH_MS)) {
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
          await reply(event.replyToken, 'ตอนนี้ยังไม่ได้เริ่มอะไรครับ 🙂\nพิมพ์ "ส่งเอกสาร" หรือ "ค้นหา" ได้เลย')
          return res.sendStatus(200)
        }
        state = resetState(userId)
        await reply(event.replyToken, '❌ ยกเลิกเรียบร้อยครับ')
        return res.sendStatus(200)
      }

      // help
      if (isHelpMessage(text) || text === 'วิธีใช้') {
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

      // ===== Rich menu triggers =====
      if (text === 'ส่งเอกสาร') {
        state = resetState(userId)
        state.mode = 'upload'
        state.step = 'waitingEmployeeCode'
        await reply(event.replyToken, '🟦 ส่งเอกสาร\nกรุณาพิมพ์รหัสพนักงานครับ 👤')
        return res.sendStatus(200)
      }

      if (text === 'ค้นหา') {
        state = resetState(userId)
        state.mode = 'search'
        state.step = 'waitingEmployeeCodeForSearch'
        state.searchWaitingSince = Date.now()
        await reply(event.replyToken, '🔎 ค้นหา\nกรุณาพิมพ์รหัสพนักงานก่อนครับ 👤')
        return res.sendStatus(200)
      }

      // ================== UPLOAD MODE ==================
      if (state.mode === 'upload') {
        if (state.step === 'waitingEmployeeCode') {
          const code = normalizeEmployeeCode(text)

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
            `โอเคครับ 👤 ${code}\nส่งรูปใบเสร็จมาได้เลยครับ (ทีละ 1 รูป) 🧾`
          )
          return res.sendStatus(200)
        }

        if (state.step === 'waitingImage') {
          await reply(
            event.replyToken,
            'ตอนนี้รอรูปใบเสร็จอยู่นะครับ 🧾\nส่งรูปมาได้เลย หรือพิมพ์ "ยกเลิก"'
          )
          return res.sendStatus(200)
        }
      }

      // ================== SEARCH MODE ==================
      if (state.mode === 'search') {
        // 1) employeeCode
        if (state.step === 'waitingEmployeeCodeForSearch') {
          const code = normalizeEmployeeCode(text)

          if (!isValidEmployeeCode(code)) {
            await reply(
              event.replyToken,
              '❌ รหัสพนักงานไม่ถูกต้องครับ\nกรุณาพิมพ์ใหม่อีกครั้ง\nหรือพิมพ์ "ยกเลิก"'
            )
            return res.sendStatus(200)
          }

          state.employeeCode = code
          state.step = 'chooseSearchType'
          state.searchWaitingSince = Date.now()

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

        // 2) choose type
        if (state.step === 'chooseSearchType') {
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

          const hint =
            state.searchType === 'BN' ? 'พิมพ์เลข BN เช่น L69-01-003-761' :
            state.searchType === 'HN' ? 'พิมพ์เลข HN เช่น 01-01-26-047' :
            state.searchType === 'NAME' ? 'พิมพ์ชื่อคนไข้ เช่น Pun Kung' :
            'พิมพ์วันที่รูปแบบ 11/02/2026'

          await reply(event.replyToken, `พิมพ์ค่าที่ต้องการค้นหาได้เลยครับ\n${hint}`)
          return res.sendStatus(200)
        }

        // 3) value -> query
        if (state.step === 'waitingSearchValue') {
          const value = text.trim()
          const employeeCode = state.employeeCode

          if (!value) {
            await reply(event.replyToken, '❌ ค่าว่างครับ พิมพ์ใหม่อีกครั้ง หรือพิมพ์ "ยกเลิก"')
            return res.sendStatus(200)
          }

          if (state.searchType === 'DATE') {
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
              await reply(event.replyToken, '❌ รูปแบบวันที่ไม่ถูกต้องครับ ต้องเป็น 11/02/2026')
              return res.sendStatus(200)
            }
          }

          let result

          if (state.searchType === 'BN') {
            result = await querySheet({
              action: 'findByBN',
              employeeCode,
              bn: value
            })

            state = resetState(userId)

            if (!result.found) {
              await reply(event.replyToken, 'ไม่พบข้อมูลครับ 😅')
              return res.sendStatus(200)
            }

            const d = result.data || {}

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

          if (state.searchType === 'HN') {
            result = await querySheet({
              action: 'findByHN',
              employeeCode,
              hn: value
            })

            state = resetState(userId)

            const list = result.list || []
            if (list.length === 0) {
              await reply(event.replyToken, 'ไม่พบข้อมูลครับ 😅')
              return res.sendStatus(200)
            }

            const preview = list
              .slice(0, 10)
              .map((r, i) => `${i + 1}) ${r.dateShort || '-'} | BN ${r.bn || '-'} | Total ${r.total || '-'}`)
              .join('\n')

            await reply(
              event.replyToken,
              `🔎 พบทั้งหมด ${list.length} รายการ (HN: ${value})

${preview}

(แสดงสูงสุด 10 รายการ)`
            )
            return res.sendStatus(200)
          }

          if (state.searchType === 'NAME') {
            result = await querySheet({
              action: 'findByName',
              employeeCode,
              name: value
            })

            state = resetState(userId)

            const list = result.list || []
            if (list.length === 0) {
              await reply(event.replyToken, 'ไม่พบข้อมูลครับ 😅')
              return res.sendStatus(200)
            }

            const preview = list
              .slice(0, 10)
              .map((r, i) => `${i + 1}) ${r.dateShort || '-'} | BN ${r.bn || '-'} | Total ${r.total || '-'}`)
              .join('\n')

            await reply(
              event.replyToken,
              `🔎 พบทั้งหมด ${list.length} รายการ (NAME: ${value})

${preview}

(แสดงสูงสุด 10 รายการ)`
            )
            return res.sendStatus(200)
          }

          if (state.searchType === 'DATE') {
            result = await querySheet({
              action: 'countByDateReceipt',
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
      if (state.mode !== 'upload' || state.step !== 'waitingImage' || !state.employeeCode) {
        await reply(
          event.replyToken,
          'ก่อนส่งรูป กรุณาพิมพ์ "ส่งเอกสาร" แล้วใส่รหัสพนักงานก่อนครับ 🙂'
        )
        return res.sendStatus(200)
      }

      if (isExpired(state.waitingSince, WAIT_IMAGE_MS)) {
        state = resetState(userId)
        await reply(
          event.replyToken,
          '⏱️ รอรูปเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะส่งใหม่ พิมพ์ "ส่งเอกสาร"'
        )
        return res.sendStatus(200)
      }

      const messageId = event.message.id

      // 1) ดึงรูปจาก LINE
      const imageRes = await axios.get(
        `https://api-data.line.me/v2/bot/message/${messageId}/content`,
        {
          headers: { Authorization: `Bearer ${LINE_TOKEN}` },
          responseType: 'arraybuffer',
          timeout: 20000
        }
      )

      // 2) OCR
      const ocrText = await ocrImage(imageRes.data)
      console.log('OCR result:', ocrText)

      if (!ocrText) {
        await reply(event.replyToken, 'อ่านตัวอักษรไม่ออกครับ 😅 กรุณาลองถ่ายใหม่ให้ชัดขึ้น')
        return res.sendStatus(200)
      }

      // 3) เช็คว่าเป็นใบเสร็จเราไหม
      if (!isOurReceipt(ocrText)) {
        await reply(
          event.replyToken,
          '❌ รูปนี้ไม่ใช่ใบเสร็จรูปแบบที่รองรับครับ\nกรุณาส่งใบเสร็จ Asoke Skin Hospital เท่านั้น 🧾'
        )
        return res.sendStatus(200)
      }

      // 4) parse
      const parsed = parseReceipt(ocrText)
      parsed.employeeCode = state.employeeCode

      // 5) save (ทีละ 1 รูป)
      await sendToSheet(parsed)

      // reset timer ทุกครั้งที่มีรูปเข้ามา
      state.waitingSince = Date.now()

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
    console.error(err.response?.data || err.message)
  }

  res.sendStatus(200)
})

// ================= START =================
app.listen(3000, () => {
  console.log('🚀 LINE webhook running on port 3000')
})






