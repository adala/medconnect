// gateway/src/models/SyncQueue.js

class SyncQueue {
    constructor(db) {
        this.db = db;
    }

    async add(recordId, recordType, operation = 'create', priority = 0) {
        const result = await this.db.run(
            `INSERT INTO sync_queue (
                record_id, record_type, operation, priority, status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                recordId,
                recordType,
                operation,
                priority,
                'pending',
                new Date().toISOString(),
                new Date().toISOString()
            ]
        );

        return result.lastID;
    }

    async getPending(limit = 100, recordType = null) {
        let query = `SELECT * FROM sync_queue 
                     WHERE status = 'pending' 
                     ORDER BY priority DESC, created_at ASC 
                     LIMIT ?`;
        
        const params = [limit];

        if (recordType) {
            query = `SELECT * FROM sync_queue 
                     WHERE status = 'pending' AND record_type = ? 
                     ORDER BY priority DESC, created_at ASC 
                     LIMIT ?`;
            params.unshift(recordType);
        }

        return this.db.all(query, params);
    }

    async markAsProcessed(queueIds) {
        const placeholders = queueIds.map(() => '?').join(',');
        await this.db.run(
            `UPDATE sync_queue 
             SET status = 'completed', 
                 attempts = attempts + 1,
                 processed_at = ?,
                 updated_at = ?
             WHERE id IN (${placeholders})`,
            [new Date().toISOString(), new Date().toISOString(), ...queueIds]
        );
    }

    async markAsFailed(queueId, error) {
        await this.db.run(
            `UPDATE sync_queue 
             SET status = 'failed', 
                 attempts = attempts + 1,
                 error = ?,
                 updated_at = ?
             WHERE id = ?`,
            [error, new Date().toISOString(), queueId]
        );
    }

    async retryFailed(maxAttempts = 3) {
        await this.db.run(
            `UPDATE sync_queue 
             SET status = 'pending', 
                 error = NULL,
                 updated_at = ?
             WHERE status = 'failed' AND attempts < ?`,
            [new Date().toISOString(), maxAttempts]
        );
    }

    async cleanup(daysOld = 7) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        const result = await this.db.run(
            'DELETE FROM sync_queue WHERE status = "completed" AND processed_at < ?',
            cutoffDate.toISOString()
        );

        return result.changes;
    }

    async getStats() {
        const stats = await this.db.get(
            `SELECT 
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                AVG(attempts) as avg_attempts
             FROM sync_queue`
        );

        return stats;
    }
}

module.exports = { SyncQueue };