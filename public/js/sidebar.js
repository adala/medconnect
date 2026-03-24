// public/js/sidebar.js

/**
 * Sidebar Management
 * Handles logout and other sidebar interactions
 */

class SidebarManager {
    constructor() {
        this.init();
    }

    init() {
        this.initLogout();
        this.initActiveNavigation();
    }

    initLogout() {
        const logoutBtn = document.getElementById('sidebarLogoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                
                try {
                    const response = await fetch('/logout', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (response.redirected || response.ok) {
                        window.location.href = '/login';
                    } else {
                        window.location.href = '/login';
                    }
                } catch (error) {
                    console.error('Logout error:', error);
                    window.location.href = '/login';
                }
            });
        }
    }

    initActiveNavigation() {
        // Get current path
        const currentPath = window.location.pathname;
        
        // Find and highlight active nav link
        const navLinks = document.querySelectorAll('.nav-menu .nav-link');
        navLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href && href !== '/') {
                if (currentPath.startsWith(href) && href !== '/') {
                    link.classList.add('active');
                }
            } else if (href === '/' && currentPath === '/') {
                link.classList.add('active');
            }
        });
    }
}

// Initialize sidebar manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.sidebarManager = new SidebarManager();
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SidebarManager };
}