// gateway/src/index.js

require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const exphbs = require('express-handlebars');
const basicAuth = require('express-basic-auth');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { initializeDatabase } = require('./database/init');
const { DeviceWatcher } = require('./src/services/DeviceWatcher');
const { SyncService } = require('./src/services/SyncService');
const { EncryptionService } = require('./src/services/EncryptionService');
const { HL7Service } = require('./src/services/HL7Service');
const { HealthCheck } = require('./src/services/HealthCheck');
const { LocalPatient } = require('./src/models/LocalPatient');
const { LocalEcgRecord } = require('./src/models/LocalEcgRecord');
const { LocalUser } = require('./src/models/LocalUser');
const { SyncQueue } = require('./src/models/SyncQueue');
const { HL7Message } = require('./src/models/HL7Message');
const SqliteStore = require('connect-sqlite3')(session);

// Import route modules
const apiUserRoutes = require('./src/routes/api/userRoutes');
const apiEcgRoutes = require('./src/routes/api/ecgRoutes');
const apiSyncRoutes = require('./src/routes/api/syncRoutes');
const webRoutes = require('./src/routes/web/index');

class OffinGateway {
    constructor() {
        this.app = express();
        this.port = process.env.GATEWAY_PORT || 8080;
        this.tenantId = process.env.TENANT_ID;
        this.syncInterval = parseInt(process.env.SYNC_INTERVAL) || 300000; // 5 minutes
        this.hospitalName = process.env.HOSPITAL_NAME || 'Healthcare Facility';
        this.isRunning = false;
        this.services = {};
        this.models = {};
    }

    async initialize() {
        console.log('\n🚀 OFFIN Healthcare Gateway initializing...');
        console.log('==========================================\n');

        // 1. Validate required environment variables
        this.validateEnvironment();

        // 2. Initialize encryption service
        console.log('🔐 Initializing encryption service...');
        this.services.encryption = new EncryptionService({
            key: process.env.ENCRYPTION_KEY
        });
        console.log('✅ Encryption service ready\n');

        // 3. Initialize database
        console.log('📀 Initializing local database...');
        const db = await initializeDatabase(process.env.DB_PATH || './data/offin.db');
        this.services.db = db;

        // Initialize models
        this.models.patient = new LocalPatient(db);
        this.models.ecgRecord = new LocalEcgRecord(db);
        this.models.user = new LocalUser(db, this.services.encryption);
        this.models.syncQueue = new SyncQueue(db);
        this.models.hl7Message = new HL7Message(db);

        // Initialize users table
        await this.models.user.initialize();
        console.log('✅ Database ready\n');

        // 4. Create default admin if no users exist
        await this.createDefaultAdmin();

        // 5. Initialize device watcher
        console.log('👀 Initializing device watcher...');
        this.services.deviceWatcher = new DeviceWatcher({
            dropFolder: process.env.DROP_FOLDER || './drop-folder',
            db: this.services.db,
            encryption: this.services.encryption,
            models: this.models
        });
        console.log('✅ Device watcher ready\n');

        // 6. Initialize sync service
        console.log('🔄 Initializing sync service...');
        this.services.sync = new SyncService({
            tenantId: this.tenantId,
            cloudUrl: process.env.CLOUD_URL || 'https://api.offinhealthcare.com',
            apiKey: process.env.API_KEY,
            db: this.services.db,
            encryption: this.services.encryption,
            models: this.models
        });
        console.log('✅ Sync service ready\n');

        // 7. Initialize HL7 service (optional)
        if (process.env.HL7_ENABLED === 'true') {
            console.log('📡 Initializing HL7 service...');
            this.services.hl7 = new HL7Service({
                port: parseInt(process.env.HL7_PORT) || 6661,
                db: this.services.db,
                logger: console,
                models: this.models
            });
            console.log('✅ HL7 service ready\n');
        }

        // 8. Setup web server with Handlebars
        console.log('🌐 Setting up local web dashboard...');
        this.setupWebServer();
        console.log('✅ Web dashboard configured\n');

        // 9. Initialize health check
        console.log('💓 Initializing health monitoring...');
        this.services.health = new HealthCheck({
            services: this.services,
            port: parseInt(process.env.METRICS_PORT) || 9090
        });
        console.log('✅ Health monitoring ready\n');

        console.log('✨ Gateway initialization complete!\n');
    }

    validateEnvironment() {
        const required = ['TENANT_ID', 'API_KEY', 'ENCRYPTION_KEY'];
        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            console.error('❌ Missing required environment variables:', missing.join(', '));
            console.error('Please check your .env file');
            process.exit(1);
        }

