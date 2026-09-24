const axios = require('axios')
const FormData = require('form-data')

const OCRSPACE_KEY = process.env.OCRSPACE_KEY

// ==================================================
// OCR
// ==================================================

async function ocrImage(imageBuffer) {
  if (!OCRSPACE_KEY) {
    throw new Error('Missing env: OCRSPACE_KEY')
  }

  const form = new FormData()

  form.append('apikey', OCRSPACE_KEY)
  form.append('language', 'eng')
  form.append('OCREngine', '2')
  form.append('scale', 'true')
  form.append('isTable', 'true')

  form.append('file', imageBuffer, {
    filename: 'receipt.jpg'
  })

  const res = await axios.post(
    'https://api.ocr.space/parse/image',
    form,
    {
      headers: form.getHeaders(),
      timeout: 30000
    }
  )

  if (res.data?.IsErroredOnProcessing) {
    throw new Error(
      res.data?.ErrorMessage?.join?.(', ') ||
      'OCR processing failed'
    )
  }

  return res.data?.ParsedResults?.[0]?.ParsedText || ''
}

// ==================================================
// Receipt format check
// ==================================================

function isOurReceipt(ocrText) {
  const t = (ocrText || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')

  const mustHave = [
    'receipt',
    'asoke skin hospital'
  ]

  return mustHave.every(k => t.includes(k))
}

// ==================================================
// Helpers
// ==================================================

function normalizeSpaces(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanMoney(text) {
  if (!text) return ''

  return text
    .replace(/\s+/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')
}

function isMoney(text) {
  const t = cleanMoney(text)

  return /^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(t)
}

function extractMoney(text) {
  if (!text) return ''

  const m = text.match(
    /\d{1,3}(?:,\d{3})*\.\d{2}/
  )

  return m ? m[0] : ''
}

function isDash(text) {
  return /^[-–—]+$/.test(
    (text || '').trim()
  )
}

// ==================================================
// Date
// ==================================================

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

// แก้เฉพาะคำ OCR ที่เรารู้แน่นอน
// ไม่ใช้ fuzzy matching
const OCR_MONTH_FIXES = {
  jandary: 'January',
  febuary: 'February',
  feburary: 'February',
  agust: 'August',
  septmber: 'September',
  octber: 'October',
  novmber: 'November',
  decmber: 'December'
}

function parseDateStrict(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeSpaces(lines[i])

    /*
      รองรับ OCR ที่อ่าน Date เป็น Dale

      ตัวอย่าง:
      Date 31 January 2026 Time 18:01:02
      Dale 31 January 2026 Time 18:01:02
      Dale 31 Jandary 2026 Time 18:01:02
    */

    const m = line.match(
      /^(?:Date|Dale)\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s+Time\s+(\d{2}:\d{2}:\d{2}))?/i
    )

    if (!m) {
      continue
    }

    const day = m[1]
    const originalMonth = m[2]
    const year = m[3]
    const time = m[4] || ''

    /*
      แก้เฉพาะคำที่อยู่ใน OCR_MONTH_FIXES

      Jandary -> January

      แต่ถ้าเป็นคำอื่นที่เราไม่รู้จัก
      จะไม่เดา
    */

    const monthKey =
      originalMonth.toLowerCase()

    const correctedMonth =
      OCR_MONTH_FIXES[monthKey] ||
      originalMonth

    const validMonth = MONTHS.find(
      month =>
        month.toLowerCase() ===
        correctedMonth.toLowerCase()
    )

    // ไม่รู้จักเดือน -> ไม่เดา
    if (!validMonth) {
      return {
        date: '',
        time
      }
    }

    const dayNum = Number(day)
    const yearNum = Number(year)

    if (
      dayNum < 1 ||
      dayNum > 31 ||
      yearNum < 1900 ||
      yearNum > 2100
    ) {
      return {
        date: '',
        time
      }
    }

    // ตรวจจำนวนวันจริงของเดือน
    const monthIndex =
      MONTHS.indexOf(validMonth)

    const daysInMonth =
      new Date(
        yearNum,
        monthIndex + 1,
        0
      ).getDate()

    if (dayNum > daysInMonth) {
      return {
        date: '',
        time
      }
    }

    return {
      date: `${day} ${validMonth} ${year}`,
      time
    }
  }

  return {
    date: '',
    time: ''
  }
}

// ==================================================
// BN
// ==================================================

function parseBN(lines) {
  for (const line of lines) {
    const m = line.match(
      /\bBN\s*[:.]?\s*([A-Z0-9-]+)/i
    )

    if (m) {
      return m[1].trim()
    }
  }

  return ''
}

// ==================================================
// HN
// ==================================================

function parseHN(lines) {
  for (const line of lines) {
    const m = line.match(
      /\bHN\s*[:.]?\s*([0-9-]+)/i
    )

    if (m) {
      return m[1].trim()
    }
  }

  return ''
}

// ==================================================
// Name
// ==================================================

function parseName(lines) {
  const idx = lines.findIndex(
    l => /^name\b/i.test(l)
  )

  if (idx === -1) {
    return ''
  }

  const current = lines[idx]

  const sameLine = current.match(
    /^Name\s*[:.]?\s*(.+)$/i
  )

  if (sameLine && sameLine[1].trim()) {
    return sameLine[1].trim()
  }

  const next = lines[idx + 1] || ''
  const next2 = lines[idx + 2] || ''

  if (/^(mr|mrs|ms)\.?$/i.test(next)) {
    return next2
  }

  return next
}

// ==================================================
// Payment
// ==================================================

function parsePaymentType(lines) {
  const paymentKeywords = [
    'credit card',
    'creditcard',
    'cash',
    'bank transfer',
    'transfer'
  ]

  for (const line of lines) {
    const normalized = normalizeSpaces(line)
    const lower = normalized.toLowerCase()

    for (const keyword of paymentKeywords) {
      if (!lower.includes(keyword)) {
        continue
      }

      if (
        keyword === 'creditcard' ||
        keyword === 'credit card'
      ) {
        return 'Credit Card'
      }

      if (keyword === 'bank transfer') {
        return 'Bank Transfer'
      }

      if (keyword === 'transfer') {
        return 'Transfer'
      }

      if (keyword === 'cash') {
        return 'Cash'
      }
    }
  }

  return ''
}

// ==================================================
// Table / Items
// ==================================================

function parseItems(lines) {
  const items = []

  const startIdx = lines.findIndex(
    line =>
      /\bdescription\b/i.test(line) &&
      /\bbaht\b/i.test(line)
  )

  if (startIdx === -1) {
    return items
  }

  const tableLines = []

  for (
    let i = startIdx + 1;
    i < lines.length;
    i++
  ) {
    const line = normalizeSpaces(lines[i])

    if (!line) {
      continue
    }

    // summary เริ่มแล้ว
    if (/^vat\b/i.test(line)) {
      break
    }

    if (/^total\b/i.test(line)) {
      break
    }

    // CreditCard เป็นยอดชำระ ไม่ใช่ item
    if (/credit\s*card/i.test(line)) {
      continue
    }

    tableLines.push(line)
  }

  let currentItem = null

  for (const line of tableLines) {
    const text = normalizeSpaces(line)

    // ------------------------------------------
    // กรณี:
    // 1 DOCTOR FEE 1,000.00
    // ------------------------------------------

    const inline = text.match(
      /^(\d+)\s+(.+?)\s+(-|\d{1,3}(?:,\d{3})*\.\d{2})$/
    )

    if (inline) {
      const no = inline[1]
      const desc = inline[2].trim()
      const price = inline[3]

      items.push({
        no,
        desc,
        price: isDash(price)
          ? null
          : cleanMoney(price)
      })

      currentItem = null

      continue
    }

    // ------------------------------------------
    // กรณีมีเลขลำดับแยกบรรทัด
    // ------------------------------------------

    if (/^\d+$/.test(text)) {
      currentItem = {
        no: text,
        desc: '',
        price: null
      }

      items.push(currentItem)

      continue
    }

    // ------------------------------------------
    // กรณีเป็นราคา
    // ------------------------------------------

    if (
      isMoney(text) ||
      isDash(text)
    ) {
      if (currentItem) {
        currentItem.price =
          isDash(text)
            ? null
            : cleanMoney(text)

        currentItem = null
      }

      continue
    }

    // ------------------------------------------
    // กรณีเป็น description
    // ------------------------------------------

    /*
      ถ้ามี item ก่อนหน้า
      ให้เติม description

      ถ้าไม่มี item ก่อนหน้า
      เราจะสร้าง item โดยไม่เดาเลข
    */

    if (currentItem) {
      if (currentItem.desc) {
        currentItem.desc += ' ' + text
      } else {
        currentItem.desc = text
      }
    } else {
      currentItem = {
        no: '',
        desc: text,
        price: null
      }

      items.push(currentItem)
    }
  }

  return items
}

// ==================================================
// VAT
// ==================================================

function parseVat(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeSpaces(lines[i])

    // ต้องเป็น VAT แล้วตามด้วยจำนวนเงินจริง ๆ
    // เช่น VAT 210.00
    const sameLine = line.match(
      /\bvat\b\s*[:.]?\s*(\d{1,3}(?:,\d{3})*\.\d{2})/i
    )

    if (sameLine) {
      return cleanMoney(sameLine[1])
    }

    // รองรับ:
    // VAT
    // 210.00
    //
    // แต่ต้องเป็น "บรรทัดถัดไปทันที"
    // และบรรทัด VAT ต้องจบด้วย VAT จริง ๆ
    if (/\bvat\b\s*[:.]?$/i.test(line)) {
      const next = normalizeSpaces(lines[i + 1] || '')

      if (isMoney(next)) {
        return cleanMoney(next)
      }
    }
  }

  return ''
}

