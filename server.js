const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();

// 启用 CORS
app.use(cors());
app.use(express.json());

// 处理相对URL转绝对URL
function makeUrlAbsolute(relativeUrl, baseUrl) {
    try {
        // 如果已经是完整的URL，直接返回
        if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
            return relativeUrl;
        }
        // 处理 // 开头的URL
        if (relativeUrl.startsWith('//')) {
            return 'https:' + relativeUrl;
        }
        return new URL(relativeUrl, baseUrl).href;
    } catch (e) {
        console.warn('Invalid URL:', relativeUrl);
        return null;
    }
}

// 验证URL是否为图片
async function isImageUrl(url) {
    try {
        // 如果URL包含已知的图片扩展名，直接返回true
        if (url.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i)) {
            return true;
        }

        const response = await axios.head(url, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://mp.weixin.qq.com/'
            }
        });
        const contentType = response.headers['content-type'];
        return contentType && contentType.startsWith('image/');
    } catch (e) {
        // 对于微信的图片URL，即使head请求失败也认为是有效的
        if (url.includes('mmbiz.qpic.cn')) {
            return true;
        }
        console.warn('Image validation failed for:', url, e.message);
        return false;
    }
}

// 处理图片提取请求
app.post('/fetch-with-js', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: '请提供有效的URL'
            });
        }

        const startTime = Date.now();
        
        // 获取网页内容
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': 'https://mp.weixin.qq.com/'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);
        const imageUrls = new Set();

        // 提取所有可能的图片URL
        $('img').each((i, elem) => {
            const attrs = ['src', 'data-src', 'data-original', 'data-actualsrc', 'data-original-src'];
            attrs.forEach(attr => {
                const value = $(elem).attr(attr);
                if (value) {
                    const absoluteUrl = makeUrlAbsolute(value, url);
                    if (absoluteUrl) imageUrls.add(absoluteUrl);
                }
            });

            // 处理srcset属性
            const srcset = $(elem).attr('srcset');
            if (srcset) {
                srcset.split(',').forEach(src => {
                    const srcUrl = src.trim().split(' ')[0];
                    const absoluteUrl = makeUrlAbsolute(srcUrl, url);
                    if (absoluteUrl) imageUrls.add(absoluteUrl);
                });
            }
        });

        // 提取背景图片
        $('[style*="background"]').each((i, elem) => {
            const style = $(elem).attr('style');
            const matches = style.match(/url\(['"]?(.*?)['"]?\)/g) || [];
            
            matches.forEach(match => {
                const urlMatch = match.match(/url\(['"]?(.*?)['"]?\)/);
                if (urlMatch && urlMatch[1]) {
                    const absoluteUrl = makeUrlAbsolute(urlMatch[1], url);
                    if (absoluteUrl) imageUrls.add(absoluteUrl);
                }
            });
        });

        // 提取微信文章特有的图片
        $('[data-type="img"]').each((i, elem) => {
            const dataSrc = $(elem).attr('data-src');
            if (dataSrc) {
                const absoluteUrl = makeUrlAbsolute(dataSrc, url);
                if (absoluteUrl) imageUrls.add(absoluteUrl);
            }
        });

        // 验证并过滤图片URL
        const validImageUrls = [];
        for (const imageUrl of Array.from(imageUrls)) {
            if (await isImageUrl(imageUrl)) {
                validImageUrls.push(imageUrl);
            }
        }

        const processingTimeMs = Date.now() - startTime;

        res.json({
            success: true,
            imageUrls: validImageUrls,
            stats: {
                totalImages: validImageUrls.length,
                processingTimeMs
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || '提取图片时发生错误'
        });
    }
});

// 静态文件服务
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 