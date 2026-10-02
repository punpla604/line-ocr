// ==================================================
// SEARCH FLEX MESSAGE
// ==================================================

const SEARCH_PAGE_SIZE = 10


// ==================================================
// SAFE TEXT
// ==================================================

function safeFlexText(value) {

  const text =
    String(value ?? '-')
      .trim()

  return text || '-'
}


// ==================================================
// FORMAT NUMBER
// ==================================================

function formatNumber(value) {

  const num =
    Number(
      String(value ?? '0')
        .replace(/,/g, '')
        .trim()
    )

  if (isNaN(num)) {
    return '0.00'
  }

  return num.toLocaleString(
    'en-US',
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  )
}


// ==================================================
// SEARCH DETAIL FLEX
// ==================================================

function buildSearchDetailFlex(
  item,
  index,
  page
) {

  return {

    type: 'bubble',

    size: 'mega',

    header: {

      type: 'box',

      layout: 'vertical',

      backgroundColor: '#1976D2',

      paddingAll: '18px',

      contents: [

        {
          type: 'text',

          text: '🧾 รายละเอียดเอกสาร',

          color: '#FFFFFF',

          size: 'lg',

          weight: 'bold'
        },

        {
          type: 'text',

          text:
            `รายการที่ ${index + 1}`,

          color: '#E3F2FD',

          size: 'sm',

          margin: 'sm'
        }

      ]
    },


    // ==================================================
    // BODY
    // ==================================================

    body: {

      type: 'box',

      layout: 'vertical',

      spacing: 'md',

      paddingAll: '18px',

      contents: [

        {
          type: 'text',

          text:
            `BN: ${safeFlexText(item.bn)}`,

          size: 'md',

          weight: 'bold',

          wrap: true
        },

        {
          type: 'separator',

          margin: 'sm'
        },


        // DATE

        {
          type: 'box',

          layout: 'horizontal',

          spacing: 'md',

          contents: [

            {
              type: 'text',

              text: 'วันที่',

              size: 'sm',

              color: '#777777',

              flex: 1
            },

            {
              type: 'text',

              text:
                safeFlexText(
                  item.dateText ||
                  item.date
                ),

              size: 'sm',

              align: 'end',

              flex: 2,

              wrap: true
            }

          ]
        },

        {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            contents: [
                {
                type: 'text',
                text: 'รหัสแพทย์',
                size: 'sm',
                color: '#777777',
                flex: 1
                },
                {
                type: 'text',
                text: safeFlexText(item.doctorID),
                size: 'sm',
                align: 'end',
                flex: 2,
                wrap: true
                }
            ]
            },

            {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            contents: [
                {
                type: 'text',
                text: 'แพทย์',
                size: 'sm',
                color: '#777777',
                flex: 1
                },
                {
                type: 'text',
                text: safeFlexText(item.doctorName),
                size: 'sm',
                align: 'end',
                flex: 2,
                wrap: true
                }
            ]
            },

        // HN

        {
          type: 'box',

          layout: 'horizontal',

          spacing: 'md',

          contents: [

            {
              type: 'text',

              text: 'HN',

              size: 'sm',

              color: '#777777',

              flex: 1
            },

            {
              type: 'text',

              text:
                safeFlexText(item.hn),

              size: 'sm',

              align: 'end',

              flex: 2,

              wrap: true
            }

          ]
        },


        // NAME

        {
          type: 'box',

          layout: 'horizontal',

          spacing: 'md',

          contents: [

            {
              type: 'text',

              text: 'ชื่อ',

              size: 'sm',

              color: '#777777',

              flex: 1
            },

            {
              type: 'text',

              text:
                safeFlexText(item.name),

              size: 'sm',

              align: 'end',

              flex: 2,

              wrap: true
            }

          ]
        },


        // PAYMENT

        {
          type: 'box',

          layout: 'horizontal',

          spacing: 'md',

          contents: [

            {
              type: 'text',

              text: 'การชำระเงิน',

              size: 'sm',

              color: '#777777',

              flex: 1,

              wrap: true
            },

            {
              type: 'text',

              text:
                safeFlexText(
                  item.paymentType
                ),

              size: 'sm',

              align: 'end',

              flex: 2,

              wrap: true
            }

          ]
        },


        {
          type: 'separator',

          margin: 'md'
        },

        {
        type: 'box',
        layout: 'horizontal',
        spacing: 'md',
        contents: [
            {
            type: 'text',
            text: 'Amount',
            size: 'sm',
            color: '#777777',
            flex: 1
            },
            {
            type: 'text',
            text:
                `${formatNumber(item.amount)} บาท`,
            size: 'sm',
            align: 'end',
            flex: 2,
            wrap: true
            }
        ]
        },

        {
        type: 'box',
        layout: 'horizontal',
        spacing: 'md',
        contents: [
            {
            type: 'text',
            text: 'Discount',
            size: 'sm',
            color: '#777777',
            flex: 1
            },
            {
            type: 'text',
            text:
                `${formatNumber(item.discount)} บาท`,
            size: 'sm',
            align: 'end',
            flex: 2,
            wrap: true
            }
        ]
        },

        {
        type: 'box',
        layout: 'horizontal',
        spacing: 'md',
        contents: [
            {
            type: 'text',
            text: 'Discount by Doctor',
            size: 'sm',
            color: '#777777',
            flex: 1
            },
            {
            type: 'text',
            text:
                `${formatNumber(item.discountByDoctor)} บาท`,
            size: 'sm',
            align: 'end',
            flex: 2,
            wrap: true
            }
        ]
        },

        // TOTAL

        {
          type: 'box',

          layout: 'horizontal',

          spacing: 'md',

          contents: [

            {
              type: 'text',

              text: 'ยอดรวม',

              size: 'md',

              weight: 'bold',

              color: '#333333',

              flex: 1
            },

            {
              type: 'text',

              text:
                `${formatNumber(item.total)} บาท`,

              size: 'md',

              weight: 'bold',

              color: '#1976D2',

              align: 'end',

              flex: 2,

              wrap: true
            }

          ]
        },


        // DOCTOR FEE

        {
          type: 'box',

          layout: 'horizontal',

          spacing: 'md',

          contents: [

            {
              type: 'text',

              text: 'Doctor Fee',

              size: 'sm',

              color: '#777777',

              flex: 1
            },

            {
              type: 'text',

              text:
                `${formatNumber(
                  item.doctorFee
                )} บาท`,

              size: 'sm',

              align: 'end',

              flex: 2
            }

          ]
        },


        // HOSPITAL

        {
          type: 'box',

          layout: 'horizontal',

          spacing: 'md',

          contents: [

            {
              type: 'text',

              text: 'Hospital & Nursing',

              size: 'sm',

              color: '#777777',

              flex: 1,

              wrap: true
            },

            {
              type: 'text',

              text:
                `${formatNumber(
                  item.hospitalNursing
                )} บาท`,

              size: 'sm',

              align: 'end',

              flex: 2,

              wrap: true
            }

          ]
        },


        // OTHER

        {
          type: 'box',

          layout: 'horizontal',

          spacing: 'md',

          contents: [

            {
              type: 'text',

              text: 'Other',

              size: 'sm',

              color: '#777777',

              flex: 1
            },

            {
              type: 'text',

              text:
                `${formatNumber(
                  item.other
                )} บาท`,

              size: 'sm',

              align: 'end',

              flex: 2
            }

          ]
        }

      ]
    },


    // ==================================================
    // FOOTER
    // ==================================================

    footer: {

      type: 'box',

      layout: 'horizontal',

      spacing: 'sm',

      paddingAll: '12px',

      contents: [

        {
          type: 'button',

          style: 'secondary',

          height: 'sm',

          action: {

            type: 'postback',

            label: '← กลับรายการ',

            data:
              `search_page:${page}`,

            displayText:
              `กลับรายการ หน้า ${page}`
          }
        }

      ]
    }

  }
}


