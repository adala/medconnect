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
const { ConfigureContainer } = require('./src/config/di/container');
const { CardioSoftConnector } = require('./src/services/CardioSoftConnector');
const { SyncService } = require('./src/services/SyncService');
const { DeidentifiedSyncService } = require('./src/services/DeidentifiedSyncService');
const { EncryptionService } = require('./src/services/EncryptionService');
const { HL7Service } = require('./src/services/HL7Service');
const { HealthCheck } = require('./src/services/HealthCheck');
const { LocalPatient } = require('./src/models/LocalPatient');
const { LocalEcgRecord } = require('./src/models/LocalEcgRecord');
const { LocalUser } = require('./src/models/LocalUser');
const { SyncQueue } = require('./src/models/SyncQueue');
const { HL7Message } = require('./src/models/HL7Message');
const { requireApiAuth } = require('./src/middleware/auth');
const SqliteStore = require('connect-sqlite3')(session);

// Import route modules
const apiAuthRoutes = require('./src/routes/api/authRoutes');
const apiUserRoutes = require('./src/routes/api/userRoutes');
const apiEcgRoutes = require('./src/routes/api/ecgRoutes');
const apiSyncRoutes = require('./src/routes/api/syncRoutes');
const apiPatientRoutes = require('./src/routes/api/patientRoutes');
const webRoutes = require('./src/routes/web/index');


// At the top of the file, after require('dotenv').config()
const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production' || process.env.RAILWAY_SERVICE_NAME;

// Update database path
const DB_PATH = isRailway ? '/app/data/offin.db' : (process.env.DB_PATH);
const SESSIONS_PATH = isRailway ? '/app/data' : './data';

// Update port - Railway provides PORT env variable
const PORT = process.env.PORT || 8080;

