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
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class LinkDownloadManager:
    def __init__(self, messages_file="rss/messages.json", media_file="media.json", download_dir="media"):
        self.messages_file = Path(messages_file).resolve()
        self.media_file = Path(media_file).resolve()
        self.download_dir = Path(download_dir)
        self.download_dir.mkdir(exist_ok=True)
        
        # Track processed links to avoid duplicates
        self.processed_links = set()
        self.link_to_media_map = {}
        self.last_messages_content = ""
        self.last_file_size = 0
        self.last_modification_time = 0
        
        # Thread safety
        self.processing_lock = threading.Lock()
        self.is_processing = False
        
        # Initialize downloader (will be created per download to avoid conflicts)
        self.downloader = None
        
        # Load existing processed links
        self.load_processed_links()
        
        print(f"📁 Download directory: {self.download_dir.absolute()}")
        print(f"📄 Messages file: {self.messages_file.absolute()}")
        print(f"📄 Media file: {self.media_file.absolute()}")
        
        # Store initial file state
        self.update_file_state()
    
    def update_file_state(self):
        """Update the current state of the messages file"""
        try:
            if self.messages_file.exists():
                stat = self.messages_file.stat()
                self.last_modification_time = stat.st_mtime
                self.last_file_size = stat.st_size
                
                with open(self.messages_file, 'r', encoding='utf-8') as f:
                    self.last_messages_content = f.read()
                    
                print(f"📊 File state updated - Size: {self.last_file_size}, Modified: {datetime.fromtimestamp(self.last_modification_time)}")
        except Exception as e:
            print(f"⚠️ Error updating file state: {e}")
    
    def has_file_changed(self):
        """Check if the messages file has actually changed"""
        try:
            if not self.messages_file.exists():
                return False
                
            stat = self.messages_file.stat()
            current_mtime = stat.st_mtime
            current_size = stat.st_size
            
            # Check modification time and size first (quick check)
            if current_mtime <= self.last_modification_time and current_size == self.last_file_size:
                return False
            
            # If time/size changed, check content
            with open(self.messages_file, 'r', encoding='utf-8') as f:
                current_content = f.read()
            
            if current_content == self.last_messages_content:
                # File was touched but content didn't change
                self.last_modification_time = current_mtime
                self.last_file_size = current_size
                return False
            
            print(f"📄 File content changed - New size: {current_size}, Old size: {self.last_file_size}")
            return True
            
        except Exception as e:
            print(f"⚠️ Error checking file changes: {e}")
            return False
    
    def load_processed_links(self):
        """Load already processed links from media.json to avoid re-downloading"""
        try:
            if self.media_file.exists():
                with open(self.media_file, 'r', encoding='utf-8') as f:
                    media_data = json.load(f)
                
                for entry in media_data:
                    if 'source_link' in entry:
                        link_hash = hashlib.md5(entry['source_link'].encode()).hexdigest()
                        self.processed_links.add(link_hash)
                        self.link_to_media_map[link_hash] = entry
                
                print(f"📚 Loaded {len(self.processed_links)} previously processed links")
        except Exception as e:
            print(f"⚠️ Error loading processed links: {e}")
    
    def extract_links_from_messages(self):
        """Extract Google Drive and WeTransfer links from messages.json"""
        try:
            if not self.messages_file.exists():
                print(f"❌ Messages file not found: {self.messages_file}")
                return []
            
            with open(self.messages_file, 'r', encoding='utf-8') as f:
                messages = json.load(f)
            
            links = []
            link_patterns = [
                r'https://drive\.google\.com/file/d/[^/\s]+[^\s]*',
                r'https://drive\.google\.com/open\?id=[^\s]+',
                r'https://we\.tl/t-[^\s]+',
                r'https://wetransfer\.com/downloads/[^\s]+'
            ]
            
            for message in messages:
                if message.get('type') == 'chat' and message.get('body'):
                    body = message['body']
                    
                    for pattern in link_patterns:
                        matches = re.findall(pattern, body)
                        for match in matches:
                            # Clean up the URL (remove any trailing characters)
                            clean_url = match.rstrip('.,;!?)')
                            
                            link_info = {
                                'url': clean_url,
                                'message_id': message['id'],
                                'author': message['author'],
                                'timestamp': message['timestamp'],
                                'message_body': body
                            }
                            links.append(link_info)
            
            print(f"🔍 Found {len(links)} total links in messages")
            return links
            
        except Exception as e:
            print(f"❌ Error extracting links: {e}")
            return []
    
    def is_link_processed(self, url):
        """Check if a link has already been processed"""
        link_hash = hashlib.md5(url.encode()).hexdigest()
        return link_hash in self.processed_links
    
    def mark_link_processed(self, url, media_info=None):
        """Mark a link as processed"""
        link_hash = hashlib.md5(url.encode()).hexdigest()
        self.processed_links.add(link_hash)
        if media_info:
            self.link_to_media_map[link_hash] = media_info
    
    def update_media_json(self, link_info, downloaded_files):
        """Update media.json with new download information"""
        try:
            # Load existing media data
            media_data = []
            if self.media_file.exists():
                with open(self.media_file, 'r', encoding='utf-8') as f:
                    media_data = json.load(f)
            
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
                        "author": link_info['author'],
                        "timestamp": int(time.time()),
                        "original_timestamp": link_info['timestamp'],
                        "caption": f"Auto-downloaded from: {link_info['url'][:50]}...",
                        "type": media_type,
                        "mediaPath": str(file_path.relative_to(Path.cwd())),
                        "source_link": link_info['url'],
                        "source_message_id": link_info['message_id'],
                        "source_message_body": link_info['message_body'],
                        "file_size": file_size,
                        "file_extension": file_extension,
                        "download_date": datetime.now().isoformat()
                    }
                    
                    media_data.append(media_entry)
                    
                    # Mark this link as processed
                    self.mark_link_processed(link_info['url'], media_entry)
            
            # Save updated media.json
            with open(self.media_file, 'w', encoding='utf-8') as f:
                json.dump(media_data, f, indent=2, ensure_ascii=False)
            
            print(f"📄 Updated {self.media_file} with {len(downloaded_files)} new entries")
            
        except Exception as e:
            print(f"❌ Error updating media.json: {e}")
    
    def download_link(self, link_info):
        """Download a single link using the Selenium downloader"""
        url = link_info['url']
        
        if self.is_link_processed(url):
            print(f"⏭️ Skipping already processed link: {url[:50]}...")
            return False
        
        print(f"⬇️ Downloading: {url}")
        print(f"👤 Author: {link_info['author']}")
        print(f"📅 Message time: {datetime.fromtimestamp(link_info['timestamp'])}")
        
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
                    
                    # Update media.json
                    self.update_media_json(link_info, downloaded_files)
                    return True
                else:
                    print("⚠️ Download reported success but no new files found")
                    # Still mark as processed to avoid infinite retries
                    self.mark_link_processed(url)
                    return False
            else:
                print(f"❌ Failed to download: {url}")
                return False
                
        finally:
            # Always clean up the downloader
            downloader.cleanup()
    
    def process_new_links(self, force=False):
        """Process all new links found in messages.json"""
        with self.processing_lock:
            if self.is_processing and not force:
                print("⏳ Already processing links, skipping...")
                return
            
            self.is_processing = True
            
        try:
            print(f"🔄 Processing links... (Force: {force})")
            
            # Check if file has actually changed (unless forced)
            if not force and not self.has_file_changed():
                print("ℹ️ No changes detected in messages.json")
                return
            
            links = self.extract_links_from_messages()
            
            if not links:
                print("ℹ️ No links found in messages")
                self.update_file_state()
                return
            
            new_links = [link for link in links if not self.is_link_processed(link['url'])]
            
            if not new_links:
                print("ℹ️ No new links to process")
                self.update_file_state()
                return
            
            print(f"🆕 Found {len(new_links)} new links to download")
            
            for i, link_info in enumerate(new_links, 1):
                print(f"\n📥 Processing link {i}/{len(new_links)}")
                print("-" * 50)
                
                try:
                    self.download_link(link_info)
                    # Small delay between downloads
                    time.sleep(2)
                except Exception as e:
                    print(f"❌ Error processing link {link_info['url']}: {e}")
                    continue
            
            print(f"\n✅ Finished processing {len(new_links)} links")
            
            # Update file state after successful processing
            self.update_file_state()
            
        finally:
            self.is_processing = False
    
    def cleanup(self):
        """Clean up resources"""
        if hasattr(self, 'downloader') and self.downloader:
            self.downloader.cleanup()


