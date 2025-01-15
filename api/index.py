from http.server import BaseHTTPRequestHandler
import json
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
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
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59'
]

def get_random_headers():
    """生成随机请求头"""
    return {
        'User-Agent': random.choice(USER_AGENTS),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'TE': 'Trailers'
    }

def download_images(url):
    try:
        logger.info(f"开始处理URL: {url}")
        
        # 获取网页内容
        headers = get_random_headers()
        logger.info(f"使用请求头: {headers}")
        
        session = requests.Session()
        session.headers.update(headers)
        
        # 首先尝试获取网页
        try:
            response = session.get(url, timeout=10, allow_redirects=True)
            response.raise_for_status()
            logger.info(f"成功获取网页，状态码: {response.status_code}")
        except requests.RequestException as e:
            logger.error(f"获取网页失败: {str(e)}")
            return None, f"获取网页失败: {str(e)}"
        
        # 解析图片URL
        soup = BeautifulSoup(response.text, 'html.parser')
        img_urls = set()  # 使用集合去重
        
        # 查找所有可能包含图片的标签和属性
        img_patterns = [
            ('img', 'src'),
            ('img', 'data-src'),
            ('img', 'data-original'),
            ('div', 'data-background'),
            ('a', 'href')
        ]
        
        for tag, attr in img_patterns:
            for element in soup.find_all(tag):
                img_url = element.get(attr)
                if img_url and any(ext in img_url.lower() for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']):
                    img_url = urljoin(url, img_url)
                    if urlparse(img_url).scheme in ['http', 'https']:
                        img_urls.add(img_url)
        
        logger.info(f"找到 {len(img_urls)} 个图片URL")
        
        if not img_urls:
            logger.warning("未找到任何图片URL")
            return None, "未找到任何图片"
            
        # 下载图片并创建ZIP
        memory_zip = io.BytesIO()
        downloaded_count = 0
        
        with zipfile.ZipFile(memory_zip, 'w') as zf:
            for i, img_url in enumerate(list(img_urls)[:10]):  # 限制最多下载10张图片
                try:
                    logger.info(f"正在下载图片 {i+1}/10: {img_url}")
                    # 添加随机延迟
                    time.sleep(random.uniform(0.5, 1.5))
                    
                    img_response = session.get(img_url, timeout=5)
                    img_response.raise_for_status()
                    
                    # 验证内容类型
                    content_type = img_response.headers.get('content-type', '')
                    if not content_type.startswith('image/'):
                        logger.warning(f"跳过非图片内容: {content_type}")
                        continue
                    
                    # 获取文件扩展名
                    ext = os.path.splitext(urlparse(img_url).path)[1]
                    if not ext:
                        ext = '.jpg'  # 默认扩展名
                    
                    # 保存图片
                    zf.writestr(f'image_{i+1}{ext}', img_response.content)
                    downloaded_count += 1
                    logger.info(f"成功下载图片 {i+1}")
                    
                except Exception as e:
                    logger.error(f"下载图片失败 {img_url}: {str(e)}")
                    continue
                    
        if downloaded_count == 0:
            logger.error("所有图片下载失败")
            return None, "所有图片下载失败"
            
        logger.info(f"成功下载 {downloaded_count} 张图片")
        memory_zip.seek(0)
        return base64.b64encode(memory_zip.getvalue()).decode('utf-8'), None
        
    except Exception as e:
        logger.error(f"处理过程中出错: {str(e)}")
        return None, str(e)

def handle_request(event):
    # 获取请求方法
    method = event.get('httpMethod', 'GET')
    
    # 处理 OPTIONS 请求
    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400'
            },
            'body': ''
        }
    
    # 处理 GET 请求
    if method == 'GET':
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'status': 'ok',
                'message': '图片下载 API 服务正常',
                'usage': {
                    'method': 'POST',
                    'endpoint': '/api/crawl',
                    'body': {
                        'url': '要抓取的网页地址'
                    },
                    'response': {
                        'success': '返回 ZIP 文件（base64编码）',
                        'error': '返回错误信息'
                    }
                }
            })
        }
    
    # 处理 POST 请求
    if method == 'POST':
        try:
            # 获取请求体
            body = event.get('body', '')
            if isinstance(body, str):
                data = json.loads(body)
            else:
                data = body
                
            # 验证URL
            url = data.get('url')
            if not url:
                return {
                    'statusCode': 400,
                    'headers': {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    'body': json.dumps({'error': '请提供有效的URL'})
                }
                
            # 下载图片
            zip_data, error = download_images(url)
            if error:
                return {
                    'statusCode': 500,
                    'headers': {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    'body': json.dumps({'error': error})
                }
                
            # 返回成功响应
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/zip',
                    'Content-Transfer-Encoding': 'base64',
                    'Access-Control-Allow-Origin': '*',
                    'Content-Disposition': 'attachment; filename=images.zip'
                },
                'body': zip_data,
                'isBase64Encoded': True
            }
                
        except json.JSONDecodeError:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({'error': '无效的JSON格式'})
            }
        except Exception as e:
            logger.error(f"处理请求时出错: {str(e)}")
            return {
                'statusCode': 500,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({'error': f'服务器错误: {str(e)}'})
            }
    
    # 不支持的请求方法
    return {
        'statusCode': 405,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Allow': 'GET, POST, OPTIONS'
        },
        'body': json.dumps({'error': f'不支持的请求方法: {method}'})
    }

def handler(event, context):
    """Vercel serverless function handler"""
    return handle_request(event) 