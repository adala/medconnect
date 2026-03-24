// public/js/patients.js

// ==================== Patient Management Functions ====================

let currentPage = 1;
let currentSearch = '';
let patientsData = [];

// Load patients list
async function loadPatients(page = 1, search = '') {
    currentPage = page;
    currentSearch = search;
    
    const tbody = document.querySelector('#patientsTable tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-5"><i class="fas fa-spinner fa-spin me-2"></i>Loading patients...</td></tr>';
    }
    
    try {
        let url = `/api/local/patients?page=${page}&limit=20`;
        if (search) {
            url += `&search=${encodeURIComponent(search)}`;
        }
        
        const response = await fetch(url, {
            credentials: 'same-origin'
        });
        
        if (response.redirected || response.status === 401) {
            window.location.href = '/login';
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            patientsData = data.data;
            renderPatientsTable(patientsData);
            renderPagination(data.pagination);
        } else {
            showError('Failed to load patients: ' + data.error);
        }
    } catch (error) {
        console.error('Load patients error:', error);
        showError('Network error loading patients');
    }
}

// Render patients table
function renderPatientsTable(patients) {
    const tbody = document.querySelector('#patientsTable tbody');
    if (!tbody) return;
    
    if (!patients || patients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-5"><i class="fas fa-user-plus fa-3x mb-3 d-block text-muted"></i>No patients found</td></tr>';
        return;
    }
    
    tbody.innerHTML = patients.map(patient => `
        <tr data-patient-id="${patient.id}">
            <td><code>${escapeHtml(patient.medicalRecordNumber || '-')}</code></td>
            <td>
                <a href="/patients/${patient.id}" class="text-decoration-none fw-semibold">
                    ${escapeHtml(patient.firstName)} ${escapeHtml(patient.lastName)}
                </a>
            </td>
            <td>${formatDate(patient.dateOfBirth)}</td>
            <td>${escapeHtml(patient.gender || '-')}</td>
            <td>${patient.synced ? '<span class="badge bg-success">Synced</span>' : '<span class="badge bg-warning">Local</span>'}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary view-patient-btn" data-patient-id="${patient.id}">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn btn-sm btn-outline-secondary edit-patient-btn" data-patient-id="${patient.id}">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger delete-patient-btn" data-patient-id="${patient.id}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// Render pagination
function renderPagination(pagination) {
    const paginationContainer = document.getElementById('paginationContainer');
    if (!paginationContainer) return;
    
    if (pagination.totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    let html = '<ul class="pagination justify-content-center">';
    
    // Previous button
    html += `<li class="page-item ${pagination.page === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${pagination.page - 1}">Previous</a>
    </li>`;
    
    // Page numbers
    const startPage = Math.max(1, pagination.page - 2);
    const endPage = Math.min(pagination.totalPages, startPage + 4);
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<li class="page-item ${i === pagination.page ? 'active' : ''}">
            <a class="page-link" href="#" data-page="${i}">${i}</a>
        </li>`;
    }
    
    // Next button
    html += `<li class="page-item ${pagination.page === pagination.totalPages ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${pagination.page + 1}">Next</a>
    </li>`;
    
    html += '</ul>';
    paginationContainer.innerHTML = html;
    
    // Add event listeners to pagination links
    paginationContainer.querySelectorAll('.page-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = parseInt(link.dataset.page);
            if (page && !isNaN(page)) {
                loadPatients(page, currentSearch);
            }
        });
    });
}

// Show add patient modal
function showAddPatientModal() {
    document.getElementById('patientModalTitle').textContent = 'Add New Patient';
    document.getElementById('patientId').value = '';
    document.getElementById('mrn').value = '';
    document.getElementById('firstName').value = '';
    document.getElementById('lastName').value = '';
    document.getElementById('dob').value = '';
    document.getElementById('gender').value = '';
    document.getElementById('phone').value = '';
    document.getElementById('email').value = '';
    document.getElementById('address').value = '';
    
    const modal = new bootstrap.Modal(document.getElementById('patientModal'));
    modal.show();
}

// View patient details
function viewPatient(patientId) {
    window.location.href = `/patients/${patientId}`;
}

