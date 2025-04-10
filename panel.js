// 全局变量声明
let currentEvents = []
let selectedEventIndex = -1
let formatMode = "json"
let port
let tabId
let sseRequests = {}
let groupByRequest = true
let expandedRequests = {}
let currentEventData = null

// DOM元素
const eventList = document.getElementById("event-list")
const eventDetail = document.getElementById("event-detail")
const filterInput = document.getElementById("filter-input")
const clearBtn = document.getElementById("clear-btn")
const copyBtn = document.getElementById("copy-btn")
const formatSelect = document.getElementById("format-select")

// 将初始化放入全局作用域，以便通过devtools.js调用
window.panelLoaded = true
window.initializePanel = function (inspectedTabId) {
  tabId = inspectedTabId

  // 与background.js建立连接
  port = chrome.runtime.connect({
    name: `sse-panel-${tabId}`,
  })

  // 注册事件处理程序
  setupEventListeners()

  // 请求初始数据
  refreshEvents()

  // 开始周期性刷新
  setInterval(refreshEvents, 3000)

  // 添加分组切换按钮初始化
  initGroupToggle()
}

// 如果tabId已经通过onShown传递，则直接初始化
if (window.tabId) {
  window.initializePanel(window.tabId)
}

// 设置事件监听器
function setupEventListeners() {
  filterInput.addEventListener("input", filterEvents)
  clearBtn.addEventListener("click", clearEvents)
  copyBtn.addEventListener("click", copyEventData)

  // 修复格式切换功能
  formatSelect.addEventListener("change", (e) => {
    formatMode = e.target.value

    // 如果当前正在查看事件，重新渲染
    if (currentEventData) {
      const eventDetail = document.getElementById("event-detail")
      const dataContainer = eventDetail.querySelector(".event-data")

      if (dataContainer) {
        if (formatMode === "raw") {
          dataContainer.textContent = currentEventData
        } else {
          try {
            // 清空现有内容
            dataContainer.innerHTML = ""
            // 重新渲染JSON视图
            const jsonData = JSON.parse(currentEventData)
            dataContainer.appendChild(createInteractiveJson(jsonData))
          } catch (e) {
            dataContainer.textContent = currentEventData
          }
        }
      }
    }
  })

  // 添加其他已存在的事件监听器...
  port.onMessage.addListener(function (msg) {
    if (msg.action === "allSSERequests") {
      sseRequests = msg.sseRequests
      updateEventsFromRequests()
    } else if (msg.action === "newSSERequest") {
      sseRequests[msg.requestId] = msg.request
      updateEventsFromRequests()
    } else if (msg.action === "newSSEEvent") {
      if (sseRequests[msg.requestId]) {
        if (!sseRequests[msg.requestId].events) {
          sseRequests[msg.requestId].events = []
        }
        sseRequests[msg.requestId].events.push(msg.event)
        updateEventsFromRequests()
      }
    }
  })

  // 处理连接错误
  port.onDisconnect.addListener(function () {
    console.log("连接断开，尝试重新连接...")
    setTimeout(() => {
      window.initializePanel(tabId)
    }, 1000)
  })

  // 添加分组模式切换按钮监听
  document
    .getElementById("group-toggle")
    .addEventListener("change", function (e) {
      groupByRequest = e.target.checked
      updateEventsFromRequests()
    })

  // 确保搜索框清除按钮工作
  const filterClearBtn = document.getElementById("filter-clear-btn")
  if (filterClearBtn) {
    filterClearBtn.addEventListener("click", function () {
      filterInput.value = ""
      filterEvents()
      filterInput.focus()
    })
  }

  // 确保回车键也触发过滤
  filterInput.addEventListener("keyup", function (e) {
    if (e.key === "Enter") {
      filterEvents()
    }
  })
}

// 初始化分组切换按钮
function initGroupToggle() {
  const groupToggle = document.getElementById("group-toggle")
  if (groupToggle) {
    groupToggle.checked = groupByRequest
  }
}

