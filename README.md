# 网页图片下载工具

一个简单易用的网页图片批量下载工具，支持通过Web界面操作。

## 功能特点

- 🌐 简洁的Web界面
- 📥 批量下载网页中的所有图片
- 📊 实时显示下载进度
- 📦 自动打包为ZIP文件
- 🚀 支持多人同时使用
- 🧹 自动清理临时文件

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/willdon2024/web-image-crawler.git
cd web-image-crawler
```

### 2. 安装依赖

```bash
python3 -m pip install -r requirements.txt
```

### 3. 运行服务器

```bash
# 方法1：直接运行
python3 app.py

# 方法2：使用启动脚本
chmod +x start.sh
./start.sh
```

### 4. 使用方法

1. 打开浏览器访问 `http://localhost:5000`
2. 在输入框中输入要下载图片的网页地址
3. 点击"开始下载"或按回车键
4. 等待下载完成后点击"下载图片压缩包"

## 技术栈

- 后端：Python + Flask
- 前端：HTML + JavaScript + Tailwind CSS
- 爬虫：requests + BeautifulSoup4

## 项目结构

```
.
├── app.py              # 主程序
├── requirements.txt    # 依赖列表
├── start.sh           # 启动脚本
└── templates
    └── index.html     # 前端页面
```

## 注意事项

- 请确保你有权限下载目标网站的图片
- 遵守网站的使用条款和robots.txt规则
- 建议在本地网络或内网环境中使用

## 许可证

MIT License 