class SeleniumVideoDownloader:
    def __init__(self, download_dir="media", headless=True):
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
    
    def wait_for_download_completion(self, timeout=300):
        """Wait for download to complete - Enhanced for small files"""
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
        
        # For very small files, use shorter intervals and timeouts
        check_interval = 0.2  # Check every 200ms for faster detection
        last_check_time = start_time
        min_wait_time = 2  # Minimum wait time before giving up
        
        # Quick initial check (small files might download immediately)
        time.sleep(0.5)
        
        while time.time() - start_time < timeout:
            try:
                current_time = time.time()
                
                # Check for .crdownload files (Chrome partial downloads)
                crdownload_files = list(self.download_dir.glob("*.crdownload"))
                if crdownload_files:
                    print(f"📥 Download in progress: {crdownload_files[0].name}")
                    time.sleep(1)
                    continue
                
                # Check for .tmp files (temporary downloads)
                tmp_files = list(self.download_dir.glob("*.tmp"))
                if tmp_files:
                    print(f"📥 Temporary file detected: {tmp_files[0].name}")
                    time.sleep(1)
                    continue
                
                # Get current file state
                current_files = set()
                current_sizes = {}
                
                for f in self.download_dir.iterdir():
                    if f.is_file() and not f.name.startswith('.'):  # Skip hidden files
                        current_files.add(f.name)
                        current_sizes[f.name] = f.stat().st_size
                
                # Check for new files
                new_files = current_files - initial_files
                
                if new_files:
                    print(f"✅ Download completed!")
                    for filename in new_files:
                        file_size = current_sizes.get(filename, 0)
                        file_size_kb = file_size / 1024
                        if file_size < 1024:
                            print(f"📁 Downloaded: {filename} ({file_size} bytes)")
                        elif file_size < 1024 * 1024:
                            print(f"📁 Downloaded: {filename} ({file_size_kb:.1f} KB)")
                        else:
                            file_size_mb = file_size / (1024 * 1024)
                            print(f"📁 Downloaded: {filename} ({file_size_mb:.1f} MB)")
                    return True
                
                # Check for files that have grown in size (ongoing downloads)
                for filename in current_files & initial_files:
                    old_size = initial_sizes.get(filename, 0)
                    new_size = current_sizes.get(filename, 0)
                    if new_size > old_size:
                        print(f"✅ Existing file updated: {filename} (grew by {new_size - old_size} bytes)")
                        return True
                
                # For small files, check if we've waited long enough
                elapsed = current_time - start_time
                if elapsed >= min_wait_time:
                    # Do a final comprehensive check for any files that might have been missed
                    final_files = set()
                    try:
                        for f in self.download_dir.iterdir():
                            if f.is_file() and not f.name.startswith('.'):
                                stat_info = f.stat()
                                # Check if file was created/modified recently (within last 30 seconds)
                                if current_time - stat_info.st_mtime < 30:
                                    final_files.add(f.name)
                        
                        recent_new_files = final_files - initial_files
                        if recent_new_files:
                            print(f"✅ Found recently created files: {list(recent_new_files)}")
                            for filename in recent_new_files:
                                file_path = self.download_dir / filename
                                if file_path.exists():
                                    file_size = file_path.stat().st_size
                                    print(f"📁 Recently downloaded: {filename} ({file_size} bytes)")
                            return True
                    except Exception as e:
                        print(f"⚠️ Error in final file check: {e}")
                
                # Print status less frequently for small files
                if current_time - last_check_time > 5:  # Every 5 seconds instead of 10
                    elapsed = int(current_time - start_time)
                    current_file_count = len(current_files)
                    print(f"⏱️ Still waiting... ({elapsed}s elapsed, {current_file_count} files in directory)")
                    
                    # For debugging small files, show what files are currently there
                    if elapsed > 10:  # After 10 seconds, show more details
                        print(f"🔍 Current files: {list(current_files)[:3]}{'...' if len(current_files) > 3 else ''}")
                    
                    last_check_time = current_time
                
                time.sleep(check_interval)
                
            except Exception as e:
                print(f"⚠️ Error during download check: {e}")
                time.sleep(0.5)
        
        # Final timeout check - sometimes small files download but we miss them
        print("⚠️ Download timeout reached, doing final check...")
        try:
            final_files = set(f.name for f in self.download_dir.iterdir() if f.is_file() and not f.name.startswith('.'))
            final_new_files = final_files - initial_files
            if final_new_files:
                print(f"✅ Found files after timeout: {list(final_new_files)}")
                for filename in final_new_files:
                    file_path = self.download_dir / filename
                    if file_path.exists():
                        file_size = file_path.stat().st_size
                        print(f"📁 Final check found: {filename} ({file_size} bytes)")
                return True
        except Exception as e:
            print(f"⚠️ Error in final timeout check: {e}")
        
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
        """Download from Google Drive using Selenium"""
        try:
            if not self.driver:
                if not self.setup_driver():
                    return False
            
            print(f"🔗 Opening Google Drive URL: {url}")
            self.driver.get(url)
            time.sleep(5)
            
            # Extract file ID
            file_id = None
            current_url = self.driver.current_url
            
            if '/file/d/' in current_url:
                file_id = current_url.split('/file/d/')[1].split('/')[0]
            elif 'id=' in current_url:
                file_id = current_url.split('id=')[1].split('&')[0]
            
            if not file_id:
                print("❌ Could not extract file ID from URL")
                return False
            
            # Navigate to direct download URL
            direct_url = f"https://drive.google.com/uc?export=download&id={file_id}"
            print(f"🔗 Navigating to direct download URL...")
            self.driver.get(direct_url)
            time.sleep(5)
            
            # Check the current page
            page_source = self.driver.page_source.lower()
            page_title = self.driver.title.lower()
            
            if 'virus scan warning' in page_title or 'virus' in page_source:
                print("⚠️ Virus scan warning detected")
                if self.handle_google_drive_virus_warning():
                    print("✅ Virus warning handled, download should start")
                    time.sleep(3)
                    return self.wait_for_download_completion()
                else:
                    print("❌ Failed to handle virus warning")
                    return False
            else:
                print("✅ No virus warning detected, checking for automatic download...")
                time.sleep(3)
                return self.wait_for_download_completion()
                
        except Exception as e:
            print(f"❌ Error downloading with Selenium: {str(e)}")
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