// 从background脚本获取SSE请求
function refreshEvents() {
  if (port) {
    port.postMessage({ action: "getSSERequests" })
  }
}

// 从请求数据中提取所有事件
function updateEventsFromRequests() {
  if (groupByRequest) {
    renderGroupedEventList()
  } else {
    // 平铺模式 - 原始行为
    currentEvents = []

    Object.values(sseRequests).forEach((request) => {
      if (request.events && request.events.length) {
        currentEvents = currentEvents.concat(
          request.events.map((event) => ({
            ...event,
            url: request.url,
            requestId: request.id,
          }))
        )
      }
    })

    currentEvents.sort((a, b) => a.timestamp - b.timestamp)
    renderEventList(currentEvents)
  }
}

// 渲染分组的事件列表
function renderGroupedEventList() {
  eventList.innerHTML = ""

  // 检查是否有请求
  if (Object.keys(sseRequests).length === 0) {
    const emptyItem = document.createElement("li")
    emptyItem.textContent = "No SSE requests captured yet"
    emptyItem.className = "event-item empty"
    eventList.appendChild(emptyItem)

    // 清空详情区域
    eventDetail.innerHTML =
      '<div class="placeholder">Waiting for SSE events...</div>'
    return
  }

  // 按请求分组渲染
  Object.entries(sseRequests).forEach(([requestId, request]) => {
    // 创建请求组容器
    const requestGroup = document.createElement("div")
    requestGroup.className = "request-group"
    requestGroup.dataset.requestId = requestId

    // 创建请求头部
    const header = document.createElement("div")
    header.className = "request-header"

    // 从URL中提取路径作为显示名称
    let displayName
    try {
      const urlObj = new URL(request.url)
      displayName = urlObj.pathname
    } catch (e) {
      displayName = request.url
    }

    // 添加展开/折叠标志
    const isExpanded = expandedRequests[requestId] !== false // 默认展开

    header.innerHTML = `
      <span class="collapse-icon">${isExpanded ? "▼" : "►"}</span>
      <span class="request-name" title="${request.url}">${displayName}</span>
      <span class="request-method">${request.method || "GET"}</span>
      <span class="request-count">(${request.events?.length || 0})</span>
      <span class="request-time">${new Date(
        request.startTime
      ).toLocaleTimeString()}</span>
    `

    // 点击切换展开/折叠
    header.addEventListener("click", function () {
      const isCurrentlyExpanded = expandedRequests[requestId] !== false
      expandedRequests[requestId] = !isCurrentlyExpanded

      const collapseIcon = header.querySelector(".collapse-icon")
      collapseIcon.textContent = !isCurrentlyExpanded ? "▼" : "►"

      const eventsList = requestGroup.querySelector(".request-events")
      if (eventsList) {
        eventsList.style.display = !isCurrentlyExpanded ? "block" : "none"
      }

      // 切换请求参数信息显示
      const requestInfo = requestGroup.querySelector(".request-info")
      if (requestInfo) {
        requestInfo.style.display = !isCurrentlyExpanded ? "flex" : "none"
      }
    })

    requestGroup.appendChild(header)

    // 创建请求信息区域 - 包含URL参数和body参数
    const requestInfo = document.createElement("div")
    requestInfo.className = "request-info"
    requestInfo.style.display = isExpanded ? "flex" : "none"

    // URL参数
    let paramHtml = ""
    if (request.params && Object.keys(request.params).length > 0) {
      paramHtml += `<div class="param-section">
        <div class="param-section-title">URL参数</div>
        <div class="param-list">`

      for (const [key, value] of Object.entries(request.params)) {
        paramHtml += `<div class="param-item">
          <span class="param-name">${key}:</span> 
          <span class="param-value">${value}</span>
        </div>`
      }

      paramHtml += `</div></div>`
    }

    // Body参数
    if (request.bodyParams && Object.keys(request.bodyParams).length > 0) {
      paramHtml += `<div class="param-section">
        <div class="param-section-title">Body参数</div>
        <div class="param-list">`

      for (const [key, value] of Object.entries(request.bodyParams)) {
        let displayValue = value
        if (typeof value === "object") {
          try {
            displayValue = JSON.stringify(value, null, 2)
          } catch (e) {
            displayValue = String(value)
          }
        }
        paramHtml += `<div class="param-item">
          <span class="param-name">${key}:</span> 
          <span class="param-value">${displayValue}</span>
        </div>`
      }

      paramHtml += `</div></div>`
    }

    // 如果没有参数，显示提示信息
    if (!paramHtml) {
      paramHtml = `<div class="no-params">没有查询参数或请求体参数</div>`
    }

    // 填充参数到请求信息区域
    requestInfo.innerHTML = paramHtml
    requestGroup.appendChild(requestInfo)

    // 创建事件列表容器
    const eventsList = document.createElement("ul")
    eventsList.className = "request-events"
    eventsList.style.display = isExpanded ? "block" : "none"

    // 渲染此请求的所有事件
    if (request.events && request.events.length) {
      request.events.forEach((event, index) => {
        const item = document.createElement("li")
        item.className = "event-item"

        // 为事件创建唯一索引
        const eventUniqueId = `${requestId}-${index}`
        item.dataset.eventId = eventUniqueId

        // 检查是否被选中
        if (selectedEventIndex === eventUniqueId) {
          item.classList.add("selected")
        }

        const time = new Date(event.timestamp).toLocaleTimeString()

        // 显示事件名称或数据摘要
        let eventLabel = event.eventName || "(unnamed event)"
        if (!eventLabel || eventLabel === "") {
          try {
            const parsed = JSON.parse(event.data)
            eventLabel = parsed.type || parsed.event || "Event"
          } catch (e) {
            eventLabel =
              event.data.substring(0, 30) +
              (event.data.length > 30 ? "..." : "")
          }
        }

        item.innerHTML = `
          <div>${eventLabel}</div>
          <div class="event-time">${time}</div>
        `

        // 点击事件，显示详情
        item.addEventListener("click", () => {
          selectedEventIndex = eventUniqueId
          document
            .querySelectorAll(".event-item.selected")
            .forEach((el) => el.classList.remove("selected"))
          item.classList.add("selected")

          // 保存事件引用
          const eventWithMeta = {
            ...event,
            url: request.url,
            requestId: requestId,
          }

          displayEventDetails(eventWithMeta)
        })

        eventsList.appendChild(item)
      })
    } else {
      // 没有事件的情况
      const emptyItem = document.createElement("li")
      emptyItem.textContent = "No events received"
      emptyItem.className = "event-item empty"
      eventsList.appendChild(emptyItem)
    }

    requestGroup.appendChild(eventsList)
    eventList.appendChild(requestGroup)
  })

  // 如果没有选中任何事件，默认选择第一个事件
  if (selectedEventIndex === -1) {
    const firstItem = eventList.querySelector(".event-item:not(.empty)")
    if (firstItem) {
      firstItem.click()
    }
  }
}

