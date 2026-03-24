// gateway/src/routes/web/index.js

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requireWebAuth } = require('../../middleware/auth')

module.exports = (models, services) => {
    // Make models available to middleware
    router.use((req, res, next) => {
        req.app.locals.models = models;
        next();
    });

    // Login page - PUBLIC (no authentication required)
    router.get('/login', async (req, res) => {
        try {

            // If already authenticated, redirect to dashboard
            const token = req.session?.token;

            if (token) {
                const session = await models.user.validateSession(token);
                if (session) {
                    return res.redirect('/');
                }
            }

            res.render('auth/login', {
                title: 'Gateway Login',
                layout: 'auth',
                nonce: res.locals.nonce,  // Pass the nonce to template
                hospitalName: process.env.HOSPITAL_NAME || 'Healthcare',
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                cloudConnected: services.sync?.isConnected || false,
                lastSync: services.sync?.status?.lastSync || 'Never',
                year: new Date().getFullYear()
            });
        } catch (error) {
            console.error('Login page error:', error);
            res.status(500).send('Error loading login page');
        }
    });

    // Change password page (GET)
    router.get('/change-password', requireWebAuth, async (req, res) => {
        try {
            // Get user details
            const user = await models.user.findById(req.user.id);
            console.log(user);
            res.render('user/change-password', {
                title: 'Change Password',
                layout: 'auth',
                nonce: res.locals.nonce,
                user: user,
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

    // Dashboard
    router.get('/', requireWebAuth, async (req, res) => {
        try {

            const health = await services.health.check();
            const recentEcg = await models.ecgRecord.getRecent(10);
            const stats = {
                patients: await models.patient.count(),
                ecgRecords: await models.ecgRecord.getStats(),
                syncQueue: await models.syncQueue.getStats(),
                users: await models.user.getCount()
            };

            console.log(stats.ecgRecords);

            const user = await models.user.findById(req.user.id);

            res.render('gateway-dashboard', {
                title: 'Dashboard',
                layout: 'main',
                nonce: res.locals.nonce,  // Pass the nonce to template
                user: user,
                active: 'dashboard',
                health,
                stats,
                recentEcg,
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
                hl7Enabled: !!services.hl7,
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                tenantId: process.env.TENANT_ID,
                hospitalName: process.env.HOSPITAL_NAME || 'Healthcare',
                uptime: formatUptime(process.uptime()),
                year: new Date().getFullYear()
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

    // Patients list
    router.get('/patients', requireWebAuth, async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = 20;
            const offset = (page - 1) * limit;

            const patients = await models.patient.findAll(limit, offset);
            const total = await models.patient.count();
            const user = await models.user.findById(req.user.id);

            res.render('patients/index', {
                title: 'Patients',
                layout: 'main',
                user: user,
                active: 'patients',
                patients,
                pagination: {
                    page,
                    totalPages: Math.ceil(total / limit),
                    total
                },
                health: await services.health.check(),
                stats: {
                    patients: total,
                    ecgRecords: await models.ecgRecord.getStats()
                },
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                year: new Date().getFullYear()
            });
        } catch (error) {
            console.error('Patients list error:', error);
            res.status(500).render('error', {
                title: 'Error',
                layout: 'error',
                error: error.message
            });
        }
    });

    // ADD THIS: Patient view page (single patient)
    router.get('/patients/:id', requireWebAuth, async (req, res) => {
        try {
            const patientId = req.params.id;

            // Fetch patient details
            const patient = await models.patient.findById(patientId);

            if (!patient) {
                return res.status(404).render('error', {
                    title: 'Patient Not Found',
                    layout: 'error',
                    error: 'Patient not found'
                });
            }

            // Fetch ECG records for this patient
            const ecgRecords = await models.ecgRecord.findByPatient(patientId, 20, 0);

            // Get user for sidebar
            const user = await models.user.findById(req.user.id);

            res.render('patients/patient-view', {
                title: 'Patient Details',
                layout: 'main',
                user: user,
                active: 'patients',
                patient: {
                    id: patient.id,
                    medicalRecordNumber: patient.medical_record_number,
                    firstName: patient.first_name,
                    lastName: patient.last_name,
                    dateOfBirth: patient.date_of_birth,
                    gender: patient.gender,
                    phone: patient.phone,
                    email: patient.email,
                    address: patient.address,
                    status: patient.status,
                    synced: patient.synced,
                    createdAt: patient.created_at,
                    updatedAt: patient.updated_at
                },
                ecgRecords: ecgRecords.map(r => ({
                    id: r.id,
                    recordingTime: r.recording_time,
                    heartRate: r.heart_rate,
                    prInterval: r.pr_interval,
                    qrsDuration: r.qrs_duration,
                    qtInterval: r.qt_interval,
                    deviceModel: r.device_model,
                    status: r.status,
                    synced: r.synced
                })),
                ecgStats: {
                    total: ecgRecords.length,
                    latestHeartRate: ecgRecords[0]?.heart_rate,
                    latestRecording: ecgRecords[0]?.recording_time
                },
                health: await services.health.check(),
                stats: {
                    patients: await models.patient.count(),
                    ecgRecords: await models.ecgRecord.getStats()
                },
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                year: new Date().getFullYear()
            });
        } catch (error) {
            console.error('Patient view error:', error);
            res.status(500).render('error', {
                title: 'Error',
                layout: 'error',
                error: error.message
            });
        }
    });

    // Add patient edit page (optional)
    router.get('/patients/:id/edit', requireWebAuth, async (req, res) => {
        try {
            const patientId = req.params.id;

            const patient = await models.patient.findById(patientId);

            if (!patient) {
                return res.status(404).render('error', {
                    title: 'Patient Not Found',
                    layout: 'error',
                    error: 'Patient not found'
                });
            }

            const user = await models.user.findById(req.user.id);

            // Check permission to edit
            const permissions = JSON.parse(user.permissions || '[]');
            const canEdit = permissions.includes('*') || permissions.includes('edit_patient');

            if (!canEdit) {
                return res.status(403).render('error', {
                    title: 'Access Denied',
                    layout: 'error',
                    error: 'You do not have permission to edit patients'
                });
            }

            res.render('patient-edit', {
                title: 'Edit Patient',
                layout: 'main',
                user: user,
                active: 'patients',
                patient: {
                    id: patient.id,
                    medicalRecordNumber: patient.medical_record_number,
                    firstName: patient.first_name,
                    lastName: patient.last_name,
                    dateOfBirth: patient.date_of_birth,
                    gender: patient.gender,
                    phone: patient.phone,
                    email: patient.email,
                    address: patient.address,
                    status: patient.status
                },
                health: await services.health.check(),
                stats: {
                    patients: await models.patient.count(),
                    ecgRecords: await models.ecgRecord.getStats()
                },
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                year: new Date().getFullYear()
            });
        } catch (error) {
            console.error('Patient edit page error:', error);
            res.status(500).render('error', {
                title: 'Error',
                layout: 'error',
                error: error.message
            });
        }
    });

    // ECG list
    router.get('/ecg', requireWebAuth, async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = 20;
            const offset = (page - 1) * limit;

            const ecgRecords = await models.ecgRecord.getRecent(limit, offset);
            const stats = await models.ecgRecord.getStats();
            const user = await models.user.findById(req.user.id);

            res.render('ecg', {
                title: 'ECG Records',
                layout: 'main',
                user: user,
                active: 'ecg/index',
                ecgRecords,
                pagination: {
                    page,
                    totalPages: Math.ceil(stats.total / limit),
                    total: stats.total
                },
                health: await services.health.check(),
                stats: {
                    patients: await models.patient.count(),
                    ecgRecords: stats
                },
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
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

    // ECG upload page
    router.get('/ecg/upload', requireWebAuth, async (req, res) => {
        try {
            const patients = await models.patient.findAll(100, 0);
            const user = await models.user.findById(req.user.id);

            res.render('ecg/upload', {
                title: 'Upload ECG',
                layout: 'main',
                user: user,
                active: 'ecg',
                patients,
                health: await services.health.check(),
                stats: {
                    patients: await models.patient.count(),
                    ecgRecords: await models.ecgRecord.getStats()
                },
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
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

    // ECG view page
    router.get('/ecg/:id', requireWebAuth, async (req, res) => {
        try {
            const record = await models.ecgRecord.findById(req.params.id);
            if (!record) {
                return res.status(404).render('error', {
                    title: 'Not Found',
                    layout: 'error',
                    error: 'ECG record not found'
                });
            }

            const patient = await models.patient.findById(record.patient_id);
            const user = await models.user.findById(req.user.id);

            res.render('ecg/view', {
                title: 'ECG Record',
                layout: 'main',
                user: user,
                active: 'ecg',
                record,
                patient,
                health: await services.health.check(),
                stats: {
                    patients: await models.patient.count(),
                    ecgRecords: await models.ecgRecord.getStats()
                },
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                year: new Date().getFullYear()
            });
        } catch (error) {
            console.error('ECG view error:', error);
            res.status(500).render('error', {
                title: 'Error',
                layout: 'error',
                error: error.message
            });
        }
    });

    // Users list (admin only)
    router.get('/users', requireWebAuth, async (req, res) => {
        try {
            const user = await models.user.findById(req.user.id);
            const permissions = JSON.parse(user.permissions || '[]');
            const isAdmin = permissions.includes('*') || permissions.includes('manage_users');

            if (!isAdmin) {
                return res.status(403).render('error', {
                    title: 'Access Denied',
                    layout: 'error',
                    error: 'You do not have permission to view this page'
                });
            }

            const page = parseInt(req.query.page) || 1;
            const limit = 20;
            const offset = (page - 1) * limit;

            const users = await models.user.findAll(limit, offset);
            const total = await models.user.getCount();

            // Remove password hashes
            const safeUsers = users.map(u => {
                delete u.password_hash;
                return u;
            });

            res.render('user/users', {
                title: 'User Management',
                layout: 'main',
                nonce: res.locals.nonce,
                user: user,
                active: 'users',
                users: safeUsers,
                pagination: {
                    page,
                    totalPages: Math.ceil(total / limit),
                    total
                },
                health: await services.health.check(),
                stats: {
                    patients: await models.patient.count(),
                    ecgRecords: await models.ecgRecord.getStats(),
                    users: total
                },
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                year: new Date().getFullYear()
            });
        } catch (error) {
            console.error('Users list error:', error);
            res.status(500).render('error', {
                title: 'Error',
                layout: 'error',
                error: error.message
            });
        }
    });

    // Help page
    router.get('/help', requireWebAuth, async (req, res) => {
        try {
            const user = await models.user.findById(req.user.id);

            res.render('help/index', {
                title: 'Help & Support',
                layout: 'main',
                user: user,
                active: 'help',
                health: await services.health.check(),
                stats: {
                    patients: await models.patient.count(),
                    ecgRecords: await models.ecgRecord.getStats()
                },
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                year: new Date().getFullYear()
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

    // About page
    router.get('/about', requireWebAuth, async (req, res) => {
        try {
            const user = await models.user.findById(req.user.id);

            res.render('about', {
                title: 'About',
                layout: 'main',
                user: user,
                active: 'about',
                health: await services.health.check(),
                stats: {
                    patients: await models.patient.count(),
                    ecgRecords: await models.ecgRecord.getStats()
                },
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                tenantId: process.env.TENANT_ID,
                year: new Date().getFullYear()
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

    // Settings page
    router.get('/settings', requireWebAuth, async (req, res) => {
        try {
            const user = await models.user.findById(req.user.id);
            const permissions = JSON.parse(user.permissions || '[]');
            const canManageSettings = permissions.includes('*') || permissions.includes('manage_settings');

            if (!canManageSettings) {
                return res.status(403).render('error', {
                    title: 'Access Denied',
                    layout: 'error',
                    error: 'You do not have permission to view this page'
                });
            }

            res.render('settings', {
                title: 'Settings',
                layout: 'main',
                user: user,
                active: 'settings',
                health: await services.health.check(),
                stats: {
                    patients: await models.patient.count(),
                    ecgRecords: await models.ecgRecord.getStats()
                },
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                year: new Date().getFullYear()
            });
        } catch (error) {
            console.error('Settings page error:', error);
            res.status(500).render('error', {
                title: 'Error',
                layout: 'error',
                error: error.message
            });
        }
    });

    // System logs page
    router.get('/logs', async (req, res) => {
        try {
            const user = await models.user.findById(req.user.id);
            const permissions = JSON.parse(user.permissions || '[]');
            const canViewLogs = permissions.includes('*') || permissions.includes('view_logs');

            if (!canViewLogs) {
                return res.status(403).render('error', {
                    title: 'Access Denied',
                    layout: 'error',
                    error: 'You do not have permission to view this page'
                });
            }

            res.render('logs', {
                title: 'System Logs',
                layout: 'main',
                user: user,
                active: 'logs',
                health: await services.health.check(),
                stats: {
                    patients: await models.patient.count(),
                    ecgRecords: await models.ecgRecord.getStats()
                },
                syncStatus: services.sync.getStatus(),
                deviceStatus: services.deviceWatcher.getStatus(),
                gatewayVersion: process.env.npm_package_version || '1.0.0',
                year: new Date().getFullYear()
            });
        } catch (error) {
            console.error('Logs page error:', error);
            res.status(500).render('error', {
                title: 'Error',
                layout: 'error',
                error: error.message
            });
        }
    });

    // Helper function
    function formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0) parts.push(`${secs}s`);

        return parts.join(' ') || '0s';
    }

    return router;
};