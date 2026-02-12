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

// ================== CONFIG ==================
const SESSION_TIMEOUT_MS = 60 * 1000 // 1 นาที
const MAX_IMAGES_PER_SESSION = 2

// ================== STATE ==================
// userId -> {
//   mode: 'idle' | 'send' | 'search',
//   step: string,
//   employeeCode: '',
//   imagesCount: 0,
//   lastActive: number,
//   searchType: '',
// }
const userState = new Map()

function now() {
  return Date.now()
}

function getState(userId) {
  if (!userState.has(userId)) {
    userState.set(userId, {
      mode: 'idle',
      step: 'idle',
      employeeCode: '',
      imagesCount: 0,
      lastActive: now(),
      searchType: ''
    })
  }
  return userState.get(userId)
}

function resetState(userId) {
  userState.set(userId, {
    mode: 'idle',
    step: 'idle',
    employeeCode: '',
    imagesCount: 0,
    lastActive: now(),
    searchType: ''
  })
}

function touch(state) {
  state.lastActive = now()
}

function isSessionExpired(state) {
  if (!state || state.mode === 'idle') return false
  return now() - (state.lastActive || 0) > SESSION_TIMEOUT_MS
}

// ================== TEXT HELPERS ==================
function normalizeText(text) {
  return (text || '').trim()
}

function isCancelMessage(text) {
  const t = normalizeText(text).toLowerCase()
  return t === 'ยกเลิก' || t === 'cancel'
}

function isHelpMessage(text) {
  const t = normalizeText(text)
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
    'ใช้ยังไง',
    'ส่งเอกสารยังไง',
    'ค้นยังไง',
    'ค้นหา',
    'วิธีใช้',
    'search'
  ]
  return keywords.some(k => t.includes(k))
}

function normalizeEmployeeCode(text) {
  return (text || '').trim().toUpperCase().replace(/\s+/g, '')
}

function isValidEmployeeCode(code) {
  // รูปแบบ A0001 - A2000
  if (!/^A\d{4}$/.test(code)) return false
  const num = parseInt(code.slice(1), 10)
  return num >= 1 && num <= 2000
}

function isValidDateFormat(text) {
  // บังคับรูปแบบ 11/02/2026
  const t = (text || '').trim()
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return false

  const [dd, mm, yyyy] = t.split('/').map(n => parseInt(n, 10))
  if (yyyy < 2000 || yyyy > 2100) return false
  if (mm < 1 || mm > 12) return false
  if (dd < 1 || dd > 31) return false
  return true
}

// ================== RECEIPT FORMAT CHECK ==================
function isAsokeReceipt(ocrText) {
  const t = (ocrText || '').toLowerCase()

  const hasReceipt = t.includes('receipt')
  const hasAsoke = t.includes('asoke skin hospital')
  const hasBN = /\bbn\b/.test(t) || t.includes('bn ')

  const score = [hasReceipt, hasAsoke, hasBN].filter(Boolean).length
  return score >= 2
}

// ================== OCR ==================
async function ocrImage(imageBuffer) {
  const form = new FormData()
  form.append('apikey', OCRSPACE_KEY)
  form.append('language', 'eng') // ใบเสร็จนี้เป็นอังกฤษเยอะ
  form.append('OCREngine', '2')
  form.append('scale', 'true')
  form.append('file', imageBuffer, { filename: 'image.jpg' })

  const res = await axios.post(
    'https://api.ocr.space/parse/image',
    form,
    { headers: form.getHeaders() }
  )

  return res.data?.ParsedResults?.[0]?.ParsedText
}

