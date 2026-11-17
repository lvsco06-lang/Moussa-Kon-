// js/main.js - SOLUTION DÉFINITIVE POUR MENU MOBILE

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initialisation du site Mali Excellence');
    
    // ===== GESTION DU MENU MOBILE SIMPLIFIÉE =====
    initMobileMenu();
    
    // ===== FONCTIONS EXISTANTES =====
    initSmoothScroll();
    initScrollAnimations();
    initScrollHeader();
    handleMissingImages();
    initNotifications();
    animateCounters();
    initDashboardMobile();
});

// ===== SOLUTION ULTIME - MENU MOBILE FONCTIONNEL =====
function initMobileMenu() {
    console.log('📱 Initialisation du menu mobile ULTIME');
    
    const navbar = document.querySelector('.navbar');
    const navLinks = document.querySelector('.nav-links');
    
    if (!navbar || !navLinks) {
        console.error('❌ Éléments de navigation non trouvés');
        return;
    }
    
    // NETTOYAGE COMPLET - Supprimer TOUS les éléments mobiles existants
    const elementsToRemove = document.querySelectorAll(
        '.menu-toggle, .mobile-menu-btn, .menu-overlay, .nav-overlay'
    );
    elementsToRemove.forEach(el => el.remove());
    
    // CRÉATION DU BOUTON MENU
    const menuToggle = document.createElement('button');
    menuToggle.className = 'menu-toggle';
    menuToggle.innerHTML = '☰';
    menuToggle.setAttribute('aria-label', 'Menu principal');
    
    // AJOUT SIMPLE AU DOM
    navbar.appendChild(menuToggle);
    
    // GESTION DIRECTE DU CLIC
    menuToggle.addEventListener('click', function() {
        const isOpen = navLinks.classList.contains('active');
        
        if (isOpen) {
            // FERMER le menu
            navLinks.classList.remove('active');
            menuToggle.innerHTML = '☰';
            document.body.style.overflow = '';
        } else {
            // OUVRIR le menu
            navLinks.classList.add('active');
            menuToggle.innerHTML = '✕';
            document.body.style.overflow = 'hidden';
        }
    });
    
    // CORRECTION CRITIQUE : Gestion des clics sur les liens
    function handleLinkClick(e) {
        console.log('✅ Lien cliqué:', this.textContent);
        
        // Fermer le menu immédiatement
        navLinks.classList.remove('active');
        menuToggle.innerHTML = '☰';
        document.body.style.overflow = '';
        
        // Pour les ancres seulement, gérer le scroll
        if (this.getAttribute('href').startsWith('#')) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                setTimeout(() => {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }, 100);
            }
        }
        // Pour les autres liens, laisser le navigateur faire son travail
    }
    
    // APPLIQUER les écouteurs d'événements
    function applyEventListeners() {
        const links = navLinks.querySelectorAll('a');
        
        links.forEach(link => {
            // Supprimer tous les anciens écouteurs
            link.replaceWith(link.cloneNode(true));
        });
        
        // Réappliquer les écouteurs sur les nouveaux éléments
        const newLinks = navLinks.querySelectorAll('a');
        newLinks.forEach(link => {
            link.addEventListener('click', handleLinkClick);
        });
    }
    
    // Gestion des dropdowns mobiles
    function setupDropdowns() {
        const dropdownToggles = document.querySelectorAll('.dropdown > a');
        
        dropdownToggles.forEach(toggle => {
            toggle.addEventListener('click', function(e) {
                if (window.innerWidth <= 768) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const dropdown = this.parentElement;
                    const isActive = dropdown.classList.contains('active');
                    
                    // Fermer tous les autres dropdowns
                    document.querySelectorAll('.dropdown').forEach(other => {
                        if (other !== dropdown) {
                            other.classList.remove('active');
                        }
                    });
                    
                    // Ouvrir/fermer ce dropdown
                    dropdown.classList.toggle('active', !isActive);
                }
            });
        });
        
        // Fermer les dropdowns en cliquant ailleurs
        document.addEventListener('click', function(e) {
            if (window.innerWidth <= 768 && !e.target.closest('.dropdown')) {
                document.querySelectorAll('.dropdown').forEach(dropdown => {
                    dropdown.classList.remove('active');
                });
            }
        });
    }
    
    // APPLIQUER tout au chargement
    applyEventListeners();
    setupDropdowns();
    
    // Gestion du redimensionnement
    window.addEventListener('resize', function() {
        if (window.innerWidth > 768) {
            // Fermer le menu en desktop
            navLinks.classList.remove('active');
            menuToggle.innerHTML = '☰';
            document.body.style.overflow = '';
            
            // Fermer tous les dropdowns
            document.querySelectorAll('.dropdown').forEach(dropdown => {
                dropdown.classList.remove('active');
            });
        }
    });
    
    console.log('✅ Menu mobile ULTIME initialisé');
}

// ===== FONCTIONS EXISTANTES =====
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            if (window.innerWidth > 768) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }
        });
    });
}

function initScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    document.querySelectorAll('.cycle-card, .section-title, .stat-card, .news-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
}

