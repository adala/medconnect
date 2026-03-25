// gateway/src/services/HL7Service.js

const net = require('net');
const { EventEmitter } = require('events');
const { createServer } = require('net');

class HL7Service extends EventEmitter {
    constructor({ port = 6661, db, logger }) {
        super();
        this.port = port;
        this.db = db;
        this.logger = logger;
        this.server = null;
        this.connections = [];
        this.messageQueue = [];
        this.isRunning = false;
    }

    async start() {
        if (this.isRunning) return;

        this.server = createServer((socket) => {
            this.handleConnection(socket);
        });

        return new Promise((resolve, reject) => {
            this.server.listen(this.port, () => {
                this.isRunning = true;
                this.logger?.info(`HL7 listener started on port ${this.port}`);
                resolve();
            });

            this.server.on('error', (error) => {
                this.logger?.error('HL7 server error:', error);
                reject(error);
            });
        });
    }

    handleConnection(socket) {
        const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
        this.logger?.info(`HL7 client connected: ${clientAddress}`);
        
        this.connections.push(socket);
        
        let dataBuffer = '';

        socket.on('data', (data) => {
            dataBuffer += data.toString();
            
            // Check for message boundaries (HL7 uses vertical tab as segment separator)
            if (dataBuffer.includes('\x0B') && dataBuffer.includes('\x1C\x0D')) {
                const messages = this.extractMessages(dataBuffer);
                
                messages.forEach(message => {
                    this.processIncomingMessage(message, socket);
                });
                
                dataBuffer = '';
            }
        });

        socket.on('error', (error) => {
            this.logger?.error(`HL7 client error (${clientAddress}):`, error);
        });

        socket.on('close', () => {
            this.logger?.info(`HL7 client disconnected: ${clientAddress}`);
            this.connections = this.connections.filter(conn => conn !== socket);
        });
    }

    extractMessages(buffer) {
        const messages = [];
        let start = 0;
        
        while (true) {
            const startIdx = buffer.indexOf('\x0B', start);
            const endIdx = buffer.indexOf('\x1C\x0D', start);
            
            if (startIdx === -1 || endIdx === -1) break;
            
            const message = buffer.substring(startIdx + 1, endIdx);
            messages.push(message);
            
            start = endIdx + 2;
        }
        
        return messages;
    }

    async processIncomingMessage(message, socket) {
        try {
            this.logger?.debug('Received HL7 message:', message);
            
            // Parse message
            const parsed = this.parseHL7(message);
            
            // Store in local database
            const recordId = await this.storeMessage(parsed);
            
            // Queue for sync
            await this.db.queueForSync(recordId, 'hl7_message', 'create');
            
            // Send ACK
            const ack = this.buildACK(message);
            socket.write(`\x0B${ack}\x1C\x0D`);
            
            this.emit('message', { message: parsed, recordId });
            
        } catch (error) {
            this.logger?.error('Error processing HL7 message:', error);
            
            // Send error ACK
            const errorAck = this.buildErrorACK(message);
            socket.write(`\x0B${errorAck}\x1C\x0D`);
        }
    }

    parseHL7(message) {
        const segments = message.split('\r');
        const result = {
            raw: message,
            segments: [],
            patientInfo: {},
            observations: []
        };
        
        for (const segment of segments) {
            if (!segment.trim()) continue;
            
            const fields = segment.split('|');
            const segmentName = fields[0];
            
            result.segments.push(segmentName);
            
            switch (segmentName) {
                case 'MSH':
                    result.messageType = fields[8];
                    result.sendingApp = fields[2];
                    result.sendingFacility = fields[3];
                    result.receivingApp = fields[4];
                    result.receivingFacility = fields[5];
                    result.messageControlId = fields[9];
                    break;
                    
                case 'PID':
                    result.patientInfo = {
                        id: fields[3]?.[0],
                        mrn: fields[3]?.[1],
                        name: this.parseName(fields[5]),
                        dob: fields[7]?.[0],
                        gender: fields[8]?.[0],
                        phone: fields[13]?.[0],
                        address: this.parseAddress(fields[11])
                    };
                    break;
                    
                case 'OBX':
                    result.observations.push({
                        setId: fields[1],
                        type: fields[2],
                        identifier: fields[3],
                        value: fields[5],
                        units: fields[6],
                        referenceRange: fields[7],
                        status: fields[11]
                    });
                    break;
            }
        }
        
        return result;
    }

