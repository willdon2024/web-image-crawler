const axios = require('axios');
const { URL } = require('url');

class RobotsParser {
    constructor() {
        this.cache = new Map(); // 缓存已解析的robots.txt
        this.cacheTimeout = 3600000; // 缓存1小时
    }

    async analyze(url) {
        const baseUrl = new URL(url);
        const robotsUrl = `${baseUrl.protocol}//${baseUrl.host}/robots.txt`;
        
        try {
            // 检查缓存
            const cachedResult = this.getCachedResult(robotsUrl);
            if (cachedResult) {
                return cachedResult;
            }

            const response = await axios.get(robotsUrl, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ImageCrawler/1.0)'
                }
            });

            const rules = this.parseRobotsTxt(response.data);
            const result = {
                hasRobotsTxt: true,
                allowedPaths: rules.allow,
                disallowedPaths: rules.disallow,
                crawlDelay: rules.crawlDelay,
                sitemaps: rules.sitemaps,
                userAgentRules: rules.userAgentRules,
                recommendedDelay: this.calculateRecommendedDelay(rules),
                isPathAllowed: this.isPathAllowed(baseUrl.pathname, rules),
                riskLevel: this.assessRiskLevel(rules),
                suggestions: this.generateSuggestions(rules, baseUrl)
            };

            // 缓存结果
            this.cacheResult(robotsUrl, result);
            return result;

        } catch (error) {
            if (error.response && error.response.status === 404) {
                // 网站没有robots.txt
                return {
                    hasRobotsTxt: false,
                    allowedPaths: ['*'],
                    disallowedPaths: [],
                    crawlDelay: 0,
                    sitemaps: [],
                    riskLevel: 'low',
                    isPathAllowed: true,
                    suggestions: ['网站未设置robots.txt，建议谨慎爬取并遵守基本的爬虫礼仪']
                };
            }
            
            console.warn(`获取robots.txt失败: ${error.message}`);
            // 发生错误时采用保守策略
            return {
                hasRobotsTxt: null,
                error: error.message,
                riskLevel: 'high',
                isPathAllowed: false,
                suggestions: ['无法访问robots.txt，建议采取保守策略']
            };
        }
    }

    parseRobotsTxt(content) {
        const rules = {
            allow: new Set(),
            disallow: new Set(),
            crawlDelay: 0,
            sitemaps: new Set(),
            userAgentRules: new Map()
        };

        let currentUserAgent = '*';
        const lines = content.split('\n');

        for (let line of lines) {
            line = line.trim().toLowerCase();
            if (!line || line.startsWith('#')) continue;

            const [directive, ...valueParts] = line.split(':').map(part => part.trim());
            const value = valueParts.join(':').trim();

            switch (directive.toLowerCase()) {
                case 'user-agent':
                    currentUserAgent = value;
                    if (!rules.userAgentRules.has(currentUserAgent)) {
                        rules.userAgentRules.set(currentUserAgent, {
                            allow: new Set(),
                            disallow: new Set(),
                            crawlDelay: 0
                        });
                    }
                    break;
                case 'allow':
                    if (value) {
                        rules.allow.add(value);
                        rules.userAgentRules.get(currentUserAgent).allow.add(value);
                    }
                    break;
                case 'disallow':
                    if (value) {
                        rules.disallow.add(value);
                        rules.userAgentRules.get(currentUserAgent).disallow.add(value);
                    }
                    break;
                case 'crawl-delay':
                    const delay = parseFloat(value);
                    if (!isNaN(delay)) {
                        rules.crawlDelay = Math.max(rules.crawlDelay, delay);
                        rules.userAgentRules.get(currentUserAgent).crawlDelay = delay;
                    }
                    break;
                case 'sitemap':
                    if (value) rules.sitemaps.add(value);
                    break;
            }
        }

        // 转换Set为数组以便JSON序列化
        return {
            allow: Array.from(rules.allow),
            disallow: Array.from(rules.disallow),
            crawlDelay: rules.crawlDelay,
            sitemaps: Array.from(rules.sitemaps),
            userAgentRules: Object.fromEntries(
                Array.from(rules.userAgentRules.entries()).map(([agent, rules]) => [
                    agent,
                    {
                        allow: Array.from(rules.allow),
                        disallow: Array.from(rules.disallow),
                        crawlDelay: rules.crawlDelay
                    }
                ])
            )
        };
    }

    isPathAllowed(path, rules) {
        // 如果没有任何规则，则允许访问
        if (rules.disallow.length === 0 && rules.allow.length === 0) {
            return true;
        }

        let isDisallowed = false;
        
        // 检查是否被禁止
        for (const pattern of rules.disallow) {
            if (this.matchesPattern(path, pattern)) {
                isDisallowed = true;
                break;
            }
        }

        // 如果被禁止，检查是否有特别允许的规则
        if (isDisallowed) {
            for (const pattern of rules.allow) {
                if (this.matchesPattern(path, pattern)) {
                    return true;
                }
            }
            return false;
        }

        return true;
    }

    matchesPattern(path, pattern) {
        // 转换robots.txt模式为正则表达式
        const regex = new RegExp(
            '^' + 
            pattern
                .replace(/\*/g, '.*')
                .replace(/\?/g, '\\?')
                .replace(/\./g, '\\.')
                .replace(/\$/g, '\\$') +
            (pattern.endsWith('$') ? '' : '.*') +
            '$'
        );
        return regex.test(path);
    }

    calculateRecommendedDelay(rules) {
        // 基于规则计算推荐的延迟时间
        const baseDelay = rules.crawlDelay || 1;
        const maxDelay = 10; // 最大延迟10秒
        
        // 根据规则复杂度调整延迟
        const complexityFactor = Math.min(
            (rules.disallow.length + rules.allow.length) / 10,
            1
        );
        
        return Math.min(baseDelay * (1 + complexityFactor), maxDelay);
    }

    assessRiskLevel(rules) {
        let riskScore = 0;

        // 评估禁止规则的数量和严格程度
        riskScore += rules.disallow.length * 2;
        
        // 检查是否有完全禁止的规则
        if (rules.disallow.includes('/')) {
            riskScore += 10;
        }

        // 检查爬取延迟要求
        if (rules.crawlDelay > 5) {
            riskScore += 5;
        }

        // 根据分数返回风险等级
        if (riskScore > 15) return 'high';
        if (riskScore > 8) return 'medium';
        return 'low';
    }

    generateSuggestions(rules, baseUrl) {
        const suggestions = [];

        // 基于规则生成建议
        if (rules.crawlDelay > 0) {
            suggestions.push(`建议遵守网站设置的爬取延迟: ${rules.crawlDelay}秒`);
        }

        if (rules.sitemaps.length > 0) {
            suggestions.push('建议优先使用网站提供的Sitemap获取资源列表');
        }

        if (rules.disallow.length > 10) {
            suggestions.push('网站有较多访问限制，建议仔细评估目标路径是否允许访问');
        }

        // 检查当前路径的访问权限
        const isAllowed = this.isPathAllowed(baseUrl.pathname, rules);
        if (!isAllowed) {
            suggestions.push('当前路径被robots.txt禁止访问，建议寻找替代方案或调整目标');
        }

        return suggestions;
    }

    getCachedResult(robotsUrl) {
        const cached = this.cache.get(robotsUrl);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    cacheResult(robotsUrl, result) {
        this.cache.set(robotsUrl, {
            timestamp: Date.now(),
            data: result
        });
    }
}

module.exports = new RobotsParser(); 