class MessagesFileHandler(FileSystemEventHandler):
    """Handle file system events for messages.json"""
    def __init__(self, download_manager):
        self.download_manager = download_manager
        self.last_event_time = 0
        
    def on_modified(self, event):
        if event.is_directory:
            return
            
        # Check if it's the messages.json file
        event_path = Path(event.src_path).resolve()
        if event_path != self.download_manager.messages_file:
            return
            
        # Debounce events (avoid multiple triggers)
        current_time = time.time()
        if current_time - self.last_event_time < 3:  # 3 second cooldown
            return
            
        self.last_event_time = current_time
        
        print(f"\n📄 messages.json modified at {datetime.now().strftime('%H:%M:%S')}")
        
        # Add delay to ensure file is fully written
        time.sleep(2)
        
        try:
            self.download_manager.process_new_links()
        except Exception as e:
            print(f"❌ Error processing new links: {e}")


class PollingMonitor:
    """Alternative polling-based monitor for systems where file watching doesn't work well"""
    def __init__(self, download_manager, poll_interval=5):
        self.download_manager = download_manager
        self.poll_interval = poll_interval
        self.running = False
        self.thread = None
    
    def start(self):
        """Start polling"""
        self.running = True
        self.thread = threading.Thread(target=self._poll_loop, daemon=True)
        self.thread.start()
        print(f"🔄 Started polling every {self.poll_interval} seconds")
    
    def stop(self):
        """Stop polling"""
        self.running = False
        if self.thread:
            self.thread.join()
    
    def _poll_loop(self):
        """Main polling loop"""
        while self.running:
            try:
                self.download_manager.process_new_links()
                time.sleep(self.poll_interval)
            except Exception as e:
                print(f"❌ Polling error: {e}")
                time.sleep(self.poll_interval)


