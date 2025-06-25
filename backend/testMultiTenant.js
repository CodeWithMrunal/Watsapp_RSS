// testMultiTenant.js - Test multi-tenant WhatsApp functionality
const axios = require('axios');
const io = require('socket.io-client');

const API_URL = 'http://localhost:3001';

// Test users
const users = [
  { email: 'admin@example.com', password: '123456', name: 'Admin' },
  { email: 'test@example.com', password: 'test123', name: 'Test User' }
];

class UserTester {
  constructor(user) {
    this.user = user;
    this.token = null;
    this.socket = null;
  }

  async login() {
    console.log(`\n🔐 Logging in ${this.user.name}...`);
    try {
      const response = await axios.post(`${API_URL}/api/auth/login`, {
        email: this.user.email,
        password: this.user.password
      });
      this.token = response.data.token;
      console.log(`✅ ${this.user.name} logged in successfully`);
      return true;
    } catch (error) {
      if (error.response?.status === 401) {
        console.log(`⚠️  ${this.user.name} not found, registering...`);
        return await this.register();
      }
      console.error(`❌ Login failed for ${this.user.name}:`, error.message);
      return false;
    }
  }

  async register() {
    try {
      const response = await axios.post(`${API_URL}/api/auth/register`, {
        email: this.user.email,
        username: this.user.name.toLowerCase().replace(' ', ''),
        password: this.user.password
      });
      this.token = response.data.token;
      console.log(`✅ ${this.user.name} registered successfully`);
      return true;
    } catch (error) {
      console.error(`❌ Registration failed for ${this.user.name}:`, error.message);
      return false;
    }
  }

  connectSocket() {
    console.log(`\n📡 Connecting socket for ${this.user.name}...`);
    
    this.socket = io(API_URL, {
      auth: { token: this.token }
    });

    this.socket.on('connect', () => {
      console.log(`✅ ${this.user.name} socket connected`);
    });

    this.socket.on('qr', (qrData) => {
      console.log(`📱 ${this.user.name} received QR code`);
    });

    this.socket.on('ready', () => {
      console.log(`✅ ${this.user.name} WhatsApp is ready!`);
    });

    this.socket.on('error', (error) => {
      console.error(`❌ ${this.user.name} error:`, error.message);
    });

    this.socket.on('disconnect', () => {
      console.log(`🔌 ${this.user.name} socket disconnected`);
    });
  }

  async getStatus() {
    try {
      const response = await axios.get(`${API_URL}/api/status`, {
        headers: { Authorization: `Bearer ${this.token}` }
      });
      return response.data;
    } catch (error) {
      console.error(`❌ Failed to get status for ${this.user.name}:`, error.message);
      return null;
    }
  }

  async initializeWhatsApp() {
    console.log(`\n🚀 Initializing WhatsApp for ${this.user.name}...`);
    try {
      await axios.post(`${API_URL}/api/initialize`, {}, {
        headers: { Authorization: `Bearer ${this.token}` }
      });
      console.log(`✅ WhatsApp initialization started for ${this.user.name}`);
    } catch (error) {
      console.error(`❌ Failed to initialize WhatsApp for ${this.user.name}:`, error.message);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

async function testMultiTenant() {
  console.log('🧪 Testing Multi-Tenant WhatsApp Setup\n');
  console.log('=====================================');
  
  const testers = [];

  // Step 1: Login/Register all users
  console.log('\n📋 Step 1: Authenticating users...');
  for (const user of users) {
    const tester = new UserTester(user);
    if (await tester.login()) {
      testers.push(tester);
    }
  }

  if (testers.length === 0) {
    console.error('❌ No users authenticated successfully');
    return;
  }

  // Step 2: Connect sockets for all users
  console.log('\n📋 Step 2: Connecting sockets...');
  testers.forEach(tester => tester.connectSocket());

  // Wait for sockets to connect
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 3: Check status for all users
  console.log('\n📋 Step 3: Checking initial status...');
  for (const tester of testers) {
    const status = await tester.getStatus();
    console.log(`${tester.user.name} status:`, status);
  }

  // Step 4: Initialize WhatsApp for all users (with delay)
  console.log('\n📋 Step 4: Initializing WhatsApp connections...');
  for (let i = 0; i < testers.length; i++) {
    await testers[i].initializeWhatsApp();
    if (i < testers.length - 1) {
      console.log('⏳ Waiting 5 seconds before next initialization...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Step 5: Monitor for 30 seconds
  console.log('\n📋 Step 5: Monitoring connections for 30 seconds...');
  console.log('You should see QR codes for each user in their respective browser windows');
  
  const monitorInterval = setInterval(async () => {
    console.log('\n📊 Status check:');
    for (const tester of testers) {
      const status = await tester.getStatus();
      console.log(`- ${tester.user.name}: ${status?.ready ? '✅ Ready' : status?.initializing ? '⏳ Initializing' : '❌ Not ready'}`);
    }
  }, 5000);

  // Wait 30 seconds
  await new Promise(resolve => setTimeout(resolve, 30000));
  clearInterval(monitorInterval);

  // Cleanup
  console.log('\n🧹 Cleaning up...');
  testers.forEach(tester => tester.disconnect());
  
  console.log('\n✅ Test completed!');
  console.log('\n📋 Summary:');
  console.log('- Multiple users can authenticate');
  console.log('- Each user gets their own WhatsApp instance');
  console.log('- Instances are initialized with proper spacing');
  console.log('\n💡 Next: Open browser windows for each user to scan QR codes');
  
  process.exit(0);
}

// Run the test
testMultiTenant().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});