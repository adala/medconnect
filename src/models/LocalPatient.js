// gateway/src/models/LocalPatient.js

class LocalPatient {
    constructor(db) {
        this.db = db;
    }

    async create(patientData) {
        const {
            medicalRecordNumber,
            firstName,
            lastName,
            dateOfBirth,
            gender,
            phone,
            email,
            address
        } = patientData;

        const result = await this.db.run(
            `INSERT INTO patients (
                tenant_id, medical_record_number, first_name, last_name,
                date_of_birth, gender, phone, email, address, local_only,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                process.env.TENANT_ID,
                medicalRecordNumber,
                firstName,
                lastName,
                dateOfBirth,
                gender,
                phone,
                email,
                JSON.stringify(address || {}),
                true,
                new Date().toISOString(),
                new Date().toISOString()
            ]
        );

        return this.findById(result.lastID);
    }

    async findById(id) {
        return this.db.get(
            'SELECT * FROM patients WHERE id = ?',
            id
        );
    }

    async findByMRN(medicalRecordNumber) {
        return this.db.get(
            'SELECT * FROM patients WHERE medical_record_number = ?',
            medicalRecordNumber
        );
    }

    async findAll(limit = 100, offset = 0) {
        return this.db.all(
            'SELECT * FROM patients ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [limit, offset]
        );
    }

    async update(id, updates) {
        const allowedFields = [
            'first_name', 'last_name', 'date_of_birth', 'gender',
            'phone', 'email', 'address'
        ];

        const sets = [];
        const values = [];

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                sets.push(`${key} = ?`);
                values.push(value);
            }
        }

        if (sets.length === 0) return null;

        values.push(new Date().toISOString(), id);

        await this.db.run(
            `UPDATE patients SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`,
            values
        );

        return this.findById(id);
    }

    async delete(id) {
        await this.db.run('DELETE FROM patients WHERE id = ?', id);
        return true;
    }

    async count() {
        const result = await this.db.get('SELECT COUNT(*) as count FROM patients');
        return result.count;
    }

    async search(query, limit = 50) {
        const searchTerm = `%${query}%`;
        return this.db.all(
            `SELECT * FROM patients 
             WHERE first_name LIKE ? OR last_name LIKE ? OR medical_record_number LIKE ?
             ORDER BY created_at DESC LIMIT ?`,
            [searchTerm, searchTerm, searchTerm, limit]
        );
    }
}

module.exports = { LocalPatient };