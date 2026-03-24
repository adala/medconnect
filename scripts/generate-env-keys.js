// scripts/generate-env-keys.js

const crypto = require('crypto');

// Generate secure random strings
const jwtSecret = crypto.randomBytes(32).toString('hex');
const encryptionKey = crypto.randomBytes(32).toString('hex');
const dbPassword = crypto.randomBytes(16).toString('hex');
const redisPassword = crypto.randomBytes(16).toString('hex');
const apiKey = crypto.randomBytes(32).toString('hex');

console.log('\n🔐 Generated Secure Keys for OFFIN Healthcare\n');
console.log('Copy these to your .env file:\n');
console.log(`JWT_SECRET=${jwtSecret}`);
console.log(`ENCRYPTION_KEY=${encryptionKey}`);
console.log(`API_KEY=${apiKey}`);
console.log(`DB_PASSWORD=${dbPassword}`);
console.log(`REDIS_PASSWORD=${redisPassword}\n`);
console.log('⚠️  Save these securely and never commit them to git!\n');