# Will的抓图小工具

一个强大的网页图片批量提取工具，支持多种图片提取方式和智能图片分析。

## 功能特点

- 🚀 一键提取网页所有图片
- 🖼️ 支持多种图片格式 (JPG, PNG, GIF, WebP)
- 📦 批量打包下载选中图片
- 🔍 智能分析图片资源
- 🌐 支持相对路径和绝对路径
- 🛡️ 自动处理跨域问题
- 📱 响应式界面设计
- ⚡ 异步并发下载
- 🔄 失败重试机制
- 💾 智能文件命名

## 技术栈

- Node.js
- Express
- HTML5
- CSS3
- JavaScript (ES6+)
- JSZip
- FileSaver.js

## 快速开始

1. 克隆仓库
```bash
git clone https://github.com/willdon2024/web-image-crawler.git
cd web-image-crawler
```

2. 安装依赖
```bash
npm install
```

3. 启动服务器
```bash
node server.js
```

4. 打开浏览器访问
```
http://localhost:3000
```

## 使用方法

1. 在输入框中输入目标网页URL
2. 点击"开始提取"按钮
3. 等待图片加载完成
4. 点击选择需要下载的图片
5. 点击"打包下载选中图片"按钮

## API 使用

### 提取图片

```javascript
POST /fetch-with-js
Content-Type: application/json

{
    "url": "https://example.com"
}
```

响应格式：
```javascript
{
    "success": true,
    "imageUrls": ["url1", "url2", ...],
    "stats": {
        "totalImages": 10,
        "processingTimeMs": 1234
    }
}
```

## 注意事项

- 确保目标网站允许图片访问
- 部分网站可能有反爬虫机制
- 建议遵守网站的robots.txt规则
- 下载图片时注意版权问题

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 作者

Will - [GitHub](https://github.com/willdon2024)