        // Validate encryption key length (should be 32 bytes for AES-256)
        if (process.env.ENCRYPTION_KEY.length < 32) {
            console.warn('⚠️  Encryption key should be at least 32 characters long');
        }
    }

    async createDefaultAdmin() {
        try {
            const userCount = await this.models.user.getCount();

            if (userCount === 0) {
                console.log('👤 No users found, creating default admin account...');

                // Generate random password
                const tempPassword = crypto.randomBytes(8).toString('hex');
                const hashedPassword = await bcrypt.hash(tempPassword, 10);

                const adminUser = {
                    id: crypto.randomUUID(),
                    cloud_id: 'local-admin',
                    email: 'admin@localhost',
                    password_hash: hashedPassword,
                    first_name: 'Gateway',
                    last_name: 'Administrator',
                    role: 'gateway_admin',
                    permissions: JSON.stringify(['*']), // All permissions
                    tenant_id: this.tenantId,
                    requires_password_change: true,
                    is_active: true,
                    created_at: new Date().toISOString(),
                    synced_at: new Date().toISOString()
                };

                await this.models.user.create(adminUser);

                console.log('✅ Default admin created');
                console.log('⚠️  IMPORTANT: Save these credentials!');
                console.log('   Email: admin@localhost');
                console.log(`   Password: ${tempPassword}`);
                console.log('   You will be required to change this password on first login.\n');
            }
        } catch (error) {
            console.error('❌ Failed to create default admin:', error);
        }
    }

    setupWebServer() {
        // Generate a nonce for inline scripts
        const nonce = crypto.randomBytes(16).toString('base64');

        const scriptHash = "'sha256-mBjj5SNGmuuxZJA07WjKXGZ5l4B2NsWTJ0c4j2YlWcs='";

        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
                    styleSrcElem: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
                    scriptSrc: ["'self'", scriptHash, 'https://cdn.jsdelivr.net', 'https://code.jquery.com', 'https://cdnjs.cloudflare.com'],
                    scriptSrcElem: ["'self'", scriptHash, 'https://cdn.jsdelivr.net', 'https://code.jquery.com', 'https://cdnjs.cloudflare.com'],
                    fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com'],
                    imgSrc: ["'self'", 'data:', 'https:'],
                    connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'none'"],
                    frameSrc: ["'none'"],
                    baseUri: ["'self'"],
                    formAction: ["'self'"]
                }
            }
        }));


        // For development, also set this header to allow cross-origin
        if (process.env.NODE_ENV === 'development') {
            this.app.use((req, res, next) => {
                res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
                res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
                next();
            });

            this.app.use((req, res, next) => {
                if (req.headers['x-forwarded-proto'] === 'https') {
                    // If using a proxy that forwards HTTPS, you can handle it
                    next();
                } else {
                    // Don't redirect in development
                    next();
                }
            });
        }

        this.app.use(compression());
        this.app.use(cors());
        this.app.use(express.json({ limit: '50mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

        // Rate limiting for API
        const apiLimiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100 // limit each IP to 100 requests per windowMs
        });
        this.app.use('/api/', apiLimiter);

        // Stricter rate limiting for auth endpoints
        const authLimiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 5, // 5 attempts per 15 minutes
            skipSuccessfulRequests: true
        });
        this.app.use('/api/local/auth/', authLimiter);

        // Session configuration
        this.app.use(session({
            store: new SqliteStore({
                db: 'sessions.db',
                dir: './data'
            }),
            secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: process.env.NODE_ENV === 'production',
                httpOnly: true,
                maxAge: 24 * 60 * 60 * 1000, // 24 hours
                sameSite: 'strict'
            },
            name: 'gateway.sid'
        }));

        // Authentication middleware for protected routes
        const requireAuth = async (req, res, next) => {
            const token = req.headers.authorization?.split(' ')[1] || req.session?.token;

            if (!token) {
                if (req.accepts('html')) {
                    return res.redirect('/login');
                }
                return res.status(401).json({ error: 'Authentication required' });
            }

            try {
                const session = await this.models.user.validateSession(token);

                if (!session) {
                    if (req.accepts('html')) {
                        return res.redirect('/login');
                    }
                    return res.status(401).json({ error: 'Invalid or expired session' });
                }

                req.user = session;
                req.session.token = token;
                next();
            } catch (error) {
                console.error('Auth error:', error);
                res.status(500).json({ error: 'Authentication failed' });
            }
        };

        // ==================== Handlebars Setup ====================
        console.log('📝 Configuring Handlebars view engine...');

        // Create custom handlebars instance with helpers
        const hbs = exphbs.create({
            extname: '.hbs',
            defaultLayout: 'main',
            layoutsDir: path.join(__dirname, 'src/views/layouts'),
            partialsDir: path.join(__dirname, 'src/views/partials'),
            helpers: {
                firstLetter: (string) => {
                    if (!string) return '';
                    return string.charAt(0).toUpperCase();
                },
                // Also add a helper for full name initials (optional)
                initials: (firstName, lastName) => {
                    const first = firstName ? firstName.charAt(0).toUpperCase() : '';
                    const last = lastName ? lastName.charAt(0).toUpperCase() : '';
                    return first + last;
                },
                // Date formatting helpers
                formatDate: (date) => {
                    if (!date) return 'N/A';
                    return new Date(date).toLocaleDateString();
                },
                formatDateTime: (date) => {
                    if (!date) return 'N/A';
                    return new Date(date).toLocaleString();
                },
                formatTimeAgo: (date) => {
                    if (!date) return 'N/A';
                    const seconds = Math.floor((new Date() - new Date(date)) / 1000);

                    const intervals = {
                        year: 31536000,
                        month: 2592000,
                        week: 604800,
                        day: 86400,
                        hour: 3600,
                        minute: 60,
                        second: 1
                    };

                    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
                        const interval = Math.floor(seconds / secondsInUnit);
                        if (interval >= 1) {
                            return interval + ' ' + unit + (interval === 1 ? '' : 's') + ' ago';
                        }
                    }
                    return 'just now';
                },

                // Number formatting
                formatNumber: (num) => {
                    if (!num && num !== 0) return '0';
                    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                },
                formatBytes: (bytes) => {
                    if (bytes === 0) return '0 Bytes';
                    const k = 1024;
                    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                },
                formatPercent: (value) => {
                    if (!value && value !== 0) return '0%';
                    return Math.round(value * 100) + '%';
                },

                // Status helpers
                statusBadge: (status) => {
                    const colors = {
                        healthy: 'success',
                        warning: 'warning',
                        unhealthy: 'danger',
                        online: 'success',
                        offline: 'secondary',
                        syncing: 'info',
                        pending: 'warning',
                        completed: 'success',
                        failed: 'danger',
                        active: 'success',
                        inactive: 'secondary',
                        locked: 'danger'
                    };
                    return colors[status] || 'secondary';
                },

                // Comparison helpers
                eq: (a, b) => a === b,
                ne: (a, b) => a !== b,
                gt: (a, b) => a > b,
                lt: (a, b) => a < b,
                gte: (a, b) => a >= b,
                lte: (a, b) => a <= b,
                and: (a, b) => a && b,
                or: (a, b) => a || b,
                not: (a) => !a,

                // JSON helpers
                json: (context) => JSON.stringify(context, null, 2),

                // Array helpers
                length: (arr) => arr ? arr.length : 0,

                // Math helpers
                add: (a, b) => a + b,
                subtract: (a, b) => a - b,
                multiply: (a, b) => a * b,
                divide: (a, b) => a / b,

                // String helpers
                truncate: (str, length = 50) => {
                    if (!str) return '';
                    return str.length > length ? str.substring(0, length) + '...' : str;
                },
                uppercase: (str) => str ? str.toUpperCase() : '',
                lowercase: (str) => str ? str.toLowerCase() : '',
                capitalize: (str) => {
                    if (!str) return '';
                    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
                },

                // Gateway specific helpers
                getSyncIcon: (status) => {
                    const icons = {
                        syncing: 'fa-sync fa-spin',
                        success: 'fa-check-circle text-success',
                        failed: 'fa-exclamation-circle text-danger',
                        pending: 'fa-clock text-warning'
                    };
                    return icons[status] || 'fa-circle text-muted';
                },

                getDeviceIcon: (type) => {
                    const icons = {
                        ecg: 'fa-heartbeat',
                        mindray: 'fa-microscope',
                        hl7: 'fa-exchange-alt'
                    };
                    return icons[type] || 'fa-question-circle';
                },

                progressBarColor: (percent) => {
                    if (percent < 60) return 'bg-success';
                    if (percent < 80) return 'bg-info';
                    if (percent < 90) return 'bg-warning';
                    return 'bg-danger';
                },

                // Navigation helpers
                isActive: (current, path) => {
                    return current === path ? 'active' : '';
                },

                // User role helpers
                hasPermission: (user, permission) => {
                    if (!user || !user.permissions) return false;
                    const perms = JSON.parse(user.permissions);
                    return perms.includes('*') || perms.includes(permission);
                },

                // Debug helper
                debug: (context) => {
                    console.log('Debug:', context);
                    return '';
                }
            }
        });

        // Configure Handlebars
        this.app.engine('hbs', hbs.engine);
        this.app.set('view engine', 'hbs');
        this.app.set('views', path.join(__dirname, 'src/views'));

        console.log('✅ Handlebars configured');
        console.log('   Layouts directory:', path.join(__dirname, 'views/layouts'));
        console.log('   Partials directory:', path.join(__dirname, 'views/partials'));

        // Static files
        this.app.use(express.static(path.join(__dirname, 'public')));
        // ==================== Public Routes ====================

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: process.env.npm_package_version || '1.0.0'
            });
        });

        // Login page
        this.app.get('/login', async (req, res) => {
            // If already authenticated, redirect to dashboard
            const token = req.session?.token;
            if (token) {
                const session = await this.models.user.validateSession(token);
                if (session) {
                    return res.redirect('/');
                }
            }

            const nonce = crypto.randomBytes(16).toString('base64');

            res.render('login', {
                title: 'Gateway Login',
                layout: 'auth',
                nonce: nonce,
                hospitalName: this.hospitalName,
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                cloudConnected: this.services.sync?.isConnected || false,
                lastSync: this.services.sync?.status?.lastSync || 'Never',
                year: new Date().getFullYear()
            });
        });

        this.app.post('/api/local/auth/login', async (req, res) => {
            try {
                const { email, password, rememberMe } = req.body;
                const ip = req.ip;
                const userAgent = req.get('user-agent');

                // Rate limiting
                const recentFailures = await this.models.user.getRecentFailures(email);
                if (recentFailures >= 5) {
                    return res.status(429).json({
                        success: false,
                        error: 'Too many failed attempts. Please try again later.'
                    });
                }

                // Find user
                const user = await this.models.user.findByEmail(email);
                console.log(user);

                if (!user) {
                    await this.models.user.recordLoginAttempt(email, ip, false);
                    return res.status(401).json({
                        success: false,
                        error: 'Invalid credentials'
                    });
                }

                // Check if account is active
                if (!user.is_active) {
                    return res.status(403).json({
                        success: false,
                        error: 'Account is disabled. Contact your administrator.'
                    });
                }

                // Check if account is locked
                if (user.is_locked) {
                    if (new Date(user.locked_until) > new Date()) {
                        const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
                        return res.status(403).json({
                            success: false,
                            error: `Account is locked. Try again in ${minutesLeft} minutes.`
                        });
                    } else {
                        // Auto-unlock
                        await this.models.user.db.run(
                            'UPDATE local_users SET is_locked = false, locked_until = NULL WHERE id = ?',
                            user.id
                        );
                    }
                }

                // Validate password
                const isValid = await bcrypt.compare(password, user.password_hash);

                if (!isValid) {
                    await this.models.user.recordLoginAttempt(email, ip, false);

                    // Lock after 5 failures
                    const failures = await this.models.user.getRecentFailures(email, 15);
                    if (failures >= 5) {
                        await this.models.user.lockUser(user.id, 30);
                    }

                    return res.status(401).json({
                        success: false,
                        error: 'Invalid credentials'
                    });
                }

                // Record successful login
                await this.models.user.recordLoginAttempt(email, ip, true);

                // Update last login
                await this.models.user.db.run(
                    'UPDATE local_users SET last_login = ?, last_login_ip = ? WHERE id = ?',
                    [new Date().toISOString(), ip, user.id]
                );

                // Create session
                const session = await this.models.user.createSession(
                    user.id,
                    ip,
                    userAgent,
                    rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000 // 7 days or 24 hours
                );

                // Remove sensitive data
                delete user.password_hash;

                // Set session cookie
                req.session.token = session.token;
                req.session.userId = user.id;

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
                res.status(500).json({
                    success: false,
                    error: 'Login failed'
                });
            }
        });

        // Get current user
        this.app.get('/api/local/auth/me', requireAuth, async (req, res) => {
            delete req.user.password_hash;
            res.json({
                success: true,
                data: {
                    user: req.user,
                    session: {
                        id: req.session.id,
                        expiresAt: req.session.cookie?.expires
                    }
                }
            });
        });

        // ==================== Change Password Route ====================

        // Change password page (GET)
        this.app.get('/change-password', requireAuth, async (req, res) => {
            try {
                // Get user details
                const user = await this.models.user.findById(req.user.user_id);
                const nonce = crypto.randomBytes(16).toString('base64');
                res.render('change-password', {
                    title: 'Change Password',
                    layout: 'auth',
                    nonce: nonce,
                    user: req.user,
                    requiresChange: user.requires_password_change === 1,
                    year: new Date().getFullYear(),
                    gatewayVersion: process.env.npm_package_version || '1.0.0',
                    hospitalName: this.hospitalName,
                    nonce: res.locals.nonce
                });
            } catch (error) {
                console.error('Change password page error:', error);
                res.status(500).render('error', {
                    title: 'Error',
                    layout: 'error',
                    error: error.message
                });
            }
        });

        // Change password API endpoint (POST)
        this.app.post('/api/local/auth/change-password', requireAuth, async (req, res) => {
            try {
                const { currentPassword, newPassword, confirmPassword } = req.body;
                const userId = req.user.user_id;

                // Validate passwords match
                if (newPassword !== confirmPassword) {
                    return res.status(400).json({
                        success: false,
                        error: 'New passwords do not match'
                    });
                }

                // Validate password strength
                const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
                if (!passwordRegex.test(newPassword)) {
                    return res.status(400).json({
                        success: false,
                        error: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character'
                    });
                }

                // Get user and verify current password
                const user = await this.models.user.findById(userId);

                if (!user) {
                    return res.status(404).json({
                        success: false,
                        error: 'User not found'
                    });
                }

                // Verify current password
                const isValid = await bcrypt.compare(currentPassword, user.password_hash);

                if (!isValid) {
                    return res.status(401).json({
                        success: false,
                        error: 'Current password is incorrect'
                    });
                }

                // Hash new password
                const newHash = await bcrypt.hash(newPassword, 10);

                // Update password and clear requires_password_change flag
                await this.models.user.db.run(
                    `UPDATE local_users SET 
                    password_hash = ?,
                    requires_password_change = false,
                    password_changed_at = ?,
                    updated_at = ?
                 WHERE id = ?`,
                    [newHash, new Date().toISOString(), new Date().toISOString(), userId]
                );

                // Destroy all other sessions (optional)
                await this.models.user.destroyAllUserSessions(userId, req.session.token);

                res.json({
                    success: true,
                    message: 'Password changed successfully'
                });

            } catch (error) {
                console.error('Change password error:', error);
                res.status(500).json({
                    success: false,
                    error: 'Failed to change password'
                });
            }
        });

        // ==================== Protected Routes ====================

        // Apply authentication to all routes below
        this.app.use(requireAuth);

        // Dashboard
        this.app.get('/', requireAuth, async (req, res) => {
            try {
                // Fetch all required data
                const health = await this.services.health.check();
                const recentEcg = await this.models.ecgRecord.getRecent(10);
                const stats = {
                    patients: await this.models.patient.count(),
                    ecgRecords: await this.models.ecgRecord.getStats(),
                    syncQueue: await this.models.syncQueue.getStats(),
                    hl7Messages: await this.models.hl7Message.getStats(),
                    users: await this.models.user.getCount()
                };

                // Get user with permissions
                const user = await this.models.user.findById(req.user.user_id);
                const nonce = crypto.randomBytes(16).toString('base64');
                res.render('gateway-dashboard', {
                    title: 'OFFIN Gateway Dashboard',
                    layout: 'main',
                    nonce: nonce,
                    user: user,
                    tenantId: this.tenantId,
                    hospitalName: this.hospitalName,
                    gatewayVersion: process.env.npm_package_version || '1.0.0',
                    health: health,
                    stats: stats,
                    recentEcg: recentEcg,
                    syncStatus: this.services.sync.getStatus(),
                    deviceStatus: this.services.deviceWatcher.getStatus(),
                    hl7Enabled: !!this.services.hl7,
                    hl7Status: this.services.hl7?.getStatus(),
                    config: {
                        dropFolder: process.env.DROP_FOLDER || './drop-folder',
                        syncInterval: this.syncInterval / 60000,
                        cloudUrl: process.env.CLOUD_URL || 'https://api.offinhealthcare.com',
                        hl7Enabled: !!this.services.hl7,
                        autoUpdate: process.env.AUTO_UPDATE !== 'false'
                    },
                    uptime: this.formatUptime(process.uptime()),
                    active: 'dashboard',  // For sidebar active state
                    breadcrumb: [{ name: 'Dashboard', url: '/' }],
                    notifications: {
                        unreadCount: 0,
                        recent: []
                    },
                    year: new Date().getFullYear(),
                    nodeVersion: process.version,
                    platform: process.platform
                });
            } catch (error) {
                console.error('Dashboard error:', error);
                res.status(500).render('error', {
                    title: 'Error',
                    layout: 'error',
                    error: error.message
                });
            }
        });

        this.app.get('/ecg', requireAuth, async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = 20;
                const offset = (page - 1) * limit;

                const ecgRecords = await this.models.ecgRecord.getRecent(limit, offset);
                const stats = await this.models.ecgRecord.getStats();
                const total = stats.total;

                const user = await this.models.user.findById(req.user.user_id);

                res.render('ecg', {
                    title: 'ECG Records',
                    layout: 'main',
                    user: user,
                    active: 'ecg',
                    ecgRecords: ecgRecords,
                    pagination: {
                        page: page,
                        totalPages: Math.ceil(total / limit),
                        total: total,
                        limit: limit
                    },
                    health: await this.services.health.check(),
                    stats: {
                        patients: await this.models.patient.count(),
                        ecgRecords: stats,
                        syncQueue: await this.models.syncQueue.getStats(),
                        users: await this.models.user.getCount()
                    },
                    syncStatus: this.services.sync.getStatus(),
                    deviceStatus: this.services.deviceWatcher.getStatus(),
                    gatewayVersion: process.env.npm_package_version || '1.0.0',
                    year: new Date().getFullYear()
                });
            } catch (error) {
                console.error('ECG list error:', error);
                res.status(500).render('error', {
                    title: 'Error',
                    layout: 'error',
                    error: error.message
                });
            }
        });

        this.app.get('/ecg/upload', requireAuth, async (req, res) => {
            try {
                const user = await this.models.user.findById(req.user.user_id);
                const patients = await this.models.patient.findAll(100, 0);

                res.render('ecg-upload', {
                    title: 'Upload ECG',
                    layout: 'main',
                    user: user,
                    active: 'ecg',
                    patients: patients,
                    health: await this.services.health.check(),
                    stats: {
                        patients: await this.models.patient.count(),
                        ecgRecords: await this.models.ecgRecord.getStats()
                    },
                    syncStatus: this.services.sync.getStatus(),
                    deviceStatus: this.services.deviceWatcher.getStatus(),
                    gatewayVersion: process.env.npm_package_version || '1.0.0',
                    year: new Date().getFullYear()
                });
            } catch (error) {
                console.error('ECG upload page error:', error);
                res.status(500).render('error', {
                    title: 'Error',
                    layout: 'error',
                    error: error.message
                });
            }
        });

        // ECG Upload API
        this.app.post('/api/local/ecg/upload', requireAuth, async (req, res) => {
            try {
                const { patientId, recordingTime, heartRate, prInterval, qrsDuration, qtInterval, notes } = req.body;

                // Validate required fields
                if (!patientId || !recordingTime) {
                    return res.status(400).json({
                        success: false,
                        error: 'Patient ID and recording time are required'
                    });
                }

                // Create ECG record
                const ecgData = {
                    patientId: patientId,
                    deviceId: 'manual-upload',
                    deviceModel: 'Manual Upload',
                    recordingTime: recordingTime,
                    heartRate: heartRate ? parseInt(heartRate) : null,
                    prInterval: prInterval ? parseInt(prInterval) : null,
                    qrsDuration: qrsDuration ? parseInt(qrsDuration) : null,
                    qtInterval: qtInterval ? parseInt(qtInterval) : null,
                    waveformData: null,
                    filePath: null,
                    fileHash: null,
                    status: 'pending',
                    metadata: {
                        uploadedBy: req.user.user_id,
                        notes: notes || '',
                        uploadMethod: 'manual'
                    }
                };

                const record = await this.models.ecgRecord.create(ecgData);

                // Queue for sync
                await this.models.syncQueue.add(record.id, 'ecg_record', 'create');

                res.json({
                    success: true,
                    data: record,
                    message: 'ECG record created successfully'
                });

            } catch (error) {
                console.error('ECG upload error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ECG Delete API
        this.app.delete('/api/local/ecg/:id', requireAuth, async (req, res) => {
            try {
                const record = await this.models.ecgRecord.findById(req.params.id);

                if (!record) {
                    return res.status(404).json({
                        success: false,
                        error: 'ECG record not found'
                    });
                }

                // Check permissions (only admin or record creator)
                const user = await this.models.user.findById(req.user.user_id);
                const permissions = JSON.parse(user.permissions || '[]');
                const isAdmin = permissions.includes('*') || permissions.includes('manage_all');

                if (!isAdmin && record.created_by !== req.user.user_id) {
                    return res.status(403).json({
                        success: false,
                        error: 'Permission denied'
                    });
                }

                await this.models.ecgRecord.delete(req.params.id);

                res.json({
                    success: true,
                    message: 'ECG record deleted successfully'
                });

            } catch (error) {
                console.error('ECG delete error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Force Sync API
        this.app.post('/api/local/sync/force', requireAuth, async (req, res) => {
            try {
                // Trigger sync immediately
                this.services.sync.sync().catch(console.error);

                res.json({
                    success: true,
                    message: 'Sync started'
                });
            } catch (error) {
                console.error('Force sync error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ECG viewer
        this.app.get('/ecg/:id', async (req, res) => {
            try {
                const record = await this.models.ecgRecord.findById(req.params.id);

                if (!record) {
                    return res.status(404).render('error', {
                        title: 'Not Found',
                        layout: 'error',
                        user: req.user,
                        error: 'ECG record not found'
                    });
                }

                res.render('ecg-view', {
                    title: 'ECG Record',
                    layout: 'main',
                    user: req.user,
                    record,
                    patient: await this.models.patient.findById(record.patient_id)
                });
            } catch (error) {
                res.status(500).render('error', {
                    title: 'Error',
                    layout: 'error',
                    user: req.user,
                    error: error.message
                });
            }
        });

        // Patients list
        this.app.get('/patients', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = 20;
                const offset = (page - 1) * limit;

                const patients = await this.models.patient.findAll(limit, offset);
                const total = await this.models.patient.count();

                res.render('patients', {
                    title: 'Patients',
                    layout: 'main',
                    user: req.user,
                    patients,
                    pagination: {
                        page,
                        totalPages: Math.ceil(total / limit),
                        total
                    }
                });
            } catch (error) {
                res.status(500).render('error', {
                    title: 'Error',
                    layout: 'error',
                    user: req.user,
                    error: error.message
                });
            }
        });

        // Users list (admin only)
        this.app.get('/users', async (req, res) => {
            try {
                // Check if user has admin role
                const permissions = JSON.parse(req.user.permissions || '[]');
                if (!permissions.includes('*') && !permissions.includes('manage_users')) {
                    return res.status(403).render('error', {
                        title: 'Access Denied',
                        layout: 'error',
                        user: req.user,
                        error: 'You do not have permission to view this page'
                    });
                }

                const page = parseInt(req.query.page) || 1;
                const limit = 20;
                const offset = (page - 1) * limit;

                const users = await this.models.user.findAll(limit, offset);
                const total = await this.models.user.getCount();

                res.render('users', {
                    title: 'User Management',
                    layout: 'main',
                    user: req.user,
                    users,
                    pagination: {
                        page,
                        totalPages: Math.ceil(total / limit),
                        total
                    }
                });
            } catch (error) {
                res.status(500).render('error', {
                    title: 'Error',
                    layout: 'error',
                    user: req.user,
                    error: error.message
                });
            }
        });

        // Settings
        this.app.get('/settings', async (req, res) => {
            // Check if user has admin role
            const permissions = JSON.parse(req.user.permissions || '[]');
            if (!permissions.includes('*') && !permissions.includes('manage_settings')) {
                return res.status(403).render('error', {
                    title: 'Access Denied',
                    layout: 'error',
                    user: req.user,
                    error: 'You do not have permission to view this page'
                });
            }

            res.render('settings', {
                title: 'Settings',
                layout: 'main',
                user: req.user,
                config: {
                    tenantId: this.tenantId,
                    hospitalName: this.hospitalName,
                    syncInterval: this.syncInterval / 60000,
                    dropFolder: process.env.DROP_FOLDER || './drop-folder',
                    cloudUrl: process.env.CLOUD_URL || 'https://api.offinhealthcare.com',
                    hl7Enabled: !!this.services.hl7,
                    hl7Port: process.env.HL7_PORT || 6661,
                    autoUpdate: process.env.AUTO_UPDATE !== 'false',
                    logLevel: process.env.LOG_LEVEL || 'info'
                }
            });
        });

        this.app.get('/help', requireAuth, async (req, res) => {
            try {
                const user = await this.models.user.findById(req.user.user_id);

                res.render('help/index', {
                    title: 'Help & Support',
                    layout: 'main',
                    user: user,
                    active: 'help',
                    tenantId: this.tenantId,
                    gatewayVersion: process.env.npm_package_version || '1.0.0',
                    uptime: this.formatUptime(process.uptime()),
                    year: new Date().getFullYear(),
                    health: await this.services.health.check(),
                    stats: {
                        patients: await this.models.patient.count(),
                        ecgRecords: await this.models.ecgRecord.getStats()
                    },
                    syncStatus: this.services.sync.getStatus(),
                    deviceStatus: this.services.deviceWatcher.getStatus()
                });
            } catch (error) {
                console.error('Help page error:', error);
                res.status(500).render('error', {
                    title: 'Error',
                    layout: 'error',
                    error: error.message
                });
            }
        });

        // About page (can be public or authenticated)
        this.app.get('/about', requireAuth, async (req, res) => {
            try {
                const user = await this.models.user.findById(req.user.user_id);

                res.render('about', {
                    title: 'About',
                    layout: 'main',
                    user: user,
                    active: 'about',
                    tenantId: this.tenantId,
                    gatewayId: this.tenantId, // or generate a unique ID
                    gatewayVersion: process.env.npm_package_version || '1.0.0',
                    year: new Date().getFullYear(),
                    health: await this.services.health.check(),
                    stats: {
                        patients: await this.models.patient.count(),
                        ecgRecords: await this.models.ecgRecord.getStats()
                    },
                    syncStatus: this.services.sync.getStatus(),
                    deviceStatus: this.services.deviceWatcher.getStatus()
                });
            } catch (error) {
                console.error('About page error:', error);
                res.status(500).render('error', {
                    title: 'Error',
                    layout: 'error',
                    error: error.message
                });
            }
        });

        // In gateway/index.js - setupWebServer() method, add or verify logout endpoint:

        // Logout endpoint
        this.app.post('/api/local/auth/logout', async (req, res) => {
            try {
                const token = req.headers.authorization?.split(' ')[1] || req.session?.token;

                if (token) {
                    await this.models.user.destroySession(token);
                }

                if (req.session) {
                    req.session.destroy();
                }

                res.json({ success: true });
            } catch (error) {
                console.error('Logout error:', error);
                res.json({ success: false, error: error.message });
            }
        });

        // Local API routes
        this.app.use('/api/local', localRoutes(this.services, this.models));

        // 404 handler
        this.app.use((req, res) => {
            if (req.accepts('html')) {
                res.status(404).render('error', {
                    title: '404 Not Found',
                    layout: 'error',
                    user: req.user,
                    error: 'The requested page was not found.'
                });
            } else {
                res.status(404).json({ error: 'Not found' });
            }
        });


        console.log('✅ Routes configured');
    }

    async start() {
        if (this.isRunning) return;

        try {
            await this.initialize();

            console.log('🚀 Starting gateway services...\n');

            // Start device watcher
            await this.services.deviceWatcher.start();
            console.log('✅ Device watcher started');

            // Start sync service
            await this.services.sync.start(this.syncInterval);
            console.log('✅ Sync service started');

            // Start HL7 if enabled
            if (this.services.hl7) {
                await this.services.hl7.start();
                console.log('✅ HL7 service started');
            }

            // Start health checks
            await this.services.health.start();
            console.log('✅ Health monitoring started');

            // Start web server
            this.server = this.app.listen(this.port, () => {
                console.log('\n==========================================');
                console.log(`🌐 Local dashboard: http://localhost:${this.port}`);
                console.log(`🔑 Login page: http://localhost:${this.port}/login`);
                console.log(`📊 Metrics endpoint: http://localhost:${this.port}/metrics`);
                console.log(`💓 Health check: http://localhost:${this.port}/health`);
                console.log('==========================================\n');
            });

            this.isRunning = true;

            // Log startup complete
            await this.logEvent('system', 'info', 'Gateway started');

        } catch (error) {
            console.error('❌ Failed to start gateway:', error);
            await this.logEvent('system', 'error', `Startup failed: ${error.message}`);
            throw error;
        }
    }

    async stop() {
        console.log('\n🛑 Shutting down gateway...');

        await this.services.deviceWatcher?.stop();
        await this.services.sync?.stop();
        await this.services.hl7?.stop();
        await this.services.health?.stop();
        await this.services.db?.close();

        if (this.server) {
            this.server.close();
        }

        this.isRunning = false;
        console.log('✅ Gateway stopped');
    }

    async logEvent(type, severity, message, details = {}) {
        try {
            await this.services.db?.run(
                `INSERT INTO system_events (event_type, severity, message, details, created_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [type, severity, message, JSON.stringify(details), new Date().toISOString()]
            );
        } catch (error) {
            console.error('Failed to log event:', error);
        }
    }

    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0) parts.push(`${secs}s`);

        return parts.join(' ');
    }
}

// Handle shutdown gracefully
process.on('SIGTERM', async () => {
    console.log('\n📥 Received SIGTERM signal');
    await gateway.stop();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\n📥 Received SIGINT signal');
    await gateway.stop();
    process.exit(0);
});

process.on('uncaughtException', async (error) => {
    console.error('\n💥 Uncaught exception:', error);
    await gateway.logEvent('system', 'critical', 'Uncaught exception', { error: error.message });
    await gateway.stop();
    process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
    console.error('\n💥 Unhandled rejection:', reason);
    await gateway.logEvent('system', 'critical', 'Unhandled rejection', { reason });
    await gateway.stop();
    process.exit(1);
});

// Start the gateway
const gateway = new OffinGateway();

gateway.start().catch((error) => {
    console.error('❌ Failed to start gateway:', error);
    process.exit(1);
});

module.exports = gateway;