const { syncDatabase, User } = require('../models');
const readline = require('readline');
const bcrypt = require('bcryptjs');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function setup() {
  console.log('🚀 WhatsApp Monitor Multi-Tenant Setup');
  console.log('=====================================\n');

  try {
    // Initialize database
    console.log('📦 Initializing database...');
    await syncDatabase(false); // false = don't drop existing tables
    console.log('✅ Database initialized\n');

    // Check if admin user exists
    const adminExists = await User.findOne({ where: { email: 'admin@example.com' } });
    
    if (!adminExists) {
      console.log('📝 Creating admin user...\n');
      
      const email = await question('Admin email (default: admin@example.com): ') || 'admin@example.com';
      const username = await question('Admin username (default: admin): ') || 'admin';
      const password = await question('Admin password (min 6 chars): ');
      
      if (!password || password.length < 6) {
        console.error('❌ Password must be at least 6 characters');
        process.exit(1);
      }

      const admin = await User.create({
        email,
        username,
        password_hash: password,
        storage_quota_mb: 5120 // 5GB for admin
      });

      console.log('\n✅ Admin user created successfully!');
      console.log(`   Email: ${admin.email}`);
      console.log(`   Username: ${admin.username}`);
    } else {
      console.log('ℹ️  Admin user already exists\n');
    }

    // Create required directories
    console.log('\n📁 Creating required directories...');
    const fs = require('fs-extra');
    const directories = [
      './media',
      './rss',
      './backups',
      './data',
      './.wwebjs_auth'
    ];
    
    directories.forEach(dir => {
      fs.ensureDirSync(dir);
      console.log(`   ✅ ${dir}`);
    });

    // Create .env file if it doesn't exist
    if (!fs.existsSync('.env')) {
      console.log('\n📝 Creating .env file...');
      const envContent = `# Environment
NODE_ENV=development

# Server Configuration
PORT=3001
CORS_ORIGIN=http://localhost:5173

# JWT Configuration
JWT_SECRET=${generateRandomString(32)}
JWT_EXPIRES_IN=7d

# Database
DATABASE_URL=sqlite:./data/whatsapp_monitor.db

# File Upload Limits (in MB)
MAX_FILE_SIZE=100
`;
      fs.writeFileSync('.env', envContent);
      console.log('✅ .env file created (Please review and update as needed)');
    }

    console.log('\n🎉 Setup completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Install dependencies: npm install');
    console.log('2. Review and update .env file');
    console.log('3. Start the server: npm start');
    console.log('4. Update frontend to use authentication');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Run setup
setup();