// ================== RECEIPT PARSER ==================
function parseReceiptOcr(text) {
  const raw = text || ''

  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

  const join = lines.join('\n')

  // BN
  // ตัวอย่าง: BN L89-01-002-761
  const bnMatch =
    join.match(/BN\s*[:\-]?\s*([A-Z0-9\-]{6,})/i) ||
    join.match(/\bL\d{2,3}\-\d{2}\-\d{3}\-\d{3}\b/i)

  const bn = bnMatch ? (bnMatch[1] || bnMatch[0]).trim() : ''

  // Date + Time
  // ตัวอย่าง: Date 31 January 2026 Time 18:01:02
  let dateText = ''
  let timeText = ''

  const dateTimeMatch = join.match(/Date\s*(.+?)\s*Time\s*([0-9]{1,2}:[0-9]{2}:[0-9]{2})/i)
  if (dateTimeMatch) {
    dateText = (dateTimeMatch[1] || '').trim()
    timeText = (dateTimeMatch[2] || '').trim()
  }

  // HN
  // ตัวอย่าง: HN 01-01-26-047
  const hnMatch = join.match(/HN\s*[:\-]?\s*([0-9\-]{5,})/i)
  const hn = hnMatch ? hnMatch[1].trim() : ''

  // Name
  // ตัวอย่าง: Name Ms. Lanne Comnual
  const nameMatch = join.match(/Name\s*[:\-]?\s*(.+)/i)
  const name = nameMatch ? nameMatch[1].trim() : ''

  // Payment
  // ตัวอย่าง: Type of Payment : CreditCard
  const payMatch = join.match(/Type\s*of\s*Payment\s*[:\-]?\s*(.+)/i)
  const paymentType = payMatch ? payMatch[1].trim() : ''

  // VAT
  const vatMatch = join.match(/\bVAT\b\s*[:\-]?\s*([0-9\.,]+)/i)
  const vat = vatMatch ? vatMatch[1].trim() : ''

  // Total
  // ตัวอย่าง: Total 14,910.00
  const totalMatch = join.match(/\bTotal\b\s*[:\-]?\s*([0-9\.,]+)/i)
  const total = totalMatch ? totalMatch[1].trim() : ''

  // Items (รายการ + ราคา)
  // รูปแบบ:
  // 1 DOCTOR FEE 7,560.00
  // 2 LASER THERAPY 500.00
  // ...
  const items = []

  for (const line of lines) {
    // 1 DOCTOR FEE 7,560.00
    const m = line.match(/^(\d{1,2})\s+(.+?)\s+([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)$/)
    if (m) {
      items.push({
        no: m[1].trim(),
        description: m[2].trim(),
        amount: m[3].trim()
      })
    }
  }

  // fallback: total อาจอยู่บรรทัด "CreditCard 14,910.00"
  if (!total) {
    const ccMatch = join.match(/CreditCard\s*([0-9\.,]+)/i)
    if (ccMatch) {
      // ไม่ 100% แต่ช่วยได้
      // ถ้า total ยังว่าง
      // eslint-disable-next-line no-unused-vars
      const guess = ccMatch[1].trim()
    }
  }

  return {
    bn,
    dateText,
    timeText,
    hn,
    name,
    paymentType,
    vat,
    total,
    items,
    raw,
    timestamp: new Date().toISOString()
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
      }
    }
  )
}

// ================== SHEET SEARCH ==================
async function querySheet(params) {
  const res = await axios.get(SHEET_URL, { params })
  return res.data
}