// 渲染事件列表
function renderEventList(events) {
  eventList.innerHTML = ""

  if (events.length === 0) {
    const emptyItem = document.createElement("li")
    emptyItem.textContent = "No SSE events captured yet"
    emptyItem.className = "event-item empty"
    eventList.appendChild(emptyItem)

    // 清空详情区域
    eventDetail.innerHTML =
      '<div class="placeholder">Waiting for SSE events...</div>'
    return
  }

  events.forEach((event, index) => {
    const item = document.createElement("li")
    item.className = "event-item"
    if (index === selectedEventIndex) {
      item.classList.add("selected")
    }

    const time = new Date(event.timestamp).toLocaleTimeString()

    // 显示事件名称或数据摘要
    let eventLabel = event.eventName || "(unnamed event)"
    if (!eventLabel || eventLabel === "") {
      try {
        const parsed = JSON.parse(event.data)
        eventLabel = parsed.type || parsed.event || "Event"
      } catch (e) {
        eventLabel =
          event.data.substring(0, 30) + (event.data.length > 30 ? "..." : "")
      }
    }

    item.innerHTML = `
      <div>${eventLabel}</div>
      <div class="event-time">${time}</div>
    `

    item.addEventListener("click", () => {
      selectedEventIndex = index
      document
        .querySelectorAll(".event-item.selected")
        .forEach((el) => el.classList.remove("selected"))
      item.classList.add("selected")
      displayEventDetails(event)
    })

    eventList.appendChild(item)
  })

  // 如果有事件但没选中任何事件，默认选中第一个
  if (events.length > 0 && selectedEventIndex === -1) {
    selectedEventIndex = 0
    const firstItem = eventList.querySelector(".event-item")
    if (firstItem) {
      firstItem.classList.add("selected")
      displayEventDetails(events[0])
    }
  }
}

