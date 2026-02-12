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
    searchType: '',
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
const WAIT_IMAGE_MS = 3 * 60 * 1000 // 3 นาที
const WAIT_SEARCH_MS = 60 * 1000 // 1 นาที

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

  // Date raw
  let receiptDateRaw = ''
  {
    const idx = lines.findIndex(l => l.toLowerCase().startsWith('date'))
    if (idx !== -1) {
      const line = lines[idx]
      const m1 = line.match(/Date\s+(.+?)\s+Time/i)
      if (m1) receiptDateRaw = m1[1].trim()
      else {
        const m2 = line.match(/Date\s+(.+)/i)
        if (m2) receiptDateRaw = m2[1].trim()
      }
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

  // Total
  let total = ''
  {
    const totalLine = lines.find(l => l.toLowerCase().includes('total')) || ''
    const moneyMatch = totalLine.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/)
    if (moneyMatch) total = moneyMatch[1]
  }

  // VAT
  let vat = ''
  {
    const vatLine = lines.find(l => l.toLowerCase().includes('vat')) || ''
    const m = vatLine.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/)
    if (m) vat = m[1]
  }

  // items
  const items = []
  for (const l of lines) {
    const money = l.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/)
    if (!money) continue

    const low = l.toLowerCase()
    if (low.includes('total') || low.includes('vat') || low.includes('signature')) continue

    const price = money[1]
    const desc = l.replace(price, '').replace(/\s+/g, ' ').trim()

    if (desc.length >= 2) items.push({ desc, price })
  }

  return {
    timestamp: new Date().toISOString(),
    receiptNo: bn, // ให้ชื่อ field ตรง sheet
    bn,
    hn,
    receiptDateRaw,
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
            '⏱️ รอรูปเกิน 3 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะส่งใหม่ พิมพ์ "ส่งเอกสาร"'
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
      if (isHelpMessage(text)) {
        await reply(
          event.replyToken,
          `📌 วิธีใช้งาน

🟦 ส่งเอกสาร
1) พิมพ์ "ส่งเอกสาร"
2) ใส่รหัสพนักงาน
3) ส่งรูปใบเสร็จ (ครั้งละ 1 รูป)
(ถ้ารอรูปเกิน 3 นาที ระบบจะยกเลิกให้อัตโนมัติ)

🔎 ค้นหา
1) พิมพ์ "ค้นหา"
2) ใส่รหัสพนักงาน
3) เลือกประเภทการค้นหา
1) BN (เลขใบเสร็จ)
2) HN
3) NAME (ชื่อคนไข้)
4) DATE (11/02/2026)

(พิมพ์ "ยกเลิก" ได้ทุกขั้นตอน)`
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
            `โอเคครับ 👤 ${code}\nส่งรูปใบเสร็จมาได้เลยครับ 🧾\n(1 รูป = 1 ใบเสร็จ)`
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

เลือกประเภทค้นหา:
1) BN (เลขใบเสร็จ)
2) HN
3) NAME (ชื่อคนไข้)
4) DATE (11/02/2026)

พิมพ์เลข 1-4 ได้เลยครับ`
          )
          return res.sendStatus(200)
        }

        // 2) choose type (1-4)
        if (state.step === 'chooseSearchType') {
          const t = text.trim()
          const ok = ['1', '2', '3', '4'].includes(t)

          if (!ok) {
            await reply(
              event.replyToken,
              '❌ เลือกไม่ถูกต้องครับ\nพิมพ์ได้แค่เลข 1 / 2 / 3 / 4\nหรือพิมพ์ "ยกเลิก"'
            )
            return res.sendStatus(200)
          }

          const map = {
            '1': 'BN',
            '2': 'HN',
            '3': 'NAME',
            '4': 'DATE'
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

          // ==== BN ====
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
Total: ${d.total || '-'}`
            )
            return res.sendStatus(200)
          }

          // ==== HN ====
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

          // ==== NAME ====
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

          // ==== DATE ====
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
          '⏱️ รอรูปเกิน 3 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะส่งใหม่ พิมพ์ "ส่งเอกสาร"'
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

      // 5) บันทึกทันที (1 รูป = 1 ใบเสร็จ)
      await sendToSheet(parsed)

      // 6) ตอบกลับ
      await reply(
        event.replyToken,
        `✅ บันทึกเรียบร้อยแล้วครับ

👤 รหัสพนักงาน: ${state.employeeCode}
BN: ${parsed.bn || '-'}
HN: ${parsed.hn || '-'}
Date: ${parsed.receiptDateRaw || '-'}
Total: ${parsed.total || '-'}

(ถ้าจะส่งรูปเพิ่ม พิมพ์ "ส่งเอกสาร")`
      )

      // 7) reset
      state = resetState(userId)
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






