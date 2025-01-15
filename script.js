document.getElementById('crawlForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const url = document.getElementById('url').value;
    const loading = document.querySelector('.loading');
    const imageGrid = document.getElementById('imageGrid');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    
    // 显示加载动画
    loading.style.display = 'block';
    imageGrid.innerHTML = '';
    progressBar.style.width = '0%';
    progressText.textContent = '正在获取网页内容...';

    try {
        const response = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url));
        const html = await response.text();
        
        // 创建一个临时的DOM元素来解析HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // 获取所有图片元素
        const images = Array.from(doc.getElementsByTagName('img'));
        
        // 过滤和处理图片URL
        const imageUrls = images
            .map(img => {
                const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original');
                if (!src) return null;
                
                // 转换相对URL为绝对URL
                try {
                    return new URL(src, url).href;
                } catch (e) {
                    return null;
                }
            })
            .filter(src => src && (src.endsWith('.jpg') || src.endsWith('.jpeg') || src.endsWith('.png') || src.endsWith('.gif')));

        if (imageUrls.length === 0) {
            imageGrid.innerHTML = '<p class="text-center">未找到任何图片</p>';
            loading.style.display = 'none';
            return;
        }

        progressText.textContent = `准备加载: ${imageUrls.length} 张图片`;
        
        // 显示图片并更新进度
        let loadedCount = 0;
        const updateProgress = () => {
            loadedCount++;
            const progress = (loadedCount / imageUrls.length) * 100;
            progressBar.style.width = progress + '%';
            progressText.textContent = `已加载: ${loadedCount}/${imageUrls.length} 张图片`;
        };

        const loadPromises = imageUrls.map(imageUrl => {
            return new Promise((resolve, reject) => {
                const img = document.createElement('img');
                img.src = imageUrl;
                img.className = 'image-item';
                img.addEventListener('load', () => {
                    imageGrid.appendChild(img);
                    img.addEventListener('click', () => window.open(imageUrl, '_blank'));
                    updateProgress();
                    resolve();
                });
                img.addEventListener('error', () => {
                    updateProgress();
                    resolve(); // 即使加载失败也继续
                });
            });
        });

        await Promise.all(loadPromises);
        progressText.textContent = `完成加载: ${loadedCount}/${imageUrls.length} 张图片`;

    } catch (error) {
        imageGrid.innerHTML = `<p class="text-center text-danger">发生错误: ${error.message}</p>`;
    } finally {
        loading.style.display = 'none';
    }
}); 