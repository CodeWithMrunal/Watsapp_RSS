const { Builder, By, until, Options } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

class SeleniumVideoDownloader {
    constructor(downloadDir = 'media', headless = true) {
        this.downloadDir = path.resolve(downloadDir);
        this.headless = headless;
        this.driver = null;
        this.videoExtensions = new Set(['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp']);
    }

    async ensureDirectoryExists() {
        try {
            await fs.mkdir(this.downloadDir, { recursive: true });
        } catch (error) {
            console.error(`Error creating directory: ${error}`);
        }
    }

    async setupDriver() {
        try {
            await this.ensureDirectoryExists();
            
            const chromeOptions = new chrome.Options();
            
            // IMPORTANT: Use absolute path for download directory
            const downloadPath = path.resolve(this.downloadDir);
            
            // Set download preferences
            const prefs = {
                'download.default_directory': downloadPath,
                'download.prompt_for_download': false,
                'download.directory_upgrade': true,
                'safebrowsing.enabled': false,
                'safebrowsing.disable_download_protection': true,
                'profile.default_content_setting_values.notifications': 2,
                'profile.default_content_settings.popups': 0,
                'profile.managed_default_content_settings.images': 2,
                'plugins.always_open_pdf_externally': true
            };
            
            chromeOptions.setUserPreferences(prefs);
            
            // Additional Chrome options
            chromeOptions.addArguments('--no-sandbox');
            chromeOptions.addArguments('--disable-dev-shm-usage');
            chromeOptions.addArguments('--disable-blink-features=AutomationControlled');
            chromeOptions.addArguments('--disable-web-security');
            chromeOptions.addArguments('--allow-running-insecure-content');
            chromeOptions.addArguments('--disable-features=VizDisplayCompositor');
            chromeOptions.addArguments('--disable-gpu');
            chromeOptions.excludeSwitches('enable-automation');
            
            if (this.headless) {
                chromeOptions.addArguments('--headless=new');  // Use new headless mode
            }
            
            // User agent
            chromeOptions.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            this.driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(chromeOptions)
                .build();
                
            // Set download behavior for headless mode
            if (this.headless) {
                const cdp = await this.driver.createCDPConnection('page');
                await cdp.execute('Page.setDownloadBehavior', {
                    behavior: 'allow',
                    downloadPath: downloadPath
                });
            }
                
            await this.driver.executeScript("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})");
            console.log('✅ Chrome driver initialized successfully');
            console.log(`📁 Downloads will be saved to: ${downloadPath}`);
            return true;
            
        } catch (error) {
            console.error(`❌ Error setting up Chrome driver: ${error.message}`);
            console.log('💡 Make sure you have Chrome and chromedriver installed');
            return false;
        }
    }

