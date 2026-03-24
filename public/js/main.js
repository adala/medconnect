// public/js/main.js

// ==================== Sidebar Functions ====================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('open');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
}

// ==================== Logout Function ====================
function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        console.log('Logout initiated');
        
        fetch('/api/local/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
        })
        .then(response => {
            console.log('Logout response status:', response.status);
            return response.json();
        })
        .then(data => {
            console.log('Logout response:', data);
            // Clear any stored tokens
            localStorage.removeItem('gateway_token');
            sessionStorage.removeItem('gateway_token');
            // Force redirect to login
            window.location.href = '/login';
        })
        .catch(error => {
            console.error('Logout error:', error);
            // Force redirect even if fetch fails
            window.location.href = '/login';
        });
    }
}

// ==================== Sync Functions ====================
function forceSync() {
    fetch('/api/local/sync/force', { 
        method: 'POST',
        credentials: 'same-origin'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('Sync started successfully');
        } else {
            alert('Sync failed: ' + data.error);
        }
    })
    .catch(error => alert('Sync failed: ' + error.message));
}

// ==================== Modal Functions ====================
function showAboutModal() {
    const modalElement = document.getElementById('aboutModal');
    if (modalElement) {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }
}

function showSupportModal() {
    const modalElement = document.getElementById('supportModal');
    if (modalElement) {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }
}

// ==================== ECG Functions ====================
function deleteEcg(id) {
    if (confirm('Are you sure you want to delete this ECG record?')) {
        fetch(`/api/local/ecg/${id}`, { 
            method: 'DELETE',
            credentials: 'same-origin'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.reload();
            } else {
                alert('Error: ' + data.error);
            }
        })
        .catch(error => alert('Error: ' + error.message));
    }
}

// ==================== Event Listeners Setup ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('main.js loaded - setting up event listeners');
    
    // ========== Logout Buttons ==========
    const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
    if (sidebarLogoutBtn) {
        sidebarLogoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            handleLogout();
        });
    }
    
    const headerLogoutBtn = document.getElementById('headerLogoutBtn');
    if (headerLogoutBtn) {
        headerLogoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            handleLogout();
        });
    }
    
    // ========== Sidebar Toggle ==========
    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', function(e) {
            e.preventDefault();
            toggleSidebar();
        });
    }
    
    // ========== Quick Actions ==========
    const addPatientAction = document.getElementById('addPatientQuickAction');
    if (addPatientAction) {
        addPatientAction.addEventListener('click', function(e) {
            e.preventDefault();
            showAddPatientModal();
        });
    }
    
    const forceSyncAction = document.getElementById('forceSyncQuickAction');
    if (forceSyncAction) {
        forceSyncAction.addEventListener('click', function(e) {
            e.preventDefault();
            forceSync();
        });
    }
    
    // ========== Modal Links ==========
    const aboutLink = document.getElementById('aboutLink');
    if (aboutLink) {
        aboutLink.addEventListener('click', function(e) {
            e.preventDefault();
            showAboutModal();
        });
    }
    
    const supportLink = document.getElementById('supportLink');
    if (supportLink) {
        supportLink.addEventListener('click', function(e) {
            e.preventDefault();
            showSupportModal();
        });
    }
    
    // ========== Handle Window Resize ==========
    window.addEventListener('resize', function() {
        if (window.innerWidth > 768) {
            closeSidebar();
        }
    });
    
    console.log('Event listeners setup complete');
});

// ==================== Handlebars Helpers ====================
if (typeof Handlebars !== 'undefined') {
    Handlebars.registerHelper('firstLetter', function(string) {
        if (!string) return '';
        return string.charAt(0).toUpperCase();
    });
    
    Handlebars.registerHelper('formatTimeAgo', function(date) {
        if (!date) return 'Never';
        const seconds = Math.floor((new Date() - new Date(date)) / 1000);
        
        const intervals = {
            year: 31536000,
            month: 2592000,
            week: 604800,
            day: 86400,
            hour: 3600,
            minute: 60,
            second: 1
        };
        
        for (const [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInUnit);
            if (interval >= 1) {
                return interval + ' ' + unit + (interval === 1 ? '' : 's') + ' ago';
            }
        }
        return 'just now';
    });
    
    Handlebars.registerHelper('formatDateTime', function(date) {
        if (!date) return 'N/A';
        return new Date(date).toLocaleString();
    });
    
    Handlebars.registerHelper('capitalize', function(string) {
        if (!string) return '';
        return string.charAt(0).toUpperCase() + string.slice(1);
    });
    
    Handlebars.registerHelper('hasPermission', function(user, permission) {
        if (!user || !user.permissions) return false;
        try {
            const perms = JSON.parse(user.permissions);
            return perms.includes('*') || perms.includes(permission);
        } catch (e) {
            return false;
        }
    });
    
    Handlebars.registerHelper('eq', function(a, b) {
        return a === b;
    });
    
    Handlebars.registerHelper('range', function(start, end) {
        if (start === undefined || end === undefined) return [];
        const result = [];
        for (let i = start; i <= end; i++) {
            result.push(i);
        }
        return result;
    });
    
    Handlebars.registerHelper('add', function(a, b) {
        return a + b;
    });
    
    Handlebars.registerHelper('subtract', function(a, b) {
        return a - b;
    });
}

// Export functions for global access (if needed)
window.handleLogout = handleLogout;
window.forceSync = forceSync;
window.showAboutModal = showAboutModal;
window.showSupportModal = showSupportModal;
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;