// ==================================================
// SEARCH LIST FLEX
// ==================================================

function buildSearchListFlex(state) {

  const allResults =
    Array.isArray(
      state?.searchResults
    )
      ? state.searchResults
      : []


  // ==================================================
  // TOTAL
  // ==================================================

  const total =
    allResults.length


  const totalPages =
    Math.max(
      1,
      Math.ceil(
        total /
        SEARCH_PAGE_SIZE
      )
    )


  // ==================================================
  // CURRENT PAGE
  // ==================================================

  let page =
    Number(
      state?.searchPage || 1
    )

  if (!Number.isFinite(page)) {
    page = 1
  }

  page =
    Math.max(
      1,
      Math.min(
        page,
        totalPages
      )
    )


  state.searchPage =
    page


  // ==================================================
  // SLICE DATA
  // ==================================================

  const startIndex =
    (page - 1) *
    SEARCH_PAGE_SIZE


  const endIndex =
    Math.min(
      startIndex +
        SEARCH_PAGE_SIZE,
      total
    )


  const pageItems =
    allResults.slice(
      startIndex,
      endIndex
    )


  // ==================================================
  // ROWS
  // ==================================================

  const rows = []


  pageItems.forEach(
    (item, index) => {

      const realIndex =
        startIndex +
        index


      const date =
        item?.dateText ||
        item?.date ||
        '-'


      const bn =
        item?.bn ||
        '-'


      const totalText =
        formatNumber(
          item?.total
        )


      rows.push({

        type: 'box',

        layout: 'vertical',

        spacing: 'xs',

        paddingTop: '10px',

        paddingBottom: '10px',

        contents: [

          // ==================================================
          // TOP ROW
          // ==================================================

          {
            type: 'box',

            layout: 'horizontal',

            spacing: 'sm',

            contents: [

              {
                type: 'text',

                text:
                  `${realIndex + 1}.`,

                size: 'sm',

                weight: 'bold',

                color: '#333333',

                flex: 0
              },

              {
                type: 'text',

                text:
                  safeFlexText(date),

                size: 'sm',

                color: '#333333',

                flex: 1,

                wrap: true
              },

              {
                type: 'text',

                text:
                  `${totalText} บาท`,

                size: 'sm',

                weight: 'bold',

                color: '#1976D2',

                align: 'end',

                flex: 0,

                wrap: true
              }

            ]
          },


          // ==================================================
          // BN + DETAIL BUTTON
          // ==================================================

          {
            type: 'box',

            layout: 'horizontal',

            margin: 'xs',

            spacing: 'sm',

            contents: [

              {
                type: 'text',

                text:
                  `BN: ${safeFlexText(bn)}`,

                size: 'xs',

                color: '#777777',

                flex: 1,

                wrap: true
              },

              {
                type: 'button',

                style: 'secondary',

                height: 'sm',

                flex: 0,

                action: {

                  type: 'postback',

                  label: 'ดูข้อมูล',

                  data:
                    `search_detail:${realIndex}`,

                  displayText:
                    `ดูข้อมูลรายการ ${realIndex + 1}`
                }
              }

            ]
          },


          {
            type: 'separator',

            margin: 'sm'
          }

        ]
      })

    }
  )


  // ==================================================
  // HEADER
  // ==================================================

  const headerContents = [

    {
      type: 'text',

      text: '📄 รายการเอกสาร',

      size: 'xl',

      weight: 'bold',

      color: '#FFFFFF'
    },

    {
      type: 'text',

      text:
        total === 0
          ? 'ไม่พบข้อมูล'
          : `แสดง ${startIndex + 1}-${endIndex} จาก ${total} รายการ`,

      size: 'sm',

      color: '#E3F2FD',

      margin: 'sm'
    },

    {
      type: 'text',

      text:
        `หน้า ${page}/${totalPages}`,

      size: 'sm',

      color: '#FFFFFF',

      margin: 'xs'
    }

  ]


  // ==================================================
  // NAVIGATION
  // ==================================================

  const previousPage =
    page - 1


  const nextPage =
    page + 1


  const canPrevious =
    page > 1


  const canNext =
    page < totalPages


  const navigation = {

    type: 'box',

    layout: 'horizontal',

    spacing: 'sm',

    contents: [

      // ==================================================
      // PREVIOUS
      // ==================================================

      {
        type: 'button',

        style: 'secondary',

        color:
          canPrevious
            ? '#1976D2'
            : '#E0E0E0',

        height: 'sm',

        flex: 1,

        action: canPrevious
        ? {
            type: 'postback',
            label: '← ก่อนหน้า',
            data: `search_page:${previousPage}`,
            displayText: `หน้า ${previousPage}`
            }
        : {
            type: 'postback',
            label: '← ก่อนหน้า',
            data: 'search_disabled'
            }

      },


      // ==================================================
      // CURRENT PAGE
      // ==================================================

      {
        type: 'button',

        style: 'primary',

        color: '#1976D2',

        height: 'sm',

        flex: 1,

        action: {

          type: 'message',

          label:
            `${page}/${totalPages}`,

          text:
            `หน้าปัจจุบัน ${page}/${totalPages}`

        }
      },


      // ==================================================
      // NEXT
      // ==================================================

      {
        type: 'button',

        style: 'secondary',

        color:
          canNext
            ? '#1976D2'
            : '#E0E0E0',

        height: 'sm',

        flex: 1,

        action: canNext
        ? {
            type: 'postback',
            label: 'ถัดไป →',
            data: `search_page:${nextPage}`,
            displayText: `หน้า ${nextPage}`
            }
        : {
            type: 'postback',
            label: 'ถัดไป →',
            data: 'search_disabled'
            }

      }

    ]
  }


  // ==================================================
  // RETURN
  // ==================================================

  return {

    type: 'bubble',

    size: 'mega',


    // ==================================================
    // HEADER
    // ==================================================

    header: {

      type: 'box',

      layout: 'vertical',

      backgroundColor: '#1976D2',

      paddingAll: '18px',

      contents:
        headerContents
    },


    // ==================================================
    // BODY
    // ==================================================

    body: {

      type: 'box',

      layout: 'vertical',

      spacing: 'none',

      paddingAll: '14px',

      contents:

        rows.length > 0

          ? rows

          : [

              {
                type: 'text',

                text:
                  '❌ ไม่พบข้อมูลครับ',

                align: 'center',

                color: '#777777',

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

      paddingAll: '12px',

      contents: [

        navigation,


        {
          type: 'text',

          text:
            `👤 Employee: ${safeFlexText(
              state?.employeeCode
            )}`,

          size: 'xs',

          color: '#888888',

          align: 'center',

          margin: 'sm'
        },


        {
          type: 'text',

          text:
            `📅 ${safeFlexText(
              state?.searchMonth
            )}/${safeFlexText(
              state?.searchYear
            )}`,

          size: 'xs',

          color: '#888888',

          align: 'center'
        }

      ]
    }

  }
}


// ==================================================
// EMPLOYEE FLEX
// ==================================================

function buildEmployeeConfirmFlex(
  employeeCode
) {

  return {

    type: 'bubble',

    size: 'mega',

    header: {

      type: 'box',

      layout: 'vertical',

      backgroundColor: '#1976D2',

      paddingAll: '18px',

      contents: [

        {
          type: 'text',

          text: '🔎 ค้นหาเอกสาร',

          color: '#FFFFFF',

          size: 'xl',

          weight: 'bold'
        },

        {
          type: 'text',

          text: 'รหัสพนักงาน',

          color: '#E3F2FD',

          size: 'sm',

          margin: 'sm'
        }

      ]
    },


    body: {

      type: 'box',

      layout: 'vertical',

      spacing: 'md',

      paddingAll: '18px',

      contents: [

        {
          type: 'text',

          text:
            safeFlexText(employeeCode),

          size: 'xxl',

          weight: 'bold',

          color: '#1976D2',

          align: 'center',

          wrap: true
        },

        {
          type: 'text',

          text:
            'เลือกเดือนที่ต้องการค้นหา',

          size: 'sm',

          color: '#777777',

          align: 'center',

          margin: 'md',

          wrap: true
        }

      ]
    },


    footer: {

      type: 'box',

      layout: 'vertical',

      paddingAll: '12px',

      contents: [

        {
          type: 'button',

          style: 'primary',

          color: '#1976D2',

          action: {

            type: 'postback',

            label: '📅 เลือกเดือน',

            data: 'search_choose_month'

          }
        }

      ]
    }

  }
}


// ==================================================
// MONTH FLEX
// ==================================================

function buildMonthFlex(
  mode = 'search'
) {

  const prefix =
    mode === 'summary'
      ? 'summary_month:'
      : 'search_month:'


  const months = [

    ['01', 'มกราคม'],
    ['02', 'กุมภาพันธ์'],
    ['03', 'มีนาคม'],
    ['04', 'เมษายน'],
    ['05', 'พฤษภาคม'],
    ['06', 'มิถุนายน'],
    ['07', 'กรกฎาคม'],
    ['08', 'สิงหาคม'],
    ['09', 'กันยายน'],
    ['10', 'ตุลาคม'],
    ['11', 'พฤศจิกายน'],
    ['12', 'ธันวาคม']

  ]


  const rows = []


  // ==================================================
  // 2 MONTHS PER ROW
  // ==================================================

  for (
    let i = 0;
    i < months.length;
    i += 2
  ) {

    const rowItems =
      months
        .slice(i, i + 2)
        .map(
          ([value, label]) => ({

            type: 'button',

            style: 'secondary',

            height: 'sm',

            flex: 1,

            action: {

              type: 'postback',

              label:
                `${value} ${label}`,

              data:
                `${prefix}${value}`,

              displayText:
                `เดือน ${value}`

            }

          })
        )


    rows.push({

      type: 'box',

      layout: 'horizontal',

      spacing: 'sm',

      contents:
        rowItems

    })

  }


  // ==================================================
  // RETURN
  // ==================================================

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

          text:
            mode === 'summary'
              ? '📊 เลือกเดือนสรุปยอด'
              : '📅 เลือกเดือน',

          weight: 'bold',

          size: 'xl',

          color: '#111111'
        },

        {
          type: 'text',

          text:
            mode === 'summary'
              ? 'เลือกเดือนที่ต้องการดูยอดรวม'
              : 'เลือกเดือนที่ต้องการค้นหา',

          size: 'sm',

          color: '#777777',

          margin: 'sm',

          wrap: true
        },

        {
          type: 'separator',

          margin: 'lg'
        },

        {
          type: 'box',

          layout: 'vertical',

          spacing: 'sm',

          margin: 'lg',

          contents:
            rows

        }

      ]
    }

  }
}


