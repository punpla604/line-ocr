const axios = require('axios')
const FormData = require('form-data')

const OCRSPACE_KEY = process.env.OCRSPACE_KEY

// ================== OCR ==================

async function ocrImage(imageBuffer) {
  if (!OCRSPACE_KEY) {
    throw new Error('Missing env: OCRSPACE_KEY')
  }

  const form = new FormData()

  form.append('apikey', OCRSPACE_KEY)
  form.append('language', 'eng')
  form.append('OCREngine', '2')
  form.append('scale', 'true')
  form.append('file', imageBuffer, {
    filename: 'image.jpg'
  })

  const res = await axios.post(
    'https://api.ocr.space/parse/image',
    form,
    {
      headers: form.getHeaders(),
      timeout: 30000
    }
  )

  return res.data?.ParsedResults?.[0]?.ParsedText || ''
}

// ================== Receipt format check ==================

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

// ================== Money helper ==================

function findMoney(text) {
  const m = (text || '').match(
    /([0-9]{1,3}(?:,[0-9]{3})\.[0-9]{2})/
  )

  return m ? m[1] : ''
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

    return (
      lines.find(l =>
        l.toLowerCase().includes(k)
      ) || ''
    )
  }

  // ================== BN ==================

  let bn = ''

  {
    const bnLine = findLineIncludes('bn')

    const m = bnLine.match(
      /BN\.?\s*([A-Z0-9-]+)/i
    )

    if (m) {
      bn = m[1].trim()
    }
  }

  // ================== HN ==================

  let hn = ''

  {
    const hnLine = findLineIncludes('hn')

    const m = hnLine.match(
      /HN\.?\s*([0-9-]+)/i
    )

    if (m) {
      hn = m[1].trim()
    }
  }

  // ================== Date + Time ==================

  let receiptDateRaw = ''
  let timeText = ''

  {
    const idx = lines.findIndex(l =>
      l.toLowerCase().startsWith('date')
    )

    if (idx !== -1) {
      const line = lines[idx]

      // Date 31 January 2026 Time 18:01:02
      const mDateTime = line.match(
        /Date\s+(.+?)\s+Time\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i
      )

      if (mDateTime) {
        receiptDateRaw =
          (mDateTime[1] || '').trim()

        timeText =
          (mDateTime[2] || '').trim()
      } else {
        const mDate = line.match(
          /Date\s+(.+)/i
        )

        if (mDate) {
          receiptDateRaw = mDate[1].trim()
        }

        const mTime = line.match(
          /Time\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i
        )

        if (mTime) {
          timeText = mTime[1].trim()
        }
      }
    } else {
      // fallback: หา line ที่มี date + time
      const dtLine =
        lines.find(l =>
          l.toLowerCase().includes('date') &&
          l.toLowerCase().includes('time')
        ) || ''

      const mTime = dtLine.match(
        /Time\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i
      )

      if (mTime) {
        timeText = mTime[1].trim()
      }
    }
  }

  // ================== Name ==================

  let patientName = ''

  {
    const idx = lines.findIndex(l =>
      l.toLowerCase().startsWith('name')
    )

    if (idx !== -1) {
      const next = (lines[idx + 1] || '').trim()
      const next2 = (lines[idx + 2] || '').trim()

      if (/^(mr|ms|mrs)\.?$/i.test(next)) {
        patientName = next2
      } else {
        const m = lines[idx].match(
          /Name\s+(.+)/i
        )

        patientName = m
          ? m[1].trim()
          : next
      }
    }
  }

  // ================== Payment ==================

  let paymentType = ''

  {
    const payLine =
      findLineIncludes('type of payment')

    const m = payLine.match(
      /Type of Payment\s*:\s*(.+)/i
    )

    if (m) {
      paymentType = m[1].trim()
    }
  }

  // ================== VAT ==================

  let vat = ''

  {
    const vatLine =
      lines.find(l =>
        l.toLowerCase().includes('vat')
      ) || ''

    const m = vatLine.match(
      /([0-9]{1,3}(?:,[0-9]{3})\.[0-9]{2})/
    )

    if (m) {
      vat = m[1]
    }
  }

  // ================== Items ==================

  const items = []

  {
    const startIdx = lines.findIndex(l =>
      l.toLowerCase().includes('description')
    )

    const endIdx = lines.findIndex(l =>
      /^(creditcard|total|signature|cashier|vat)/i.test(
        l.trim()
      )
    )

    if (startIdx !== -1) {
      const tableLines = lines.slice(
        startIdx + 1,
        endIdx !== -1
          ? endIdx
          : startIdx + 80
      )

      const cleaned = tableLines
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l =>
          !/^(no\.?|baht|anau)$/i.test(l)
        )
        .filter(l => !/^\d+$/.test(l))
        .filter(l => !/^page/i.test(l))

      const moneyRegex =
        /^[0-9]{1,3}(?:,[0-9]{3})\.[0-9]{2}$/

      const dashRegex = /^-+$/

      const descList = []
      const priceList = []

      for (const l of cleaned) {
        const s = l
          .replace(/\s+/g, ' ')
          .trim()

        // ตัวเงินล้วน
        if (moneyRegex.test(s)) {
          priceList.push(s)
          continue
        }

        // "-"
        if (dashRegex.test(s)) {
          priceList.push('-')
          continue
        }

        // text + price
        const mInline = s.match(
          /(.+?)\s+([0-9]{1,3}(?:,[0-9]{3})\.[0-9]{2})$/
        )

        if (mInline) {
          descList.push(
            mInline[1].trim()
          )

          priceList.push(
            mInline[2].trim()
          )

          continue
        }

        // text
        descList.push(s)
      }

      const n = Math.min(
        descList.length,
        priceList.length
      )

      for (let i = 0; i < n; i++) {
        const desc = descList[i]
        const p = priceList[i]

        items.push({
          desc,
          price: p === '-' ? null : p
        })
      }
    }
  }

  // ================== Total ==================

  let total = ''

  {
    const allMoney = lines
      .map(l => findMoney(l))
      .filter(Boolean)

    if (allMoney.length > 0) {
      total = allMoney[allMoney.length - 1]
    }
  }

  // ================== Result ==================

  return {
    timestamp: new Date().toISOString(),

    receiptNo: bn,

    bn,
    hn,

    receiptDateRaw,
    timeText,

    patientName,

    paymentType,

    vat,

    total,

    items,

    raw
  }
}

module.exports = {
  ocrImage,
  isOurReceipt,
  parseReceipt
}