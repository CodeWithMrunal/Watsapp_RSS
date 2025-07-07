import os
import re
import json
import time
import hashlib
import threading
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
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
from bson import ObjectId

class MongoDBLinkDownloadManager:
    def __init__(self, 
                 mongo_uri="mongodb://localhost:27017/",
                 db_name="whatsapp-monitor",
                 collection_name="links",
                 media_file="backend/media/links.json", 
                 download_dir="backend/media"):
        
        # MongoDB setup
        self.mongo_uri = mongo_uri
        self.db_name = db_name
        self.collection_name = collection_name
        self.client = None
        self.db = None
        self.links_collection = None
        
        # Connect to MongoDB
        self._connect_to_mongodb()
        
        # Local dev — resolve paths relative to this script's location
        base_dir = Path(__file__).resolve().parent.parent  # Go from selenium/ → project root
        self.media_file = (base_dir / media_file).resolve()
        self.download_dir = (base_dir / download_dir).resolve()

        # Make sure download directory exists
        self.download_dir.mkdir(parents=True, exist_ok=True)
        
        # Track processed links to avoid duplicates
        self.processed_links = set()  # Store URL hashes
        self.processed_urls = set()   # Store actual URLs for debugging
        self.link_to_media_map = {}
        self.last_check_time = datetime.now()
        
        # Thread safety
        self.processing_lock = threading.Lock()
        self.is_processing = False
        
        # Initialize downloader (will be created per download to avoid conflicts)
        self.downloader = None
        
        # Load existing processed links from both MongoDB and local file
        self.load_processed_links()
        
        print(f"📁 Download directory: {self.download_dir.absolute()}")
        print(f"📄 Media file: {self.media_file.absolute()}")
        print(f"🗄️ MongoDB: {self.db_name}.{self.collection_name}")
        
    def _connect_to_mongodb(self):
        """Connect to MongoDB database"""
        try:
            self.client = MongoClient(self.mongo_uri)
            # Test connection
            self.client.admin.command('ismaster')
            self.db = self.client[self.db_name]
            self.links_collection = self.db[self.collection_name]
            print(f"✅ Connected to MongoDB: {self.db_name}")
        except ConnectionFailure as e:
            print(f"❌ Failed to connect to MongoDB: {e}")
            raise
        except Exception as e:
            print(f"❌ MongoDB connection error: {e}")
            raise
    
    def load_processed_links(self):
        """Load already processed links from both MongoDB and links.json"""
        try:
            # Load from MongoDB - links marked as processed
            processed_count = 0
            if self.links_collection is not None:
                processed_links = self.links_collection.find({'processed': True})
                for link in processed_links:
                    url = link.get('url', '')
                    if url:
                        link_hash = hashlib.md5(url.encode()).hexdigest()
                        self.processed_links.add(link_hash)
                        self.processed_urls.add(url)
                        processed_count += 1
                print(f"📚 Loaded {processed_count} processed links from MongoDB")
            
            # Also load from local links.json for backward compatibility
            if self.media_file.exists():
                with open(self.media_file, 'r', encoding='utf-8') as f:
                    media_data = json.load(f)
                
                local_count = 0
                for entry in media_data:
                    if 'source_link' in entry:
                        url = entry['source_link']
                        link_hash = hashlib.md5(url.encode()).hexdigest()
                        self.processed_links.add(link_hash)
                        self.processed_urls.add(url)
                        self.link_to_media_map[link_hash] = entry
                        local_count += 1
                
                print(f"📚 Loaded {local_count} processed links from local links.json")
            
            print(f"📊 Total unique processed links: {len(self.processed_links)}")
            
        except Exception as e:
            print(f"⚠️ Error loading processed links: {e}")
    
    def get_unprocessed_links(self):
        """Get all unprocessed links from MongoDB that match our criteria"""
        try:
            # Query for Google Drive and WeTransfer links that haven't been processed
            query = {
                '$or': [
                    {'domain': 'drive.google.com'},
                    {'domain': 'we.tl'},
                    {'url': {'$regex': 'wetransfer.com'}},
                ],
                '$or': [
                    {'processed': {'$exists': False}},
                    {'processed': False}
                ]
            }
            
            # Sort by messageTimestamp to process oldest first
            links = list(self.links_collection.find(query).sort('messageTimestamp', 1))
            
            # Filter out already processed links (double-check)
            unprocessed_links = []
            for link in links:
                url = link.get('url', '')
                if url and not self.is_link_processed(url):
                    unprocessed_links.append(link)
            
            return unprocessed_links
            
        except Exception as e:
            print(f"❌ Error fetching unprocessed links: {e}")
            return []
    
    def is_link_processed(self, url):
        """Check if a link has already been processed"""
        normalized_url = url.strip().rstrip('/')
        link_hash = hashlib.md5(normalized_url.encode()).hexdigest()
        
        is_processed = link_hash in self.processed_links or normalized_url in self.processed_urls
        
        if is_processed:
            print(f"✅ Link already processed: {url[:50]}...")
        else:
            print(f"🆕 New link to process: {url[:50]}...")
            
        return is_processed
    
    def mark_link_processed(self, url, link_doc_id=None, media_info=None):
        """Mark a link as processed in both MongoDB and local tracking"""
        normalized_url = url.strip().rstrip('/')
        link_hash = hashlib.md5(normalized_url.encode()).hexdigest()
        
        # Update local tracking
        self.processed_links.add(link_hash)
        self.processed_urls.add(normalized_url)
        
        if media_info:
            self.link_to_media_map[link_hash] = media_info
        
        # Update MongoDB
        if link_doc_id and self.links_collection is not None:
            try:
                self.links_collection.update_one(
                    {'_id': link_doc_id},
                    {
                        '$set': {
                            'processed': True,
                            'processedAt': datetime.now(),
                            'downloadInfo': media_info if media_info else {}
                        }
                    }
                )
                print(f"✅ Marked as processed in MongoDB: {url[:50]}...")
            except Exception as e:
                print(f"⚠️ Error updating MongoDB: {e}")
        
        print(f"✅ Marked as processed locally: {url[:50]}...")
    
    def update_media_json(self, link_info, downloaded_files):
        """Update links.json with new download information (for backward compatibility)"""
        try:
            # Load existing media data
            media_data = []
            if self.media_file.exists():
                with open(self.media_file, 'r', encoding='utf-8') as f:
                    content = f.read().strip()
                    if content:
                        media_data = json.loads(content)
            
            # Add new entries for each downloaded file
            for file_path in downloaded_files:
                file_path = Path(file_path)
                if file_path.exists():
                    # Generate a unique ID for this media entry
                    media_id = f"auto_{int(time.time())}_{file_path.stem}_{len(media_data)}"
                    
                    # Get file info
                    file_size = file_path.stat().st_size
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
                    
                    media_entry = {
                        "id": media_id,
                        "author": link_info.get('author', 'unknown'),
                        "timestamp": int(time.time()),
                        "original_timestamp": link_info.get('messageTimestamp', int(time.time())),
                        "caption": f"Auto-downloaded from: {link_info['url'][:50]}...",
                        "type": media_type,
                        "mediaPath": f"media/{file_path.name}",
                        "source_link": link_info['url'],
                        "source_message_id": link_info.get('messageId', ''),
                        "source_group_id": link_info.get('groupId', ''),
                        "file_size": file_size,
                        "file_extension": file_extension,
                        "download_date": datetime.now().isoformat(),
                        "platform": link_info.get('platform', 'unknown'),
                        "mongo_id": str(link_info.get('_id', ''))
                    }
                    
                    media_data.append(media_entry)
                    
                    # Mark this link as processed with media info
                    self.mark_link_processed(
                        link_info['url'], 
                        link_info.get('_id'),
                        media_entry
                    )
            
            # Save updated links.json
            with open(self.media_file, 'w', encoding='utf-8') as f:
                json.dump(media_data, f, indent=2, ensure_ascii=False)
            
            print(f"📄 Updated {self.media_file} with {len(downloaded_files)} new entries")
            
        except Exception as e:
            print(f"❌ Error updating links.json: {e}")
    
    def download_link(self, link_doc):
        """Download a single link using the Selenium downloader"""
        url = link_doc.get('url', '')
        
        if not url:
            print("⚠️ No URL found in link document")
            return False
        
        # Double-check if link is processed
        if self.is_link_processed(url):
            print(f"⏭️ Skipping already processed link: {url[:50]}...")
            return False
        
        print(f"⬇️ Downloading: {url}")
        print(f"👤 Author: {link_doc.get('authorNumber', 'unknown')}")
        print(f"📅 Message time: {datetime.fromtimestamp(link_doc.get('messageTimestamp', 0))}")
        print(f"🔗 Platform: {link_doc.get('platform', 'unknown')}")
        
        # Mark as processing early to prevent race conditions
        self.mark_link_processed(url, link_doc.get('_id'))
        
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
                    downloaded_files = [self.download_dir / filename for filename in new_files]
                    print(f"✅ Downloaded {len(new_files)} file(s): {list(new_files)}")
                    
                    # Update links.json for backward compatibility
                    self.update_media_json(link_doc, downloaded_files)
                    
                    # Update MongoDB with download success
                    if self.links_collection is not None:
                        self.links_collection.update_one(
                            {'_id': link_doc.get('_id')},
                            {
                                '$set': {
                                    'downloadSuccess': True,
                                    'downloadedFiles': list(new_files),
                                    'downloadCompletedAt': datetime.now()
                                }
                            }
                        )
                    
                    return True
                else:
                    print("⚠️ Download reported success but no new files found")
                    return False
            else:
                print(f"❌ Failed to download: {url}")
                
                # Update MongoDB with download failure
                if self.links_collection is not None:
                    self.links_collection.update_one(
                        {'_id': link_doc.get('_id')},
                        {
                            '$set': {
                                'downloadSuccess': False,
                                'downloadAttemptedAt': datetime.now()
                            }
                        }
                    )
                
                return False
                
        except Exception as e:
            print(f"❌ Error downloading {url}: {e}")
            return False
        finally:
            # Always clean up the downloader
            downloader.cleanup()
    
    def process_new_links(self, force=False):
        """Process all new links found in MongoDB"""
        with self.processing_lock:
            if self.is_processing and not force:
                print("⏳ Already processing links, skipping...")
                return
            
            self.is_processing = True
            
        try:
            print(f"🔄 Processing links from MongoDB... (Force: {force})")
            
            # Get unprocessed links
            unprocessed_links = self.get_unprocessed_links()
            
            if not unprocessed_links:
                print("ℹ️ No unprocessed links found")
                return
            
            print(f"🆕 Found {len(unprocessed_links)} unprocessed links")
            
            for i, link_doc in enumerate(unprocessed_links, 1):
                print(f"\n📥 Processing link {i}/{len(unprocessed_links)}")
                print("-" * 50)
                
                try:
                    self.download_link(link_doc)
                    # Small delay between downloads
                    time.sleep(2)
                except Exception as e:
                    print(f"❌ Error processing link {link_doc.get('url', 'unknown')}: {e}")
                    # Mark as processed even on error to prevent infinite retries
                    self.mark_link_processed(link_doc.get('url', ''), link_doc.get('_id'))
                    continue
            
            print(f"\n✅ Finished processing {len(unprocessed_links)} links")
            self.last_check_time = datetime.now()
            
        finally:
            self.is_processing = False
    
    def monitor_continuous(self, check_interval=10):
        """Continuously monitor MongoDB for new links"""
        print(f"🔄 Starting continuous monitoring (checking every {check_interval} seconds)")
        
        while True:
            try:
                self.process_new_links()
                time.sleep(check_interval)
            except KeyboardInterrupt:
                print("\n🛑 Monitoring stopped by user")
                break
            except Exception as e:
                print(f"❌ Error in monitoring loop: {e}")
                time.sleep(check_interval)
    
    def cleanup(self):
        """Clean up resources"""
        if hasattr(self, 'downloader') and self.downloader:
            self.downloader.cleanup()
        
        if self.client:
            self.client.close()
            print("🧹 MongoDB connection closed")


