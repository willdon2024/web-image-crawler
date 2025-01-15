import os
import tkinter as tk
from tkinter import ttk, messagebox
from image_crawler import ImageCrawler
import threading
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

class ImageCrawlerGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("图片爬虫")
        # 设置窗口大小和位置
        window_width = 500
        window_height = 200
        screen_width = root.winfo_screenwidth()
        screen_height = root.winfo_screenheight()
        x = (screen_width - window_width) // 2
        y = (screen_height - window_height) // 2
        self.root.geometry(f"{window_width}x{window_height}+{x}+{y}")
        self.root.resizable(False, False)  # 禁止调整窗口大小
        
        # 设置样式
        style = ttk.Style()
        style.configure("TFrame", padding=20)
        style.configure("TButton", padding=5)
        style.configure("TEntry", padding=8)
        style.configure("Heading.TLabel", font=('Helvetica', 12, 'bold'))
        
        # 创建主框架
        main_frame = ttk.Frame(root)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # URL输入框和按钮在同一行
        input_frame = ttk.Frame(main_frame)
        input_frame.pack(fill=tk.X, pady=(0, 15))
        
        self.url_entry = ttk.Entry(input_frame)
        self.url_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 10))
        self.url_entry.insert(0, "请输入网页地址...")
        self.url_entry.bind('<FocusIn>', self._on_entry_click)
        self.url_entry.bind('<FocusOut>', self._on_focus_out)
        self.url_entry.bind('<Return>', lambda e: self.start_crawling())  # 按回车开始下载
        
        self.start_button = ttk.Button(input_frame, text="开始下载", command=self.start_crawling)
        self.start_button.pack(side=tk.RIGHT)
        
        # 进度显示区域
        progress_frame = ttk.Frame(main_frame)
        progress_frame.pack(fill=tk.X, pady=10)
        
        # 进度条
        self.progress = ttk.Progressbar(progress_frame, mode='determinate')
        self.progress.pack(fill=tk.X, pady=(0, 5))
        
        # 状态标签
        self.status_var = tk.StringVar(value="准备就绪")
        self.status_label = ttk.Label(progress_frame, textvariable=self.status_var, anchor=tk.CENTER)
        self.status_label.pack(fill=tk.X)
        
        # 设置默认保存目录
        self.save_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloaded_images")
        if not os.path.exists(self.save_dir):
            os.makedirs(self.save_dir)
    
    def _on_entry_click(self, event):
        """当用户点击输入框时，如果是默认文本就清除"""
        if self.url_entry.get() == "请输入网页地址...":
            self.url_entry.delete(0, tk.END)
            self.url_entry.config(foreground='black')
    
    def _on_focus_out(self, event):
        """当输入框失去焦点时，如果为空则显示默认文本"""
        if not self.url_entry.get():
            self.url_entry.insert(0, "请输入网页地址...")
            self.url_entry.config(foreground='gray')
    
    def update_progress(self, current, total):
        """更新进度条和状态文本"""
        progress = int((current / total) * 100)
        self.progress['value'] = progress
        self.status_var.set(f"正在下载: {current}/{total} ({progress}%)")
        self.root.update_idletasks()
    
    def start_crawling(self):
        url = self.url_entry.get().strip()
        if not url or url == "请输入网页地址...":
            messagebox.showerror("错误", "请输入网页地址")
            return
        
        self.start_button['state'] = 'disabled'
        self.progress['value'] = 0
        self.status_var.set("正在分析网页...")
        
        # 创建自定义的ImageCrawler类来更新进度
        class CustomImageCrawler(ImageCrawler):
            def __init__(self, gui, save_dir):
                super().__init__(save_dir)
                self.gui = gui
            
            def crawl(self, url):
                if not self._is_valid_url(url):
                    self.gui.status_var.set("无效的网址!")
                    return

                try:
                    response = requests.get(url, headers=self.headers)
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
                        self.gui.status_var.set("未找到任何图片")
                        return
                        
                    self.gui.status_var.set(f"找到 {total_images} 张图片")
                    
                    successful_downloads = 0
                    for i, img_url in enumerate(img_urls):
                        self.gui.update_progress(i + 1, total_images)
                        ext = self._get_file_extension(img_url)
                        filename = os.path.join(self.save_dir, f'image_{i}{ext}')
                        
                        if self._download_image(img_url, filename):
                            successful_downloads += 1
                    
                    final_message = f"完成! 成功下载 {successful_downloads} 张图片"
                    self.gui.status_var.set(final_message)
                    messagebox.showinfo("下载完成", f"{final_message}\n保存在: {os.path.abspath(self.save_dir)}")

                except Exception as e:
                    self.gui.status_var.set(f"发生错误: {str(e)}")
                    messagebox.showerror("错误", str(e))
                
                finally:
                    self.gui.start_button['state'] = 'normal'
        
        # 在新线程中运行下载任务
        crawler = CustomImageCrawler(self, self.save_dir)
        thread = threading.Thread(target=crawler.crawl, args=(url,))
        thread.daemon = True
        thread.start()

def main():
    root = tk.Tk()
    app = ImageCrawlerGUI(root)
    root.mainloop()

if __name__ == "__main__":
    main() 