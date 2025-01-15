document.getElementById('crawlForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const url = document.getElementById('url').value;
    const loading = document.querySelector('.loading');
    const imageGrid = document.getElementById('imageGrid');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressNumbers = document.getElementById('progressNumbers');
    const currentPhase = document.getElementById('currentPhase');
    
    // 显示加载动画
    loading.style.display = 'block';
    imageGrid.innerHTML = '';
    progressBar.style.width = '0%';
    progressText.textContent = '准备开始...';
    progressNumbers.textContent = '0/0';
    currentPhase.innerHTML = '<i class="fas fa-globe"></i> 正在获取网页内容...';

    try {
        const response = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url));
        const html = await response.text();
        
        currentPhase.innerHTML = '<i class="fas fa-search"></i> 正在分析网页内容...';
        
        // 创建一个临时的DOM元素来解析HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // 获取所有可能包含图片的元素
        const images = [
            ...Array.from(doc.getElementsByTagName('img')), // 标准图片标签
            ...Array.from(doc.querySelectorAll('[data-src]')), // 懒加载图片
            ...Array.from(doc.querySelectorAll('[data-original]')), // 一些网站使用data-original
            ...Array.from(doc.querySelectorAll('[style*="background-image"]')) // 背景图片
        ];
        
        // 过滤和处理图片URL
        let imageUrls = new Set(); // 使用Set去重
        
        images.forEach(img => {
            // 检查src属性
            const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original');
            if (src) {
                try {
                    const absoluteUrl = new URL(src, url).href;
                    if (absoluteUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)) {
                        imageUrls.add(absoluteUrl);
                    }
                } catch (e) {}
            }
            
            // 检查背景图片
            const style = img.getAttribute('style');
            if (style) {
                const match = style.match(/background-image:\s*url\(['"]?([^'"()]+)['"]?\)/);
                if (match) {
                    try {
                        const absoluteUrl = new URL(match[1], url).href;
                        if (absoluteUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)) {
                            imageUrls.add(absoluteUrl);
                        }
                    } catch (e) {}
                }
            }
        });

        imageUrls = Array.from(imageUrls); // 转换回数组

        if (imageUrls.length === 0) {
            imageGrid.innerHTML = '<p class="text-center">未找到任何图片</p>';
            loading.style.display = 'none';
            return;
        }

        currentPhase.innerHTML = '<i class="fas fa-images"></i> 正在加载图片...';
        progressText.textContent = '正在加载图片';
        progressNumbers.textContent = `0/${imageUrls.length}`;
        
        // 显示图片并更新进度
        let loadedCount = 0;
        let successCount = 0;
        const updateProgress = () => {
            loadedCount++;
            const progress = (loadedCount / imageUrls.length) * 100;
            progressBar.style.width = progress + '%';
            progressText.textContent = `正在加载图片 (成功: ${successCount}张)`;
            progressNumbers.textContent = `${loadedCount}/${imageUrls.length}`;
        };

        const loadPromises = imageUrls.map(imageUrl => {
            return new Promise((resolve, reject) => {
                const img = document.createElement('img');
                img.src = imageUrl;
                img.className = 'image-item';
                img.addEventListener('load', () => {
                    imageGrid.appendChild(img);
                    img.addEventListener('click', () => window.open(imageUrl, '_blank'));
                    successCount++;
                    updateProgress();
                    resolve(imageUrl);
                });
                img.addEventListener('error', () => {
                    updateProgress();
                    resolve(null); // 加载失败返回null
                });
            });
        });

        const results = await Promise.all(loadPromises);
        const successUrls = results.filter(url => url !== null);

        // 添加下载按钮
        if (successUrls.length > 0) {
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn btn-success';
            downloadBtn.innerHTML = `<i class="fas fa-download"></i> 下载全部图片 (${successUrls.length}张)`;
            downloadBtn.onclick = async () => {
                const zip = new JSZip();
                // 生成当前日期时间字符串
                const now = new Date();
                const dateStr = now.toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).replace(/\//g, '');
                const timeStr = now.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                }).replace(/:/g, '');
                const zipFilename = `images_${dateStr}_${timeStr}.zip`;

                // 创建下载进度条容器
                const downloadProgressContainer = document.createElement('div');
                downloadProgressContainer.className = 'progress-container mt-3';
                downloadProgressContainer.innerHTML = `
                    <div class="progress-phase">
                        <i class="fas fa-download"></i> 正在打包图片...
                    </div>
                    <div class="progress">
                        <div class="progress-bar progress-bar-striped progress-bar-animated" 
                             role="progressbar" style="width: 0%"></div>
                    </div>
                    <div class="progress-info">
                        <span>正在下载图片</span>
                        <span class="progress-numbers">0/${successUrls.length}</span>
                    </div>
                `;
                downloadBtn.parentNode.insertBefore(downloadProgressContainer, downloadBtn.nextSibling);

                // 下载所有图片并添加到zip
                let downloadCount = 0;
                const updateDownloadProgress = () => {
                    downloadCount++;
                    const progress = (downloadCount / successUrls.length) * 100;
                    const progressBar = downloadProgressContainer.querySelector('.progress-bar');
                    const progressNumbers = downloadProgressContainer.querySelector('.progress-numbers');
                    progressBar.style.width = `${progress}%`;
                    progressNumbers.textContent = `${downloadCount}/${successUrls.length}`;
                };

                for (let i = 0; i < successUrls.length; i++) {
                    const url = successUrls[i];
                    try {
                        const response = await fetch(url);
                        const blob = await response.blob();
                        // 使用日期时间作为文件夹名
                        const filename = `${dateStr}_${timeStr}/image_${(i + 1).toString().padStart(3, '0')}.${blob.type.split('/')[1]}`;
                        zip.file(filename, blob);
                        updateDownloadProgress();
                    } catch (error) {
                        console.error('下载图片失败:', url, error);
                    }
                }

                // 更新状态为正在生成zip
                downloadProgressContainer.querySelector('.progress-phase').innerHTML = 
                    '<i class="fas fa-file-archive"></i> 正在生成压缩包...';

                // 生成并下载zip文件
                const content = await zip.generateAsync({type: 'blob'});
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(content);
                downloadLink.download = zipFilename;
                downloadLink.click();
                URL.revokeObjectURL(downloadLink.href);

                // 更新完成状态
                downloadProgressContainer.querySelector('.progress-phase').innerHTML = 
                    '<i class="fas fa-check"></i> 下载完成';
            };
            imageGrid.parentNode.insertBefore(downloadBtn, imageGrid);
        }

        currentPhase.innerHTML = '<i class="fas fa-check-circle"></i> 加载完成';
        progressText.textContent = '图片加载完成';
        progressNumbers.textContent = `${successCount}/${imageUrls.length}`;

    } catch (error) {
        imageGrid.innerHTML = `<p class="text-center text-danger">发生错误: ${error.message}</p>`;
        currentPhase.innerHTML = '<i class="fas fa-exclamation-circle"></i> 发生错误';
    } finally {
        loading.style.display = 'none';
    }
}); 