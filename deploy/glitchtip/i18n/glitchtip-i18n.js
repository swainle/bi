/**
 * GlitchTip 界面中文化（同源注入，不改镜像）。
 *
 * 原理：GlitchTip 的 SPA 用英文硬编码，但页面是 Django 模板渲染的，
 * 我们把 index.html 挂载替换、追加同源脚本（CSP 的 script-src 'self' 允许），
 * 运行时按词典替换文本节点 + MutationObserver 跟进 Angular 的重新渲染。
 *
 * 语言：
 *   · 默认中文；右下角「EN」切英文（写 localStorage 后整页刷新，英文态不执行任何替换）
 *   · 「中文」切回中文
 * 只替换可见文本与 placeholder/title/aria-label，不动 script/style/code/pre，
 * 也不翻译数据本身的键名（release / environment 等），避免把标签数据也改掉。
 */
(function () {
  var STORE_KEY = "gt:lang";
  var lang = localStorage.getItem(STORE_KEY) || "zh";

  var DICT = {
    // 登录
    "Login": "登录",
    "Email": "邮箱",
    "Password": "密码",
    "Log in": "登录",
    "New to GlitchTip?": "还没有 GlitchTip 账号？",
    "Sign Up": "注册",
    "Reset Password": "重置密码",
    "GlitchTip requires JavaScript": "GlitchTip 需要启用 JavaScript",
    // 左侧导航
    "Issues": "问题",
    "Uptime Monitors": "可用性监控",
    "Performance": "性能",
    "Logs": "日志",
    "Projects": "项目",
    "Releases": "版本",
    "Organization": "组织",
    "Profile": "个人资料",
    "Support": "支持",
    "Home": "首页",
    "New project": "新建项目",
    "settings": "设置",
    // 问题列表
    "All projects": "所有项目",
    "All times": "所有时间",
    "Environment": "环境",
    "Search": "搜索",
    "Sort by": "排序",
    "Last Seen": "最近出现",
    "Mark resolved": "标记为已解决",
    "Mark unresolved": "标记为未解决",
    "Mark ignored": "标记为已忽略",
    "Merge": "合并",
    "Delete": "删除",
    "Issue": "问题",
    "Trend": "趋势",
    "Events": "事件",
    "Set trend charts period": "设置趋势周期",
    "unresolved": "未解决",
    // 问题详情
    "Unresolved": "未解决",
    "Resolved": "已解决",
    "Ignored": "已忽略",
    "First seen": "首次出现",
    "Last seen": "最近出现",
    "First release": "首个版本",
    "Event Details": "事件详情",
    "User Reports": "用户反馈",
    "Comments": "评论",
    "Merged": "已合并",
    "Event": "事件",
    "Error": "错误",
    "raw JSON": "原始 JSON",
    "copy for AI": "复制给 AI",
    "Older": "更早",
    "Newer": "更新",
    "Version:": "版本：",
    "Tags": "标签",
    "Message": "消息",
    "Breadcrumbs": "面包屑",
    "Filter by category": "按类别筛选",
    "Additional Data": "附加数据",
    "Issue #": "问题 #",
    "Level": "级别",
    "First Seen": "首次出现",
    "Level ": "级别 ",
    // 个人资料 / 账户
    "Account": "账户",
    "Account owner": "账户所有者",
    "Account ownership must be transferred.": "需要先转交账户所有权。",
    "Auth tokens": "访问令牌",
    "MFA": "双因素认证",
    "Notifications": "通知",
    "Log Out": "退出登录",
    "Leave": "退出组织",
    "Invite Member": "邀请成员",
    // 项目 / 组织设置
    "General settings": "常规设置",
    "project settings": "项目设置",
    "Alerts for project": "项目的告警",
    "Project alerts": "项目告警",
    "Create new project in org": "在组织中新建项目",
    "Delete organization": "删除组织",
    "Delete issue": "删除问题",
    "and all of its projects, teams and events. This cannot be undone.":
      "以及它的所有项目、团队和事件。此操作不可撤销。",
    "Full access": "完全访问",
    "Owner": "所有者",
    "Members": "成员",
    "Name": "名称",
    "Title": "标题",
    "Service": "服务",
    "Version": "版本",
    "Date Created": "创建时间",
    "Default": "默认",
    "Save name": "保存名称",
    "New": "新建",
    "New monitor": "新建监控",
    "New token": "新建令牌",
    "Copy key to clipboard": "复制密钥",
    "Tokens": "令牌",
    "team": "团队",
    "security": "安全",
    "notifications": "通知",
    // 性能 / 可用性 / 日志
    "Average Duration": "平均耗时",
    "Slowest": "最慢",
    "Newest": "最新",
    "Transaction groups": "事务分组",
    "No transactions": "暂无性能数据",
    "Performance data appears here once your app sends transactions.":
      "应用上报事务后，这里会显示性能数据。",
    "No uptime monitors": "还没有可用性监控",
    "Add a monitor to get alerted when a site or service goes down.":
      "添加监控后，站点或服务宕机时会收到告警。",
    "No logs yet": "还没有日志",
    "Search logs": "搜索日志",
    "Search message body...": "搜索消息内容…",
    "Search syntax help": "搜索语法说明",
    "Configure your SDK to start capturing logs.": "配置 SDK 后即可采集日志。",
    "Time range": "时间范围",
    // 注册 / 找回密码 / 错误页
    "Register": "注册",
    "Send Reset Password Email": "发送重置密码邮件",
    "Page not found": "页面不存在",
    "Error code: 404 Not Found": "错误码：404 未找到",
    "Off": "关闭",
    "On": "开启",
    // 支持 / 组织菜单
    "Documentation": "使用文档",
    "Report a bug": "反馈问题",
    "Sponsor on Liberapay": "赞助（Liberapay）",
    "Get Priority Support": "获取优先支持",
    "Subscription": "订阅",
    "Teams": "团队",
    "Deletes": "删除操作",
    // 评论 / 用户反馈
    "Add a comment to share context with your team.": "添加评论，与团队分享上下文。",
    "Markdown supported": "支持 Markdown",
    "Call showReportDialog in the JavaScript SDK to collect feedback from users.":
      "在 JavaScript SDK 中调用 showReportDialog 即可收集用户反馈。",
    "No comments": "还没有评论",
    "No user reports": "暂无用户反馈",
    "Nothing merged": "没有合并项",
    "Submit Comment": "提交评论",
    "(On)": "（开启）"
  };

  var UNIT = {
    second: "秒",
    minute: "分钟",
    hour: "小时",
    day: "天",
    week: "周",
    month: "个月",
    year: "年",
    seconds: "秒",
    minutes: "分钟",
    hours: "小时",
    days: "天",
    weeks: "周",
    months: "个月",
    years: "年"
  };

  var MONTHS = {
    jan: "1月", january: "1月", feb: "2月", february: "2月", mar: "3月", march: "3月",
    apr: "4月", april: "4月", may: "5月", jun: "6月", june: "6月", jul: "7月", july: "7月",
    aug: "8月", august: "8月", sep: "9月", sept: "9月", september: "9月",
    oct: "10月", october: "10月", nov: "11月", november: "11月", dec: "12月", december: "12月"
  };

  /** "Nov 13, 2026, 10:21:17 PM GMT+8" → "2026年11月13日 22:21:17 GMT+8" */
  function translateDate(text) {
    var m = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?\s*(.*)$/i.exec(text);
    if (!m) return null;
    var month = MONTHS[m[1].toLowerCase()];
    if (!month) return null;
    var out = m[3] + "年" + month + parseInt(m[2], 10) + "日";
    if (m[4]) {
      var hour = parseInt(m[4], 10);
      var ampm = (m[7] || "").toUpperCase();
      if (ampm === "PM" && hour < 12) hour += 12;
      if (ampm === "AM" && hour === 12) hour = 0;
      out += " " + (hour < 10 ? "0" + hour : hour) + ":" + m[5] + (m[6] ? ":" + m[6] : "");
    }
    if (m[8] && m[8].trim()) out += " " + m[8].trim();
    return out;
  }

  function translateTime(text) {
    var m = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+(old|ago)$/i.exec(text);
    if (!m) return null;
    return m[1] + " " + (UNIT[m[2].toLowerCase()] || m[2]) + (m[3].toLowerCase() === "ago" ? "前" : "前");
  }

  function translateCore(text) {
    if (DICT[text]) return DICT[text];
    var time = translateTime(text);
    if (time) return time;

    var m = /^(first|last) seen (.+)$/i.exec(text);
    if (m) {
      var rest = m[2];
      var inner = translateTime(rest) || translateTime(rest.replace(/^an? /, "1 "));
      return (m[1].toLowerCase() === "first" ? "首次出现 " : "最近出现 ") + (inner || rest);
    }
    m = /^last event (.+)$/i.exec(text);
    if (m) {
      var ev = translateTime(m[1]) || m[1];
      return "最近事件 " + ev;
    }
    m = /^(\d+)\s+events?$/i.exec(text);
    if (m) return m[1] + " 个事件";
    m = /^(\d+)\s+users?$/i.exec(text);
    if (m) return m[1] + " 个用户";
    m = /^show all (\d+) breadcrumbs$/i.exec(text);
    if (m) return "显示全部 " + m[1] + " 条面包屑";
    m = /^(\d+)\s+minutes? ago$/i.exec(text);
    if (m) return m[1] + " 分钟前";
    // 破坏性按钮：「Delete xxx」→「删除 xxx」（图标用的是小写 delete，不会误伤）
    m = /^Delete (.+)$/.exec(text);
    if (m) return "删除 " + m[1];
    var date = translateDate(text);
    if (date) return date;
    return null;
  }

  function translateValue(value) {
    var trimmed = value.trim();
    // 上限只为挡住长段正文（日志、SQL、堆栈），别卡住正常句子（60 字太短，曾漏掉整句提示）
    if (!trimmed || trimmed.length > 220) return null;
    var hit = translateCore(trimmed);
    if (!hit) return null;
    return value.replace(trimmed, hit);
  }

  function translateTextNode(node) {
    var next = translateValue(node.nodeValue || "");
    if (next !== null && next !== node.nodeValue) node.nodeValue = next;
  }

  var ATTRS = ["placeholder", "title", "aria-label"];

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== 1) return;
    var tag = root.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "CODE" || tag === "PRE" || tag === "TEXTAREA") return;

    for (var i = 0; i < ATTRS.length; i++) {
      var attr = root.getAttribute && root.getAttribute(ATTRS[i]);
      if (attr) {
        var replaced = translateValue(attr);
        if (replaced !== null) root.setAttribute(ATTRS[i], replaced);
      }
    }
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var hits = [];
    while (walker.nextNode()) hits.push(walker.currentNode);
    for (var j = 0; j < hits.length; j++) translateTextNode(hits[j]);
  }

  function mountToggle() {
    if (document.getElementById("gt-i18n-toggle")) return;
    var btn = document.createElement("button");
    btn.id = "gt-i18n-toggle";
    btn.className = "gt-i18n-toggle";
    btn.type = "button";
    btn.textContent = lang === "zh" ? "EN" : "中文";
    btn.title = lang === "zh" ? "Switch to English" : "切换为中文";
    btn.addEventListener("click", function () {
      localStorage.setItem(STORE_KEY, lang === "zh" ? "en" : "zh");
      location.reload();
    });
    document.body.appendChild(btn);
  }

  function start() {
    mountToggle();
    if (lang !== "zh") return; // 英文态：完全不改动界面

    walk(document.body);
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === "characterData") {
          translateTextNode(m.target);
          continue;
        }
        for (var k = 0; k < m.addedNodes.length; k++) walk(m.addedNodes[k]);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
