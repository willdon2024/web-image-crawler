from http.server import BaseHTTPRequestHandler
from urllib.parse import urljoin, urlparse
import json
import requests
from bs4 import BeautifulSoup
import base64
import io
import zipfile
import os
import random
import logging
import time

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 随机User-Agent列表
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0'
]

def get_random_headers():
    return {
        'User-Agent': random.choice(USER_AGENTS),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
    }

def download_images(url):
    try:
        logger.info(f"开始处理URL: {url}")
        headers = get_random_headers()
        session = requests.Session()
        session.headers.update(headers)
        
        response = session.get(url, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        img_urls = set()
        
        for img in soup.find_all('img'):
            img_url = img.get('src') or img.get('data-src')
            if img_url:
                img_url = urljoin(url, img_url)
                if urlparse(img_url).scheme in ['http', 'https']:
                    img_urls.add(img_url)
        
        if not img_urls:
            return None, "未找到任何图片"
            
        memory_zip = io.BytesIO()
        downloaded_count = 0
        
        with zipfile.ZipFile(memory_zip, 'w') as zf:
            for i, img_url in enumerate(list(img_urls)[:10]):
                try:
                    img_response = session.get(img_url, timeout=5)
                    img_response.raise_for_status()
                    ext = os.path.splitext(urlparse(img_url).path)[1] or '.jpg'
                    zf.writestr(f'image_{i+1}{ext}', img_response.content)
                    downloaded_count += 1
                except Exception as e:
                    logger.error(f"下载图片失败 {img_url}: {str(e)}")
                    continue
                    
        if downloaded_count == 0:
            return None, "所有图片下载失败"
            
        memory_zip.seek(0)
        return base64.b64encode(memory_zip.getvalue()).decode('utf-8'), None
        
    except Exception as e:
        return None, str(e)

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        response = {
            'status': 'ok',
            'message': '图片下载 API 服务正常',
            'usage': {
                'method': 'POST',
                'endpoint': '/api/crawl',
                'body': {
                    'url': '要抓取的网页地址'
                }
            }
        }
        self.wfile.write(json.dumps(response).encode())
    
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data.decode('utf-8'))
                url = data.get('url')
                
                if not url:
                    self.send_error_response(400, '请提供有效的URL')
                    return
                
                zip_data, error = download_images(url)
                if error:
                    self.send_error_response(500, error)
                    return
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/zip')
                self.send_header('Content-Transfer-Encoding', 'base64')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Disposition', 'attachment; filename=images.zip')
                self.end_headers()
                self.wfile.write(zip_data.encode())
            else:
                self.send_error_response(400, '请求体为空')
                
        except json.JSONDecodeError:
            self.send_error_response(400, '无效的JSON格式')
        except Exception as e:
            self.send_error_response(500, f'服务器错误: {str(e)}')
    
    def send_error_response(self, status_code, message):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({'error': message}).encode())

def handler(event, context):
    return Handler() 