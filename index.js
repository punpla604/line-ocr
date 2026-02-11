require('dotenv').config()
const express = require('express')
const axios = require('axios')
const FormData = require('form-data')

const sendToSheet = require('./send-to-sheet')

const app = express()
app.use(express.json())

const LINE_TOKEN = process.env.LINE_TOKEN
const OCRSPACE_KEY = process.env.OCRSPACE_KEY

// ================== เก็บสถานะผู้ใช้ ==================
// userId -> { step: 'idle' | 'waitingEmployeeCode' | 'waitingImage', employeeCode: '' }
const userState = new Map()

function getState(userId) {
  if (!userState.has(userId)) {
    userState.set(userId, { step: 'idle', employeeCode: '' })
  }
  return userState.get(userId)
}

function resetState(userId) {
  userState.set(userId, { step: 'idle', employeeCode: '' })
}

// ================== helper: ตรวจข้อความช่วยเหลือ ==================
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
    'เริ่มยังไง'
  ]
  return keywords.some(k => t.includes(k))
}

// 0) ยกเลิก (เฉพาะตอนมีขั้นตอนค้างอยู่)
if (isCancelMessage(text)) {
  if (state.step === 'idle') {
    await reply(event.replyToken, 'ตอนนี้ยังไม่ได้เริ่มส่งเอกสารครับ 🙂\nถ้าต้องการเริ่ม กรุณาพิมพ์ "ส่งเอกสาร"')
    return res.sendStatus(200)
  }

  resetState(userId)
  await reply(event.replyToken, '❌ ยกเลิกเรียบร้อยครับ')
  return res.sendStatus(200)
}


// ================== helper: ตรวจรหัสพนักงาน ==================
function normalizeEmployeeCode(text) {
  return (text || '').trim().toUpperCase().replace(/\s+/g, '')
}

function isValidEmployeeCode(code) {
  // รูปแบบ A0001 - A2000
  if (!/^A\d{4}$/.test(code)) return false

  const num = parseInt(code.slice(1), 10)
  return num >= 1 && num <= 2000
}

// ================== helper: ตรวจรูปแบบเอกสาร ==================
function isValidDocumentFormat(ocrText) {
  // เช็คว่ามีคำสำคัญอย่างน้อย 2 คำ
  const t = (ocrText || '').replace(/\s/g, '')

  const keywords = [
    'วันที่',
    'เลขเอกสาร',
    'รายละเอียด',
    'ชื่อ',
    'หมายเหตุ'
  ]

  const hit = keywords.filter(k => t.includes(k)).length
  return hit >= 2
}

// ================== OCR ==================
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

