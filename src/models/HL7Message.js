// gateway/src/models/HL7Message.js

class HL7Message {
    constructor(db) {
        this.db = db;
    }

    async create(messageData) {
        const {
            messageType,
            messageControlId,
            patientMrn,
            rawMessage,
            parsedData,
            status = 'received'
        } = messageData;

        const result = await this.db.run(
            `INSERT INTO hl7_messages (
                message_type, message_control_id, patient_mrn,
                raw_message, parsed_data, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                messageType,
                messageControlId,
                patientMrn,
                rawMessage,
                JSON.stringify(parsedData),
                status,
                new Date().toISOString()
            ]
        );

        return this.findById(result.lastID);
    }

    async findById(id) {
        return this.db.get(
            'SELECT * FROM hl7_messages WHERE id = ?',
            id
        );
    }

    async findByControlId(messageControlId) {
        return this.db.get(
            'SELECT * FROM hl7_messages WHERE message_control_id = ?',
            messageControlId
        );
    }

    async findByPatient(mrn, limit = 50) {
        return this.db.all(
            'SELECT * FROM hl7_messages WHERE patient_mrn = ? ORDER BY created_at DESC LIMIT ?',
            [mrn, limit]
        );
    }

    async getUnsynced(limit = 100) {
        return this.db.all(
            'SELECT * FROM hl7_messages WHERE synced = false ORDER BY created_at ASC LIMIT ?',
            limit
        );
    }

    async markAsSynced(ids) {
        const placeholders = ids.map(() => '?').join(',');
        await this.db.run(
            `UPDATE hl7_messages SET synced = true, synced_at = ? 
             WHERE id IN (${placeholders})`,
            [new Date().toISOString(), ...ids]
        );
    }

    async getStats() {
        const stats = await this.db.get(
            `SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN message_type LIKE 'ADT%' THEN 1 END) as adt_messages,
                COUNT(CASE WHEN message_type LIKE 'ORM%' THEN 1 END) as orm_messages,
                COUNT(CASE WHEN message_type LIKE 'ORU%' THEN 1 END) as oru_messages,
                COUNT(CASE WHEN synced = false THEN 1 END) as pending_sync
             FROM hl7_messages`
        );

        return stats;
    }

    async deleteOldMessages(daysOld = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        const result = await this.db.run(
            'DELETE FROM hl7_messages WHERE created_at < ? AND synced = true',
            cutoffDate.toISOString()
        );

        return result.changes;
    }
}

module.exports = { HL7Message };