# Include the SeleniumVideoDownloader class from the original code
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
    
    def wait_for_download_completion(self, timeout=1800):  # Increased to 30 minutes
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
            
            # Ask if we should wait longer (if interactive)
            try:
                import sys
                if sys.stdin.isatty():  # Interactive terminal
                    continue_wait = input(f"Continue waiting for download? (y/n): ").strip().lower()
                    if continue_wait in ['y', 'yes']:
                        print("🔄 Continuing to wait for download...")
                        return self.wait_for_download_completion(timeout=600)  # Wait another 10 minutes
            except:
                pass
        
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


def main():
    """Main function to run the MongoDB-based automated link downloader"""
    print("🤖 MongoDB-based Automated Link Downloader")
    print("=" * 60)
    print("Features:")
    print("✅ Monitors MongoDB links collection")
    print("✅ Smart duplicate prevention")
    print("✅ Thread-safe processing")
    print("✅ Updates both MongoDB and local links.json")
    print("✅ Tracks download status in database")
    print("=" * 60)
    
    # MongoDB configuration
    mongo_uri = input("\nEnter MongoDB URI (default: mongodb://localhost:27017/): ").strip()
    if not mongo_uri:
        mongo_uri = "mongodb://localhost:27017/"
    
    db_name = input("Enter database name (default: whatsapp-monitor): ").strip()
    if not db_name:
        db_name = "whatsapp-monitor"
    
    collection_name = input("Enter collection name (default: links): ").strip()
    if not collection_name:
        collection_name = "links"
    
    # Initialize the download manager
    try:
        download_manager = MongoDBLinkDownloadManager(
            mongo_uri=mongo_uri,
            db_name=db_name,
            collection_name=collection_name
        )
    except Exception as e:
        print(f"❌ Failed to initialize download manager: {e}")
        return
    
    # Process mode selection
    print("\nSelect processing mode:")
    print("1. Process once (check for unprocessed links now)")
    print("2. Continuous monitoring (check every N seconds)")
    
    mode = input("\nEnter mode (1 or 2, default: 2): ").strip()
    
    if mode == "1":
        # One-time processing
        print("\n🔍 Processing unprocessed links once...")
        download_manager.process_new_links(force=True)
        print("\n✅ Processing complete!")
    else:
        # Continuous monitoring
        check_interval = input("\nCheck interval in seconds (default: 10): ").strip()
        try:
            check_interval = int(check_interval)
        except:
            check_interval = 10
        
        print(f"\n🟢 Starting continuous monitoring (checking every {check_interval} seconds)")
        print("Press Ctrl+C to stop...")
        
        try:
            download_manager.monitor_continuous(check_interval)
        except KeyboardInterrupt:
            print("\n🛑 Stopping monitoring...")
    
    # Cleanup
    download_manager.cleanup()
    print("\n👋 Service stopped!")


if __name__ == "__main__":
    main()