def main():
    """Main function to run the automated link downloader"""
    print("🤖 Automated Link Downloader - Enhanced Monitoring")
    print("=" * 60)
    print("Features:")
    print("✅ Smart file change detection")
    print("✅ Thread-safe processing")
    print("✅ Fallback polling mode")
    print("✅ Improved conflict resolution")
    print("=" * 60)
    
    # Initialize the download manager
    download_manager = LinkDownloadManager()
    
    # Process any existing links first
    print("🔍 Processing existing links...")
    download_manager.process_new_links(force=True)
    
    # Ask user for monitoring method
    use_polling = input("\nUse polling mode instead of file watching? (y/n, default: n): ").strip().lower()
    
    if use_polling in ['y', 'yes', '1', 'true']:
        # Use polling mode
        print("\n🔄 Starting polling mode...")
        poll_interval = 10  # Check every 10 seconds
        monitor = PollingMonitor(download_manager, poll_interval)
        monitor.start()
        
        print(f"🟢 Polling every {poll_interval} seconds. Press Ctrl+C to stop.")
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n🛑 Stopping polling...")
            monitor.stop()
    else:
        # Use file watching mode
        print("\n👀 Starting file watching mode...")
        event_handler = MessagesFileHandler(download_manager)
        observer = Observer()
        
        # Watch the directory containing messages.json
        watch_path = download_manager.messages_file.parent
        observer.schedule(event_handler, path=str(watch_path), recursive=False)
        observer.start()
        
        print(f"🟢 Watching {watch_path} for changes. Press Ctrl+C to stop.")
        
        # Also start a background polling as backup
        backup_monitor = PollingMonitor(download_manager, 30)  # Check every 30 seconds as backup
        backup_monitor.start()
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n🛑 Stopping monitoring...")
            observer.stop()
            backup_monitor.stop()
        
        observer.join()
    
    download_manager.cleanup()
    print("👋 Goodbye!")


