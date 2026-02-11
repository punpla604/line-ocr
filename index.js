require('dotenv').config()
const express = require('express')
const axios = require('axios')
const FormData = require('form-data')

const sendToSheet = require('./send-to-sheet')

const app = express()
app.use(express.json())

const LINE_TOKEN = process.env.LINE_TOKEN
const OCRSPACE_KEY = process.env.OCRSPACE_KEY

// ================= SESSION (in-memory) =================
// state: IDLE | WAIT_EMPLOYEE_CODE | READY_FOR_IMAGE
const userSessions = new Map()

function getSession(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, { state: 'IDLE', employeeCode: null })
  }
  return userSessions.get(userId)
}

function resetSession(userId) {
  userSessions.set(userId, { state: 'IDLE', employeeCode: null })
}

// ================= EMPLOYEE CODE VALIDATION =================
function isValidEmployeeCode(code) {
  const m = /^A(\d{4})$/i.exec((code || '').trim())
  if (!m) return false

  const num = parseInt(m[1], 10)
  return num >= 1 && num <= 2000
}

// ================= WEBHOOK =================
app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0]
  if (!event) return res.sendStatus(200)

  const userId = event.source?.userId
  if (!userId) return res.sendStatus(200)

  const session = getSession(userId)

  try {
    // ================= TEXT =================
    if (event.message?.type === 'text') {
      const text = event.message.text?.trim() || ''

      // เริ่มใหม่ทุกครั้งด้วยคำว่า "ส่งเอกสาร"
      if (text === 'ส่งเอกสาร') {
        session.state = 'WAIT_EMPLOYEE_CODE'
        session.employeeCode = null

        await reply(event.replyToken, 'กรุณากรอกรหัสพนักงาน (A0001 - A2000) ครับ')
        return res.sendStatus(200)
      }

      // ถ้าอยู่ในขั้นตอนรอรหัส
      if (session.state === 'WAIT_EMPLOYEE_CODE') {
        if (!isValidEmployeeCode(text)) {
          await reply(
            event.replyToken,
            '❌ รหัสพนักงานไม่ถูกต้อง\nกรุณากรอกใหม่ (A0001 - A2000)'
          )
          return res.sendStatus(200)
        }

        // ผ่าน
        session.state = 'READY_FOR_IMAGE'
        session.employeeCode = text.toUpperCase()

        await reply(
          event.replyToken,
          `✅ ตรวจสอบรหัสพนักงานแล้ว (${session.employeeCode})\nส่งรูปเอกสารมาได้เลยครับ 📄`
        )
        return res.sendStatus(200)
      }

      // ถ้าอยู่ READY แล้ว แต่ user ส่ง text มาแทนรูป
      if (session.state === 'READY_FOR_IMAGE') {
        await reply(
          event.replyToken,
          'ตอนนี้พร้อมรับรูปเอกสารแล้วครับ 📄\nกรุณาส่งรูปได้เลย'
        )
        return res.sendStatus(200)
      }

      // กรณีอื่น ๆ
      await reply(
        event.replyToken,
        'ถ้าต้องการส่งเอกสาร กรุณาพิมพ์คำว่า "ส่งเอกสาร" ก่อนครับ'
      )
      return res.sendStatus(200)
    }

    // ================= IMAGE =================
    if (event.message?.type === 'image') {
      // บังคับให้ต้องเริ่ม flow ก่อนทุกครั้ง
      if (session.state !== 'READY_FOR_IMAGE') {
        await reply(
          event.replyToken,
          'ก่อนส่งรูป กรุณาพิมพ์ "ส่งเอกสาร" และกรอกรหัสพนักงานก่อนครับ'
        )
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
        await reply(event.replyToken, 'อ่านตัวอักษรไม่ออกครับ 😅')
        resetSession(userId)
        return res.sendStatus(200)
      }

      // 3) parse
      const parsed = parseOcrText(ocrText)

      // ใส่รหัสพนักงาน
      parsed.employeeCode = session.employeeCode

      console.log('PARSED:', parsed)

      // 4) ส่งเข้า Google Sheet
      await sendToSheet(parsed)

      // 5) reply กลับ LINE
      await reply(
        event.replyToken,
        `✅ บันทึกเรียบร้อย
👤 รหัสพนักงาน: ${parsed.employeeCode}
📄 เลขที่: ${parsed.docNo || '-'}
📅 วันที่: ${parsed.date || '-'}`
      )

      // reset เพื่อให้เริ่มใหม่ทุกครั้ง
      resetSession(userId)
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

  const res = await axios.post(
    'https://api.ocr.space/parse/image',
    form,
    { headers: form.getHeaders() }
  )

  return res.data?.ParsedResults?.[0]?.ParsedText
}

// ================= PARSER =================
function parseOcrText(text) {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

  const getAfter = (label) => {
    const i = lines.indexOf(label)
    return i !== -1 ? (lines[i + 1] || '') : ''
  }

  return {
    date: getAfter('วันที่'),
    docNo: getAfter('เลขเอกสาร'),
    name: getAfter('ชื่อ'),
    detail: getAfter('รายละเอียด'),
    remark: getAfter('หมายเหตุ'),
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
// Render จะกำหนด PORT ให้เอง
const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`🚀 LINE webhook running on port ${PORT}`)
})
