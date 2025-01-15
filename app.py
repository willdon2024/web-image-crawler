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

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

@app.route('/', methods=['GET'])
def home():
    return jsonify({"status": "ok", "message": "API is working"})

@app.route('/api/crawl', methods=['POST', 'OPTIONS'])
def crawl():
    # 处理 OPTIONS 请求
    if request.method == 'OPTIONS':
        response = app.make_default_options_response()
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response

    try:
        # 获取并验证请求数据
        if not request.is_json:
            return jsonify({'error': '请求必须是JSON格式'}), 400
        
        data = request.get_json()
        if not data or not isinstance(data, dict):
            return jsonify({'error': '无效的请求数据'}), 400
        
        url = data.get('url')
        if not url or not isinstance(url, str):
            return jsonify({'error': '请提供有效的URL'}), 400

        # 验证URL格式
        try:
            parsed_url = urlparse(url)
            if not all([parsed_url.scheme, parsed_url.netloc]):
                return jsonify({'error': '无效的URL格式'}), 400
        except Exception as e:
            return jsonify({'error': f'URL解析错误: {str(e)}'}), 400

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }

        # 获取网页内容
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
        except requests.RequestException as e:
            return jsonify({'error': f'获取网页失败: {str(e)}'}), 400

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
            return jsonify({
                'status': 'error',
                'message': '未找到任何图片'
            }), 404

        # 下载图片并创建ZIP
        memory_zip = io.BytesIO()
        downloaded_count = 0
        with zipfile.ZipFile(memory_zip, 'w') as zf:
            for i, img_url in enumerate(img_urls[:10]):  # 限制最多下载10张图片
                try:
                    img_response = requests.get(img_url, headers=headers, timeout=5)
                    img_response.raise_for_status()
                    ext = os.path.splitext(urlparse(img_url).path)[1] or '.jpg'
                    zf.writestr(f'image_{i}{ext}', img_response.content)
                    downloaded_count += 1
                except Exception as e:
                    print(f"Error downloading image {img_url}: {str(e)}")
                    continue

        if downloaded_count == 0:
            return jsonify({
                'status': 'error',
                'message': '所有图片下载失败'
            }), 500

        memory_zip.seek(0)
        response = send_file(
            memory_zip,
            mimetype='application/zip',
            as_attachment=True,
            download_name='images.zip'
        )
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    except Exception as e:
        print(f"Error in crawl: {str(e)}")
        print(traceback.format_exc())
        return jsonify({
            'status': 'error',
            'message': f'服务器错误: {str(e)}'
        }), 500

def handler(event, context):
    """Handle Vercel serverless function invocation"""
    if not event:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'Invalid request'})
        }

    # 从事件中获取请求信息
    path = event.get('path', '/')
    http_method = event.get('httpMethod', 'GET')
    headers = event.get('headers', {})
    body = event.get('body', '')

    # 处理 OPTIONS 请求
    if http_method == 'OPTIONS':
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
        except json.JSONDecodeError:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Invalid JSON'})
            }

    # 创建请求环境
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
    response_data = []
    def start_response(status, response_headers, exc_info=None):
        response_data.append({
            'status': status,
            'headers': response_headers
        })

    try:
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
                import base64
                body = base64.b64encode(response_body).decode('utf-8')
                headers['Content-Transfer-Encoding'] = 'base64'
                is_base64 = True
            except Exception as e:
                return {
                    'statusCode': 500,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'error': f'Error encoding file: {str(e)}'})
                }
        else:
            try:
                body = response_body.decode('utf-8')
                is_base64 = False
            except Exception as e:
                return {
                    'statusCode': 500,
                    'headers': {'Content-Type': 'application/json'},
                    'body': json.dumps({'error': f'Error decoding response: {str(e)}'})
                }

        return {
            'statusCode': status_code,
            'headers': headers,
            'body': body,
            'isBase64Encoded': is_base64
        }
    except Exception as e:
        print(f"Error in handler: {str(e)}")
        print(traceback.format_exc())
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': f'Server error: {str(e)}'})
        } 