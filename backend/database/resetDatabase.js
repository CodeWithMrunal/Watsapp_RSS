#!/usr/bin/env node

const mongoose = require('mongoose');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');
const dbConnection = require('../database/connection');

// Import all models to ensure they're registered
const Message = require('../database/models/Message');
const Media = require('../database/models/Media');
const { Group, Author, Link } = require('../database/models/Group');
const Analytics = require('../database/models/Analytics');

// Create readline interface for user confirmation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to ask for confirmation
function askConfirmation(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

class DatabaseReset {
  constructor() {
    this.collections = ['messages', 'media', 'groups', 'authors', 'links', 'analytics'];
  }

  async connect() {
    try {
      await dbConnection.connect();
      console.log('✅ Connected to MongoDB');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error.message);
      return false;
    }
  }

  async dropCollections() {
    console.log('\n🗑️  Dropping collections...');
    
    const db = mongoose.connection.db;
    const existingCollections = await db.listCollections().toArray();
    const existingNames = existingCollections.map(col => col.name);
    
    for (const collection of this.collections) {
      if (existingNames.includes(collection)) {
        try {
          await db.dropCollection(collection);
          console.log(`   ✅ Dropped collection: ${collection}`);
        } catch (error) {
          console.error(`   ❌ Error dropping ${collection}:`, error.message);
        }
      } else {
        console.log(`   ⏭️  Collection ${collection} doesn't exist`);
      }
    }
  }

  async recreateCollections() {
    console.log('\n🔨 Recreating collections with schemas...');
    
    try {
      // This will create collections with proper schemas and indexes
      await Message.createCollection();
      console.log('   ✅ Created messages collection');
      
      await Media.createCollection();
      console.log('   ✅ Created media collection');
      
      await Group.createCollection();
      console.log('   ✅ Created groups collection');
      
      await Author.createCollection();
      console.log('   ✅ Created authors collection');
      
      await Link.createCollection();
      console.log('   ✅ Created links collection');
      
      await Analytics.createCollection();
      console.log('   ✅ Created analytics collection');
      
    } catch (error) {
      console.error('❌ Error creating collections:', error);
    }
  }

  async ensureIndexes() {
    console.log('\n🔧 Ensuring indexes...');
    
    try {
      await dbConnection.ensureIndexes();
      console.log('   ✅ All indexes created successfully');
    } catch (error) {
      console.error('   ❌ Error creating indexes:', error);
    }
  }

  async getStats() {
    const stats = {};
    
    for (const collection of this.collections) {
      try {
        const Model = this.getModel(collection);
        if (Model) {
          stats[collection] = await Model.countDocuments();
        }
      } catch (error) {
        stats[collection] = 0;
      }
    }
    
    return stats;
  }

  getModel(collectionName) {
    const models = {
      'messages': Message,
      'media': Media,
      'groups': Group,
      'authors': Author,
      'links': Link,
      'analytics': Analytics
    };
    return models[collectionName];
  }

  async clearMediaFiles(keepFiles = false) {
    if (keepFiles) {
      console.log('\n📁 Keeping media files (only clearing database references)');
      return;
    }

    console.log('\n🗑️  Clearing media files...');
    
    const mediaDir = path.join(__dirname, '..', 'media');
    const mediaJsonPath = path.join(mediaDir, 'media.json');
    
    try {
      // Get list of files to keep
      const filesToKeep = ['.gitkeep', 'media.json'];
      
      if (await fs.pathExists(mediaDir)) {
        const files = await fs.readdir(mediaDir);
        let deletedCount = 0;
        
        for (const file of files) {
          if (!filesToKeep.includes(file) && !file.startsWith('.')) {
            await fs.remove(path.join(mediaDir, file));
            deletedCount++;
          }
        }
        
        console.log(`   ✅ Deleted ${deletedCount} media files`);
      }
      
      // Clear media.json
      if (await fs.pathExists(mediaJsonPath)) {
        await fs.writeJSON(mediaJsonPath, {
          metadata: {
            totalGroups: 0,
            totalMessages: 0,
            totalMedia: 0,
            generatedAt: new Date().toISOString(),
            version: '2.0'
          },
          groups: [],
          mediaByType: {},
          messagesByAuthor: {},
          timeline: {}
        }, { spaces: 2 });
        console.log('   ✅ Reset media.json');
      }
      
    } catch (error) {
      console.error('   ❌ Error clearing media files:', error);
    }
  }

  async clearRSSFiles() {
    console.log('\n📰 Clearing RSS files...');
    
    const rssDir = path.join(__dirname, '..', 'rss');
    
    try {
      if (await fs.pathExists(rssDir)) {
        await fs.emptyDir(rssDir);
        console.log('   ✅ Cleared RSS directory');
      }
    } catch (error) {
      console.error('   ❌ Error clearing RSS files:', error);
    }
  }

  async reset(options = {}) {
    const {
      keepMediaFiles = false,
      clearRSS = true,
      skipConfirmation = false
    } = options;

    console.log('\n🔄 MongoDB Database Reset Tool');
    console.log('================================\n');

    // Show current stats
    console.log('📊 Current database statistics:');
    const beforeStats = await this.getStats();
    
    for (const [collection, count] of Object.entries(beforeStats)) {
      console.log(`   ${collection}: ${count} documents`);
    }
    
    if (!skipConfirmation) {
      console.log('\n⚠️  WARNING: This will DELETE all data in the database!');
      console.log('   Collections to be dropped: ' + this.collections.join(', '));
      
      if (!keepMediaFiles) {
        console.log('   Media files will also be deleted!');
      }
      
      const confirmed = await askConfirmation('\n❓ Are you sure you want to continue? (y/N): ');
      
      if (!confirmed) {
        console.log('\n❌ Reset cancelled by user');
        return false;
      }
    }

    console.log('\n🚀 Starting database reset...');

    // Drop all collections
    await this.dropCollections();
    
    // Recreate collections with schemas
    await this.recreateCollections();
    
    // Ensure indexes
    await this.ensureIndexes();
    
    // Clear media files if requested
    await this.clearMediaFiles(keepMediaFiles);
    
    // Clear RSS files if requested
    if (clearRSS) {
      await this.clearRSSFiles();
    }
    
    // Show final stats
    console.log('\n📊 Final database statistics:');
    const afterStats = await this.getStats();
    
    for (const [collection, count] of Object.entries(afterStats)) {
      console.log(`   ${collection}: ${count} documents`);
    }
    
    console.log('\n✅ Database reset completed successfully!');
    
    return true;
  }
}

