// testAuth.js - Test authentication endpoints
const axios = require('axios');

const API_URL = 'http://localhost:3001';
let authToken = '';

async function testAuth() {
  console.log('🧪 Testing Authentication Endpoints\n');
  
  try {
    // 1. Test health endpoint (public)
    console.log('1️⃣ Testing health endpoint...');
    const health = await axios.get(`${API_URL}/health`);
    console.log('✅ Health check:', health.data);
    console.log('');
    
    // 2. Test registration (uncomment if you want to create a new user)
    // console.log('2️⃣ Testing registration...');
    // const register = await axios.post(`${API_URL}/api/auth/register`, {
    //   email: 'test@example.com',
    //   username: 'testuser',
    //   password: 'password123'
    // });
    // console.log('✅ Registration:', register.data);
    // console.log('');
    
    // 3. Test login
    console.log('3️⃣ Testing login...');
    const login = await axios.post(`${API_URL}/api/auth/login`, {
      email: 'admin@example.com',
      password: '123456'
    });
    console.log('✅ Login successful!');
    console.log('   User:', login.data.user);
    console.log('   Token:', login.data.token.substring(0, 20) + '...');
    authToken = login.data.token;
    console.log('');
    
    // 4. Test authenticated endpoint
    console.log('4️⃣ Testing authenticated endpoint...');
    const me = await axios.get(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log('✅ Get current user:', me.data.user);
    console.log('');
    
    // 5. Test protected API endpoint
    console.log('5️⃣ Testing protected API endpoint...');
    const status = await axios.get(`${API_URL}/api/status`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    console.log('✅ WhatsApp status:', status.data);
    console.log('');
    
    console.log('🎉 All tests passed! Authentication is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run tests
testAuth();