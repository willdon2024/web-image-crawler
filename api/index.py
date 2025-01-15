from http.server import BaseHTTPRequestHandler
import json
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import base64
import io
import zipfile
import os

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