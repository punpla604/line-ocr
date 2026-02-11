require('dotenv').config()
const express = require('express')
const axios = require('axios')
const FormData = require('form-data')

const sendToSheet = require('./send-to-sheet')

const app = express()
app.use(express.json())

const LINE_TOKEN = process.env.LINE_TOKEN
const OCRSPACE_KEY = process.env.OCRSPACE_KEY
const SHEET_URL = process.env.SHEET_URL // ใช้ทั้งส่งเข้า และค้นหา

// ================== CONFIG ==================
const SESSION_TIMEOUT_MS = 60 * 1000 // 1 นาที
const MAX_IMAGES_PER_SESSION = 2

// ================== เก็บสถานะผู้ใช้ ==================
// userId -> {
//   mode: 'idle' | 'send' | 'search',
//   step: string,
//   employeeCode: '',
//   imagesCount: 0,
//   lastActive: number,
//   searchType: '' // 'byEmployee' | 'byDocNo' | 'byDate'
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

// ================== helper: ตรวจข้อความ ==================
function normalizeText(text) {
  return (text || '').trim()
}

function isCancelMessage(text) {
  const t = normalizeText(text)
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
    'ใช้ยังไง'
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

// ================== helper: ตรวจรูปแบบเอกสาร ==================
function isValidDocumentFormat(ocrText) {
  // เช็คว่ามีคำสำคัญอย่างน้อย 2 คำ
  const t = (ocrText || '').replace(/\s/g, '')

  const keywords = ['วันที่', 'เลขเอกสาร', 'รายละเอียด', 'ชื่อ', 'หมายเหตุ']
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

  const isGarbage = (s) => {
    if (!s) return true

    const hasAlphaNum = /[A-Za-z0-9ก-๙]/.test(s)
    if (!hasAlphaNum) return true

    const onlyThaiMarks = /^[\u0E31-\u0E4E]+$/.test(s)
    if (onlyThaiMarks) return true

    if (s.length <= 1) return true
    return false
  }

  // ดึงค่าได้ทั้งกรณี
  // 1) หัวข้ออยู่บรรทัดเดียว: "เลขเอกสาร TEST-001"
  // 2) หัวข้ออยู่บรรทัดถัดไป:
  //    "เลขเอกสาร"
  //    "TEST-001"
  const getAfter = (labels) => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // แบบหัวข้ออยู่เดี่ยว
      if (labels.includes(line)) {
        for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
          const candidate = lines[j]
          if (!isGarbage(candidate)) return candidate
        }
      }

      // แบบหัวข้อ + ค่าอยู่บรรทัดเดียว
      for (const label of labels) {
        if (line.startsWith(label)) {
          const rest = line.replace(label, '').trim()
          if (!isGarbage(rest)) return rest
        }
      }
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

  // กันสลับ date/docNo
  const looksLikeDate = (s) => /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s || '')

  if (looksLikeDate(parsed.docNo) && !looksLikeDate(parsed.date)) {
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

// ================== SHEET SEARCH ==================
async function querySheet(params) {
  // เรียก Apps Script ด้วย query string (GET)
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
      // ไม่ต้อง reply ถ้าไม่อยากรบกวน แต่ผมแนะนำ reply
      // เพื่อให้ user รู้ว่าทำไมมันไม่รับ
    }

    // ================== TEXT ==================
    if (event.message?.type === 'text') {
      const text = normalizeText(event.message.text)

      // 0) ยกเลิกได้ทุกเวลา
      if (isCancelMessage(text)) {
        if (state.mode === 'idle') {
          await reply(
            event.replyToken,
            'ตอนนี้ยังไม่ได้เริ่มทำรายการครับ 🙂\nถ้าต้องการเริ่ม พิมพ์ "ส่งเอกสาร" หรือ "ค้น" ได้เลย'
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

🟦 ส่งเอกสาร
1) พิมพ์ "ส่งเอกสาร"
2) ใส่รหัสพนักงาน
3) ส่งรูปเอกสาร (ได้สูงสุด 2 รูป / รอบ)
⏱️ ถ้ารอรูปเกิน 1 นาที ระบบจะจบ session อัตโนมัติ

🟩 ค้นหา
1) พิมพ์ "ค้น"
2) ใส่รหัสพนักงาน
3) เลือกค้นได้ 3 แบบ:
- รหัสพนักงาน (ดูจำนวนทั้งหมด)
- เลขเอกสาร (ได้ 1 เอกสาร)
- วันที่ (รูปแบบ 11/02/2026)

พิมพ์ "ยกเลิก" ได้ทุกขั้นตอน`
        )
        return res.sendStatus(200)
      }

      // 2) เริ่มโหมดส่งเอกสาร
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

      // 3) เริ่มโหมดค้นหา
      if (text === 'ค้น') {
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
            `ยืนยันรหัสพนักงานแล้ว: ${code}\nส่งรูปเอกสารมาได้เลยครับ 📄 (ได้สูงสุด 2 รูป)`
          )
          return res.sendStatus(200)
        }

        if (state.step === 'waitingImage') {
          // ถ้าผู้ใช้พิมพ์ข้อความแทนรูป
          await reply(
            event.replyToken,
            `ตอนนี้รอรูปเอกสารอยู่นะครับ 📄