def run_once():
    """Run the downloader once without monitoring"""
    print("🚀 One-time Link Processing Mode")
    print("=" * 40)
    
    download_manager = LinkDownloadManager()
    
    try:
        download_manager.process_new_links(force=True)
    finally:
        download_manager.cleanup()


def test_file_monitoring():
    """Test if file monitoring is working properly"""
    print("🧪 Testing File Monitoring")
    print("=" * 30)
    
    messages_file = Path("rss/messages.json")
    if not messages_file.exists():
        print("❌ messages.json not found")
        return
    
    print(f"📄 Monitoring: {messages_file.absolute()}")
    
    class TestHandler(FileSystemEventHandler):
        def __init__(self):
            self.events = []
        
        def on_modified(self, event):
            if not event.is_directory:
                event_path = Path(event.src_path).resolve()
                self.events.append((time.time(), event_path))
                print(f"🔔 File modified: {event_path}")
    
    handler = TestHandler()
    observer = Observer()
    observer.schedule(handler, path=str(messages_file.parent), recursive=False)
    observer.start()
    
    print("✅ File monitoring started")
    print("💡 Try modifying messages.json in another program")
    print("💡 Press Ctrl+C to stop test")
    
    try:
        start_time = time.time()
        while time.time() - start_time < 60:  # Run for 1 minute
            time.sleep(1)
            if len(handler.events) > 0:
                print(f"✅ Detected {len(handler.events)} file events")
                for event_time, path in handler.events[-3:]:  # Show last 3 events
                    print(f"   {datetime.fromtimestamp(event_time).strftime('%H:%M:%S')} - {path.name}")
    except KeyboardInterrupt:
        pass
    
    observer.stop()
    observer.join()
    
    if len(handler.events) == 0:
        print("⚠️ No file events detected. Consider using polling mode.")
    else:
        print(f"✅ File monitoring working! Detected {len(handler.events)} events")


def debug_messages_file():
    """Debug the messages.json file to check for links"""
    print("🔍 Debugging messages.json")
    print("=" * 30)
    
    manager = LinkDownloadManager()
    
    print(f"📄 File path: {manager.messages_file}")
    print(f"📄 File exists: {manager.messages_file.exists()}")
    
    if manager.messages_file.exists():
        stat = manager.messages_file.stat()
        print(f"📊 File size: {stat.st_size} bytes")
        print(f"📊 Last modified: {datetime.fromtimestamp(stat.st_mtime)}")
        
        # Extract and show links
        links = manager.extract_links_from_messages()
        print(f"\n🔗 Found {len(links)} links:")
        
        for i, link in enumerate(links[:5], 1):  # Show first 5 links
            processed = manager.is_link_processed(link['url'])
            status = "✅ Processed" if processed else "🆕 New"
            print(f"  {i}. {status} - {link['url'][:60]}...")
            print(f"     Author: {link['author']}, Time: {datetime.fromtimestamp(link['timestamp'])}")
        
        if len(links) > 5:
            print(f"     ... and {len(links) - 5} more")
        
        # Show processed links
        print(f"\n📚 Previously processed: {len(manager.processed_links)} links")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        if sys.argv[1] == '--once':
            run_once()
        elif sys.argv[1] == '--test':
            test_file_monitoring()
        elif sys.argv[1] == '--debug':
            debug_messages_file()
        else:
            print("Usage:")
            print("  python script.py           # Run with monitoring")
            print("  python script.py --once    # Process links once and exit")
            print("  python script.py --test    # Test file monitoring")
            print("  python script.py --debug   # Debug messages.json")
    else:
        main()