const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

// 辅助函数：从HTML中提取图片URL
function extractImagesFromHtml(html, baseUrl) {
    const urls = new Set();
    
    // 1. 提取<img>标签中的URL
    const imgRegex = /<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
        try {
            urls.add(new URL(match[1], baseUrl).href);
        } catch (e) {
            console.warn('无效的图片URL:', match[1]);
        }
    }
    
    // 2. 提取CSS背景图片URL
    const cssRegex = /url\(['"]?([^'"()]+)['"]?\)/gi;
    while ((match = cssRegex.exec(html)) !== null) {
        if (match[1].match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i)) {
            try {
                urls.add(new URL(match[1], baseUrl).href);
            } catch (e) {
                console.warn('无效的CSS背景图片URL:', match[1]);
            }
        }
    }
    
    // 3. 提取<link>标签中的图片
    const linkRegex = /<link[^>]+(?:href|src)=["']([^"']+\.(?:jpg|jpeg|png|gif|webp|bmp))["'][^>]*>/gi;
    while ((match = linkRegex.exec(html)) !== null) {
        try {
            urls.add(new URL(match[1], baseUrl).href);
        } catch (e) {
            console.warn('无效的link标签图片URL:', match[1]);
        }
    }
    
    // 4. 提取<meta>标签中的图片
    const metaRegex = /<meta[^>]+(?:content|value)=["']([^"']+\.(?:jpg|jpeg|png|gif|webp|bmp))["'][^>]*>/gi;
    while ((match = metaRegex.exec(html)) !== null) {
        try {
            urls.add(new URL(match[1], baseUrl).href);
        } catch (e) {
            console.warn('无效的meta标签图片URL:', match[1]);
        }
    }
    
    // 5. 提取内联样式中的图片
    const styleRegex = /<[^>]+style=["'][^"']*url\(['"]?([^'"()]+)['"]?\)[^"']*["'][^>]*>/gi;
    while ((match = styleRegex.exec(html)) !== null) {
        if (match[1].match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i)) {
            try {
                urls.add(new URL(match[1], baseUrl).href);
            } catch (e) {
                console.warn('无效的内联样式图片URL:', match[1]);
            }
        }
    }
    
    // 6. 提取<style>标签中的图片
    const styleTagRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    while ((match = styleTagRegex.exec(html)) !== null) {
        const cssContent = match[1];
        let cssMatch;
        while ((cssMatch = cssRegex.exec(cssContent)) !== null) {
            if (cssMatch[1].match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i)) {
                try {
                    urls.add(new URL(cssMatch[1], baseUrl).href);
                } catch (e) {
                    console.warn('无效的style标签图片URL:', cssMatch[1]);
                }
            }
        }
    }

    return Array.from(urls);
}

// 获取页面内容
async function fetchPage(urlString) {
    const url = new URL(urlString);
    const protocol = url.protocol === 'https:' ? https : http;
    
    return new Promise((resolve, reject) => {
        protocol.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 10000
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return resolve(fetchPage(new URL(res.headers.location, url).href));
            }
            
            // 检查内容类型
            const contentType = res.headers['content-type'] || '';
            if (!contentType.includes('text/html')) {
                return reject(new Error('不是HTML页面'));
            }
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject)
          .on('timeout', () => {
              reject(new Error('请求超时'));
          });
    });
}

const server = http.createServer((req, res) => {
    // 添加CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理OPTIONS请求
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/fetch-with-js') {
        let body = '';
        let requestStartTime = Date.now();
        
        req.on('data', chunk => {
            body += chunk.toString();
            // 添加请求体大小限制
            if (body.length > 1e6) {
                req.destroy();
                return;
            }
        });
        
        req.on('end', async () => {
            try {
                const { url } = JSON.parse(body);
                console.log('正在处理URL:', url);

                // 验证URL
                if (!url || !url.match(/^https?:\/\/.+/)) {
                    throw new Error('无效的URL');
                }

                // 获取页面内容
                console.log('正在获取页面内容...');
                const html = await fetchPage(url);
                console.log('已获取页面内容');

                // 提取图片URL
                console.log('正在提取图片URL...');
                const imageUrls = extractImagesFromHtml(html, url);
                console.log(`找到 ${imageUrls.length} 个图片URL`);

                // 对图片URL进行分类
                const urlStats = {
                    total: imageUrls.length,
                    byType: {},
                    byDomain: {}
                };

                for (const imgUrl of imageUrls) {
                    try {
                        const parsedUrl = new URL(imgUrl);
                        // 统计域名
                        urlStats.byDomain[parsedUrl.hostname] = (urlStats.byDomain[parsedUrl.hostname] || 0) + 1;
                        // 统计图片类型
                        const ext = path.extname(parsedUrl.pathname).toLowerCase();
                        if (ext) {
                            urlStats.byType[ext] = (urlStats.byType[ext] || 0) + 1;
                        }
                    } catch (e) {
                        console.warn('URL统计失败:', imgUrl);
                    }
                }

                const processingTime = Date.now() - requestStartTime;
                
                res.writeHead(200, { 
                    'Content-Type': 'application/json',
                    'X-Processing-Time': processingTime
                });
                res.end(JSON.stringify({
                    success: true,
                    message: '成功提取图片URL',
                    imageUrls,
                    stats: {
                        totalImages: imageUrls.length,
                        processingTimeMs: processingTime,
                        ...urlStats
                    }
                }));
            } catch (error) {
                console.error('错误:', error);
                const errorResponse = {
                    success: false,
                    error: error.message,
                    details: {
                        type: error.name,
                        processingTimeMs: Date.now() - requestStartTime
                    }
                };
                
                // 根据错误类型设置不同的状态码
                let statusCode = 500;
                if (error.message.includes('无效的URL')) {
                    statusCode = 400;
                } else if (error.message.includes('不是HTML页面')) {
                    statusCode = 415;
                } else if (error.message.includes('请求超时')) {
                    statusCode = 504;
                }

                res.writeHead(statusCode, { 
                    'Content-Type': 'application/json',
                    'X-Processing-Time': Date.now() - requestStartTime
                });
                res.end(JSON.stringify(errorResponse));
            }
        });
    } else {
        // 处理静态文件
        let filePath = '.' + req.url;
        if (filePath === './') {
            filePath = './index.html';
        }

        const extname = path.extname(filePath);
        const contentType = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.gif': 'image/gif'
        }[extname] || 'text/plain';

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    res.writeHead(404);
                    res.end('File not found');
                } else {
                    res.writeHead(500);
                    res.end('Server error: ' + error.code);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            }
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 