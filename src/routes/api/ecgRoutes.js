// gateway/src/routes/api/ecgRoutes.js

const express = require('express');
const router = express.Router();
const { requireApiAuth } = require('../../middleware/auth');

module.exports = (models, services) => {

    // Get single ECG record
    router.get('/:id', async (req, res) => {
        try {
            const record = await models.ecgRecord.findById(req.params.id);

            if (!record) {
                return res.status(404).json({ success: false, error: 'ECG record not found' });
            }

            const patient = await models.patient.findById(record.patient_id);

            // Parse waveform data if present
            // Use the pre-parsed waveform data from the model
            const waveformData = record.waveform_data || null;

            console.log('📊 Waveform data retrieved:', {
                hasParsed: !!record.waveform_data,
                type: typeof waveformData,
                keys: waveformData ? Object.keys(waveformData) : null
            });

            // Create response with parsed waveform data
            const responseData = {
                id: record.id,
                patient_id: record.patient_id,
                device_id: record.device_id,
                device_model: record.device_model,
                vendor: record.vendor,
                recording_time: record.recording_time,
                heart_rate: record.heart_rate,
                pr_interval: record.pr_interval,
                qrs_duration: record.qrs_duration,
                qt_interval: record.qt_interval,
                interpretation: record.interpretation,
                file_path: record.file_path,
                file_hash: record.file_hash,
                status: record.status,
                synced: record.synced,
                created_at: record.created_at,
                updated_at: record.updated_at,
                waveform_data: waveformData // Send parsed object, not string
            };

            res.json({
                success: true,
                data: responseData,
                patient: patient
            });
        } catch (error) {
            console.error('ECG get error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Create ECG record (manual upload)
    router.post('/', async (req, res) => {
        try {
            const { patientId, recordingTime, heartRate, prInterval, qrsDuration, qtInterval, notes } = req.body;

            if (!patientId || !recordingTime) {
                return res.status(400).json({
                    success: false,
                    error: 'Patient ID and recording time are required'
                });
            }

            const ecgData = {
                patientId,
                deviceId: 'manual-upload',
                deviceModel: 'Manual Upload',
                recordingTime,
                heartRate: heartRate ? parseInt(heartRate) : null,
                prInterval: prInterval ? parseInt(prInterval) : null,
                qrsDuration: qrsDuration ? parseInt(qrsDuration) : null,
                qtInterval: qtInterval ? parseInt(qtInterval) : null,
                waveformData: null,
                filePath: null,
                fileHash: null,
                status: 'pending',
                metadata: {
                    notes: notes || '',
                    uploadMethod: 'manual'
                }
            };

            const record = await models.ecgRecord.create(ecgData);

            // Queue for sync
            await models.syncQueue.add(record.id, 'ecg_record', 'create');

            res.json({
                success: true,
                data: record,
                message: 'ECG record created successfully'
            });
        } catch (error) {
            console.error('ECG create error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Delete ECG record
    router.delete('/:id', async (req, res) => {
        try {
            const record = await models.ecgRecord.findById(req.params.id);

            if (!record) {
                return res.status(404).json({ success: false, error: 'ECG record not found' });
            }

            await models.ecgRecord.delete(req.params.id);

            res.json({
                success: true,
                message: 'ECG record deleted successfully'
            });
        } catch (error) {
            console.error('ECG delete error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get waveform data separately
    router.get('/:id/waveform', requireApiAuth, async (req, res) => {
        try {
            const record = await models.ecgRecord.findById(req.params.id);

            if (!record) {
                return res.status(404).json({ success: false, error: 'ECG record not found' });
            }

            // Decrypt waveform data
            let waveformData = null;
            if (record.waveform_data && services.encryption) {
                try {
                    const decrypted = services.encryption.decrypt(record.waveform_data);
                    waveformData = decrypted;
                    console.log('✅ Waveform data decrypted successfully for /waveform endpoint');
                } catch (decryptError) {
                    console.error('Failed to decrypt waveform:', decryptError);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to decrypt waveform data'
                    });
                }
            }

            // If no waveform data, return sample data
            if (!waveformData) {
                waveformData = generateSampleWaveform();
            }

            res.json({
                success: true,
                data: waveformData,
                lead: req.query.lead || 'II'
            });

        } catch (error) {
            console.error('Get waveform error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Helper function to generate sample waveform
    function generateSampleWaveform() {
        const data = [];
        for (let i = 0; i < 5000; i++) {
            let value = 0;
            if (i % 500 > 50 && i % 500 < 80) {
                value = 0.1 * Math.sin((i % 500 - 50) * 0.1);
            } else if (i % 500 > 200 && i % 500 < 240) {
                const pos = (i % 500 - 200) * 0.25;
                if (pos < 10) {
                    value = -0.2 * Math.sin(pos * 0.3);
                } else if (pos < 20) {
                    value = 1.0 * Math.sin((pos - 10) * 0.3);
                } else {
                    value = -0.3 * Math.sin((pos - 20) * 0.3);
                }
            } else if (i % 500 > 360 && i % 500 < 440) {
                value = 0.3 * Math.sin((i % 500 - 360) * 0.05);
            }
            data.push(value);
        }
        return data;
    }

    return router;
};