// public/js/users.js

// Set default credentials for all fetch requests
fetch = (originalFetch => {
    return function(...args) {
        // If it's a request to our API, add credentials
        if (args[0].includes('/api/local/')) {
            const options = args[1] || {};
            options.credentials = 'same-origin';
            args[1] = options;
        }
        return originalFetch.apply(this, args);
    };
})(fetch);

document.addEventListener('DOMContentLoaded', function() {
    // Add User Button
    const addUserBtn = document.getElementById('addUserBtn');
    if (addUserBtn) {
        addUserBtn.addEventListener('click', function() {
            showAddUserModal();
        });
    }
    
    // Save User Button
    const saveUserBtn = document.getElementById('saveUserBtn');
    if (saveUserBtn) {
        saveUserBtn.addEventListener('click', function() {
            saveUser();
        });
    }
    
    // Edit User Buttons
    document.querySelectorAll('.edit-user-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const userId = this.dataset.userId;
            editUser(userId);
        });
    });
    
    // Unlock User Buttons
    document.querySelectorAll('.unlock-user-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const userId = this.dataset.userId;
            unlockUser(userId);
        });
    });
    
    // Delete User Buttons
    document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const userId = this.dataset.userId;
            deleteUser(userId);
        });
    });
});

let editingUserId = null;

function showAddUserModal() {
    editingUserId = null;
    document.getElementById('userModalTitle').textContent = 'Add New User';
    document.getElementById('userId').value = '';
    document.getElementById('firstName').value = '';
    document.getElementById('lastName').value = '';
    document.getElementById('email').value = '';
    document.getElementById('role').value = 'clinician';
    document.getElementById('password').value = '';
    document.getElementById('password').required = true;
    document.getElementById('passwordField').style.display = 'block';
    document.getElementById('requirePasswordChange').checked = true;
    document.getElementById('isActive').checked = true;
    
    const modal = new bootstrap.Modal(document.getElementById('userModal'));
    modal.show();
}

// public/js/users.js

async function saveUser() {
    const userData = {
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        role: document.getElementById('role').value,
        requirePasswordChange: document.getElementById('requirePasswordChange').checked,
        isActive: document.getElementById('isActive').checked
    };
    
    const userId = document.getElementById('userId').value;
    
    if (!userId) {
        // New user
        userData.password = document.getElementById('password').value;
        if (!userData.password) {
            alert('Password is required for new users');
            return;
        }
    }
    
    const url = userId ? `/api/local/users/${userId}` : '/api/local/users';
    const method = userId ? 'PUT' : 'POST';
    
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',  // Important: Send cookies with request
            body: JSON.stringify(userData)
        });
        
        // Check if response is HTML (authentication redirect)
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
            // Redirected to login page
            window.location.href = '/login';
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            bootstrap.Modal.getInstance(document.getElementById('userModal')).hide();
            window.location.reload();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        console.error('Save user error:', error);
        alert('Failed to save user: ' + error.message);
    }
}

async function editUser(userId) {
    editingUserId = userId;
    document.getElementById('userModalTitle').textContent = 'Edit User';
    document.getElementById('password').required = false;
    document.getElementById('passwordField').style.display = 'none';
    
    try {
        const response = await fetch(`/api/local/users/${userId}`, {
            credentials: 'same-origin'  // Add credentials
        });
        
        // Check for authentication redirect
        if (response.redirected || response.status === 401) {
            window.location.href = '/login';
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('userId').value = data.data.id;
            document.getElementById('firstName').value = data.data.first_name;
            document.getElementById('lastName').value = data.data.last_name;
            document.getElementById('email').value = data.data.email;
            document.getElementById('role').value = data.data.role;
            document.getElementById('requirePasswordChange').checked = data.data.requires_password_change;
            document.getElementById('isActive').checked = data.data.is_active;
            
            const modal = new bootstrap.Modal(document.getElementById('userModal'));
            modal.show();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        console.error('Edit user error:', error);
        alert('Error loading user: ' + error.message);
    }
}

async function unlockUser(userId) {
    if (!confirm('Are you sure you want to unlock this user?')) return;
    
    try {
        const response = await fetch(`/api/local/users/${userId}/unlock`, {
            method: 'POST',
            credentials: 'same-origin'  // Add credentials
        });
        
        const data = await response.json();
        
        if (data.success) {
            window.location.reload();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Failed to unlock user: ' + error.message);
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
    
    try {
        const response = await fetch(`/api/local/users/${userId}`, {
            method: 'DELETE',
            credentials: 'same-origin'  // Add credentials
        });
        
        const data = await response.json();
        
        if (data.success) {
            window.location.reload();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Failed to delete user: ' + error.message);
    }
}