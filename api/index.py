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

def create_response(status_code, headers, body, is_base64=False):
    return {
        'statusCode': status_code,
        'headers': headers,
        'body': body,
        'isBase64Encoded': is_base64
    }

def handler(request, context):
    """Vercel serverless function handler"""
    try:
        # 获取请求方法和路径
        method = request.get('method', 'GET')
        path = request.get('path', '/')
        
        # 通用响应头
        cors_headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
        
        # 处理 OPTIONS 请求
        if method == 'OPTIONS':
            return create_response(200, cors_headers, '')
        
        # 处理 GET 请求
        if method == 'GET':
            response_body = {
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
            headers = {**cors_headers, 'Content-Type': 'application/json'}
            return create_response(200, headers, json.dumps(response_body))
        
        # 处理 POST 请求
        if method == 'POST':
            try:
                # 获取请求体
                body = request.get('body', '')
                if not body:
                    return create_response(
                        400,
                        {**cors_headers, 'Content-Type': 'application/json'},
                        json.dumps({'error': '请求体为空'})
                    )
                
                # 解析 JSON
                if isinstance(body, str):
                    data = json.loads(body)
                else:
                    data = body
                
                # 验证 URL
                url = data.get('url')
                if not url:
                    return create_response(
                        400,
                        {**cors_headers, 'Content-Type': 'application/json'},
                        json.dumps({'error': '请提供有效的URL'})
                    )
                
                # 下载图片
                zip_data, error = download_images(url)
                if error:
                    return create_response(
                        500,
                        {**cors_headers, 'Content-Type': 'application/json'},
                        json.dumps({'error': error})
                    )
                
                # 返回成功响应
                headers = {
                    **cors_headers,
                    'Content-Type': 'application/zip',
                    'Content-Transfer-Encoding': 'base64',
                    'Content-Disposition': 'attachment; filename=images.zip'
                }
                return create_response(200, headers, zip_data, True)
                
            except json.JSONDecodeError:
                return create_response(
                    400,
                    {**cors_headers, 'Content-Type': 'application/json'},
                    json.dumps({'error': '无效的JSON格式'})
                )
            except Exception as e:
                logger.error(f"处理请求时出错: {str(e)}")
                return create_response(
                    500,
                    {**cors_headers, 'Content-Type': 'application/json'},
                    json.dumps({'error': f'服务器错误: {str(e)}'})
                )
        
        # 不支持的请求方法
        return create_response(
            405,
            {**cors_headers, 'Content-Type': 'application/json', 'Allow': 'GET, POST, OPTIONS'},
            json.dumps({'error': f'不支持的请求方法: {method}'})
        )
        
    except Exception as e:
        logger.error(f"处理请求时出错: {str(e)}")
        return create_response(
            500,
            {**cors_headers, 'Content-Type': 'application/json'},
            json.dumps({'error': f'服务器错误: {str(e)}'})