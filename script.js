document.getElementById('crawlForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const url = document.getElementById('url').value;
    const loading = document.querySelector('.loading');
    const imageGrid = document.getElementById('imageGrid');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressNumbers = document.getElementById('progressNumbers');
    const currentPhase = document.getElementById('currentPhase');
    
    // 清除之前的内容和状态
    loading.style.display = 'block';
    imageGrid.innerHTML = '';
    const existingControls = document.querySelector('.selection-controls');
    if (existingControls) {
        existingControls.remove();
    }
    const existingDownloadBtn = document.querySelector('.btn-success');
    if (existingDownloadBtn) {
        existingDownloadBtn.remove();
    }
    
    progressBar.style.width = '0%';
    progressText.textContent = '准备开始...';
    progressNumbers.textContent = '0/0';
    currentPhase.innerHTML = '<i class="fas fa-globe"></i> 正在获取网页内容...';

    try {
        // 使用多个CORS代理服务，如果一个失败就尝试下一个
        const proxyUrls = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            `https://cors-anywhere.herokuapp.com/${url}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
        ];

        let html = null;
        let error = null;

        for (const proxyUrl of proxyUrls) {
            try {
                const response = await fetch(proxyUrl);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                html = await response.text();
                break; // 如果成功获取到内容，跳出循环
            } catch (e) {
                error = e;
                continue; // 如果失败，继续尝试下一个代理
            }
        }

        if (!html) {
            throw new Error('无法获取网页内容，请稍后重试。' + (error ? `\n详细错误: ${error.message}` : ''));
        }
        
        currentPhase.innerHTML = '<i class="fas fa-search"></i> 正在分析网页内容...';
        
        // 创建一个临时的DOM元素来解析HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // 获取所有可能包含图片的元素
        const images = [
            ...Array.from(doc.getElementsByTagName('img')), // 标准图片标签
            ...Array.from(doc.querySelectorAll('[data-src]')), // 懒加载图片
            ...Array.from(doc.querySelectorAll('[data-original]')), // 一些网站使用data-original
            ...Array.from(doc.querySelectorAll('[style*="background-image"]')), // 背景图片
            ...Array.from(doc.querySelectorAll('[data-bg]')), // 一些网站使用data-bg
            ...Array.from(doc.querySelectorAll('[data-background]')) // 一些网站使用data-background
        ];
        
        // 过滤和处理图片URL
        let imageUrls = new Set(); // 使用Set去重
        
        images.forEach(img => {
            // 检查所有可能的图片属性
            const possibleSources = [
                img.src,
                img.getAttribute('data-src'),
                img.getAttribute('data-original'),
                img.getAttribute('data-bg'),
                img.getAttribute('data-background'),
                img.getAttribute('data-image')
            ];

            // 检查src属性
            possibleSources.forEach(src => {
                if (src) {
                    try {
                        const absoluteUrl = new URL(src, url).href;
                        if (absoluteUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i)) {
                            imageUrls.add(absoluteUrl);
                        }
                    } catch (e) {}
                }
            });
            
            // 检查背景图片
            const style = img.getAttribute('style');
            if (style) {
                const matches = style.match(/background-image:\s*url\(['"]?([^'"()]+)['"]?\)/g);
                if (matches) {
                    matches.forEach(match => {
                        const url_match = match.match(/url\(['"]?([^'"()]+)['"]?\)/);
                        if (url_match) {
                            try {
                                const absoluteUrl = new URL(url_match[1], url).href;
                                if (absoluteUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i)) {
                                    imageUrls.add(absoluteUrl);
                                }
                            } catch (e) {}
                        }
                    });
                }
            }
        });

        imageUrls = Array.from(imageUrls); // 转换回数组

        if (imageUrls.length === 0) {
            imageGrid.innerHTML = '<p class="text-center">未找到任何图片</p>';
            loading.style.display = 'none';
            return;
        }

        // 添加选择控制按钮
        const selectionControls = document.createElement('div');
        selectionControls.className = 'selection-controls';
        selectionControls.innerHTML = `
            <button type="button" class="btn-select-all" data-action="select-all">
                <i class="fas fa-check-square"></i> 全选
            </button>
            <button type="button" class="btn-select-all" data-action="deselect-all">
                <i class="fas fa-square"></i> 取消全选
            </button>
            <span class="selection-info">已选择: 0/${imageUrls.length} 张图片</span>
        `;
        const resultContainer = document.querySelector('.result-container');
        resultContainer.insertBefore(selectionControls, resultContainer.firstChild);

        // 选择状态管理
        const selectedImages = new Set();
        const updateSelectionInfo = () => {
            const info = selectionControls.querySelector('.selection-info');
            info.textContent = `已选择: ${selectedImages.size}/${imageUrls.length} 张图片`;
            
            // 更新下载按钮状态
            const downloadBtn = document.querySelector('.btn-success');
            if (downloadBtn) {
                downloadBtn.innerHTML = `<i class="fas fa-download"></i> 下载已选图片 (${selectedImages.size}张)`;
                downloadBtn.disabled = selectedImages.size === 0;
                downloadBtn.style.opacity = selectedImages.size === 0 ? '0.5' : '1';
            }
        };

        // 全选/取消全选功能
        selectionControls.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;

            const action = button.dataset.action;
            const checkboxes = imageGrid.querySelectorAll('.image-checkbox');
            const images = imageGrid.querySelectorAll('.image-item');

            selectedImages.clear(); // 清除之前的选择
            checkboxes.forEach((checkbox, index) => {
                if (index < imageUrls.length) { // 只处理成功加载的图片
                    checkbox.checked = action === 'select-all';
                    images[index].classList.toggle('image-selected', action === 'select-all');
                    if (action === 'select-all') {
                        selectedImages.add(imageUrls[index]);
                    }
                }
            });

            updateSelectionInfo();
        });

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

        const loadPromises = imageUrls.map((imageUrl, index) => {
            return new Promise((resolve, reject) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'image-wrapper';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'image-checkbox';
                checkbox.addEventListener('change', () => {
                    const img = wrapper.querySelector('.image-item');
                    if (checkbox.checked) {
                        selectedImages.add(imageUrl);
                        img.classList.add('image-selected');
                    } else {
                        selectedImages.delete(imageUrl);
                        img.classList.remove('image-selected');
                    }
                    updateSelectionInfo();
                });

                const img = document.createElement('img');
                img.src = imageUrl;
                img.className = 'image-item';
                img.addEventListener('load', () => {
                    wrapper.appendChild(checkbox);
                    wrapper.appendChild(img);
                    imageGrid.appendChild(wrapper);
                    img.addEventListener('click', (e) => {
                        if (e.target === img) {
                            checkbox.checked = !checkbox.checked;
                            checkbox.dispatchEvent(new Event('change'));
                        }
                    });
                    successCount++;
                    updateProgress();
                    resolve(imageUrl);
                });
                img.addEventListener('error', () => {
                    updateProgress();
                    resolve(null); // 加载失败返回null
                    wrapper.remove(); // 移除加载失败的图片容器
                });
            });
        });

        const results = await Promise.all(loadPromises);
        const successUrls = results.filter(url => url !== null);

        // 添加下载按钮（放在最前面）
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'btn btn-success';
        downloadBtn.innerHTML = `<i class="fas fa-download"></i> 下载已选图片 (0/${successUrls.length}张)`;
        downloadBtn.disabled = true;
        downloadBtn.style.opacity = '0.5';
        
        // 将下载按钮插入到图片网格之前
        resultContainer.insertBefore(downloadBtn, selectionControls);

        // 更新选择控制按钮的计数
        const info = selectionControls.querySelector('.selection-info');
        info.textContent = `已选择: 0/${successUrls.length} 张图片`;

        // 更新进度显示为实际成功加载的图片数量
        progressBar.style.width = '100%';
        progressText.textContent = '图片加载完成';
        progressNumbers.textContent = `${successUrls.length}/${successUrls.length}`;
        currentPhase.innerHTML = '<i class="fas fa-check-circle"></i> 加载完成';

    } catch (error) {
        imageGrid.innerHTML = `<p class="text-center text-danger">发生错误: ${error.message}</p>`;
        currentPhase.innerHTML = '<i class="fas fa-exclamation-circle"></i> 发生错误';
    } finally {
        loading.style.display = 'none';
    }
}); 