// ================= WEBHOOK =================
app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0]
  if (!event) return res.sendStatus(200)

  const userId = event.source?.userId || 'unknown'
  const state = getState(userId)

  try {
    // ================== session timeout ==================
    if (isSessionExpired(state)) {
      resetState(userId)
    }

    // ================== TEXT ==================
    if (event.message?.type === 'text') {
      const text = normalizeText(event.message.text)

      // 0) ยกเลิก
      if (isCancelMessage(text)) {
        if (state.mode === 'idle') {
          await reply(
            event.replyToken,
            'ตอนนี้ยังไม่ได้เริ่มทำรายการครับ 🙂\nพิมพ์ "ส่งเอกสาร" หรือ "ค้นหา" ได้เลย'
          )
          return res.sendStatus(200)
        }

        resetState(userId)
        await reply(event.replyToken, '❌ ยกเลิกเรียบร้อยครับ')
        return res.sendStatus(200)
      }

      // 1) help
      if (isHelpMessage(text)) {
        await reply(
          event.replyToken,
          `📌 วิธีใช้งาน

🧾 ส่งใบเสร็จ
- พิมพ์ "ส่งเอกสาร"
- ใส่รหัสพนักงาน
- ส่งรูปใบเสร็จ (ได้สูงสุด 2 รูป / รอบ)
⏱️ ถ้ารอรูปเกิน 1 นาที ระบบจะจบ session อัตโนมัติ

🔎 ค้นหา
- พิมพ์ "ค้นหา"
- ใส่รหัสพนักงาน
- เลือกค้นหาได้:
1) ชื่อคนไข้ (Name)
2) เลขใบเสร็จ (BN)
3) HN
4) วันที่ (รูปแบบ 11/02/2026)

พิมพ์ "ยกเลิก" ได้ทุกขั้นตอน`
        )
        return res.sendStatus(200)
      }

      // 2) start send
      if (text === 'ส่งเอกสาร') {
        state.mode = 'send'
        state.step = 'waitingEmployeeCode'
        state.employeeCode = ''
        state.imagesCount = 0
        state.searchType = ''
        touch(state)

        await reply(event.replyToken, 'กรุณาพิมพ์รหัสพนักงานครับ 👤')
        return res.sendStatus(200)
      }

      // 3) start search
      if (text === 'ค้นหา') {
        state.mode = 'search'
        state.step = 'waitingEmployeeCodeForSearch'
        state.employeeCode = ''
        state.searchType = ''
        state.imagesCount = 0
        touch(state)

        await reply(event.replyToken, 'กรุณาพิมพ์รหัสพนักงานเพื่อยืนยันก่อนครับ 👤')
        return res.sendStatus(200)
      }

      // ================== SEND MODE ==================
      if (state.mode === 'send') {
        touch(state)

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

          await reply(
            event.replyToken,
            `ยืนยันรหัสพนักงานแล้ว: ${code}\nส่งรูปใบเสร็จมาได้เลยครับ 🧾 (ได้สูงสุด 2 รูป)`
          )
          return res.sendStatus(200)
        }

        if (state.step === 'waitingImage') {
          await reply(
            event.replyToken,
            `ตอนนี้รอรูปใบเสร็จอยู่นะครับ 🧾
ส่งรูปมาได้เลย (ได้สูงสุด 2 รูป)
⏱️ ถ้ารอเกิน 1 นาที ระบบจะจบ session อัตโนมัติ
หรือพิมพ์ "ยกเลิก"`
          )
          return res.sendStatus(200)
        }

        await reply(event.replyToken, 'ถ้าต้องการส่งใบเสร็จ กรุณาพิมพ์ "ส่งเอกสาร" ก่อนครับ')
        return res.sendStatus(200)
      }

      // ================== SEARCH MODE ==================
      if (state.mode === 'search') {
        touch(state)

        // 1) รอ employeeCode
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
          state.step = 'waitingSearchType'

          await reply(
            event.replyToken,
            `ยืนยันรหัสพนักงานแล้ว: ${code}

เลือกค้นหาได้ 4 แบบ (พิมพ์ตัวเลข):
1) ชื่อคนไข้ (Name)
2) เลขใบเสร็จ (BN)
3) HN
4) วันที่ (ตัวอย่าง 11/02/2026)`
          )
          return res.sendStatus(200)
        }

        // 2) เลือกประเภทค้นหา
        if (state.step === 'waitingSearchType') {
          if (text === '1') {
            state.searchType = 'byName'
            state.step = 'waitingName'
            await reply(event.replyToken, 'กรุณาพิมพ์ชื่อคนไข้ (Name) ที่ต้องการค้นหาครับ 👤')
            return res.sendStatus(200)
          }

          if (text === '2') {
            state.searchType = 'byBN'
            state.step = 'waitingBN'
            await reply(event.replyToken, 'กรุณาพิมพ์เลขใบเสร็จ (BN) ที่ต้องการค้นหาครับ 🧾')
            return res.sendStatus(200)
          }

          if (text === '3') {
            state.searchType = 'byHN'
            state.step = 'waitingHN'
            await reply(event.replyToken, 'กรุณาพิมพ์ HN ที่ต้องการค้นหาครับ 🏥')
            return res.sendStatus(200)
          }

          if (text === '4') {
            state.searchType = 'byDate'
            state.step = 'waitingDate'
            await reply(event.replyToken, 'กรุณาพิมพ์วันที่รูปแบบนี้เท่านั้น: ตัวอย่าง 11/02/2026 📅')
            return res.sendStatus(200)
          }

          await reply(
            event.replyToken,
            `กรุณาเลือก 1, 2, 3 หรือ 4 เท่านั้นครับ

1) ชื่อคนไข้ (Name)
2) เลขใบเสร็จ (BN)
3) HN
4) วันที่ (ตัวอย่าง 11/02/2026)`
          )
          return res.sendStatus(200)
        }

        // ===== name =====
        if (state.step === 'waitingName') {
          const name = text.trim()
          if (!name || name.length < 2) {
            await reply(event.replyToken, '❌ ชื่อไม่ถูกต้องครับ กรุณาพิมพ์ใหม่ หรือพิมพ์ "ยกเลิก"')
            return res.sendStatus(200)
          }

          const result = await querySheet({
            action: 'findByName',
            employeeCode: state.employeeCode,
            name
          })

          if (!result?.ok) {
            await reply(event.replyToken, `❌ ค้นหาไม่สำเร็จครับ\n${result?.error || ''}`)
            resetState(userId)
            return res.sendStatus(200)
          }

          const list = result.list || []
          if (list.length === 0) {
            await reply(
              event.replyToken,
              `ไม่พบใบเสร็จของชื่อนี้ครับ ❌
👤 ${state.employeeCode}
👤 Name: ${name}`
            )
            resetState(userId)
            return res.sendStatus(200)
          }

          // แสดงแบบ list (ไม่ยาวเกิน)
          const preview = list.slice(0, 10).map((r, i) => {
            return `${i + 1}) BN: ${r.bn || '-'} | ${r.dateShort || r.dateText || '-'} | Total: ${r.total || '-'}`
          }).join('\n')

          await reply(
            event.replyToken,
            `👤 Name: ${name}
📌 พบทั้งหมด: ${list.length} ใบ

${preview}
${list.length > 10 ? '\n... (แสดงแค่ 10 รายการแรก)' : ''}`
          )

          resetState(userId)
          return res.sendStatus(200)
        }

        // ===== BN =====
        if (state.step === 'waitingBN') {
          const bn = text.trim()
          if (!bn || bn.length < 4) {
            await reply(event.replyToken, '❌ BN ไม่ถูกต้องครับ กรุณาพิมพ์ใหม่ หรือพิมพ์ "ยกเลิก"')
            return res.sendStatus(200)
          }

          const result = await querySheet({
            action: 'findByBN',
            employeeCode: state.employeeCode,
            bn
          })

          if (!result?.ok) {
            await reply(event.replyToken, `❌ ค้นหาไม่สำเร็จครับ\n${result?.error || ''}`)
            resetState(userId)
            return res.sendStatus(200)
          }

          if (!result.found) {
            await reply(
              event.replyToken,
              `ไม่พบใบเสร็จนี้ครับ ❌
👤 ${state.employeeCode}
🧾 BN: ${bn}`
            )
            resetState(userId)
            return res.sendStatus(200)
          }

          const r = result.data

          // สรุปรายการแบบอ่านง่าย
          const items = (r.items || []).slice(0, 15).map(it => {
            return `- ${it.description} : ${it.amount}`
          }).join('\n')

          await reply(
            event.replyToken,
            `🧾 พบใบเสร็จ 1 ใบ

BN: ${r.bn || '-'}
Date: ${r.dateText || '-'}
Time: ${r.timeText || '-'}
HN: ${r.hn || '-'}
Name: ${r.name || '-'}
Payment: ${r.paymentType || '-'}
VAT: ${r.vat || '-'}
Total: ${r.total || '-'}

รายการ:
${items || '-'}

${(r.items || []).length > 15 ? '\n... (รายการยาว แสดงแค่ 15 บรรทัดแรก)' : ''}`
          )

          resetState(userId)
          return res.sendStatus(200)
        }

        // ===== HN =====
        if (state.step === 'waitingHN') {
          const hn = text.trim()
          if (!hn || hn.length < 4) {
            await reply(event.replyToken, '❌ HN ไม่ถูกต้องครับ กรุณาพิมพ์ใหม่ หรือพิมพ์ "ยกเลิก"')
            return res.sendStatus(200)
          }

          const result = await querySheet({
            action: 'findByHN',
            employeeCode: state.employeeCode,
            hn
          })

          if (!result?.ok) {
            await reply(event.replyToken, `❌ ค้นหาไม่สำเร็จครับ\n${result?.error || ''}`)
            resetState(userId)
            return res.sendStatus(200)
          }

          const list = result.list || []
          if (list.length === 0) {
            await reply(
              event.replyToken,
              `ไม่พบใบเสร็จของ HN นี้ครับ ❌
👤 ${state.employeeCode}
🏥 HN: ${hn}`
            )
            resetState(userId)
            return res.sendStatus(200)
          }

          const preview = list.slice(0, 10).map((r, i) => {
            return `${i + 1}) BN: ${r.bn || '-'} | ${r.dateShort || r.dateText || '-'} | Total: ${r.total || '-'}`
          }).join('\n')

          await reply(
            event.replyToken,
            `🏥 HN: ${hn}
📌 พบทั้งหมด: ${list.length} ใบ

${preview}
${list.length > 10 ? '\n... (แสดงแค่ 10 รายการแรก)' : ''}`
          )

          resetState(userId)
          return res.sendStatus(200)
        }

        // ===== Date =====
        if (state.step === 'waitingDate') {
          const dateText = text.trim()

          if (!isValidDateFormat(dateText)) {
            await reply(
              event.replyToken,
              '❌ รูปแบบวันที่ไม่ถูกต้องครับ\nกรุณาพิมพ์รูปแบบนี้เท่านั้น: ตัวอย่าง 11/02/2026\nหรือพิมพ์ "ยกเลิก"'
            )
            return res.sendStatus(200)
          }

          const result = await querySheet({
            action: 'countByDateReceipt',
            employeeCode: state.employeeCode,
            date: dateText
          })

          if (!result?.ok) {
            await reply(event.replyToken, `❌ ค้นหาไม่สำเร็จครับ\n${result?.error || ''}`)
            resetState(userId)
            return res.sendStatus(200)
          }

          await reply(
            event.replyToken,
            `📅 วันที่: ${dateText}
👤 รหัสพนักงาน: ${state.employeeCode}
📌 มีทั้งหมด: ${result.count || 0} ใบเสร็จ`
          )

          resetState(userId)
          return res.sendStatus(200)
        }

        await reply(event.replyToken, 'พิมพ์ "ค้นหา" เพื่อเริ่มค้นหาใหม่ได้เลยครับ')
        return res.sendStatus(200)
      }

      // ================== IDLE ==================
      await reply(
        event.replyToken,
        `พิมพ์คำสั่งได้ 2 แบบครับ:
🧾 "ส่งเอกสาร"
🔎 "ค้นหา"

หรือพิมพ์ "ทำไง" เพื่อดูวิธีใช้งาน`
      )
      return res.sendStatus(200)
    }

    // ================== IMAGE ==================
    if (event.message?.type === 'image') {
      // รับรูปได้เฉพาะ send mode และ step waitingImage
      if (state.mode !== 'send' || state.step !== 'waitingImage' || !state.employeeCode) {
        await reply(
          event.replyToken,
          'ก่อนส่งรูป กรุณาพิมพ์ "ส่งเอกสาร" แล้วใส่รหัสพนักงานก่อนครับ 🙂'
        )
        return res.sendStatus(200)
      }

      // timeout
      if (isSessionExpired(state)) {
        resetState(userId)
        await reply(event.replyToken, '⏱️ หมดเวลาแล้วครับ (เกิน 1 นาที)\nกรุณาเริ่มใหม่โดยพิมพ์ "ส่งเอกสาร"')
        return res.sendStatus(200)
      }

      touch(state)

      // จำกัด 2 รูป
      if (state.imagesCount >= MAX_IMAGES_PER_SESSION) {
        await reply(
          event.replyToken,
          '❌ ส่งได้สูงสุด 2 รูปต่อ 1 รอบเท่านั้นครับ\nถ้าต้องการส่งเพิ่ม กรุณาพิมพ์ "ส่งเอกสาร" เพื่อเริ่มใหม่'
        )
        resetState(userId)
        return res.sendStatus(200)
      }

      const messageId = event.message.id

      // 1) ดึงรูปจาก LINE
      const imageRes = await axios.get(
        `https://api-data.line.me/v2/bot/message/${messageId}/content`,
        {
          headers: { Authorization: `Bearer ${LINE_TOKEN}` },
          responseType: 'arraybuffer'
        }
      )

      // 2) OCR
      const ocrText = await ocrImage(imageRes.data)
      console.log('OCR result:', ocrText)

      if (!ocrText) {
        await reply(event.replyToken, 'อ่านตัวอักษรไม่ออกครับ 😅 กรุณาลองถ่ายใหม่ให้ชัดขึ้น')
        return res.sendStatus(200)
      }

      // 3) เช็ครูปแบบใบเสร็จ
      if (!isAsokeReceipt(ocrText)) {
        await reply(
          event.replyToken,
          '❌ รูปนี้ไม่ใช่ใบเสร็จ Asoke Skin Hospital ที่รองรับครับ\nกรุณาส่งใบเสร็จตามแบบฟอร์ม (ต้องมี Receipt / Asoke Skin Hospital / BN)'
        )
        return res.sendStatus(200)
      }

      // 4) parse
      const parsed = parseReceiptOcr(ocrText)
      parsed.employeeCode = state.employeeCode

      // กันกรณี BN หาย
      if (!parsed.bn) {
        await reply(
          event.replyToken,
          '❌ อ่าน BN ไม่ได้ครับ\nกรุณาถ่ายให้เห็นมุมขวาบนชัด ๆ (ตรง BN) แล้วส่งใหม่'
        )
        return res.sendStatus(200)
      }

      // 5) ส่งเข้า Google Sheet
      await sendToSheet(parsed)

      // 6) นับรูป
      state.imagesCount += 1
      touch(state)

      await reply(
        event.replyToken,
        `✅ บันทึกใบเสร็จเรียบร้อย (${state.imagesCount}/${MAX_IMAGES_PER_SESSION})

👤 รหัสพนักงาน: ${parsed.employeeCode}
🧾 BN: ${parsed.bn || '-'}
👤 Name: ${parsed.name || '-'}
🏥 HN: ${parsed.hn || '-'}
📅 Date: ${parsed.dateText || '-'}
💳 Payment: ${parsed.paymentType || '-'}
💰 Total: ${parsed.total || '-'}

${state.imagesCount < MAX_IMAGES_PER_SESSION
          ? 'ส่งรูปถัดไปได้เลยครับ 🧾 (หรือพิมพ์ "ยกเลิก")'
          : 'ครบ 2 รูปแล้ว ระบบจบรายการให้ครับ'}`
      )

      if (state.imagesCount >= MAX_IMAGES_PER_SESSION) {
        resetState(userId)
      }

      return res.sendStatus(200)
    }

  } catch (err) {
    console.error(err.response?.data || err.message)
  }

  res.sendStatus(200)
})

// ================= START =================
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 LINE webhook running on port ${PORT}`)
})