// ==================================================
// YEAR FLEX
// ==================================================

function buildYearFlex(
  mode = 'search'
) {

  const currentYear =
    new Date().getFullYear()


  const minYear =
    currentYear - 5


  const prefix =
    mode === 'summary'
      ? 'summary_year:'
      : 'search_year:'


  const years = []


  for (
    let year = currentYear;
    year >= minYear;
    year--
  ) {

    years.push(
      String(year)
    )

  }


  const rows = []


  for (
    let i = 0;
    i < years.length;
    i += 3
  ) {

    const rowItems =
      years
        .slice(i, i + 3)
        .map(
          year => ({

            type: 'button',

            style: 'secondary',

            height: 'sm',

            flex: 1,

            action: {

              type: 'postback',

              label: year,

              data:
                `${prefix}${year}`,

              displayText:
                `ปี ${year}`

            }

          })
        )


    rows.push({

      type: 'box',

      layout: 'horizontal',

      spacing: 'sm',

      contents:
        rowItems

    })

  }


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

          text:
            mode === 'summary'
              ? '📊 เลือกปีสรุปยอด'
              : '📅 เลือกปี',

          weight: 'bold',

          size: 'xl',

          color: '#111111'
        },

        {
          type: 'text',

          text:
            mode === 'summary'
              ? 'เลือกปีที่ต้องการดูยอดรวม'
              : 'เลือกปีที่ต้องการค้นหา',

          size: 'sm',

          color: '#777777',

          margin: 'sm',

          wrap: true
        },

        {
          type: 'separator',

          margin: 'lg'
        },

        {
          type: 'box',

          layout: 'vertical',

          spacing: 'sm',

          margin: 'lg',

          contents:
            rows

        }

      ]
    }

  }
}


