// gateway/src/services/EncryptionService.js

const crypto = require('crypto');

class EncryptionService {
    constructor(options = {}) {
        const key = options.key || process.env.ENCRYPTION_KEY;
        
        if (!key || key.length < 32) {
            throw new Error('Encryption key must be at least 32 characters');
        }
        
        // Use a consistent key length (32 bytes for AES-256)
        this.key = crypto.scryptSync(key, 'salt', 32);
        this.algorithm = 'aes-256-gcm';
    }

    /**
     * Encrypt data - always returns a string
     */
    encrypt(data) {
        try {
            // Convert data to string if it's not already
            let stringData;
            if (typeof data === 'string') {
                stringData = data;
            } else if (Buffer.isBuffer(data)) {
                stringData = data.toString('utf8');
            } else if (typeof data === 'object') {
                stringData = JSON.stringify(data);
            } else {
                stringData = String(data);
            }
            
            // Generate a random initialization vector
            const iv = crypto.randomBytes(16);
            
            // Create cipher
            const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
            
            // Encrypt the data
            let encrypted = cipher.update(stringData, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            // Get the auth tag
            const authTag = cipher.getAuthTag();
            
            // Create the encrypted object
            const encryptedObj = {
                iv: iv.toString('hex'),
                authTag: authTag.toString('hex'),
                data: encrypted
            };
            
            // Return as JSON string for storage - ALWAYS RETURN A STRING
            return JSON.stringify(encryptedObj);
        } catch (error) {
            console.error('Encryption failed:', error);
            throw new Error(`Encryption failed: ${error.message}`);
        }
    }

    /**
     * Decrypt data - handles both string and object input
     */
    decrypt(encryptedData) {
        try {
            console.log('🔓 Decrypting data, input type:', typeof encryptedData);
            
            // Parse the encrypted data if it's a string
            let encryptedObj;
            if (typeof encryptedData === 'string') {
                try {
                    encryptedObj = JSON.parse(encryptedData);
                    console.log('✅ Successfully parsed encrypted string to object');
                } catch (parseError) {
                    console.error('Failed to parse encrypted string:', parseError.message);
                    throw new Error(`Invalid encrypted data format: ${parseError.message}`);
                }
            } else if (typeof encryptedData === 'object' && encryptedData !== null) {
                // If it's already an object, use it directly (for backward compatibility)
                encryptedObj = encryptedData;
                console.log('📦 Encrypted data is already an object');
            } else {
                throw new Error('Invalid encrypted data format: expected string or object');
            }
            
            // Validate required fields
            if (!encryptedObj.iv || !encryptedObj.authTag || !encryptedObj.data) {
                console.error('Missing encryption fields:', Object.keys(encryptedObj));
                throw new Error('Missing required encryption fields (iv, authTag, data)');
            }
            
            // Convert hex strings back to buffers
            const iv = Buffer.from(encryptedObj.iv, 'hex');
            const authTag = Buffer.from(encryptedObj.authTag, 'hex');
            const encryptedText = encryptedObj.data;
            
            // Create decipher
            const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
            decipher.setAuthTag(authTag);
            
            // Decrypt the data
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            console.log('✅ Decryption successful, result type:', typeof decrypted);
            
            // Try to parse as JSON if it looks like JSON
            if (decrypted.trim().startsWith('{') || decrypted.trim().startsWith('[')) {
                try {
                    const parsed = JSON.parse(decrypted);
                    console.log('✅ Parsed decrypted data as JSON');
                    return parsed;
                } catch (e) {
                    // Return as string if not valid JSON
                    console.log('Decrypted data is not valid JSON, returning as string');
                    return decrypted;
                }
            }
            
            return decrypted;
        } catch (error) {
            console.error('Decryption failed:', error);
            throw new Error(`Decryption failed: ${error.message}`);
        }
    }

    /**
     * Encrypt a buffer (for files)
     */
    encryptBuffer(buffer) {
        if (!Buffer.isBuffer(buffer)) {
            buffer = Buffer.from(buffer);
        }
        
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
        
        const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
        const authTag = cipher.getAuthTag();
        
        const result = {
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
            data: encrypted.toString('base64')
        };
        
        return JSON.stringify(result);
    }

    /**
     * Decrypt a buffer (for files)
     */
    decryptBuffer(encryptedData) {
        try {
            let encryptedObj;
            if (typeof encryptedData === 'string') {
                encryptedObj = JSON.parse(encryptedData);
            } else {
                encryptedObj = encryptedData;
            }
            
            const iv = Buffer.from(encryptedObj.iv, 'hex');
            const authTag = Buffer.from(encryptedObj.authTag, 'hex');
            const encryptedText = Buffer.from(encryptedObj.data, 'base64');
            
            const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
            decipher.setAuthTag(authTag);
            
            const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
            
            return decrypted;
        } catch (error) {
            console.error('Buffer decryption failed:', error);
            throw error;
        }
    }
}

module.exports = { EncryptionService };