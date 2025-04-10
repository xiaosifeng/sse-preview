// 创建面板时捕获检查的标签页ID
const tabId = chrome.devtools.inspectedWindow.tabId

chrome.devtools.panels.create(
  "SSE Preview",
  "icons/icon16.png",
  "panel.html",
  function (panel) {
    // 面板创建完成后的回调
    panel.onShown.addListener(function (panelWindow) {
      // 传递tabId给面板窗口
      panelWindow.tabId = tabId

      // 如果面板已加载，初始化
      if (typeof panelWindow.panelLoaded !== "undefined") {
        panelWindow.initializePanel(tabId)
      }
    })
  }
)