// ==================================================
// SEARCH TYPE FLEX
// ==================================================

function buildSearchTypeFlex() {

  return {

    type: 'bubble',

    size: 'mega',

    header: {

      type: 'box',

      layout: 'vertical',

      backgroundColor: '#1976D2',

      paddingAll: '18px',

      contents: [

        {
          type: 'text',

          text: '🔎 ประเภทการค้นหา',

          color: '#FFFFFF',

          size: 'xl',

          weight: 'bold'
        },

        {
          type: 'text',

          text:
            'เลือกข้อมูลที่ต้องการค้นหา',

          color: '#E3F2FD',

          size: 'sm',

          margin: 'sm',

          wrap: true
        }

      ]
    },


    body: {

      type: 'box',

      layout: 'vertical',

      spacing: 'sm',

      paddingAll: '14px',

      contents: [

        {
          type: 'button',

          style: 'primary',

          color: '#1976D2',

          action: {

            type: 'postback',

            label: '🧾 BN',

            data: 'search_type:BN'

          }

        },

        {
          type: 'button',

          style: 'primary',

          color: '#1976D2',

          margin: 'sm',

          action: {

            type: 'postback',

            label: '👤 HN',

            data: 'search_type:HN'

          }

        },

        {
          type: 'button',

          style: 'primary',

          color: '#1976D2',

          margin: 'sm',

          action: {

            type: 'postback',

            label: '🧑 ชื่อคนไข้',

            data: 'search_type:NAME'

          }

        },

        {
          type: 'button',

          style: 'primary',

          color: '#1976D2',

          margin: 'sm',

          action: {

            type: 'postback',

            label: '📅 วันที่',

            data: 'search_type:DATE'

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

  SEARCH_PAGE_SIZE,

  buildEmployeeConfirmFlex,

  buildMonthFlex,

  buildYearFlex,

  buildSearchTypeFlex,

  buildSearchListFlex,

  buildSearchDetailFlex

}
