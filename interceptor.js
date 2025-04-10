// 使用IIFE隔离变量作用域，防止重复声明
;(function () {
  // 检查脚本是否已经加载，避免重复执行
  if (window.__SSE_PREVIEW_INTERCEPTOR_LOADED__) {
    console.log("SSE Preview: 拦截器已经加载，跳过重复初始化")
    return
  }

  // 标记脚本已经加载
  window.__SSE_PREVIEW_INTERCEPTOR_LOADED__ = true

  // 首先确认我们是在扩展环境中
  const isExtensionContext =
    typeof chrome !== "undefined" &&
    typeof chrome.runtime !== "undefined" &&
    typeof chrome.runtime.sendMessage !== "undefined"

  // 给每个请求分配唯一ID
  let requestCounter = 0

  // 安全地向扩展发送消息
  function sendMessageToExtension(message) {
    try {
      if (isExtensionContext) {
        chrome.runtime.sendMessage(message).catch((e) => {
          console.error("SSE Preview: 发送消息失败", e)
        })
      } else {
        // 当在网页上下文中运行时，使用自定义事件
        window.dispatchEvent(
          new CustomEvent("sse-preview-event", {
            detail: message,
          })
        )
      }
    } catch (error) {
      console.error("SSE Preview: 消息发送错误", error)
    }
  }

  // 保存原始的fetch方法
  const originalFetch = window.fetch

  // 替换原始fetch方法
  window.fetch = async function (resource, init) {
    const url = resource instanceof Request ? resource.url : resource
    const method =
      init?.method || (resource instanceof Request ? resource.method : "GET")

    // 创建请求ID
    const requestId = `sse-req-${Date.now()}-${requestCounter++}`

    try {
      // 提取请求参数 - URL参数
      const params = extractUrlParams(url)

      // 尝试提取请求体参数
      let bodyParams = {}

      // 处理请求体参数
      if (init && init.body) {
        try {
          // 判断body类型并提取内容
          if (typeof init.body === "string") {
            // 尝试解析JSON字符串
            try {
              bodyParams = JSON.parse(init.body)
            } catch {
              // 如果不是JSON，尝试解析为URL编码形式
              if (init.body.includes("=")) {
                const urlParams = new URLSearchParams(init.body)
                urlParams.forEach((value, key) => {
                  bodyParams[key] = value
                })
              } else {
                bodyParams = { rawBody: init.body }
              }
            }
          } else if (init.body instanceof FormData) {
            // FormData类型参数
            const formData = init.body
            formData.forEach((value, key) => {
              bodyParams[key] = value
            })
          } else if (init.body instanceof URLSearchParams) {
            // URLSearchParams类型
            const urlParams = init.body
            urlParams.forEach((value, key) => {
              bodyParams[key] = value
            })
          }
        } catch (e) {
          console.error("SSE Preview: 提取body参数失败", e)
        }
      }

      // 调用原始fetch
      const response = await originalFetch.apply(this, arguments)

      // 检查是否是SSE请求
      const contentType = response.headers.get("content-type")
      if (contentType && contentType.includes("text/event-stream")) {
        // 通知有新的SSE请求，并包含URL参数和body参数
        sendMessageToExtension({
          type: "SSE_REQUEST_START",
          requestId: requestId,
          url: url,
          params: params,
          bodyParams: bodyParams, // 添加请求体参数
          method: method, // 添加请求方法
        })

        // 克隆响应，因为我们需要读取正文
        const clonedResponse = response.clone()

        // 处理SSE响应流
        processEventStream(clonedResponse, requestId)
      }

      return response
    } catch (error) {
      console.error("SSE Preview: fetch 拦截器错误", error)
      // 确保原始请求继续进行
      return originalFetch.apply(this, arguments)
    }
  }

  // 从URL中提取参数
  function extractUrlParams(urlString) {
    try {
      const url = new URL(urlString)
      const params = {}
      url.searchParams.forEach((value, key) => {
        params[key] = value
      })
      return params
    } catch (e) {
      console.error("SSE Preview: 提取URL参数失败", e)
      return {}
    }
  }

  // 处理事件流
  async function processEventStream(response, requestId) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        // 解码新接收的数据
        buffer += decoder.decode(value, { stream: true })

        // 处理完整事件
        const events = extractEvents(buffer)
        buffer = events.remainder

        // 发送事件到background
        for (const event of events.parsed) {
          sendMessageToExtension({
            type: "SSE_EVENT_RECEIVED",
            requestId: requestId,
            eventId: event.id,
            eventName: event.event,
            data: event.data,
          })
        }
      }
    } catch (error) {
      console.error("处理SSE流时出错:", error)
    }
  }

  // 从缓冲区提取完整事件
  function extractEvents(buffer) {
    const events = []
    const lines = buffer.split(/\r\n|\r|\n/)

    let currentEvent = {
      id: "",
      event: "",
      data: "",
    }

    let remainingLines = []
    let inEvent = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // 空行表示事件结束
      if (line === "") {
        if (inEvent) {
          events.push({ ...currentEvent })
          currentEvent = { id: "", event: "", data: "" }
          inEvent = false
        }
        continue
      }

      inEvent = true

      // 解析行
      if (line.startsWith("id:")) {
        currentEvent.id = line.substring(3).trim()
      } else if (line.startsWith("event:")) {
        currentEvent.event = line.substring(6).trim()
      } else if (line.startsWith("data:")) {
        if (currentEvent.data !== "") {
          currentEvent.data += "\n"
        }
        currentEvent.data += line.substring(5).trim()
      }
      // 不完整的行保留在缓冲区
      else if (i === lines.length - 1 && !line.endsWith("\n")) {
        remainingLines.push(line)
      }
    }

    // 如果缓冲区最后有不完整事件，保留它
    if (inEvent && !events.includes(currentEvent)) {
      remainingLines.unshift("") // 添加空行分隔符
      if (currentEvent.id) remainingLines.unshift(`id: ${currentEvent.id}`)
      if (currentEvent.event)
        remainingLines.unshift(`event: ${currentEvent.event}`)
      if (currentEvent.data)
        remainingLines.unshift(`data: ${currentEvent.data}`)
    }

    return {
      parsed: events,
      remainder: remainingLines.join("\n"),
    }
  }

  // 监听已有的EventSource
  const originalEventSource = window.EventSource
  window.EventSource = function (url) {
    const requestId = `sse-es-${Date.now()}-${requestCounter++}`

    try {
      // 通知后台有新SSE连接
      sendMessageToExtension({
        type: "SSE_REQUEST_START",
        requestId: requestId,
        url: url,
      })

      const eventSource = new originalEventSource(url)

      // 监听所有消息
      eventSource.addEventListener("message", function (e) {
        sendMessageToExtension({
          type: "SSE_EVENT_RECEIVED",
          requestId: requestId,
          eventId: e.lastEventId,
          eventName: "message",
          data: e.data,
        })
      })

      // 监听其他自定义事件
      const originalAddEventListener = eventSource.addEventListener
      eventSource.addEventListener = function (type, callback, options) {
        if (type !== "message" && type !== "error" && type !== "open") {
          // 为每个自定义事件添加监听器
          originalAddEventListener.call(this, type, function (e) {
            sendMessageToExtension({
              type: "SSE_EVENT_RECEIVED",
              requestId: requestId,
              eventId: e.lastEventId,
              eventName: type,
              data: e.data,
            })
          })
        }

        return originalAddEventListener.call(this, type, callback, options)
      }

      return eventSource
    } catch (error) {
      console.error("SSE Preview: EventSource 拦截器错误", error)
      // 确保原始EventSource继续工作
      return new originalEventSource(url)
    }
  }

  // 立即自检，确认脚本正确加载
  console.log("SSE Preview: 拦截器已加载", Date.now())
})()
