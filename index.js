require('dotenv').config()
const express = require('express')
const axios = require('axios')
const FormData = require('form-data')

const sendToSheet = require('./send-to-sheet')

const app = express()
app.use(express.json())

const LINE_TOKEN = process.env.LINE_TOKEN
const OCRSPACE_KEY = process.env.OCRSPACE_KEY

// ================== SESSION ==================
// idle | waiting_employee_code | waiting_image
// เก็บรูปได้สูงสุด 2 รูป
const sessions = new Map()

function newSession() {
  return {
    step: 'idle',
    employeeCode: '',
    imageCount: 0 // 0,1,2
  }
}

function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, newSession())
  return sessions.get(userId)
}

function resetSession(userId) {
  sessions.set(userId, newSession())
}

// ================== TEXT UTILS ==================
function normalizeText(t = '') {
  return t.toString().trim().replace(/\s+/g, ' ')
}

function isCancelText(text) {
  const t = normalizeText(text).toLowerCase()
  return (
    t.includes('ยกเลิก') ||
    t.includes('เริ่มใหม่') ||
    t === 'cancel' ||
    t === 'reset'
  )
}

function isStartText(text) {
  const t = normalizeText(text)
  return t.replace(/\s/g, '').includes('ส่งเอกสาร')
}

function isHowToText(text) {
  const t = normalizeText(text).toLowerCase()
  const keywords = [
    'ทำไง',
    'ส่งไง',
    'ส่งยังไง',
    'ต้องทำไง',
    'ต้องทำยังไง',
    'ทำยังไง',
    'วิธีส่ง',
    'ใช้ยังไง',
    'ทำอย่างไร',
    'how',
    'help'
  ]
  return keywords.some(k => t.includes(k))
}

function howToMessage() {
  return (
    `📌 วิธีใช้งานคร่าว ๆ\n` +
    `1) พิมพ์คำว่า "ส่งเอกสาร"\n` +
    `2) ใส่รหัสพนักงาน (A0001 - A2000)\n` +
    `3) ส่งรูปเอกสารได้ 1-2 รูป\n\n` +
    `ระบบจะอ่านตัวอักษรและบันทึกลง Google Sheet ให้อัตโนมัติครับ ✅\n` +
    `หากต้องการยกเลิก พิมพ์ "ยกเลิก" ได้ทุกเวลา`
  )
}

// ================== EMPLOYEE CODE VALIDATION ==================
function validateEmployeeCode(input) {
  // ต้องเป็น A0001 - A2000
  const t = normalizeText(input).toUpperCase()

  // ต้องเป็น A + 4 หลัก
  const m = t.match(/^A(\d{4})$/)
  if (!m) return { ok: false, code: '' }

  const num = parseInt(m[1], 10)
  if (num < 1 || num > 2000) return { ok: false, code: '' }

  // normalize ให้เป็น A0001 เสมอ
  const code = 'A' + String(num).padStart(4, '0')
  return { ok: true, code }
}

