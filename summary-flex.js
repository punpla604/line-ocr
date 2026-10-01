// ==================================================
// SUMMARY FLEX
// ==================================================

function formatSummaryNumber(value) {
  const num = Number(value || 0)

  if (Number.isNaN(num)) {
    return '0.00'
  }

  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

// ==================================================
// SUMMARY TYPE FLEX
// ==================================================

function buildSummaryTypeFlex() {
  return {
    type: 'bubble',

    size: 'mega',

    body: {
      type: 'box',

      layout: 'vertical',

      paddingAll: '20px',

      contents: [

        {
          type: 'text',

          text: '📊 เลือกประเภทสรุปยอด',

          weight: 'bold',

          size: 'xl',

          color: '#111111'
        },

        {
          type: 'text',

          text: 'ต้องการดูข้อมูลแบบไหนครับ?',

          size: 'sm',

          color: '#777777',

          margin: 'sm',

          wrap: true
        },

        {
          type: 'separator',

          margin: 'xl'
        },

        {
          type: 'button',

          style: 'primary',

          color: '#0EA5E9',

          margin: 'xl',

          action: {
            type: 'postback',

            label: '📅 สรุปยอดรายวัน',

            data: 'summary_type:daily',

            displayText: 'สรุปยอดรายวัน'
          }
        },

        {
          type: 'button',

          style: 'primary',

          color: '#16A34A',

          margin: 'md',

          action: {
            type: 'postback',

            label: '📊 สรุปยอดรายเดือน',

            data: 'summary_type:monthly',

            displayText: 'สรุปยอดรายเดือน'
          }
        },

        {
          type: 'button',

          style: 'secondary',

          margin: 'md',

          action: {
            type: 'message',

            label: '❌ ยกเลิก',

            text: 'ยกเลิก'
          }
        }
      ]
    }
  }
}

// ==================================================
// SUMMARY RESULT FLEX
// ==================================================

function buildSummaryFlex(
  summary,
  month,
  year
) {
  return buildSummaryResultFlex(
    summary,
    `${month}/${year}`,
    'ข้อมูลรวมของพนักงานทุกคน'
  )
}

// ==================================================
// DAILY SUMMARY RESULT FLEX
// ==================================================

function buildDailySummaryFlex(
  summary,
  day,
  month,
  year
) {
  return buildSummaryResultFlex(
    summary,
    `${day}/${month}/${year}`,
    'ข้อมูลรวมของพนักงานทุกคนในวันที่เลือก'
  )
}

// ==================================================
// COMMON SUMMARY RESULT
// ==================================================

function buildSummaryResultFlex(
  summary,
  dateText,
  noteText
) {
  const count =
    Number(summary?.count || 0)

  const amount =
    formatSummaryNumber(
      summary?.amount
    )

  const discount =
    formatSummaryNumber(
      summary?.discount
    )

  const discountByDoctor =
    formatSummaryNumber(
      summary?.discountByDoctor
    )

  const doctorFee =
    formatSummaryNumber(
      summary?.doctorFee
    )

  const hospitalNursing =
    formatSummaryNumber(
      summary?.hospitalNursing
    )

  const other =
    formatSummaryNumber(
      summary?.other
    )

  const total =
    formatSummaryNumber(
      summary?.total
    )

  return {
    type: 'bubble',

    size: 'mega',

    body: {
      type: 'box',

      layout: 'vertical',

      paddingAll: '20px',

      contents: [

        {
          type: 'box',

          layout: 'vertical',

          contents: [

            {
              type: 'text',

              text: '📊 สรุปยอดรวม',

              weight: 'bold',

              size: 'xl',

              color: '#111111'
            },

            {
              type: 'text',

              text: dateText,

              size: 'sm',

              color: '#777777',

              margin: 'sm'
            }

          ]
        },

        {
          type: 'separator',

          margin: 'lg'
        },

        {
          type: 'box',

          layout: 'horizontal',

          margin: 'lg',

          contents: [

            {
              type: 'text',

              text: '🧾 จำนวนรายการ',

              size: 'sm',

              color: '#555555',

              flex: 1
            },

            {
              type: 'text',

              text: `${count} รายการ`,

              size: 'sm',

              weight: 'bold',

              color: '#111111',

              align: 'end'
            }

          ]
        },

        {
          type: 'box',

          layout: 'horizontal',

          margin: 'md',

          contents: [

            {
              type: 'text',

              text: '💵 Amount',

              size: 'sm',

              color: '#555555',

              flex: 1
            },

            {
              type: 'text',

              text: `${amount} บาท`,

              size: 'sm',

              weight: 'bold',

              color: '#111111',

              align: 'end'
            }

          ]
        },

        {
          type: 'box',

          layout: 'horizontal',

          margin: 'md',

          contents: [

            {
              type: 'text',

              text: '🏷️ Discount',

              size: 'sm',

              color: '#555555',

              flex: 1
            },

            {
              type: 'text',

              text: `${discount} บาท`,

              size: 'sm',

              weight: 'bold',

              color: '#DC2626',

              align: 'end'
            }

          ]
        },

        {
          type: 'box',

          layout: 'horizontal',

          margin: 'md',

          contents: [

            {
              type: 'text',

              text: '👨‍⚕️ Discount by Doctor',

              size: 'sm',

              color: '#555555',

              flex: 1,

              wrap: true
            },

            {
              type: 'text',

              text: `${discountByDoctor} บาท`,

              size: 'sm',

              weight: 'bold',

              color: '#DC2626',

              align: 'end',

              flex: 1
            }

          ]
        },

        {
          type: 'box',

          layout: 'horizontal',

          margin: 'md',

          contents: [

            {
              type: 'text',

              text: '👨‍⚕️ Doctor Fee',

              size: 'sm',

              color: '#555555',

              flex: 1
            },

            {
              type: 'text',

              text: `${doctorFee} บาท`,

              size: 'sm',

              weight: 'bold',

              color: '#111111',

              align: 'end'
            }

          ]
        },

        {
          type: 'box',

          layout: 'horizontal',

          margin: 'md',

          contents: [

            {
              type: 'text',

              text: '🏥 Hospital & Nursing',

              size: 'sm',

              color: '#555555',

              flex: 1
            },

            {
              type: 'text',

              text: `${hospitalNursing} บาท`,

              size: 'sm',

              weight: 'bold',

              color: '#111111',

              align: 'end'
            }

          ]
        },

        {
          type: 'box',

          layout: 'horizontal',

          margin: 'md',

          contents: [

            {
              type: 'text',

              text: '📦 Other',

              size: 'sm',

              color: '#555555',

              flex: 1
            },

            {
              type: 'text',

              text: `${other} บาท`,

              size: 'sm',

              weight: 'bold',

              color: '#111111',

              align: 'end'
            }

          ]
        },

        {
          type: 'separator',

          margin: 'xl'
        },

        {
          type: 'box',

          layout: 'horizontal',

          margin: 'xl',

          paddingAll: '12px',

          backgroundColor: '#F0F9FF',

          cornerRadius: '12px',

          contents: [

            {
              type: 'text',

              text: '💰 รวมทั้งหมด',

              size: 'md',

              weight: 'bold',

              color: '#0369A1',

              flex: 1
            },

            {
              type: 'text',

              text: `${total} บาท`,

              size: 'lg',

              weight: 'bold',

              color: '#0369A1',

              align: 'end'
            }

          ]
        },

        {
          type: 'text',

          text: noteText,

          size: 'xs',

          color: '#999999',

          align: 'center',

          margin: 'lg',

          wrap: true
        }

      ]
    },

    footer: {
      type: 'box',

      layout: 'vertical',

      spacing: 'sm',

      contents: [

        {
          type: 'button',

          style: 'primary',

          color: '#0EA5E9',

          action: {
            type: 'message',

            label: '🔄 สรุปยอดใหม่',

            text: 'สรุปยอดรวม'
          }
        },

        {
          type: 'button',

          style: 'secondary',

          action: {
            type: 'message',

            label: '❌ ปิด',

            text: 'ยกเลิก'
          }
        }

      ]
    }
  }
}

// ==================================================
// EXPORT
// ==================================================

module.exports = {
  buildSummaryFlex,
  buildSummaryTypeFlex,
  buildDailySummaryFlex
}