    async waitForDownloadCompletion(timeout = 1800) {
        console.log('⏳ Waiting for download to complete...');
        const startTime = Date.now();
        
        // Get initial state
        const initialFiles = new Set();
        const initialSizes = {};
        
        try {
            const files = await fs.readdir(this.downloadDir);
            for (const file of files) {
                const filePath = path.join(this.downloadDir, file);
                try {
                    const stats = await fs.stat(filePath);
                    if (stats.isFile()) {
                        initialFiles.add(file);
                        initialSizes[file] = stats.size;
                    }
                } catch (err) {
                    // Ignore stat errors for individual files
                }
            }
        } catch (error) {
            console.log(`⚠️ Error reading initial files: ${error}`);
        }
        
        console.log(`📊 Initial files in directory: ${initialFiles.size}`);
        
        const checkInterval = 2000; // 2 seconds
        let lastCheckTime = startTime;
        let downloadDetected = false;
        let lastProgressTime = startTime;
        const stalledThreshold = 300000; // 5 minutes in milliseconds
        const lastSizes = {};
        
        while (Date.now() - startTime < timeout * 1000) {
            try {
                const currentTime = Date.now();
                
                // Check for .crdownload files (Chrome partial downloads)
                const files = await fs.readdir(this.downloadDir);
                const crdownloadFiles = files.filter(f => f.endsWith('.crdownload'));
                
                if (crdownloadFiles.length > 0) {
                    downloadDetected = true;
                    const currentFile = crdownloadFiles[0];
                    const filePath = path.join(this.downloadDir, currentFile);
                    const stats = await fs.stat(filePath);
                    const fileSize = stats.size;
                    const fileSizeMB = fileSize / (1024 * 1024);
                    
                    // Check if file is still growing
                    const lastSizeKey = `last_size_${currentFile}`;
                    const lastSize = lastSizes[lastSizeKey] || 0;
                    
                    if (fileSize > lastSize) {
                        lastProgressTime = currentTime;
                        lastSizes[lastSizeKey] = fileSize;
                        const growthMB = (fileSize - lastSize) / (1024 * 1024);
                        
                        // Calculate download speed
                        const timeDiff = (currentTime - lastCheckTime) / 1000 || 1;
                        const speedMBps = growthMB / timeDiff;
                        
                        console.log(`📥 Download in progress: ${currentFile} (${fileSizeMB.toFixed(1)} MB, +${growthMB.toFixed(1)} MB, ${speedMBps.toFixed(1)} MB/s)`);
                    } else {
                        const stalledTime = currentTime - lastProgressTime;
                        if (stalledTime > stalledThreshold) {
                            console.log(`⚠️ Download appears stalled for ${Math.floor(stalledTime / 1000)} seconds`);
                            console.log(`📊 File size unchanged at ${fileSizeMB.toFixed(1)} MB`);
                            console.log('🔄 Continuing to wait...');
                        } else {
                            console.log(`📥 Download paused: ${currentFile} (${fileSizeMB.toFixed(1)} MB) - waiting for resume...`);
                        }
                    }
                    
                    await this.sleep(checkInterval);
                    continue;
                }
                
                // Check for .tmp files
                const tmpFiles = files.filter(f => f.endsWith('.tmp'));
                if (tmpFiles.length > 0) {
                    downloadDetected = true;
                    console.log(`📥 Temporary file detected: ${tmpFiles[0]}`);
                    await this.sleep(2000);
                    continue;
                }
                
                // Get current file state
                const currentFiles = new Set();
                const currentSizes = {};
                
                for (const file of files) {
                    if (!file.startsWith('.')) {
                        const filePath = path.join(this.downloadDir, file);
                        try {
                            const stats = await fs.stat(filePath);
                            if (stats.isFile()) {
                                currentFiles.add(file);
                                currentSizes[file] = stats.size;
                            }
                        } catch (error) {
                            // File might have been deleted/moved
                        }
                    }
                }
                
                // Check for new files
                const newFiles = [...currentFiles].filter(f => !initialFiles.has(f));
                
                if (newFiles.length > 0) {
                    console.log('✅ Download completed!');
                    for (const filename of newFiles) {
                        const fileSize = currentSizes[filename] || 0;
                        const fileSizeMB = fileSize / (1024 * 1024);
                        console.log(`📁 Downloaded: ${filename} (${fileSizeMB.toFixed(1)} MB)`);
                    }
                    return true;
                }
                
                // Check for files that have grown
                let progressDetected = false;
                for (const filename of currentFiles) {
                    if (initialFiles.has(filename)) {
                        const oldSize = initialSizes[filename] || 0;
                        const newSize = currentSizes[filename] || 0;
                        if (newSize > oldSize) {
                            downloadDetected = true;
                            progressDetected = true;
                            const growthMB = (newSize - oldSize) / (1024 * 1024);
                            console.log(`📈 File growing: ${filename} (+${growthMB.toFixed(1)} MB)`);
                            initialSizes[filename] = newSize;
                            lastProgressTime = currentTime;
                        }
                    }
                }
                
                // If no download activity after 30 seconds
                if (!downloadDetected && currentTime - startTime > 30000) {
                    console.log('⚠️ No download activity detected after 30 seconds');
                    
                    try {
                        const currentUrl = await this.driver.getCurrentUrl();
                        console.log(`📍 Current URL: ${currentUrl}`);
                        
                        if (currentUrl.includes('drive.google.com')) {
                            console.log('🔍 Still on Google Drive page, checking for download options...');
                            
                            // Try multiple selectors for download buttons
                            const selectors = [
                                "//a[contains(@href, 'export=download')]",
                                "//button[contains(text(), 'Download')]",
                                "//a[contains(text(), 'Download')]",
                                "//button[@aria-label='Download']",
                                "//div[@role='button'][contains(@aria-label, 'Download')]",
                                "//span[contains(text(), 'Download')]/parent::button",
                                "//a[contains(@href, 'download')]"
                            ];
                            
                            let clicked = false;
                            for (const selector of selectors) {
                                try {
                                    const elements = await this.driver.findElements(By.xpath(selector));
                                    console.log(`🔍 Found ${elements.length} elements with selector: ${selector}`);
                                    
                                    for (const element of elements) {
                                        if (await element.isDisplayed()) {
                                            console.log(`🔘 Clicking download element...`);
                                            await this.driver.executeScript("arguments[0].click();", element);
                                            downloadDetected = true;
                                            clicked = true;
                                            break;
                                        }
                                    }
                                    if (clicked) break;
                                } catch (err) {
                                    // Continue with next selector
                                }
                            }
                            
                            if (!clicked) {
                                console.log('❌ Could not find any download button to click');
                            }
                        }
                    } catch (error) {
                        console.log(`⚠️ Error checking current page: ${error.message}`);
                    }
                    
                    if (!downloadDetected) {
                        return false;
                    }
                }
                
                // Print status periodically
                if (currentTime - lastCheckTime > 30000) {
                    const elapsed = Math.floor((currentTime - startTime) / 1000);
                    const elapsedMinutes = Math.floor(elapsed / 60);
                    const elapsedSeconds = elapsed % 60;
                    const timeSinceProgress = Math.floor((currentTime - lastProgressTime) / 1000);
                    
                    console.log(`⏱️ Still waiting... (${elapsedMinutes}m ${elapsedSeconds}s elapsed, last progress: ${timeSinceProgress}s ago)`);
                    console.log(`📊 Files in directory: ${currentFiles.size}`);
                    lastCheckTime = currentTime;
                }
                
                await this.sleep(checkInterval);
                
            } catch (error) {
                console.log(`⚠️ Error during download check: ${error}`);
                await this.sleep(2000);
            }
        }
        
        // Final check after timeout
        console.log(`⚠️ Download timeout reached after ${timeout / 60} minutes`);
        const finalFiles = await fs.readdir(this.downloadDir);
        const finalNewFiles = finalFiles.filter(f => !initialFiles.has(f));
        
        if (finalNewFiles.length > 0) {
            console.log(`✅ Found files after timeout: ${finalNewFiles}`);
            return true;
        }
        
        const crdownloadFiles = finalFiles.filter(f => f.endsWith('.crdownload'));
        if (crdownloadFiles.length > 0) {
            const filePath = path.join(this.downloadDir, crdownloadFiles[0]);
            const stats = await fs.stat(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);
            console.log(`⚠️ Partial download found: ${crdownloadFiles[0]} (${fileSizeMB.toFixed(1)} MB)`);
            console.log('💡 You may want to increase the timeout for very large files');
        }
        
        return false;
    }