    parseName(nameField) {
        if (!nameField) return null;
        const parts = nameField.split('^');
        return {
            lastName: parts[0],
            firstName: parts[1],
            middleName: parts[2]
        };
    }

    parseAddress(addressField) {
        if (!addressField) return null;
        const parts = addressField.split('^');
        return {
            street: parts[0],
            city: parts[2],
            state: parts[3],
            zip: parts[4],
            country: parts[5]
        };
    }

    buildACK(originalMessage) {
        const lines = originalMessage.split('\r');
        const mshFields = lines[0].split('|');
        const originalControlId = mshFields[9];
        
        const timestamp = this.formatHL7Date(new Date());
        
        const fields = [
            'MSH',
            '^~\\&',
            'OFFIN_GATEWAY',
            'HOSPITAL',
            mshFields[2], // Sending app from original
            mshFields[3], // Sending facility from original
            timestamp,
            '',
            'ACK',
            this.generateMessageControlId(),
            'P',
            '2.5.1',
            '',
            '',
            '',
            originalControlId
        ];
        
        const msh = fields.join('|');
        const msa = `MSA|AA|${originalControlId}`;
        
        return `${msh}\r${msa}`;
    }

    buildErrorACK(originalMessage) {
        const lines = originalMessage.split('\r');
        const mshFields = lines[0].split('|');
        const originalControlId = mshFields[9];
        
        const timestamp = this.formatHL7Date(new Date());
        
        const fields = [
            'MSH',
            '^~\\&',
            'OFFIN_GATEWAY',
            'HOSPITAL',
            mshFields[2],
            mshFields[3],
            timestamp,
            '',
            'ACK',
            this.generateMessageControlId(),
            'P',
            '2.5.1',
            '',
            '',
            '',
            originalControlId
        ];
        
        const msh = fields.join('|');
        const msa = `MSA|AE|${originalControlId}|Error processing message`;
        
        return `${msh}\r${msa}`;
    }

    async storeMessage(parsedMessage) {
        // Store in local database
        const result = await this.db.db.run(
            `INSERT INTO hl7_messages 
             (message_type, message_control_id, patient_mrn, raw_message, parsed_data, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                parsedMessage.messageType,
                parsedMessage.messageControlId,
                parsedMessage.patientInfo?.mrn,
                parsedMessage.raw,
                JSON.stringify(parsedMessage),
                new Date().toISOString()
            ]
        );
        
        return result.lastID;
    }

    async sendMessage(message, destination) {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            const timeout = setTimeout(() => {
                client.destroy();
                reject(new Error('HL7 send timeout'));
            }, 30000);
            
            client.connect(destination.port, destination.host, () => {
                this.logger?.debug(`Connected to EMR: ${destination.host}:${destination.port}`);
                client.write(`\x0B${message}\x1C\x0D`);
            });
            
            let responseData = '';
            
            client.on('data', (data) => {
                responseData += data.toString();
                
                if (responseData.includes('\x1C\x0D')) {
                    clearTimeout(timeout);
                    client.end();
                    
                    const start = responseData.indexOf('\x0B') + 1;
                    const end = responseData.indexOf('\x1C\x0D');
                    const ackMessage = start > 0 && end > start ? 
                        responseData.substring(start, end) : responseData;
                    
                    resolve(ackMessage);
                }
            });
            
            client.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    formatHL7Date(date) {
        const d = new Date(date);
        return d.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    }

    generateMessageControlId() {
        return `MSG${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    }

    async stop() {
        if (this.server) {
            this.server.close();
            this.isRunning = false;
            this.logger?.info('HL7 server stopped');
        }
        
        // Close all connections
        this.connections.forEach(socket => {
            socket.end();
        });
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            port: this.port,
            connections: this.connections.length,
            queueSize: this.messageQueue.length
        };
    }
}

module.exports = { HL7Service };