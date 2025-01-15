from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import os
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import io
import zipfile
import json
import traceback
import logging
import sys

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

@app.route('/', methods=['GET'])
def home():
    logger.info("Received request to home endpoint")
    return jsonify({"status": "ok", "message": "API is working"})

@app.route('/api/crawl', methods=['POST', 'OPTIONS'])
def crawl():
    logger.info(f"Received {request.method} request to /api/crawl")
    
    # 处理 OPTIONS 请求
    if request.method == 'OPTIONS':
        logger.info("Handling OPTIONS request")
        response = app.make_default_options_response()
        response.headers.update({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
        })
        return response

    try:
        # 获取并验证请求数据
        logger.info("Validating request data")
        if not request.is_json:
            logger.error("Request is not JSON")
            return jsonify({'error': '请求必须是JSON格式'}), 400
        
        data = request.get_json()
        logger.info(f"Received data: {data}")
        
        if not data or not isinstance(data, dict):
            logger.error("Invalid request data")
            return jsonify({'error': '无效的请求数据'}), 400
        
        url = data.get('url')
        if not url or not isinstance(url, str):
            logger.error("Invalid URL")
            return jsonify({'error': '请提供有效的URL'}), 400

        # 验证URL格式
        try:
            parsed_url = urlparse(url)
            if not all([parsed_url.scheme, parsed_url.netloc]):
                logger.error(f"Invalid URL format: {url}")
                return jsonify({'error': '无效的URL格式'}), 400
        except Exception as e:
            logger.error(f"URL parsing error: {str(e)}")
            return jsonify({'error': f'URL解析错误: {str(e)}'}), 400

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }

        # 获取网页内容
        try:
            logger.info(f"Fetching webpage: {url}")
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            logger.info("Successfully fetched webpage")
        except requests.RequestException as e:
            logger.error(f"Failed to fetch webpage: {str(e)}")
            return jsonify({'error': f'获取网页失败: {str(e)}'}), 400

        # 解析图片URL
        logger.info("Parsing webpage for images")
        soup = BeautifulSoup(response.text, 'html.parser')
        img_urls = []
        for img in soup.find_all('img'):
            img_url = img.get('src') or img.get('data-src')
            if img_url:
                img_url = urljoin(url, img_url)
                if urlparse(img_url).scheme in ['http', 'https']:
                    img_urls.append(img_url)

        logger.info(f"Found {len(img_urls)} images")
        if not img_urls:
            logger.warning("No images found")
            return jsonify({
                'status': 'error',
                'message': '未找到任何图片'
            }), 404

        # 下载图片并创建ZIP
        logger.info("Creating ZIP file")
        memory_zip = io.BytesIO()
        downloaded_count = 0
        with zipfile.ZipFile(memory_zip, 'w') as zf:
            for i, img_url in enumerate(img_urls[:10]):  # 限制最多下载10张图片
                try:
                    logger.info(f"Downloading image {i+1}/10: {img_url}")
                    img_response = requests.get(img_url, headers=headers, timeout=5)
                    img_response.raise_for_status()
                    ext = os.path.splitext(urlparse(img_url).path)[1] or '.jpg'
                    zf.writestr(f'image_{i}{ext}', img_response.content)
                    downloaded_count += 1
                    logger.info(f"Successfully downloaded image {i+1}")
                except Exception as e:
                    logger.error(f"Error downloading image {img_url}: {str(e)}")
                    continue

        if downloaded_count == 0:
            logger.error("All image downloads failed")
            return jsonify({
                'status': 'error',
                'message': '所有图片下载失败'
            }), 500

        logger.info(f"Successfully downloaded {downloaded_count} images")
        memory_zip.seek(0)
        
        logger.info("Preparing response")
        response = send_file(
            memory_zip,
            mimetype='application/zip',
            as_attachment=True,
            download_name='images.zip'
        )
        response.headers.update({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        })
        logger.info("Sending response")
        return response

    except Exception as e:
        logger.error(f"Error in crawl: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            'status': 'error',
            'message': f'服务器错误: {str(e)}'
        }), 500

def handler(event, context):
    """Handle Vercel serverless function invocation"""
    logger.info("Received serverless function invocation")
    logger.info(f"Event: {event}")
    
    if not event:
        logger.error("No event data")
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'Invalid request'})
        }

    # 从事件中获取请求信息
    path = event.get('path', '/')
    http_method = event.get('httpMethod', 'GET')
    headers = event.get('headers', {})
    body = event.get('body', '')

    logger.info(f"Method: {http_method}, Path: {path}")

    # 处理 OPTIONS 请求
    if http_method == 'OPTIONS':
        logger.info("Handling OPTIONS request")
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

    # 如果是 POST 请求，确保 body 是 JSON 格式
    if http_method == 'POST' and body:
        try:
            if isinstance(body, str):
                body = json.loads(body)
                logger.info("Successfully parsed JSON body")
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON: {str(e)}")
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Invalid JSON'})
            }

    # 创建请求环境
    logger.info("Creating WSGI environment")
    environ = {
        'REQUEST_METHOD': http_method,
        'PATH_INFO': path,
        'QUERY_STRING': '',
        'CONTENT_LENGTH': str(len(json.dumps(body)) if body else ''),
        'CONTENT_TYPE': 'application/json',
        'wsgi.url_scheme': 'https',
        'wsgi.input': io.StringIO(json.dumps(body) if body else ''),
        'wsgi.errors': io.StringIO(),
        'wsgi.multithread': False,
        'wsgi.multiprocess': False,
        'wsgi.run_once': False,
        'SERVER_NAME': 'vercel',
        'SERVER_PORT': '443',
        'SERVER_PROTOCOL': 'HTTP/1.1',
        'HTTP_ORIGIN': headers.get('origin', '*')
    }

    # 添加请求头
    for key, value in headers.items():
        key = key.upper().replace('-', '_')
        if key not in ('CONTENT_TYPE', 'CONTENT_LENGTH'):
            environ[f'HTTP_{key}'] = value

    # 处理请求
    logger.info("Processing request")
    response_data = []
    def start_response(status, response_headers, exc_info=None):
        response_data.append({
            'status': status,
            'headers': response_headers
        })

    try:
        logger.info("Calling WSGI application")
        response_body = b''.join(app.wsgi_app(environ, start_response))
        response = response_data[0]
        
        # 处理响应
        status_code = int(response['status'].split()[0])
        headers = dict(response['headers'])
        
        # 添加 CORS 头
        headers.update({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        })
        
        # 如果是文件下载响应
        if headers.get('Content-Type') == 'application/zip':
            try:
                logger.info("Encoding ZIP file as base64")
                import base64
                body = base64.b64encode(response_body).decode('utf-8')
                headers['Content-Transfer-Encoding'] = 'base64'
                is_base64 = True
                logger.info("Successfully encoded ZIP file")
            except Exception as e:
                logger.error(f"Error encoding file: {str(e)}")
                return {
                    'statusCode': 500,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'error': f'Error encoding file: {str(e)}'})
                }
        else:
            try:
                logger.info("Decoding response body")
                body = response_body.decode('utf-8')
                is_base64 = False
            except Exception as e:
                logger.error(f"Error decoding response: {str(e)}")
                return {
                    'statusCode': 500,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'error': f'Error decoding response: {str(e)}'})
                }

        logger.info(f"Returning response with status code {status_code}")
        return {
            'statusCode': status_code,
            'headers': headers,
            'body': body,
            'isBase64Encoded': is_base64
        }
    except Exception as e:
        logger.error(f"Error in handler: {str(e)}")
        logger.error(traceback.format_exc())
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': f'Server error: {str(e)}'})
        } 