// CLI execution
async function main() {
  const reset = new DatabaseReset();
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {
    keepMediaFiles: args.includes('--keep-media'),
    clearRSS: !args.includes('--keep-rss'),
    skipConfirmation: args.includes('--force') || args.includes('-f')
  };
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
MongoDB Database Reset Tool

Usage: node resetDatabase.js [options]

Options:
  --keep-media      Keep media files (only clear database references)
  --keep-rss        Keep RSS files
  --force, -f       Skip confirmation prompt
  --help, -h        Show this help message

Examples:
  node resetDatabase.js                    # Full reset with confirmation
  node resetDatabase.js --force            # Full reset without confirmation
  node resetDatabase.js --keep-media       # Reset database but keep media files
  node resetDatabase.js --keep-media --keep-rss  # Only reset database
`);
    process.exit(0);
  }
  
  // Connect to database
  const connected = await reset.connect();
  if (!connected) {
    process.exit(1);
  }
  
  try {
    // Run reset
    const success = await reset.reset(options);
    
    if (success) {
      console.log('\n💡 Next steps:');
      console.log('   1. Start your WhatsApp monitor');
      console.log('   2. Scan QR code to authenticate');
      console.log('   3. Select a group to monitor');
      console.log('   4. Fetch history or wait for new messages');
      console.log('\n');
    }
    
  } catch (error) {
    console.error('\n❌ Reset failed:', error);
    process.exit(1);
  } finally {
    // Close connections
    rl.close();
    await dbConnection.disconnect();
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = DatabaseReset;