// ==================================================
// SUMMARY FLEX
// ==================================================

function formatSummaryNumber(value) {
  return Number(value || 0).toLocaleString(
    'en-US',
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  )
}

// ==================================================
// SUMMARY FLEX
// ==================================================

function buildSummaryFlex(
  summary,
  month,
  year
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

        // ==============================================
        // HEADER
        // ==============================================

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

              text: `${month}/${year}`,

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

        // ==============================================
        // COUNT
        // ==============================================

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

        // ==============================================
        // AMOUNT
        // ==============================================

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

        // ==============================================
        // DISCOUNT
        // ==============================================

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

        // ==============================================
        // DISCOUNT BY DOCTOR
        // ==============================================

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

        // ==============================================
        // DOCTOR FEE
        // ==============================================

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

        // ==============================================
        // HOSPITAL & NURSING
        // ==============================================

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

        // ==============================================
        // OTHER
        // ==============================================

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

        // ==============================================
        // TOTAL
        // ==============================================

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

        // ==============================================
        // NOTE
        // ==============================================

        {
          type: 'text',

          text: 'ข้อมูลรวมของพนักงานทุกคน',

          size: 'xs',

          color: '#999999',

          align: 'center',

          margin: 'lg',

          wrap: true
        }

      ]
    },

    // ==================================================
    // FOOTER
    // ==================================================

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

module.exports = {
  buildSummaryFlex
}
