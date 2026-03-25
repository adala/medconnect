// gateway/src/routes/api/patientRoutes.js

const express = require('express');
const router = express.Router();
const { requireApiAuth } = require('../../middleware/auth');

module.exports = (models, services) => {
    
    
    // Get all patients (with pagination)
    router.get('/', requireApiAuth, async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const offset = (page - 1) * limit;
            const search = req.query.search || '';
            
            let patients;
            let total;
            
            if (search) {
                patients = await models.patient.search(search, limit, offset);
                total = patients.length; // This would need a count method
            } else {
                patients = await models.patient.findAll(limit, offset);
                total = await models.patient.count();
            }
            
            // Remove any sensitive data
            const safePatients = patients.map(p => ({
                id: p.id,
                medicalRecordNumber: p.medical_record_number,
                firstName: p.first_name,
                lastName: p.last_name,
                dateOfBirth: p.date_of_birth,
                gender: p.gender,
                phone: p.phone,
                email: p.email,
                status: p.status,
                synced: p.synced,
                createdAt: p.created_at
            }));
            
            res.json({
                success: true,
                data: safePatients,
                user: req.user,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            console.error('Get patients error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // Get single patient
    router.get('/:id', requireApiAuth, async (req, res) => {
        try {
            const patient = await models.patient.findById(req.params.id);
            
            if (!patient) {
                return res.status(404).json({ success: false, error: 'Patient not found' });
            }
            
            // Get ECG records for this patient
            const ecgRecords = await models.ecgRecord.findByPatient(patient.id, 10, 0);
            
            res.json({
                success: true,
                data: {
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
                    updatedAt: patient.updated_at,
                    ecgRecords: ecgRecords.map(r => ({
                        id: r.id,
                        recordingTime: r.recording_time,
                        heartRate: r.heart_rate,
                        status: r.status,
                        synced: r.synced
                    }))
                }
            });
        } catch (error) {
            console.error('Get patient error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // Create patient
    router.post('/', requireApiAuth, async (req, res) => {
        try {
            const { medicalRecordNumber, firstName, lastName, dateOfBirth, gender, phone, email, address } = req.body;
            
            // Validate required fields
            if (!medicalRecordNumber || !firstName || !lastName || !dateOfBirth || !gender) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields: medicalRecordNumber, firstName, lastName, dateOfBirth, gender'
                });
            }
            
            // Check for duplicate MRN
            const existing = await models.patient.findByMRN(medicalRecordNumber);
            if (existing) {
                return res.status(400).json({
                    success: false,
                    error: 'Patient with this Medical Record Number already exists'
                });
            }
            
            // Create patient
            const patient = await models.patient.create({
                medicalRecordNumber,
                firstName,
                lastName,
                dateOfBirth,
                gender,
                phone: phone || null,
                email: email || null,
                address: address || {},
                status: 'active',
                tenantId: process.env.TENANT_ID,
                createdBy: req.user.id
            });
            
            // Queue for sync
            await models.syncQueue.add(patient.id, 'patient', 'create');
            
            res.json({
                success: true,
                data: {
                    id: patient.id,
                    medicalRecordNumber: patient.medical_record_number,
                    firstName: patient.first_name,
                    lastName: patient.last_name,
                    dateOfBirth: patient.date_of_birth,
                    gender: patient.gender
                },
                message: 'Patient created successfully'
            });
        } catch (error) {
            console.error('Create patient error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // Update patient
    router.put('/:id', requireApiAuth, async (req, res) => {
        try {
            const { firstName, lastName, dateOfBirth, gender, phone, email, address, status } = req.body;
            
            const patient = await models.patient.findById(req.params.id);
            if (!patient) {
                return res.status(404).json({ success: false, error: 'Patient not found' });
            }
            
            const updates = {
                first_name: firstName,
                last_name: lastName,
                date_of_birth: dateOfBirth,
                gender: gender,
                phone: phone,
                email: email,
                address: address,
                status: status,
                updated_at: new Date().toISOString(),
                updated_by: req.user.id
            };
            
            // Remove undefined values
            Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);
            
            const updatedPatient = await models.patient.update(req.params.id, updates);
            
            // Queue for sync
            await models.syncQueue.add(updatedPatient.id, 'patient', 'update');
            
            res.json({
                success: true,
                data: updatedPatient,
                message: 'Patient updated successfully'
            });
        } catch (error) {
            console.error('Update patient error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // Delete patient
    router.delete('/:id', requireApiAuth, async (req, res) => {
        try {
            const patient = await models.patient.findById(req.params.id);
            if (!patient) {
                return res.status(404).json({ success: false, error: 'Patient not found' });
            }
            
            await models.patient.delete(req.params.id);
            
            // Queue for sync
            await models.syncQueue.add(patient.id, 'patient', 'delete');
            
            res.json({
                success: true,
                message: 'Patient deleted successfully'
            });
        } catch (error) {
            console.error('Delete patient error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // Get patient ECG records
    router.get('/:id/ecg', requireApiAuth, async (req, res) => {
        try {
            const patient = await models.patient.findById(req.params.id);
            if (!patient) {
                return res.status(404).json({ success: false, error: 'Patient not found' });
            }
            
            const limit = parseInt(req.query.limit) || 20;
            const offset = parseInt(req.query.offset) || 0;
            
            const ecgRecords = await models.ecgRecord.findByPatient(patient.id, limit, offset);
            
            res.json({
                success: true,
                data: ecgRecords.map(r => ({
                    id: r.id,
                    recordingTime: r.recording_time,
                    heartRate: r.heart_rate,
                    prInterval: r.pr_interval,
                    qrsDuration: r.qrs_duration,
                    qtInterval: r.qt_interval,
                    deviceModel: r.device_model,
                    status: r.status,
                    synced: r.synced
                }))
            });
        } catch (error) {
            console.error('Get patient ECG error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    return router;
};