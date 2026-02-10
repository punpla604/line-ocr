const axios = require('axios')

const SHEET_URL = process.env.SHEET_URL

async function sendToSheet(data) {
  await axios.post(SHEET_URL, data)
  console.log('📊 ส่งข้อมูลเข้า Google Sheet แล้ว')
}

module.exports = sendToSheet
