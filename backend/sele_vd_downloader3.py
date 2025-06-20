import os
import re
import time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import TimeoutException, NoSuchElementException
import shutil

class SeleniumVideoDownloader:
    def __init__(self, download_dir="media", headless=False):
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
            print("💡 Download chromedriver from: https://chromedriver.chromium.org/")
            return False
    
    def debug_page(self, title="Debug"):
        """Debug helper to save page source and screenshot - Enhanced version"""
        if self.driver:
            try:
                print(f"🔍 {title} - Current URL: {self.driver.current_url}")
                print(f"🔍 {title} - Page title: {self.driver.title}")
                
                # Check current downloads directory
                try:
                    current_files = list(self.download_dir.iterdir())
                    print(f"🔍 {title} - Files in downloads: {len(current_files)}")
                    for file in current_files:
                        if file.is_file():
                            print(f"  📄 {file.name} ({file.stat().st_size} bytes)")
                except Exception as e:
                    print(f"🔍 {title} - Error listing files: {e}")
                
                # Save screenshot
                screenshot_path = self.download_dir / f"debug_screenshot_{title.replace(' ', '_')}_{int(time.time())}.png"
                self.driver.save_screenshot(str(screenshot_path))
                print(f"📸 Screenshot saved: {screenshot_path}")
                
                # Save page source (only if not too large)
                try:
                    page_source = self.driver.page_source
                    if len(page_source) < 1000000:  # Less than 1MB
                        source_path = self.download_dir / f"debug_source_{title.replace(' ', '_')}_{int(time.time())}.html"
                        with open(source_path, 'w', encoding='utf-8') as f:
                            f.write(page_source)
                        print(f"📄 Page source saved: {source_path}")
                    else:
                        print(f"📄 Page source too large ({len(page_source)} chars), skipping")
                except Exception as e:
                    print(f"📄 Error saving page source: {e}")
                    
            except Exception as e:
                print(f"⚠️ Debug error: {e}")
            
    def wait_for_download_completion(self, timeout=300):
        """Wait for download to complete - Fixed version"""
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
        
        print(f"📊 Initial files in download directory: {len(initial_files)}")
        
        # For small files, reduce the check interval
        check_interval = 0.5  # Check every 500ms instead of 1s
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
                        file_path = self.download_dir / filename
                        file_size = current_sizes.get(filename, 0)
                        print(f"📁 Downloaded: {filename} ({file_size} bytes)")
                        if file_path.suffix.lower() in self.video_extensions:
                            print(f"🎬 Video file detected: {filename}")
                    return True
                
                # Check for files that have grown in size (for very quick downloads)
                for filename in current_files & initial_files:
                    if current_sizes.get(filename, 0) > initial_sizes.get(filename, 0):
                        print(f"✅ Existing file updated: {filename}")
                        file_size = current_sizes.get(filename, 0)
                        print(f"📁 Updated file: {filename} ({file_size} bytes)")
                        return True
                
                # Print status every 10 seconds
                if time.time() - last_check_time > 10:
                    elapsed = int(time.time() - start_time)
                    print(f"⏱️ Still waiting... ({elapsed}s elapsed)")
                    print(f"📊 Current files: {len(current_files)}, Initial files: {len(initial_files)}")
                    last_check_time = time.time()
                
                time.sleep(check_interval)
                
            except Exception as e:
                print(f"⚠️ Error during download check: {e}")
                time.sleep(1)
        
        print("⚠️ Download timeout reached")
        
        # Final check - maybe the download completed but we missed it
        try:
            final_files = set(f.name for f in self.download_dir.iterdir() if f.is_file())
            final_new_files = final_files - initial_files
            if final_new_files:
                print(f"✅ Found files that may have been downloaded: {final_new_files}")
                return True
        except Exception as e:
            print(f"⚠️ Error in final check: {e}")
        
        return False

    def handle_google_drive_virus_warning(self):
        """Handle Google Drive virus scan warning page"""
        print("🦠 Handling virus scan warning...")
        
        # Wait a bit for the page to fully load
        time.sleep(3)
        
        # Updated selectors for Google Drive virus warning page
        download_anyway_selectors = [
            # Most common current selector
            "form[action*='confirm'] input[type='submit']",
            "form[action*='confirm'] button",
            "a[href*='confirm=']",
            "a[href*='&confirm=']",
            # Alternative selectors
            "#download-form input[type='submit']",
            "#download-form button",
            "input[value*='Download anyway']",
            "button[value*='Download anyway']",
            "input[name='confirm']",
            "form input[type='submit']",
            # Generic form submission
            "form[method='post'] input[type='submit']",
            "form[method='post'] button[type='submit']",
        ]
        
        # First, try to find and click download anyway button/link
        for selector in download_anyway_selectors:
            try:
                elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                for element in elements:
                    if element.is_displayed():
                        element_text = element.get_attribute('value') or element.text or element.get_attribute('innerHTML')
                        print(f"🔽 Found potential download element: {selector} - '{element_text[:50]}'")
                        
                        try:
                            # Scroll to element
                            self.driver.execute_script("arguments[0].scrollIntoView(true);", element)
                            time.sleep(1)
                            
                            # Try clicking
                            element.click()
                            print("✅ Successfully clicked download element")
                            return True
                            
                        except Exception as click_error:
                            print(f"⚠️ Click failed, trying JavaScript click: {click_error}")
                            try:
                                self.driver.execute_script("arguments[0].click();", element)
                                print("✅ JavaScript click successful")
                                return True
                            except Exception as js_error:
                                print(f"⚠️ JavaScript click also failed: {js_error}")
                                continue
            except Exception as e:
                continue
        
        # Second approach: Look for forms and submit them
        print("🔍 Looking for forms to submit...")
        try:
            forms = self.driver.find_elements(By.TAG_NAME, "form")
            for form in forms:
                form_action = form.get_attribute('action')
                if form_action and ('confirm' in form_action or 'download' in form_action.lower()):
                    print(f"📝 Found form with action: {form_action}")
                    try:
                        # Try to submit the form
                        form.submit()
                        print("✅ Form submitted successfully")
                        return True
                    except Exception as e:
                        print(f"⚠️ Form submission failed: {e}")
                        continue
        except Exception as e:
            print(f"⚠️ Error looking for forms: {e}")
        
        # Third approach: Look for any clickable element with download-related text
        print("🔍 Looking for elements with download text...")
        try:
            download_text_patterns = [
                "download anyway",
                "download",
                "proceed",
                "continue",
                "confirm"
            ]
            
            for pattern in download_text_patterns:
                # Look for links
                xpath_link = f"//a[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '{pattern}')]"
                elements = self.driver.find_elements(By.XPATH, xpath_link)
                
                # Look for buttons and inputs
                xpath_button = f"//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '{pattern}')]"
                elements.extend(self.driver.find_elements(By.XPATH, xpath_button))
                
                xpath_input = f"//input[contains(translate(@value, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '{pattern}')]"
                elements.extend(self.driver.find_elements(By.XPATH, xpath_input))
                
                for element in elements:
                    if element.is_displayed() and element.is_enabled():
                        element_text = element.text or element.get_attribute('value') or element.get_attribute('innerHTML')
                        print(f"🔽 Found element with '{pattern}' text: '{element_text[:50]}'")
                        try:
                            self.driver.execute_script("arguments[0].click();", element)
                            print("✅ Successfully clicked element with download text")
                            return True
                        except Exception as e:
                            print(f"⚠️ Failed to click element: {e}")
                            continue
        except Exception as e:
            print(f"⚠️ Error looking for download text: {e}")
        
        # Fourth approach: Extract download URL from page source
        print("🔍 Looking for download URL in page source...")
        try:
            page_source = self.driver.page_source
            
            # Look for direct download URLs
            import re
            url_patterns = [
                r'href="([^"]*uc\?[^"]*export=download[^"]*)"',
                r'href="([^"]*drive\.usercontent\.google\.com[^"]*)"',
                r'action="([^"]*confirm[^"]*)"',
            ]
            
            for pattern in url_patterns:
                matches = re.findall(pattern, page_source)
                for match in matches:
                    if 'confirm' in match or 'export=download' in match:
                        print(f"🔗 Found download URL in source: {match[:100]}...")
                        # Navigate to the URL
                        self.driver.get(match)
                        print("✅ Navigated to extracted download URL")
                        return True
        except Exception as e:
            print(f"⚠️ Error extracting URL from source: {e}")
        
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
            
            # Wait for page to load
            print("⏳ Waiting for page to load...")
            time.sleep(5)
            
            # Debug the initial page
            self.debug_page("Initial Google Drive page")
            
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
            
            print(f"🆔 File ID extracted: {file_id}")
            
            # Navigate to direct download URL
            direct_url = f"https://drive.google.com/uc?export=download&id={file_id}"
            print(f"🔗 Navigating to direct download URL...")
            self.driver.get(direct_url)
            time.sleep(5)
            
            self.debug_page("After direct URL navigation")
            
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
            
            elif 'quota exceeded' in page_source or 'download quota' in page_source:
                print("❌ Download quota exceeded for this file")
                return False
            
            elif 'permission denied' in page_source or 'access denied' in page_source:
                print("❌ Permission denied - file might be private")
                return False
            
            else:
                # No virus warning, download might start automatically
                print("✅ No virus warning detected, checking for automatic download...")
                time.sleep(3)
                return self.wait_for_download_completion()
                
        except Exception as e:
            print(f"❌ Error downloading with Selenium: {str(e)}")
            self.debug_page("Error state")
            return False
    
    def handle_wetransfer_flow(self):
        """Handle the complete WeTransfer download flow"""
        try:
            # Step 1: Accept cookies if present
            print("🍪 Step 1: Checking for cookie consent...")
            cookie_selectors = [
                "button[data-testid*='accept']",
                "button[data-testid*='cookie']",
                "[data-qa*='cookie'] button",
                ".cookie-consent button",
                "button[aria-label*='Accept']",
                "button[aria-label*='Cookie']",
                "[data-cy*='cookie'] button",
                "button:contains('Accept')",
                ".cookie button",
                "#cookie-consent button"
            ]
            
            cookie_accepted = False
            for selector in cookie_selectors:
                try:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    for element in elements:
                        if element.is_displayed() and element.is_enabled():
                            element_text = element.text or element.get_attribute('aria-label')
                            if any(word in element_text.lower() for word in ['accept', 'cookie', 'agree']):
                                print(f"🍪 Accepting cookies: '{element_text}'")
                                self.driver.execute_script("arguments[0].click();", element)
                                cookie_accepted = True
                                time.sleep(2)
                                break
                    if cookie_accepted:
                        break
                except:
                    continue
            
            if cookie_accepted:
                print("✅ Cookies accepted")
            else:
                print("ℹ️ No cookie consent found or already accepted")
            
            # Step 2: Look for and click "Agree" button
            print("📋 Step 2: Looking for Agree button...")
            agree_selectors = [
                "button[data-testid*='agree']",
                "button[data-qa*='agree']",
                "button[aria-label*='Agree']",
                "button:contains('Agree')",
                "button:contains('I agree')",
                "[data-cy*='agree'] button",
                "button[type='submit']:contains('Agree')",
                ".agree-button",
                "button[class*='agree']"
            ]
            
            agree_clicked = False
            time.sleep(3)  # Wait a bit for page to update after cookie acceptance
            
            for selector in agree_selectors:
                try:
                    # Use XPath for text-based searches
                    if ':contains(' in selector:
                        text = selector.split(':contains(')[1].rstrip(')')
                        xpath_selector = f"//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), {text.lower()})]"
                        elements = self.driver.find_elements(By.XPATH, xpath_selector)
                    else:
                        elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    
                    for element in elements:
                        if element.is_displayed() and element.is_enabled():
                            element_text = element.text or element.get_attribute('aria-label') or element.get_attribute('value')
                            print(f"📋 Found agree element: '{element_text}' using {selector}")
                            try:
                                self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
                                time.sleep(1)
                                self.driver.execute_script("arguments[0].click();", element)
                                agree_clicked = True
                                print("✅ Agree button clicked!")
                                time.sleep(3)  # Wait for page to update
                                break
                            except Exception as e:
                                print(f"⚠️ Failed to click agree button: {e}")
                                continue
                    if agree_clicked:
                        break
                except Exception as e:
                    continue
            
            if not agree_clicked:
                # Alternative: look for any button with "agree" text
                try:
                    agree_xpath = "//button[contains(translate(text(), 'AGREE', 'agree'), 'agree')] | //input[@type='submit' and contains(translate(@value, 'AGREE', 'agree'), 'agree')]"
                    agree_elements = self.driver.find_elements(By.XPATH, agree_xpath)
                    for element in agree_elements:
                        if element.is_displayed() and element.is_enabled():
                            element_text = element.text or element.get_attribute('value')
                            print(f"📋 Found agree element via XPath: '{element_text}'")
                            self.driver.execute_script("arguments[0].click();", element)
                            agree_clicked = True
                            print("✅ Agree button clicked via XPath!")
                            time.sleep(3)
                            break
                except Exception as e:
                    print(f"⚠️ XPath agree search failed: {e}")
            
            if agree_clicked:
                print("✅ Terms agreed to")
                self.debug_page("After agree button")
            else:
                print("ℹ️ No agree button found or already agreed")
            
            # Step 3: Look for download options (prefer plain "Download" over "Scan and Download")
            print("⬇️ Step 3: Looking for download options...")
            time.sleep(3)  # Wait for download options to appear
            
            # First try to find plain "Download" button (preferred)
            download_selectors = [
                # Exact match selectors for plain download
                "button[data-testid='download-button']:not([data-testid*='scan'])",
                "a[data-testid='download-button']:not([data-testid*='scan'])",
                "button[data-qa='download-button']:not([data-qa*='scan'])",
                "a[data-qa='download-button']:not([data-qa*='scan'])",
                # Generic download selectors
                "button[data-testid*='download']",
                "a[data-testid*='download']",
                "[data-testid*='download-files']",
                ".download-button",
                "button[aria-label*='Download']",
                "a[aria-label*='Download']",
                "[class*='download'][role='button']",
                "button[class*='download']",
                "a[class*='download']"
            ]
            
            download_clicked = False
            
            # Look for buttons with just "Download" text (not "Scan and Download")
            try:
                # XPath to find buttons with exact "Download" text
                exact_download_xpath = "//button[normalize-space(translate(text(), 'DOWNLOAD', 'download'))='download'] | //a[normalize-space(translate(text(), 'DOWNLOAD', 'download'))='download']"
                exact_elements = self.driver.find_elements(By.XPATH, exact_download_xpath)
                
                for element in exact_elements:
                    if element.is_displayed() and element.is_enabled():
                        element_text = element.text.strip()
                        print(f"⬇️ Found exact 'Download' button: '{element_text}'")
                        try:
                            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
                            time.sleep(1)
                            self.driver.execute_script("arguments[0].click();", element)
                            download_clicked = True
                            print("✅ Plain Download button clicked!")
                            break
                        except Exception as e:
                            print(f"⚠️ Failed to click plain download: {e}")
                            continue
            except Exception as e:
                print(f"⚠️ Exact download search failed: {e}")
            
            # If plain download not found, try other download selectors
            if not download_clicked:
                for selector in download_selectors:
                    try:
                        elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                        for element in elements:
                            if element.is_displayed() and element.is_enabled():
                                element_text = element.text or element.get_attribute('aria-label') or element.get_attribute('data-testid')
                                # Prefer buttons that don't mention "scan"
                                if element_text and 'scan' not in element_text.lower():
                                    print(f"⬇️ Found download button: '{element_text}' using {selector}")
                                    try:
                                        self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
                                        time.sleep(1)
                                        self.driver.execute_script("arguments[0].click();", element)
                                        download_clicked = True
                                        print("✅ Download button clicked!")
                                        break
                                    except Exception as e:
                                        print(f"⚠️ Failed to click download button: {e}")
                                        continue
                        if download_clicked:
                            break
                    except Exception as e:
                        continue
            
            if not download_clicked:
                print("❌ Could not find download button")
                return False
            
            # Step 4: Handle potential "Allow" button for browser download permission
            print("🔐 Step 4: Checking for Allow/Permission button...")
            time.sleep(3)  # Wait for potential permission dialog
            
            allow_selectors = [
                "button[data-testid*='allow']",
                "button[data-qa*='allow']",
                "button[aria-label*='Allow']",
                "button:contains('Allow')",
                "button[class*='allow']",
                ".permission-button",
                ".allow-button",
                "button[type='button']:contains('Allow')"
            ]
            
            allow_clicked = False
            for selector in allow_selectors:
                try:
                    if ':contains(' in selector:
                        text = selector.split(':contains(')[1].rstrip(')')
                        xpath_selector = f"//button[contains(translate(text(), 'ALLOW', 'allow'), {text.lower()})]"
                        elements = self.driver.find_elements(By.XPATH, xpath_selector)
                    else:
                        elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    
                    for element in elements:
                        if element.is_displayed() and element.is_enabled():
                            element_text = element.text or element.get_attribute('aria-label')
                            print(f"🔐 Found allow button: '{element_text}'")
                            try:
                                self.driver.execute_script("arguments[0].click();", element)
                                allow_clicked = True
                                print("✅ Allow button clicked!")
                                time.sleep(2)
                                break
                            except Exception as e:
                                print(f"⚠️ Failed to click allow button: {e}")
                                continue
                    if allow_clicked:
                        break
                except Exception as e:
                    continue
            
            if allow_clicked:
                print("✅ Permission granted")
            else:
                print("ℹ️ No allow button found (may not be needed)")
            
            return True
            
        except Exception as e:
            print(f"⚠️ Error in WeTransfer flow: {e}")
            return False
    
    def download_wetransfer_selenium(self, url):
        """Download from WeTransfer using Selenium - Improved version"""
        try:
            if not self.driver:
                if not self.setup_driver():
                    return False
            
            print(f"🔗 Opening WeTransfer URL: {url}")
            self.driver.get(url)
            
            # Wait for page to load
            print("⏳ Waiting for WeTransfer page to load...")
            time.sleep(5)  # Reduced from 10 seconds
            
            self.debug_page("WeTransfer initial page")
            
            # Check if download has already started (for direct links)
            initial_files = set(f.name for f in self.download_dir.iterdir() if f.is_file())
            
            # Handle the complete WeTransfer flow
            if self.handle_wetransfer_flow():
                print("✅ WeTransfer flow completed, checking for download...")
                
                # For small files, they might download immediately
                # Check if download started right after clicking
                time.sleep(2)  # Reduced wait time
                
                # Quick check for immediate downloads
                current_files = set(f.name for f in self.download_dir.iterdir() if f.is_file())
                new_files = current_files - initial_files
                
                if new_files:
                    print(f"🚀 Download detected immediately: {list(new_files)}")
                    return True
                
                # Check for .crdownload files
                crdownload_files = list(self.download_dir.glob("*.crdownload"))
                if crdownload_files:
                    print("📥 Download in progress, waiting for completion...")
                    return self.wait_for_download_completion(timeout=60)  # Reduced timeout for small files
                
                # Otherwise wait for download to start/complete
                return self.wait_for_download_completion(timeout=120)  # Reduced timeout
            else:
                print("❌ Failed to complete WeTransfer flow")
                self.debug_page("WeTransfer failed state")
                return False
                
        except Exception as e:
            print(f"❌ Error downloading WeTransfer with Selenium: {str(e)}")
            self.debug_page("WeTransfer error state")
            return False

    def download(self, url):
        """Main download function"""
        print(f"🔗 Processing URL: {url}")
        
        try:
            if 'drive.google.com' in url:
                return self.download_google_drive_selenium(url)
            elif 'wetransfer.com' in url or 'we.tl' in url:
                return self.download_wetransfer_selenium(url)
            else:
                print("❌ Unsupported URL. Only Google Drive and WeTransfer links are supported.")
                return False
        finally:
            # Keep browser open for debugging if not headless
            if self.driver and not self.headless:
                print("🔍 Browser will remain open for 10 seconds for inspection...")
                time.sleep(10)
    
    def cleanup(self):
        """Clean up and close browser"""
        if self.driver:
            self.driver.quit()
            print("🧹 Browser closed")
    
    def __del__(self):
        """Ensure cleanup when object is destroyed"""
        self.cleanup()