class OffinGateway {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 8080;
        this.tenantId = process.env.TENANT_ID;
        this.syncInterval = parseInt(process.env.SYNC_INTERVAL) || 300000; // 5 minutes
        this.hospitalName = process.env.HOSPITAL_NAME || 'Healthcare Facility';
        this.isRunning = false;
        this.services = {};
        this.models = {};
        this.xmlParser = null;
    }

    async initialize() {
        console.log('\n🚀 Medconnect Gateway initializing...');
        console.log('==========================================\n');
        console.log(`🌍 Environment: ${this.isRailway ? 'Railway (Production)' : 'Local Development'}`);
        console.log(`📁 Database path: ${DB_PATH}\n`);

        // Create data directory if it doesn't exist
        const fs = require('fs').promises;
        const dataDir = path.dirname(DB_PATH);
        try {
            await fs.mkdir(dataDir, { recursive: true });
            console.log(`✅ Data directory created: ${dataDir}`);
        } catch (err) {
            console.log('Data directory already exists or cannot be created:', err.message);
        }

        // 1. Validate required environment variables
        this.validateEnvironment();

        // 2. Initialize encryption service
        console.log('🔐 Initializing encryption service...');
        const encryptionKey = process.env.ENCRYPTION_KEY;

        if (!encryptionKey) {
            console.error('❌ ENCRYPTION_KEY environment variable is not set');
            throw new Error('ENCRYPTION_KEY is required');
        }

        console.log('Encryption key length:', encryptionKey.length);

        this.services.encryption = new EncryptionService({
            key: encryptionKey
        });

        console.log('✅ Encryption service ready\n');


        // 3.1 Initialize database
        console.log('📀 Initializing local database...');
        const db = await initializeDatabase(DB_PATH);
        this.services.db = db;

        // 3.2 Initialize models
        this.models.patient = new LocalPatient(db);
        this.models.ecgRecord = new LocalEcgRecord(db);
        this.models.user = new LocalUser(db, this.services.encryption);
        this.models.syncQueue = new SyncQueue(db);
        this.models.hl7Message = new HL7Message(db);

        // 3.3 Initialize users table
        await this.models.user.initialize();
        console.log('✅ Database ready\n');

        // 4. Create default admin if no users exist
        await this.createDefaultAdmin();

        // 5. Initialize device watcher
        // Configure DI container
        const container = ConfigureContainer();

        // Resolve dependencies
        console.log('👀 Initializing xml parser..');
        this.xmlParser = container.resolve('configurableXmlParser');
        console.log('👀 Setting default parser..');
        // Set default parser for unknown formats
        this.xmlParser.setDefaultParser('CardioSoft');
        console.log('✅ xml parser ready\n');

        if (!isRailway) {
            console.log('👀 Initializing device watcher...');
            this.services.deviceWatcher = new DeviceWatcher({
                dropFolder: process.env.DROP_FOLDER || './drop-folder',
                db: this.services.db,
                encryption: this.services.encryption,
                models: this.models,
                telemetryEnabled: process.env.DEVICE_WATCHER_TELEMETRY_ENABLED === 'true',
                vendorConfigPath: process.env.DEVICE_WATCHER_VENDOR_CONFIG_PATH,
                xmlParser: this.xmlParser
            });
            console.log('✅ Device watcher ready\n');
        }

        // 6. Initialize CardioSoft connector (if configured)
        if (process.env.CARDIOSOFT_ENABLED === 'true') {
            console.log('📊 Initializing CardioSoft connector...');

            try {
                const cardioSoftConfig = {
                    type: process.env.CARDIOSOFT_DB_TYPE || 'mssql',
                    host: process.env.CARDIOSOFT_DB_HOST,
                    database: process.env.CARDIOSOFT_DB_NAME,
                    username: process.env.CARDIOSOFT_DB_USER,
                    password: process.env.CARDIOSOFT_DB_PASSWORD,
                    filePath: process.env.CARDIOSOFT_DB_FILE,
                    // Add connection timeout
                    connectionTimeout: 30000,
                    requestTimeout: 30000
                };

                console.log('CardioSoft config:', {
                    type: cardioSoftConfig.type,
                    host: cardioSoftConfig.host,
                    database: cardioSoftConfig.database,
                    hasUsername: !!cardioSoftConfig.username
                });

                this.services.cardioSoft = new CardioSoftConnector({
                    dbConfig: cardioSoftConfig,
                    encryption: this.services.encryption,
                    models: this.models,
                    telemetryEnabled: process.env.DEVICE_WATCHER_TELEMETRY_ENABLED === 'true'
                });

                // Start CardioSoft connector with error handling
                const pollingInterval = parseInt(process.env.CARDIOSOFT_POLLING_INTERVAL) || 60000;

                try {
                    await this.services.cardioSoft.start(pollingInterval);
                    console.log('✅ CardioSoft connector started successfully');
                } catch (connError) {
                    console.error('❌ Failed to start CardioSoft connector:', connError.message);
                    console.log('⚠️ CardioSoft integration will be disabled. Set CARDIOSOFT_ENABLED=false to suppress this message.');
                    // Disable CardioSoft
                    this.services.cardioSoft = null;
                }
            } catch (error) {
                console.error('❌ Failed to initialize CardioSoft connector:', error.message);
                console.log('⚠️ CardioSoft integration will be disabled. Set CARDIOSOFT_ENABLED=false to suppress this message.');
                this.services.cardioSoft = null;
            }
        } else {
            console.log('📊 CardioSoft connector is disabled (CARDIOSOFT_ENABLED not set to true)');
        }

        // 7. Initialize sync service
        if (process.env.API_KEY && process.env.CLOUD_URL) {
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
        } else {
            console.log('⚠️ Sync service disabled (API_KEY or CLOUD_URL not set)\n');
        }

        // 8. Initialize de-identified sync service (if telemetry enabled)
        if (process.env.TELEMETRY_ENABLED === 'true' && process.env.API_KEY) {
            console.log('📊 Initializing de-identified sync service...');
            this.services.deidentifiedSync = new DeidentifiedSyncService({
                tenantId: this.tenantId,
                cloudUrl: process.env.CLOUD_URL || 'https://api.offinhealthcare.com',
                apiKey: process.env.API_KEY,
                db: this.services.db,
                models: this.models,
                logger: console
            });
            console.log('✅ De-identified Sync service ready\n');
        }

        // 9. Initialize HL7 service (optional)
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

        // 10. Setup web server with Handlebars
        console.log('🌐 Setting up local web dashboard...');
        this.setupWebServer();
        console.log('✅ Web dashboard configured\n');

        // 11. Initialize health check
        console.log('💓 Initializing health monitoring...');
        this.services.health = new HealthCheck({
            services: this.services,
            port: parseInt(process.env.METRICS_PORT) || 9090
        });
        console.log('✅ Health monitoring ready\n');

        console.log('✨ Gateway initialization complete!\n');
    }

    validateEnvironment() {
        // Only require API_KEY and CLOUD_URL if not on Vercel or if sync is needed
        const required = ['ENCRYPTION_KEY', 'TENANT_ID'];

        // Only require API_KEY if not on Vercel or if sync will be used
        if (process.env.API_KEY) {
            required.push('API_KEY');
        }

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
                const tempPassword = 'w00d3nG!N';
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

        // Create a middleware to generate nonce for each request
        this.app.use((req, res, next) => {
            res.locals.nonce = crypto.randomBytes(16).toString('base64');
            next();
        });

        // Add the new hash to your existing scriptHashes
        const scriptHashes = [
            "'sha256-mBjj5SNGmuuxZJA07WjKXGZ5l4B2NsWTJ0c4j2YlWcs='",  // Existing hash
            "'sha256-7mnJLcGxhms2lUFBtEhOcfCFJhiDzlzyfgA5pzEan0M='",  // New hash for login page
            "'sha256-ELvryFqcrOjUu6jGcCmHo2ApnS2lJVFkr2zLBkBqwGg='",  // For change-password if needed
            "'sha256-Ni7GQqSMHARItTpG6/tV9Ka58RLOrUK4T3gMo1KZzrA='",  // For other pages
            "'sha256-tecmn3GTIDqMiRhRkDkWW2FOsxHCN3wjeGZp1HP1cOQ='",  // For other pages
            "'sha256-X/sAzK+Sz/x+rdfesc8xzmuhv/WIsWAXQz66NHw+kHU='",  // For other pages
            "'sha256-kL3A64a0wwMnvAtRuWASUnpjjUgSojhiPs0oBCabOHw='"   // For other pages
        ];

        if (this.isVercel) {
            // Less strict CSP for Vercel
            this.app.use(helmet({
                contentSecurityPolicy: false,
                crossOriginEmbedderPolicy: false,
                crossOriginResourcePolicy: false
            }));
        } else {
            this.app.use(helmet({
                contentSecurityPolicy: {
                    directives: {
                        defaultSrc: ["'self'"],
                        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
                        styleSrcElem: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
                        scriptSrc: ["'self'", ...scriptHashes, 'https://cdn.jsdelivr.net', 'https://code.jquery.com', 'https://cdnjs.cloudflare.com'],
                        scriptSrcElem: ["'self'", ...scriptHashes, 'https://cdn.jsdelivr.net', 'https://code.jquery.com', 'https://cdnjs.cloudflare.com'],
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
        }

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
                dir: SESSIONS_PATH
            }),
            secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: process.env.NODE_ENV === 'production' && !isRailway,
                httpOnly: true,
                maxAge: 24 * 60 * 60 * 1000, // 24 hours
                sameSite: 'strict'
            },
            name: 'gateway.sid'
        }));

        // ==================== Handlebars Setup ====================
        console.log('📝 Configuring Handlebars view engine...');

        // Create custom handlebars instance with helpers
        // In gateway/index.js - setupWebServer() method

        const hbs = exphbs.create({
            extname: '.hbs',
            defaultLayout: 'main',
            layoutsDir: path.join(__dirname, 'src/views/layouts'),
            partialsDir: path.join(__dirname, 'src/views/partials'),
            helpers: {
                // Character helpers
                firstLetter: (string) => {
                    if (!string) return '';
                    return string.charAt(0).toUpperCase();
                },

                initials: (firstName, lastName) => {
                    const first = firstName ? firstName.charAt(0).toUpperCase() : '';
                    const last = lastName ? lastName.charAt(0).toUpperCase() : '';
                    return first + last;
                },

                // Date formatting helpers
                formatDate: (date, format = 'YYYY-MM-DD') => {
                    if (!date) return 'N/A';
                    const d = new Date(date);
                    if (isNaN(d.getTime())) return 'Invalid date';

                    if (format === 'YYYY-MM-DD') {
                        const year = d.getFullYear();
                        const month = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        return `${year}-${month}-${day}`;
                    }
                    return d.toLocaleDateString();
                },

                formatDateTime: (date) => {
                    if (!date) return 'N/A';
                    const d = new Date(date);
                    if (isNaN(d.getTime())) return 'Invalid date';
                    return d.toLocaleString();
                },

                formatTimeAgo: (date) => {
                    if (!date) return 'Never';
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

                // ADD calculateAge helper
                calculateAge: (dateOfBirth) => {
                    if (!dateOfBirth) return 'Unknown';

                    const today = new Date();
                    const birthDate = new Date(dateOfBirth);

                    if (isNaN(birthDate.getTime())) return 'Invalid date';

                    let age = today.getFullYear() - birthDate.getFullYear();
                    const monthDiff = today.getMonth() - birthDate.getMonth();

                    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                        age--;
                    }

                    return age;
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

                // Math helpers
                add: (a, b) => a + b,
                subtract: (a, b) => a - b,
                multiply: (a, b) => a * b,
                divide: (a, b) => a / b,

                // Range helper for pagination
                range: function (start, end, step = 1) {
                    if (start === undefined || end === undefined) return [];

                    const from = Number(start);
                    const to = Number(end);
                    const increment = Number(step);

                    let result = [];

                    if (from <= to) {
                        for (let i = from; i <= to; i += increment) {
                            result.push(i);
                        }
                    } else {
                        for (let i = from; i >= to; i -= Math.abs(increment)) {
                            result.push(i);
                        }
                    }

                    return result;
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

                // Navigation helpers
                isActive: (current, path) => {
                    return current === path ? 'active' : '';
                },

                // User role helpers
                hasPermission: (user, permission) => {
                    if (!user || !user.permissions) return false;
                    try {
                        const perms = JSON.parse(user.permissions);
                        return perms.includes('*') || perms.includes(permission);
                    } catch (e) {
                        return false;
                    }
                },

                // In your Handlebars configuration
                split: (str, separator) => {
                    return str ? str.split(separator) : [];
                },

                startsWith: (str, prefix) => {
                    return str && str.startsWith(prefix);
                },

                contains: (str, substring) => {
                    return str && str.includes(substring);
                },

                match: (str, pattern) => {
                    if (!str) return false;
                    const regex = new RegExp(pattern);
                    return regex.test(str);
                },


                firstIndexOf: (array) => {
                    return 0;
                },

                replace: (str, search, replace) => {
                    if (!str) return '';
                    return str.replace(new RegExp(search, 'g'), replace);
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
        // Make models and services available to routes via app.locals
        this.app.locals.models = this.models;
        this.app.locals.services = this.services;

        // ==================== Public Routes ====================

        // ==================== API Routes ====================
        const apiRouter = express.Router();

        // Auth routes (no authentication required)
        apiRouter.use('/auth', apiAuthRoutes(this.models, this.services));

        // All other API routes require authentication
        apiRouter.use(requireApiAuth);

        // User management routes
        apiRouter.use('/users', apiUserRoutes(this.models, this.services));

        // ECG routes
        apiRouter.use('/ecg', apiEcgRoutes(this.models, this.services));

        // Sync routes
        apiRouter.use('/sync', apiSyncRoutes(this.models, this.services));

        // Patient Management Routes
        apiRouter.use('/patients', apiPatientRoutes(this.models, this.services));

        this.app.use('/api/local', apiRouter);

        // ==================== Web Routes ====================
        // All web routes require authentication
        this.app.use('/', webRoutes(this.models, this.services));


        console.log('✅ Routes configured');
    }

    async start() {
        if (this.isRunning) return;

        try {
            await this.initialize();

            console.log('🚀 Starting gateway services...\n');

            // Start device watcher
            if (this.services.deviceWatcher) {
                await this.services.deviceWatcher.start();
                console.log('✅ Device watcher started');
                if (this.xmlParser) {
                    console.log('Supported vendors:', this.xmlParser.getSupportedVendors());
                }
            }

            if (this.services.sync) {
                await this.services.sync.start(this.syncInterval);
                console.log('✅ Sync service started');
            }

            // Start de-identified sync service (only if initialized)
            if (this.services.deidentifiedSync) {
                await this.services.deidentifiedSync.start(process.env.TELEMETRY_INTERVAL || 3600000);
                console.log('✅ De-identified sync service started');
            }

            // Start HL7 if enabled and initialized
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
        await this.services.deidentifiedSync?.stop();
        await this.services.hl7?.stop();
        await this.services.health?.stop();
        await this.services.db?.close();
        if (this.services.cardioSoft) {
            await this.services.cardioSoft.stop();
        }

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

// For local development - start the server
if (require.main === module && !process.env.VERCEL) {
    gateway.start().catch((error) => {
        console.error('❌ Failed to start gateway:', error);
        process.exit(1);
    });
}

module.exports = gateway;