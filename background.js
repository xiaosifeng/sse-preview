// 存储捕获到的SSE请求
let sseRequests = {}
let connections = {}
let loadedTabs = {}

// 接收fetch事件数据的功能
function setupFetchInterceptor() {
  // 创建一个内容脚本，注入到所有页面中以捕获fetch调用
  chrome.scripting.registerContentScripts([
    {
      id: "sse-interceptor",
      js: ["interceptor.js"],
      matches: ["<all_urls>"],
      runAt: "document_start",
      world: "MAIN",
    },
  ])
}

// 处理从内容脚本发来的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 验证消息格式
  if (!message || !message.type) {
    return
  }

  const tabId = sender.tab?.id

  // 处理内容脚本加载消息
  if (message.type === "CONTENT_SCRIPT_LOADED") {
    loadedTabs[tabId] = true
    return
  }

  // 如果没有tabId，这可能是从开发者工具发来的消息
  if (!tabId && message.type !== "devtools_action") {
    console.warn("SSE Preview: 收到没有tabId的消息", message)
    return
  }

  if (message.type === "SSE_REQUEST_START") {
    const requestId = message.requestId

    // 检查是否已经有相同URL的请求（可能是重复通知）
    const isDuplicate = Object.values(sseRequests).some(
      (req) =>
        req.url === message.url &&
        Date.now() - req.startTime < 1000 &&
        req.tabId === tabId
    )

    if (isDuplicate) {
      console.log("SSE Preview: 忽略可能的重复SSE请求", message.url)
      return
    }

    // 确保提取参数
    const params = message.params || extractUrlParams(message.url) || {}

    sseRequests[requestId] = {
      id: requestId, // 添加ID字段以便于引用
      url: message.url,
      tabId: tabId,
      startTime: Date.now(),
      events: [],
      // 存储请求参数
      params: params,
      // 存储请求体参数和方法
      bodyParams: message.bodyParams || {},
      method: message.method || "GET",
    }

    console.log(`SSE Preview: 检测到新的SSE请求: ${message.url}`, params)

    // 通知所有连接的面板
    notifyPanels("newSSERequest", {
      requestId,
      request: sseRequests[requestId],
    })
  } else if (message.type === "SSE_EVENT_RECEIVED") {
    const requestId = message.requestId
    if (sseRequests[requestId]) {
      const event = {
        eventId: message.eventId || "",
        eventName: message.eventName || "",
        data: message.data || "",
        timestamp: Date.now(),
      }

      sseRequests[requestId].events.push(event)

      // 通知面板有新事件
      notifyPanels("newSSEEvent", { requestId, event })
    }
  }
})

// 从URL中提取参数 - 确保始终返回有效对象
function extractUrlParams(urlString) {
  try {
    const url = new URL(urlString)
    const params = {}
    url.searchParams.forEach((value, key) => {
      params[key] = value
    })
    return params
  } catch (e) {
    console.error("SSE Preview: URL参数提取失败", e)
    return {}
  }
}

// 通知所有已连接的devtools面板
function notifyPanels(action, data) {
  Object.keys(connections).forEach((tabId) => {
    try {
      if (connections[tabId]) {
        connections[tabId].postMessage({
          action,
          ...data,
        })
      }
    } catch (e) {
      console.error("发送消息失败:", e)
      // 如果连接失败，移除连接
      delete connections[tabId]
    }
  })
}

// 处理devtools连接
chrome.runtime.onConnect.addListener(function (port) {
  // 检查是否是SSE面板连接
  if (port.name.startsWith("sse-panel-")) {
    const tabId = port.name.split("-")[2]

    // 保存连接
    connections[tabId] = port

    // 响应面板消息
    port.onMessage.addListener(function (msg) {
      if (msg.action === "getSSERequests") {
        // 过滤当前标签的请求
        const filtered = {}
        Object.keys(sseRequests).forEach((id) => {
          if (sseRequests[id].tabId == tabId) {
            filtered[id] = sseRequests[id]
          }
        })

        port.postMessage({
          action: "allSSERequests",
          sseRequests: filtered,
        })
      } else if (msg.action === "clearSSERequests") {
        // 清除此标签页的请求
        Object.keys(sseRequests).forEach((id) => {
          if (sseRequests[id].tabId == tabId) {
            delete sseRequests[id]
          }
        })

        port.postMessage({
          action: "allSSERequests",
          sseRequests: {},
        })
      }
    })

    // 处理断开连接
    port.onDisconnect.addListener(function () {
      delete connections[tabId]
    })
  }
})

// 插件安装/更新时初始化
chrome.runtime.onInstalled.addListener(() => {
  setupFetchInterceptor()
})

// 调试日志
console.log("SSE Preview: 后台脚本已加载")