    async handleGoogleDriveVirusWarning() {
        console.log('🦠 Handling virus scan warning...');
        await this.sleep(3000);
        
        const downloadAnyawaySelectors = [
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
            "form[method='post'] button[type='submit']"
        ];
        
        for (const selector of downloadAnyawaySelectors) {
            try {
                const elements = await this.driver.findElements(By.css(selector));
                for (const element of elements) {
                    if (await element.isDisplayed()) {
                        try {
                            await this.driver.executeScript("arguments[0].scrollIntoView(true);", element);
                            await this.sleep(1000);
                            await element.click();
                            console.log('✅ Successfully clicked download element');
                            return true;
                        } catch (error) {
                            try {
                                await this.driver.executeScript("arguments[0].click();", element);
                                console.log('✅ JavaScript click successful');
                                return true;
                            } catch (error) {
                                continue;
                            }
                        }
                    }
                }
            } catch (error) {
                continue;
            }
        }
        
        console.log('❌ Could not handle virus warning page');
        return false;
    }

    async downloadGoogleDriveSelenium(url) {
        try {
            if (!this.driver) {
                if (!(await this.setupDriver())) {
                    return false;
                }
            }
            
            console.log(`🔗 Opening Google Drive URL: ${url}`);
            await this.driver.get(url);
            await this.sleep(5000);
            
            // Extract file ID
            let fileId = null;
            const currentUrl = await this.driver.getCurrentUrl();
            
            if (url.includes('/file/d/')) {
                fileId = url.split('/file/d/')[1].split('/')[0];
            } else if (currentUrl.includes('/file/d/')) {
                fileId = currentUrl.split('/file/d/')[1].split('/')[0];
            } else if (currentUrl.includes('id=')) {
                fileId = currentUrl.split('id=')[1].split('&')[0];
            }
            
            if (!fileId) {
                console.log('❌ Could not extract file ID from URL');
                return false;
            }
            
            console.log(`📄 File ID: ${fileId}`);
            
            // Try direct download URL
            const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
            console.log('🔗 Trying direct download URL...');
            await this.driver.get(directUrl);
            await this.sleep(3000);
            
            // Check for virus warning
            const pageSource = await this.driver.getPageSource();
            const pageSourceLower = pageSource.toLowerCase();
            
            if (pageSourceLower.includes('virus scan warning') || 
                pageSourceLower.includes("can't scan this file for viruses")) {
                console.log('⚠️ Virus scan warning detected');
                
                let handled = false;
                
                // Method 1: Look for download anyway button/link
                const downloadSelectors = [
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
                ];
                
                for (const selector of downloadSelectors) {
                    try {
                        const elements = await this.driver.findElements(By.css(selector));
                        for (const element of elements) {
                            if (await element.isDisplayed()) {
                                const href = await element.getAttribute('href');
                                if (href && href.includes('confirm=')) {
                                    console.log(`📎 Found download link: ${href.substring(0, 50)}...`);
                                    await this.driver.get(href);
                                    handled = true;
                                    break;
                                } else {
                                    try {
                                        await element.click();
                                        handled = true;
                                        console.log('✅ Clicked download button');
                                        break;
                                    } catch (error) {
                                        await this.driver.executeScript("arguments[0].click();", element);
                                        handled = true;
                                        console.log('✅ JavaScript clicked download button');
                                        break;
                                    }
                                }
                            }
                        }
                        if (handled) break;
                    } catch (error) {
                        continue;
                    }
                }
                
                // Method 2: Extract confirm parameter
                if (!handled) {
                    console.log('🔍 Extracting confirm parameter from page...');
                    try {
                        const confirmMatch = pageSource.match(/confirm=([a-zA-Z0-9_-]+)/);
                        if (confirmMatch) {
                            const confirmCode = confirmMatch[1];
                            const confirmUrl = `https://drive.google.com/uc?export=download&confirm=${confirmCode}&id=${fileId}`;
                            console.log(`🔗 Found confirm code, navigating to: ${confirmUrl.substring(0, 70)}...`);
                            await this.driver.get(confirmUrl);
                            handled = true;
                        } else {
                            const confirmUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;
                            console.log('🔗 Using fallback confirm URL...');
                            await this.driver.get(confirmUrl);
                            handled = true;
                        }
                    } catch (error) {
                        console.log(`❌ Error extracting confirm parameter: ${error}`);
                    }
                }
                
                if (handled) {
                    console.log('✅ Virus warning bypassed, download should start');
                    await this.sleep(3000);
                    
                    if (await this.waitForDownloadCompletion(1800)) {
                        return true;
                    } else {
                        console.log("⚠️ Download didn't start after handling virus warning");
                    }
                } else {
                    console.log('❌ Could not handle virus warning');
                }
            }
            
            // Check for automatic download
            console.log('🔍 Checking for automatic download...');
            
            if (await this.waitForDownloadCompletion(1800)) {
                return true;
            }
            
            // Try alternative download method
            console.log('🔄 Trying alternative download method...');
            const altUrl = `https://drive.google.com/u/0/uc?export=download&id=${fileId}`;
            await this.driver.get(altUrl);
            await this.sleep(3000);
            
            return await this.waitForDownloadCompletion(1800);
            
        } catch (error) {
            console.error(`❌ Error downloading with Selenium: ${error.message}`);
            console.error(error.stack);
            return false;
        }
    }