// ================== WEBHOOK ==================
app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0]
  if (!event) return res.sendStatus(200)

  const userId = event.source?.userId || 'unknown'
  const session = getSession(userId)

  try {
    // ================== TEXT ==================
    if (event.message?.type === 'text') {
      const text = normalizeText(event.message.text)

      // 0) ยกเลิก/เริ่มใหม่
      if (isCancelText(text)) {
        resetSession(userId)
        await reply(
          event.replyToken,
          'ยกเลิกเรียบร้อยครับ ✅\nถ้าต้องการส่งใหม่ พิมพ์ "ส่งเอกสาร" ได้เลย'
        )
        return res.sendStatus(200)
      }

      // 1) help
      if (isHowToText(text)) {
        await reply(event.replyToken, howToMessage())
        return res.sendStatus(200)
      }

      // 2) start
      if (isStartText(text)) {
        session.step = 'waiting_employee_code'
        session.employeeCode = ''
        session.imageCount = 0
        await reply(event.replyToken, 'ได้เลยครับ 👤\nกรุณาพิมพ์รหัสพนักงาน (A0001 - A2000)')
        return res.sendStatus(200)
      }

      // 3) waiting employee code
      if (session.step === 'waiting_employee_code') {
        const v = validateEmployeeCode(text)

        if (!v.ok) {
          await reply(
            event.replyToken,
            'รหัสพนักงานไม่ถูกต้องครับ ❌\nกรุณาใส่รหัสรูปแบบ A0001 ถึง A2000\n(ตัวอย่าง: A0123)'
          )
          return res.sendStatus(200)
        }

        session.employeeCode = v.code
        session.step = 'waiting_image'
        session.imageCount = 0

        await reply(
          event.replyToken,
          `รับรหัสพนักงานแล้วครับ ✅ (${session.employeeCode})\nส่งรูปเอกสารมาได้เลยครับ 📄\n(ส่งได้สูงสุด 2 รูป)`
        )
        return res.sendStatus(200)
      }

      // 4) waiting image แต่ผู้ใช้พิมพ์ข้อความ
      if (session.step === 'waiting_image') {
        await reply(
          event.replyToken,
          `ตอนนี้รอรูปเอกสารอยู่นะครับ 📄\nส่งรูปมาได้เลย (ได้อีก ${2 - session.imageCount} รูป)\nหรือพิมพ์ "ยกเลิก" เพื่อเริ่มใหม่`
        )
        return res.sendStatus(200)
      }

      // 5) idle
      await reply(
        event.replyToken,
        'ถ้าต้องการส่งเอกสาร ให้พิมพ์คำว่า "ส่งเอกสาร" ก่อนครับ\nหรือพิมพ์ "ทำไง" เพื่อดูขั้นตอน'
      )
      return res.sendStatus(200)
    }

    // ================== IMAGE ==================
    if (event.message?.type === 'image') {
      // ยังไม่เริ่ม
      if (session.step !== 'waiting_image') {
        await reply(
          event.replyToken,
          'ก่อนส่งรูป กรุณาพิมพ์ "ส่งเอกสาร" แล้วใส่รหัสพนักงานก่อนครับ 🙂'
        )
        return res.sendStatus(200)
      }

      // เกิน 2 รูป
      if (session.imageCount >= 2) {
        await reply(
          event.replyToken,
          'คุณส่งครบ 2 รูปแล้วครับ ✅\nถ้าต้องการส่งใหม่ พิมพ์ "ส่งเอกสาร" อีกครั้ง'
        )
        resetSession(userId)
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
        await reply(event.replyToken, 'อ่านตัวอักษรไม่ออกครับ 😅\nลองถ่ายให้ชัดขึ้นอีกนิดได้ไหมครับ')
        return res.sendStatus(200)
      }

      // 3) parse
      const parsed = parseOcrText(ocrText)
      parsed.employeeCode = session.employeeCode

      // 4) ส่งเข้า Google Sheet
      await sendToSheet(parsed)

      // เพิ่ม count
      session.imageCount += 1

      // 5) reply
      // ถ้ายังเหลืออีกรูป
      if (session.imageCount < 2) {
        await reply(
          event.replyToken,
          `✅ บันทึกเรียบร้อย (รูปที่ ${session.imageCount}/2)\n` +
            `👤 รหัสพนักงาน: ${parsed.employeeCode}\n` +
            `📄 เลขที่: ${parsed.docNo || '-'}\n` +
            `📅 วันที่: ${parsed.date || '-'}\n\n` +
            `ถ้าต้องการส่งรูปที่ 2 ส่งมาได้เลยครับ 📄\n` +
            `หรือพิมพ์ "ยกเลิก" เพื่อจบ`
        )
        return res.sendStatus(200)
      }

      // ครบ 2 รูปแล้ว
      await reply(
        event.replyToken,
        `✅ บันทึกเรียบร้อย (รูปที่ 2/2)\n` +
          `👤 รหัสพนักงาน: ${parsed.employeeCode}\n` +
          `📄 เลขที่: ${parsed.docNo || '-'}\n` +
          `📅 วันที่: ${parsed.date || '-'}\n\n` +
          `จบรายการแล้วครับ 🎉\nถ้าต้องการส่งใหม่ พิมพ์ "ส่งเอกสาร"`
      )

      // reset หลังครบ 2 รูป
      resetSession(userId)
      return res.sendStatus(200)
    }

    // ================== OTHER MESSAGE TYPES ==================
    if (event.message?.type) {
      if (session.step === 'waiting_image') {
        await reply(
          event.replyToken,
          'ตอนนี้ระบบรับเฉพาะ "รูปเอกสาร" นะครับ 📄\nส่งเป็นรูปถ่าย/สแกนได้เลย หรือพิมพ์ "ยกเลิก"'
        )
        return res.sendStatus(200)
      }

      await reply(
        event.replyToken,
        'ระบบนี้ใช้สำหรับส่ง "รูปเอกสาร" ครับ 📄\nพิมพ์ "ส่งเอกสาร" เพื่อเริ่ม'
      )
      return res.sendStatus(200)
    }

  } catch (err) {
    console.error(err.response?.data || err.message)
  }

  res.sendStatus(200)
})

