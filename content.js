// 检查是否已经注入过
let injected = false

// 监听来自页面的自定义事件
window.addEventListener("sse-preview-event", function (event) {
  // 转发消息到扩展
  chrome.runtime.sendMessage(event.detail).catch((err) => {
    console.warn("SSE Preview: 消息转发失败", err)
  })
})

// 注入页面拦截脚本
function injectInterceptor() {
  if (injected) {
    return
  }

  injected = true

  // 先检查页面中是否已经注入
  const existingScript = document.querySelector(
    "script[data-sse-preview-interceptor]"
  )
  if (existingScript) {
    console.log("SSE Preview: 拦截器已存在，跳过注入")
    return
  }

  const script = document.createElement("script")
  script.src = chrome.runtime.getURL("interceptor.js")
  script.dataset.ssePreviewInterceptor = "true" // 添加标记
  script.onload = function () {
    console.log("SSE Preview: 拦截器加载完成")
  }
  ;(document.head || document.documentElement).appendChild(script)
}

// 页面加载时立即注入
injectInterceptor()

// 处理重复注入的情况（例如在SPA中）
// 通知background.js内容脚本已加载
chrome.runtime.sendMessage({
  type: "CONTENT_SCRIPT_LOADED",
  url: window.location.href,
})
