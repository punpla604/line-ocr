const axios = require('axios')

const SHEET_URL = process.env.SHEET_URL

async function sendToSheet(data) {
  if (!SHEET_URL) {
    throw new Error('❌ Missing env: SHEET_URL')
  }

  try {
    const res = await axios.post(SHEET_URL, data, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    })

    console.log('📊 ส่งข้อมูลเข้า Google Sheet แล้ว:', res.data)
    return res.data
  } catch (err) {
    console.error('❌ ส่งเข้า Google Sheet ไม่สำเร็จ')

    // ถ้า Apps Script ตอบกลับมา จะเห็นชัดมาก
    if (err.response) {
      console.error('STATUS:', err.response.status)
      console.error('DATA:', err.response.data)
    } else {
      console.error('ERROR:', err.message)
    }

    throw err
  }
}

module.exports = sendToSheet