// 显示事件详情
function displayEventDetails(event) {
  if (!event) {
    eventDetail.innerHTML =
      '<div class="placeholder">Select an event to see details</div>'
    return
  }

  // 构建更丰富的详情视图
  const detailContainer = document.createElement("div")
  detailContainer.className = "event-detail-container"

  // 添加元数据
  const metaInfo = document.createElement("div")
  metaInfo.className = "event-meta"

  // 添加事件基本信息 - 移除了参数相关内容
  let requestInfo = `<div><strong>Time:</strong> ${new Date(
    event.timestamp
  ).toLocaleString()}</div>`

  if (event.eventId) {
    requestInfo += `<div><strong>Event ID:</strong> ${event.eventId}</div>`
  }

  if (event.eventName) {
    requestInfo += `<div><strong>Event Name:</strong> ${event.eventName}</div>`
  }

  requestInfo += `<div><strong>Source:</strong> ${event.url}</div>`

  // 移除了请求参数相关的代码

  metaInfo.innerHTML = requestInfo
  detailContainer.appendChild(metaInfo)

  // 添加数据内容
  const dataContainer = document.createElement("div")
  dataContainer.className = "event-data"

  // 储存当前查看的事件数据，便于切换格式
  currentEventData = event.data

  if (formatMode === "raw") {
    dataContainer.textContent = event.data
  } else {
    try {
      // 使用JSONFormatter进行渲染
      const jsonData = JSON.parse(event.data)
      const formatter = new JSONFormatter(jsonData, 2, { theme: "default" }) // 默认展开两级
      dataContainer.appendChild(formatter.element)
    } catch (e) {
      dataContainer.textContent = event.data
    }
  }

  detailContainer.appendChild(dataContainer)
  eventDetail.innerHTML = ""
  eventDetail.appendChild(detailContainer)
}

// 过滤事件
function filterEvents() {
  const filterText = filterInput.value.toLowerCase().trim()

  console.log("[SSE Preview] 过滤事件, 关键词:", filterText)

  // 分组模式下的过滤
  if (groupByRequest) {
    filterGroupedEvents(filterText)
  }
  // 平铺模式下的过滤
  else {
    filterFlatEvents(filterText)
  }
}

