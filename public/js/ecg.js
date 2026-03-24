// public/js/ecg-view.js

/**
 * ECG Waveform Visualization and Management
 * Handles ECG waveform rendering, lead selection, zoom, and export functionality
 */

class ECGViewer {
    constructor(canvasId, options = {}) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas?.getContext('2d');
        this.currentLead = options.initialLead || 'II';
        this.zoomLevel = options.initialZoom || 1;
        this.speed = options.initialSpeed || 50; // mm/s
        this.waveformData = null;
        this.leadData = {};
        this.isLoading = false;
        this.recordId = null;
        this.recordData = null;
        this.patientData = null;

        // Bind event handlers
        this.renderWaveform = this.renderWaveform.bind(this);
        this.drawGrid = this.drawGrid.bind(this);
        this.drawWaveform = this.drawWaveform.bind(this);
        this.handleResize = this.handleResize.bind(this);

        // Initialize
        this.init();
    }

    init() {
        if (!this.canvas || !this.ctx) {
            console.error('Canvas element not found');
            return;
        }

        // Set canvas dimensions
        this.resizeCanvas();

        // Get record ID from URL
        this.recordId = this.getRecordId();

        // Add event listeners
        this.initEventListeners();

        // Load record data
        this.loadRecordData();

        // Add resize listener
        window.addEventListener('resize', this.handleResize);
    }

    getRecordId() {
        const path = window.location.pathname;
        const match = path.match(/\/ecg\/(\d+)/);
        return match ? match[1] : null;
    }

    initEventListeners() {
        // Lead selection
        const leadSelect = document.getElementById('leadSelect');
        if (leadSelect) {
            leadSelect.addEventListener('change', (e) => {
                this.currentLead = e.target.value;
                this.renderWaveform();
            });
        }

        // Zoom range
        const zoomRange = document.getElementById('zoomRange');
        if (zoomRange) {
            zoomRange.addEventListener('input', (e) => {
                this.zoomLevel = parseFloat(e.target.value);
                const zoomValue = document.getElementById('zoomValue');
                if (zoomValue) zoomValue.textContent = this.zoomLevel.toFixed(1) + 'x';
                this.renderWaveform();
            });
        }

        // Speed selection
        const speedSelect = document.getElementById('speedSelect');
        if (speedSelect) {
            speedSelect.addEventListener('change', (e) => {
                this.speed = parseInt(e.target.value);
                this.renderWaveform();
            });
        }

        // Zoom buttons
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => this.zoomOut());
        }

        const zoomInBtn = document.getElementById('zoomInBtn');
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => this.zoomIn());
        }

        // Print button
        const printBtn = document.getElementById('printBtn');
        if (printBtn) {
            printBtn.addEventListener('click', () => this.printECG());
        }

        // Export PDF button
        const exportPdfBtn = document.getElementById('exportPdfBtn');
        if (exportPdfBtn) {
            exportPdfBtn.addEventListener('click', () => this.exportAsPDF());
        }

        // Export JSON button
        const exportJsonBtn = document.getElementById('exportJsonBtn');
        if (exportJsonBtn) {
            exportJsonBtn.addEventListener('click', () => this.exportAsJSON());
        }

        // Download image button
        const downloadImageBtn = document.getElementById('downloadImageBtn');
        if (downloadImageBtn) {
            downloadImageBtn.addEventListener('click', () => this.downloadAsImage());
        }

        // Fullscreen button
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        }

        // Reset view button
        const resetViewBtn = document.getElementById('resetViewBtn');
        if (resetViewBtn) {
            resetViewBtn.addEventListener('click', () => this.resetView());
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === '+') {
                e.preventDefault();
                this.zoomIn();
            } else if (e.ctrlKey && e.key === '-') {
                e.preventDefault();
                this.zoomOut();
            } else if (e.key === 'p' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.printECG();
            }
        });
    }

    // In ecg-view.js, update loadRecordData

    async loadRecordData() {
        if (!this.recordId) {
            console.warn('No ECG record ID found');
            this.showError('No ECG record ID found');
            return;
        }

        this.showLoading();

        try {
            // Load ECG record
            const recordResponse = await fetch(`/api/local/ecg/${this.recordId}`, {
                credentials: 'same-origin'
            });

            if (!recordResponse.ok) {
                throw new Error('Failed to load ECG record');
            }

            const result = await recordResponse.json();

            if (result.success) {
                this.recordData = result.data;

                // Log the waveform data for debugging
                console.log('📊 Waveform data from API:', {
                    hasWaveform: !!this.recordData.waveform_data,
                    type: typeof this.recordData.waveform_data,
                    isArray: Array.isArray(this.recordData.waveform_data),
                    keys: this.recordData.waveform_data ? Object.keys(this.recordData.waveform_data) : null
                });

                // Use the waveform data from the API response
                if (this.recordData.waveform_data) {
                    this.waveformData = this.recordData.waveform_data;
                    this.parseLeadData();
                    console.log('✅ Waveform data loaded from API');
                } else {
                    console.log('No waveform data available, using sample');
                    this.generateSampleData();
                }

                // Load patient data if needed
                if (this.recordData.patient_id) {
                    await this.loadPatientData(this.recordData.patient_id);
                }

                // Update UI with record data
                this.updateUI();

                // Render waveform
                this.renderWaveform();
            } else {
                throw new Error(result.error || 'Failed to load ECG record');
            }
        } catch (error) {
            console.error('Error loading record data:', error);
            this.showError('Failed to load ECG record: ' + error.message);
            this.generateSampleData();
            this.renderWaveform();
        } finally {
            this.hideLoading();
        }
    }

    async loadPatientData(patientId) {
        try {
            const response = await fetch(`/api/local/patients/${patientId}`, {
                credentials: 'same-origin'
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this.patientData = data.data;
                    this.updatePatientInfo();
                }
            }
        } catch (error) {
            console.error('Failed to load patient data:', error);
        }
    }

    parseLeadData() {
        if (!this.waveformData) return;

        console.log('Parsing lead data:', this.waveformData);

        // Check if waveform data has Lead array (Mindray/Philips style)
        if (this.waveformData.Lead && Array.isArray(this.waveformData.Lead)) {
            this.waveformData.Lead.forEach(lead => {
                if (lead.LeadID && lead.Data) {
                    // Data is stored as comma-separated string, parse it
                    if (typeof lead.Data === 'string') {
                        this.leadData[lead.LeadID] = lead.Data.split(',').map(v => parseFloat(v.trim()));
                    } else if (Array.isArray(lead.Data)) {
                        this.leadData[lead.LeadID] = lead.Data;
                    }
                }
            });
            console.log('Loaded leads:', Object.keys(this.leadData));
            return;
        }

        // Check for Waveform array structure (Philips style)
        if (this.waveformData.Waveform && Array.isArray(this.waveformData.Waveform)) {
            this.waveformData.Waveform.forEach(wave => {
                if (wave.LeadID && wave.Data) {
                    if (typeof wave.Data === 'string') {
                        this.leadData[wave.LeadID] = wave.Data.split(',').map(v => parseFloat(v.trim()));
                    } else if (Array.isArray(wave.Data)) {
                        this.leadData[wave.LeadID] = wave.Data;
                    }
                }
            });
            return;
        }

        // Check if it's already structured by leads
        if (this.waveformData.I || this.waveformData.II || this.waveformData.III) {
            Object.keys(this.waveformData).forEach(key => {
                if (Array.isArray(this.waveformData[key])) {
                    this.leadData[key] = this.waveformData[key];
                } else if (typeof this.waveformData[key] === 'string') {
                    this.leadData[key] = this.waveformData[key].split(',').map(v => parseFloat(v.trim()));
                }
            });
            return;
        }

        // If it's an array, assume it's lead II
        if (Array.isArray(this.waveformData)) {
            this.leadData = { II: this.waveformData };
        } else if (typeof this.waveformData === 'string') {
            // Try to parse as JSON
            try {
                const parsed = JSON.parse(this.waveformData);
                if (parsed && typeof parsed === 'object') {
                    this.waveformData = parsed;
                    this.parseLeadData();
                }
            } catch (e) {
                console.error('Could not parse waveform data as JSON:', e);
            }
        }
    }

    generateSampleData() {
        // Generate a realistic ECG waveform pattern
        const length = 5000;
        const data = [];

        for (let i = 0; i < length; i++) {
            let value = 0;
            const position = i % 500;

            // P wave
            if (position > 50 && position < 80) {
                value = 0.1 * Math.sin((position - 50) * 0.1);
            }
            // QRS complex
            else if (position > 200 && position < 240) {
                const qrsPos = position - 200;
                if (qrsPos < 10) {
                    value = -0.2 * Math.sin(qrsPos * 0.3);
                } else if (qrsPos < 20) {
                    value = 1.0 * Math.sin((qrsPos - 10) * 0.3);
                } else {
                    value = -0.3 * Math.sin((qrsPos - 20) * 0.3);
                }
            }
            // T wave
            else if (position > 360 && position < 440) {
                value = 0.3 * Math.sin((position - 360) * 0.05);
            }

            // Add some noise
            value += (Math.random() - 0.5) * 0.02;

            data.push(value);
        }

        this.leadData = { II: data };
        this.waveformData = this.leadData;
        console.log('Generated sample data');
    }

    updateUI() {
        if (!this.recordData) return;

        // Update metrics with color coding
        this.updateMetric('heartRate', this.recordData.heart_rate, 60, 100);
        this.updateMetric('prInterval', this.recordData.pr_interval, 120, 200);
        this.updateMetric('qrsDuration', this.recordData.qrs_duration, 60, 100);
        this.updateMetric('qtInterval', this.recordData.qt_interval, 350, 450);

        // Update vendor badge
        const vendorBadge = document.getElementById('vendorBadge');
        if (vendorBadge && this.recordData.vendor) {
            vendorBadge.textContent = this.recordData.vendor;
        }

        const vendorInfo = document.getElementById('vendorInfo');
        if (vendorInfo && this.recordData.vendor) {
            vendorInfo.textContent = this.recordData.vendor;
        }

        // Update device info
        const deviceId = document.getElementById('deviceId');
        if (deviceId) deviceId.textContent = this.recordData.device_id || '-';

        const deviceModel = document.getElementById('deviceModel');
        if (deviceModel) deviceModel.textContent = this.recordData.device_model || '-';

        const recordingTime = document.getElementById('recordingTime');
        if (recordingTime && this.recordData.recording_time) {
            recordingTime.textContent = this.formatDateTime(this.recordData.recording_time);
        }

        const recordingTimeInfo = document.getElementById('recordingTimeInfo');
        if (recordingTimeInfo && this.recordData.recording_time) {
            recordingTimeInfo.textContent = this.formatDateTime(this.recordData.recording_time);
        }

        const fileHash = document.getElementById('fileHash');
        if (fileHash && this.recordData.file_hash) {
            fileHash.textContent = this.recordData.file_hash.substring(0, 16) + '...';
            fileHash.title = this.recordData.file_hash;
        }

        const syncStatus = document.getElementById('syncStatus');
        if (syncStatus) {
            if (this.recordData.synced) {
                syncStatus.innerHTML = '<span class="badge bg-success">Synced to Cloud</span>';
            } else {
                syncStatus.innerHTML = '<span class="badge bg-warning">Pending Sync</span>';
            }
        }
    }

    updateMetric(elementId, value, minNormal, maxNormal) {
        const element = document.getElementById(elementId);
        if (!element) return;

        if (!value && value !== 0) {
            element.textContent = '-';
            return;
        }

        element.textContent = value;

        // Remove existing classes
        element.classList.remove('text-success', 'text-warning', 'text-danger');

        // Add appropriate class
        if (value < minNormal) {
            element.classList.add('text-warning');
        } else if (value > maxNormal) {
            element.classList.add('text-danger');
        } else {
            element.classList.add('text-success');
        }
    }

    updatePatientInfo() {
        if (!this.patientData) return;

        const patientName = document.getElementById('patientName');
        if (patientName) {
            patientName.textContent = `${this.patientData.firstName || ''} ${this.patientData.lastName || ''}`.trim();
        }

        const patientMRN = document.getElementById('patientMRN');
        if (patientMRN) patientMRN.textContent = this.patientData.medicalRecordNumber || '-';

        const patientDOB = document.getElementById('patientDOB');
        if (patientDOB && this.patientData.dateOfBirth) {
            patientDOB.textContent = this.formatDate(this.patientData.dateOfBirth);
        }

        const patientGender = document.getElementById('patientGender');
        if (patientGender) patientGender.textContent = this.patientData.gender || '-';
    }

    renderWaveform() {
        if (!this.ctx || !this.canvas) return;

        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear canvas
        this.ctx.clearRect(0, 0, width, height);

        // Draw grid
        this.drawGrid(width, height);

        // Get the selected lead data
        const leadData = this.getLeadData(this.currentLead);

        // Draw waveform
        if (leadData && leadData.length > 0) {
            this.drawWaveform(leadData, width, height);
        } else {
            this.drawNoDataMessage(width, height);
        }
    }

    drawGrid(width, height) {
        this.ctx.save();
        this.ctx.strokeStyle = '#ddd';
        this.ctx.lineWidth = 0.5;

        const majorGridSpacing = 100; // pixels
        const minorGridSpacing = 25; // pixels

        // Vertical lines (time)
        for (let x = 0; x <= width; x += majorGridSpacing) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, height);
            this.ctx.strokeStyle = x % (majorGridSpacing * 5) === 0 ? '#aaa' : '#ddd';
            this.ctx.stroke();

            // Add time labels
            if (x % (majorGridSpacing * 5) === 0 && x > 0) {
                this.ctx.fillStyle = '#999';
                this.ctx.font = '10px monospace';
                const timeSec = (x / majorGridSpacing) * 0.2;
                this.ctx.fillText(`${timeSec.toFixed(1)}s`, x + 2, 12);
            }
        }

        // Horizontal lines (amplitude)
        for (let y = 0; y <= height; y += minorGridSpacing) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(width, y);
            this.ctx.strokeStyle = y % majorGridSpacing === 0 ? '#aaa' : '#ddd';
            this.ctx.stroke();

            // Add amplitude labels
            if (y % majorGridSpacing === 0) {
                this.ctx.fillStyle = '#999';
                this.ctx.font = '10px monospace';
                const amplitude = ((height / 2 - y) / (height / 4)).toFixed(1);
                this.ctx.fillText(`${amplitude}mV`, 2, y + 10);
            }
        }

        this.ctx.restore();
    }

    drawWaveform(data, width, height) {
        if (!data || data.length === 0) return;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#2c3e50';
        this.ctx.lineWidth = 1.5;

        // Calculate scaling factors
        const xStep = width / data.length;
        const midY = height / 2;

        // Find min/max for scaling
        const validData = data.filter(v => !isNaN(v) && isFinite(v));
        if (validData.length === 0) return;

        const maxVal = Math.max(...validData.map(v => Math.abs(v)));
        const amplitudeScale = (height / 4) / maxVal * this.zoomLevel;

        let firstPoint = true;

        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            if (isNaN(value) || !isFinite(value)) continue;

            const x = i * xStep;
            const y = midY - value * amplitudeScale;

            if (firstPoint) {
                this.ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                this.ctx.lineTo(x, y);
            }
        }

        this.ctx.stroke();

        // Add baseline
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#ff6b6b';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([5, 5]);
        this.ctx.moveTo(0, midY);
        this.ctx.lineTo(width, midY);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        this.ctx.restore();
    }

    drawNoDataMessage(width, height) {
        this.ctx.fillStyle = '#999';
        this.ctx.font = '14px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('No waveform data available', width / 2, height / 2);
    }

    getLeadData(lead) {
        if (!this.leadData) return null;

        // Direct lead access
        if (this.leadData[lead]) {
            return this.leadData[lead];
        }

        // Try common lead variations
        const leadMap = {
            'I': ['I', 'LeadI', 'Lead I'],
            'II': ['II', 'LeadII', 'Lead II'],
            'III': ['III', 'LeadIII', 'Lead III'],
            'aVR': ['aVR', 'avR', 'AvR'],
            'aVL': ['aVL', 'avL', 'AvL'],
            'aVF': ['aVF', 'avF', 'AvF'],
            'V1': ['V1', 'LeadV1', 'Lead V1'],
            'V2': ['V2', 'LeadV2', 'Lead V2'],
            'V3': ['V3', 'LeadV3', 'Lead V3'],
            'V4': ['V4', 'LeadV4', 'Lead V4'],
            'V5': ['V5', 'LeadV5', 'Lead V5'],
            'V6': ['V6', 'LeadV6', 'Lead V6']
        };

        const variations = leadMap[lead] || [lead];
        for (const variation of variations) {
            if (this.leadData[variation]) {
                return this.leadData[variation];
            }
        }

        return null;
    }

    zoomIn() {
        this.zoomLevel = Math.min(4, this.zoomLevel + 0.1);
        const zoomRange = document.getElementById('zoomRange');
        if (zoomRange) zoomRange.value = this.zoomLevel;
        const zoomValue = document.getElementById('zoomValue');
        if (zoomValue) zoomValue.textContent = this.zoomLevel.toFixed(1) + 'x';
        this.renderWaveform();
    }

    zoomOut() {
        this.zoomLevel = Math.max(0.5, this.zoomLevel - 0.1);
        const zoomRange = document.getElementById('zoomRange');
        if (zoomRange) zoomRange.value = this.zoomLevel;
        const zoomValue = document.getElementById('zoomValue');
        if (zoomValue) zoomValue.textContent = this.zoomLevel.toFixed(1) + 'x';
        this.renderWaveform();
    }

    resetView() {
        this.zoomLevel = 1;
        this.speed = 50;
        this.currentLead = 'II';

        const zoomRange = document.getElementById('zoomRange');
        if (zoomRange) zoomRange.value = 1;
        const zoomValue = document.getElementById('zoomValue');
        if (zoomValue) zoomValue.textContent = '1.0x';

        const speedSelect = document.getElementById('speedSelect');
        if (speedSelect) speedSelect.value = '50';

        const leadSelect = document.getElementById('leadSelect');
        if (leadSelect) leadSelect.value = 'II';

        this.renderWaveform();
    }

    printECG() {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Please allow popups to print');
            return;
        }

        const content = this.generatePrintContent();
        printWindow.document.write(content);
        printWindow.document.close();
        printWindow.print();
    }

    generatePrintContent() {
        const currentDate = new Date().toLocaleString();
        const patientInfo = this.patientData || {};
        const leadData = this.getLeadData(this.currentLead) || [];

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <title>ECG Report - ${patientInfo.firstName || ''} ${patientInfo.lastName || ''}</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        margin: 20px;
                        padding: 0;
                    }
                    .header {
                        text-align: center;
                        margin-bottom: 20px;
                        padding-bottom: 10px;
                        border-bottom: 2px solid #000;
                    }
                    .patient-info {
                        margin-bottom: 20px;
                        padding: 10px;
                        background: #f5f5f5;
                    }
                    .metrics {
                        display: grid;
                        grid-template-columns: repeat(4, 1fr);
                        gap: 10px;
                        margin-bottom: 20px;
                    }
                    .metric {
                        text-align: center;
                        padding: 10px;
                        border: 1px solid #ddd;
                    }
                    .waveform-container {
                        margin: 20px 0;
                        text-align: center;
                    }
                    .footer {
                        margin-top: 20px;
                        text-align: center;
                        font-size: 12px;
                        color: #666;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                    td, th {
                        padding: 5px;
                        text-align: left;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>ECG Report</h1>
                    <p>Generated: ${currentDate}</p>
                </div>
                
                <div class="patient-info">
                    <h3>Patient Information</h3>
                    <table>
                        <tr><th>Name:</th><td>${this.escapeHtml(patientInfo.firstName || '')} ${this.escapeHtml(patientInfo.lastName || '')}</td></tr>
                        <tr><th>MRN:</th><td>${this.escapeHtml(patientInfo.medicalRecordNumber || '-')}</td></tr>
                        <tr><th>Date of Birth:</th><td>${this.formatDate(patientInfo.dateOfBirth)}</td></tr>
                        <tr><th>Gender:</th><td>${this.escapeHtml(patientInfo.gender || '-')}</td></tr>
                    </table>
                </div>
                
                <div class="metrics">
                    <div class="metric"><strong>Heart Rate</strong><br>${this.recordData?.heart_rate || '-'} bpm</div>
                    <div class="metric"><strong>PR Interval</strong><br>${this.recordData?.pr_interval || '-'} ms</div>
                    <div class="metric"><strong>QRS Duration</strong><br>${this.recordData?.qrs_duration || '-'} ms</div>
                    <div class="metric"><strong>QT Interval</strong><br>${this.recordData?.qt_interval || '-'} ms</div>
                </div>
                
                <div class="waveform-container">
                    <h3>ECG Waveform - Lead ${this.currentLead}</h3>
                    <canvas id="printCanvas" width="800" height="400"></canvas>
                </div>
                
                <div class="footer">
                    <p>Device: ${this.escapeHtml(this.recordData?.device_model || '-')} (${this.escapeHtml(this.recordData?.vendor || '-')})</p>
                    <p>Recording Time: ${this.formatDateTime(this.recordData?.recording_time)}</p>
                </div>
                
                <script>
                    const canvas = document.getElementById('printCanvas');
                    const ctx = canvas.getContext('2d');
                    const leadData = ${JSON.stringify(leadData)};
                    
                    function drawPrintGrid() {
                        ctx.strokeStyle = '#ddd';
                        ctx.lineWidth = 0.5;
                        for (let x = 0; x <= canvas.width; x += 100) {
                            ctx.beginPath();
                            ctx.moveTo(x, 0);
                            ctx.lineTo(x, canvas.height);
                            ctx.stroke();
                        }
                        for (let y = 0; y <= canvas.height; y += 50) {
                            ctx.beginPath();
                            ctx.moveTo(0, y);
                            ctx.lineTo(canvas.width, y);
                            ctx.stroke();
                        }
                    }
                    
                    function drawPrintWaveform() {
                        if (!leadData || leadData.length === 0) return;
                        ctx.beginPath();
                        ctx.strokeStyle = '#000';
                        ctx.lineWidth = 1.5;
                        const xStep = canvas.width / leadData.length;
                        const midY = canvas.height / 2;
                        const maxVal = Math.max(...leadData.map(v => Math.abs(v)));
                        const amplitude = canvas.height / 4 / maxVal;
                        for (let i = 0; i < leadData.length; i++) {
                            const x = i * xStep;
                            const y = midY - leadData[i] * amplitude;
                            if (i === 0) ctx.moveTo(x, y);
                            else ctx.lineTo(x, y);
                        }
                        ctx.stroke();
                    }
                    
                    drawPrintGrid();
                    drawPrintWaveform();
                </script>
            </body>
            </html>
        `;
    }

    async exportAsPDF() {
        this.printECG();
    }

    async exportAsJSON() {
        const exportData = {
            record: this.recordData,
            patient: this.patientData,
            waveform: this.leadData,
            exportedAt: new Date().toISOString(),
            version: '1.0'
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const exportFileDefaultName = `ecg_${this.recordId}_${new Date().toISOString().split('T')[0]}.json`;

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    }

    downloadAsImage() {
        if (!this.canvas) return;
        const link = document.createElement('a');
        link.download = `ecg_waveform_${this.currentLead}.png`;
        link.href = this.canvas.toDataURL();
        link.click();
    }

    toggleFullscreen() {
        const container = document.getElementById('waveform-container');
        if (!container) return;
        if (!document.fullscreenElement) {
            container.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    handleResize() {
        this.resizeCanvas();
        this.renderWaveform();
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;

        this.canvas.width = width;
        this.canvas.height = height;

        this.renderWaveform();
    }

    showLoading() {
        const loader = document.getElementById('waveformLoader');
        if (loader) loader.style.display = 'flex';
        this.isLoading = true;
    }

    hideLoading() {
        const loader = document.getElementById('waveformLoader');
        if (loader) loader.style.display = 'none';
        this.isLoading = false;
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger alert-dismissible fade show position-fixed top-0 end-0 m-3';
        errorDiv.style.zIndex = '9999';
        errorDiv.style.minWidth = '300px';
        errorDiv.innerHTML = `
            <i class="fas fa-exclamation-circle me-2"></i>
            ${this.escapeHtml(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 5000);
    }

    formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '-';
        return date.toLocaleDateString();
    }

    formatDateTime(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '-';
        return date.toLocaleString();
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize ECG viewer when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('ecgCanvas');
    if (canvas) {
        window.ecgViewer = new ECGViewer('ecgCanvas', {
            initialLead: 'II',
            initialZoom: 1,
            initialSpeed: 50
        });
    }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ECGViewer };
}