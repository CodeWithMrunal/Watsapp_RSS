#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const dbConnection = require('./connection');
const JSONToMongoDBMigrator = require('./migrations/migrateFromJSON');

async function setup() {
  console.log('🚀 WhatsApp Monitor MongoDB Setup\n');

  try {
    // 1. Check Node.js version
    console.log('1️⃣ Checking Node.js version...');
    const nodeVersion = process.version;
    console.log(`   ✅ Node.js ${nodeVersion} detected`);

    // 2. Install dependencies
    console.log('\n2️⃣ Installing dependencies...');
    execSync('npm install mongoose dotenv', { stdio: 'inherit' });
    console.log('   ✅ Dependencies installed');

    // 3. Create .env file if it doesn't exist
//     console.log('\n3️⃣ Setting up environment...');
//     const envPath = path.join(__dirname, 'backend', '.env');
//     if (!await fs.pathExists(envPath)) {
//       const envContent = `# MongoDB Configuration
// MONGODB_URI=mongodb://localhost:27017/whatsapp-monitor
// MONGODB_USER=
// MONGODB_PASS=

// # Server Configuration
// PORT=3000
// NODE_ENV=development

// # Logging
// LOG_LEVEL=info
// `;
//       await fs.writeFile(envPath, envContent);
//       console.log('   ✅ Created .env file');
//     } else {
//       console.log('   ✅ .env file already exists');
//     }

    // 4. Create directory structure
    console.log('\n4️⃣ Creating directory structure...');
    const directories = [
      'backend/database/models',
      'backend/database/migrations',
      'backend/media/thumbnails',
      'backend/logs',
      'backend/backups',
      'backend/temp'
    ];

    for (const dir of directories) {
      await fs.ensureDir(path.join(__dirname, dir));
    }
    console.log('   ✅ Directory structure created');

    // 5. Test MongoDB connection
    console.log('\n5️⃣ Testing MongoDB connection...');
    const connected = await dbConnection.connect();
    if (connected) {
      console.log('   ✅ MongoDB connection successful');
      
      // Get database health
      const health = await dbConnection.healthCheck();
      console.log(`   📊 Database status: ${health.status}`);
      console.log(`   📍 Host: ${health.host}`);
      console.log(`   💾 Collections: ${health.collections || 0}`);
    } else {
      throw new Error('Failed to connect to MongoDB');
    }

    // 6. Ensure indexes
    console.log('\n6️⃣ Creating database indexes...');
    await dbConnection.ensureIndexes();
    console.log('   ✅ Database indexes created');

    // 7. Ask about data migration
    // console.log('\n7️⃣ Data Migration');
    // console.log('   Do you want to migrate existing JSON data to MongoDB?');
    // console.log('   Run: npm run migrate\n');

    // 8. Create npm scripts
    // console.log('8️⃣ Adding npm scripts...');
    // const packageJsonPath = path.join(__dirname, 'backend', 'package.json');
    // if (await fs.pathExists(packageJsonPath)) {
    //   const packageJson = await fs.readJSON(packageJsonPath);
      
    //   packageJson.scripts = {
    //     ...packageJson.scripts,
    //     'setup': 'node ../setup-mongodb.js',
    //     'migrate': 'node database/migrations/migrateFromJSON.js',
    //     'migrate:clear': 'node database/migrations/migrateFromJSON.js --clear',
    //     'db:health': 'node -e "require(\'./database/connection\').connect().then(c => c.healthCheck()).then(console.log)"',
    //     'generate:analytics': 'node scripts/generateAnalytics.js',
    //     'rss:generate': 'node scripts/generateRSS.js'
    //   };
      
    //   await fs.writeJSON(packageJsonPath, packageJson, { spaces: 2 });
    //   console.log('   ✅ npm scripts added');
    // }

    // console.log('\n✅ Setup completed successfully!\n');
    // console.log('📝 Next steps:');
    // console.log('   1. Make sure MongoDB is running');
    // console.log('   2. Run "npm run migrate" to import existing data');
    // console.log('   3. Update your Server.js to use MongoDB models');
    // console.log('   4. Start your application\n');

  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  } finally {
    await dbConnection.disconnect();
  }
}

// Interactive migration
// async function interactiveMigrate() {
//   console.log('\n🔄 Starting interactive migration...\n');
  
//   const migrator = new JSONToMongoDBMigrator();
  
//   // Check for JSON files
//   const messagesPath = path.join(__dirname, 'backend', 'messages.json');
//   const mediaPath = path.join(__dirname, 'backend', 'media', 'media.json');
  
//   console.log('📁 Checking for JSON files...');
//   const messagesExist = await fs.pathExists(messagesPath);
//   const mediaExist = await fs.pathExists(mediaPath);
  
//   console.log(`   Messages: ${messagesExist ? '✅ Found' : '❌ Not found'} at ${messagesPath}`);
//   console.log(`   Media: ${mediaExist ? '✅ Found' : '❌ Not found'} at ${mediaPath}`);
  
//   if (!messagesExist && !mediaExist) {
//     console.log('\n❌ No data files found to migrate');
//     return;
//   }
  
//   // Run migration
//   const options = {
//     messagesPath: messagesExist ? messagesPath : null,
//     mediaPath: mediaExist ? mediaPath : null,
//     clearExisting: process.argv.includes('--clear'),
//     generateAnalytics: true
//   };
  
//   await migrator.migrate(options);
// }

// // Generate sample RSS
// async function generateSampleRSS() {
//   console.log('\n📰 Generating sample RSS feed...\n');
  
//   try {
//     await dbConnection.connect();
    
//     const RSSManagerDB = require('./backend/services/RSSManagerDB');
//     const rssManager = new RSSManagerDB();
    
//     // Generate feed for today
//     await rssManager.generateDailyFeed();
    
//     console.log('✅ Sample RSS feed generated at backend/rss/feed.xml');
//   } catch (error) {
//     console.error('❌ Failed to generate RSS:', error);
//   } finally {
//     await dbConnection.disconnect();
//   }
// }

// Main execution
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'migrate':
      interactiveMigrate();
      break;
    case 'rss':
      generateSampleRSS();
      break;
    default:
      setup();
  }
}