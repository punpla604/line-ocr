require('dotenv').config()
const express = require('express')
const axios = require('axios')
const FormData = require('form-data')

const sendToSheet = require('./send-to-sheet')
const querySheet = require('./query-sheet') // <-- เพิ่มไฟล์นี้ (ผมจะให้โค้ดให้)

const app = express()
app.use(express.json())

const LINE_TOKEN = process.env.LINE_TOKEN
const OCRSPACE_KEY = process.env.OCRSPACE_KEY

// ================== เก็บสถานะผู้ใช้ ==================
// userId -> {
//   mode: 'idle' | 'upload' | 'search',
//   step: ...
// }
const userState = new Map()

function getState(userId) {
  if (!userState.has(userId)) {
    userState.set(userId, {
      mode: 'idle',
      step: 'idle',

      employeeCode: '',

      // upload
      images: [], // เก็บ OCR text ของแต่ละรูป
      waitingSince: null, // timestamp ตอนเริ่มรอรูป

      // search
      searchType: '',
      searchValue: '',
      searchWaitingSince: null
    })
  }
  return userState.get(userId)
}

function resetState(userId) {
  userState.set(userId, {
    mode: 'idle',
    step: 'idle',
    employeeCode: '',
    images: [],
    waitingSince: null,
    searchType: '',
    searchValue: '',
    searchWaitingSince: null
  })
}

// ================== helper: cancel ==================
function isCancelMessage(text) {
  const t = (text || '').trim()
  return ['ยกเลิก', 'cancel', 'ออก', 'เลิก'].includes(t.toLowerCase())
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

// ================== helper: normalize employeeCode ==================
function normalizeEmployeeCode(text) {
  return (text || '').trim().toUpperCase().replace(/\s+/g, '')
}

function isValidEmployeeCode(code) {
  if (!/^A\d{4}$/.test(code)) return false
  const num = parseInt(code.slice(1), 10)
  return num >= 1 && num <= 2000
}

// ================== helper: timeouts ==================
const WAIT_IMAGE_MS = 60 * 1000 // 1 นาที
const WAIT_SEARCH_MS = 60 * 1000 // 1 นาที

function isExpired(ts) {
  if (!ts) return false
  return Date.now() - ts > WAIT_IMAGE_MS
}

// ================== OCR ==================
async function ocrImage(imageBuffer) {
  const form = new FormData()
  form.append('apikey', OCRSPACE_KEY)
  form.append('language', 'eng') // ใบเสร็จคุณเป็นอังกฤษเยอะ
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

// ================== Receipt format check ==================
function isOurReceipt(ocrText) {
  const t = (ocrText || '').toLowerCase().replace(/\s+/g, ' ')
  const mustHave = [
    'receipt',
    'asoke skin hospital',
    'asokeskinhospital.co.th'
  ]
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

  // BN (เช่น BN. L69-01-003-761)
  let bn = ''
  {
    const bnLine = findLineIncludes('bn')
    const m = bnLine.match(/BN\.?\s*([A-Z0-9\-]+)/i)
    if (m) bn = m[1].trim()
  }

  // HN (เช่น HN 01-01-26-047)
  let hn = ''
  {
    const hnLine = findLineIncludes('hn')
    const m = hnLine.match(/HN\.?\s*([0-9\-]+)/i)
    if (m) hn = m[1].trim()
  }

  // Date (เช่น Date 31 January 2026 Time 18:01:02)
  let receiptDateRaw = ''
  {
    const dateLine = findLineIncludes('date')
    const m = dateLine.match(/Date\s+(.+?)\s+Time/i)
    if (m) receiptDateRaw = m[1].trim()
  }

  // Name
  // ใบเสร็จคุณจะเป็น:
  // Name Ms.
  // Pun Kung
  let patientName = ''
  {
    const idx = lines.findIndex(l => l.toLowerCase().startsWith('name'))
    if (idx !== -1) {
      const next = lines[idx + 1] || ''
      const next2 = lines[idx + 2] || ''
      // ถ้าบรรทัดถัดไปเป็น Ms. / Mr. / Mrs. ก็เอาบรรทัดถัดไปอีกอันเป็นชื่อ
      if (/^(mr|ms|mrs)\.?$/i.test(next.trim())) {
        patientName = next2.trim()
      } else {
        // บางที name อยู่บรรทัดเดียว
        const m = lines[idx].match(/Name\s+(.+)/i)
        if (m) patientName = m[1].trim()
        else patientName = next.trim()
      }
    }
  }

  // Type of Payment
  let paymentType = ''
  {
    const payLine = findLineIncludes('type of payment')
    const m = payLine.match(/Type of Payment\s*:\s*(.+)/i)
    if (m) paymentType = m[1].trim()
  }

  // Total (เอาตัวเลขสุดท้ายที่เหมือนเงิน)
  // ตัวอย่าง: 14,910.00
  let total = ''
  {
    // หา line ที่มี Total
    const totalLine = lines.find(l => l.toLowerCase().includes('total')) || ''
    const moneyMatch = totalLine.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/)
    if (moneyMatch) total = moneyMatch[1]
  }

  // VAT (ถ้ามี)
  let vat = ''
  {
    const vatLine = lines.find(l => l.toLowerCase().includes('vat')) || ''
    const m = vatLine.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/)
    if (m) vat = m[1]
  }

  // รายการยา/บริการ + ราคา
  // วิธี: เก็บทุกบรรทัดที่มีเงินรูปแบบ x,xxx.xx และมีตัวอักษรด้วย
  const items = []
  for (const l of lines) {
    const money = l.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/)
    if (!money) continue

    // กันบรรทัด Total/VAT/Signature
    const low = l.toLowerCase()
    if (low.includes('total') || low.includes('vat') || low.includes('signature')) continue

    // ตัดราคาออกจากท้าย
    const price = money[1]
    const desc = l.replace(price, '').replace(/\s+/g, ' ').trim()

    if (desc.length >= 2) {
      items.push({ desc, price })
    }
  }

  return {
    timestamp: new Date().toISOString(),

    bn,
    hn,
    receiptDateRaw,
    patientName,
    paymentType,
    vat,
    total,

    items, // array
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
      }
    }
  )
}