// ================== PARSER ==================
function parseOcrText(text) {
  const lines = (text || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

  // ตรวจว่าเป็นบรรทัดขยะไหม เช่น "่" "ๆ" "-" หรือไม่มีตัวอักษรเลย
  const isGarbage = (s) => {
    if (!s) return true

    // ถ้าไม่มีตัวอักษร/ตัวเลขเลย => ขยะ
    const hasAlphaNum = /[A-Za-z0-9ก-๙]/.test(s)
    if (!hasAlphaNum) return true

    // ถ้าเป็นวรรณยุกต์/สระไทยล้วน ๆ
    const onlyThaiMarks = /^[\u0E31-\u0E4E]+$/.test(s)
    if (onlyThaiMarks) return true

    // สั้นเกินไป
    if (s.length <= 1) return true

    return false
  }

  const getAfter = (labels) => {
    // labels: array ของหัวข้อที่อาจเป็นไปได้
    const idx = lines.findIndex(l => labels.includes(l))
    if (idx === -1) return ''

    // ไล่หาค่าที่ไม่ใช่ขยะ ภายใน 6 บรรทัดถัดไป
    for (let j = idx + 1; j < Math.min(idx + 7, lines.length); j++) {
      const candidate = lines[j]
      if (!isGarbage(candidate)) return candidate
    }
    return ''
  }

  const parsed = {
    date: getAfter(['วันที่', 'วันที']),
    docNo: getAfter(['เลขเอกสาร', 'เลขที่เอกสาร', 'เลขที่']),
    name: getAfter(['ชื่อ', 'ชือ']),
    detail: getAfter(['รายละเอียด']),
    remark: getAfter(['หมายเหตุ']),
    raw: text,
    timestamp: new Date().toISOString()
  }

  // ================== กันสลับ date/docNo ==================
  // ถ้า docNo ดันเป็นวันที่ และ date ดันเป็นรหัสเอกสาร => สลับกลับ
  const looksLikeDate = (s) => {
    if (!s) return false
    return /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s)
  }

  if (looksLikeDate(parsed.docNo) && !looksLikeDate(parsed.date)) {
    // อาจสลับ
    const tmp = parsed.docNo
    parsed.docNo = parsed.date
    parsed.date = tmp
  }

  return parsed
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

// ================= WEBHOOK =================
app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0]
  if (!event) return res.sendStatus(200)

  const userId = event.source?.userId
  const state = getState(userId)

  try {
    // ================== TEXT ==================
    if (event.message?.type === 'text') {
      const text = (event.message.text || '').trim()

      // 0) ยกเลิกได้ทุกเวลา
      if (isCancelMessage(text)) {
        resetState(userId)
        await reply(event.replyToken, '❌ ยกเลิกเรียบร้อยครับ')
        return res.sendStatus(200)
      }

      // 1) help
      if (isHelpMessage(text)) {
        await reply(
          event.replyToken,
          `📌 วิธีส่งเอกสาร
1) พิมพ์ "ส่งเอกสาร"
2) ใส่รหัสพนักงาน
3) ส่งรูปเอกสารเข้ามา
ระบบจะอ่านและบันทึกเข้า Google Sheet ให้ครับ ✅

(พิมพ์ "ยกเลิก" ได้ทุกขั้นตอน)`
        )
        return res.sendStatus(200)
      }

      // 2) เริ่มส่งเอกสาร
      if (text === 'ส่งเอกสาร') {
        state.step = 'waitingEmployeeCode'
        state.employeeCode = ''
        await reply(event.replyToken, 'กรุณาพิมพ์รหัสพนักงานครับ 👤')
        return res.sendStatus(200)
      }

      // 3) รอรหัสพนักงาน
      if (state.step === 'waitingEmployeeCode') {
        const code = normalizeEmployeeCode(text)

        if (!isValidEmployeeCode(code)) {
          await reply(
            event.replyToken,
            '❌ รหัสพนักงานไม่ถูกต้องครับ\nกรุณาพิมพ์ใหม่อีกครั้ง\nหรือพิมพ์ "ยกเลิก" เพื่อออกจากขั้นตอนนี้'
          )
          return res.sendStatus(200)
        }

        state.employeeCode = code
        state.step = 'waitingImage'

        await reply(
          event.replyToken,
          'ส่งรูปเอกสารมาได้เลยครับ 📄'
        )
        return res.sendStatus(200)
      }

      // 4) ถ้ารอรูป แต่ผู้ใช้พิมพ์ข้อความมา
      if (state.step === 'waitingImage') {
        await reply(
          event.replyToken,
          'ตอนนี้รอรูปเอกสารอยู่นะครับ 📄\nส่งรูปมาได้เลย หรือพิมพ์ "ยกเลิก"'
        )
        return res.sendStatus(200)
      }

      // 5) กรณีอื่น ๆ (ยังไม่เริ่ม)
      await reply(
        event.replyToken,
        'ถ้าต้องการส่งเอกสาร กรุณาพิมพ์คำว่า "ส่งเอกสาร" ก่อนครับ\nหรือพิมพ์ "ทำไง" เพื่อดูวิธีใช้งาน'
      )
      return res.sendStatus(200)
    }

    // ================== IMAGE ==================
    if (event.message?.type === 'image') {
      // ต้องอยู่ใน step รอรูปเท่านั้น
      if (state.step !== 'waitingImage' || !state.employeeCode) {
        await reply(
          event.replyToken,
          'ก่อนส่งรูป กรุณาพิมพ์ "ส่งเอกสาร" แล้วใส่รหัสพนักงานก่อนครับ 🙂'
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
        await reply(event.replyToken, 'อ่านตัวอักษรไม่ออกครับ 😅 กรุณาลองถ่ายใหม่ให้ชัดขึ้น')
        return res.sendStatus(200)
      }

      // 2.1) ตรวจรูปแบบเอกสาร
      if (!isValidDocumentFormat(ocrText)) {
        await reply(
          event.replyToken,
          '❌ รูปนี้ไม่ใช่เอกสารรูปแบบที่รองรับครับ\nกรุณาส่งรูปเอกสารตามแบบฟอร์มที่กำหนด 📄'
        )
        return res.sendStatus(200)
      }

      // 3) parse
      const parsed = parseOcrText(ocrText)
      parsed.employeeCode = state.employeeCode

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

      // 6) reset state (ให้เริ่มใหม่ทุกครั้ง)
      resetState(userId)

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