ส่งรูปมาได้เลย (ได้สูงสุด 2 รูป)
⏱️ ถ้ารอเกิน 1 นาที ระบบจะจบ session อัตโนมัติ
หรือพิมพ์ "ยกเลิก"`
          )
          return res.sendStatus(200)
        }

        // fallback
        await reply(event.replyToken, 'ถ้าต้องการส่งเอกสาร กรุณาพิมพ์ "ส่งเอกสาร" ก่อนครับ')
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

เลือกค้นได้ 3 แบบ (พิมพ์ตัวเลข):
1) ค้นด้วยรหัสพนักงาน (ดูจำนวนทั้งหมด)
2) ค้นด้วยเลขเอกสาร (ได้ 1 เอกสาร)
3) ค้นด้วยวันที่ (รูปแบบ 11/02/2026)`
          )
          return res.sendStatus(200)
        }

        // 2) เลือกประเภทค้นหา
        if (state.step === 'waitingSearchType') {
          if (text === '1') {
            state.searchType = 'byEmployee'
            state.step = 'runningSearch'
          } else if (text === '2') {
            state.searchType = 'byDocNo'
            state.step = 'waitingDocNo'
            await reply(event.replyToken, 'กรุณาพิมพ์เลขเอกสารที่ต้องการค้นครับ 📄 (ค้นได้ครั้งละ 1 เอกสาร)')
            return res.sendStatus(200)
          } else if (text === '3') {
            state.searchType = 'byDate'
            state.step = 'waitingDate'
            await reply(event.replyToken, 'กรุณาพิมพ์วันที่รูปแบบนี้เท่านั้น: 11/02/2026 📅')
            return res.sendStatus(200)
          } else {
            await reply(
              event.replyToken,
              `กรุณาเลือก 1, 2 หรือ 3 เท่านั้นครับ

1) รหัสพนักงาน
2) เลขเอกสาร
3) วันที่ (11/02/2026)`
            )
            return res.sendStatus(200)
          }

          // run search by employee (ทันที)
          if (state.searchType === 'byEmployee') {
            const result = await querySheet({
              action: 'countByEmployee',
              employeeCode: state.employeeCode
            })

            if (!result?.ok) {
              await reply(event.replyToken, `❌ ค้นหาไม่สำเร็จครับ\n${result?.error || ''}`)
              resetState(userId)
              return res.sendStatus(200)
            }

            await reply(
              event.replyToken,
              `👤 รหัสพนักงาน: ${state.employeeCode}
📌 ส่งเอกสารไปทั้งหมด: ${result.count || 0} รายการ`
            )

            resetState(userId)
            return res.sendStatus(200)
          }
        }

        // 3) รอเลขเอกสาร
        if (state.step === 'waitingDocNo') {
          const docNo = text.trim()

          if (!docNo || docNo.length < 2) {
            await reply(event.replyToken, '❌ เลขเอกสารไม่ถูกต้องครับ กรุณาพิมพ์ใหม่ หรือพิมพ์ "ยกเลิก"')
            return res.sendStatus(200)
          }

          const result = await querySheet({
            action: 'findByDocNo',
            employeeCode: state.employeeCode,
            docNo
          })

          if (!result?.ok) {
            await reply(event.replyToken, `❌ ค้นหาไม่สำเร็จครับ\n${result?.error || ''}`)
            resetState(userId)
            return res.sendStatus(200)
          }

          if (!result.found) {
            await reply(
              event.replyToken,
              `ไม่พบเอกสารนี้ครับ ❌
👤 ${state.employeeCode}
📄 เลขเอกสาร: ${docNo}`
            )
            resetState(userId)
            return res.sendStatus(200)
          }

          const row = result.data

          await reply(
            event.replyToken,
            `📄 พบเอกสาร 1 รายการ

👤 ${row.employeeCode || '-'}
📅 วันที่: ${row.date || '-'}
📄 เลขเอกสาร: ${row.docNo || '-'}
👤 ชื่อ: ${row.name || '-'}
📝 รายละเอียด: ${row.detail || '-'}
🗒️ หมายเหตุ: ${row.remark || '-'}`
          )

          resetState(userId)
          return res.sendStatus(200)
        }

        // 4) รอวันที่
        if (state.step === 'waitingDate') {
          const dateText = text.trim()

          if (!isValidDateFormat(dateText)) {
            await reply(
              event.replyToken,
              '❌ รูปแบบวันที่ไม่ถูกต้องครับ\nกรุณาพิมพ์รูปแบบนี้เท่านั้น: 11/02/2026\nหรือพิมพ์ "ยกเลิก"'
            )
            return res.sendStatus(200)
          }

          const result = await querySheet({
            action: 'countByDate',
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
📌 มีทั้งหมด: ${result.count || 0} รายการ`
          )

          resetState(userId)
          return res.sendStatus(200)
        }

        // fallback
        await reply(event.replyToken, 'พิมพ์ "ค้น" เพื่อเริ่มค้นหาใหม่ได้เลยครับ')
        return res.sendStatus(200)
      }

      // ================== IDLE MODE ==================
      await reply(
        event.replyToken,
        `พิมพ์คำสั่งได้ 2 แบบครับ:
🟦 "ส่งเอกสาร"
🟩 "ค้น"

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

      // timeout check
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

      // 5) นับจำนวนรูป
      state.imagesCount += 1
      touch(state)

      // 6) reply กลับ LINE
      await reply(
        event.replyToken,
        `✅ บันทึกเรียบร้อย (${state.imagesCount}/${MAX_IMAGES_PER_SESSION})
👤 รหัสพนักงาน: ${parsed.employeeCode}
📄 เลขที่: ${parsed.docNo || '-'}
📅 วันที่: ${parsed.date || '-'}

${state.imagesCount < MAX_IMAGES_PER_SESSION ? 'ส่งรูปถัดไปได้เลยครับ 📄 (หรือพิมพ์ "ยกเลิก")' : 'ครบ 2 รูปแล้ว ระบบจบรายการให้ครับ'}`
      )

      // 7) reset เมื่อครบ 2 รูป
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