// ================== WEBHOOK ==================
app.post('/webhook', async (req, res) => {
  const event = req.body.events?.[0]
  if (!event) return res.sendStatus(200)

  const userId = event.source?.userId
  const state = getState(userId)

  try {
    // ================== TEXT ==================
    if (event.message?.type === 'text') {
      const text = (event.message.text || '').trim()

      // ถ้าค้างรอรูป แล้วเกิน 1 นาที => reset
      if (state.mode === 'upload' && state.step === 'waitingImage') {
        if (isExpired(state.waitingSince)) {
          resetState(userId)
          await reply(
            event.replyToken,
            '⏱️ รอรูปเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะส่งใหม่ พิมพ์ "ส่งเอกสาร"'
          )
          return res.sendStatus(200)
        }
      }

      // ถ้าค้างรอค้นหา แล้วเกิน 1 นาที => reset
      if (state.mode === 'search' && state.step !== 'idle') {
        if (state.searchWaitingSince && (Date.now() - state.searchWaitingSince > WAIT_SEARCH_MS)) {
          resetState(userId)
          await reply(
            event.replyToken,
            '⏱️ รอคำตอบเกิน 1 นาทีแล้วครับ ระบบยกเลิก session ให้อัตโนมัติ\nถ้าจะค้นหาใหม่ พิมพ์ "ค้นหา"'
          )
          return res.sendStatus(200)
        }
      }

      // 0) ยกเลิกได้ทุกเวลา
      if (isCancelMessage(text)) {
        if (state.mode === 'idle') {
          await reply(event.replyToken, 'ตอนนี้ยังไม่ได้เริ่มอะไรครับ 🙂\nพิมพ์ "ส่งเอกสาร" หรือ "ค้นหา" ได้เลย')
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
3) ส่งรูปใบเสร็จได้ "ทีละ 2 รูป"
(ถ้ารอรูปเกิน 1 นาที ระบบจะยกเลิกให้อัตโนมัติ)

🔎 ค้นหา
1) พิมพ์ "ค้นหา"
2) ใส่รหัสพนักงาน
3) เลือกประเภทการค้นหา
- BN (เลขใบเสร็จ)
- HN
- NAME (ชื่อคนไข้)
- DATE (11/02/2026)

(พิมพ์ "ยกเลิก" ได้ทุกขั้นตอน)`
        )
        return res.sendStatus(200)
      }

      // ===== Rich menu text triggers =====
      // ให้กดแล้วเข้าสู่โหมดนั้นทันที
      if (text === 'ส่งเอกสาร') {
        resetState(userId)
        state.mode = 'upload'
        state.step = 'waitingEmployeeCode'
        await reply(event.replyToken, '🟦 ส่งเอกสาร\nกรุณาพิมพ์รหัสพนักงานครับ 👤')
        return res.sendStatus(200)
      }

      if (text === 'ค้นหา') {
        resetState(userId)
        state.mode = 'search'
        state.step = 'waitingEmployeeCodeForSearch'
        await reply(event.replyToken, '🔎 ค้นหา\nกรุณาพิมพ์รหัสพนักงานก่อนครับ 👤')
        return res.sendStatus(200)
      }

      // ================== UPLOAD MODE ==================
      if (state.mode === 'upload') {
        // รอรหัส
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
          state.images = []
          state.waitingSince = Date.now()

          await reply(
            event.replyToken,
            `โอเคครับ 👤 ${code}\nส่งรูปใบเสร็จมาได้เลยครับ (ส่งได้ 2 รูป) 📄`
          )
          return res.sendStatus(200)
        }

        // รอรูป แต่ผู้ใช้พิมพ์ข้อความ
        if (state.step === 'waitingImage') {
          await reply(
            event.replyToken,
            'ตอนนี้รอรูปใบเสร็จอยู่นะครับ 📄\nส่งรูปมาได้เลย หรือพิมพ์ "ยกเลิก"'
          )
          return res.sendStatus(200)
        }
      }

      // ================== SEARCH MODE ==================
      if (state.mode === 'search') {
        // 1) รอรหัสพนักงานก่อน
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

เลือกประเภทค้นหาได้เลย:
1) BN
2) HN
3) NAME
4) DATE (รูปแบบ 11/02/2026)

พิมพ์มาได้เลย เช่น "BN" หรือ "NAME"`
          )
          return res.sendStatus(200)
        }

        // 2) เลือกประเภท
        if (state.step === 'chooseSearchType') {
          const t = text.trim().toUpperCase()
          const ok = ['BN', 'HN', 'NAME', 'DATE'].includes(t)

          if (!ok) {
            await reply(
              event.replyToken,
              '❌ ประเภทค้นหาไม่ถูกต้องครับ\nพิมพ์ได้แค่: BN / HN / NAME / DATE\nหรือพิมพ์ "ยกเลิก"'
            )
            return res.sendStatus(200)
          }

          state.searchType = t
          state.step = 'waitingSearchValue'
          state.searchWaitingSince = Date.now()

          const hint =
            t === 'BN' ? 'พิมพ์เลข BN เช่น L69-01-003-761' :
            t === 'HN' ? 'พิมพ์เลข HN เช่น 01-01-26-047' :
            t === 'NAME' ? 'พิมพ์ชื่อคนไข้ เช่น Pun Kung' :
            'พิมพ์วันที่รูปแบบ 11/02/2026'

          await reply(event.replyToken, `พิมพ์ค่าที่ต้องการค้นหาได้เลยครับ\n${hint}`)
          return res.sendStatus(200)
        }

        // 3) รับค่าค้นหา แล้วไปยิง Apps Script
        if (state.step === 'waitingSearchValue') {
          const value = text.trim()
          const employeeCode = state.employeeCode

          if (!value) {
            await reply(event.replyToken, '❌ ค่าว่างครับ พิมพ์ใหม่อีกครั้ง หรือพิมพ์ "ยกเลิก"')
            return res.sendStatus(200)
          }

          // DATE format check
          if (state.searchType === 'DATE') {
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
              await reply(event.replyToken, '❌ รูปแบบวันที่ไม่ถูกต้องครับ ต้องเป็น 11/02/2026')
              return res.sendStatus(200)
            }
          }

          // query
          const result = await querySheet({
            action:
              state.searchType === 'BN' ? 'findByBN' :
              state.searchType === 'HN' ? 'findByHN' :
              state.searchType === 'NAME' ? 'findByName' :
              'countByDate',
            employeeCode,
            value
          })

          // reset หลังค้นหา 1 ครั้ง
          resetState(userId)

          // output
          if (state.searchType === 'DATE') {
            await reply(
              event.replyToken,
              `📅 วันที่ ${value}\nพนักงาน ${employeeCode} มีทั้งหมด ${result.count || 0} รายการครับ`
            )
            return res.sendStatus(200)
          }

          if (!result.found) {
            await reply(event.replyToken, 'ไม่พบข้อมูลครับ 😅')
            return res.sendStatus(200)
          }

          // แสดง 1 เอกสารเท่านั้น
          const d = result.data || {}
          await reply(
            event.replyToken,
            `🧾 พบใบเสร็จ 1 รายการ

BN: ${d.bn || '-'}
HN: ${d.hn || '-'}
Name: ${d.patientName || '-'}
Date: ${d.date || '-'}
Payment: ${d.paymentType || '-'}
Total: ${d.total || '-'}

(ค้นหาได้ครั้งละ 1 ใบเสร็จ)`
          )
          return res.sendStatus(200)
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
      // ต้องอยู่ใน upload mode และ waitingImage
      if (state.mode !== 'upload' || state.step !== 'waitingImage' || !state.employeeCode) {
        await reply(
          event.replyToken,
          'ก่อนส่งรูป กรุณาพิมพ์ "ส่งเอกสาร" แล้วใส่รหัสพนักงานก่อนครับ 🙂'
        )
        return res.sendStatus(200)
      }

      // ถ้าเกินเวลา 1 นาที -> reset
      if (isExpired(state.waitingSince)) {
        resetState(userId)
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

      // 5) เก็บไว้ใน session
      state.images.push(parsed)

      // reset timer ทุกครั้งที่มีรูปเข้ามา
      state.waitingSince = Date.now()

      // ถ้ายังไม่ครบ 2 รูป -> ขอรูปถัดไป
      if (state.images.length < 2) {
        await reply(
          event.replyToken,
          `📸 รับรูปที่ ${state.images.length}/2 แล้วครับ\nส่งรูปต่อไปได้เลย หรือพิมพ์ "ยกเลิก"`
        )
        return res.sendStatus(200)
      }

      // 6) ครบ 2 รูป -> บันทึกทั้งคู่
      for (const p of state.images) {
        await sendToSheet(p)
      }

      // 7) ตอบกลับ
      await reply(
        event.replyToken,
        `✅ บันทึกเรียบร้อย 2 ใบเสร็จแล้วครับ

👤 รหัสพนักงาน: ${state.employeeCode}
ใบที่ 1: BN ${state.images[0]?.bn || '-'} | Total ${state.images[0]?.total || '-'}
ใบที่ 2: BN ${state.images[1]?.bn || '-'} | Total ${state.images[1]?.total || '-'}

(ถ้าจะส่งใหม่ พิมพ์ "ส่งเอกสาร")`
      )

      // 8) reset
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