    async handleWetransferFlow() {
        try {
            // Accept cookies if present
            const cookieSelectors = [
                "button[data-testid*='accept']",
                "button[data-testid*='cookie']",
                "[data-qa*='cookie'] button",
                ".cookie-consent button",
                "button[aria-label*='Accept']"
            ];
            
            for (const selector of cookieSelectors) {
                try {
                    const elements = await this.driver.findElements(By.css(selector));
                    for (const element of elements) {
                        if (await element.isDisplayed() && await element.isEnabled()) {
                            await this.driver.executeScript("arguments[0].click();", element);
                            await this.sleep(2000);
                            break;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }
            
            // Look for and click "Agree" button
            await this.sleep(3000);
            const agreeXpath = "//button[contains(translate(text(), 'AGREE', 'agree'), 'agree')]";
            try {
                const agreeElements = await this.driver.findElements(By.xpath(agreeXpath));
                for (const element of agreeElements) {
                    if (await element.isDisplayed() && await element.isEnabled()) {
                        await this.driver.executeScript("arguments[0].click();", element);
                        await this.sleep(3000);
                        break;
                    }
                }
            } catch (error) {
                // Continue
            }
            
            // Look for download button
            await this.sleep(3000);
            const exactDownloadXpath = "//button[normalize-space(translate(text(), 'DOWNLOAD', 'download'))='download'] | //a[normalize-space(translate(text(), 'DOWNLOAD', 'download'))='download']";
            
            try {
                const exactElements = await this.driver.findElements(By.xpath(exactDownloadXpath));
                for (const element of exactElements) {
                    if (await element.isDisplayed() && await element.isEnabled()) {
                        await this.driver.executeScript("arguments[0].click();", element);
                        return true;
                    }
                }
            } catch (error) {
                // Continue
            }
            
            return false;
            
        } catch (error) {
            console.log(`⚠️ Error in WeTransfer flow: ${error}`);
            return false;
        }
    }

    async downloadWetransferSelenium(url) {
        try {
            if (!this.driver) {
                if (!(await this.setupDriver())) {
                    return false;
                }
            }
            
            console.log(`🔗 Opening WeTransfer URL: ${url}`);
            await this.driver.get(url);
            await this.sleep(5000);
            
            if (await this.handleWetransferFlow()) {
                console.log('✅ WeTransfer flow completed, checking for download...');
                await this.sleep(2000);
                return await this.waitForDownloadCompletion(120);
            } else {
                console.log('❌ Failed to complete WeTransfer flow');
                return false;
            }
            
        } catch (error) {
            console.error(`❌ Error downloading WeTransfer with Selenium: ${error.message}`);
            return false;
        }
    }

    async download(url) {
        try {
            if (url.includes('drive.google.com')) {
                return await this.downloadGoogleDriveSelenium(url);
            } else if (url.includes('wetransfer.com') || url.includes('we.tl')) {
                return await this.downloadWetransferSelenium(url);
            } else {
                console.log('❌ Unsupported URL. Only Google Drive and WeTransfer links are supported.');
                return false;
            }
        } catch (error) {
            console.error(`❌ Error in download: ${error}`);
            return false;
        }
    }

    async cleanup() {
        if (this.driver) {
            try {
                await this.driver.quit();
                console.log('🧹 Browser closed');
            } catch (error) {
                // Ignore
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

class DatabaseLinkDownloadManager {
    constructor(dbConfig, downloadDir = 'media') {
        this.dbConfig = dbConfig;
        
        // Resolve paths relative to project root
        const baseDir = path.resolve(path.dirname(__filename), '..');
        this.downloadDir = path.resolve(baseDir, downloadDir);
        
        // Track processing state
        this.currentlyProcessing = new Set();
        
        // Thread safety simulation
        this.isProcessing = false;
        
        this.pool = new Pool(this.dbConfig);
        
        console.log(`📁 Download directory: ${this.downloadDir}`);
        console.log(`🗄️ Database: ${this.dbConfig.database || 'N/A'}`);
    }

    async init() {
        await this.ensureDirectoryExists();
        await this.testDbConnection();
    }

    async ensureDirectoryExists() {
        try {
            await fs.mkdir(this.downloadDir, { recursive: true });
        } catch (error) {
            console.error(`Error creating directory: ${error}`);
        }
    }

    async testDbConnection() {
        try {
            const client = await this.pool.connect();
            try {
                const result = await client.query('SELECT COUNT(*) FROM links');
                const count = result.rows[0].count;
                console.log(`✅ Database connected. Found ${count} total links in database.`);
            } finally {
                client.release();
            }
        } catch (error) {
            console.error(`❌ Database connection error: ${error}`);
            throw error;
        }
    }

    async getUnprocessedLinks() {
        try {
            const query = `
                SELECT l.*, m.author_id, m.timestamp, m.body, m.group_id
                FROM links l
                JOIN messages m ON l.message_id = m.id
                WHERE l.processed = 0 
                AND (
                    l.url LIKE '%drive.google.com%' 
                    OR l.url LIKE '%we.tl%' 
                    OR l.url LIKE '%wetransfer.com%'
                )
                ORDER BY m.timestamp ASC
            `;
            
            const result = await this.pool.query(query);
            const links = result.rows;
            
            // Filter out currently processing links
            return links.filter(link => !this.currentlyProcessing.has(link.url));
            
        } catch (error) {
            console.error(`❌ Error fetching unprocessed links: ${error}`);
            return [];
        }
    }

    async markLinkProcessed(linkId, success = true) {
        try {
            await this.pool.query(
                'UPDATE links SET processed = 1 WHERE id = $1',
                [linkId]
            );
            console.log(`✅ Marked link ${linkId} as processed`);
        } catch (error) {
            console.error(`❌ Error marking link as processed: ${error}`);
        }
    }

    async calculateFileHash(filePath) {
        const hash = crypto.createHash('md5');
        const stream = require('fs').createReadStream(filePath);
        
        return new Promise((resolve, reject) => {
            stream.on('data', data => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    }

    getMimetype(extension) {
        const mimeTypes = {
            '.mp4': 'video/mp4',
            '.avi': 'video/x-msvideo',
            '.mov': 'video/quicktime',
            '.mkv': 'video/x-matroska',
            '.webm': 'video/webm',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.pdf': 'application/pdf'
        };
        return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
    }

    async updateMediaTable(linkInfo, downloadedFiles) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Column names from database
            const createdCol = 'createdAt';
            const updatedCol = 'updatedAt';
            
            console.log(`📝 Using correct column names from database: ${createdCol}, ${updatedCol}`);
            
            for (const filePath of downloadedFiles) {
                const stats = await fs.stat(filePath);
                if (!stats.isFile()) continue;
                
                const fileSize = stats.size;
                const fileExtension = path.extname(filePath).toLowerCase();
                const fileName = path.basename(filePath);
                
                // Determine media type
                const videoExtensions = new Set(['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp']);
                const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);
                
                let mediaType = 'document';
                if (videoExtensions.has(fileExtension)) {
                    mediaType = 'video';
                } else if (imageExtensions.has(fileExtension)) {
                    mediaType = 'image';
                }
                
                // Generate file hash
                const fileHash = await this.calculateFileHash(filePath);
                
                // Check if media record exists
                const existingResult = await client.query(
                    'SELECT id FROM media WHERE message_id = $1',
                    [linkInfo.message_id]
                );
                
                const mediaMetadata = {
                    source_link: linkInfo.url,
                    download_date: new Date().toISOString(),
                    auto_downloaded: true,
                    downloaded_by: 'selenium_scraper'
                };
                
                if (existingResult.rows.length > 0) {
                    // Update existing record
                    const updateQuery = `
                        UPDATE media SET
                            file_path = $1,
                            filename = $2,
                            file_size = $3,
                            file_hash = $4,
                            mimetype = $5,
                            media_type = $6,
                            saved_at = $7,
                            metadata = $8,
                            "${updatedCol}" = NOW()
                        WHERE message_id = $9
                    `;
                    
                    await client.query(updateQuery, [
                        `media/${fileName}`,
                        fileName,
                        fileSize,
                        fileHash,
                        this.getMimetype(fileExtension),
                        mediaType,
                        new Date(),
                        JSON.stringify(mediaMetadata),
                        linkInfo.message_id
                    ]);
                    
                    console.log(`📝 Updated existing media record for message ${linkInfo.message_id}`);
                } else {
                    // Insert new record
                    const insertQuery = `
                        INSERT INTO media (
                            id, message_id, file_path, filename, original_filename,
                            file_size, file_hash, mimetype, media_type,
                            is_voice_note, saved_at, metadata, "${createdCol}", "${updatedCol}"
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
                        )
                    `;
                    
                    await client.query(insertQuery, [
                        uuidv4(),
                        linkInfo.message_id,
                        `media/${fileName}`,
                        fileName,
                        fileName,
                        fileSize,
                        fileHash,
                        this.getMimetype(fileExtension),
                        mediaType,
                        false,
                        new Date(),
                        JSON.stringify(mediaMetadata)
                    ]);
                    
                    console.log(`📄 Inserted new media record for message ${linkInfo.message_id}`);
                }
            }
            
            await client.query('COMMIT');
            console.log(`✅ Updated media table with ${downloadedFiles.length} entries`);
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ Error updating media table: ${error}`);
            console.error(error.stack);
        } finally {
            client.release();
        }
    }

    async downloadLink(linkInfo) {
        const url = linkInfo.url;
        
        // Mark as currently processing
        if (this.currentlyProcessing.has(url)) {
            console.log(`⏭️ Link already being processed: ${url.substring(0, 50)}...`);
            return false;
        }
        this.currentlyProcessing.add(url);
        
        try {
            console.log(`⬇️ Downloading: ${url}`);
            console.log(`👤 Author: ${linkInfo.author_id}`);
            console.log(`📅 Message time: ${linkInfo.timestamp}`);
            
            // Create a new downloader instance
            const downloader = new SeleniumVideoDownloader(this.downloadDir, true);
            await downloader.ensureDirectoryExists();
            
            try {
                // Get files before download
                const filesBefore = new Set(await fs.readdir(this.downloadDir));
                
                // Attempt download
                const success = await downloader.download(url);
                
                if (success) {
                    // Get files after download
                    const filesAfter = new Set(await fs.readdir(this.downloadDir));
                    const newFiles = [...filesAfter].filter(f => !filesBefore.has(f));
                    
                    if (newFiles.length > 0) {
                        const downloadedFiles = newFiles.map(f => path.join(this.downloadDir, f));
                        console.log(`✅ Downloaded ${newFiles.length} file(s): ${newFiles}`);
                        
                        // Update media table
                        await this.updateMediaTable(linkInfo, downloadedFiles);
                        
                        // Mark link as processed
                        await this.markLinkProcessed(linkInfo.id);
                        return true;
                    } else {
                        console.log('⚠️ Download reported success but no new files found');
                        await this.markLinkProcessed(linkInfo.id);
                        return false;
                    }
                } else {
                    console.log(`❌ Failed to download: ${url}`);
                    await this.markLinkProcessed(linkInfo.id);
                    return false;
                }
                
            } catch (error) {
                console.error(`❌ Error downloading ${url}: ${error}`);
                await this.markLinkProcessed(linkInfo.id);
                return false;
            } finally {
                await downloader.cleanup();
            }
            
        } finally {
            this.currentlyProcessing.delete(url);
        }
    }

    async processNewLinks() {
        if (this.isProcessing) {
            console.log('⏳ Already processing links, skipping...');
            return;
        }
        
        this.isProcessing = true;
        
        try {
            console.log('🔄 Checking for new links...');
            
            const links = await this.getUnprocessedLinks();
            
            if (links.length === 0) {
                console.log('ℹ️ No unprocessed links found');
                return;
            }
            
            console.log(`🆕 Found ${links.length} unprocessed links to download`);
            
            for (let i = 0; i < links.length; i++) {
                const linkInfo = links[i];
                console.log(`\n📥 Processing link ${i + 1}/${links.length}`);
                console.log('-'.repeat(50));
                
                try {
                    await this.downloadLink(linkInfo);
                    // Small delay between downloads
                    await this.sleep(2000);
                } catch (error) {
                    console.error(`❌ Error processing link ${linkInfo.url}: ${error}`);
                    await this.markLinkProcessed(linkInfo.id);
                    continue;
                }
            }
            
            console.log(`\n✅ Finished processing ${links.length} links`);
            
        } finally {
            this.isProcessing = false;
        }
    }

    async cleanup() {
        await this.pool.end();
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

class DatabasePollingMonitor {
    constructor(downloadManager, pollInterval = 10) {
        this.downloadManager = downloadManager;
        this.pollInterval = pollInterval * 1000; // Convert to milliseconds
        this.running = false;
        this.intervalId = null;
    }

    start() {
        this.running = true;
        console.log(`🔄 Started polling database every ${this.pollInterval / 1000} seconds`);
        
        this.intervalId = setInterval(async () => {
            if (this.running) {
                try {
                    await this.downloadManager.processNewLinks();
                } catch (error) {
                    console.error(`❌ Polling error: ${error}`);
                }
            }
        }, this.pollInterval);
    }

    stop() {
        this.running = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}

async function main() {
    console.log('🤖 Automated Link Downloader - Database Version');
    console.log('='.repeat(60));
    console.log('Features:');
    console.log('✅ PostgreSQL database monitoring');
    console.log('✅ Thread-safe processing');
    console.log('✅ Automatic \'processed\' flag updates');
    console.log('✅ Media table population with metadata');
    console.log('✅ Duplicate download prevention');
    console.log('='.repeat(60));
    
    // Database configuration from environment variables
    const dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'default_db',
        user: process.env.DB_USER || '',
        password: process.env.DB_PASSWORD || ''
    };
    
    try {
        // Initialize the download manager
        const downloadManager = new DatabaseLinkDownloadManager(dbConfig);
        await downloadManager.init();
        
        // Process any existing links first
        console.log('\n🔍 Processing existing unprocessed links...');
        await downloadManager.processNewLinks();
        
        // Wait a bit before starting polling to ensure the first batch is done
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Start polling mode
        console.log('\n🔄 Starting database polling mode...');
        const pollInterval = 10; // Check every 10 seconds
        
        const monitor = new DatabasePollingMonitor(downloadManager, pollInterval);
        monitor.start();
        
        console.log(`🟢 Polling database every ${pollInterval} seconds. Press Ctrl+C to stop.`);
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Stopping polling...');
            monitor.stop();
            await downloadManager.cleanup();
            console.log('👋 Service stopped!');
            process.exit(0);
        });
        
        // Keep the process running
        await new Promise(() => {}); // This will run indefinitely
        
    } catch (error) {
        console.error(`❌ Fatal error: ${error}`);
        console.error(error.stack);
        process.exit(1);
    }
}

// Export classes for potential reuse
module.exports = {
    SeleniumVideoDownloader,
    DatabaseLinkDownloadManager,
    DatabasePollingMonitor
};

// Run the main function if this file is executed directly
if (require.main === module) {
    main();
}