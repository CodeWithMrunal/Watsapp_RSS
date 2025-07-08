import os
import re
import json
import time
import hashlib
import threading
import sqlite3
from pathlib import Path
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import TimeoutException, NoSuchElementException
import shutil
from contextlib import contextmanager

class LinkDownloadManager:
    def __init__(self, db_path="backend/database/whatsapp_monitor.sqlite", download_dir="backend/media"):
        # Resolve paths relative to project root
        base_dir = Path(__file__).resolve().parent.parent
        self.db_path = (base_dir / db_path).resolve()
        self.download_dir = (base_dir / download_dir).resolve()
        
        # Make sure download directory exists
        self.download_dir.mkdir(parents=True, exist_ok=True)
        
        # Thread safety
        self.processing_lock = threading.Lock()
        self.is_processing = False
        self.db_lock = threading.Lock()
        
        # Initialize database connection
        self.init_database()
        
        print(f"📁 Download directory: {self.download_dir.absolute()}")
        print(f"🗄️ Database path: {self.db_path.absolute()}")
        
    @contextmanager
    def get_db_connection(self):
        """Thread-safe database connection context manager"""
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()
    
    def init_database(self):
        """Initialize database and add processing columns if they don't exist"""
        with self.db_lock:
            with self.get_db_connection() as conn:
                cursor = conn.cursor()
                
                # Check if processing columns exist, if not add them
                cursor.execute("PRAGMA table_info(urls)")
                columns = [col[1] for col in cursor.fetchall()]
                
                if 'is_processed' not in columns:
                    cursor.execute("""
                        ALTER TABLE urls 
                        ADD COLUMN is_processed TINYINT(1) DEFAULT 0
                    """)
                    
                if 'processed_at' not in columns:
                    cursor.execute("""
                        ALTER TABLE urls 
                        ADD COLUMN processed_at DATETIME
                    """)
                    
                if 'processing_error' not in columns:
                    cursor.execute("""
                        ALTER TABLE urls 
                        ADD COLUMN processing_error TEXT
                    """)
                    
                if 'media_id' not in columns:
                    cursor.execute("""
                        ALTER TABLE urls 
                        ADD COLUMN media_id INTEGER REFERENCES media(id)
                    """)
                
                conn.commit()
                
                # Create index for faster queries
                try:
                    cursor.execute("""
                        CREATE INDEX IF NOT EXISTS idx_urls_processed 
                        ON urls(is_processed, url_type)
                    """)
                    conn.commit()
                except:
                    pass
                
                print("✅ Database initialized with processing columns")
    
    def get_unprocessed_links(self):
        """Get all unprocessed Google Drive and WeTransfer links from database"""
        with self.db_lock:
            with self.get_db_connection() as conn:
                cursor = conn.cursor()
                
                # Get unprocessed links
                cursor.execute("""
                    SELECT u.*, 
                           m.whatsapp_id as message_whatsapp_id,
                           m.author_id,
                           m.timestamp,
                           m.body as message_body,
                           a.name as author_name,
                           a.whatsapp_id as author_whatsapp_id
                    FROM urls u
                    LEFT JOIN message_urls mu ON u.id = mu.url_id
                    LEFT JOIN messages m ON mu.message_id = m.id
                    LEFT JOIN authors a ON m.author_id = a.id
                    WHERE u.is_processed = 0
                    AND (u.domain = 'drive.google.com' 
                         OR u.domain = 'we.tl' 
                         OR u.domain = 'wetransfer.com')
                    ORDER BY u.created_at ASC
                """)
                
                links = []
                for row in cursor.fetchall():
                    link_info = {
                        'id': row['id'],
                        'url': row['url'],
                        'domain': row['domain'],
                        'first_seen': row['first_seen'],
                        'author_id': row['author_id'],
                        'author_name': row['author_name'] or 'Unknown',
                        'author_whatsapp_id': row['author_whatsapp_id'],
                        'timestamp': row['timestamp'] or int(time.time()),
                        'message_body': row['message_body'] or '',
                        'message_whatsapp_id': row['message_whatsapp_id']
                    }
                    links.append(link_info)
                
                return links
    
    def mark_link_processed(self, url_id, media_id=None, error=None):
        """Mark a link as processed in the database"""
        with self.db_lock:
            with self.get_db_connection() as conn:
                cursor = conn.cursor()
                
                if error:
                    cursor.execute("""
                        UPDATE urls 
                        SET is_processed = 1,
                            processed_at = datetime('now'),
                            processing_error = ?
                        WHERE id = ?
                    """, (error, url_id))
                else:
                    cursor.execute("""
                        UPDATE urls 
                        SET is_processed = 1,
                            processed_at = datetime('now'),
                            media_id = ?
                        WHERE id = ?
                    """, (media_id, url_id))
                
                conn.commit()
                
                if error:
                    print(f"❌ Marked link {url_id} as processed with error")
                else:
                    print(f"✅ Marked link {url_id} as processed successfully")
    
    def create_media_entry(self, link_info, file_path):
        """Create a media entry in the database"""
        with self.db_lock:
            with self.get_db_connection() as conn:
                cursor = conn.cursor()
                
                file_path = Path(file_path)
                if not file_path.exists():
                    return None
                
                # Calculate file hash
                file_hash = self.calculate_file_hash(file_path)
                
                # Check if media already exists
                cursor.execute("SELECT id FROM media WHERE file_hash = ?", (file_hash,))
                existing = cursor.fetchone()
                if existing:
                    return existing['id']
                
                # Get file info
                file_stat = file_path.stat()
                file_size = file_stat.st_size
                file_extension = file_path.suffix.lower()
                
                # Determine media type
                video_extensions = {'.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp'}
                image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'}
                
                if file_extension in video_extensions:
                    media_type = "video"
                elif file_extension in image_extensions:
                    media_type = "image"
                else:
                    media_type = "document"
                
                # Human readable file size
                filesize_human = self.format_file_size(file_size)
                
                # Relative path from media directory
                relative_path = file_path.relative_to(self.download_dir.parent)
                
                # Insert media entry
                cursor.execute("""
                    INSERT INTO media (
                        file_hash, filename, original_filename, filepath,
                        filesize, filesize_human, mimetype, media_type,
                        extension, caption, is_processed, file_created_at,
                        file_modified_at, uploaded_at, processing_version,
                        metadata, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                """, (
                    file_hash,
                    file_path.name,
                    file_path.name,
                    str(relative_path),
                    file_size,
                    filesize_human,
                    self.get_mime_type(file_extension),
                    media_type,
                    file_extension,
                    f"Auto-downloaded from: {link_info['url'][:50]}...",
                    1,  # is_processed
                    datetime.fromtimestamp(file_stat.st_ctime),
                    datetime.fromtimestamp(file_stat.st_mtime),
                    datetime.now(),
                    "2.0",  # processing_version
                    json.dumps({
                        "source_url": link_info['url'],
                        "source_domain": link_info['domain'],
                        "downloaded_by": "selenium_scraper"
                    })
                ))
                
                media_id = cursor.lastrowid
                conn.commit()
                
                print(f"📄 Created media entry: {file_path.name} (ID: {media_id})")
                return media_id
    
    def calculate_file_hash(self, file_path):
        """Calculate MD5 hash of a file"""
        hash_md5 = hashlib.md5()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest()
    
    def format_file_size(self, size_bytes):
        """Format file size in human readable format"""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size_bytes < 1024.0:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024.0
        return f"{size_bytes:.1f} PB"
    
    def get_mime_type(self, extension):
        """Get MIME type from file extension"""
        mime_types = {
            '.mp4': 'video/mp4',
            '.avi': 'video/x-msvideo',
            '.mov': 'video/quicktime',
            '.mkv': 'video/x-matroska',
            '.wmv': 'video/x-ms-wmv',
            '.flv': 'video/x-flv',
            '.webm': 'video/webm',
            '.m4v': 'video/x-m4v',
            '.3gp': 'video/3gpp',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.webp': 'image/webp',
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.zip': 'application/zip'
        }
        return mime_types.get(extension.lower(), 'application/octet-stream')
    
    def download_link(self, link_info):
        """Download a single link using the Selenium downloader"""
        url = link_info['url']
        url_id = link_info['id']
        
        print(f"\n⬇️ Downloading: {url}")
        print(f"👤 Author: {link_info['author_name']}")
        print(f"📅 First seen: {link_info['first_seen']}")
        
        # Create a new downloader instance for this download
        downloader = SeleniumVideoDownloader(download_dir=str(self.download_dir), headless=True)
        
        try:
            # Get files before download
            files_before = set(f.name for f in self.download_dir.iterdir() if f.is_file())
            
            # Attempt download
            success = downloader.download(url)
            
            if success:
                # Get files after download
                files_after = set(f.name for f in self.download_dir.iterdir() if f.is_file())
                new_files = files_after - files_before
                
                if new_files:
                    # Process each downloaded file
                    media_ids = []
                    for filename in new_files:
                        file_path = self.download_dir / filename
                        media_id = self.create_media_entry(link_info, file_path)
                        if media_id:
                            media_ids.append(media_id)
                    
                    if media_ids:
                        # Mark link as processed with the first media ID
                        self.mark_link_processed(url_id, media_ids[0])
                        print(f"✅ Downloaded {len(new_files)} file(s): {list(new_files)}")
                        return True
                    else:
                        self.mark_link_processed(url_id, error="Failed to create media entries")
                        return False
                else:
                    print("⚠️ Download reported success but no new files found")
                    self.mark_link_processed(url_id, error="No files downloaded")
                    return False
            else:
                print(f"❌ Failed to download: {url}")
                self.mark_link_processed(url_id, error="Download failed")
                return False
                
        except Exception as e:
            error_msg = f"Error downloading: {str(e)}"
            print(f"❌ {error_msg}")
            self.mark_link_processed(url_id, error=error_msg)
            return False
        finally:
            # Always clean up the downloader
            downloader.cleanup()
    
    def process_new_links(self):
        """Process all new links found in the database"""
        with self.processing_lock:
            if self.is_processing:
                print("⏳ Already processing links, skipping...")
                return
            
            self.is_processing = True
            
        try:
            print(f"\n🔄 Checking for new links at {datetime.now().strftime('%H:%M:%S')}...")
            
            links = self.get_unprocessed_links()
            
            if not links:
                print("ℹ️ No new links to process")
                return
            
            print(f"🆕 Found {len(links)} unprocessed links")
            
            for i, link_info in enumerate(links, 1):
                print(f"\n📥 Processing link {i}/{len(links)}")
                print("-" * 50)
                
                try:
                    self.download_link(link_info)
                    # Small delay between downloads
                    time.sleep(2)
                except Exception as e:
                    print(f"❌ Error processing link: {e}")
                    self.mark_link_processed(link_info['id'], error=str(e))
                    continue
            
            print(f"\n✅ Finished processing {len(links)} links")
            
        finally:
            self.is_processing = False
    
    def cleanup(self):
        """Clean up resources"""
        # Nothing specific to clean up for database connections
        pass


