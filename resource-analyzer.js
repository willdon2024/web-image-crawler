const axios = require('axios');
const { URL } = require('url');

class ResourceAnalyzer {
    constructor() {
        // 常见的CDN域名模式
        this.cdnPatterns = [
            /cdn\./i,
            /\.cloudfront\.net/i,
            /\.akamai(zed|hd)?\./i,
            /\.fastly\.net/i,
            /\.cloudflare\./i,
            /\.jsdelivr\.net/i,
            /\.alicdn\.com/i,
            /\.qiniu(cdn)?\.com/i,
            /\.aliyuncs\.com/i,
            /\.oss-cn-/i
        ];

        // 常见的图片API端点模式
        this.apiPatterns = [
            /\/api\/images?/i,
            /\/images?\/api/i,
            /\/upload(ed)?\/images?/i,
            /\/assets\/images?/i,
            /\/static\/images?/i,
            /\/media\/images?/i,
            /\/(img|image|pic|photo)(s)?\/\d+/i
        ];
    }

    async analyzeUrl(url) {
        const baseUrl = new URL(url);
        const results = {
            directUrls: new Set(),
            cdnUrls: new Set(),
            apiEndpoints: new Set()
        };

        try {
            // 分析页面源代码中的资源
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const html = response.data;

            // 提取所有可能的图片URL
            this.extractImageUrls(html, baseUrl, results);

            // 分析响应头中的信息
            this.analyzeHeaders(response.headers, baseUrl, results);

            // 分析源代码中的JavaScript变量和配置
            this.analyzeJavaScript(html, baseUrl, results);

            return {
                directUrls: Array.from(results.directUrls),
                cdnUrls: Array.from(results.cdnUrls),
                apiEndpoints: Array.from(results.apiEndpoints)
            };
        } catch (error) {
            console.error('资源分析失败:', error);
            throw error;
        }
    }

    extractImageUrls(html, baseUrl, results) {
        // 提取标准图片标签
        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = imgRegex.exec(html)) !== null) {
            this.categorizeUrl(new URL(match[1], baseUrl), results);
        }

        // 提取背景图片
        const bgRegex = /background(-image)?:\s*url\(['"]?([^'"()]+)['"]?\)/gi;
        while ((match = bgRegex.exec(html)) !== null) {
            this.categorizeUrl(new URL(match[2], baseUrl), results);
        }

        // 提取数据属性中的图片
        const dataRegex = /data-(?:src|original|image|bg|background|thumb|url)=["']([^"']+)["']/gi;
        while ((match = dataRegex.exec(html)) !== null) {
            this.categorizeUrl(new URL(match[1], baseUrl), results);
        }

        // 提取JSON配置中的图片URL
        const jsonRegex = /"(?:url|src|image|thumbnail)"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|gif|webp))"/gi;
        while ((match = jsonRegex.exec(html)) !== null) {
            this.categorizeUrl(new URL(match[1], baseUrl), results);
        }
    }

    analyzeHeaders(headers, baseUrl, results) {
        // 分析Link头部
        const linkHeader = headers['link'];
        if (linkHeader) {
            const links = linkHeader.split(',');
            links.forEach(link => {
                const urlMatch = /<([^>]+)>/.exec(link);
                if (urlMatch && this.isImageUrl(urlMatch[1])) {
                    this.categorizeUrl(new URL(urlMatch[1], baseUrl), results);
                }
            });
        }

        // 分析CDN相关头部
        const cdnHeaders = [
            'x-cdn',
            'x-fastly-request-id',
            'x-amz-cf-id',
            'x-akamai-request-id',
            'x-cloudflare-id'
        ];

        cdnHeaders.forEach(header => {
            if (headers[header]) {
                // 记录CDN信息供后续使用
                this.cdnInfo = {
                    provider: header.split('-')[1],
                    id: headers[header]
                };
            }
        });
    }

    analyzeJavaScript(html, baseUrl, results) {
        // 提取JavaScript配置对象
        const configRegex = /(?:window\.|var\s+)(?:config|settings|options)\s*=\s*({[^;]+})/g;
        let match;
        while ((match = configRegex.exec(html)) !== null) {
            try {
                const config = JSON.parse(match[1].replace(/'/g, '"'));
                this.extractUrlsFromObject(config, baseUrl, results);
            } catch (e) {
                // 配置解析失败，继续处理
            }
        }

        // 提取API端点
        const apiRegex = /(?:api|service|endpoint)(?:Url|Path|Endpoint)?\s*(?::|=)\s*["']([^"']+)["']/gi;
        while ((match = apiRegex.exec(html)) !== null) {
            if (this.isApiEndpoint(match[1])) {
                results.apiEndpoints.add(new URL(match[1], baseUrl).href);
            }
        }
    }

    categorizeUrl(url, results) {
        const urlString = url.href;

        // 检查是否是图片URL
        if (!this.isImageUrl(urlString)) {
            return;
        }

        // 检查是否是CDN URL
        if (this.isCdnUrl(url.hostname)) {
            results.cdnUrls.add(urlString);
            return;
        }

        // 检查是否是API端点
        if (this.isApiEndpoint(url.pathname)) {
            results.apiEndpoints.add(urlString);
            return;
        }

        // 其他直接URL
        results.directUrls.add(urlString);
    }

    extractUrlsFromObject(obj, baseUrl, results) {
        const stack = [obj];
        while (stack.length > 0) {
            const current = stack.pop();
            for (const [key, value] of Object.entries(current)) {
                if (typeof value === 'string' && this.isImageUrl(value)) {
                    try {
                        this.categorizeUrl(new URL(value, baseUrl), results);
                    } catch (e) {
                        // URL解析失败，跳过
                    }
                } else if (value && typeof value === 'object') {
                    stack.push(value);
                }
            }
        }
    }

    isImageUrl(url) {
        return /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(url);
    }

    isCdnUrl(hostname) {
        return this.cdnPatterns.some(pattern => pattern.test(hostname));
    }

    isApiEndpoint(path) {
        return this.apiPatterns.some(pattern => pattern.test(path));
    }

    async testImageUrl(url) {
        try {
            const response = await axios.head(url, {
                timeout: 5000,
                validateStatus: status => status === 200
            });
            const contentType = response.headers['content-type'];
            return contentType && contentType.startsWith('image/');
        } catch {
            return false;
        }
    }
}

module.exports = new ResourceAnalyzer(); 