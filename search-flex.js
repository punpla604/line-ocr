
// ==================================================
// SEARCH FLEX MESSAGE
// ==================================================

const SEARCH_PAGE_SIZE = 10

function safeFlexText(value) {
  const text =
    String(value ?? '-')
      .trim()

  return text || '-'
}
function formatNumber(value) {
  const num = Number(
    String(value ?? '0')
      .replace(/,/g, '')
      .trim()
  )

  if (isNaN(num)) {
    return '0.00'
  }

  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
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
          text: `รายการที่ ${index + 1}`,
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
            `BN: ${safeFlexText(item.bn)}`,
          size: 'md',
          weight: 'bold',
          wrap: true
        },

        {
          type: 'separator',
          margin: 'sm'
        },

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
              flex: 1
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
                `${formatNumber(item.doctorFee)} บาท`,
              size: 'sm',
              align: 'end',
              flex: 2
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
              text: 'Hospital & Nursing',
              size: 'sm',
              color: '#777777',
              flex: 1
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
                `${formatNumber(item.other)} บาท`,
              size: 'sm',
              align: 'end',
              flex: 2
            }
          ]
        }
      ]
    },

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
              `search_page:${page}`
          }
        }

      ]
    }
  }
}

// ==================================================
// SEARCH LIST FLEX
// ==================================================

function buildSearchListFlex(
  state
) {

  const allResults =
    Array.isArray(
      state.searchResults
    )
      ? state.searchResults
      : []

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

  let page =
    Number(
      state.searchPage || 1
    )

  if (page < 1) {
    page = 1
  }

  if (page > totalPages) {
    page = totalPages
  }

  state.searchPage =
    page

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
        item.dateText ||
        item.date ||
        '-'

      const bn =
        item.bn ||
        '-'

      const totalText =
        formatNumber(
          item.total
        )

      rows.push({

        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        paddingTop: '10px',
        paddingBottom: '10px',

        contents: [

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
                    `search_detail:${realIndex}`
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

      {
        type: 'button',

        style:
          canPrevious
            ? 'secondary'
            : 'secondary',

        color:
          canPrevious
            ? '#1976D2'
            : '#BDBDBD',

        height: 'sm',

        action: {
          type: 'postback',

          label: 'ก่อนหน้า',

          data:
            canPrevious
              ? `search_page:${previousPage}`
              : 'search_noop'
        }
      },

      {
        type: 'button',

        style: 'primary',
        color: '#1976D2',
        height: 'sm',

        action: {
          type: 'postback',

          label:
            `${page}/${totalPages}`,

          data:
            'search_noop'
        }
      },

      {
        type: 'button',

        style: 'secondary',

        color:
          canNext
            ? '#1976D2'
            : '#BDBDBD',

        height: 'sm',

        action: {
          type: 'postback',

          label: 'ถัดไป',

          data:
            canNext
              ? `search_page:${nextPage}`
              : 'search_noop'
        }
      }

    ]
  }

  // ==================================================
  // RETURN FLEX
  // ==================================================

  return {

    type: 'bubble',

    size: 'mega',

    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1976D2',
      paddingAll: '18px',

      contents:
        headerContents
    },

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
                margin: 'lg'
              }
            ]
    },

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
              state.employeeCode
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
              state.searchMonth
            )}/${safeFlexText(
              state.searchYear
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

function buildEmployeeConfirmFlex(employeeCode) {
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
          text: employeeCode,
          size: 'xxl',
          weight: 'bold',
          color: '#1976D2',
          align: 'center'
        },

        {
          type: 'text',
          text: 'เลือกเดือนที่ต้องการค้นหา',
          size: 'sm',
          color: '#777777',
          align: 'center',
          margin: 'md'
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

function buildMonthFlex() {

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

  for (
    let i = 0;
    i < months.length;
    i += 2
  ) {

    const left =
      months[i]

    const right =
      months[i + 1]

    rows.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',

      contents: [

        {
          type: 'button',
          style: 'secondary',
          height: 'sm',
          flex: 1,

          action: {
            type: 'postback',
            label:
              `${left[0]} ${left[1]}`,
            data:
              `search_month:${left[0]}`
          }
        },

        {
          type: 'button',
          style: 'secondary',
          height: 'sm',
          flex: 1,

          action: {
            type: 'postback',
            label:
              `${right[0]} ${right[1]}`,
            data:
              `search_month:${right[0]}`
          }
        }

      ]
    })
  }

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
          text: '📅 เลือกเดือน',
          color: '#FFFFFF',
          size: 'xl',
          weight: 'bold'
        },

        {
          type: 'text',
          text: 'เลือกเดือนที่ต้องการค้นหา',
          color: '#E3F2FD',
          size: 'sm',
          margin: 'sm'
        }
      ]
    },

    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '14px',

      contents: rows
    }
  }
}


// ==================================================
// YEAR FLEX
// ==================================================

function buildYearFlex() {

  const currentYear =
    new Date().getFullYear()

  const minYear =
    currentYear - 5

  const years = []

  for (
    let year = currentYear;
    year >= minYear;
    year--
  ) {
    years.push(year)
  }

  const rows = []

  for (
    let i = 0;
    i < years.length;
    i += 2
  ) {

    const contents = []

    contents.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      flex: 1,

      action: {
        type: 'postback',
        label:
          String(years[i]),
        data:
          `search_year:${years[i]}`
      }
    })

    if (
      years[i + 1]
    ) {
      contents.push({
        type: 'button',
        style: 'secondary',
        height: 'sm',
        flex: 1,

        action: {
          type: 'postback',
          label:
            String(years[i + 1]),
          data:
            `search_year:${years[i + 1]}`
        }
      })
    }

    rows.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents
    })
  }

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
          text: '📅 เลือกปี',
          color: '#FFFFFF',
          size: 'xl',
          weight: 'bold'
        },

        {
          type: 'text',
          text:
            `${minYear} - ${currentYear}`,
          color: '#E3F2FD',
          size: 'sm',
          margin: 'sm'
        }
      ]
    },

    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '14px',

      contents: rows
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
          text: 'เลือกข้อมูลที่ต้องการค้นหา',
          color: '#E3F2FD',
          size: 'sm',
          margin: 'sm'
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

