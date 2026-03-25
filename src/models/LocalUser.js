// gateway/src/models/LocalUser.js

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class LocalUser {
    constructor(db, encryption) {
        this.db = db;
        this.encryption = encryption;
    }

    async initialize() {
        // Create users table if not exists
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS local_users (
                id TEXT PRIMARY KEY,
                cloud_id TEXT UNIQUE,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                first_name TEXT,
                last_name TEXT,
                role TEXT,
                permissions TEXT,
                tenant_id TEXT NOT NULL,
                last_login DATETIME,
                last_login_ip TEXT,
                password_changed_at DATETIME,
                requires_password_change BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT true,
                is_locked BOOLEAN DEFAULT false,
                failed_attempts INTEGER DEFAULT 0,
                locked_until DATETIME,
                created_at DATETIME,
                updated_at DATETIME,
                synced_at DATETIME
            )
        `);

        // Create sessions table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS local_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                token TEXT UNIQUE NOT NULL,
                expires_at DATETIME NOT NULL,
                last_activity DATETIME,
                ip_address TEXT,
                user_agent TEXT,
                created_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES local_users (id) ON DELETE CASCADE
            )
        `);

        // Create login attempts table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                email TEXT NOT NULL,
                ip_address TEXT,
                success BOOLEAN,
                attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes
        await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON local_users(email);
            CREATE INDEX IF NOT EXISTS idx_users_cloud_id ON local_users(cloud_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_token ON local_sessions(token);
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON local_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);
            CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted ON login_attempts(attempted_at);
        `);
    }

    // ==================== CRUD Operations ====================

    async create(userData) {
        const {
            id,
            cloud_id,
            email,
            password_hash,
            first_name,
            last_name,
            role,
            permissions,
            tenant_id,
            requires_password_change = false,
            is_active = true,
            is_locked = false,
            created_at,
            synced_at
        } = userData;

        // Validate required fields
        if (!email) {
            throw new Error('Email is required');
        }
        if (!password_hash) {
            throw new Error('Password hash is required');
        }
        if (!tenant_id) {
            throw new Error('Tenant ID is required');
        }

        const now = new Date().toISOString();
        const userId = id || crypto.randomUUID();

        try {
            // Check if user already exists
            const existing = await this.findByEmail(email);
            if (existing) {
                throw new Error(`User with email ${email} already exists`);
            }

            const result = await this.db.run(
                `INSERT INTO local_users (
                    id, cloud_id, email, password_hash, first_name, last_name,
                    role, permissions, tenant_id, requires_password_change,
                    is_active, is_locked, created_at, updated_at, synced_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    cloud_id || null,
                    email,
                    password_hash,
                    first_name || null,
                    last_name || null,
                    role || 'user',
                    permissions || JSON.stringify([]),
                    tenant_id,
                    requires_password_change ? 1 : 0,
                    is_active ? 1 : 0,
                    is_locked ? 1 : 0,
                    created_at || now,
                    now,
                    synced_at || null
                ]
            );

            console.log(`✅ Created new user: ${email} (ID: ${userId})`);
            
            // Return the created user
            return this.findById(userId);

        } catch (error) {
            console.error('Error creating user:', error);
            throw error;
        }
    }

    async findById(id) {
        return this.db.get(
            'SELECT * FROM local_users WHERE id = ?',
            id
        );
    }

    async findByEmail(email) {
        return this.db.get(
            'SELECT * FROM local_users WHERE email = ?',
            email
        );
    }

    async findByCloudId(cloudId) {
        return this.db.get(
            'SELECT * FROM local_users WHERE cloud_id = ?',
            cloudId
        );
    }

    async findAll(limit = 100, offset = 0) {
        return this.db.all(
            `SELECT * FROM local_users 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [limit, offset]
        );
    }

    async update(id, updates) {
        const allowedFields = [
            'first_name', 'last_name', 'role', 'permissions',
            'requires_password_change', 'is_active', 'is_locked',
            'locked_until', 'last_login', 'last_login_ip',
            'password_changed_at', 'password_hash', 'synced_at'
        ];

        const sets = [];
        const values = [];

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                sets.push(`${key} = ?`);
                values.push(value);
            }
        }

        if (sets.length === 0) return null;

        values.push(new Date().toISOString(), id);

        await this.db.run(
            `UPDATE local_users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`,
            values
        );

        return this.findById(id);
    }

    async delete(id) {
        await this.db.run('DELETE FROM local_users WHERE id = ?', id);
        // Also delete related sessions
        await this.db.run('DELETE FROM local_sessions WHERE user_id = ?', id);
        return true;
    }

    // ==================== Count Methods ====================

    async getCount(where = {}) {
        let query = 'SELECT COUNT(*) as count FROM local_users';
        const params = [];

        if (Object.keys(where).length > 0) {
            const conditions = [];
            for (const [key, value] of Object.entries(where)) {
                conditions.push(`${key} = ?`);
                params.push(value);
            }
            query += ' WHERE ' + conditions.join(' AND ');
        }

        const result = await this.db.get(query, params);
        return result.count;
    }

    async getActiveCount() {
        return this.getCount({ is_active: 1 });
    }

    async getLockedCount() {
        return this.getCount({ is_locked: 1 });
    }

    // ==================== Authentication Methods ====================

    async authenticate(email, password) {
        try {
            // Find user by email
            const user = await this.findByEmail(email);
            
            if (!user) {
                console.log(`Authentication failed: User not found - ${email}`);
                return null;
            }

            // Check if user is active
            if (!user.is_active) {
                console.log(`Authentication failed: User inactive - ${email}`);
                return null;
            }

            // Check if user is locked
            if (user.is_locked) {
                if (user.locked_until && new Date(user.locked_until) > new Date()) {
                    console.log(`Authentication failed: User locked until ${user.locked_until}`);
                    return null;
                } else {
                    // Unlock user if lock period expired
                    await this.unlockUser(user.id);
                }
            }

            // Validate password
            const isValid = await this.validatePassword(user, password);
            
            if (!isValid) {
                // Increment failed attempts
                await this.incrementFailedAttempts(user.id);
                console.log(`Authentication failed: Invalid password for ${email}`);
                return null;
            }

            // Reset failed attempts on successful login
            await this.resetFailedAttempts(user.id);
            
            console.log(`Authentication successful: ${email}`);
            return user;
            
        } catch (error) {
            console.error('Authentication error:', error);
            return null;
        }
    }

    async validatePassword(user, password) {
        if (!user || !user.password_hash) return false;
        return bcrypt.compare(password, user.password_hash);
    }

    async hashPassword(password) {
        return bcrypt.hash(password, 10);
    }

    async changePassword(userId, currentPassword, newPassword) {
        const user = await this.findById(userId);
        
        if (!user) {
            throw new Error('User not found');
        }

        // Verify current password
        const isValid = await this.validatePassword(user, currentPassword);
        if (!isValid) {
            throw new Error('Current password is incorrect');
        }

        // Hash new password
        const hashedPassword = await this.hashPassword(newPassword);
        
        // Update password
        await this.update(userId, {
            password_hash: hashedPassword,
            password_changed_at: new Date().toISOString(),
            requires_password_change: false
        });
        
        // Destroy all other sessions
        return true;
    }

    async recordLoginAttempt(email, ip, success, userId = null) {
        await this.db.run(
            `INSERT INTO login_attempts (user_id, email, ip_address, success, attempted_at)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, email, ip, success ? 1 : 0, new Date().toISOString()]
        );
    }

    async updateLastLogin(userId, ip) {
        await this.update(userId, {
            last_login: new Date().toISOString(),
            last_login_ip: ip
        });
    }

    async getRecentFailures(email, minutes = 15) {
        const since = new Date(Date.now() - minutes * 60000).toISOString();

        const result = await this.db.get(
            `SELECT COUNT(*) as count FROM login_attempts
             WHERE email = ? AND success = 0 AND attempted_at > ?`,
            [email, since]
        );

        return result.count;
    }

    async incrementFailedAttempts(userId) {
        const user = await this.findById(userId);
        if (!user) return;

        const newAttempts = (user.failed_attempts || 0) + 1;
        
        // Lock user after 5 failed attempts
        if (newAttempts >= 5) {
            await this.lockUser(userId, 30);
        } else {
            await this.update(userId, { failed_attempts: newAttempts });
        }
    }

    async resetFailedAttempts(userId) {
        await this.update(userId, { failed_attempts: 0 });
    }

    async lockUser(userId, minutes = 30) {
        const lockedUntil = new Date(Date.now() + minutes * 60000).toISOString();

        await this.update(userId, {
            is_locked: true,
            locked_until: lockedUntil
        });
        
        console.log(`User ${userId} locked until ${lockedUntil}`);
    }

    async unlockUser(userId) {
        await this.update(userId, {
            is_locked: false,
            locked_until: null,
            failed_attempts: 0
        });
        
        console.log(`User ${userId} unlocked`);
    }

    // ==================== Session Methods ====================

    async createSession(userId, ip, userAgent, duration = 24 * 60 * 60 * 1000) {
        const sessionId = crypto.randomUUID();
        const token = crypto.randomBytes(48).toString('hex');
        const expiresAt = new Date(Date.now() + duration).toISOString();
        const now = new Date().toISOString();

        await this.db.run(
            `INSERT INTO local_sessions (id, user_id, token, expires_at, ip_address, user_agent, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [sessionId, userId, token, expiresAt, ip, userAgent, now]
        );

        return { sessionId, token, expiresAt };
    }

    async validateSession(token) {
        if (!token) {
            console.log('validateSession: No token provided');
            return null;
        }

        console.log('validateSession: Validating token:', token.substring(0, 20) + '...');

        const session = await this.db.get(
            `SELECT s.*, u.* FROM local_sessions s
             JOIN local_users u ON s.user_id = u.id
             WHERE s.token = ? AND s.expires_at > ? AND u.is_active = 1 AND u.is_locked = 0`,
            [token, new Date().toISOString()]
        );

        if (session) {
            console.log('validateSession: Session found for user:', session.user_id);

            // Update last activity
            await this.db.run(
                'UPDATE local_sessions SET last_activity = ? WHERE id = ?',
                [new Date().toISOString(), session.id]
            );

            return session;
        } else {
            console.log('validateSession: No valid session found for token');
            return null;
        }
    }

    async destroySession(token) {
        try {
            if (!token) {
                console.log('destroySession: No token provided');
                return false;
            }

            console.log('destroySession: Destroying session for token');

            const result = await this.db.run(
                'DELETE FROM local_sessions WHERE token = ?',
                token
            );

            console.log('destroySession: Rows affected:', result.changes);
            return result.changes > 0;
        } catch (error) {
            console.error('destroySession error:', error);
            return false;
        }
    }

    async destroyAllUserSessions(userId, excludeToken = null) {
        try {
            if (!userId) {
                console.log('destroyAllUserSessions: No userId provided');
                return 0;
            }

            let query = 'DELETE FROM local_sessions WHERE user_id = ?';
            const params = [userId];

            if (excludeToken) {
                query += ' AND token != ?';
                params.push(excludeToken);
            }

            console.log('destroyAllUserSessions: Executing query for user:', userId);

            const result = await this.db.run(query, params);
            console.log('destroyAllUserSessions: Rows affected:', result.changes);

            return result.changes;
        } catch (error) {
            console.error('destroyAllUserSessions error:', error);
            return 0;
        }
    }

    async cleanupExpiredSessions() {
        const result = await this.db.run(
            'DELETE FROM local_sessions WHERE expires_at < ?',
            new Date().toISOString()
        );
        console.log(`Cleaned up ${result.changes} expired sessions`);
        return result.changes;
    }

    // ==================== Sync Methods ====================

    async syncFromCloud(userData) {
        // Check if user exists
        const existing = await this.findByCloudId(userData.id);

        if (existing) {
            // Update existing user
            await this.update(existing.id, {
                first_name: userData.firstName,
                last_name: userData.lastName,
                role: userData.role,
                permissions: JSON.stringify(userData.permissions || []),
                is_active: userData.isActive !== false ? 1 : 0,
                requires_password_change: userData.requiresPasswordChange ? 1 : 0,
                updated_at: new Date().toISOString(),
                synced_at: new Date().toISOString()
            });
            return existing.id;
        } else {
            // Create new user
            return this.create({
                cloud_id: userData.id,
                email: userData.email,
                password_hash: userData.passwordHash,
                first_name: userData.firstName,
                last_name: userData.lastName,
                role: userData.role,
                permissions: JSON.stringify(userData.permissions || []),
                tenant_id: userData.tenantId,
                requires_password_change: userData.requiresPasswordChange || true,
                is_active: userData.isActive !== false
            });
        }
    }

    async getUsersNeedingSync() {
        return this.db.all(
            `SELECT * FROM local_users 
             WHERE synced_at IS NULL 
                OR synced_at < updated_at 
                OR (cloud_id IS NULL AND created_at > datetime('now', '-1 hour'))
             LIMIT 100`
        );
    }

    async markAsSynced(userId) {
        await this.db.run(
            'UPDATE local_users SET synced_at = ? WHERE id = ?',
            [new Date().toISOString(), userId]
        );
    }

    // ==================== Statistics ====================

    async getStats() {
        const total = await this.getCount();
        const active = await this.getActiveCount();
        const locked = await this.getLockedCount();

        const roleStats = await this.db.all(
            `SELECT role, COUNT(*) as count 
             FROM local_users 
             GROUP BY role`
        );

        const recentLogins = await this.db.all(
            `SELECT u.first_name, u.last_name, u.email, l.attempted_at, l.ip_address
             FROM login_attempts l
             JOIN local_users u ON l.user_id = u.id
             WHERE l.success = 1
             ORDER BY l.attempted_at DESC
             LIMIT 10`
        );

        return {
            total,
            active,
            locked,
            byRole: roleStats.reduce((acc, row) => {
                acc[row.role] = row.count;
                return acc;
            }, {}),
            recentLogins
        };
    }
}

module.exports = { LocalUser };