// 在分组模式下过滤事件
function filterGroupedEvents(filterText) {
  // 遍历所有请求组
  let foundAny = false
  const groups = document.querySelectorAll(".request-group")
  console.log(`[SSE Preview] 对 ${groups.length} 个请求组应用过滤`)

  groups.forEach((group) => {
    let hasMatchingEvents = false
    const requestId = group.dataset.requestId

    // 也检查URL是否包含过滤文本
    const request = sseRequests[requestId]
    const urlMatch = request && request.url.toLowerCase().includes(filterText)

    // 获取事件列表
    const eventItems = group.querySelectorAll(".event-item:not(.empty)")
    console.log(
      `[SSE Preview] 请求组 ${requestId} 包含 ${eventItems.length} 个事件`
    )

    // 检查每个事件是否匹配
    eventItems.forEach((item) => {
      const eventId = item.dataset.eventId
      if (!eventId) return

      const [reqId, eventIndex] = eventId.split("-")
      const event = sseRequests[reqId]?.events[eventIndex]

      // 检查是否匹配
      let matches = urlMatch // 先看URL是否匹配

      if (!matches && event) {
        try {
          matches =
            (event.data && event.data.toLowerCase().includes(filterText)) ||
            (event.eventName &&
              event.eventName.toLowerCase().includes(filterText)) ||
            (event.eventId && event.eventId.toLowerCase().includes(filterText))
        } catch (e) {
          console.error("[SSE Preview] 过滤事件时出错:", e)
        }
      }

      // 设置显示状态
      if (matches || !filterText) {
        item.style.display = "block"
        hasMatchingEvents = true
        foundAny = true
      } else {
        item.style.display = "none"
      }
    })

    // 根据是否有匹配的事件决定是否显示整个请求组
    group.style.display = hasMatchingEvents || !filterText ? "block" : "none"

    // 如果有过滤文本并有匹配事件，自动展开请求组
    if (filterText && hasMatchingEvents) {
      expandRequestGroup(group, true)
    }
  })

  console.log(`[SSE Preview] 过滤结果: ${foundAny ? "找到匹配项" : "无匹配项"}`)

  // 如果没有匹配项且有过滤文本，显示无结果提示
  const noResultsEl = document.getElementById("no-filter-results")
  if (filterText && !foundAny) {
    if (!noResultsEl) {
      const noResults = document.createElement("div")
      noResults.id = "no-filter-results"
      noResults.className = "no-filter-results"
      noResults.textContent = `没有找到包含 "${filterText}" 的事件`
      eventList.appendChild(noResults)
    }
  } else if (noResultsEl) {
    noResultsEl.remove()
  }
}

// 辅助函数：展开或折叠请求组
function expandRequestGroup(group, expand) {
  const requestId = group.dataset.requestId
  expandedRequests[requestId] = expand

  const header = group.querySelector(".request-header")
  const eventsList = group.querySelector(".request-events")
  const collapseIcon = header?.querySelector(".collapse-icon")
  const requestInfo = group.querySelector(".request-info")

  if (eventsList) {
    eventsList.style.display = expand ? "block" : "none"
  }

  if (collapseIcon) {
    collapseIcon.textContent = expand ? "▼" : "►"
  }

  if (requestInfo) {
    requestInfo.style.display = expand ? "flex" : "none"
  }
}

// 在平铺模式下过滤事件
function filterFlatEvents(filterText) {
  if (!filterText) {
    renderEventList(currentEvents)
    return
  }

  const filtered = currentEvents.filter((event) => {
    return (
      (event.data && event.data.toLowerCase().includes(filterText)) ||
      (event.eventName && event.eventName.toLowerCase().includes(filterText)) ||
      (event.eventId && event.eventId.toLowerCase().includes(filterText))
    )
  })

  renderEventList(filtered)
}

// 清除所有事件
function clearEvents() {
  currentEvents = []
  selectedEventIndex = -1
  renderEventList([])
  displayEventDetails(null)

  // 向background发送清除请求
  if (port) {
    port.postMessage({ action: "clearSSERequests" })
  }
}

