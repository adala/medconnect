// gateway/src/routes/api/authRoutes.js

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();

module.exports = (models, services) => {
    // Login
    router.post('/login', async (req, res) => {
        try {

            const { email, password, rememberMe } = req.body;
            const ip = req.ip;

            // Rate limiting
            const recentFailures = await models.user.getRecentFailures(email);
            if (recentFailures >= 5) {
                return res.status(429).json({
                    success: false,
                    error: 'Too many failed attempts. Please try again later.'
                });
            }

            // Find user
            const user = await models.user.findByEmail(email);

            if (!user) {
                await models.user.recordLoginAttempt(email, ip, false);
                return res.status(401).json({ success: false, error: 'Invalid credentials' });
            }

            // Check if account is active
            if (!user.is_active) {
                return res.status(403).json({ success: false, error: 'Account is disabled' });
            }

            // Check if account is locked
            if (user.is_locked && new Date(user.locked_until) > new Date()) {
                const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
                return res.status(403).json({
                    success: false,
                    error: `Account locked. Try again in ${minutesLeft} minutes.`
                });
            }

            // Validate password
            const isValid = await bcrypt.compare(password, user.password_hash);

            if (!isValid) {
                await models.user.recordLoginAttempt(email, ip, false);
                const failures = await models.user.getRecentFailures(email, 15);
                if (failures >= 5) {
                    await models.user.lockUser(user.id, 30);
                }
                return res.status(401).json({ success: false, error: 'Invalid credentials' });
            }

            // Record successful login
            await models.user.recordLoginAttempt(email, ip, true);

            // Update last login
            await models.user.update(user.id, {
                last_login: new Date().toISOString(),
                last_login_ip: ip,
                failed_attempts: 0,
                is_locked: false,
                locked_until: null
            });

            // Create session
            const duration = rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
            const session = await models.user.createSession(user.id, ip, req.get('user-agent'), duration);

            // Remove sensitive data
            delete user.password_hash;

            // IMPORTANT: Also set the session in Express session
            req.session.token = session.token;
            req.session.userId = user.id;
            req.user = user;

            // Save session (important for some session stores)
            req.session.save();

            res.json({
                success: true,
                data: {
                    user,
                    token: session.token,
                    expiresAt: session.expiresAt,
                    requiresPasswordChange: user.requires_password_change === 1
                }
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ success: false, error: 'Login failed' });
        }
    });

    // Logout
    router.post('/logout', async (req, res) => {
        try {
            // Get token from session or Authorization header
            let token = req.session?.token;
            const authHeader = req.headers.authorization;
            const apiToken = authHeader?.split(' ')[1];

            if (!token && apiToken) {
                token = apiToken;
            }

            console.log('Logout: Token found:', !!token);

            if (token) {
                await models.user.destroySession(token);
            }
            // Clear the session cookie
            req.session.destroy((err) => {
                if (err) {
                    console.error('Session destroy error:', err);
                } else {
                    console.log('Logout: Session destroyed successfully');
                }
            });

            res.json({ success: true, message: 'Logged out successfully' });
        } catch (error) {
            console.error('Logout error:', error);
            res.json({ success: false, error: error.message });
        }
    });

    // Get current user
    router.get('/me', async (req, res) => {
        try {
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                return res.status(401).json({ success: false, error: 'Not authenticated' });
            }

            const session = await models.user.validateSession(token);
            if (!session) {
                return res.status(401).json({ success: false, error: 'Invalid session' });
            }

            delete session.password_hash;

            res.json({
                success: true,
                data: {
                    user: session,
                    session: {
                        expiresAt: session.expires_at,
                        lastActivity: session.last_activity
                    }
                }
            });
        } catch (error) {
            console.error('Get current user error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Change password
    router.post('/change-password', async (req, res) => {
        try {
            const token = req.headers.authorization?.split(' ')[1];
            const { currentPassword, newPassword, confirmPassword } = req.body;

            if (!token) {
                return res.status(401).json({ success: false, error: 'Not authenticated' });
            }

            if (newPassword !== confirmPassword) {
                return res.status(400).json({ success: false, error: 'Passwords do not match' });
            }

            // Validate password strength
            const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
            if (!passwordRegex.test(newPassword)) {
                return res.status(400).json({
                    success: false,
                    error: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character'
                });
            }

            const session = await models.user.validateSession(token);
            if (!session) {
                return res.status(401).json({ success: false, error: 'Invalid session' });
            }

            const user = await models.user.findById(session.user_id);

            // Verify current password
            const isValid = await bcrypt.compare(currentPassword, user.password_hash);
            if (!isValid) {
                return res.status(401).json({ success: false, error: 'Current password is incorrect' });
            }

            // Hash new password
            const newHash = await bcrypt.hash(newPassword, 10);

            // Update password
            await models.user.update(user.id, {
                password_hash: newHash,
                password_changed_at: new Date().toISOString(),
                requires_password_change: false
            });

            // Destroy all other sessions
            await models.user.destroyAllUserSessions(user.id, token);

            res.json({ success: true, message: 'Password changed successfully' });
        } catch (error) {
            console.error('Change password error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
};