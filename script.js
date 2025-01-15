document.getElementById('crawlForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const url = document.getElementById('url').value;
    const loading = document.querySelector('.loading');
    const imageGrid = document.getElementById('imageGrid');
    
    // 显示加载动画
    loading.style.display = 'block';
    imageGrid.innerHTML = '';

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

        // 显示图片
        imageUrls.forEach(imageUrl => {
            const img = document.createElement('img');
            img.src = imageUrl;
            img.className = 'image-item';
            img.addEventListener('click', () => window.open(imageUrl, '_blank'));
            imageGrid.appendChild(img);
        });

        if (imageUrls.length === 0) {
            imageGrid.innerHTML = '<p class="text-center">未找到任何图片</p>';
        }
    } catch (error) {
        imageGrid.innerHTML = `<p class="text-center text-danger">发生错误: ${error.message}</p>`;
    } finally {
        loading.style.display = 'none';
    }
}); 