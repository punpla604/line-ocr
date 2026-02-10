require('dotenv').config()
const express = require('express')
const axios = require('axios')
const FormData = require('form-data')

const sendToSheet = require('./send-to-sheet')

const app = express()
app.use(express.json())

const LINE_TOKEN = process.env.LINE_TOKEN
const OCRSPACE_KEY = process.env.OCRSPACE_KEY

// ================= WEBHOOK =================
app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0]
  if (!event) return res.sendStatus(200)

  try {
    // 📝 text
    if (event.message?.type === 'text') {
      await reply(event.replyToken, 'ส่งรูปเอกสารมาได้เลยครับ 📄')
    }

    // 🖼️ image
    if (event.message?.type === 'image') {
      const messageId = event.message.id

      // 1. ดึงรูปจาก LINE
      const imageRes = await axios.get(
        `https://api-data.line.me/v2/bot/message/${messageId}/content`,
        {
          headers: { Authorization: `Bearer ${LINE_TOKEN}` },
          responseType: 'arraybuffer'
        }
      )

      // 2. OCR
      const ocrText = await ocrImage(imageRes.data)
      console.log('OCR result:', ocrText)

      if (!ocrText) {
        await reply(event.replyToken, 'อ่านตัวอักษรไม่ออกครับ 😅')
        return res.sendStatus(200)
      }

      // 3. parse
      const parsed = parseOcrText(ocrText)
      console.log('PARSED:', parsed)

      // 4. ส่งเข้า Google Sheet
      await sendToSheet(parsed)

      // 5. reply กลับ LINE
      await reply(
        event.replyToken,
        `✅ บันทึกเรียบร้อย
📄 เลขที่: ${parsed.docNo}
📅 วันที่: ${parsed.date}`
      )
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
    return i !== -1 ? lines[i + 1] : ''
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
app.listen(3000, () => {
  console.log('🚀 LINE webhook running on port 3000')
})
