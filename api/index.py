from http.server import BaseHTTPRequestHandler
import json
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import base64
import io
import zipfile

def download_images(url):
    try:
        # 设置请求头
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        
        # 获取网页内容
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        # 解析图片URL
        soup = BeautifulSoup(response.text, 'html.parser')
        img_urls = []
        for img in soup.find_all('img'):
            img_url = img.get('src') or img.get('data-src')
            if img_url:
                img_url = urljoin(url, img_url)
                if urlparse(img_url).scheme in ['http', 'https']:
                    img_urls.append(img_url)
        
        if not img_urls:
            return None, "未找到任何图片"
            
        # 下载图片并创建ZIP
        memory_zip = io.BytesIO()
        downloaded_count = 0
        
        with zipfile.ZipFile(memory_zip, 'w') as zf:
            for i, img_url in enumerate(img_urls[:5]):  # 限制最多下载5张图片
                try:
                    img_response = requests.get(img_url, headers=headers, timeout=5)
                    img_response.raise_for_status()
                    ext = os.path.splitext(urlparse(img_url).path)[1] or '.jpg'
                    zf.writestr(f'image_{i}{ext}', img_response.content)
                    downloaded_count += 1
                except Exception:
                    continue
                    
        if downloaded_count == 0:
            return None, "所有图片下载失败"
            
        memory_zip.seek(0)
        return base64.b64encode(memory_zip.getvalue()).decode('utf-8'), None
        
    except Exception as e:
        return None, str(e)

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '86400')
        self.end_headers()
        
    def do_POST(self):
        try:
            # 读取请求体
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            # 验证URL
            url = data.get('url')
            if not url:
                self._send_json_response(400, {'error': '请提供有效的URL'})
                return
                
            # 下载图片
            zip_data, error = download_images(url)
            if error:
                self._send_json_response(500, {'error': error})
                return
                
            # 发送成功响应
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Transfer-Encoding', 'base64')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Disposition', 'attachment; filename=images.zip')
            self.end_headers()
            self.wfile.write(zip_data.encode('utf-8'))
            
        except json.JSONDecodeError:
            self._send_json_response(400, {'error': '无效的JSON格式'})
        except Exception as e:
            self._send_json_response(500, {'error': f'服务器错误: {str(e)}'})
            
    def _send_json_response(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8')) 