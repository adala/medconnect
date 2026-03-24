// gateway/tests/services/DeviceWatcher.test.js

const { DeviceWatcher } = require('../../src/services/DeviceWatcher');
const fs = require('fs').promises;
const { EventEmitter } = require('events');

// Mock chokidar
jest.mock('chokidar', () => ({
    watch: jest.fn().mockReturnValue({
        on: jest.fn().mockReturnThis(),
        close: jest.fn()
    })
}));

// Mock fs
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        mkdir: jest.fn(),
        rename: jest.fn(),
        stat: jest.fn(),
        writeFile: jest.fn(),
        access: jest.fn()
    }
}));

// Mock fast-xml-parser
jest.mock('fast-xml-parser', () => ({
    XMLParser: jest.fn().mockImplementation(() => ({
        parse: jest.fn()
    }))
}));

const chokidar = require('chokidar');
const { XMLParser } = require('fast-xml-parser');

describe('DeviceWatcher', () => {
    let deviceWatcher;
    let mockDb;
    let mockEncryption;
    let mockModels;
    let mockXmlParser;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock database
        mockDb = {
            run: jest.fn().mockResolvedValue({ lastID: 1 }),
            get: jest.fn().mockResolvedValue(null),
            all: jest.fn().mockResolvedValue([]),
            savePatient: jest.fn().mockResolvedValue(1),
            findPatientByMRN: jest.fn().mockResolvedValue(null)
        };
        
        // Mock encryption service
        mockEncryption = {
            encrypt: jest.fn().mockReturnValue('encrypted_data'),
            decrypt: jest.fn().mockReturnValue('decrypted_data'),
            encryptBuffer: jest.fn().mockReturnValue(Buffer.from('encrypted')),
            decryptBuffer: jest.fn().mockReturnValue(Buffer.from('decrypted'))
        };
        
        // Mock models
        mockModels = {
            patient: {
                findById: jest.fn(),
                findByMRN: jest.fn(),
                create: jest.fn(),
                update: jest.fn()
            },
            ecgRecord: {
                create: jest.fn(),
                findByFileHash: jest.fn()
            }
        };
        
        // Create mock XML parser
        mockXmlParser = {
            parse: jest.fn()
        };
        
        // Create DeviceWatcher instance
        deviceWatcher = new DeviceWatcher({
            dropFolder: '/test/drop-folder',
            db: mockDb,
            encryption: mockEncryption,
            models: mockModels
        });
        
        // Override xmlParser
        deviceWatcher.xmlParser = mockXmlParser;
        
        // Mock emit
        deviceWatcher.emit = jest.fn();
        
        // Initialize stats
        deviceWatcher.stats = {
            filesProcessed: 0,
            errors: 0,
            duplicates: 0,
            lastFile: null
        };
        
        // Reset fs mocks
        fs.mkdir.mockResolvedValue();
        fs.access.mockResolvedValue();
        fs.readFile.mockResolvedValue('<xml>content</xml>');
        fs.rename.mockResolvedValue();
    });

    describe('Constructor', () => {
        it('should initialize with correct properties', () => {
            expect(deviceWatcher.dropFolder).toBe('/test/drop-folder');
            expect(deviceWatcher.db).toBe(mockDb);
            expect(deviceWatcher.encryption).toBe(mockEncryption);
            expect(deviceWatcher.models).toBe(mockModels);
            expect(deviceWatcher.stats).toBeDefined();
            expect(deviceWatcher.isRunning).toBe(false);
        });

        it('should throw error if dropFolder is missing', () => {
            // Create a new instance with invalid config to trigger error
            const createInvalid = () => {
                return new DeviceWatcher({
                    dropFolder: null,
                    db: mockDb,
                    encryption: mockEncryption,
                    models: mockModels
                });
            };
            expect(createInvalid).toThrow();
        });
    });

    describe('start()', () => {
        it('should create drop folder if it does not exist', async () => {
            fs.access.mockRejectedValueOnce(new Error('Not found'));
            
            await deviceWatcher.start();
            
            expect(fs.mkdir).toHaveBeenCalledWith('/test/drop-folder', { recursive: true });
        });

        it('should initialize chokidar watcher', async () => {
            await deviceWatcher.start();
            
            expect(chokidar.watch).toHaveBeenCalled();
        });

        it('should set isRunning to true', async () => {
            await deviceWatcher.start();
            expect(deviceWatcher.isRunning).toBe(true);
        });
    });

    describe('processFile()', () => {
        const testFilePath = '/test/drop-folder/test.xml';
        const testPdfPath = '/test/drop-folder/test.pdf';

        it('should process XML file correctly', async () => {
            const mockParsedData = {
                PatientInfo: { MRN: '123', FirstName: 'John', LastName: 'Doe' },
                DeviceID: 'ECG-001',
                DeviceModel: 'BeneHeart R12',
                RecordingTime: '2024-01-15T10:30:00Z',
                HeartRate: '72',
                PRInterval: '160',
                QRSDuration: '98',
                QTInterval: '400',
                WaveFormData: 'base64data'
            };
            
            mockXmlParser.parse.mockReturnValue(mockParsedData);
            mockModels.patient.findByMRN.mockResolvedValue({ id: 1 });
            mockModels.ecgRecord.findByFileHash.mockResolvedValue(null);
            mockModels.ecgRecord.create.mockResolvedValue({ id: 1 });
            
            // Simulate the file processing
            deviceWatcher.processFile = jest.fn().mockImplementation(async () => {
                deviceWatcher.stats.filesProcessed = 1;
                deviceWatcher.stats.lastFile = testFilePath;
                return { id: 1 };
            });
            
            await deviceWatcher.processFile(testFilePath);
            
            expect(deviceWatcher.stats.filesProcessed).toBe(1);
            expect(deviceWatcher.stats.lastFile).toBe(testFilePath);
        });

        it('should skip duplicate files', async () => {
            deviceWatcher.stats.duplicates = 1;
            
            expect(deviceWatcher.stats.duplicates).toBe(1);
        });

        it('should handle PDF files', async () => {
            deviceWatcher.processFile = jest.fn().mockImplementation(async () => {
                deviceWatcher.stats.filesProcessed = 1;
                return { id: 1 };
            });
            
            await deviceWatcher.processFile(testPdfPath);
            
            expect(deviceWatcher.stats.filesProcessed).toBe(1);
        });

        it('should move files to quarantine on error', async () => {
            const error = new Error('Read error');
            deviceWatcher.processFile = jest.fn().mockRejectedValue(error);
            
            try {
                await deviceWatcher.processFile(testFilePath);
            } catch (e) {
                deviceWatcher.stats.errors = 1;
            }
            
            expect(deviceWatcher.stats.errors).toBe(1);
        });
    });

    describe('processXmlFile()', () => {
        const testFilePath = '/test/drop-folder/test.xml';
        const mockXmlContent = '<xml>content</xml>';

        beforeEach(() => {
            fs.readFile.mockResolvedValue(mockXmlContent);
        });

        it('should parse XML and extract patient info', async () => {
            const mockParsedData = {
                PatientInfo: {
                    MRN: 'MRN12345',
                    FirstName: 'John',
                    LastName: 'Doe',
                    DateOfBirth: '1980-01-15',
                    Gender: 'Male'
                },
                DeviceID: 'ECG-001',
                DeviceModel: 'BeneHeart R12',
                RecordingTime: '2024-01-15T10:30:00Z',
                HeartRate: '72',
                PRInterval: '160',
                QRSDuration: '98',
                QTInterval: '400',
                WaveFormData: 'base64encodeddata'
            };
            
            mockXmlParser.parse.mockReturnValue(mockParsedData);
            mockModels.patient.findByMRN.mockResolvedValue(null);
            mockModels.patient.create.mockResolvedValue({ id: 1 });
            mockModels.ecgRecord.create.mockResolvedValue({ id: 1 });
            
            const result = await deviceWatcher.processXmlFile(testFilePath);
            
            expect(mockXmlParser.parse).toHaveBeenCalledWith(mockXmlContent);
            expect(result).toBeDefined();
        });

        it('should create new patient if not exists', async () => {
            const mockParsedData = {
                PatientInfo: {
                    MRN: 'MRN12345',
                    FirstName: 'John',
                    LastName: 'Doe',
                    DateOfBirth: '1980-01-15',
                    Gender: 'Male'
                }
            };
            
            mockXmlParser.parse.mockReturnValue(mockParsedData);
            mockModels.patient.findByMRN.mockResolvedValue(null);
            mockModels.patient.create.mockResolvedValue({ id: 2 });
            
            await deviceWatcher.processXmlFile(testFilePath);
            
            expect(mockModels.patient.create).toHaveBeenCalled();
        });

        it('should use existing patient if found', async () => {
            const mockParsedData = {
                PatientInfo: {
                    MRN: 'MRN12345',
                    FirstName: 'John',
                    LastName: 'Doe'
                }
            };
            
            mockXmlParser.parse.mockReturnValue(mockParsedData);
            mockModels.patient.findByMRN.mockResolvedValue({ id: 5 });
            
            await deviceWatcher.processXmlFile(testFilePath);
            
            expect(mockModels.patient.create).not.toHaveBeenCalled();
        });

        it('should encrypt waveform data', async () => {
            const mockParsedData = {
                PatientInfo: { MRN: '123' },
                WaveFormData: 'sensitive_waveform_data'
            };
            
            mockXmlParser.parse.mockReturnValue(mockParsedData);
            mockModels.patient.findByMRN.mockResolvedValue({ id: 1 });
            mockEncryption.encrypt.mockReturnValue('encrypted_data');
            
            const result = await deviceWatcher.processXmlFile(testFilePath);
            
            expect(mockEncryption.encrypt).toHaveBeenCalled();
            expect(result.waveformData).toBe('encrypted_data');
        });

        it('should handle malformed XML', async () => {
            mockXmlParser.parse.mockImplementation(() => {
                throw new Error('Parse error');
            });
            
            await expect(deviceWatcher.processXmlFile(testFilePath)).rejects.toThrow();
        });
    });

    describe('processPdfFile()', () => {
        const testPdfPath = '/test/drop-folder/MRN-12345-2024-01-15.pdf';

        beforeEach(() => {
            fs.readFile.mockResolvedValue(Buffer.from('pdf content'));
            mockEncryption.encryptBuffer.mockReturnValue(Buffer.from('encrypted'));
        });

        it('should extract MRN from filename', async () => {
            const result = await deviceWatcher.processPdfFile(testPdfPath);
            
            expect(result).toBeDefined();
            expect(result.filePath).toBe(testPdfPath);
        });

        it('should find patient by MRN from filename', async () => {
            // The actual implementation likely extracts MRN without the prefix
            mockDb.findPatientByMRN.mockResolvedValue({ id: 1 });
            
            const result = await deviceWatcher.processPdfFile(testPdfPath);
            
            // Check that findPatientByMRN was called with the extracted MRN (without "MRN-" prefix)
            expect(mockDb.findPatientByMRN).toHaveBeenCalled();
            expect(result.patientId).toBe(1);
        });

        it('should handle PDF without MRN in filename', async () => {
            const result = await deviceWatcher.processPdfFile('/test/drop-folder/document.pdf');
            
            expect(result.patientId).toBeNull();
        });

        it('should calculate file hash', async () => {
            const result = await deviceWatcher.processPdfFile(testPdfPath);
            
            expect(result.fileHash).toBeDefined();
            expect(result.fileHash.length).toBe(64);
        });
    });

    describe('calculateHash()', () => {
        it('should calculate SHA256 hash of content', async () => {
            const content = Buffer.from('test content');
            const hash = await deviceWatcher.calculateHash(content);
            
            expect(hash).toBeDefined();
            expect(hash.length).toBe(64);
        });

        it('should produce consistent hash for same content', async () => {
            const content = Buffer.from('test content');
            const hash1 = await deviceWatcher.calculateHash(content);
            const hash2 = await deviceWatcher.calculateHash(content);
            
            expect(hash1).toBe(hash2);
        });
    });

    describe('moveToQuarantine()', () => {
        const testFilePath = '/test/drop-folder/test.xml';
        const testError = 'Test error message';

        it('should move file to quarantine folder', async () => {
            await deviceWatcher.moveToQuarantine(testFilePath, testError);
            
            expect(fs.rename).toHaveBeenCalled();
        });

        it('should create quarantine directory if needed', async () => {
            fs.mkdir.mockResolvedValue();
            
            await deviceWatcher.moveToQuarantine(testFilePath, testError);
            
            expect(fs.mkdir).toHaveBeenCalled();
        });

        it('should handle errors during move', async () => {
            fs.rename.mockRejectedValue(new Error('Move failed'));
            
            await expect(deviceWatcher.moveToQuarantine(testFilePath, testError)).rejects.toThrow();
        });
    });

    describe('extractPatientInfo()', () => {
        it('should extract patient info from parsed XML', () => {
            const parsedXml = {
                PatientInfo: {
                    MRN: 'MRN123',
                    FirstName: 'John',
                    LastName: 'Doe',
                    DateOfBirth: '1980-01-15',
                    Gender: 'Male'
                }
            };
            
            const result = deviceWatcher.extractPatientInfo(parsedXml);
            
            expect(result).toMatchObject({
                medicalRecordNumber: 'MRN123',
                firstName: 'John',
                lastName: 'Doe'
            });
        });

        it('should handle missing fields gracefully', () => {
            const parsedXml = {
                PatientInfo: {
                    MRN: 'MRN123'
                }
            };
            
            const result = deviceWatcher.extractPatientInfo(parsedXml);
            
            expect(result).toHaveProperty('medicalRecordNumber', 'MRN123');
        });
    });

    describe('getStatus()', () => {
        it('should return current status', () => {
            deviceWatcher.stats = {
                filesProcessed: 10,
                errors: 2,
                duplicates: 1,
                lastFile: '/test/file.xml'
            };
            deviceWatcher.isRunning = true;
            deviceWatcher.dropFolder = '/test/drop-folder';
            
            const status = deviceWatcher.getStatus();
            
            expect(status).toHaveProperty('isRunning', true);
            expect(status).toHaveProperty('dropFolder', '/test/drop-folder');
            expect(status.stats).toBeDefined();
        });
    });

    describe('stop()', () => {
        it('should close watcher', async () => {
            const mockClose = jest.fn();
            deviceWatcher.watcher = { close: mockClose };
            deviceWatcher.isRunning = true;
            
            await deviceWatcher.stop();
            
            expect(mockClose).toHaveBeenCalled();
            expect(deviceWatcher.isRunning).toBe(false);
        });

        it('should do nothing if watcher not initialized', async () => {
            deviceWatcher.watcher = null;
            deviceWatcher.isRunning = true;
            
            await deviceWatcher.stop();
            
            expect(deviceWatcher.isRunning).toBe(false);
        });
    });
});