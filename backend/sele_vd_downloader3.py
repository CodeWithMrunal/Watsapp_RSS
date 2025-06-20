import os
import re
import json
import time
import hashlib
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
        self.messages_file = Path(messages_file)
        self.media_file = Path(media_file)
        self.download_dir = Path(download_dir)
        self.download_dir.mkdir(exist_ok=True)
        
        # Track processed links to avoid duplicates
        self.processed_links = set()
        self.link_to_media_map = {}  # Maps link hash to media file info
        
        # Initialize downloader
        self.downloader = SeleniumVideoDownloader(download_dir=str(self.download_dir), headless=True)
        
        # Load existing processed links
        self.load_processed_links()
        
        print(f"📁 Download directory: {self.download_dir.absolute()}")
        print(f"📄 Messages file: {self.messages_file.absolute()}")
        print(f"📄 Media file: {self.media_file.absolute()}")
    
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
                r'https://drive\.google\.com/file/d/[^/\s]+',
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
                            link_info = {
                                'url': match,
                                'message_id': message['id'],
                                'author': message['author'],
                                'timestamp': message['timestamp'],
                                'message_body': body
                            }
                            links.append(link_info)
            
            print(f"🔍 Found {len(links)} links in messages")
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
                    media_id = f"auto_{int(time.time())}_{file_path.stem}"
                    
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
                        "timestamp": int(time.time()),  # Current timestamp for download time
                        "original_timestamp": link_info['timestamp'],  # Original message timestamp
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
        
        # Get files before download
        files_before = set(f.name for f in self.download_dir.iterdir() if f.is_file())
        
        # Attempt download
        success = self.downloader.download(url)
        
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
    
    def process_new_links(self):
        """Process all new links found in messages.json"""
        links = self.extract_links_from_messages()
        
        if not links:
            print("ℹ️ No links found in messages")
            return
        
        new_links = [link for link in links if not self.is_link_processed(link['url'])]
        
        if not new_links:
            print("ℹ️ No new links to process")
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
    
    def cleanup(self):
        """Clean up resources"""
        if hasattr(self, 'downloader'):
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
        """Wait for download to complete"""
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
        
        check_interval = 0.5
        last_check_time = start_time
        
        while time.time() - start_time < timeout:
            try:
                # Check for .crdownload files (Chrome partial downloads)
                crdownload_files = list(self.download_dir.glob("*.crdownload"))
                if crdownload_files:
                    print(f"📥 Download in progress: {crdownload_files[0].name}")
                    time.sleep(2)
                    continue
                
                # Check for new files
                current_files = set()
                current_sizes = {}
                
                for f in self.download_dir.iterdir():
                    if f.is_file():
                        current_files.add(f.name)
                        current_sizes[f.name] = f.stat().st_size
                
                new_files = current_files - initial_files
                
                if new_files:
                    print(f"✅ Download completed!")
                    for filename in new_files:
                        file_size = current_sizes.get(filename, 0)
                        print(f"📁 Downloaded: {filename} ({file_size} bytes)")
                    return True
                
                # Check for files that have grown in size
                for filename in current_files & initial_files:
                    if current_sizes.get(filename, 0) > initial_sizes.get(filename, 0):
                        print(f"✅ Existing file updated: {filename}")
                        return True
                
                # Print status every 10 seconds
                if time.time() - last_check_time > 10:
                    elapsed = int(time.time() - start_time)
                    print(f"⏱️ Still waiting... ({elapsed}s elapsed)")
                    last_check_time = time.time()
                
                time.sleep(check_interval)
                
            except Exception as e:
                print(f"⚠️ Error during download check: {e}")
                time.sleep(1)
        
        print("⚠️ Download timeout reached")
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
            self.driver.quit()


class MessagesFileHandler(FileSystemEventHandler):
    """Handle file system events for messages.json"""
    def __init__(self, download_manager):
        self.download_manager = download_manager
        self.last_modified = 0
        
    def on_modified(self, event):
        if event.is_directory:
            return
            
        if event.src_path.endswith('messages.json'):
            # Avoid processing the same modification multiple times
            current_time = time.time()
            if current_time - self.last_modified < 2:  # 2 second cooldown
                return
                
            self.last_modified = current_time
            print(f"\n📄 messages.json modified, checking for new links...")
            time.sleep(1)  # Give time for file to be fully written
            
            try:
                self.download_manager.process_new_links()
            except Exception as e:
                print(f"❌ Error processing new links: {e}")


def main():
    """Main function to run the automated link downloader"""
    print("🤖 Automated Link Downloader - Monitoring Mode")
    print("=" * 60)
    print("Features:")
    print("✅ Monitors messages.json for new Google Drive/WeTransfer links")
    print("✅ Automatically downloads videos from detected links")
    print("✅ Updates media.json with download information")
    print("✅ Prevents duplicate downloads")
    print("✅ Runs in background monitoring mode")
    print("=" * 60)
    
    # Initialize the download manager
    download_manager = LinkDownloadManager()
    
    # Process any existing links first
    print("🔍 Processing existing links...")
    download_manager.process_new_links()
    
    # Setup file monitoring
    print("\n👀 Starting file monitoring...")
    event_handler = MessagesFileHandler(download_manager)
    observer = Observer()
    observer.schedule(event_handler, path='.', recursive=False)
    observer.start()
    
    print("🟢 Monitoring started! Watching for changes to messages.json...")
    print("Press Ctrl+C to stop monitoring")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Stopping monitoring...")
        observer.stop()
        download_manager.cleanup()
    
    observer.join()
    print("👋 Goodbye!")


def run_once():
    """Run the downloader once without monitoring"""
    print("🚀 One-time Link Processing Mode")
    print("=" * 40)
    
    download_manager = LinkDownloadManager()
    
    try:
        download_manager.process_new_links()
    finally:
        download_manager.cleanup()


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == '--once':
        run_once()
    else:
        main()