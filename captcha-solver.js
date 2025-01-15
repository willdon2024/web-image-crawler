const { createWorker } = require('tesseract.js');
const { Solver } = require('2captcha');
const { AntiCaptcha } = require('node-anticaptcha');
const axios = require('axios');

class CaptchaSolver {
    constructor(config = {}) {
        this.config = {
            twoCaptchaKey: config.twoCaptchaKey || process.env.TWO_CAPTCHA_KEY,
            antiCaptchaKey: config.antiCaptchaKey || process.env.ANTI_CAPTCHA_KEY
        };

        // 初始化第三方服务
        if (this.config.twoCaptchaKey) {
            this.solver2Captcha = new Solver(this.config.twoCaptchaKey);
        }
        if (this.config.antiCaptchaKey) {
            this.antiCaptcha = new AntiCaptcha(this.config.antiCaptchaKey);
        }

        // 初始化Tesseract
        this.tesseractWorker = null;
    }

    async initTesseract() {
        if (!this.tesseractWorker) {
            this.tesseractWorker = await createWorker('chi_sim+eng');
            await this.tesseractWorker.loadLanguage('chi_sim+eng');
            await this.tesseractWorker.initialize('chi_sim+eng');
        }
    }

    async solveCaptcha(page, captchaType, captchaConfig = {}) {
        switch (captchaType) {
            case 'image':
                return await this.solveImageCaptcha(page, captchaConfig);
            case 'recaptcha':
                return await this.solveRecaptcha(page, captchaConfig);
            case 'slider':
                return await this.solveSliderCaptcha(page, captchaConfig);
            default:
                throw new Error(`不支持的验证码类型: ${captchaType}`);
        }
    }

    async solveImageCaptcha(page, config) {
        try {
            // 获取验证码图片
            const captchaSelector = config.selector || '#captcha-image';
            const captchaElement = await page.$(captchaSelector);
            if (!captchaElement) {
                throw new Error('未找到验证码元素');
            }

            // 截取验证码图片
            const screenshot = await captchaElement.screenshot({
                encoding: 'base64'
            });

            // 首先尝试使用Tesseract
            try {
                await this.initTesseract();
                const { data: { text } } = await this.tesseractWorker.recognize(
                    `data:image/png;base64,${screenshot}`,
                    { tessedit_char_whitelist: config.allowedChars || '' }
                );
                
                if (text && text.length >= (config.minLength || 4)) {
                    return text.trim();
                }
            } catch (error) {
                console.warn('Tesseract识别失败:', error);
            }

            // 如果Tesseract失败，尝试使用2captcha
            if (this.solver2Captcha) {
                try {
                    const result = await this.solver2Captcha.imageCaptcha({
                        base64: screenshot,
                        numeric: config.numeric || 0,
                        minLength: config.minLength || 4,
                        maxLength: config.maxLength || 8,
                        phrase: config.phrase || 0,
                        caseSensitive: config.caseSensitive || 0,
                        calc: config.calc || 0
                    });
                    return result.data;
                } catch (error) {
                    console.warn('2captcha识别失败:', error);
                }
            }

            // 最后尝试使用Anti-Captcha
            if (this.antiCaptcha) {
                try {
                    const task = await this.antiCaptcha.createImageToTextTask({
                        case: config.caseSensitive || false,
                        numeric: config.numeric || 0,
                        math: config.calc || 0,
                        minLength: config.minLength || 4,
                        maxLength: config.maxLength || 8,
                        phrase: config.phrase || false,
                        body: screenshot
                    });
                    const result = await task.wait();
                    return result.text;
                } catch (error) {
                    console.warn('Anti-Captcha识别失败:', error);
                }
            }

            throw new Error('所有验证码识别方法都失败了');
        } catch (error) {
            throw new Error(`验证码识别失败: ${error.message}`);
        }
    }

    async solveRecaptcha(page, config) {
        const sitekey = config.sitekey || await page.evaluate(() => {
            const element = document.querySelector('.g-recaptcha');
            return element ? element.getAttribute('data-sitekey') : null;
        });

        if (!sitekey) {
            throw new Error('未找到reCAPTCHA的sitekey');
        }

        // 尝试使用2captcha
        if (this.solver2Captcha) {
            try {
                const result = await this.solver2Captcha.recaptcha({
                    sitekey,
                    pageurl: await page.url(),
                    invisible: config.invisible || false
                });
                return result.data;
            } catch (error) {
                console.warn('2captcha reCAPTCHA解决失败:', error);
            }
        }

        // 尝试使用Anti-Captcha
        if (this.antiCaptcha) {
            try {
                const task = await this.antiCaptcha.createRecaptchaV2Task({
                    websiteURL: await page.url(),
                    websiteKey: sitekey,
                    isInvisible: config.invisible || false
                });
                const result = await task.wait();
                return result.gRecaptchaResponse;
            } catch (error) {
                console.warn('Anti-Captcha reCAPTCHA解决失败:', error);
            }
        }

        throw new Error('所有reCAPTCHA解决方法都失败了');
    }

    async solveSliderCaptcha(page, config) {
        const sliderElement = await page.$(config.sliderSelector || '.slider');
        const targetElement = await page.$(config.targetSelector || '.target');

        if (!sliderElement || !targetElement) {
            throw new Error('未找到滑块验证码元素');
        }

        // 获取滑块和目标位置
        const sliderBox = await sliderElement.boundingBox();
        const targetBox = await targetElement.boundingBox();

        // 计算移动距离
        const distance = targetBox.x - sliderBox.x;

        // 模拟人类滑动行为
        await page.mouse.move(sliderBox.x + sliderBox.width / 2, sliderBox.y + sliderBox.height / 2);
        await page.mouse.down();

        // 使用缓动函数模拟人类移动
        const steps = 30;
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            const moveX = this.easeOutCubic(progress) * distance;
            await page.mouse.move(sliderBox.x + moveX, sliderBox.y + Math.random() * 5);
            await page.waitForTimeout(Math.random() * 10);
        }

        await page.mouse.up();
        await page.waitForTimeout(1000);

        return true;
    }

    // 缓动函数，使滑动更自然
    easeOutCubic(x) {
        return 1 - Math.pow(1 - x, 3);
    }

    async cleanup() {
        if (this.tesseractWorker) {
            await this.tesseractWorker.terminate();
            this.tesseractWorker = null;
        }
    }
}

module.exports = CaptchaSolver; 