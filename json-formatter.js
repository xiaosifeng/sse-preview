/**
 * JSON Formatter 基于开源项目json-formatter-js修改
 * https://github.com/mohsen1/json-formatter-js
 *
 * 优化了缩进和逗号显示逻辑
 */

class JSONFormatter {
  constructor(json, open = 9999, config = {}) {
    this.json = json
    this.open = open
    this.config = config
    this.config.animateOpen = config.animateOpen || false
    this.config.animateClose = config.animateClose || false
    this.config.theme = config.theme || "default"
  }

  static get escapeMap() {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }
  }

  static escape(val) {
    return String(val).replace(
      /[&<>"']/g,
      (match) => JSONFormatter.escapeMap[match]
    )
  }

  static dateToHTML(date) {
    return `<span class="jf-date">${date.toISOString()}</span>`
  }

  static stringifyURL(str) {
    if (str.indexOf("http") === 0) {
      return `<a class="jf-link" href="${str}" target="_blank">${str}</a>`
    }
    return `<span class="jf-string">"${JSONFormatter.escape(str)}"</span>`
  }

  static getType(obj) {
    if (obj === null) return "null"
    if (Array.isArray(obj)) return "array"
    if (obj instanceof Date) return "date"
    return typeof obj
  }

  static hasKey(key, obj) {
    return Object.prototype.hasOwnProperty.call(obj, key)
  }

  static objectToHTML(obj, open) {
    const type = JSONFormatter.getType(obj)
    let html = ""

    if (type === "null") {
      html = '<span class="jf-null">null</span>'
    } else if (type === "array" || type === "object") {
      const isEmpty =
        type === "array" ? obj.length === 0 : Object.keys(obj).length === 0
      const isArray = type === "array"

      const openBracket = isArray ? "[" : "{"
      const closeBracket = isArray ? "]" : "}"

      if (isEmpty) {
        html = `<span class="jf-empty">${openBracket}${closeBracket}</span>`
      } else {
        // 始终保持子容器显示，确保子集默认展开
        html = [
          `<span class="jf-bracket">${openBracket}</span>`,
          `<div class="jf-child-container">`,
          "</div>",
          `<span class="jf-bracket">${closeBracket}</span>`,
        ].join("")
      }
    } else if (type === "date") {
      html = JSONFormatter.dateToHTML(obj)
    } else if (type === "string") {
      html = JSONFormatter.stringifyURL(obj)
    } else if (type === "number") {
      html = `<span class="jf-number">${obj}</span>`
    } else if (type === "boolean") {
      html = `<span class="jf-boolean">${obj}</span>`
    } else if (type === "undefined") {
      html = `<span class="jf-undefined">undefined</span>`
    } else {
      html = `<span>${obj}</span>`
    }

    return html
  }

  static keyToHTML(key) {
    return `<span class="jf-key">"${JSONFormatter.escape(key)}": </span>`
  }

  htmlEncode(html) {
    return html
  }

  render() {
    const type = JSONFormatter.getType(this.json)
    const isObjectOrArray = type === "object" || type === "array"

    if (!isObjectOrArray) {
      return JSONFormatter.objectToHTML(this.json, this.open)
    }

    // 始终设置为打开状态
    const isOpen = true

    const rootNodeClass = `jf-container jf-theme-${
      this.config.theme || "default"
    }`

    const rootEl = document.createElement("div")
    rootEl.className = rootNodeClass

    // 准备根部的展开/折叠线
    const expanderEl = document.createElement("div")
    expanderEl.className = `jf-toggler jf-open`
    expanderEl.addEventListener("click", (event) => {
      event.stopPropagation()
      this.toggleOpen()
    })

    rootEl.appendChild(expanderEl)

    // 内容包装器
    const contentEl = document.createElement("div")
    contentEl.className = "jf-content"
    contentEl.innerHTML = JSONFormatter.objectToHTML(this.json, this.open)

    // 处理内部元素
    if (isObjectOrArray && !this.isEmpty(this.json)) {
      const childContainer = contentEl.querySelector(".jf-child-container")
      if (childContainer) {
        const keys =
          type === "array"
            ? [...Array(this.json.length).keys()]
            : Object.keys(this.json)

        keys.forEach((key, index) => {
          const isLast = index === keys.length - 1
          const childEl = this.createChildElement(key, this.json[key], isLast)
          childContainer.appendChild(childEl)
        })
      }
    }

    rootEl.appendChild(contentEl)

    return rootEl
  }

  createChildElement(key, value, isLast) {
    // 创建子行
    const childRow = document.createElement("div")
    childRow.className = "jf-row"

    if (typeof key === "string") {
      // 对象属性
      const keyEl = document.createElement("span")
      keyEl.className = "jf-key"
      keyEl.textContent = `"${key}": `
      childRow.appendChild(keyEl)
    } else {
      // 数组项
      const indexEl = document.createElement("span")
      indexEl.className = "jf-array-index"
      childRow.appendChild(indexEl)
    }

    const type = JSONFormatter.getType(value)

    // 简单值直接渲染
    if (type !== "object" && type !== "array") {
      childRow.insertAdjacentHTML(
        "beforeend",
        JSONFormatter.objectToHTML(value, 0)
      )

      if (!isLast) {
        const comma = document.createElement("span")
        comma.className = "jf-comma"
        comma.textContent = ","
        childRow.appendChild(comma)
      }

      return childRow
    }

    // 处理嵌套对象/数组
    const isEmpty =
      type === "array" ? value.length === 0 : Object.keys(value).length === 0

    if (isEmpty) {
      childRow.insertAdjacentHTML(
        "beforeend",
        JSONFormatter.objectToHTML(value, 0)
      )

      if (!isLast) {
        const comma = document.createElement("span")
        comma.className = "jf-comma"
        comma.textContent = ","
        childRow.appendChild(comma)
      }

      return childRow
    }

    // 创建子级格式化器并渲染 - 保持较大的 open 值以确保所有子集默认展开
    const openLevel = this.open > 0 ? this.open - 1 : 0 // 仍然递减但保持较大值
    const formatter = new JSONFormatter(value, openLevel, this.config)
    const formatterEl = formatter.render()

    // 保存子级渲染元素到 formatter 实例，确保能正确控制子级
    formatter._rendered = formatterEl

    formatterEl.classList.add("jf-child")
    childRow.appendChild(formatterEl)

    // 添加逗号到右括号后面而非行尾
    if (!isLast) {
      // 查找右括号并在其后添加逗号
      const bracket = formatterEl.querySelector(".jf-bracket:last-child")
      if (bracket) {
        const comma = document.createElement("span")
        comma.className = "jf-comma"
        comma.textContent = ","
        bracket.insertAdjacentElement("afterend", comma)
      }
    }

    return childRow
  }

  isEmpty(obj) {
    const type = JSONFormatter.getType(obj)
    return type === "array" ? obj.length === 0 : Object.keys(obj).length === 0
  }

  toggleOpen() {
    const isOpen = this.isOpen()

    // 使用 this._rendered 确保我们直接访问当前实例的 DOM 元素
    const childContainer = this._rendered.querySelector(".jf-child-container")
    if (childContainer) {
      childContainer.style.display = isOpen ? "none" : "block"
    }

    const toggler = this._rendered.querySelector(".jf-toggler")
    if (toggler) {
      toggler.classList.toggle("jf-open", !isOpen)
    }

    return this
  }

  isOpen() {
    // 使用 this._rendered 确保我们直接访问当前实例的 DOM 元素
    const childContainer = this._rendered.querySelector(".jf-child-container")
    return childContainer ? childContainer.style.display !== "none" : false
  }

  get element() {
    return this._rendered || (this._rendered = this.render())
  }
}