// Edit patient
async function editPatient(patientId) {
    try {
        const response = await fetch(`/api/local/patients/${patientId}`, {
            credentials: 'same-origin'
        });
        
        const data = await response.json();
        
        if (data.success) {
            const patient = data.data;
            document.getElementById('patientModalTitle').textContent = 'Edit Patient';
            document.getElementById('patientId').value = patient.id;
            document.getElementById('mrn').value = patient.medicalRecordNumber;
            document.getElementById('firstName').value = patient.firstName;
            document.getElementById('lastName').value = patient.lastName;
            document.getElementById('dob').value = patient.dateOfBirth?.split('T')[0] || '';
            document.getElementById('gender').value = patient.gender;
            document.getElementById('phone').value = patient.phone || '';
            document.getElementById('email').value = patient.email || '';
            document.getElementById('address').value = typeof patient.address === 'string' ? patient.address : JSON.stringify(patient.address || {});
            
            const modal = new bootstrap.Modal(document.getElementById('patientModal'));
            modal.show();
        } else {
            alert('Error loading patient: ' + data.error);
        }
    } catch (error) {
        console.error('Edit patient error:', error);
        alert('Error loading patient: ' + error.message);
    }
}

// Save patient (create or update)
async function savePatient() {
    const patientId = document.getElementById('patientId').value;
    const isEdit = !!patientId;
    
    const patientData = {
        medicalRecordNumber: document.getElementById('mrn').value,
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        dateOfBirth: document.getElementById('dob').value,
        gender: document.getElementById('gender').value,
        phone: document.getElementById('phone').value,
        email: document.getElementById('email').value,
        address: document.getElementById('address').value ? { street: document.getElementById('address').value } : {}
    };
    
    // Validate required fields
    if (!patientData.medicalRecordNumber || !patientData.firstName || !patientData.lastName || !patientData.dateOfBirth || !patientData.gender) {
        alert('Please fill in all required fields');
        return;
    }
    
    const url = isEdit ? `/api/local/patients/${patientId}` : '/api/local/patients';
    const method = isEdit ? 'PUT' : 'POST';
    
    const btn = document.getElementById('savePatientBtn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';
    
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(patientData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            bootstrap.Modal.getInstance(document.getElementById('patientModal')).hide();
            loadPatients(currentPage, currentSearch);
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        console.error('Save patient error:', error);
        alert('Error saving patient: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Delete patient
async function deletePatient(patientId, patientName) {
    if (!confirm(`Are you sure you want to delete ${patientName}? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/local/patients/${patientId}`, {
            method: 'DELETE',
            credentials: 'same-origin'
        });
        
        const data = await response.json();
        
        if (data.success) {
            loadPatients(currentPage, currentSearch);
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        console.error('Delete patient error:', error);
        alert('Error deleting patient: ' + error.message);
    }
}

// Search patients
function searchPatients() {
    const searchInput = document.getElementById('searchInput');
    const searchTerm = searchInput?.value || '';
    loadPatients(1, searchTerm);
}

// Helper functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString();
}

function showError(message) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-danger alert-dismissible fade show';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    const container = document.querySelector('.app-body');
    if (container) {
        container.insertBefore(alertDiv, container.firstChild);
        setTimeout(() => alertDiv.remove(), 5000);
    }
}

// Initialize event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Load patients
    loadPatients();
    
    // Add Patient Button
    const addPatientBtn = document.getElementById('addPatientBtn');
    if (addPatientBtn) {
        addPatientBtn.addEventListener('click', showAddPatientModal);
    }
    
    // Save Patient Button
    const savePatientBtn = document.getElementById('savePatientBtn');
    if (savePatientBtn) {
        savePatientBtn.addEventListener('click', savePatient);
    }
    
    // Search Input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchPatients();
            }, 500);
        });
    }
    
    // Event delegation for table buttons
    const table = document.getElementById('patientsTable');
    if (table) {
        table.addEventListener('click', function(e) {
            const viewBtn = e.target.closest('.view-patient-btn');
            if (viewBtn) {
                e.preventDefault();
                const patientId = viewBtn.dataset.patientId;
                if (patientId) viewPatient(patientId);
                return;
            }
            
            const editBtn = e.target.closest('.edit-patient-btn');
            if (editBtn) {
                e.preventDefault();
                const patientId = editBtn.dataset.patientId;
                if (patientId) editPatient(patientId);
                return;
            }
            
            const deleteBtn = e.target.closest('.delete-patient-btn');
            if (deleteBtn) {
                e.preventDefault();
                const patientId = deleteBtn.dataset.patientId;
                const row = deleteBtn.closest('tr');
                const patientName = row?.querySelector('td:nth-child(2) a')?.textContent || '';
                if (patientId) deletePatient(patientId, patientName);
                return;
            }
        });
    }
});

// Expose functions to global scope for any inline needs
window.showAddPatientModal = showAddPatientModal;
window.editPatient = editPatient;
window.deletePatient = deletePatient;
window.viewPatient = viewPatient;
window.searchPatients = searchPatients;