// ==================================================
// Total
// ==================================================

function parseTotal(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeSpaces(lines[i])

    /*
      รองรับ:

      Total 14,910.00

      และ:

      Signature- Cashier Total 14,910.00
    */

    if (!/\btotal\b/i.test(line)) {
      continue
    }

    const sameLine = extractMoney(line)

    if (sameLine) {
      return cleanMoney(sameLine)
    }

    // กรณี:
    // Total
    // 14,910.00

    const next = lines[i + 1] || ''

    const nextMoney =
      extractMoney(next)

    if (nextMoney) {
      return cleanMoney(nextMoney)
    }
  }

  return ''
}

// ==================================================
// Payment amount
// ==================================================

function parsePaymentAmount(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeSpaces(lines[i])

    if (!/credit\s*card/i.test(line)) {
      continue
    }

    const sameLine = extractMoney(line)

    if (sameLine) {
      return cleanMoney(sameLine)
    }

    const next = lines[i + 1] || ''

    const nextMoney =
      extractMoney(next)

    if (nextMoney) {
      return cleanMoney(nextMoney)
    }
  }

  return ''
}

// ==================================================
// Receipt parser
// ==================================================

function parseReceipt(ocrText) {
  const raw = ocrText || ''

  const lines = raw
    .split(/\r?\n/)
    .map(line => normalizeSpaces(line))
    .filter(Boolean)

  const bn = parseBN(lines)

  const hn = parseHN(lines)

  const patientName =
    parseName(lines)

  const dateResult =
    parseDateStrict(lines)

  const paymentType =
    parsePaymentType(lines)

  const items =
    parseItems(lines)

  const vat =
    parseVat(lines)

  const total =
    parseTotal(lines)

  // เก็บไว้รองรับอนาคต
  // ตอนนี้ยังไม่ได้เพิ่ม field ลง Sheet
  parsePaymentAmount(lines)

  return {
    timestamp: new Date().toISOString(),

    receiptNo: bn,

    bn,

    hn,

    receiptDateRaw:
      dateResult.date,

    timeText:
      dateResult.time,

    patientName,

    paymentType,

    vat,

    total,

    items,

    raw
  }
}

// ==================================================
// Export
// ==================================================

module.exports = {
  ocrImage,
  isOurReceipt,
  parseReceipt
}