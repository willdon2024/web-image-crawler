import os
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from tqdm import tqdm
import time

class ImageCrawler:
    def __init__(self, save_dir='downloaded_images'):
        """初始化图片爬虫"""
        self.save_dir = save_dir
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        self._create_save_dir()

    def _create_save_dir(self):
        """创建保存图片的目录"""
        if not os.path.exists(self.save_dir):
            os.makedirs(self.save_dir)

    def _is_valid_url(self, url):
        """检查URL是否有效"""
        try:
            result = urlparse(url)
            return all([result.scheme, result.netloc])
        except:
            return False

    def _get_file_extension(self, url):
        """获取图片文件扩展名"""
        parsed = urlparse(url)
        ext = os.path.splitext(parsed.path)[1]
        return ext.lower() if ext else '.jpg'

    def _download_image(self, img_url, filename):
        """下载单个图片"""
        try:
            response = requests.get(img_url, headers=self.headers, stream=True)
            if response.status_code == 200:
                with open(filename, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=1024):
                        if chunk:
                            f.write(chunk)
                return True
            return False
        except Exception as e:
            print(f"下载图片失败: {str(e)}")
            return False

    def crawl(self, url, min_size=0):
        """
        爬取指定网页上的所有图片
        :param url: 网页URL
        :param min_size: 最小图片大小（KB），0表示不限制
        """
        if not self._is_valid_url(url):
            print("无效的URL!")
            return

        try:
            # 获取网页内容
            print(f"正在访问网页: {url}")
            response = requests.get(url, headers=self.headers)
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # 查找所有图片标签
            img_tags = soup.find_all('img')
            img_urls = []
            
            # 收集图片URL
            for img in img_tags:
                img_url = img.get('src') or img.get('data-src')
                if img_url:
                    img_url = urljoin(url, img_url)
                    if self._is_valid_url(img_url):
                        img_urls.append(img_url)

            print(f"找到 {len(img_urls)} 张图片")
            
            # 下载图片
            successful_downloads = 0
            for i, img_url in enumerate(tqdm(img_urls, desc="下载进度")):
                ext = self._get_file_extension(img_url)
                filename = os.path.join(self.save_dir, f'image_{i}{ext}')
                
                if self._download_image(img_url, filename):
                    # 检查文件大小
                    file_size = os.path.getsize(filename) / 1024  # 转换为KB
                    if min_size > 0 and file_size < min_size:
                        os.remove(filename)
                        continue
                    
                    successful_downloads += 1
                time.sleep(0.1)  # 添加延迟，避免请求过快

            print(f"\n下载完成! 成功下载 {successful_downloads} 张图片")
            print(f"图片保存在: {os.path.abspath(self.save_dir)}")

        except Exception as e:
            print(f"发生错误: {str(e)}")

def main():
    # 使用示例
    url = input("请输入要爬取的网页URL: ")
    min_size = input("请输入最小图片大小(KB)，直接回车表示不限制: ")
    
    try:
        min_size = int(min_size) if min_size.strip() else 0
    except ValueError:
        min_size = 0
        
    crawler = ImageCrawler()
    crawler.crawl(url, min_size)

if __name__ == "__main__":
    main() 