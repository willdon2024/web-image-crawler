from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import os
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import threading
import time
import zipfile
import io
import uuid
import tempfile
import sys
import traceback

app = Flask(__name__)
CORS(app)

# 使用临时目录存储下载的文件
TEMP_DIR = '/tmp'

@app.route('/api/test', methods=['GET'])
def test():
    """测试路由"""
    return jsonify({'status': 'ok', 'message': 'API is working'})

class WebImageCrawler:
    def __init__(self, session_id):
        """初始化爬虫"""
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        self.session_id = session_id
        self.save_dir = os.path.join(TEMP_DIR, session_id)
        self.status = {
            'state': 'ready',
            'progress': 0,
            'total_images': 0,
            'downloaded': 0,
            'message': '准备就绪'
        }
        try:
            os.makedirs(self.save_dir, exist_ok=True)
        except Exception as e:
            print(f"Error creating directory: {str(e)}", file=sys.stderr)
            self.status['state'] = 'error'
            self.status['message'] = f'创建目录失败: {str(e)}'

    def _is_valid_url(self, url):
        """检查URL是否有效"""
        try:
            result = urlparse(url)
            return all([result.scheme, result.netloc])
        except Exception as e:
            print(f"Error validating URL: {str(e)}", file=sys.stderr)
            return False

    def _get_file_extension(self, url):
        """获取图片文件扩展名"""
        try:
            parsed = urlparse(url)
            ext = os.path.splitext(parsed.path)[1]
            return ext.lower() if ext else '.jpg'
        except Exception as e:
            print(f"Error getting file extension: {str(e)}", file=sys.stderr)
            return '.jpg'

    def _download_image(self, img_url, filename):
        """下载单个图片"""
        try:
            response = requests.get(img_url, headers=self.headers, stream=True, timeout=10)
            if response.status_code == 200:
                with open(filename, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=1024):
                        if chunk:
                            f.write(chunk)
                return True
            print(f"Failed to download image: {img_url}, status code: {response.status_code}", file=sys.stderr)
            return False
        except Exception as e:
            print(f"Error downloading image: {str(e)}", file=sys.stderr)
            return False

    def crawl(self, url):
        """爬取指定网页上的所有图片"""
        try:
            if not self._is_valid_url(url):
                self.status = {
                    'state': 'error',
                    'message': '无效的URL!'
                }
                return

            self.status = {
                'state': 'running',
                'progress': 0,
                'message': '正在分析网页...'
            }

            response = requests.get(url, headers=self.headers, timeout=10)
            soup = BeautifulSoup(response.text, 'html.parser')
            
            img_tags = soup.find_all('img')
            img_urls = []
            
            for img in img_tags:
                img_url = img.get('src') or img.get('data-src')
                if img_url:
                    img_url = urljoin(url, img_url)
                    if self._is_valid_url(img_url):
                        img_urls.append(img_url)

            total_images = len(img_urls)
            if total_images == 0:
                self.status = {
                    'state': 'completed',
                    'message': '未找到任何图片'
                }
                return

            self.status.update({
                'total_images': total_images,
                'downloaded': 0,
                'message': f'找到 {total_images} 张图片'
            })

            for i, img_url in enumerate(img_urls):
                ext = self._get_file_extension(img_url)
                filename = os.path.join(self.save_dir, f'image_{i}{ext}')
                
                if self._download_image(img_url, filename):
                    self.status['downloaded'] += 1
                
                self.status.update({
                    'progress': int((i + 1) / total_images * 100),
                    'message': f'正在下载: {i + 1}/{total_images}'
                })

            self.status.update({
                'state': 'completed',
                'progress': 100,
                'message': f'完成! 成功下载 {self.status["downloaded"]} 张图片'
            })

        except Exception as e:
            print(f"Error in crawl: {str(e)}\n{traceback.format_exc()}", file=sys.stderr)
            self.status = {
                'state': 'error',
                'message': f'发生错误: {str(e)}'
            }

# 存储所有爬虫实例
crawlers = {}

@app.route('/api/crawl', methods=['POST'])
def start_crawl():
    """开始爬取图片"""
    try:
        url = request.json.get('url')
        if not url:
            return jsonify({'error': '请提供URL'}), 400

        # 创建新的会话ID
        session_id = str(uuid.uuid4())
        crawler = WebImageCrawler(session_id)
        crawlers[session_id] = crawler

        # 在新线程中运行爬虫
        thread = threading.Thread(target=crawler.crawl, args=(url,))
        thread.daemon = True
        thread.start()

        return jsonify({
            'session_id': session_id,
            'message': '开始下载'
        })
    except Exception as e:
        print(f"Error in start_crawl: {str(e)}\n{traceback.format_exc()}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

@app.route('/api/status/<session_id>')
def get_status(session_id):
    """获取下载状态"""
    try:
        crawler = crawlers.get(session_id)
        if not crawler:
            return jsonify({'error': '会话不存在'}), 404
        return jsonify(crawler.status)
    except Exception as e:
        print(f"Error in get_status: {str(e)}\n{traceback.format_exc()}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

@app.route('/api/download/<session_id>')
def download_images(session_id):
    """下载打包的图片"""
    try:
        crawler = crawlers.get(session_id)
        if not crawler or crawler.status['state'] != 'completed':
            return jsonify({'error': '图片未准备好'}), 400

        # 创建内存中的ZIP文件
        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w') as zf:
            for root, dirs, files in os.walk(crawler.save_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, crawler.save_dir)
                    zf.write(file_path, arcname)

        # 清理文件
        try:
            for root, dirs, files in os.walk(crawler.save_dir):
                for file in files:
                    os.remove(os.path.join(root, file))
            os.rmdir(crawler.save_dir)
        except Exception as e:
            print(f"Error cleaning up files: {str(e)}", file=sys.stderr)

        del crawlers[session_id]

        memory_file.seek(0)
        return send_file(
            memory_file,
            mimetype='application/zip',
            as_attachment=True,
            download_name='images.zip'
        )
    except Exception as e:
        print(f"Error in download_images: {str(e)}\n{traceback.format_exc()}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

# Vercel 需要的处理函数
def handler(event, context):
    return app(event, context) 