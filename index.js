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

        await reply(event.replyToken, 'กรุณากรอกรหัสพนักงานครับ')
        return res.sendStatus(200)
      }

      // ถ้าอยู่ในขั้นตอนรอรหัส
      if (session.state === 'WAIT_EMPLOYEE_CODE') {
        if (!isValidEmployeeCode(text)) {
          await reply(
            event.replyToken,
            '❌ รหัสพนักงานไม่ถูกต้อง\nกรุณากรอกใหม่'
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

      console.log('SENDING TO SHEET:', JSON.stringify(parsed, null, 2))

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

// ================= PARSER (improved) =================
function parseOcrText(text) {
  const clean = (s) => (s || '')
    .replace(/[ ]+/g, ' ')
    .replace(/[：]/g, ':')
    .trim()

  const raw = text || ''
  const lines = raw
    .split('\n')
    .map(l => clean(l))
    .filter(Boolean)

  // หาแบบ "หัวข้อ: ค่า" หรือ "หัวข้อ ค่า" หรืออยู่บรรทัดถัดไป
  const findValue = (labels) => {
    for (const label of labels) {
      // 1) อยู่บรรทัดเดียวกัน: "วันที่: 01/01/2567"
      let re = new RegExp(`${label}\\s*[:\\-]?\\s*(.+)$`, 'i')
      for (const line of lines) {
        const m = re.exec(line)
        if (m && m[1]) return clean(m[1])
      }

      // 2) อยู่คนละบรรทัด:
      for (let i = 0; i < lines.length - 1; i++) {
        const l = lines[i]
        if (new RegExp(`^${label}\\s*[:\\-]?$`, 'i').test(l)) {
          return clean(lines[i + 1])
        }
      }
    }
    return ''
  }

  let date = findValue(['วันที่', 'วันที', 'DATE'])
  let docNo = findValue(['เลขเอกสาร', 'เลขที่เอกสาร', 'เลขที่', 'Document No', 'Doc No'])
  let name = findValue(['ชื่อ', 'Name'])
  let detail = findValue(['รายละเอียด', 'Detail', 'Description'])
  let remark = findValue(['หมายเหตุ', 'หมาย เหตุ', 'Remark'])

  // ---------- กรองค่าให้สมเหตุสมผล ----------
  const looksLikeDate = (s) =>
    /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(s) ||
    /\b\d{1,2}\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*\d{2,4}\b/.test(s)

  const looksLikeDocNo = (s) =>
    /[A-Z0-9]{3,}/i.test(s) && !looksLikeDate(s)

  // ถ้า docNo ดันเป็นวันที่ → สลับ
  if (looksLikeDate(docNo) && !looksLikeDate(date)) {
    const tmp = docNo
    docNo = date
    date = tmp
  }

  // ถ้า date ไม่เหมือนวันที่เลย แต่ docNo เหมือนวันที่ → สลับ
  if (!looksLikeDate(date) && looksLikeDate(docNo)) {
    const tmp = docNo
    docNo = date
    date = tmp
  }

  // ถ้า docNo เป็นข้อความยาวมาก ให้ทิ้ง
  if (docNo && docNo.length > 40) docNo = ''

  return {
    date,
    docNo,
    name,
    detail,
    remark,
    raw,
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
const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`🚀 LINE webhook running on port ${PORT}`)
})