function initScrollHeader() {
    let lastScroll = 0;
    const header = document.querySelector('.header');

    if (!header) return;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll <= 0) {
            header.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
            header.style.background = 'var(--blanc)';
            return;
        }
        
        if (currentScroll > lastScroll && currentScroll > 100) {
            header.style.transform = 'translateY(-100%)';
        } else {
            header.style.transform = 'translateY(0)';
            header.style.boxShadow = '0 5px 20px rgba(0,0,0,0.15)';
            header.style.background = 'rgba(255, 255, 255, 0.95)';
            header.style.backdropFilter = 'blur(10px)';
        }
        
        if (currentScroll > 50) {
            header.style.padding = '0.5rem 0';
            const navbar = document.querySelector('.navbar');
            if (navbar) navbar.style.padding = '0.5rem 5%';
        } else {
            header.style.padding = '0';
            const navbar = document.querySelector('.navbar');
            if (navbar) navbar.style.padding = '1rem 5%';
        }
        
        lastScroll = currentScroll;
    });
}

function handleMissingImages() {
    const images = document.querySelectorAll('img');
    
    images.forEach(img => {
        img.addEventListener('error', function() {
            if (this.classList.contains('logo-img')) {
                this.style.display = 'none';
                const fallback = this.parentElement.querySelector('.logo-fallback');
                if (fallback) {
                    fallback.style.display = 'flex';
                }
            }
        });
    });
}

function initNotifications() {
    window.showNotification = function(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <span>${message}</span>
            <button onclick="this.parentElement.remove()">×</button>
        `;
        
        notification.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            background: ${type === 'success' ? 'var(--vert)' : 
                        type === 'error' ? '#f44336' : 'var(--marron)'};
            color: white;
            padding: 1rem 2rem;
            border-radius: 8px;
            z-index: 10000;
            animation: slideInRight 0.3s ease;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 1rem;
            max-width: 400px;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentElement) {
                notification.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }
        }, 5000);
    };
}

function animateCounters() {
    const counters = document.querySelectorAll('.stat-number');
    
    counters.forEach(counter => {
        const target = parseInt(counter.textContent);
        const duration = 2000;
        const step = target / (duration / 16);
        let current = 0;
        
        const updateCounter = () => {
            current += step;
            if (current < target) {
                counter.textContent = Math.floor(current) + (counter.textContent.includes('%') ? '%' : '+');
                requestAnimationFrame(updateCounter);
            } else {
                counter.textContent = counter.textContent.includes('%') ? target + '%' : target + '+';
            }
        };
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    updateCounter();
                    observer.unobserve(entry.target);
                }
            });
        });
        
        observer.observe(counter);
    });
}

function initDashboardMobile() {
    if (window.innerWidth <= 768) {
        document.querySelectorAll('.dashboard-card, .quick-action').forEach(element => {
            element.style.cursor = 'pointer';
        });
    }
}

// ===== CSS ULTRA-SIMPLIFIÉ POUR MENU MOBILE =====
const mobileMenuCSS = `
/* ===== MENU MOBILE FONCTIONNEL ===== */
.menu-toggle {
    display: none;
    background: none;
    border: none;
    font-size: 1.5rem;
    color: var(--marron);
    cursor: pointer;
    padding: 0.5rem;
    z-index: 1002;
    margin-left: auto;
}

/* SUPPRIMER L'OVERLAY COMPLÈTEMENT */
.menu-overlay, .nav-overlay {
    display: none !important;
}

@media (max-width: 768px) {
    .menu-toggle {
        display: flex !important;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
    }
    
    /* MENU MOBILE SIMPLE ET FONCTIONNEL */
    .nav-links {
        position: fixed;
        top: 0;
        left: -100%;
        width: 280px;
        height: 100vh;
        background: white;
        flex-direction: column;
        padding: 80px 1rem 2rem;
        transition: left 0.3s ease;
        z-index: 1000;
        box-shadow: 2px 0 15px rgba(0,0,0,0.1);
        overflow-y: auto;
    }
    
    .nav-links.active {
        left: 0;
    }
    
    .nav-links li {
        width: 100%;
        margin: 0;
    }
    
    /* LIENS PARFAITEMENT CLICABLES */
    .nav-links a {
        display: flex;
        align-items: center;
        padding: 1rem;
        border-bottom: 1px solid #f0f0f0;
        font-size: 1rem;
        color: #333;
        text-decoration: none;
        transition: background-color 0.2s;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
    }
    
    .nav-links a:hover,
    .nav-links a:active {
        background-color: #f8f9fa;
        color: var(--primary);
    }
    
    /* DROPDOWNS MOBILES */
    .dropdown-menu {
        display: none;
        background: #f8f9fa;
        padding-left: 1rem;
    }
    
    .dropdown.active .dropdown-menu {
        display: block;
    }
    
    .dropdown-menu a {
        padding-left: 2rem;
        font-size: 0.9rem;
        border-bottom: 1px solid #e9ecef;
    }
    
    .dropdown > a::after {
        content: '▼';
        font-size: 0.7rem;
        margin-left: auto;
        transition: transform 0.3s;
    }
    
    .dropdown.active > a::after {
        transform: rotate(180deg);
    }
    
    /* MASQUER USER-MENU EN MOBILE */
    .user-menu {
        display: none !important;
    }
    
    /* OPTIMISATION TACTILE */
    @media (hover: none) and (pointer: coarse) {
        .nav-links a {
            min-height: 44px;
            padding: 12px 16px;
        }
    }
}

/* ANIMATIONS */
@keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

@keyframes slideOutRight {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
}
`;

// INJECTER LE CSS
const style = document.createElement('style');
style.textContent = mobileMenuCSS;
document.head.appendChild(style);

console.log('🎯 CSS menu mobile injecté');