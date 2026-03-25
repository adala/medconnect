// gateway/src/routes/api/userRoutes.js

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

// Helper function to get permissions based on role
const getPermissionsForRole = (role) => {
    const rolePermissions = {
        gateway_admin: ['*'],
        admin: [
            'manage_users', 'manage_settings', 'view_patients', 'view_ecg',
            'create_patient', 'edit_patient', 'delete_patient', 'upload_ecg',
            'view_logs', 'force_sync'
        ],
        clinician: [
            'view_patients', 'view_ecg', 'create_patient', 'edit_patient',
            'upload_ecg'
        ],
        technician: [
            'view_patients', 'view_ecg', 'upload_ecg', 'force_sync'
        ],
        viewer: [
            'view_patients', 'view_ecg'
        ]
    };
    
    return rolePermissions[role] || rolePermissions.viewer;
};

module.exports = (models, services) => {
    // Get all users (admin only)
    router.get('/', async (req, res) => {
        try {
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
            
            res.json({
                success: true,
                data: safeUsers,
                pagination: {
                    page,
                    totalPages: Math.ceil(total / limit),
                    total,
                    limit
                }
            });
        } catch (error) {
            console.error('User list error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get single user
    router.get('/:id', async (req, res) => {
        try {
            const user = await models.user.findById(req.params.id);
            
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            
            delete user.password_hash;
            
            res.json({
                success: true,
                data: user
            });
        } catch (error) {
            console.error('User get error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Create user
    router.post('/', async (req, res) => {
        try {
            const { firstName, lastName, email, role, password, requirePasswordChange, isActive } = req.body;
            
            // Check if user exists
            const existing = await models.user.findByEmail(email);
            if (existing) {
                return res.status(400).json({ success: false, error: 'Email already exists' });
            }
            
            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Create user
            const newUser = await models.user.create({
                email,
                password_hash: hashedPassword,
                first_name: firstName,
                last_name: lastName,
                role,
                permissions: JSON.stringify(getPermissionsForRole(role)),
                tenant_id: process.env.TENANT_ID,
                requires_password_change: requirePasswordChange !== false,
                is_active: isActive !== false
            });
            
            delete newUser.password_hash;
            
            res.json({
                success: true,
                data: newUser,
                message: 'User created successfully'
            });
        } catch (error) {
            console.error('Create user error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Update user
    router.put('/:id', async (req, res) => {
        try {
            const { firstName, lastName, role, requirePasswordChange, isActive } = req.body;
            
            const updates = {
                first_name: firstName,
                last_name: lastName,
                role,
                permissions: JSON.stringify(getPermissionsForRole(role)),
                requires_password_change: requirePasswordChange || false,
                is_active: isActive !== false,
                updated_at: new Date().toISOString()
            };
            
            const updatedUser = await models.user.update(req.params.id, updates);
            
            if (!updatedUser) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            
            delete updatedUser.password_hash;
            
            res.json({
                success: true,
                data: updatedUser,
                message: 'User updated successfully'
            });
        } catch (error) {
            console.error('Update user error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Delete user
    router.delete('/:id', async (req, res) => {
        try {
            // Prevent deleting self
            if (req.params.id === req.user?.user_id) {
                return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
            }
            
            const user = await models.user.findById(req.params.id);
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            
            await models.user.delete(req.params.id);
            
            res.json({
                success: true,
                message: 'User deleted successfully'
            });
        } catch (error) {
            console.error('Delete user error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Unlock user
    router.post('/:id/unlock', async (req, res) => {
        try {
            const user = await models.user.findById(req.params.id);
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            
            await models.user.unlockUser(req.params.id);
            
            res.json({
                success: true,
                message: 'User unlocked successfully'
            });
        } catch (error) {
            console.error('Unlock user error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
};