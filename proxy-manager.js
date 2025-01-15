const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

class ProxyManager {
    constructor() {
        this.proxyList = [];
        this.currentIndex = 0;
        this.lastProxyUpdate = 0;
        this.updateInterval = 30 * 60 * 1000; // 30分钟更新一次代理列表
    }

    async initialize() {
        await this.updateProxyList();
    }

    async updateProxyList() {
        try {
            // 从多个免费代理源获取代理
            const proxySources = [
                'https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&sort_by=lastChecked&sort_type=desc&protocols=http%2Chttps&anonymityLevel=elite&anonymityLevel=anonymous',
                'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
                'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt'
            ];

            const newProxies = new Set();

            for (const source of proxySources) {
                try {
                    const response = await axios.get(source, { timeout: 5000 });
                    let proxyData = response.data;

                    if (typeof proxyData === 'string') {
                        // 处理文本格式的代理列表
                        const lines = proxyData.split('\n');
                        lines.forEach(line => {
                            const proxy = line.trim();
                            if (proxy && this.isValidProxy(proxy)) {
                                newProxies.add(`http://${proxy}`);
                            }
                        });
                    } else if (Array.isArray(proxyData.data)) {
                        // 处理API返回的JSON格式
                        proxyData.data.forEach(proxy => {
                            const proxyString = `${proxy.protocol}://${proxy.ip}:${proxy.port}`;
                            if (this.isValidProxy(proxyString)) {
                                newProxies.add(proxyString);
                            }
                        });
                    }
                } catch (error) {
                    console.warn(`从代理源 ${source} 获取代理失败:`, error.message);
                }
            }

            // 验证代理可用性
            const validProxies = await this.validateProxies(Array.from(newProxies));
            this.proxyList = validProxies;
            this.lastProxyUpdate = Date.now();
            console.log(`更新代理池完成，当前可用代理数量: ${this.proxyList.length}`);
        } catch (error) {
            console.error('更新代理列表失败:', error);
            throw error;
        }
    }

    async validateProxies(proxies) {
        const validProxies = [];
        const testUrl = 'https://www.google.com';
        const timeout = 5000;

        const validationPromises = proxies.map(async proxy => {
            try {
                const agent = proxy.startsWith('socks') 
                    ? new SocksProxyAgent(proxy)
                    : new HttpsProxyAgent(proxy);

                await axios.get(testUrl, {
                    proxy: false,
                    httpsAgent: agent,
                    timeout
                });

                validProxies.push(proxy);
            } catch (error) {
                // 代理验证失败，忽略
            }
        });

        await Promise.all(validationPromises);
        return validProxies;
    }

    isValidProxy(proxy) {
        // 简单的代理格式验证
        return typeof proxy === 'string' && 
               (proxy.includes('http://') || proxy.includes('https://') || 
                proxy.match(/\d+\.\d+\.\d+\.\d+:\d+/));
    }

    async getProxy() {
        // 检查是否需要更新代理列表
        if (Date.now() - this.lastProxyUpdate > this.updateInterval) {
            await this.updateProxyList();
        }

        if (this.proxyList.length === 0) {
            throw new Error('没有可用的代理');
        }

        // 轮换使用代理
        const proxy = this.proxyList[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxyList.length;
        return proxy;
    }

    async getProxyAgent() {
        const proxy = await this.getProxy();
        return proxy.startsWith('socks') 
            ? new SocksProxyAgent(proxy)
            : new HttpsProxyAgent(proxy);
    }
}

module.exports = new ProxyManager(); 