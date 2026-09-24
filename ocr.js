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

  return (
    res.data?.ParsedResults?.[0]?.ParsedText ||
    ''
  )
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

  return mustHave.every(k =>
    t.includes(k)
  )
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

  return String(text)
    .replace(/\s+/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')
}

function isMoney(text) {
  const t = cleanMoney(text)

  return /^\d{1,3}(?:,\d{3})?\.\d{2}$/.test(t)
}

function extractMoney(text) {
  if (!text) return ''

  const m = String(text).match(
    /\d{1,3}(?:,\d{3})?\.\d{2}/
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

const OCR_MONTH_FIXES = {
  jandary: 'January',
  janary: 'January',
  january: 'January',

  febuary: 'February',
  feburary: 'February',
  febrary: 'February',

  marchh: 'March',

  aprill: 'April',

  junee: 'June',

  julyy: 'July',

  agust: 'August',
  augst: 'August',

  septmber: 'September',
  septemer: 'September',
  septembr: 'September',

  octber: 'October',
  octobr: 'October',

  novmber: 'November',
  novembr: 'November',

  decmber: 'December',
  decembr: 'December'
}

function parseDateStrict(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeSpaces(lines[i])

    /*
      OCR มักอ่าน Date เป็น Dale

      เราอนุญาตเฉพาะ:

      Date/Dale + day + month + year

      เช่น:

      Dale 31 Jandary 2026 Time 18:01:02

      ไม่มีการใช้ new Date() เพื่อเดาวันที่
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

    const monthKey = originalMonth
      .toLowerCase()
      .replace(/\s+/g, '')

    const correctedMonth =
      OCR_MONTH_FIXES[monthKey] ||
      originalMonth

    const validMonth =
      MONTHS.find(month =>
        month.toLowerCase() ===
        correctedMonth.toLowerCase()
      )

    // ถ้าเดือนไม่รู้จัก -> ไม่เดา
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
  const idx =
    lines.findIndex(
      l => /^name\b/i.test(l)
    )

  if (idx === -1) {
    return ''
  }

  const current = lines[idx]

  const sameLine = current.match(
    /^Name\s*[:.]?\s*(.+)$/i
  )

  if (
    sameLine &&
    sameLine[1].trim()
  ) {
    return sameLine[1].trim()
  }

  const next =
    lines[idx + 1] || ''

  const next2 =
    lines[idx + 2] || ''

  if (
    /^(mr|mrs|ms)\.?$/i.test(next)
  ) {
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
    'credtcard',
    'cash',
    'bank transfer',
    'transfer'
  ]

  for (const line of lines) {
    const normalized =
      normalizeSpaces(line)

    const lower =
      normalized.toLowerCase()

    for (const keyword of paymentKeywords) {
      if (!lower.includes(keyword)) {
        continue
      }

      if (
        keyword === 'creditcard' ||
        keyword === 'credit card' ||
        keyword === 'credtcard'
      ) {
        return 'Credit Card'
      }

      if (
        keyword === 'bank transfer'
      ) {
        return 'Bank Transfer'
      }

      if (
        keyword === 'transfer'
      ) {
        return 'Transfer'
      }

      if (
        keyword === 'cash'
      ) {
        return 'Cash'
      }
    }
  }

  return ''
}

// ==================================================
// Items
// ==================================================

function parseItems(lines) {
  const items = []

  /*
    OCR ตัวอย่าง:

    No Description Baht

    1 DOCTOR FEE

    2 LASER THERAPY 7,560.00

    3 LOCAL ANESTHESIA 500.00

    4 LASER MACHINE SERVICES 300.00

    HOSPITAL AND NURSING SERVICE (OPD) 250.00

    6 Sylfirm 6,300.00

    CreditCard 14,910.00

    VAT ...

    Total 14,910.00
  */

  const startIdx =
    lines.findIndex(line => {
      const t =
        line.toLowerCase()

      return (
        (
          t.includes('description') ||
          t.includes('descriplion')
        ) &&
        t.includes('baht')
      )
    })

  if (startIdx === -1) {
    return items
  }

  const tableLines = []

  for (
    let i = startIdx + 1;
    i < lines.length;
    i++
  ) {
    const line =
      normalizeSpaces(lines[i])

    if (!line) {
      continue
    }

    const lower =
      line.toLowerCase()

    // ------------------------------------------
    // จบรายการก่อนถึงส่วน payment
    // ------------------------------------------

    if (
      lower.includes('creditcard') ||
      lower.includes('credit card') ||
      lower.includes('credtcard')
    ) {
      break
    }

    if (
      /^vat\b/i.test(line) ||
      lower.includes(' vat')
    ) {
      break
    }

    if (
      /^total\b/i.test(line) ||
      lower.includes(' total')
    ) {
      break
    }

    if (
      lower.includes('signature') ||
      lower.includes('cashier')
    ) {
      break
    }

    tableLines.push(line)
  }

  let currentItem = null

  for (const line of tableLines) {
    const text =
      normalizeSpaces(line)

    if (!text) {
      continue
    }

    // ------------------------------------------
    // แบบมีเลข + description + ราคา
    //
    // 2 LASER THERAPY 7,560.00
    // ------------------------------------------

    const inline =
      text.match(
        /^(\d+)\s+(.+?)\s+(-|\d{1,3}(?:,\d{3})?\.\d{2})$/
      )

    if (inline) {
      const no =
        inline[1]

      const desc =
        inline[2].trim()

      const price =
        inline[3]

      items.push({
        no,
        desc,
        price:
          isDash(price)
            ? null
            : cleanMoney(price)
      })

      currentItem = null
      continue
    }

    // ------------------------------------------
    // สำคัญ:
    //
    // รายการไม่มีเลข No.
    //
    // HOSPITAL AND NURSING SERVICE (OPD) 250.00
    //
    // ต้องแยกเป็น:
    //
    // desc = HOSPITAL AND NURSING SERVICE (OPD)
    // price = 250.00
    // ------------------------------------------

    const inlineNoNumber =
      text.match(
        /^(.+?)\s+(-|\d{1,3}(?:,\d{3})?\.\d{2})$/
      )

    if (inlineNoNumber) {
      const desc =
        inlineNoNumber[1].trim()

      const price =
        inlineNoNumber[2]

      // ป้องกันไม่ให้ข้อความ payment
      // กลายเป็น item
      const lowerDesc =
        desc.toLowerCase()

      if (
        lowerDesc.includes('creditcard') ||
        lowerDesc.includes('credit card') ||
        lowerDesc.includes('credtcard')
      ) {
        continue
      }

      items.push({
        no: '',
        desc,
        price:
          isDash(price)
            ? null
            : cleanMoney(price)
      })

      currentItem = null
      continue
    }

    // ------------------------------------------
    // แบบ:
    //
    // 1
    // DOCTOR FEE
    // 1,000.00
    // ------------------------------------------

    if (/^\d+$/.test(text)) {
      currentItem = {
        no: text,
        desc: '',
        price: null
      }

      items.push(
        currentItem
      )

      continue
    }

    // ------------------------------------------
    // ถ้าเป็นราคาอย่างเดียว
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
    // OCR อาจตัดเลขลำดับออก
    //
    // HOSPITAL AND NURSING SERVICE (OPD)
    // 250.00
    // ------------------------------------------

    if (currentItem) {
      if (currentItem.desc) {
        currentItem.desc +=
          ' ' + text
      } else {
        currentItem.desc =
          text
      }
    } else {
      currentItem = {
        no: '',
        desc: text,
        price: null
      }

      items.push(
        currentItem
      )
    }
  }

  return items
}

// ==================================================
// Category totals
// ==================================================

function parseCategoryTotals(items) {
  let doctorFee = 0
  let hospitalNursing = 0
  let other = 0

  for (const item of items) {
    const desc =
      normalizeSpaces(
        item.desc || ''
      ).toLowerCase()

    const rawPrice =
      item.price === null ||
      item.price === undefined ||
      item.price === ''
        ? ''
        : String(item.price)

    const price =
      Number(
        rawPrice.replace(/,/g, '')
      )

    if (
      !Number.isFinite(price)
    ) {
      continue
    }

    // ------------------------------------------
    // Doctor Fee
    // ------------------------------------------

    if (
      desc === 'doctor fee' ||
      desc.includes('doctor fee')
    ) {
      doctorFee += price
      continue
    }

    // ------------------------------------------
    // Hospital & Nursing
    // ------------------------------------------

    if (
      desc.includes(
        'hospital and nursing service'
      ) ||
      desc.includes(
        'hospital & nursing service'
      ) ||
      desc.includes(
        'hospital nursing service'
      ) ||
      desc.includes(
        'hospital and nursing'
      ) ||
      desc.includes(
        'hospital nursing'
      )
    ) {
      hospitalNursing += price
      continue
    }

    // ------------------------------------------
    // ทุกอย่างที่เหลือ = Other
    // ------------------------------------------

    other += price
  }

  return {
    doctorFee:
      doctorFee.toFixed(2),

    hospitalNursing:
      hospitalNursing.toFixed(2),

    other:
      other.toFixed(2)
  }
}

// ==================================================
// VAT
// ==================================================

function parseVat(lines) {
  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line =
      normalizeSpaces(lines[i])

    // ------------------------------------------
    // VAT 210.00
    // VAT. 210.00
    // ------------------------------------------

    const sameLine =
      line.match(
        /\bvat\b\s*[:.]?\s*(\d{1,3}(?:,\d{3})?\.\d{2})/i
      )

    if (sameLine) {
      return cleanMoney(
        sameLine[1]
      )
    }

    // ------------------------------------------
    // VAT
    // 210.00
    // ------------------------------------------

    if (
      /^vat\s*[:.]?$/i.test(line)
    ) {
      const next =
        normalizeSpaces(
          lines[i + 1] || ''
        )

      if (isMoney(next)) {
        return cleanMoney(next)
      }
    }

    // ------------------------------------------
    // OCR อาจอ่านเป็น VAT.
    // ------------------------------------------

    if (
      /^vat\.$/i.test(line)
    ) {
      const next =
        normalizeSpaces(
          lines[i + 1] || ''
        )

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
  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line =
      normalizeSpaces(lines[i])

    if (
      !/\btotal\b/i.test(line)
    ) {
      continue
    }

    // ------------------------------------------
    // Total 14,910.00
    // ------------------------------------------

    const sameLine =
      extractMoney(line)

    if (sameLine) {
      return cleanMoney(
        sameLine
      )
    }

    // ------------------------------------------
    // Total
    // 14,910.00
    // ------------------------------------------

    const next =
      lines[i + 1] || ''

    const nextMoney =
      extractMoney(next)

    if (nextMoney) {
      return cleanMoney(
        nextMoney
      )
    }
  }

  return ''
}

// ==================================================
// Receipt parser
// ==================================================

function parseReceipt(ocrText) {
  const raw =
    ocrText || ''

  const lines =
    raw
      .split(/\r?\n/)
      .map(line =>
        normalizeSpaces(line)
      )
      .filter(Boolean)

  const bn =
    parseBN(lines)

  const hn =
    parseHN(lines)

  const patientName =
    parseName(lines)

  const dateResult =
    parseDateStrict(lines)

  const paymentType =
    parsePaymentType(lines)

  const items =
    parseItems(lines)

  const categories =
    parseCategoryTotals(items)

  const vat =
    parseVat(lines)

  const total =
    parseTotal(lines)

  return {
    timestamp:
      new Date().toISOString(),

    receiptNo:
      bn,

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

    // ==============================
    // 3 หมวดค่าใช้จ่าย
    // ==============================

    doctorFee:
      categories.doctorFee,

    hospitalNursing:
      categories.hospitalNursing,

    other:
      categories.other,

    // ==============================
    // รายการทั้งหมด
    // ==============================

    items,

    // ==============================
    // OCR ดิบ
    // ==============================

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