class SeleniumVideoDownloader:
    def __init__(self, download_dir="backend/media", headless=True):
        self.download_dir = Path(download_dir).resolve()
        self.download_dir.mkdir(exist_ok=True)
        self.headless = headless
        self.driver = None
        self.video_extensions = {'.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp'}
        
    def setup_driver(self):
        """Setup Chrome driver with download preferences"""
        chrome_options = Options()
        
        # Set download directory
        prefs = {
            "download.default_directory": str(self.download_dir),
            "download.prompt_for_download": False,
            "download.directory_upgrade": True,
            "safebrowsing.enabled": False,
            "safebrowsing.disable_download_protection": True,
            "profile.default_content_setting_values.notifications": 2,
            "profile.default_content_settings.popups": 0,
            "profile.managed_default_content_settings.images": 2,
        }
        chrome_options.add_experimental_option("prefs", prefs)
        
        # Additional Chrome options
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_argument("--disable-web-security")
        chrome_options.add_argument("--allow-running-insecure-content")
        chrome_options.add_argument("--disable-features=VizDisplayCompositor")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)
        
        if self.headless:
            chrome_options.add_argument("--headless")
        
        # User agent to appear more like a real browser
        chrome_options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        
        try:
            self.driver = webdriver.Chrome(options=chrome_options)
            self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            print("✅ Chrome driver initialized successfully")
            return True
            
        except Exception as e:
            print(f"❌ Error setting up Chrome driver: {str(e)}")
            print("💡 Make sure you have Chrome and chromedriver installed")
            return False
    
    def wait_for_download_completion(self, timeout=1800):  # 30 minutes
        """Wait for download to complete - Enhanced for Google Drive with longer timeout"""
        print("⏳ Waiting for download to complete...")
        start_time = time.time()
        
        # Get initial state
        initial_files = set()
        initial_sizes = {}
        
        try:
            for f in self.download_dir.iterdir():
                if f.is_file():
                    initial_files.add(f.name)
                    initial_sizes[f.name] = f.stat().st_size
        except Exception as e:
            print(f"⚠️ Error reading initial files: {e}")
        
        print(f"📊 Initial files in directory: {len(initial_files)}")
        
        # Check Chrome's download status through JavaScript
        check_interval = 2  # Check every 2 seconds for large files
        last_check_time = start_time
        download_detected = False
        last_progress_time = start_time
        stalled_threshold = 300  # 5 minutes without progress = stalled
        
        while time.time() - start_time < timeout:
            try:
                current_time = time.time()
                
                # Check Chrome downloads using JavaScript
                try:
                    # This JavaScript checks if there are any active downloads
                    downloads_active = self.driver.execute_script("""
                        var items = document.querySelector('downloads-manager');
                        if (items && items.shadowRoot) {
                            var downloads = items.shadowRoot.querySelectorAll('downloads-item');
                            return downloads.length > 0;
                        }
                        return false;
                    """)
                    
                    if downloads_active:
                        download_detected = True
                        print("📥 Active download detected in Chrome")
                except:
                    # If we can't check Chrome downloads, continue with file system check
                    pass
                
                # Check for .crdownload files (Chrome partial downloads)
                crdownload_files = list(self.download_dir.glob("*.crdownload"))
                if crdownload_files:
                    download_detected = True
                    current_file = crdownload_files[0]
                    file_size = current_file.stat().st_size
                    file_size_mb = file_size / (1024 * 1024)
                    
                    # Check if file is still growing (not stalled)
                    last_size_key = f"last_size_{current_file.name}"
                    if not hasattr(self, last_size_key):
                        setattr(self, last_size_key, 0)
                    
                    last_size = getattr(self, last_size_key)
                    if file_size > last_size:
                        # File is growing, update progress tracking
                        last_progress_time = current_time
                        setattr(self, last_size_key, file_size)
                        growth_mb = (file_size - last_size) / (1024 * 1024)
                        
                        # Calculate download speed
                        time_diff = current_time - last_check_time if current_time - last_check_time > 0 else 1
                        speed_mbps = growth_mb / time_diff
                        
                        print(f"📥 Download in progress: {current_file.name} ({file_size_mb:.1f} MB, +{growth_mb:.1f} MB, {speed_mbps:.1f} MB/s)")
                    else:
                        # File size hasn't changed - check if stalled
                        stalled_time = current_time - last_progress_time
                        if stalled_time > stalled_threshold:
                            print(f"⚠️ Download appears stalled for {stalled_time:.0f} seconds")
                            print(f"📊 File size unchanged at {file_size_mb:.1f} MB")
                            # Don't return False yet, give it more time
                            print("🔄 Continuing to wait...")
                        else:
                            print(f"📥 Download paused: {current_file.name} ({file_size_mb:.1f} MB) - waiting for resume...")
                    
                    time.sleep(check_interval)
                    continue
                
                # Check for .tmp files
                tmp_files = list(self.download_dir.glob("*.tmp"))
                if tmp_files:
                    download_detected = True
                    print(f"📥 Temporary file detected: {tmp_files[0].name}")
                    time.sleep(2)
                    continue
                
                # Get current file state
                current_files = set()
                current_sizes = {}
                
                for f in self.download_dir.iterdir():
                    if f.is_file() and not f.name.startswith('.'):
                        current_files.add(f.name)
                        current_sizes[f.name] = f.stat().st_size
                
                # Check for new files (completed downloads)
                new_files = current_files - initial_files
                
                if new_files:
                    print(f"✅ Download completed!")
                    for filename in new_files:
                        file_size = current_sizes.get(filename, 0)
                        file_size_mb = file_size / (1024 * 1024)
                        print(f"📁 Downloaded: {filename} ({file_size_mb:.1f} MB)")
                    return True
                
                # Check for files that have grown (existing files that got updated)
                progress_detected = False
                for filename in current_files & initial_files:
                    old_size = initial_sizes.get(filename, 0)
                    new_size = current_sizes.get(filename, 0)
                    if new_size > old_size:
                        download_detected = True
                        progress_detected = True
                        growth_mb = (new_size - old_size) / (1024 * 1024)
                        print(f"📈 File growing: {filename} (+{growth_mb:.1f} MB)")
                        initial_sizes[filename] = new_size  # Update size for next check
                        last_progress_time = current_time
                
                # If we haven't detected any download activity after 30 seconds, likely failed
                if not download_detected and current_time - start_time > 30:
                    print("⚠️ No download activity detected after 30 seconds")
                    
                    # Check if we're still on a Google page that might need interaction
                    try:
                        current_url = self.driver.current_url
                        if 'drive.google.com' in current_url:
                            print("🔍 Still on Google Drive page, checking for download options...")
                            
                            # Look for any download buttons or links we might have missed
                            download_elements = self.driver.find_elements(By.XPATH, 
                                "//a[contains(@href, 'export=download')] | //button[contains(text(), 'Download')]")
                            
                            if download_elements:
                                print(f"🔘 Found {len(download_elements)} download elements, clicking first one...")
                                download_elements[0].click()
                                download_detected = True  # Give it more time
                                time.sleep(3)
                    except:
                        pass
                    
                    if not download_detected:
                        return False
                
                # Print status periodically (every 30 seconds for large files)
                if current_time - last_check_time > 30:
                    elapsed = int(current_time - start_time)
                    elapsed_minutes = elapsed // 60
                    elapsed_seconds = elapsed % 60
                    time_since_progress = int(current_time - last_progress_time)
                    
                    print(f"⏱️ Still waiting... ({elapsed_minutes}m {elapsed_seconds}s elapsed, last progress: {time_since_progress}s ago)")
                    print(f"📊 Files in directory: {len(current_files)}")
                    last_check_time = current_time
                
                time.sleep(check_interval)
                
            except Exception as e:
                print(f"⚠️ Error during download check: {e}")
                time.sleep(2)
        
        # Final check after timeout
        print(f"⚠️ Download timeout reached after {timeout/60:.1f} minutes")
        final_files = set(f.name for f in self.download_dir.iterdir() if f.is_file())
        final_new_files = final_files - initial_files
        
        if final_new_files:
            print(f"✅ Found files after timeout: {list(final_new_files)}")
            return True
        
        # Check if there's still a .crdownload file (partial download)
        crdownload_files = list(self.download_dir.glob("*.crdownload"))
        if crdownload_files:
            file_size_mb = crdownload_files[0].stat().st_size / (1024 * 1024)
            print(f"⚠️ Partial download found: {crdownload_files[0].name} ({file_size_mb:.1f} MB)")
            print("💡 You may want to increase the timeout for very large files")
        
        return False

    def handle_google_drive_virus_warning(self):
        """Handle Google Drive virus scan warning page"""
        print("🦠 Handling virus scan warning...")
        time.sleep(3)
        
        download_anyway_selectors = [
            "form[action*='confirm'] input[type='submit']",
            "form[action*='confirm'] button",
            "a[href*='confirm=']",
            "a[href*='&confirm=']",
            "#download-form input[type='submit']",
            "#download-form button",
            "input[value*='Download anyway']",
            "button[value*='Download anyway']",
            "input[name='confirm']",
            "form input[type='submit']",
            "form[method='post'] input[type='submit']",
            "form[method='post'] button[type='submit']",
        ]
        
        for selector in download_anyway_selectors:
            try:
                elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                for element in elements:
                    if element.is_displayed():
                        try:
                            self.driver.execute_script("arguments[0].scrollIntoView(true);", element)
                            time.sleep(1)
                            element.click()
                            print("✅ Successfully clicked download element")
                            return True
                        except Exception:
                            try:
                                self.driver.execute_script("arguments[0].click();", element)
                                print("✅ JavaScript click successful")
                                return True
                            except Exception:
                                continue
            except Exception:
                continue
        
        print("❌ Could not handle virus warning page")
        return False
    
    def download_google_drive_selenium(self, url):
        """Download from Google Drive using Selenium - Updated for current Google Drive"""
        try:
            if not self.driver:
                if not self.setup_driver():
                    return False
            
            print(f"🔗 Opening Google Drive URL: {url}")
            self.driver.get(url)
            time.sleep(5)
            
            # Extract file ID from various URL formats
            file_id = None
            current_url = self.driver.current_url
            
            if '/file/d/' in url:
                file_id = url.split('/file/d/')[1].split('/')[0]
            elif '/file/d/' in current_url:
                file_id = current_url.split('/file/d/')[1].split('/')[0]
            elif 'id=' in current_url:
                file_id = current_url.split('id=')[1].split('&')[0]
            
            if not file_id:
                print("❌ Could not extract file ID from URL")
                return False
            
            print(f"📄 File ID: {file_id}")
            
            # Method 1: Try the direct download URL first
            direct_url = f"https://drive.google.com/uc?export=download&id={file_id}"
            print(f"🔗 Trying direct download URL...")
            self.driver.get(direct_url)
            time.sleep(5)
            
            # Check if we got a virus warning page
            page_source = self.driver.page_source.lower()
            if 'virus scan warning' in page_source or 'can\'t scan this file for viruses' in page_source:
                print("⚠️ Virus scan warning detected")
                
                # Enhanced virus warning handling
                handled = False
                
                # Method 1: Look for the download anyway button/link
                download_selectors = [
                    # Common selectors for the download anyway button
                    "a#uc-download-link",
                    "a[id*='download-link']",
                    "form[id='download-form'] button",
                    "form[id='downloadForm'] button",
                    "input[name='confirm']",
                    "button[aria-label*='Download']",
                    "a[href*='confirm=t']",
                    "a[href*='confirm=no_antivirus']",
                    "form[action*='confirm'] button",
                    "form[method='post'] button[type='submit']",
                    "#download-form input[type='submit']",
                    ".uc-error-subcaption a",
                    "noscript a[href*='confirm']"
                ]
                
                for selector in download_selectors:
                    try:
                        elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                        for element in elements:
                            if element.is_displayed():
                                href = element.get_attribute('href')
                                if href and 'confirm=' in href:
                                    # If it's a link with confirm parameter, navigate to it
                                    print(f"📎 Found download link: {href[:50]}...")
                                    self.driver.get(href)
                                    handled = True
                                    break
                                else:
                                    # If it's a button, click it
                                    try:
                                        element.click()
                                        handled = True
                                        print("✅ Clicked download button")
                                        break
                                    except:
                                        self.driver.execute_script("arguments[0].click();", element)
                                        handled = True
                                        print("✅ JavaScript clicked download button")
                                        break
                        if handled:
                            break
                    except Exception as e:
                        continue
                
                # Method 2: Extract confirm parameter and build URL manually
                if not handled:
                    print("🔍 Extracting confirm parameter from page...")
                    try:
                        # Look for confirm parameter in the page
                        import re
                        confirm_match = re.search(r'confirm=([a-zA-Z0-9_-]+)', page_source)
                        if confirm_match:
                            confirm_code = confirm_match.group(1)
                            confirm_url = f"https://drive.google.com/uc?export=download&confirm={confirm_code}&id={file_id}"
                            print(f"🔗 Found confirm code, navigating to: {confirm_url[:70]}...")
                            self.driver.get(confirm_url)
                            handled = True
                        else:
                            # Try with confirm=t as fallback
                            confirm_url = f"https://drive.google.com/uc?export=download&confirm=t&id={file_id}"
                            print(f"🔗 Using fallback confirm URL...")
                            self.driver.get(confirm_url)
                            handled = True
                    except Exception as e:
                        print(f"❌ Error extracting confirm parameter: {e}")
                
                if handled:
                    print("✅ Virus warning bypassed, download should start")
                    time.sleep(3)
                    
                    # Check if download started
                    if self.wait_for_download_completion(timeout=1800):  # 30 minutes for large files
                        return True
                    else:
                        print("⚠️ Download didn't start after handling virus warning")
                else:
                    print("❌ Could not handle virus warning")
            
            # If no virus warning or after handling it, check for download
            print("🔍 Checking for automatic download...")
            
            # Sometimes the download starts automatically
            if self.wait_for_download_completion(timeout=1800):  # 30 minutes for large files
                return True
            
            # Method 3: Try alternative download method using Google Drive API-like URL
            print("🔄 Trying alternative download method...")
            alt_url = f"https://drive.google.com/u/0/uc?export=download&id={file_id}"
            self.driver.get(alt_url)
            time.sleep(5)
            
            # Final attempt to wait for download
            return self.wait_for_download_completion(timeout=1800)  # 30 minutes for large files
            
        except Exception as e:
            print(f"❌ Error downloading with Selenium: {str(e)}")
            import traceback
            traceback.print_exc()
            return False
        
    def handle_wetransfer_flow(self):
        """Handle the complete WeTransfer download flow"""
        try:
            # Accept cookies if present
            cookie_selectors = [
                "button[data-testid*='accept']",
                "button[data-testid*='cookie']",
                "[data-qa*='cookie'] button",
                ".cookie-consent button",
                "button[aria-label*='Accept']"
            ]
            
            for selector in cookie_selectors:
                try:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    for element in elements:
                        if element.is_displayed() and element.is_enabled():
                            self.driver.execute_script("arguments[0].click();", element)
                            time.sleep(2)
                            break
                except:
                    continue
            
            # Look for and click "Agree" button
            time.sleep(3)
            agree_xpath = "//button[contains(translate(text(), 'AGREE', 'agree'), 'agree')]"
            try:
                agree_elements = self.driver.find_elements(By.XPATH, agree_xpath)
                for element in agree_elements:
                    if element.is_displayed() and element.is_enabled():
                        self.driver.execute_script("arguments[0].click();", element)
                        time.sleep(3)
                        break
            except:
                pass
            
            # Look for download button
            time.sleep(3)
            exact_download_xpath = "//button[normalize-space(translate(text(), 'DOWNLOAD', 'download'))='download'] | //a[normalize-space(translate(text(), 'DOWNLOAD', 'download'))='download']"
            
            try:
                exact_elements = self.driver.find_elements(By.XPATH, exact_download_xpath)
                for element in exact_elements:
                    if element.is_displayed() and element.is_enabled():
                        self.driver.execute_script("arguments[0].click();", element)
                        return True
            except:
                pass
            
            return False
            
        except Exception as e:
            print(f"⚠️ Error in WeTransfer flow: {e}")
            return False
    
    def download_wetransfer_selenium(self, url):
        """Download from WeTransfer using Selenium"""
        try:
            if not self.driver:
                if not self.setup_driver():
                    return False
            
            print(f"🔗 Opening WeTransfer URL: {url}")
            self.driver.get(url)
            time.sleep(5)
            
            # Handle the WeTransfer flow
            if self.handle_wetransfer_flow():
                print("✅ WeTransfer flow completed, checking for download...")
                time.sleep(2)
                return self.wait_for_download_completion(timeout=120)
            else:
                print("❌ Failed to complete WeTransfer flow")
                return False
                
        except Exception as e:
            print(f"❌ Error downloading WeTransfer with Selenium: {str(e)}")
            return False

    def download(self, url):
        """Main download function"""
        try:
            if 'drive.google.com' in url:
                return self.download_google_drive_selenium(url)
            elif 'wetransfer.com' in url or 'we.tl' in url:
                return self.download_wetransfer_selenium(url)
            else:
                print("❌ Unsupported URL. Only Google Drive and WeTransfer links are supported.")
                return False
        except Exception as e:
            print(f"❌ Error in download: {e}")
            return False
        
    def cleanup(self):
        """Clean up and close browser"""
        if self.driver:
            try:
                self.driver.quit()
                print("🧹 Browser closed")
            except:
                pass


