/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,vue}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        // 商务风配色令牌（沿用 cyber 命名空间，组件无需改动）
        cyber: {
          bg: "#f8fafc",        // 页面背景：浅灰白
          panel: "#ffffff",     // 面板：纯白
          border: "#e2e8f0",    // 边框：浅灰
          cyan: "#2563eb",      // 主色：商务蓝
          magenta: "#0ea5e9",   // 辅助蓝：天蓝
          green: "#16a34a",     // 成功：商务绿
          purple: "#7c3aed",    // AI 审核：商务紫
          yellow: "#d97706",    // 警告：琥珀
          red: "#dc2626",       // 错误：商务红
          gray: "#64748b",      // 次要文字：中灰
        },
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Microsoft YaHei"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "Consolas", "monospace"],
      },
      boxShadow: {
        "cyan-glow": "0 2px 8px rgba(37, 99, 235, 0.15)",
        "magenta-glow": "0 2px 8px rgba(14, 165, 233, 0.15)",
        "green-glow": "0 2px 8px rgba(22, 163, 74, 0.15)",
        card: "0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)",
      },
    },
  },
  plugins: [],
};
