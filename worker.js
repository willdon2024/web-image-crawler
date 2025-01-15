const { v4: uuidv4 } = require('uuid');
const os = require('os');
const puppeteer = require('puppeteer-extra');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const proxyManager = require('./proxy-manager');
const CaptchaSolver = require('./captcha-solver');
const resourceAnalyzer = require('./resource-analyzer');
const robotsParser = require('./robots-parser');
const imageDownloader = require('./image-downloader');

class Worker {
    constructor(scheduler, config = {}) {
        this.id = config.id || `worker-${uuidv4()}`;
        this.scheduler = scheduler;
        this.config = {
            maxConcurrent: config.maxConcurrent || 2,
            heartbeatInterval: config.heartbeatInterval || 10000,
            ...config
        };

        this.activeTasks = new Map();
        this.status = 'idle';
        this.lastError = null;

        // 初始化验证码处理器
        this.captchaSolver = new CaptchaSolver({
            twoCaptchaKey: process.env.TWO_CAPTCHA_KEY,
            antiCaptchaKey: process.env.ANTI_CAPTCHA_KEY
        });

        // 配置reCAPTCHA插件
        puppeteer.use(
            RecaptchaPlugin({
                provider: {
                    id: '2captcha',
                    token: process.env.TWO_CAPTCHA_KEY
                }
            })
        );
    }

    async start() {
        try {
            // 注册工作节点
            await this.scheduler.registerWorker(this.id, {
                hostname: os.hostname(),
                platform: os.platform(),
                maxConcurrent: this.config.maxConcurrent
            });

            // 启动心跳
            this.startHeartbeat();

            // 启动任务处理循环
            this.processLoop();

            console.log(`工作节点 ${this.id} 启动成功`);
        } catch (error) {
            console.error(`工作节点 ${this.id} 启动失败:`, error);
            throw error;
        }
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(async () => {
            try {
                await this.scheduler.updateWorkerHeartbeat(this.id);
            } catch (error) {
                console.error(`心跳更新失败:`, error);
            }
        }, this.config.heartbeatInterval);
    }

