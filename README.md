# Medconnect - OFFIN Healthcare Gateway

Medical Data Analysis System for ECG processing and management.

## Deployment on Vercel

### Environment Variables
Set these in Vercel Dashboard:
- `ENCRYPTION_KEY`: 32+ character encryption key
- `SESSION_SECRET`: Session encryption secret
- `TENANT_ID`: Your tenant identifier
- `API_KEY`: Cloud API key
- `NODE_ENV`: production

### Database
SQLite database is stored in `/tmp/offin.db` (temporary storage on Vercel)

### File Storage
- Drop folder files are stored in `/tmp/drop-folder`
- Quarantine files are stored in `/tmp/quarantine`

### API Endpoints
- `/api/local/patients` - Patient management
- `/api/local/ecg` - ECG records
- `/api/local/users` - User management
- `/api/local/sync` - Sync operations

### Web Interface
- `/` - Dashboard
- `/patients` - Patient list
- `/ecg` - ECG records
- `/login` - Login page