const axios = require('axios')

const SHEET_URL = process.env.SHEET_URL
const SHEET_SECRET = process.env.SHEET_SECRET

function toSheetPayload(data) {
  const itemsJson = JSON.stringify(data.items || [])

  return {
    timestamp: data.timestamp || new Date().toISOString(),
    employeeCode: data.employeeCode || '',

    // เลขใบเสร็จ
    receiptNo: data.receiptNo || data.bn || '',
    bn: data.bn || '',
    hn: data.hn || '',

    // วันที่/เวลา
    receiptDateRaw: data.receiptDateRaw || '',
    timeText: data.timeText || '',

    // ชื่อคนไข้
    patientName: data.patientName || '',

    // จ่ายด้วยอะไร
    paymentType: data.paymentType || '',

    // VAT / Total
    vat: data.vat || '',
    total: data.total || '',

    // ==========================================
    // ค่าใช้จ่าย 3 หมวด
    // ==========================================

    doctorFee: data.doctorFee || '',

    hospitalNursing: data.hospitalNursing || '',

    other: data.other || '',

    // ==========================================
    // items
    // ==========================================

    itemjson: itemsJson,
    itemsJson: itemsJson,

    // raw text
    raw: data.raw || ''
  }
}

async function sendToSheet(data) {
  if (!SHEET_URL) {
    throw new Error('❌ Missing env: SHEET_URL')
  }

  if (!SHEET_SECRET) {
    throw new Error('❌ Missing env: SHEET_SECRET')
  }

  const payload = toSheetPayload(data)

  try {
    const res = await axios.post(
      SHEET_URL,
      payload,
      {
        timeout: 15000,

        headers: {
          'Content-Type': 'application/json',
          'x-secret': SHEET_SECRET
        }
      }
    )

    console.log(
      '📊 ส่งข้อมูลเข้า Google Sheet แล้ว:',
      res.data
    )

    return res.data

  } catch (err) {
    console.error(
      '❌ ส่งเข้า Google Sheet ไม่สำเร็จ'
    )

    if (err.response) {
      console.error(
        'STATUS:',
        err.response.status
      )

      console.error(
        'DATA:',
        err.response.data
      )
    } else {
      console.error(
        'ERROR:',
        err.message
      )
    }

    throw err
  }
}

module.exports = sendToSheet