// ================= OCR =================
async function ocrImage(imageBuffer) {
  const form = new FormData()
  form.append('apikey', OCRSPACE_KEY)
  form.append('language', 'tha')
  form.append('OCREngine', '2')
  form.append('scale', 'true')
  form.append('file', imageBuffer, { filename: 'image.jpg' })

  const res = await axios.post('https://api.ocr.space/parse/image', form, {
    headers: form.getHeaders()
  })

  return res.data?.ParsedResults?.[0]?.ParsedText
}

// ================= PARSER (เช็คหัวข้อ + กันสลับ) =================
function parseOcrText(text) {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

  const findValueByLabel = (labels) => {
    for (const line of lines) {
      for (const lb of labels) {
        const regex = new RegExp(`^${lb}\\s*[:：]?\\s*(.+)$`, 'i')
        const m = line.match(regex)
        if (m && m[1]) return m[1].trim()
      }
    }
    return ''
  }

  const findNextLineAfterLabel = (labels) => {
    for (let i = 0; i < lines.length; i++) {
      for (const lb of labels) {
        if (lines[i].replace(/\s/g, '') === lb.replace(/\s/g, '')) {
          return (lines[i + 1] || '').trim()
        }
      }
    }
    return ''
  }

  const dateLabels = ['วันที่', 'วันที', 'Date']
  const docNoLabels = ['เลขเอกสาร', 'เลขที่เอกสาร', 'เลขที่', 'Doc No', 'Document No']
  const nameLabels = ['ชื่อ', 'ผู้ยื่น', 'ผู้ขอ', 'Name']
  const detailLabels = ['รายละเอียด', 'รายการ', 'Detail']
  const remarkLabels = ['หมายเหตุ', 'Remark']

  let date = findValueByLabel(dateLabels) || findNextLineAfterLabel(dateLabels)
  let docNo = findValueByLabel(docNoLabels) || findNextLineAfterLabel(docNoLabels)
  let name = findValueByLabel(nameLabels) || findNextLineAfterLabel(nameLabels)
  let detail = findValueByLabel(detailLabels) || findNextLineAfterLabel(detailLabels)
  let remark = findValueByLabel(remarkLabels) || findNextLineAfterLabel(remarkLabels)

  const looksLikeDate = (s) => /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(s)
  const looksLikeDocNo = (s) =>
    /[A-Za-z]{1,4}\d{2,}|เลข|No\.?/i.test(s) || /^[0-9\-\/]{4,}$/.test(s)

  if (date && docNo) {
    if (!looksLikeDate(date) && looksLikeDate(docNo)) {
      const tmp = date
      date = docNo
      docNo = tmp
    }
  }

  // ถ้า docNo เป็นวันที่แบบชัดเจน และ date เป็นเลข/โค้ด ก็สลับกลับ
  if (date && docNo) {
    if (looksLikeDocNo(date) && looksLikeDate(docNo)) {
      const tmp = date
      date = docNo
      docNo = tmp
    }
  }

  return {
    date: date || '',
    docNo: docNo || '',
    name: name || '',
    detail: detail || '',
    remark: remark || '',
    raw: text,
    timestamp: new Date().toISOString()
  }
}

// ================= LINE REPLY =================
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

// ================= START =================
app.listen(3000, () => {
  console.log('🚀 LINE webhook running on port 3000')
})