    async processLoop() {
        while (true) {
            try {
                // 检查是否可以接受新任务
                if (this.activeTasks.size >= this.config.maxConcurrent) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }

                // 获取新任务
                const task = await this.scheduler.getNextTask(this.id);
                if (!task) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }

                // 处理任务
                this.processTask(task).catch(error => {
                    console.error(`任务处理错误 ${task.id}:`, error);
                });

            } catch (error) {
                console.error('任务处理循环错误:', error);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async processTask(task) {
        console.log(`开始处理任务 ${task.id}: ${task.url}`);
        this.activeTasks.set(task.id, task);
        this.status = 'busy';

        const imageResults = {
            successful: [],
            failed: []
        };

        try {
            // 分析robots.txt
            const robotsResult = await robotsParser.analyze(task.url);
            
            // 如果路径被禁止且任务没有忽略robots.txt
            if (!robotsResult.isPathAllowed && !task.options.ignoreRobotsTxt) {
                throw new Error('robots.txt禁止访问此路径');
            }

            // 应用爬取延迟
            const crawlDelay = robotsResult.crawlDelay || robotsResult.recommendedDelay;
            if (crawlDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, crawlDelay * 1000));
            }

            // 处理找到的图片URL
            const processImages = async (urls) => {
                for (const url of urls) {
                    try {
                        // 下载图片
                        const result = await imageDownloader.downloadImage(url, {
                            headers: {
                                'Referer': task.url
                            },
                            tokenGenerator: task.options.tokenGenerator,
                            signGenerator: task.options.signGenerator
                        });

                        // 验证图片
                        await imageDownloader.verifyImage(result.data, result.contentType);

                        // 生成图片哈希
                        const hash = imageDownloader.generateImageHash(result.data);
                        const extension = imageDownloader.getImageExtension(result.contentType);

                        imageResults.successful.push({
                            url: result.originalUrl,
                            processedUrl: result.processedUrl,
                            contentType: result.contentType,
                            hash,
                            extension,
                            size: result.data.length
                        });
                    } catch (error) {
                        console.warn(`图片下载失败 ${url}:`, error.message);
                        imageResults.failed.push({
                            url,
                            error: error.message
                        });
                    }
                }
            };

            // 首先尝试直接分析资源
            const resourceResults = await resourceAnalyzer.analyzeUrl(task.url);
            const allImages = new Set([
                ...resourceResults.directUrls,
                ...resourceResults.cdnUrls
            ]);

            // 处理直接找到的图片
            if (allImages.size > 0) {
                await processImages(Array.from(allImages));
                if (imageResults.successful.length > 0) {
                    await this.scheduler.completeTask(task.id, {
                        images: imageResults,
                        source: 'direct',
                        robotsInfo: robotsResult
                    });
                    return;
                }
            }

            // 获取代理
            const proxy = await proxyManager.getProxy();
            
            // 启动浏览器
            const browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    `--proxy-server=${proxy}`
                ]
            });

            try {
                const page = await browser.newPage();
                const imageUrls = new Set();

                // 监控网络请求
                await page.setRequestInterception(true);
                page.on('request', request => {
                    const resourceType = request.resourceType();
                    const url = request.url();
                    
                    if (resourceType === 'image' || url.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i)) {
                        imageUrls.add(url);
                    }
                    request.continue();
                });

                // 配置浏览器环境
                await page.setViewport({ width: 1920, height: 1080 });
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
                await page.authenticate(proxy.auth || null);

                // 访问页面
                await page.goto(task.url, {
                    waitUntil: ['load', 'networkidle0'],
                    timeout: 30000
                });

                // 处理验证码
                await this.handleCaptchas(page);

                // 等待动态内容加载
                await page.waitForTimeout(2000);

                // 提取动态加载的图片
                const dynamicImages = await page.evaluate(() => {
                    const images = [];
                    document.querySelectorAll('img, [style*="background-image"]').forEach(el => {
                        if (el.tagName === 'IMG') {
                            if (el.src) images.push(el.src);
                            if (el.dataset.src) images.push(el.dataset.src);
                            if (el.dataset.original) images.push(el.dataset.original);
                        } else {
                            const style = getComputedStyle(el);
                            const bgImage = style.backgroundImage;
                            if (bgImage && bgImage !== 'none') {
                                const url = bgImage.match(/url\(['"]?([^'"()]+)['"]?\)/);
                                if (url) images.push(url[1]);
                            }
                        }
                    });
                    return Array.from(new Set(images));
                });

                // 合并所有图片URL
                const puppeteerImages = new Set([...imageUrls, ...dynamicImages]);

                // 处理动态加载的图片
                await processImages(Array.from(puppeteerImages));

                // 处理API端点
                if (resourceResults.apiEndpoints.length > 0) {
                    for (const apiUrl of resourceResults.apiEndpoints) {
                        try {
                            const apiResponse = await axios.get(apiUrl, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                                    'Referer': task.url
                                }
                            });
                            
                            if (apiResponse.data) {
                                const apiImages = resourceAnalyzer.extractUrlsFromObject(apiResponse.data, new URL(task.url));
                                await processImages(apiImages);
                            }
                        } catch (error) {
                            console.warn(`API端点 ${apiUrl} 获取失败:`, error.message);
                        }
                    }
                }

                // 完成任务
                await this.scheduler.completeTask(task.id, {
                    images: imageResults,
                    source: 'combined',
                    robotsInfo: robotsResult,
                    stats: {
                        directUrls: resourceResults.directUrls.length,
                        cdnUrls: resourceResults.cdnUrls.length,
                        apiEndpoints: resourceResults.apiEndpoints.length,
                        dynamicUrls: puppeteerImages.size,
                        successful: imageResults.successful.length,
                        failed: imageResults.failed.length
                    }
                });

            } finally {
                await browser.close();
            }

        } catch (error) {
            console.error(`任务 ${task.id} 失败:`, error);
            await this.scheduler.failTask(task.id, error);
            this.lastError = error;
        } finally {
            this.activeTasks.delete(task.id);
            this.status = this.activeTasks.size > 0 ? 'busy' : 'idle';
        }
    }

    async handleCaptchas(page) {
        try {
            // 检查reCAPTCHA
            const hasRecaptcha = await page.$('.g-recaptcha');
            if (hasRecaptcha) {
                console.log('检测到reCAPTCHA，尝试解决...');
                const result = await this.captchaSolver.solveRecaptcha(page, {});
                await page.evaluate(`document.getElementById('g-recaptcha-response').innerHTML = '${result}';`);
                await page.evaluate(() => {
                    document.querySelector('form')?.submit();
                });
                await page.waitForNavigation();
            }

            // 检查图片验证码
            const hasImageCaptcha = await page.$('#captcha-image, .captcha-image, [name="captcha"]');
            if (hasImageCaptcha) {
                console.log('检测到图片验证码，尝试解决...');
                const result = await this.captchaSolver.solveImageCaptcha(page, {
                    selector: '#captcha-image, .captcha-image, [name="captcha"]'
                });
                await page.type('#captcha-input, [name="captcha"]', result);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(2000);
            }

            // 检查滑块验证码
            const hasSliderCaptcha = await page.$('.slider-captcha, .slider');
            if (hasSliderCaptcha) {
                console.log('检测到滑块验证码，尝试解决...');
                await this.captchaSolver.solveSliderCaptcha(page, {
                    sliderSelector: '.slider-captcha, .slider',
                    targetSelector: '.slider-target, .target'
                });
            }
        } catch (error) {
            console.warn('验证码处理失败:', error);
        }
    }

    async shutdown() {
        clearInterval(this.heartbeatInterval);
        this.status = 'shutting_down';
        
        // 等待当前任务完成
        if (this.activeTasks.size > 0) {
            console.log(`等待 ${this.activeTasks.size} 个任务完成...`);
            await Promise.all(Array.from(this.activeTasks.values()));
        }

        await this.captchaSolver.cleanup();
    }
}

module.exports = Worker; 