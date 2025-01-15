const axios = require('axios');
const crypto = require('crypto');
const { URL } = require('url');
const path = require('path');

class ImageDownloader {
    constructor() {
        // 常见的图片CDN域名和防盗链规则
        this.antiLeechRules = [
            {
                pattern: /\.(sinaimg|weibo)\.(cn|com)/i,
                referer: 'https://weibo.com'
            },
            {
                pattern: /\.(zhimg|zhihu)\.(com|net)/i,
                referer: 'https://www.zhihu.com'
            },
            {
                pattern: /\.(alicdn|taobao|tmall)\.(com|net)/i,
                referer: 'https://www.taobao.com'
            },
            {
                pattern: /\.(jd|360buyimg)\.(com|net)/i,
                referer: 'https://www.jd.com'
            }
        ];

        // 动态URL参数模式
        this.dynamicUrlPatterns = [
            {
                pattern: /[?&]token=([^&]+)/i,
                handler: this.handleTokenParam
            },
            {
                pattern: /[?&]timestamp=(\d+)/i,
                handler: this.handleTimestampParam
            },
            {
                pattern: /[?&]sign=([^&]+)/i,
                handler: this.handleSignParam
            }
        ];
    }

    async downloadImage(url, options = {}) {
        try {
            // 解析URL
            const parsedUrl = new URL(url);
            const hostname = parsedUrl.hostname;

            // 构建请求头
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            };

            // 处理防盗链
            const referer = this.getRefererForUrl(url);
            if (referer) {
                headers['Referer'] = referer;
                headers['Origin'] = new URL(referer).origin;
            }

            // 处理动态URL
            const processedUrl = await this.processDynamicUrl(url, options);

            // 添加自定义请求头
            if (options.headers) {
                Object.assign(headers, options.headers);
            }

            // 下载图片
            const response = await axios({
                method: 'get',
                url: processedUrl,
                headers,
                responseType: 'arraybuffer',
                maxRedirects: 5,
                timeout: 30000,
                validateStatus: status => status === 200
            });

            // 验证响应内容类型
            const contentType = response.headers['content-type'];
            if (!contentType || !contentType.startsWith('image/')) {
                throw new Error('响应不是图片格式');
            }

            return {
                data: response.data,
                contentType,
                originalUrl: url,
                processedUrl,
                headers: response.headers
            };

        } catch (error) {
            // 如果是防盗链错误，尝试备用方案
            if (error.response && error.response.status === 403) {
                return await this.handleAntiLeechError(url, options);
            }
            throw error;
        }
    }

    getRefererForUrl(url) {
        const hostname = new URL(url).hostname;
        
        // 检查预定义规则
        for (const rule of this.antiLeechRules) {
            if (rule.pattern.test(hostname)) {
                return rule.referer;
            }
        }

        // 如果没有匹配规则，使用URL的源站作为referer
        return new URL(url).origin;
    }

    async processDynamicUrl(url, options) {
        const parsedUrl = new URL(url);
        let processedUrl = url;

        // 检查是否需要处理动态参数
        for (const pattern of this.dynamicUrlPatterns) {
            const match = url.match(pattern.pattern);
            if (match) {
                processedUrl = await pattern.handler.call(this, processedUrl, match, options);
            }
        }

        // 处理时间戳参数
        if (parsedUrl.searchParams.has('t') || parsedUrl.searchParams.has('_t')) {
            processedUrl = this.updateTimestamp(processedUrl);
        }

        return processedUrl;
    }

    async handleTokenParam(url, match, options) {
        // 如果提供了token生成函数，使用它
        if (options.tokenGenerator) {
            const newToken = await options.tokenGenerator(url);
            return url.replace(match[0], `token=${newToken}`);
        }
        return url;
    }

    handleTimestampParam(url, match) {
        // 更新时间戳为当前时间
        const now = Date.now();
        return url.replace(match[0], `timestamp=${now}`);
    }

    async handleSignParam(url, match, options) {
        // 如果提供了签名生成函数，使用它
        if (options.signGenerator) {
            const newSign = await options.signGenerator(url);
            return url.replace(match[0], `sign=${newSign}`);
        }
        return url;
    }

    updateTimestamp(url) {
        const parsedUrl = new URL(url);
        const now = Date.now();
        
        if (parsedUrl.searchParams.has('t')) {
            parsedUrl.searchParams.set('t', now);
        }
        if (parsedUrl.searchParams.has('_t')) {
            parsedUrl.searchParams.set('_t', now);
        }
        
        return parsedUrl.toString();
    }

    async handleAntiLeechError(url, options) {
        // 尝试使用data URL方案
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                headers: {
                    ...options.headers,
                    'Referer': '',
                    'Origin': null
                }
            });

            const base64 = Buffer.from(response.data, 'binary').toString('base64');
            const contentType = response.headers['content-type'];
            const dataUrl = `data:${contentType};base64,${base64}`;

            return {
                data: response.data,
                contentType,
                originalUrl: url,
                processedUrl: dataUrl,
                headers: response.headers
            };
        } catch (error) {
            // 如果data URL方案失败，尝试代理方案
            return await this.tryProxyDownload(url, options);
        }
    }

    async tryProxyDownload(url, options) {
        // 使用代理服务器下载
        const proxyUrls = [
            `https://images.weserv.nl/?url=${encodeURIComponent(url)}`,
            `https://proxy.pixivel.moe/img?url=${encodeURIComponent(url)}`,
            `https://imageproxy.pimg.tw/resize?url=${encodeURIComponent(url)}`
        ];

        for (const proxyUrl of proxyUrls) {
            try {
                const response = await axios({
                    method: 'get',
                    url: proxyUrl,
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    validateStatus: status => status === 200
                });

                return {
                    data: response.data,
                    contentType: response.headers['content-type'],
                    originalUrl: url,
                    processedUrl: proxyUrl,
                    headers: response.headers
                };
            } catch (error) {
                continue;
            }
        }

        throw new Error('所有下载方案都失败了');
    }

    generateImageHash(data) {
        return crypto.createHash('md5').update(data).digest('hex');
    }

    getImageExtension(contentType) {
        const extensions = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/bmp': '.bmp'
        };
        return extensions[contentType] || '.jpg';
    }

    async verifyImage(data, contentType) {
        // 验证图片完整性
        const buffer = Buffer.from(data);
        
        // 检查文件头
        const signatures = {
            'image/jpeg': [0xFF, 0xD8, 0xFF],
            'image/png': [0x89, 0x50, 0x4E, 0x47],
            'image/gif': [0x47, 0x49, 0x46, 0x38],
            'image/webp': [0x52, 0x49, 0x46, 0x46]
        };

        const signature = signatures[contentType];
        if (signature) {
            for (let i = 0; i < signature.length; i++) {
                if (buffer[i] !== signature[i]) {
                    throw new Error('图片格式验证失败');
                }
            }
        }

        return true;
    }
}

module.exports = new ImageDownloader(); 