// Test script to verify .env file is loading correctly
require('dotenv').config();

console.log('=== Environment Variable Test ===');
console.log('OPENAI_API_KEY loaded:', !!process.env.OPENAI_API_KEY);
console.log('OPENAI_API_KEY value:', process.env.OPENAI_API_KEY ?
  (process.env.OPENAI_API_KEY.substring(0, 7) + '...') : 'NOT SET');
console.log('PORT:', process.env.PORT || '3000 (default)');
console.log('================================');

if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
  console.log('\n⚠️  WARNING: Please update the OPENAI_API_KEY in your .env file');
  console.log('Get your API key from: https://platform.openai.com/api-keys');
} else {
  console.log('\n✓ Environment variables are configured correctly!');
}