// 修复复制按钮功能
function copyEventData() {
  let dataToCopy = ""

  // 确定当前正在查看的事件数据
  if (currentEventData) {
    dataToCopy = currentEventData
  } else if (
    typeof selectedEventIndex === "number" &&
    selectedEventIndex >= 0
  ) {
    dataToCopy = currentEvents[selectedEventIndex].data
  } else if (
    typeof selectedEventIndex === "string" &&
    selectedEventIndex.includes("-")
  ) {
    const [requestId, eventIndex] = selectedEventIndex.split("-")
    if (
      sseRequests[requestId]?.events &&
      sseRequests[requestId].events[eventIndex]
    ) {
      dataToCopy = sseRequests[requestId].events[eventIndex].data
    }
  }

  if (dataToCopy) {
    // 使用更可靠的复制方法，结合Clipboard API和fallback
    copyToClipboard(dataToCopy)
  }
}

// 增强的复制到剪贴板函数
function copyToClipboard(text) {
  // 方法1: 使用Clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(text)
      .then(() => showCopySuccessIndicator())
      .catch((err) => {
        // 如果Clipboard API失败，尝试替代方法
        fallbackCopyToClipboard(text)
      })
  } else {
    // 方法2: 如果不支持Clipboard API，使用传统方法
    fallbackCopyToClipboard(text)
  }
}

// 传统的复制方法作为后备
function fallbackCopyToClipboard(text) {
  try {
    // 创建一个临时文本区域
    const textArea = document.createElement("textarea")
    textArea.value = text

    // 避免滚动到底部
    textArea.style.top = "0"
    textArea.style.left = "0"
    textArea.style.position = "fixed"
    textArea.style.opacity = "0"

    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()

    // 执行复制命令
    const successful = document.execCommand("copy")

    // 清理并显示结果
    document.body.removeChild(textArea)

    if (successful) {
      showCopySuccessIndicator()
    } else {
      showCopyErrorIndicator()
    }
  } catch (err) {
    showCopyErrorIndicator()
  }
}

// 添加复制成功提示
function showCopySuccessIndicator() {
  // 保存原始文字
  const originalText = copyBtn.textContent

  // 创建并显示通知
  copyBtn.textContent = "已复制!"
  copyBtn.classList.add("copy-success")

  // 设置超时恢复原始状态
  setTimeout(() => {
    copyBtn.textContent = originalText
    copyBtn.classList.remove("copy-success")
  }, 1500)

  // 创建额外的提示元素 (toast)
  const toast = document.createElement("div")
  toast.className = "toast-notification success"
  toast.textContent = "复制成功"
  document.body.appendChild(toast)

  // 显示toast然后淡出
  setTimeout(() => {
    toast.classList.add("show")
    setTimeout(() => {
      toast.classList.remove("show")
      setTimeout(() => {
        document.body.removeChild(toast)
      }, 300)
    }, 1200)
  }, 0)
}

// 复制失败提示
function showCopyErrorIndicator() {
  const originalText = copyBtn.textContent
  copyBtn.textContent = "复制失败"
  copyBtn.classList.add("copy-error")

  setTimeout(() => {
    copyBtn.textContent = originalText
    copyBtn.classList.remove("copy-error")
  }, 1500)
}

// 修复格式切换处理程序
formatSelect.addEventListener("change", (e) => {
  formatMode = e.target.value

  // 记住当前查看的事件
  const currentEvent = getCurrentEvent()

  // 如果有当前事件，重新渲染
  if (currentEvent) {
    displayEventDetails(currentEvent)
  }
})

// 获取当前查看的完整事件对象
function getCurrentEvent() {
  if (typeof selectedEventIndex === "number" && selectedEventIndex >= 0) {
    return currentEvents[selectedEventIndex]
  } else if (
    typeof selectedEventIndex === "string" &&
    selectedEventIndex.includes("-")
  ) {
    const [requestId, eventIndex] = selectedEventIndex.split("-")
    if (sseRequests[requestId]?.events) {
      const event = sseRequests[requestId].events[eventIndex]
      if (event) {
        return {
          ...event,
          url: sseRequests[requestId].url,
          requestId: requestId,
        }
      }
    }
  }
  return null
}