def main():
    """Main function to run the Selenium downloader"""
    print("🎬 Selenium Video Downloader - Enhanced & Fixed Version")
    print("=" * 60)
    print("Supports: Google Drive and WeTransfer links")
    print("Features: Enhanced virus warning handling & better error detection")
    print("Requirements: Chrome browser and chromedriver")
    print("Fixed: Google Drive virus scan warning handling")
    print("=" * 60)
    
    # Ask user for headless mode
    headless_input = input("Run in headless mode? (y/n, default: n): ").strip().lower()
    headless = headless_input in ['y', 'yes', '1', 'true']
    
    if not headless:
        print("💡 Running in visible mode - you can see what's happening!")
        print("💡 Screenshots and page source will be saved for debugging")
    
    downloader = SeleniumVideoDownloader(headless=headless)
    
    try:
        while True:
            user_input = input("\n📎 Enter download link (or 'quit' to exit): ").strip()
            
            if user_input.lower() in ['quit', 'exit', 'q']:
                print("👋 Goodbye!")
                break
            
            if not user_input:
                print("⚠️ Please enter a valid URL")
                continue
            
            print(f"\n🚀 Starting download...")
            success = downloader.download(user_input)
            
            if success:
                print(f"📁 Files saved to: {downloader.download_dir.absolute()}")
            else:
                print("❌ Download failed")
                print("💡 Check the debug files (screenshots/HTML) in the downloads folder")
            
            print("-" * 60)
    
    finally:
        downloader.cleanup()

if __name__ == "__main__":
    main()