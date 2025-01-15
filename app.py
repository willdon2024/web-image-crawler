from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import os
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import io
import zipfile
import json

app = Flask(__name__)
CORS(app)

def create_app():
    return app

@app.route('/', methods=['GET'])
def home():
    return jsonify({"status": "ok", "message": "API is working"})

@app.route('/api/crawl', methods=['POST'])
def crawl():
    try:
        data = request.get_json()
        if not data or 'url' not in data:
            return jsonify({'error': '请提供URL'}), 400

        url = data['url']
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }

        # 直接爬取图片
        response = requests.get(url, headers=headers, timeout=10)
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
        with zipfile.ZipFile(memory_zip, 'w') as zf:
            for i, img_url in enumerate(img_urls[:10]):  # 限制最多下载10张图片
                try:
                    img_response = requests.get(img_url, headers=headers, timeout=5)
                    if img_response.status_code == 200:
                        ext = os.path.splitext(urlparse(img_url).path)[1] or '.jpg'
                        zf.writestr(f'image_{i}{ext}', img_response.content)
                except Exception as e:
                    print(f"Error downloading image {img_url}: {str(e)}")
                    continue

        memory_zip.seek(0)
        
        return send_file(
            memory_zip,
            mimetype='application/zip',
            as_attachment=True,
            download_name='images.zip'
        )

    except Exception as e:
        print(f"Error in crawl: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

def handler(event, context):
    """Handle Vercel serverless function invocation"""
    return create_app() 