class DatabaseMonitor:
    """Monitor database for new links"""
    def __init__(self, download_manager, poll_interval=10):
        self.download_manager = download_manager
        self.poll_interval = poll_interval
        self.running = False
        self.thread = None
    
    def start(self):
        """Start monitoring"""
        self.running = True
        self.thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.thread.start()
        print(f"🔄 Started database monitoring every {self.poll_interval} seconds")
    
    def stop(self):
        """Stop monitoring"""
        self.running = False
        if self.thread:
            self.thread.join()
    
    def _monitor_loop(self):
        """Main monitoring loop"""
        while self.running:
            try:
                self.download_manager.process_new_links()
                time.sleep(self.poll_interval)
            except Exception as e:
                print(f"❌ Monitoring error: {e}")
                time.sleep(self.poll_interval)


def main():
    """Main function to run the automated link downloader"""
    print("🤖 Automated Link Downloader - SQLite Database Integration")
    print("=" * 60)
    print("Features:")
    print("✅ Database-driven link processing")
    print("✅ Thread-safe operations")
    print("✅ Duplicate download prevention")
    print("✅ Proper media entry creation")
    print("✅ Error tracking and recovery")
    print("=" * 60)
    
    # Initialize the download manager
    download_manager = LinkDownloadManager()
    
    # Show current status
    with download_manager.get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Count unprocessed links
        cursor.execute("""
            SELECT COUNT(*) as count 
            FROM urls 
            WHERE is_processed = 0 
            AND (domain = 'drive.google.com' OR domain = 'we.tl' OR domain = 'wetransfer.com')
        """)
        unprocessed_count = cursor.fetchone()['count']
        
        # Count processed links
        cursor.execute("""
            SELECT COUNT(*) as count 
            FROM urls 
            WHERE is_processed = 1 
            AND (domain = 'drive.google.com' OR domain = 'we.tl' OR domain = 'wetransfer.com')
        """)
        processed_count = cursor.fetchone()['count']
        
        print(f"\n📊 Database Status:")
        print(f"   - Unprocessed links: {unprocessed_count}")
        print(f"   - Processed links: {processed_count}")
    
    # Process any existing links first
    print("\n🔍 Processing existing unprocessed links...")
    download_manager.process_new_links()
    
    # Start monitoring
    print("\n👀 Starting database monitoring...")
    monitor = DatabaseMonitor(download_manager, poll_interval=10)
    monitor.start()
    
    print(f"🟢 Monitoring database for new links. Press Ctrl+C to stop.")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Stopping monitoring...")
        monitor.stop()
    
    download_manager.cleanup()
    print("👋 Service stopped!")


if __name__ == "__main__":
    main()