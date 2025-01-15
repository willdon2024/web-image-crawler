# 高级网页图片爬虫

一个功能强大的网页图片爬虫工具，支持多种图片提取方式和高级功能。

## 功能特点

- 支持多种图片提取方式
  - 静态HTML解析
  - CSS背景图片提取
  - 内联样式图片提取
  - 动态加载图片识别
  - CDN资源分析

- 高级功能
  - URL智能分析
  - 域名统计
  - 图片类型分类
  - 性能统计
  - 错误处理

## 快速开始

1. 克隆仓库
```bash
git clone [repository-url]
cd image-crawler
```

2. 安装依赖
```bash
npm install
```

3. 启动服务器
```bash
node server.js
```

4. 打开测试页面
```
打开 test.html 文件在浏览器中进行测试
```

## API 使用

### 提取图片

POST `/fetch-with-js`

请求体:
```json
{
    "url": "要爬取的网页URL"
}
```

响应:
```json
{
    "success": true,
    "message": "成功提取图片URL",
    "imageUrls": ["图片URL列表"],
    "stats": {
        "totalImages": "总图片数",
        "processingTimeMs": "处理时间",
        "byType": "按类型统计",
        "byDomain": "按域名统计"
    }
}
```

## 技术栈

- Node.js
- 原生HTTP模块
- 正则表达式
- URL解析

## 许可证

MIT