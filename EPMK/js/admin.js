// ============================================
// ADMIN.JS - VERSION FINALE ANTI-RECHARGEMENT
// ============================================
// ============================================
// ADMIN.JS - VERSION CORRIGÉE
// ============================================

// ==========================================
// UTILITAIRES NUMÉROS DE TÉLÉPHONE (Mali)
// ==========================================
// Normalise un numéro malien vers un format propre et cohérent : +223XXXXXXXX
// Accepte : "76434874", "+223 76 43 48 74", "223-76434874", etc.
// Retourne le numéro normalisé, ou la valeur nettoyée si non reconnu.
function normalizeMaliPhone(raw) {
    if (!raw) return null;
    let n = String(raw).replace(/[^\d+]/g, ''); // garder chiffres et +
    if (!n) return null;
    if (n.startsWith('+')) {
        // déjà au format international
        return n;
    }
    if (n.startsWith('223') && n.length === 11) {
        return '+' + n;            // 223XXXXXXXX -> +223XXXXXXXX
    }
    if (n.length === 8) {
        return '+223' + n;         // XXXXXXXX -> +223XXXXXXXX
    }
    // Cas non standard : on renvoie tel quel (nettoyé), sans préfixe forcé
    return n;
}

// Vérifie qu'un numéro malien est plausible : 8 chiffres après +223,
// et commence par un préfixe mobile courant (5,6,7,9).
function isValidMaliPhone(raw) {
    const n = normalizeMaliPhone(raw);
    if (!n) return false;
    // Doit être au format +223 suivi de 8 chiffres
    const m = n.match(/^\+223(\d{8})$/);
    if (!m) return false;
    const local = m[1];
    return /^[5679]/.test(local); // préfixes mobiles maliens courants
}


// ==========================================
// SECTION 1: VARIABLES GLOBALES (AU TRÈS DÉBUT)
// ==========================================

let supabaseClient = null;
let currentPage = 'dashboard';
let isLoading = false;
let currentEditingId = null;
let isSubmittingClasse = false;
let isSubmittingMatiere = false;

// ⚠️ Déclarer allAdmissions AU DÉBUT, avant toute fonction
let allAdmissions = [];

// Cache des données
const dataCache = {
    students: null,
    teachers: null,
    classes: null,
    payments: null,
    matieres: null,
    parents: null,
    lastUpdate: {}
};

// ==========================================
// SECTION 2: FONCTIONS UTILITAIRES
// ==========================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        animation: slideIn 0.3s ease;
        z-index: 10000;
    `;
    
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function updateCounter(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value.toLocaleString('fr-FR');
    }
}

// ==========================================
// SECTION 3: FONCTIONS MODALS
// ==========================================

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        if (modalId === 'addClasseModal') {
            loadProfesseursForClasseSelect();
        }
        if (modalId === 'addTeacherModal') {
            loadMatieresForTeacherSelect();
        }
        if (modalId === 'admissionModal') {
            // Charger les classes quand on ouvre le modal d'admission
            loadClassesForAdmissionSelect();
        }
        
        setTimeout(() => {
            const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea');
            firstInput?.focus();
        }, 100);
    }
}

// Ouvre un document à imprimer dans une fenêtre ISOLÉE.
// Pourquoi : window.open('', '_blank') crée une popup same-origin que Chrome
// place dans le même processus de rendu que l'admin. window.print() étant
// synchrone, l'admin restait gelé tant que la boîte d'impression était ouverte
// — « aucun champ ne fonctionne, il faut actualiser ».
// Un Blob + 'noopener' force un contexte de navigation distinct : l'admin
// reste utilisable pendant que l'utilisateur prend son temps pour imprimer.
window.ouvrirImpression = function (html, largeur, hauteur) {
    try {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const opts = 'noopener,width=' + (largeur || 900) + ',height=' + (hauteur || 700);
        window.open(url, '_blank', opts);
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        return true;
    } catch (e) {
        console.error('Impression:', e);
        if (typeof showToast === 'function') {
            showToast("Impression impossible : " + (e.message || ''), 'error');
        }
        return false;
    }
};

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
        
        const form = modal.querySelector('form');
        if (form && !form.dataset.preserve) {
            form.reset();
        }
    }
}

// ==========================================
// SECTION 4: FONCTIONS ADMISSIONS/INSCRIPTIONS
// ==========================================

async function loadAdmissions() {
    console.log('📋 Chargement des admissions...');
    
    // Réinitialiser la variable globale
    allAdmissions = [];
    
    const tbody = document.getElementById('admissionsTableBody');
    const noMsg = document.getElementById('noAdmissionsMsg');
    const table = document.getElementById('admissionsTable');
    
    if (!tbody) {
        console.warn('⚠️ Tableau admissions non trouvé');
        return;
    }
    
    tbody.innerHTML = `
        <tr>
            <td colspan="7" style="text-align: center; padding: 40px;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #8D6E63; margin-bottom: 15px; display: block;"></i>
                Chargement des inscriptions...
            </td>
        </tr>
    `;
    if (noMsg) noMsg.style.display = 'none';
    if (table) table.style.display = 'table';
    
    try {
        const statusFilter = document.getElementById('filterStatus')?.value || 'all';
        console.log('🔍 Filtre statut:', statusFilter);
        
        let query = supabaseClient
            .from('admissions')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (statusFilter !== 'all') {
            query = query.eq('status', statusFilter);
        }
        
        const { data: admissions, error } = await query;
        
        if (error) throw error;
        
        console.log(`✅ ${admissions?.length || 0} admission(s) chargée(s)`);
        
        // Récupérer les classes séparément
        let classesMap = {};
        try {
            const { data: classes } = await supabaseClient
                .from('classes')
                .select('id, nom');
            
            if (classes) {
                classes.forEach(c => {
                    classesMap[c.id] = c.nom;
                });
            }
        } catch (e) {
            console.warn('⚠️ Erreur chargement classes:', e);
        }
        
        // Stocker dans la variable globale
        allAdmissions = (admissions || []).map(a => ({
            ...a,
            class_name: classesMap[a.class_id] || 'Classe inconnue'
        }));
        
        updateAdmissionStats(allAdmissions);
        await loadClassesForAdmissionFilter();
        renderAdmissionsTable(allAdmissions);
        
    } catch (error) {
        console.error('❌ Erreur chargement admissions:', error);
        
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: #ef4444;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 15px; display: block;"></i>
                    <strong>Erreur lors du chargement</strong><br>
                    <small style="color: #999;">${error.message}</small><br>
                    <button onclick="loadAdmissions()" class="btn btn-primary" style="margin-top: 15px;">
                        <i class="fas fa-redo"></i> Réessayer
                    </button>
                </td>
            </tr>
        `;
        
        showToast('Erreur chargement des inscriptions', 'error');
    }
}

function updateAdmissionStats(admissions) {
    const now = new Date();
    const today = now.toDateString();
    
    const pending = admissions.filter(a => a.status === 'pending').length;
    const accepted = admissions.filter(a => a.status === 'accepted').length;
    const todayAdmissions = admissions.filter(a => {
        const date = new Date(a.created_at).toDateString();
        return date === today;
    });
    const todayRevenue = todayAdmissions.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);
    
    updateCounter('totalPendingAdmissions', pending);
    updateCounter('totalAcceptedAdmissions', accepted);
    updateCounter('totalTodayAdmissions', todayAdmissions.length);
    
    const revenueEl = document.getElementById('totalRevenueAdmissions');
    if (revenueEl) {
        revenueEl.textContent = todayRevenue.toLocaleString('fr-FR') + ' FCFA';
    }
    
    const countEl = document.getElementById('admissionsCount');
    if (countEl) {
        countEl.textContent = admissions.length;
    }
}

async function loadClassesForAdmissionFilter() {
    const select = document.getElementById('filterAdmissionClass');
    if (!select) return;
    
    try {
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('id, nom')
            .order('nom');
        
        if (error) throw error;
        
        const currentValue = select.value;
        select.innerHTML = '<option value="all">Toutes les classes</option>';
        
        classes?.forEach(c => {
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.nom;
            select.appendChild(option);
        });
        
        select.value = currentValue;
        
    } catch (error) {
        console.warn('⚠️ Erreur chargement classes filtre:', error);
    }
}

function renderAdmissionsTable(admissions) {
    const tbody = document.getElementById('admissionsTableBody');
    const noMsg = document.getElementById('noAdmissionsMsg');
    const table = document.getElementById('admissionsTable');
    
    if (!tbody) return;
    
    const classFilter = document.getElementById('filterAdmissionClass')?.value || 'all';
    let filtered = admissions;
    
    if (classFilter !== 'all') {
        filtered = filtered.filter(a => a.class_id === classFilter);
    }
    
    const searchTerm = document.getElementById('searchAdmission')?.value?.toLowerCase()?.trim();
    if (searchTerm) {
        filtered = filtered.filter(a => {
            const fullName = `${a.student_last_name} ${a.student_first_name}`.toLowerCase();
            return fullName.includes(searchTerm);
        });
    }
    
    const countEl = document.getElementById('admissionsCount');
    if (countEl) {
        countEl.textContent = filtered.length;
    }
    
    if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (noMsg) noMsg.style.display = 'block';
        if (table) table.style.display = 'none';
        return;
    }
    
    if (noMsg) noMsg.style.display = 'none';
    if (table) table.style.display = 'table';
    
    tbody.innerHTML = filtered.map(a => {
        const statusConfig = {
            'pending': { class: 'badge-warning', text: 'En attente', icon: 'fa-clock' },
            'accepted': { class: 'badge-success', text: 'Acceptée', icon: 'fa-check' },
            'rejected': { class: 'badge-danger', text: 'Rejetée', icon: 'fa-times' }
        }[a.status] || { class: 'badge-secondary', text: a.status, icon: 'fa-question' };
        
        const date = new Date(a.created_at);
        const dateStr = date.toLocaleDateString('fr-FR');
        
        return `
        <tr data-admission-id="${a.id}">
            <td style="font-size: 0.9rem; color: #666;">${dateStr}</td>
            <td style="font-weight: 500;">
                ${a.student_last_name || ''} ${a.student_first_name || ''}
            </td>
            <td>
                <span class="badge badge-info" style="background: #5D4037; color: white; padding: 4px 10px; border-radius: 4px; font-size: 0.85rem;">
                    ${a.class_name || 'Non assignée'}
                </span>
            </td>
            <td>
                ${a.father_name || a.mother_name || 'Non renseigné'}
            </td>
            <td style="font-weight: 600; color: #059669;">
                ${parseFloat(a.amount || 0).toLocaleString('fr-FR')} FCFA
            </td>
            <td>
                <span class="badge ${statusConfig.class}">
                    <i class="fas ${statusConfig.icon}"></i> ${statusConfig.text}
                </span>
            </td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="viewAdmission('${a.id}')" title="Voir détails">
                    <i class="fas fa-eye"></i>
                </button>
                ${a.status === 'pending' ? `
                <button class="btn btn-sm btn-success" onclick="acceptAdmission('${a.id}')" title="Accepter">
                    <i class="fas fa-check"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="rejectAdmission('${a.id}')" title="Rejeter">
                    <i class="fas fa-times"></i>
                </button>
                ` : ''}
            </td>
        </tr>
        `;
    }).join('');
}

// ==========================================
// SECTION 5: MODAL INSCRIPTION (WIZARD)
// ==========================================

// ==========================================
// SECTION 5: MODAL INSCRIPTION (WIZARD) - CORRIGÉ
// ==========================================

// Nouvelle fonction pour réinitialiser l'interface photo


// ==========================================
// CORRECTION POUR LE MODAL D'INSCRIPTION
// ==========================================

// ==========================================
// CORRECTION CRITIQUE - ADMIN.JS
// ==========================================

// REMPLACER TOUTE LA SECTION PHOTO UPLOAD PAR CE CODE :

/**
 * Initialise l'upload de photo - Version définitive
 */
function initPhotoUpload() {
    console.log('📸 Initialisation upload photo...');
    
    const zone = document.getElementById('photoUploadZone');
    const input = document.getElementById('admPhoto');
    
    if (!zone || !input) {
        console.warn('⚠️ Éléments upload non trouvés');
        return;
    }
    
    // Nettoyer les anciens événements en clonant
    const newZone = zone.cloneNode(true);
    const newInput = input.cloneNode(true);
    
    zone.parentNode.replaceChild(newZone, zone);
    newZone.appendChild(newInput);
    
    // Références fraîches
    const freshZone = document.getElementById('photoUploadZone');
    const freshInput = document.getElementById('admPhoto');
    
    // Style
    freshZone.style.cssText = `
        border: 3px dashed #8D6E63;
        border-radius: 12px;
        padding: 40px 30px;
        text-align: center;
        cursor: pointer;
        background: linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%);
        transition: all 0.3s ease;
        position: relative;
    `;
    
    // ÉVÉNEMENT CLIC sur la zone
    freshZone.addEventListener('click', function(e) {
        // Ne pas déclencher si on clique sur le bouton supprimer
        if (e.target.closest('.remove-photo-btn')) return;
        
        console.log('🖱️ Clic zone upload');
        freshInput.click();
    });
    
    // ÉVÉNEMENT CHANGE sur l'input
    freshInput.addEventListener('change', function(e) {
        console.log('📁 Fichier sélectionné:', e.target.files);
        if (e.target.files && e.target.files[0]) {
            processPhotoFile(e.target.files[0]);
        }
    });
    
    // Drag & drop
    freshZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        freshZone.style.borderColor = '#5D4037';
        freshZone.style.background = '#f3f4f6';
    });
    
    freshZone.addEventListener('dragleave', function(e) {
        e.preventDefault();
        freshZone.style.borderColor = '#8D6E63';
        freshZone.style.background = 'linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%)';
    });
    
    freshZone.addEventListener('drop', function(e) {
        e.preventDefault();
        freshZone.style.borderColor = '#8D6E63';
        freshZone.style.background = 'linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%)';
        
        if (e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                const dt = new DataTransfer();
                dt.items.add(file);
                freshInput.files = dt.files;
                processPhotoFile(file);
            }
        }
    });
    
    console.log('✅ Upload photo prêt');
}

/**
 * Traite le fichier photo sélectionné
 */
function processPhotoFile(file) {
    console.log('🖼️ Traitement:', file.name);
    
    const zone = document.getElementById('photoUploadZone');
    let preview = document.getElementById('photoPreview');
    
    // Validation
    if (!file.type.startsWith('image/')) {
        showToast('Veuillez sélectionner une image', 'error');
        return;
    }
    
    if (file.size > 2 * 1024 * 1024) {
        showToast('Image trop volumineuse (max 2MB)', 'error');
        return;
    }
    
    // Créer le conteneur preview s'il n'existe pas
    if (!preview) {
        preview = document.createElement('div');
        preview.id = 'photoPreview';
        zone.parentNode.appendChild(preview);
    }
    
    // Lecture du fichier
    const reader = new FileReader();
    reader.onload = function(e) {
        const imageUrl = e.target.result;
        
        // Cacher la zone d'upload
        zone.style.display = 'none';
        
        // Afficher le preview
        preview.style.cssText = `
            display: block;
            background: #f0fdf4;
            border: 2px solid #10b981;
            border-radius: 12px;
            padding: 25px;
            text-align: center;
            margin-top: 15px;
            animation: fadeIn 0.4s ease;
        `;
        
        preview.innerHTML = `
            <div style="position: relative; display: inline-block;">
                <img src="${imageUrl}" style="
                    max-width: 200px;
                    max-height: 200px;
                    border-radius: 12px;
                    border: 4px solid white;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                ">
                <div style="
                    position: absolute;
                    bottom: -10px;
                    right: -10px;
                    background: #10b981;
                    color: white;
                    width: 35px;
                    height: 35px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 3px solid white;
                ">
                    <i class="fas fa-check"></i>
                </div>
            </div>
            <div style="margin-top: 15px;">
                <p style="color: #065f46; font-weight: 600; margin: 0;">
                    <i class="fas fa-check-circle"></i> Photo chargée
                </p>
                <p style="color: #6b7280; margin: 5px 0; font-size: 0.9rem;">
                    ${file.name} (${(file.size/1024).toFixed(1)} KB)
                </p>
            </div>
            <button type="button" class="remove-photo-btn" onclick="resetPhotoUpload()" style="
                margin-top: 15px;
                background: #ef4444;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 8px;
                cursor: pointer;
            ">
                <i class="fas fa-trash"></i> Changer
            </button>
        `;
    };
    
    reader.readAsDataURL(file);
}

/**
 * Réinitialise l'upload photo
 */
function resetPhotoUpload() {
    console.log('🔄 Reset photo upload');
    
    const zone = document.getElementById('photoUploadZone');
    const preview = document.getElementById('photoPreview');
    const input = document.getElementById('admPhoto');
    
    if (input) input.value = '';
    if (preview) preview.style.display = 'none';
    
    if (zone) {
        zone.style.display = 'block';
        zone.innerHTML = `
            <i class="fas fa-camera" style="font-size: 3rem; color: #8D6E63; margin-bottom: 15px; display: block;"></i>
            <p style="font-weight: 600; color: #374151; margin: 0;">Cliquez pour sélectionner une photo</p>
            <small style="color: #6b7280;">ou glissez-déposez ici (JPG, PNG max 2MB)</small>
        `;
        zone.style.cssText = `
            border: 3px dashed #8D6E63;
            border-radius: 12px;
            padding: 40px 30px;
            text-align: center;
            cursor: pointer;
            background: linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%);
        `;
    }
    
    // Réinitialiser les événements
    initPhotoUpload();
}

// ==========================================
// CORRECTION DE OPENADMISSIONMODAL
// ==========================================

async function openAdmissionModal() {
    console.log('🚀 Ouverture modal inscription...');
    setTimeout(initDateMask, 200);
    
    openModal('admissionModal');
    
    // Attendre le DOM
    await new Promise(r => setTimeout(r, 100));
    
    // Charger les classes
    await loadClassesForAdmissionSelect();
    
    // Reset wizard
    const steps = document.querySelectorAll('.wizard-step');
    const forms = document.querySelectorAll('.form-step');
    
    steps.forEach((step, i) => {
        step.classList.toggle('active', i === 0);
        step.style.cssText = i === 0 
            ? 'border-bottom: 3px solid #5D4037; color: #5D4037; font-weight: 600;' 
            : 'border-bottom: 3px solid #e5e7eb; color: #9ca3af;';
    });
    
    forms.forEach((form, i) => {
        form.style.display = i === 0 ? 'block' : 'none';
    });
    
    // Boutons
    const prevBtn = document.getElementById('prevStepBtn');
    const nextBtn = document.getElementById('nextStepBtn');
    const submitBtn = document.getElementById('submitBtn');
    
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'inline-block';
    if (submitBtn) submitBtn.style.display = 'none';
    
    // Reset formulaire
    const form = document.getElementById('admissionForm');
    if (form) form.reset();
    
    // 🔧 CRITIQUE : Supprimer l'ancien preview s'il existe
    const oldPreview = document.getElementById('photoPreview');
    if (oldPreview) oldPreview.remove();
    
    // 🔧 CRITIQUE : Recréer la zone upload proprement
    const zone = document.getElementById('photoUploadZone');
    if (zone) {
        zone.style.display = 'block';
        zone.innerHTML = `
            <i class="fas fa-camera" style="font-size: 3rem; color: #8D6E63; margin-bottom: 15px; display: block;"></i>
            <p style="font-weight: 600; color: #374151; margin: 0;">Cliquez pour sélectionner une photo</p>
            <small style="color: #6b7280;">ou glissez-déposez ici (JPG, PNG max 2MB)</small>
            <input type="file" id="admPhoto" accept="image/*" style="display: none;">
        `;
    }
    
    // Initialiser l'upload
    initPhotoUpload();
}

// ==========================================
// CORRECTION ANTI-BOUCLE INFINIE
// ==========================================

// REMPLACER la protection anti-boucle au début du fichier :

let __ADMIN_LOADED__ = false;

document.addEventListener('DOMContentLoaded', async function() {
    // Protection contre le double chargement
    if (__ADMIN_LOADED__) {
        console.log('⚠️ Admin déjà chargé - ignoré');
        return;
    }
    __ADMIN_LOADED__ = true;
    
    console.log('🚀 Démarrage Admin Panel...');
    
    try {
        await initSupabase();
        initUI();
        initNavigation();
        initFormHandlers();
        
        const savedPage = localStorage.getItem('currentPage') || 'dashboard';
        await loadPage(savedPage);
        
        // Masquer le loading
        const loading = document.getElementById('loadingScreen');
        if (loading) loading.style.display = 'none';
        
        console.log('✅ Admin Panel prêt');
        
    } catch (error) {
        console.error('❌ Erreur initialisation:', error);
        showToast('Erreur de chargement: ' + error.message, 'error');
    }
});

// ==========================================
// EXPOSITION GLOBALE OBLIGATOIRE
// ==========================================

window.initPhotoUpload = initPhotoUpload;
window.processPhotoFile = processPhotoFile;
window.resetPhotoUpload = resetPhotoUpload;
window.openAdmissionModal = openAdmissionModal;

/**
 * Réinitialise le wizard à l'étape 1
 */
function resetWizard() {
    const steps = document.querySelectorAll('.wizard-step');
    const forms = document.querySelectorAll('.form-step');
    
    steps.forEach((step, index) => {
        step.classList.remove('active', 'completed');
        step.style.cssText = '';
        const icon = step.querySelector('i');
        if (icon) {
            // Remettre l'icône originale
            const icons = ['fa-child', 'fa-users', 'fa-map-marker-alt', 'fa-file-upload', 'fa-money-check-alt'];
            icon.className = `fas ${icons[index]}`;
            icon.style.cssText = '';
        }
        
        if (index === 0) {
            step.classList.add('active');
            step.style.cssText = `
                border-bottom: 3px solid #5D4037;
                color: #5D4037;
                font-weight: 600;
                background: rgba(93, 64, 55, 0.1);
            `;
            if (icon) icon.style.color = '#5D4037';
        } else {
            step.style.cssText = `
                border-bottom: 3px solid #e5e7eb;
                color: #9ca3af;
            `;
            if (icon) icon.style.color = '#9ca3af';
        }
    });
    
    forms.forEach((form, index) => {
        form.style.display = index === 0 ? 'block' : 'none';
    });
    
    // Réinitialiser les boutons
    const prevBtn = document.getElementById('prevStepBtn');
    const nextBtn = document.getElementById('nextStepBtn');
    const submitBtn = document.getElementById('submitBtn');
    
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'inline-block';
    if (submitBtn) submitBtn.style.display = 'none';
    
    // Réinitialiser le formulaire
    const form = document.getElementById('admissionForm');
    if (form) form.reset();
}

/**
 * Etape « Documents » retiree (originaux seuls, aucun televersement) :
 * plus rien a reinitialiser. Fonction conservee vide, au cas ou un
 * appel existant ailleurs continuerait de la nommer.
 */
function resetDocumentUploads() { /* rien a faire */ }

// ==========================================
// EXPOSITION GLOBALE
// ==========================================


window.resetWizard = resetWizard;
window.resetDocumentUploads = resetDocumentUploads;



// Modifier aussi la fonction saveAdmission pour réinitialiser correctement
// Dans admin.js - Modifier la fonction saveAdmission
let __saveRunning = false;
async function saveAdmission() {
    if (__saveRunning) { console.warn('saveAdmission deja en cours'); return; }
    __saveRunning = true;
    console.log('💾 Enregistrement inscription...');

    const reqF = [
        { id: 'admLastName',       label: 'Nom',           step: 1 },
        { id: 'admFirstName',      label: 'Prénom',        step: 1 },
        { id: 'admBirthDate',      label: 'Date naiss.',   step: 1 },
        { id: 'admGender',         label: 'Sexe',          step: 1 },
        { id: 'admClass',          label: 'Classe',        step: 1 },
        { id: 'admAddress',        label: 'Adresse',       step: 3 },
        { id: 'admCity',           label: 'Ville',         step: 3 },
        { id: 'admEmergencyPhone', label: 'Tél urgence',   step: 3 },
        { id: 'admAmount',         label: 'Montant',       step: 5 },
        { id: 'admPaymentMethod',  label: 'Mode paiement', step: 5 },
    ];
    const missing = reqF.filter(r => {
        const el = document.getElementById(r.id);
        return !el || !el.value || !el.value.trim();
    });
    if (missing.length) {
        __saveRunning = false;
        showToast('Champs manquants : ' + missing.map(m => m.label).join(', '), 'error');
        updateWizardUI(missing[0].step);
        missing.forEach(m => document.getElementById(m.id)?.style.setProperty('border-color','#ef4444','important'));
        return;
    }

    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn?.disabled) { __saveRunning = false; return; }
    
    // Récupérer la photo si présente
    const photoInput = document.getElementById('admPhoto');
    const photoFile = photoInput?.files[0];
    let photoUrl = null;
    
    // Upload de la photo si présente
    if (photoFile) {
        try {
            const fileExt = photoFile.name.split('.').pop();
            const fileName = `admission_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
            
            const { data: uploadData, error: uploadError } = await supabaseClient
                .storage
                .from('admissions')
                .upload(fileName, photoFile);
            
            if (uploadError) {
                console.warn('⚠️ Erreur upload photo:', uploadError);
            } else {
                const { data: { publicUrl } } = supabaseClient
                    .storage
                    .from('admissions')
                    .getPublicUrl(fileName);
                
                photoUrl = publicUrl;
            }
        } catch (e) {
            console.warn('⚠️ Erreur upload photo:', e);
        }
    }
    
    // Documents : plus de champs a lire — l'etape ne demande que les
    // ORIGINAUX, apportes en personne. `documents` reste un objet vide,
    // pour ne pas casser une eventuelle lecture ailleurs de ce champ.
    const documents = {};
    
    const formData = {
        student_first_name: document.getElementById('admFirstName')?.value?.trim(),
        student_last_name: document.getElementById('admLastName')?.value?.trim(),
        birth_date: (() => {
            const raw = document.getElementById('admBirthDate')?.value || '';
            if (raw.includes('/')) {
                const parts = raw.split('/');
                if (parts.length === 3 && parts[2].length === 4) {
                    return parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0');
                }
            }
            return raw || null;
        })(),
        birth_place: document.getElementById('admBirthPlace')?.value?.trim(),
        gender: document.getElementById('admGender')?.value,
        nationality: document.getElementById('admNationality')?.value?.trim() || 'Malienne',
        class_id: document.getElementById('admClass')?.value,
        photo_url: photoUrl,
        // Un seul contact principal — celui qui recoit les SMS et se
        // connecte au portail. admFatherLastName porte desormais le nom
        // complet (le libelle du champ a change, l'id est conserve pour
        // ne pas casser les lectures existantes ailleurs dans le fichier).
        father_name: document.getElementById('admFatherLastName')?.value?.trim() || '',
        father_phone: normalizeMaliPhone(document.getElementById('admFatherPhone')?.value?.trim()),
        father_email: document.getElementById('admFatherEmail')?.value?.trim(),
        // Autre parent : nom seul, pour l'acte de naissance — jamais de
        // coordonnees en double a saisir ni a maintenir.
        mother_name: document.getElementById('admMotherLastName')?.value?.trim() || '',
        tutor_relation: document.getElementById('admTutorRelation')?.value?.trim() || 'parent',
        address: document.getElementById('admAddress')?.value?.trim(),
        city: document.getElementById('admCity')?.value?.trim(),
        commune: document.getElementById('admCommune')?.value?.trim(),
        emergency_phone: normalizeMaliPhone(document.getElementById('admEmergencyPhone')?.value?.trim()),
        blood_group: document.getElementById('admBloodGroup')?.value,
        allergies: document.getElementById('admAllergies')?.value?.trim(),
        diseases: document.getElementById('admDiseases')?.value?.trim(),
        doctor: document.getElementById('admDoctor')?.value?.trim(),
        previous_school: document.getElementById('admPreviousSchool')?.value?.trim(),
        documents: documents,
        amount: parseInt(document.getElementById('admAmount')?.value) || 0,
        payment_method: document.getElementById('admPaymentMethod')?.value,
        payment_ref: document.getElementById('admPaymentRef')?.value?.trim(),
        notes: document.getElementById('admNotes')?.value?.trim(),
        status: 'pending',
        created_at: new Date().toISOString()
    };
    
    // Validation
    if (!formData.student_first_name || !formData.student_last_name) {
        showToast('Veuillez saisir le nom et prénom de l\'élève', 'error');
        return;
    }
    
    if (!formData.class_id) {
        showToast('Veuillez sélectionner une classe', 'error');
        return;
    }
    
    // Désactiver le bouton et montrer le loading
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...';
    }
    
    try {
        const { data, error } = await supabaseClient
            .from('admissions')
            .insert([formData])
            .select();
        
        if (error) throw error;
        
        showToast('Inscription enregistrée avec succès !', 'success');
        closeModal('admissionModal');
        
        // Réinitialiser proprement le formulaire et la photo
        const form = document.getElementById('admissionForm');
        if (form) form.reset();
        resetPhotoUpload();
        resetDocumentUploads();
        
        // Réinitialiser le wizard à l'étape 1
        document.querySelectorAll('.wizard-step').forEach((s, i) => {
            s.classList.toggle('active', i === 0);
        });
        document.querySelectorAll('.form-step').forEach((f, i) => {
            f.style.display = i === 0 ? 'block' : 'none';
        });
        
        const prevBtn = document.getElementById('prevStepBtn');
        const nextBtn = document.getElementById('nextStepBtn');
        
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'inline-block';
        if (submitBtn) submitBtn.style.display = 'none';
        
        if (currentPage === 'admissions') {
            await loadAdmissions();
        }
        
    } catch (error) {
        console.error('❌ Erreur inscription:', error);
        showToast('Erreur: ' + error.message, 'error');
    } finally {
        __saveRunning = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check"></i> Valider l\'inscription';
        }
    }
}

async function loadClassesForAdmissionSelect() {
    console.log('📚 Chargement des classes pour inscription...');
    
    try {
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('id, nom, frais_inscription, frais_scolarite')
            .order('nom');
        
        if (error) throw error;
        
        const select = document.getElementById('admClass');
        if (!select) {
            console.warn('⚠️ Select admClass non trouvé');
            return;
        }
        
        select.innerHTML = '<option value="">Choisir une classe...</option>';
        
        if (!classes || classes.length === 0) {
            console.warn('⚠️ Aucune classe trouvée');
            return;
        }
        
        console.log(`✅ ${classes.length} classe(s) chargée(s)`);
        
        classes.forEach(c => {
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.nom;
            option.dataset.fraisInscription = c.frais_inscription || 0;
            option.dataset.fraisScolarite = c.frais_scolarite || 0;
            select.appendChild(option);
        });
        
        // Ajouter l'écouteur pour mettre à jour les frais
        select.addEventListener('change', updateAdmissionFees);
        
    } catch (error) {
        console.error('❌ Erreur chargement classes:', error);
        showToast('Erreur chargement des classes', 'error');
    }
}
// Nouvelle fonction pour mettre à jour visuellement les étapes
function updateWizardUI(currentStep) {
    const steps = document.querySelectorAll('.wizard-step');
    const forms = document.querySelectorAll('.form-step');
    
    steps.forEach((step, index) => {
        const stepNum = index + 1;
        const icon = step.querySelector('i');
        
        // Réinitialiser les classes
        step.classList.remove('active', 'completed');
        step.style.cssText = '';
        icon.style.cssText = '';
        
        if (stepNum < currentStep) {
            // Étape complétée
            step.classList.add('completed');
            step.style.cssText = `
                border-bottom: 3px solid #10b981;
                color: #10b981;
                font-weight: 600;
            `;
            icon.className = 'fas fa-check-circle';
            icon.style.color = '#10b981';
        } else if (stepNum === currentStep) {
            // Étape active
            step.classList.add('active');
            step.style.cssText = `
                border-bottom: 3px solid #5D4037;
                color: #5D4037;
                font-weight: 600;
                background: rgba(93, 64, 55, 0.1);
            `;
            icon.style.color = '#5D4037';
        } else {
            // Étape future
            step.style.cssText = `
                border-bottom: 3px solid #e5e7eb;
                color: #9ca3af;
            `;
            icon.style.color = '#9ca3af';
        }
    });
    
    forms.forEach((form, index) => {
        form.style.display = (index + 1) === currentStep ? 'block' : 'none';
    });
    
    // Mettre à jour les boutons
    const prevBtn = document.getElementById('prevStepBtn');
    const nextBtn = document.getElementById('nextStepBtn');
    const submitBtn = document.getElementById('submitBtn');
    
    if (prevBtn) prevBtn.style.display = currentStep === 1 ? 'none' : 'inline-block';
    if (nextBtn) nextBtn.style.display = currentStep === 5 ? 'none' : 'inline-block';
    if (submitBtn) submitBtn.style.display = currentStep === 5 ? 'inline-block' : 'none';
    
    // Animation de transition
    const activeForm = document.querySelector(`.form-step[data-step="${currentStep}"]`);
    if (activeForm) {
        activeForm.style.animation = 'slideIn 0.3s ease';
    }
}

// changeStep + validateStep — version finale
function validateStep(step) {
    const rules = {
        1: [
            { id: 'admLastName',  label: "Nom de l\'élève"     },
            { id: 'admFirstName', label: "Prénom de l\'élève"  },
            { id: 'admBirthDate', label: 'Date de naissance'    },
            { id: 'admGender',    label: 'Sexe'                 },
            { id: 'admClass',     label: 'Classe demandée'      },
        ],
        2: [],
        3: [
            { id: 'admAddress',        label: 'Adresse'             },
            { id: 'admCity',           label: 'Ville'               },
            { id: 'admEmergencyPhone', label: "Téléphone d\'urgence"},
        ],
        4: [],
        5: [
            { id: 'admAmount',        label: 'Montant'             },
            { id: 'admPaymentMethod', label: 'Méthode de paiement' },
        ],
    };

    const missing = [];
    (rules[step] || []).forEach(({ id, label }) => {
        const field = document.getElementById(id);
        if (!field) return;
        const empty = !field.value || !field.value.trim();
        field.style.setProperty('border-color', empty ? '#ef4444' : '#8D6E63', 'important');
        if (empty) missing.push(label);
    });

    if (missing.length > 0) {
        showToast('Champs obligatoires : ' + missing.join(', '), 'error');
        return false;
    }

    // Valider que la date saisie est réelle
    if (step === 1) {
        const dateVal = document.getElementById('admBirthDate')?.value || '';
        if (dateVal.includes('/')) {
            const parts = dateVal.split('/');
            if (parts.length === 3) {
                const d = parseInt(parts[0]), m = parseInt(parts[1]), y = parseInt(parts[2]);
                const dateObj = new Date(y, m - 1, d);
                const isReal = dateObj.getFullYear() === y &&
                               dateObj.getMonth() === m - 1 &&
                               dateObj.getDate() === d;
                if (!isReal) {
                    const field = document.getElementById('admBirthDate');
                    field?.style.setProperty('border-color', '#ef4444', 'important');
                    showToast('Date de naissance invalide : le ' + dateVal + ' n\'existe pas dans le calendrier', 'error');
                    return false;
                }
            }
        }
    }

    if (step === 2) {
        // Un seul contact desormais : nom et telephone obligatoires,
        // puisque c'est lui qui recevra les identifiants du portail.
        const nom = document.getElementById('admFatherLastName')?.value?.trim();
        const tel = document.getElementById('admFatherPhone')?.value?.trim();
        if (!nom || !tel) {
            showToast('Le nom et le téléphone du contact principal sont requis', 'error');
            document.getElementById('admFatherPhone')?.style.setProperty('border-color','#ef4444','important');
            return false;
        }
    }
    return true;
}

function changeStep(direction) {
    const steps = document.querySelectorAll('.wizard-step');
    let currentStep = 1;
    steps.forEach((step, index) => {
        if (step.classList.contains('active')) currentStep = index + 1;
    });
    const newStep = currentStep + direction;
    if (newStep < 1 || newStep > 5) return;
    if (direction > 0 && !validateStep(currentStep)) return;
    updateWizardUI(newStep);
    if (newStep === 5) updateAdmissionSummary();
}
function updateAdmissionFees() {
    const select = document.getElementById('admClass');
    const selectedOption = select?.selectedOptions[0];
    
    if (!selectedOption || !selectedOption.value) {
        const feesInfo = document.getElementById('admFeesInfo');
        if (feesInfo) feesInfo.style.display = 'none';
        return;
    }
    
    const fraisInscription = selectedOption.dataset.fraisInscription || 0;
    const fraisScolarite = selectedOption.dataset.fraisScolarite || 0;
    
    const feesInfo = document.getElementById('admFeesInfo');
    if (feesInfo) {
        feesInfo.style.display = 'block';
        const feeInscEl = document.getElementById('admFeeInscription');
        const feeScolEl = document.getElementById('admFeeScolarite');
        if (feeInscEl) feeInscEl.textContent = parseInt(fraisInscription).toLocaleString('fr-FR') + ' FCFA';
        if (feeScolEl) feeScolEl.textContent = parseInt(fraisScolarite).toLocaleString('fr-FR') + ' FCFA';
    }
    
    const amountInput = document.getElementById('admAmount');
    if (amountInput && !amountInput.value) {
        amountInput.value = fraisInscription;
    }
}



function updateAdmissionSummary() {
    const summary = document.getElementById('admissionSummary');
    if (!summary) return;
    
    const nom = document.getElementById('admLastName')?.value || '';
    const prenom = document.getElementById('admFirstName')?.value || '';
    const classeSelect = document.getElementById('admClass');
    const classe = classeSelect?.selectedOptions[0]?.text || 'Non sélectionnée';
    const montant = document.getElementById('admAmount')?.value || 0;
    
    summary.innerHTML = `
        <strong>Élève:</strong> ${nom} ${prenom}<br>
        <strong>Classe:</strong> ${classe}<br>
        <strong>Montant payé:</strong> ${parseInt(montant).toLocaleString('fr-FR')} FCFA
    `;
}


// Dans la section EXPOSITION GLOBALE
window.openAdmissionModal = openAdmissionModal;
window.initPhotoUpload = initPhotoUpload;

// ==========================================
// SECTION 6: EXPOSITION GLOBALE (À LA FIN)
// ==========================================

window.loadAdmissions = loadAdmissions;
window.openAdmissionModal = openAdmissionModal;
window.updateAdmissionFees = updateAdmissionFees;
window.changeStep = changeStep;
window.saveAdmission = saveAdmission;
// NB : filterAdmissions, viewAdmission, acceptAdmission, rejectAdmission et
// refreshAdmissions sont définies plus bas (vraies implémentations).
// Les ébauches qui se trouvaient ici étaient du code mort : elles étaient
// systématiquement écrasées, mais brouillaient la lecture.

console.log('✅ Admin.js chargé - allAdmissions:', allAdmissions);
// ==========================================
// PROTECTION ANTI-BOUCLE ULTIME - CORRIGÉE
// ==========================================

(function() {
    'use strict';
    
    // Ne pas bloquer les rechargements volontaires de la même origine
    if (window.__ADMIN_INITIALIZED__) {
        console.log('⚠️ Admin déjà initialisé - Annulation');
        return;
    }
    
    window.__ADMIN_INITIALIZED__ = true;
    
    console.log('✅ Admin.js V2 - Initialisation sécurisée');
})();


// ============================================
// INITIALISATION UNIQUE
// ============================================

// [2e DOMContentLoaded supprimé — initFormHandlers appelé une seule fois]

// ============================================
// INITIALISATION SUPABASE
// ============================================

async function initSupabase() {
    // Attendre Supabase
    let attempts = 0;
    while (typeof supabase === 'undefined' && attempts < 50) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
    }
    
    if (typeof supabase === 'undefined') {
        throw new Error('Supabase non chargé - vérifiez le script');
    }
    
    // Créer client une seule fois
    if (!window.supabaseClient) {
        const supabaseUrl = 'https://phbfwmwqiisqidscpzeh.supabase.co';
        const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoYmZ3bXdxaWlzcWlkc2NwemVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTE0MTcsImV4cCI6MjA4Nzk4NzQxN30.UPGusoIjj5e_crNG_Dv_i9Sd2rbjLA_Hg0trfzBWq0Y';
        
        window.supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
        console.log('✅ Supabase connecté');
    }
    
    supabaseClient = window.supabaseClient;
    
    // Vérifier l'authentification
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        console.warn('⚠️ Pas de session - redirection login');
        window.__ALLOW_RELOAD__ = true; // Autoriser ce rechargement
        window.location.href = 'login.html';
        return;
    }
    
    return supabaseClient;
}

// ============================================
// INTERFACE UTILISATEUR
// ============================================

function initUI() {
    // Sidebar toggle
    const toggle = document.getElementById('toggleSidebar');
    const sidebar = document.getElementById('sidebar');
    
    toggle?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sidebar?.classList.toggle('active');
    });
    
    // Fermer sidebar mobile en cliquant à l'extérieur
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 1024 && sidebar?.classList.contains('active')) {
            if (!sidebar.contains(e.target) && !toggle?.contains(e.target)) {
                sidebar.classList.remove('active');
            }
        }
    });
    
    // Le bouton de thème sombre a été retiré : ses 24 règles CSS ciblaient des
    // styles inline (background: white…) qui ont disparu lors de la refonte.
    // Il basculait une classe ne correspondant plus à rien. Un vrai mode sombre
    // demanderait une seconde palette complète dans admin-epmk.css.
    
    // Date actuelle
    const dateEl = document.getElementById('currentDate');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('fr-FR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
    
    // Masquer loading screen
    setTimeout(() => {
        const loading = document.getElementById('loadingScreen');
        if (loading) loading.style.display = 'none';
    }, 500);
}

// ============================================
// NAVIGATION - SANS RECHARGEMENT
// ============================================

function initNavigation() {
    // Navigation items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const pageId = item.dataset.page;
            if (pageId && pageId !== currentPage) {
                await loadPage(pageId);
            }
        });
    });
    
    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            try {
                const { data: { user } } = await supabaseClient.auth.getUser();
                if (user) await supabaseClient.from('journal_connexions').insert([{ user_id: user.id, email: user.email, role: 'admin', action: 'deconnexion', user_agent: navigator.userAgent }]);
            } catch (_) {}
            await supabaseClient?.auth?.signOut();
            window.__ALLOW_RELOAD__ = true;
            window.location.href = 'login.html';
        } catch (err) {
            showToast('Erreur déconnexion', 'error');
        }
    });
    
    // Refresh button
    document.getElementById('refreshBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        // Recharger les données sans recharger la page
        loadPageData(currentPage, true);
    });
    
    // Quick add button
    document.getElementById('quickAddBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        openModal('quickAddModal');
    });
    
    // Fermer modals avec le bouton X
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const modal = btn.closest('.modal');
            if (modal) {
                modal.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
    });
    
    // Fermer modals en cliquant à l'extérieur
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
    });
}

// ============================================
// GESTION DES PAGES - NAVIGATION SPA
// ============================================

async function loadPage(pageId) {
    if (isLoading) return;
    isLoading = true;
    
    console.log('📄 Navigation vers:', pageId);
    
    try {
        // Masquer toutes les pages
        document.querySelectorAll('.page').forEach(page => {
            page.style.display = 'none';
            page.classList.remove('active');
        });
        
        // Désactiver tous les nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Afficher la page demandée
        const targetPage = document.getElementById(pageId + 'Page') || document.getElementById(pageId);
        if (!targetPage) {
            console.warn('Page non trouvée:', pageId);
            showToast('Page en construction', 'info');
            isLoading = false;
            return;
        }
        
        targetPage.style.display = 'block';
        setTimeout(() => targetPage.classList.add('active'), 10);
        
        // Activer nav item
        document.querySelector(`.nav-item[data-page="${pageId}"]`)?.classList.add('active');
        
        // Sauvegarder la page courante
        currentPage = pageId;
        localStorage.setItem('currentPage', pageId);
        
        // ⚠️ FORCER le rechargement des données à chaque navigation
        await loadPageData(pageId, true); // true = force refresh
        
        // Fermer sidebar mobile
        if (window.innerWidth <= 1024) {
            document.getElementById('sidebar')?.classList.remove('active');
        }
        
    } catch (error) {
        console.error('Erreur navigation:', error);
        showToast('Erreur de navigation', 'error');
    } finally {
        isLoading = false;
    }
}

// ============================================
// CHARGEMENT DES DONNÉES PAR PAGE
// ============================================

async function loadPageData(pageId, forceRefresh = false) {
    console.log('📊 Chargement données:', pageId, forceRefresh ? '(forcer)' : '');
    
    const forceRefreshPages = ['classes', 'matieres', 'eleves', 'parents', 'enseignants', 'notes'];
    if (forceRefreshPages.includes(pageId)) {
        forceRefresh = true;
    }
    
    const cacheKey = pageId;
    const now = Date.now();
    
    if (!forceRefresh && dataCache[cacheKey] && dataCache.lastUpdate[cacheKey]) {
        const age = now - dataCache.lastUpdate[cacheKey];
        if (age < 300000) {
            console.log('📦 Données en cache');
            return;
        }
    }
    
    try {
        switch(pageId) {
            case 'dashboard':
                await loadDashboardData();
                break;
            case 'parents':
                await loadParents(true);
                break;
            case 'eleves':
            case 'students':
                await loadEleves(true);
                chargerAlerteDossiers();
                break;
            case 'enseignants':
                await loadEnseignants(true);
                break;
            case 'finances':
                await initFinancesPage();
                break;
            case 'compositions':
                await initCompositionsPage();
                break;
            case 'cartes':
                await initCartesPage();
                break;
            case 'classes':
                await loadClasses(true);
                break;
            case 'matieres':
                await loadMatieresGlobales(true);
                break;
            case 'notes':
                await initNotesPage(); // ⚠️ Appel de la nouvelle fonction
                break;
            case 'emploi':
                await initEmploiPage();
                break;
           case 'bulletins':
    await initBulletinsPage();
    break;
            case 'presences':
                await initPresencesPage();
                break;
            case 'paiements':
                await loadPaiements();
                break;
            case 'frais':
                await loadFrais();
                break;
            case 'utilisateurs':
                await loadUtilisateurs();
                break;
            case 'parametres':
                await loadParametres();
                chargerHistoriqueSauvegardes();
                break;
            case 'admissions':
                await loadAdmissions();
                break;
            case 'messagerie':
            case 'messages':
            case 'sms':
                await initMessageriePage();
                break;
            case 'annonces':
                await loadAnnonces();
                break;
            case 'rapports':
                break;
            default:
                console.log('Page sans données dynamiques:', pageId);
        }
    } catch (error) {
        console.error(`Erreur chargement ${pageId}:`, error);
        showToast(`Erreur chargement ${pageId}`, 'error');
    }
}

function renderPageData(pageId, data) {
    // Rendu depuis le cache
    console.log('🎨 Rendu depuis cache:', pageId);
}

// ============================================
// FONCTIONS DE CHARGEMENT SPÉCIFIQUES
// ============================================

async function loadDashboardData() {
    try {
        const promises = [];
        
        // Stats avec count exact
        promises.push(
            supabaseClient.from('students').select('*', { count: 'exact', head: true }),
            supabaseClient.from('teachers').select('*', { count: 'exact', head: true }),
            supabaseClient.from('classes').select('*', { count: 'exact', head: true })
        );
        
        const [studentsRes, teachersRes, classesRes] = await Promise.all(promises);
        
        // Mettre à jour UI
        updateCounter('totalStudents', studentsRes.count || 0);
        updateCounter('totalTeachers', teachersRes.count || 0);
        updateCounter('totalClasses', classesRes.count || 0);
        
        // Paiements du mois (colonne = 'amount', pas 'montant' ; date = 'date' ou 'created_at')
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        const { data: payments } = await supabaseClient
            .from('payments')
            .select('amount, date, created_at');
        const totalMois = (payments || []).reduce((sum, p) => {
            const d = (p.date || p.created_at || '').toString().split('T')[0];
            return d >= firstDay ? sum + (parseInt(p.amount) || 0) : sum;
        }, 0);
        const totalEl = document.getElementById('totalPayments');
        if (totalEl) totalEl.textContent = totalMois.toLocaleString('fr-FR') + ' FCFA';
        
        // Charger élèves récents, présences du jour, paiements récents
        await loadRecentStudents();
        await loadTodayAttendance();
        await loadRecentPayments();
        
    } catch (error) {
        console.error('Erreur dashboard:', error);
    }
}

// Présences du jour (compteurs + barre de progression)
async function loadTodayAttendance() {
    try {
        const dateInput = document.getElementById('attendanceDate');
        const jour = (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().split('T')[0];
        const { data: pres } = await supabaseClient
            .from('presences').select('status').eq('date', jour);
        const list = pres || [];
        const present = list.filter(p => p.status === 'present').length;
        const absent = list.filter(p => p.status === 'absent').length;
        const late = list.filter(p => p.status === 'late' || p.status === 'retard').length;
        const total = list.length;
        const pct = total ? Math.round(present / total * 100) : 0;

        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('presentCount', present);
        set('absentCount', absent);
        set('lateCount', late);
        const bar = document.getElementById('attendanceProgress');
        if (bar) bar.style.width = pct + '%';
        const pctTxt = document.getElementById('attendancePercent');
        if (pctTxt) pctTxt.textContent = total ? `${pct}% de présence` : 'Aucun relevé aujourd\'hui';
    } catch (e) {
        console.error('Erreur présences du jour:', e);
    }
}

// Paiements récents (5 derniers)
async function loadRecentPayments() {
    try {
        const { data: pays } = await supabaseClient
            .from('payments')
            .select('amount, type, date, created_at, student_id')
            .order('created_at', { ascending: false })
            .limit(5);
        const tbody = document.getElementById('recentPayments');
        if (!tbody) return;
        if (!pays || !pays.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Aucun paiement récent</td></tr>';
            return;
        }
        // Noms d'élèves (sans jointure)
        const ids = [...new Set(pays.map(p => p.student_id).filter(Boolean))];
        const map = {};
        if (ids.length) {
            const { data: studs } = await supabaseClient.from('students').select('id, first_name, last_name').in('id', ids);
            (studs || []).forEach(s => map[s.id] = `${s.last_name||''} ${s.first_name||''}`.trim());
        }
        tbody.innerHTML = pays.map(p => {
            const d = (p.date || p.created_at || '').toString().split('T')[0];
            return `<tr>
                <td>${map[p.student_id] || '-'}</td>
                <td style="text-transform:capitalize;">${p.type || '-'}</td>
                <td>${(parseInt(p.amount)||0).toLocaleString('fr-FR')} FCFA</td>
                <td>${d ? new Date(d).toLocaleDateString('fr-FR') : '-'}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        console.error('Erreur paiements récents:', e);
    }
}

async function loadRecentStudents() {
    try {
        const { data: students } = await supabaseClient
            .from('students')
            .select('id, first_name, last_name, class_id, created_at, status')
            .order('created_at', { ascending: false })
            .limit(5);
        
        const tbody = document.getElementById('recentStudents');
        if (!tbody) return;
        
        if (!students || students.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Aucun élève récent</td></tr>';
            return;
        }

        // Noms de classes (sans jointure)
        const classIds = [...new Set(students.map(s => s.class_id).filter(Boolean))];
        const clsMap = {};
        if (classIds.length) {
            const { data: cls } = await supabaseClient.from('classes').select('id, nom').in('id', classIds);
            (cls || []).forEach(c => clsMap[c.id] = c.nom);
        }
        
        tbody.innerHTML = students.map(s => `
            <tr>
                <td>${s.last_name || ''} ${s.first_name || ''}</td>
                <td>${clsMap[s.class_id] || '-'}</td>
                <td>${s.created_at ? new Date(s.created_at).toLocaleDateString('fr-FR') : '-'}</td>
                <td><span class="badge badge-success">${s.status || 'Actif'}</span></td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Erreur élèves récents:', error);
    }
}


window.editEleve = async function(eleveId) {
    try {
        const { data: e, error } = await supabaseClient.from('students').select('*').eq('id', eleveId).single();
        if (error || !e) throw error || new Error('Élève introuvable');
        const { data: classes } = await supabaseClient.from('classes').select('id, nom, niveau').order('nom');
        const classOptions = (classes || []).map(c =>
            `<option value="${c.id}" ${c.id === e.class_id ? 'selected' : ''}>${c.nom}</option>`).join('');
        let modal = document.getElementById('editEleveModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'editEleveModal';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }
        modal.innerHTML = `
            <div class="modal-content" style="max-width:640px;">
                <div class="modal-header" style="background:linear-gradient(135deg,#5D4037,#6D4C41);">
                    <h3 style="color:#fff;"><i class="fas fa-user-pen"></i> Modifier l'élève</h3>
                    <button class="modal-close" onclick="closeModal('editEleveModal')" style="color:#fff;">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="editEleveId" value="${e.id}">
                    <div class="form-row">
                        <div class="form-group"><label>Nom</label><input type="text" id="editEleveLastName" class="form-control" value="${e.last_name || ''}"></div>
                        <div class="form-group"><label>Prénom</label><input type="text" id="editEleveFirstName" class="form-control" value="${e.first_name || ''}"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Matricule</label><input type="text" id="editEleveMatricule" class="form-control" value="${e.matricule || ''}"></div>
                        <div class="form-group"><label>Date de naissance</label><input type="date" id="editEleveBirthDate" class="form-control" value="${e.birth_date || ''}"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Genre</label>
                            <select id="editEleveGender" class="form-control">
                                <option value="M" ${e.gender === 'M' ? 'selected' : ''}>Masculin</option>
                                <option value="F" ${e.gender === 'F' ? 'selected' : ''}>Féminin</option>
                            </select>
                        </div>
                        <div class="form-group"><label>Classe</label>
                            <select id="editEleveClasse" class="form-control"><option value="">— Aucune —</option>${classOptions}</select>
                        </div>
                    </div>
                    <div class="form-group"><label>Statut</label>
                        <select id="editEleveStatus" class="form-control">
                            <option value="actif" ${(e.status === 'actif' || !e.status) ? 'selected' : ''}>Actif</option>
                            <option value="suspendu" ${e.status === 'suspendu' ? 'selected' : ''}>Suspendu</option>
                            <option value="sortant" ${e.status === 'sortant' ? 'selected' : ''}>Sortant</option>
                            <option value="exclu" ${e.status === 'exclu' ? 'selected' : ''}>Exclu</option>
                        </select>
                    </div>
                    <hr style="margin:14px 0;border:none;border-top:1px solid #e5e7eb;">
                    <div class="form-row">
                        <div class="form-group"><label>Nom du père</label><input type="text" id="editEleveFatherName" class="form-control" value="${e.father_name || ''}"></div>
                        <div class="form-group"><label>Tél. père</label><input type="text" id="editEleveFatherPhone" class="form-control" value="${e.father_phone || ''}"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Nom de la mère</label><input type="text" id="editEleveMotherName" class="form-control" value="${e.mother_name || ''}"></div>
                        <div class="form-group"><label>Tél. mère</label><input type="text" id="editEleveMotherPhone" class="form-control" value="${e.mother_phone || ''}"></div>
                    </div>
                </div>
                <div class="modal-footer" style="padding:14px 20px;border-top:1px solid #e5e7eb;text-align:right;">
                    <button class="btn btn-secondary" onclick="closeModal('editEleveModal')">Annuler</button>
                    <button class="btn btn-primary" style="background:#5D4037;" onclick="saveEleveEdit()"><i class="fas fa-save"></i> Enregistrer</button>
                </div>
            </div>`;
        openModal('editEleveModal');
    } catch (err) {
        console.error('❌ editEleve:', err);
        showToast('Erreur lors du chargement de l\'élève', 'error');
    }
};

window.saveEleveEdit = async function() {
    const id = document.getElementById('editEleveId')?.value;
    const val = elId => document.getElementById(elId)?.value;
    const update = {
        last_name: val('editEleveLastName')?.trim(),
        first_name: val('editEleveFirstName')?.trim(),
        matricule: val('editEleveMatricule')?.trim(),
        birth_date: val('editEleveBirthDate') || null,
        gender: val('editEleveGender'),
        class_id: val('editEleveClasse') || null,
        status: val('editEleveStatus'),
        father_name: val('editEleveFatherName')?.trim() || null,
        father_phone: normalizeMaliPhone(val('editEleveFatherPhone')?.trim()) || null,
        mother_name: val('editEleveMotherName')?.trim() || null,
        mother_phone: normalizeMaliPhone(val('editEleveMotherPhone')?.trim()) || null
    };
    try {
        const { data, error } = await supabaseClient.from('students').update(update).eq('id', id).select('id');
        if (error) throw error;
        if (!data || !data.length) {
            showToast('⚠️ Aucune ligne modifiée. Vérifiez les droits (RLS) sur la table élèves.', 'warning');
            console.warn('⚠️ Update élève: 0 ligne affectée — probable blocage RLS');
            return;
        }
        showToast('Élève modifié avec succès', 'success');
        closeModal('editEleveModal');
        await loadEleves(true);
    } catch (err) {
        console.error('❌ saveEleveEdit:', err);
        showToast('Erreur : ' + (err.message || 'réessayez'), 'error');
    }
};

window.deleteEleve = async function(eleveId) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cet élève ?')) {
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('students')
            .delete()
            .eq('id', eleveId);
        
        if (error) throw error;
        
        showToast('Élève supprimé avec succès', 'success');
        await loadEleves(true);
        
    } catch (error) {
        console.error('❌ Erreur suppression:', error);
        showToast('Erreur lors de la suppression', 'error');
    }
};
// ============================================
// SECTION PARENTS - GESTION COMPLÈTE
// ============================================

let allParents = [];
let currentParentId = null;

/**
 * Charge la liste des parents - VERSION FINALE CORRIGÉE
 */
async function loadParents(forceRefresh = false) {
    console.log('📚 Chargement des parents...', forceRefresh ? '(forcer)' : '');
    
    const tbody = document.getElementById('parentsTableBody');
    
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #8D6E63; margin-bottom: 15px; display: block;"></i>
                    <p>Chargement des parents...</p>
                </td>
            </tr>
        `;
    }
    
    try {
        // 1. Récupérer tous les parents
        const { data: parents, error } = await supabaseClient
            .from('parents')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        console.log(`✅ ${parents?.length || 0} parent(s) chargé(s)`);
        
        // Mettre à jour les compteurs immédiatement
        updateParentStats(parents || []);
        
        // 2. Récupérer les liaisons avec les élèves
        if (parents && parents.length > 0) {
            const parentIds = parents.map(p => p.id);
            
            const { data: links, error: linksError } = await supabaseClient
                .from('parent_students')
                .select(`
                    parent_id,
                    students:student_id (
                        id,
                        first_name,
                        last_name,
                        matricule,
                        class_id
                    )
                `)
                .in('parent_id', parentIds);
            
            if (linksError) {
                console.warn('⚠️ Erreur chargement liaisons:', linksError);
            }

            // Récupérer les noms de classes des enfants
            const allClassIds = [...new Set((links||[]).map(l => l.students?.class_id).filter(Boolean))];
            const classMap = {};
            if (allClassIds.length) {
                const { data: cls } = await supabaseClient.from('classes').select('id, nom').in('id', allClassIds);
                (cls || []).forEach(c => { classMap[c.id] = c.nom; });
            }

            // Déterminer quels parents ont un compte connectable (présents dans profiles).
            // La requête peut échouer si les politiques RLS de `profiles` empêchent
            // l'administrateur de lire les autres lignes. Sans gestion d'erreur, tous
            // les parents s'affichaient alors « Sans compte » — y compris ceux qui
            // s'étaient déjà connectés.
            const profIds = parents.map(p => p.id).filter(Boolean);
            const avecCompte = new Set();
            let profilsLus = true;
            if (profIds.length) {
                const { data: profs, error: profErr } = await supabaseClient
                    .from('profiles').select('id').in('id', profIds);
                if (profErr) {
                    profilsLus = false;
                    console.error('❌ Lecture de profiles impossible :', profErr.message,
                                  '— vérifiez les politiques RLS de la table profiles.');
                    showToast("Statut des comptes indisponible : lecture de « profiles » refusée.", 'warning', 8000);
                } else {
                    (profs || []).forEach(pr => avecCompte.add(pr.id));
                    // Aucun profil remonté alors que des parents existent : signal d'alerte.
                    if ((profs || []).length === 0 && profIds.length > 0) {
                        profilsLus = false;
                        console.warn('⚠️ Aucun profil retourné pour', profIds.length,
                                     'parent(s) — politique RLS trop restrictive ?');
                    }
                }
            }
            // La présence dans `profiles` n'est PAS la preuve d'un compte de connexion :
            // les parents créés par les anciens parcours ont un compte Auth valide mais
            // pas de ligne `profiles`. Ils apparaissaient à tort « Sans compte » alors
            // qu'ils se connectent tous les jours.
            // Une date de dernière connexion prouve l'existence du compte : on l'ajoute
            // toujours, pas seulement en cas d'échec de lecture.
            parents.forEach(p => { if (p.last_login) avecCompte.add(p.id); });
            
            // Organiser les enfants par parent
            const parentsWithChildren = parents.map(parent => {
                const parentLinks = links?.filter(l => l.parent_id === parent.id) || [];
                const children = parentLinks
                    .map(l => l.students)
                    .filter(s => s !== null)
                    .map(s => ({ ...s, class_name: classMap[s.class_id] || null }));
                
                return {
                    ...parent,
                    children: children,
                    hasAccount: avecCompte.has(parent.id)
                };
            });
            
            renderParentsTable(parentsWithChildren);
            
        } else {
            renderParentsTable([]);
        }
        
        // Mettre à jour le compteur total
        const countEl = document.getElementById('parentsCount');
        if (countEl) countEl.textContent = parents?.length || 0;
        
    } catch (error) {
        console.error('❌ Erreur chargement parents:', error);
        
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 40px; color: #ef4444;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 15px; display: block;"></i>
                        <p>Erreur: ${error.message}</p>
                        <button onclick="loadParents(true)" class="btn btn-primary" style="margin-top: 15px;">
                            <i class="fas fa-redo"></i> Réessayer
                        </button>
                    </td>
                </tr>
            `;
        }
    }
}
/**
 * Met à jour les statistiques des parents
 */
function updateParentStats(parents) {
    console.log('📊 Mise à jour stats parents:', parents);
    
    // S'assurer que parents est un tableau
    if (!parents || !Array.isArray(parents)) {
        parents = [];
    }
    
    const totalParents = parents.length;
    const actifs = parents.filter(p => p && p.status === 'actif').length;
    
    // Compter le nombre total d'enfants (via une requête séparée pour plus de précision)
    let totalEnfants = 0;
    
    // Mettre à jour les éléments HTML avec vérification d'existence
    const totalEl = document.getElementById('totalParents');
    if (totalEl) totalEl.textContent = totalParents;
    
    const actifsEl = document.getElementById('parentsActifs');
    if (actifsEl) actifsEl.textContent = actifs;
    
    // Compter les enfants de manière asynchrone
    countTotalEnfants().then(count => {
        const enfantsEl = document.getElementById('totalEnfants');
        if (enfantsEl) enfantsEl.textContent = count;
    });
    
    // Élèves inscrits sans compte parent connectable
    countElevesSansCompteParent().then(nb => {
        const sansCompteEl = document.getElementById('parentsSansCompte');
        if (sansCompteEl) sansCompteEl.textContent = nb;
    });
}

/**
 * Compte les élèves inscrits (actifs) qui n'ont pas de parent avec compte connectable
 */
async function countElevesSansCompteParent() {
    try {
        const { data: eleves } = await supabaseClient.from('students').select('id').eq('status', 'actif');
        if (!eleves || !eleves.length) return 0;
        const eleveIds = eleves.map(e => e.id);
        const { data: links } = await supabaseClient.from('parent_students').select('student_id, parent_id').in('student_id', eleveIds);
        const parentIds = [...new Set((links||[]).map(l => l.parent_id).filter(Boolean))];
        const avecCompte = new Set();
        if (parentIds.length) {
            const { data: profs } = await supabaseClient.from('profiles').select('id').in('id', parentIds);
            (profs || []).forEach(p => avecCompte.add(p.id));
        }
        const liensParEleve = {};
        (links||[]).forEach(l => { (liensParEleve[l.student_id] = liensParEleve[l.student_id] || []).push(l.parent_id); });
        return eleves.filter(e => {
            const sesParents = liensParEleve[e.id] || [];
            return !sesParents.some(pid => avecCompte.has(pid));
        }).length;
    } catch (e) {
        console.warn('⚠️ Comptage élèves sans compte parent:', e);
        return 0;
    }
}

/**
 * Compte les parents qui n'ont pas de compte connectable (absents de 'profiles')
 */
async function countParentsSansCompte(parents) {
    try {
        if (!parents || !parents.length) return 0;
        const ids = parents.map(p => p.id).filter(Boolean);
        if (!ids.length) return parents.length;
        const { data: profs } = await supabaseClient.from('profiles').select('id').in('id', ids);
        const avecCompte = new Set((profs || []).map(p => p.id));
        return parents.filter(p => !avecCompte.has(p.id)).length;
    } catch (e) {
        console.warn('⚠️ Comptage sans compte:', e);
        return 0;
    }
}

/**
 * Affiche les élèves dont le parent existe mais n'a pas de compte connectable
 */
window.showElevesSansCompteParent = async function() {
    openModal('elevesSansCompteModal');
    const host = document.getElementById('elevesSansCompteList');
    if (!host) return;
    host.innerHTML = '<div style="text-align:center;padding:30px;color:#9ca3af;"><i class="fas fa-spinner fa-spin" style="font-size:1.5rem;"></i></div>';

    try {
        // 1) Tous les élèves INSCRITS (actifs)
        const { data: eleves, error: elErr } = await supabaseClient
            .from('students').select('id, first_name, last_name, matricule, class_id, status')
            .eq('status', 'actif');
        if (elErr) throw elErr;
        if (!eleves || !eleves.length) {
            host.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:20px;">Aucun élève inscrit.</p>';
            return;
        }

        // 2) Liens parent_students pour ces élèves
        const eleveIds = eleves.map(e => e.id);
        const { data: links } = await supabaseClient
            .from('parent_students').select('student_id, parent_id').in('student_id', eleveIds);

        // 3) Parents AVEC compte (présents dans profiles)
        const parentIds = [...new Set((links||[]).map(l => l.parent_id).filter(Boolean))];
        const avecCompte = new Set();
        if (parentIds.length) {
            const { data: profs } = await supabaseClient.from('profiles').select('id').in('id', parentIds);
            (profs || []).forEach(p => avecCompte.add(p.id));
        }

        // 4) Pour chaque élève : a-t-il AU MOINS un parent AVEC compte ?
        const liensParEleve = {};
        (links||[]).forEach(l => {
            (liensParEleve[l.student_id] = liensParEleve[l.student_id] || []).push(l.parent_id);
        });
        const elevesSansCompte = eleves.filter(e => {
            const sesParents = liensParEleve[e.id] || [];
            // sans compte parent = aucun parent, OU aucun de ses parents n'a de compte
            return !sesParents.some(pid => avecCompte.has(pid));
        });

        if (!elevesSansCompte.length) {
            host.innerHTML = '<div style="text-align:center;padding:24px;color:#059669;"><i class="fas fa-check-circle" style="font-size:1.8rem;"></i><p style="margin-top:8px;">Tous les élèves inscrits ont un compte parent. 🎉</p></div>';
            return;
        }

        // 5) Noms de classes
        const classIds = [...new Set(elevesSansCompte.map(e => e.class_id).filter(Boolean))];
        const cmap = {};
        if (classIds.length) {
            const { data: cls } = await supabaseClient.from('classes').select('id, nom').in('id', classIds);
            (cls || []).forEach(c => { cmap[c.id] = c.nom; });
        }

        // 6) Affichage centré sur l'élève
        const blocs = elevesSansCompte.map(e => {
            const eleve = `${e.last_name||''} ${e.first_name||''}`.trim() || 'Élève';
            const classe = cmap[e.class_id] || '-';
            const matricule = e.matricule || '-';
            const aParentSansCompte = (liensParEleve[e.id] || []).length > 0;
            const note = aParentSansCompte
                ? 'Parent enregistré mais sans compte'
                : 'Aucun parent enregistré';
            return `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;background:#fff;">
                <div>
                    <div style="font-weight:700;color:#1f2937;"><i class="fas fa-child" style="color:#7c3aed;"></i> ${eleve} <span style="color:#9ca3af;font-weight:400;font-size:.85rem;">— ${classe}</span></div>
                    <div style="font-size:.82rem;color:#9ca3af;margin:2px 0;">Matricule : ${matricule}</div>
                    <div style="font-size:.84rem;color:#92400e;"><i class="fas fa-exclamation-triangle"></i> ${note}</div>
                </div>
                <span style="background:#fef3c7;color:#92400e;padding:4px 10px;border-radius:999px;font-size:.72rem;font-weight:600;white-space:nowrap;">Sans accès</span>
            </div>`;
        }).join('');

        host.innerHTML = `
            <div style="margin-bottom:12px;font-size:.9rem;color:#374151;font-weight:600;">${elevesSansCompte.length} élève(s) inscrit(s) sans compte parent</div>
            ${blocs}`;
    } catch (e) {
        console.error('❌ Élèves sans compte parent:', e);
        host.innerHTML = '<p style="text-align:center;color:#ef4444;padding:20px;">Erreur lors du chargement.</p>';
    }
};

/**
 * Compte le nombre total d'enfants liés
 */
async function countTotalEnfants() {
    try {
        const { count, error } = await supabaseClient
            .from('parent_students')
            .select('*', { count: 'exact', head: true });
        
        if (error) throw error;
        return count || 0;
    } catch (error) {
        console.warn('⚠️ Erreur comptage enfants:', error);
        return 0;
    }
}

/**
 * Affiche le tableau des parents - VERSION CORRIGÉE
 */
function renderParentsTable(parents) {
    console.log('🎨 Rendu tableau parents:', parents);
    
    const tbody = document.getElementById('parentsTableBody');
    const noMsg = document.getElementById('noParentsMsg');
    const countEl = document.getElementById('parentsCount');
    
    if (!tbody) {
        console.warn('⚠️ Tableau parentsTableBody non trouvé');
        return;
    }
    
    // Vérifier que parents est un tableau
    if (!parents || !Array.isArray(parents)) {
        console.warn('⚠️ Données parents invalides:', parents);
        parents = [];
    }
    
    // Mettre à jour le compteur
    if (countEl) countEl.textContent = parents.length;
    
    // Si aucun parent
    if (parents.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 60px; color: #9ca3af;">
                    <i class="fas fa-users-slash" style="font-size: 3rem; margin-bottom: 20px; display: block;"></i>
                    <p style="font-size: 1.1rem;">Aucun parent enregistré</p>
                    <p style="font-size: 0.9rem;">Cliquez sur "Nouveau Parent" pour créer un compte</p>
                </td>
            </tr>
        `;
        if (noMsg) noMsg.style.display = 'none';
        return;
    }
    
    if (noMsg) noMsg.style.display = 'none';
    
    // Construire le HTML du tableau
    let html = '';
    
    parents.forEach(parent => {
        // Vérifier que parent existe et a un id
        if (!parent || typeof parent !== 'object') {
            console.warn('⚠️ Parent invalide ignoré:', parent);
            return;
        }
        
        const parentId = parent.id || 'unknown';
        const firstName = parent.first_name || '';
        const lastName = parent.last_name || '';
        const email = parent.email || '-';
        const phone = parent.phone || '-';
        const status = parent.status || 'actif';
        const lastLogin = parent.last_login ? new Date(parent.last_login).toLocaleDateString('fr-FR') : 'Jamais';
        
        // Récupérer les enfants (peuvent être dans parent.children ou dans un format différent)
        let children = [];
        if (parent.children && Array.isArray(parent.children)) {
            children = parent.children;
        } else if (parent.parent_students && Array.isArray(parent.parent_students)) {
            children = parent.parent_students.map(ps => ps.students).filter(s => s);
        }
        
        // Générer le HTML des enfants (puces classe)
        let childrenHtml = '';
        if (children.length > 0) {
            childrenHtml = children.slice(0, 3).map(child => {
                if (!child) return '';
                const childName = `${child.last_name || ''} ${child.first_name || ''}`.trim();
                const cls = child.class_name ? `<span style="opacity:.65;font-weight:500;"> · ${child.class_name}</span>` : '';
                return `<span class="parent-chip"><i class="fas fa-child" style="font-size:.7rem;"></i> ${childName || 'Élève'}${cls}</span>`;
            }).join('');
            if (children.length > 3) {
                childrenHtml += `<span class="parent-chip" style="background:#eef2f7;color:#475569;">+${children.length - 3}</span>`;
            }
        } else {
            childrenHtml = '<span style="color:#9ca3af;font-size:.85rem;font-style:italic;">Aucun enfant lié</span>';
        }

        const initials = `${(firstName?.[0] || '')}${(lastName?.[0] || '')}`.toUpperCase() || '?';
        const accountBadge = parent.hasAccount
            ? '<span style="display:inline-flex;align-items:center;gap:5px;background:#d1fae5;color:#065f46;padding:5px 12px;border-radius:999px;font-size:.78rem;font-weight:600;"><i class="fas fa-circle-check"></i> Actif</span>'
            : '<span style="display:inline-flex;align-items:center;gap:5px;background:#fef3c7;color:#92400e;padding:5px 12px;border-radius:999px;font-size:.78rem;font-weight:600;"><i class="fas fa-circle-exclamation"></i> Sans compte</span>';

        html += `
        <tr data-parent-id="${parentId}">
            <td>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div class="parent-avatar">${initials}</div>
                    <div>
                        <div style="font-weight: 700; color: #1f2937; font-size: .95rem;">${lastName} ${firstName}</div>
                        <div style="font-size: .78rem; color: #9ca3af;">${children.length} enfant${children.length > 1 ? 's' : ''}</div>
                    </div>
                </div>
            </td>
            <td>
                <div style="font-size: .85rem; color: #374151; margin-bottom: 3px;"><i class="fas fa-envelope" style="color:#9ca3af; width:16px;"></i> ${email}</div>
                <div style="font-size: .85rem; color: #374151;"><i class="fas fa-phone" style="color:#9ca3af; width:16px;"></i> ${phone}</div>
            </td>
            <td>
                <div style="max-width: 260px; line-height: 1.8;">${childrenHtml}</div>
            </td>
            <td style="text-align:center;">${accountBadge}</td>
            <td>
                <span style="font-size: .85rem; color: ${lastLogin === 'Jamais' ? '#9ca3af' : '#374151'};">
                    ${lastLogin === 'Jamais' ? '<i class="fas fa-minus" style="color:#d1d5db;"></i> Jamais' : '<i class="fas fa-clock" style="color:#9ca3af;"></i> ' + lastLogin}
                </span>
            </td>
            <td style="text-align: right;">
                <button class="parent-action-btn view" onclick="viewParent('${parentId}')" title="Voir détails"><i class="fas fa-eye"></i></button>
                <button class="parent-action-btn edit" onclick="editParent('${parentId}')" title="Modifier"><i class="fas fa-pen"></i></button>
                <button class="parent-action-btn key" onclick="resetParentPasswordSms('${parentId}')" title="Réinitialiser le mot de passe et l'envoyer par SMS"><i class="fas fa-key"></i></button>
                <button class="parent-action-btn del" onclick="deleteParent('${parentId}')" title="Supprimer"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

/**
 * Charge les classes pour le filtre des parents
 */
async function loadClassesForParentFilter() {
    const select = document.getElementById('filterParentClasse');
    if (!select) return;
    
    try {
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('id, nom')
            .order('nom');
        
        if (error) throw error;
        
        const currentValue = select.value;
        select.innerHTML = '<option value="all">Toutes les classes</option>';
        
        classes?.forEach(c => {
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.nom;
            select.appendChild(option);
        });
        
        select.value = currentValue;
        
    } catch (error) {
        console.error('❌ Erreur chargement classes:', error);
    }
}

/**
 * Filtre les parents
 */
window.filterParents = function() {
    console.log('🔍 Filtrage des parents...');
    renderParentsTable(allParents, window.parentStudentsMap || {});
};

/**
 * Rafraîchit la liste des parents
 */
window.refreshParents = async function() {
    console.log('🔄 Rafraîchissement parents...');
    await loadParents(true);
    showToast('Données actualisées', 'success');
};

/**
 * Ouvre le modal de création de compte parent
 */
window.openCreateParentModal = async function() {
    console.log('🚀 Ouverture modal création parent...');
    
    // Réinitialiser le formulaire
    const form = document.getElementById('createParentForm');
    if (form) form.reset();
    
    // Valeurs par défaut
    const passwordInput = document.getElementById('parentPassword');
    if (passwordInput) passwordInput.value = 'Parent123!';
    
    const actifCheck = document.getElementById('parentActif');
    if (actifCheck) actifCheck.checked = true;
    
    // Charger les classes
    await loadClassesForParentSelect();
    
    // Utiliser votre système de modal personnalisé au lieu de Bootstrap
    openModal('createParentModal');
};

/**
 * Charge les classes pour le select parent
 */
async function loadClassesForParentSelect() {
    const select = document.getElementById('parentClassSelect');
    if (!select) return;
    
    try {
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('id, nom')
            .order('nom');
        
        if (error) throw error;
        
        select.innerHTML = '<option value="">Choisir une classe...</option>';
        
        classes?.forEach(c => {
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.nom;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('❌ Erreur chargement classes:', error);
    }
}

/**
 * Charge les élèves d'une classe pour la sélection parent
 */
window.chargerElevesPourClasse = async function() {
    const classeId = document.getElementById('parentClassSelect')?.value;
    const select = document.getElementById('parentStudentsSelect');
    
    if (!select) return;
    
    if (!classeId) {
        select.innerHTML = '<option value="">Sélectionnez d\'abord une classe</option>';
        return;
    }
    
    try {
        const { data: students, error } = await supabaseClient
            .from('students')
            .select('id, first_name, last_name, matricule')
            .eq('class_id', classeId)
            .eq('status', 'actif')
            .order('last_name');
        
        if (error) throw error;
        
        select.innerHTML = '';
        
        if (!students || students.length === 0) {
            select.innerHTML = '<option value="">Aucun élève dans cette classe</option>';
            return;
        }
        
        // Nom de classe : deux eleves homonymes sont indiscernables sans elle.
        // Requete separee puis jointure en JS (pas de join PostgREST).
        const nomsClasses = {};
        try {
            const ids = [...new Set(students.map(s => s.class_id).filter(Boolean))];
            if (ids.length) {
                const { data: cls } = await supabaseClient
                    .from('classes').select('id, nom').in('id', ids);
                (cls || []).forEach(c => { nomsClasses[c.id] = c.nom; });
            }
        } catch (e) { console.warn('Classes (sélecteur élèves) :', e && e.message); }

        students.forEach(s => {
            const option = document.createElement('option');
            option.value = s.id;
            const classe = nomsClasses[s.class_id] || 'sans classe';
            option.textContent = `${s.last_name} ${s.first_name} — ${classe} (${s.matricule || 'sans matricule'})`;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('❌ Erreur chargement élèves:', error);
        select.innerHTML = '<option value="">Erreur de chargement</option>';
    }
};

/**
 * Crée un compte parent COMPLET (Auth + Profiles + Parents + Liaisons)
 */
// ── Constantes Supabase Edge Function SMS ─────────────────────────────────
const SUPABASE_FUNCTIONS_URL = 'https://phbfwmwqiisqidscpzeh.supabase.co/functions/v1';
const ANON_KEY_SMS = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoYmZ3bXdxaWlzcWlkc2NwemVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTE0MTcsImV4cCI6MjA4Nzk4NzQxN30.UPGusoIjj5e_crNG_Dv_i9Sd2rbjLA_Hg0trfzBWq0Y';

/**
 * Envoie un SMS de bienvenue à un parent via Twilio (Edge Function)
 */
async function sendParentSms({ parent_id, phone, firstName, lastName, email, password, action = 'send' }) {
    try {
        const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-sms-parent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ANON_KEY_SMS}`,
                'apikey': ANON_KEY_SMS,
            },
            body: JSON.stringify({ parent_id, phone, firstName, lastName, email, password, action })
        });
        const data = await resp.json();
        return data;
    } catch (err) {
        console.error('❌ Erreur appel Edge Function SMS:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Réinitialise le mot de passe d'un parent et le lui envoie par SMS (via Edge Function)
 */
window.resetParentPasswordSms = async function(parentId) {
    // Récupérer email + téléphone pour confirmation et envoi
    let email = '', phone = '', nom = '';
    try {
        const { data: p } = await supabaseClient.from('parents')
            .select('first_name, last_name, email, phone').eq('id', parentId).maybeSingle();
        if (p) { email = p.email || ''; phone = p.phone || ''; nom = `${p.last_name||''} ${p.first_name||''}`.trim(); }
    } catch(_) {}

    if (!phone) {
        showToast("Ce parent n'a pas de numéro de téléphone enregistré.", 'error');
        return;
    }

    // L'admin saisit lui-même le nouveau mot de passe
    const nouveauMdp = prompt(
        `Nouveau mot de passe pour ${nom || 'ce parent'}\n\n` +
        `Saisissez le mot de passe que vous voulez attribuer (minimum 6 caractères).\n` +
        `Il sera envoyé par SMS au ${phone} avec l'email de connexion.`
    );
    if (nouveauMdp === null) return; // annulé
    if (!nouveauMdp || nouveauMdp.trim().length < 6) {
        showToast('Le mot de passe doit contenir au moins 6 caractères.', 'error');
        return;
    }

    if (!confirm(`Confirmer ?\n\nLe parent ${nom} recevra par SMS :\nEmail : ${email}\nMot de passe : ${nouveauMdp.trim()}`)) return;

    const btn = document.querySelector(`button[onclick="resetParentPasswordSms('${parentId}')"]`);
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

    try {
        const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-sms-parent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ANON_KEY_SMS}`,
                'apikey': ANON_KEY_SMS,
            },
            body: JSON.stringify({ parent_id: parentId, email, phone, password: nouveauMdp.trim() })
        });

        if (resp.status === 404) {
            showToast('La fonction « send-sms-parent » n\'est pas déployée sur Supabase.', 'error');
            console.error('❌ Edge Function send-sms-parent introuvable (404).');
            return;
        }

        // Lire la réponse en texte brut d'abord (pour capturer tout message)
        const rawText = await resp.text();
        console.log('🔑 Reset — statut HTTP:', resp.status, '| réponse brute:', rawText);

        let data = {};
        try { data = JSON.parse(rawText); } catch { data = { error: rawText }; }

        if (!resp.ok) {
            // Erreur HTTP (400, 500...) : afficher le message exact renvoyé par la fonction
            const msg = data.error || data.message || data.msg || rawText || `Erreur ${resp.status}`;
            showToast('Échec réinitialisation : ' + msg, 'error');
            console.error('❌ Reset Edge Function — détail:', data);
            return;
        }

        if (data.success && data.sms_sent) {
            showToast(`Mot de passe défini et envoyé par SMS à ${nom || 'parent'}.`, 'success');
        } else if (data.password_reset && !data.sms_sent) {
            // Mot de passe changé mais SMS échoué : le rappeler à l'admin pour transmission manuelle
            showToast('Mot de passe défini, mais SMS échoué.', 'warning');
            alert(`SMS non envoyé (${data.error || 'erreur'}).\n\nIdentifiants de ${nom} à transmettre manuellement :\nEmail : ${email}\nMot de passe : ${nouveauMdp.trim()}`);
        } else {
            showToast('Échec : ' + (data.error || 'réessayez'), 'error');
        }
    } catch (err) {
        console.error('❌ Reset+SMS:', err);
        showToast('Erreur réseau lors de la réinitialisation (fonction déployée ?)', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig || '<i class="fas fa-key"></i>'; }
    }
};


/**
 * Crée un compte parent COMPLET (Auth + Profiles + Parents + Liaisons + SMS Twilio)
 */
/**
 * Reinitialise le mot de passe d'un ENSEIGNANT et l'envoie par SMS.
 * Reutilise l'Edge Function send-sms-parent : le nom "parent_id" y est
 * purement conventionnel — le serveur appelle en realite
 * auth.admin.updateUserById(id, { password }) sur l'identifiant fourni,
 * sans jamais consulter la table `parents`. Comme teachers.id =
 * auth.users.id (meme convention que pour les parents), on peut passer
 * l'id de l'enseignant tel quel : aucune modification serveur requise.
 */
window.resetTeacherPasswordSms = async function(teacherId) {
    let email = '', phone = '', nom = '';
    try {
        const { data: t } = await supabaseClient.from('teachers')
            .select('first_name, last_name, email, phone').eq('id', teacherId).maybeSingle();
        if (t) { email = t.email || ''; phone = t.phone || ''; nom = `${t.last_name||''} ${t.first_name||''}`.trim(); }
    } catch(_) {}

    if (!phone) {
        showToast("Cet enseignant n'a pas de numéro de téléphone enregistré.", 'error');
        return;
    }

    const nouveauMdp = prompt(
        `Nouveau mot de passe pour ${nom || 'cet enseignant'}\n\n` +
        `Saisissez le mot de passe que vous voulez attribuer (minimum 6 caractères).\n` +
        `Il sera envoyé par SMS au ${phone} avec l'email de connexion.`
    );
    if (nouveauMdp === null) return;
    if (!nouveauMdp || nouveauMdp.trim().length < 6) {
        showToast('Le mot de passe doit contenir au moins 6 caractères.', 'error');
        return;
    }

    if (!confirm(`Confirmer ?\n\n${nom} recevra par SMS :\nEmail : ${email}\nMot de passe : ${nouveauMdp.trim()}`)) return;

    const btn = document.querySelector(`button[onclick="resetTeacherPasswordSms('${teacherId}')"]`);
    const orig = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

    try {
        // "parent_id" est le nom de champ attendu par l'Edge Function —
        // conserve tel quel : c'est un identifiant Auth generique, pas
        // une reference a la table `parents`.
        const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-sms-parent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ANON_KEY_SMS}`,
                'apikey': ANON_KEY_SMS,
            },
            body: JSON.stringify({ parent_id: teacherId, email, phone, password: nouveauMdp.trim() })
        });

        if (resp.status === 404) {
            showToast('La fonction « send-sms-parent » n\'est pas déployée sur Supabase.', 'error');
            console.error('❌ Edge Function send-sms-parent introuvable (404).');
            return;
        }

        const rawText = await resp.text();
        console.log('🔑 Reset enseignant — statut HTTP:', resp.status, '| réponse brute:', rawText);

        let data = {};
        try { data = JSON.parse(rawText); } catch { data = { error: rawText }; }

        if (!resp.ok) {
            const msg = data.error || data.message || data.msg || rawText || `Erreur ${resp.status}`;
            showToast('Échec réinitialisation : ' + msg, 'error');
            console.error('❌ Reset Edge Function — détail:', data);
            return;
        }

        if (data.success && data.sms_sent) {
            showToast(`Mot de passe défini et envoyé par SMS à ${nom || 'enseignant'}.`, 'success');
        } else if (data.password_reset && !data.sms_sent) {
            showToast('Mot de passe défini, mais SMS échoué.', 'warning');
            alert(`SMS non envoyé (${data.error || 'erreur'}).\n\nIdentifiants de ${nom} à transmettre manuellement :\nEmail : ${email}\nMot de passe : ${nouveauMdp.trim()}`);
        } else {
            showToast('Échec : ' + (data.error || 'réessayez'), 'error');
        }
    } catch (err) {
        console.error('❌ Reset+SMS enseignant:', err);
        showToast('Erreur réseau lors de la réinitialisation (fonction déployée ?)', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig || '<i class="fas fa-key"></i>'; }
    }
};

window.creerCompteParent = async function(e) {
    e.preventDefault();
    console.log('💾 Création compte parent complet...');

    const submitBtn = document.getElementById('createParentBtn');
    const originalText = submitBtn?.innerHTML;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création en cours…';
    }

    try {
        // ── 1. RÉCUPÉRER LES DONNÉES ──────────────────────────────────────────
        const lastName  = document.getElementById('parentLastName')?.value?.trim();
        const firstName = document.getElementById('parentFirstName')?.value?.trim();
        const email     = document.getElementById('parentEmail')?.value?.trim();
        const phone     = document.getElementById('parentPhone')?.value?.trim();
        const address   = document.getElementById('parentAddress')?.value?.trim();
        const password  = document.getElementById('parentPassword')?.value || 'Parent123!';
        const actif     = document.getElementById('parentActif')?.checked ?? true;

        const studentSelect    = document.getElementById('parentStudentsSelect');
        const selectedStudents = Array.from(studentSelect?.selectedOptions || []).map(o => o.value);

        if (!lastName || !firstName || !email) {
            showToast('Veuillez remplir tous les champs obligatoires (Nom, Prénom, Email)', 'error');
            return;
        }
        if (!phone) {
            showToast('Le numéro de téléphone est obligatoire pour l\'envoi du SMS', 'error');
            return;
        }
        // Vérifier le numéro malien (8 chiffres, préfixe mobile)
        if (!isValidMaliPhone(phone)) {
            showToast('Numéro de téléphone invalide. Entrez 8 chiffres (ex : 76 43 48 74).', 'error');
            document.getElementById('parentPhone')?.style.setProperty('border-color', '#ef4444', 'important');
            return;
        }
        // Stocker au format propre et cohérent (+223XXXXXXXX)
        const phoneNormalise = normalizeMaliPhone(phone);
        if (selectedStudents.length === 0) {
            showToast('Veuillez sélectionner au moins un enfant', 'error');
            return;
        }

        // ── 2. CRÉER L'UTILISATEUR DANS SUPABASE AUTH ─────────────────────────
        // Note : la confirmation d'email doit être DÉSACTIVÉE dans Supabase
        // (Authentication → Providers → Email → décocher "Confirm email").
        // signUp connecte automatiquement le nouveau compte → on sauvegarde la
        // session de l'admin AVANT, et on la restaure APRÈS, pour ne pas déconnecter l'admin.
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création compte…';
        console.log('🔐 Création utilisateur Auth (signUp)...');

        let authUserId = null;

        // Sauvegarder la session admin courante
        const { data: { session: adminSession } } = await supabaseClient.auth.getSession();

        const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({
            email, password,
            options: { data: { first_name: firstName, last_name: lastName, role: 'parent' } }
        });
        if (signUpError) {
            // Restaurer la session admin même en cas d'échec
            if (adminSession) { try { await supabaseClient.auth.setSession(adminSession); } catch(_){} }
            throw signUpError;
        }
        if (!signUpData?.user?.id) {
            if (adminSession) { try { await supabaseClient.auth.setSession(adminSession); } catch(_){} }
            throw new Error('Création du compte échouée — cet email est peut-être déjà utilisé.');
        }
        authUserId = signUpData.user.id;
        console.log('✅ Compte parent créé :', authUserId);

        // Restaurer immédiatement la session de l'admin (signUp a connecté le parent)
        if (adminSession) {
            try {
                await supabaseClient.auth.setSession(adminSession);
                console.log('🔁 Session admin restaurée');
            } catch (e) {
                console.warn('⚠️ Restauration session admin:', e.message);
            }
        }

        // ── 3. CRÉER LE PROFIL ────────────────────────────────────────────────
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sauvegarde profil…';
        // UPSERT et non INSERT : un trigger Supabase (on_auth_user_created) crée
        // souvent déjà la ligne au moment du createUser(). Un INSERT heurtait
        // alors une clé dupliquée, échouait en silence, et la ligne restait
        // telle que le trigger l'avait créée — SANS le téléphone.
        const { error: profErr } = await supabaseClient.from('profiles').upsert({
            id: authUserId, first_name: firstName, last_name: lastName,
            email, phone: phoneNormalise, address, role: 'parent',
            status: actif ? 'actif' : 'inactif',
            created_at: new Date().toISOString()
        }, { onConflict: 'id' });
        if (profErr) console.warn('⚠️ Profil:', profErr.message);

        // ── 4. CRÉER L'ENTRÉE DANS LA TABLE PARENTS ───────────────────────────
        const { error: parentError } = await supabaseClient.from('parents').upsert({
            id: authUserId, first_name: firstName, last_name: lastName,
            email, phone: phoneNormalise, address,
            status: actif ? 'actif' : 'inactif',
            sms_status: 'pending',
            created_at: new Date().toISOString()
        }, { onConflict: 'id' });
        if (parentError) {
            // Cette erreur ne doit PLUS être silencieuse : c'est elle qui
            // laissait le téléphone vide sans que personne ne le sache.
            console.error('❌ Table parents:', parentError);
            showToast('Compte créé, mais la fiche parent est incomplète : ' +
                      parentError.message, 'warning', 9000);
        }

        // Contrôle : le numéro est-il réellement en base ?
        try {
            const { data: verif } = await supabaseClient
                .from('parents').select('phone').eq('id', authUserId).maybeSingle();
            if (!verif?.phone) {
                console.warn('⚠️ Téléphone absent après création — nouvel essai');
                await supabaseClient.from('parents')
                    .update({ phone: phoneNormalise }).eq('id', authUserId);
            }
        } catch (e) { console.warn('Contrôle téléphone:', e?.message); }

        // ── 5. CRÉER LES LIAISONS AVEC LES ÉLÈVES ────────────────────────────
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Liaison élèves…';
        const links = selectedStudents.map(studentId => ({
            parent_id: authUserId, student_id: studentId,
            relation: 'parent', is_primary: true,
            created_at: new Date().toISOString()
        }));
        const { error: linkError } = await supabaseClient.from('parent_students').insert(links);
        if (linkError) {
            console.error('❌ Liaisons:', linkError);
            showToast('Parent créé, mais erreur de liaison avec les élèves', 'warning');
        }

        // ── 6. ENVOYER LE SMS DE BIENVENUE VIA TWILIO ─────────────────────────
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi SMS…';
        console.log('📱 Envoi SMS de bienvenue…');

        const smsResult = await sendParentSms({
            parent_id: authUserId, phone: phoneNormalise, firstName, lastName, email, password, action: 'send'
        });

        if (smsResult.success) {
            console.log('✅ SMS envoyé — SID:', smsResult.message_sid);
            showToast(
                `✅ Compte créé & SMS envoyé à ${phone} ! (${email})`,
                'success', 8000
            );
        } else {
            console.warn('⚠️ SMS non envoyé:', smsResult.error);
            await supabaseClient.from('parents')
                .update({ sms_status: 'error', sms_error: smsResult.error })
                .eq('id', authUserId);
            showToast(
                `Compte créé ✅ mais SMS échoué ⚠️ (${smsResult.error}). Vérifiez le numéro.`,
                'warning', 10000
            );
        }

        // ── 7. FERMER & RECHARGER ─────────────────────────────────────────────
        closeModal('createParentModal');
        document.getElementById('createParentForm')?.reset();
        await loadParents(true);

    } catch (error) {
        console.error('❌ Erreur création parent:', error);
        showToast('Erreur : ' + (error.message || 'Erreur inconnue'), 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Créer le compte';
        }
    }
};

/**
 * Renvoie le SMS de bienvenue à un parent
 */
window.resendParentSms = async function(parentId) {
    const btn = document.querySelector(`[data-resend-sms="${parentId}"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

    try {
        const { data: parent } = await supabaseClient
            .from('parents').select('*').eq('id', parentId).single();
        if (!parent) throw new Error('Parent non trouvé');

        if (!parent.phone) {
            showToast('Ce parent n\'a pas de numéro de téléphone renseigné', 'error');
            return;
        }

        const smsResult = await sendParentSms({
            parent_id: parentId,
            phone: parent.phone,
            firstName: parent.first_name,
            lastName: parent.last_name,
            email: parent.email,
            password: 'Votre mot de passe (communiqué lors de la création du compte)',
            action: 'resend'
        });

        if (smsResult.success) {
            showToast(`SMS renvoyé avec succès à ${parent.phone}`, 'success');
        } else {
            showToast(`Échec envoi SMS : ${smsResult.error}`, 'error');
        }
    } catch (err) {
        showToast('Erreur : ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sms"></i>'; }
        await loadParents(true);
    }
};

/**
 * Envoie le SMS à tous les parents en statut "pending" ou "error"
 */
window.sendSmsToAllPending = async function() {
    const confirmed = confirm('Envoyer un SMS à tous les parents sans confirmation SMS ?\nCela peut prendre quelques secondes.');
    if (!confirmed) return;

    const { data: pending } = await supabaseClient
        .from('parents')
        .select('*')
        .in('sms_status', ['pending', 'error'])
        .not('phone', 'is', null);

    if (!pending?.length) {
        showToast('Aucun parent en attente de SMS', 'info');
        return;
    }

    showToast(`Envoi en cours pour ${pending.length} parent(s)…`, 'info', 5000);
    let ok = 0, fail = 0;

    for (const parent of pending) {
        const res = await sendParentSms({
            parent_id: parent.id,
            phone: parent.phone,
            firstName: parent.first_name,
            lastName: parent.last_name,
            email: parent.email,
            password: 'Votre mot de passe initial (transmis lors de la création)',
            action: 'resend'
        });
        res.success ? ok++ : fail++;
        await new Promise(r => setTimeout(r, 300));
    }

    showToast(`SMS envoyés : ${ok} réussi(s), ${fail} échoué(s)`, fail > 0 ? 'warning' : 'success', 8000);
    await loadParents(true);
};

window.parentManager = {
    generatePassword: function() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$';
        let password = '';
        for (let i = 0; i < 12; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        document.getElementById('parentPassword').value = password;
    }
};

/**
 * Affiche les détails d'un parent
 */
window.viewParent = async function(parentId) {
    console.log('👁️ Vue parent:', parentId);
    currentParentId = parentId;
    
    try {
        // Récupérer les infos du parent
        const { data: parent, error } = await supabaseClient
            .from('parents')
            .select('*')
            .eq('id', parentId)
            .single();
        
        if (error) throw error;
        
        if (!parent) {
            showToast('Parent non trouvé', 'error');
            return;
        }
        
        // Récupérer les enfants liés
        const { data: links, error: linksError } = await supabaseClient
            .from('parent_students')
            .select('student_id')
            .eq('parent_id', parentId);
        
        let children = [];
        if (!linksError && links && links.length > 0) {
            const studentIds = links.map(l => l.student_id);
            const { data: students } = await supabaseClient
                .from('students')
                .select('id, first_name, last_name, matricule, class_id')
                .in('id', studentIds);
            children = students || [];

            // Récupérer les noms de classes (au lieu d'afficher un bout d'UUID)
            const classIds = [...new Set(children.map(c => c.class_id).filter(Boolean))];
            if (classIds.length) {
                const { data: cls } = await supabaseClient.from('classes').select('id, nom').in('id', classIds);
                const cmap = {};
                (cls || []).forEach(c => { cmap[c.id] = c.nom; });
                children = children.map(c => ({ ...c, class_name: cmap[c.class_id] || null }));
            }
        }
        
        // Avatar
        const avatar = document.getElementById('parentDetailsAvatar');
        if (avatar) {
            avatar.textContent = (parent.first_name?.[0] || '') + (parent.last_name?.[0] || '');
        }
        
        document.getElementById('parentDetailsName').textContent = `${parent.last_name || ''} ${parent.first_name || ''}`;
        document.getElementById('parentDetailsEmail').textContent = parent.email || '-';
        document.getElementById('parentDetailsPhone').textContent = parent.phone || '-';
        document.getElementById('parentDetailsAddress').textContent = parent.address || '-';
        
        const statusEl = document.getElementById('parentDetailsStatus');
        if (statusEl) {
            statusEl.className = `status-badge status-${parent.status || 'actif'}`;
            statusEl.textContent = parent.status === 'actif' ? 'Actif' : 'Inactif';
        }
        
        document.getElementById('parentDetailsLastLogin').textContent = parent.last_login ? 
            new Date(parent.last_login).toLocaleString('fr-FR') : 'Jamais';
        
        document.getElementById('parentDetailsCreatedAt').textContent = parent.created_at ?
            new Date(parent.created_at).toLocaleDateString('fr-FR') : '-';
        
        document.getElementById('parentDetailsChildrenCount').textContent = children.length;
        
        // Liste des enfants
        const childrenList = document.getElementById('parentDetailsChildrenList');
        if (childrenList) {
            if (children.length === 0) {
                childrenList.innerHTML = '<p style="color: #666; text-align: center;">Aucun enfant lié</p>';
            } else {
                childrenList.innerHTML = children.map(c => `
                    <div style="background: white; padding: 12px; border-radius: 6px; border-left: 4px solid #5D4037;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong style="color: #374151;">${c.last_name} ${c.first_name}</strong>
                                <div style="font-size: 0.85rem; color: #666;">${c.matricule || 'Sans matricule'}</div>
                            </div>
                            <span class="badge badge-primary">${c.class_name || 'Classe -'}</span>
                        </div>
                    </div>
                `).join('');
            }
        }
        
        openModal('parentDetailsModal');
        
    } catch (error) {
        console.error('❌ Erreur chargement détails:', error);
        showToast('Erreur: ' + error.message, 'error');
    }
};

/**
 * Édition d'un parent
 */
window.editParent = async function(parentId) {
    console.log('✏️ Édition parent:', parentId);
    currentParentId = parentId;
    
    try {
        // Récupérer les infos du parent
        const { data: parent, error } = await supabaseClient
            .from('parents')
            .select('*')
            .eq('id', parentId)
            .single();
        
        if (error) throw error;
        
        // Remplir le formulaire
        document.getElementById('editParentId').value = parent.id;
        document.getElementById('editParentLastName').value = parent.last_name || '';
        document.getElementById('editParentFirstName').value = parent.first_name || '';
        document.getElementById('editParentEmail').value = parent.email || '';
        document.getElementById('editParentPhone').value = parent.phone || '';
        
        // Charger les classes
        await loadClassesForEditParent();
        
        // Charger tous les élèves
        await loadAllStudentsForEdit();
        
        // Sélectionner les enfants déjà liés
        setTimeout(() => selectParentChildren(parentId), 300);
        
        openModal('editParentModal');
        
    } catch (error) {
        console.error('❌ Erreur chargement parent:', error);
        showToast('Erreur: ' + error.message, 'error');
    }
};

/**
 * Charge les classes pour le modal d'édition
 */
async function loadClassesForEditParent() {
    const select = document.getElementById('editParentClassSelect');
    if (!select) return;
    
    try {
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('id, nom')
            .order('nom');
        
        if (error) throw error;
        
        select.innerHTML = '<option value="">Toutes les classes</option>';
        
        classes?.forEach(c => {
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.nom;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('❌ Erreur chargement classes:', error);
    }
}

/**
 * Charge tous les élèves pour l'édition
 */
window.loadAllStudentsForEdit = async function() {
    const select = document.getElementById('editParentStudentsSelect');
    const classFilter = document.getElementById('editParentClassSelect')?.value;
    
    if (!select) return;
    
    select.innerHTML = '<option value="">Chargement...</option>';
    
    try {
        let query = supabaseClient
            .from('students')
            .select('id, first_name, last_name, matricule, class_id')
            .eq('status', 'actif');
        
        if (classFilter) {
            query = query.eq('class_id', classFilter);
        }
        
        const { data: students, error } = await query.order('last_name');
        
        if (error) throw error;
        
        select.innerHTML = '';
        
        if (!students || students.length === 0) {
            select.innerHTML = '<option value="">Aucun élève trouvé</option>';
            return;
        }
        
        // Nom de classe : deux eleves homonymes sont indiscernables sans elle.
        // Requete separee puis jointure en JS (pas de join PostgREST).
        const nomsClasses = {};
        try {
            const ids = [...new Set(students.map(s => s.class_id).filter(Boolean))];
            if (ids.length) {
                const { data: cls } = await supabaseClient
                    .from('classes').select('id, nom').in('id', ids);
                (cls || []).forEach(c => { nomsClasses[c.id] = c.nom; });
            }
        } catch (e) { console.warn('Classes (sélecteur élèves) :', e && e.message); }

        students.forEach(s => {
            const option = document.createElement('option');
            option.value = s.id;
            const classe = nomsClasses[s.class_id] || 'sans classe';
            option.textContent = `${s.last_name} ${s.first_name} — ${classe} (${s.matricule || 'sans matricule'})`;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('❌ Erreur chargement élèves:', error);
        select.innerHTML = '<option value="">Erreur de chargement</option>';
    }
};

/**
 * Sélectionne les enfants du parent dans le select multiple
 */
async function selectParentChildren(parentId) {
    try {
        const { data: links, error } = await supabaseClient
            .from('parent_students')
            .select('student_id')
            .eq('parent_id', parentId);
        
        if (error) throw error;
        
        const select = document.getElementById('editParentStudentsSelect');
        if (!select) return;
        
        const studentIds = links.map(l => l.student_id);
        
        Array.from(select.options).forEach(option => {
            if (studentIds.includes(option.value)) {
                option.selected = true;
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur chargement liaisons:', error);
    }
}

/**
 * Met à jour un parent
 */
window.updateParent = async function(e) {
    e.preventDefault();
    console.log('💾 Mise à jour parent...');
    
    const parentId = document.getElementById('editParentId')?.value;
    if (!parentId) return;
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn?.innerHTML;
    
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mise à jour...';
    }
    
    try {
        const lastName = document.getElementById('editParentLastName')?.value?.trim();
        const firstName = document.getElementById('editParentFirstName')?.value?.trim();
        const email = document.getElementById('editParentEmail')?.value?.trim();
        const phone = document.getElementById('editParentPhone')?.value?.trim();
        
        const selectedStudents = Array.from(document.getElementById('editParentStudentsSelect')?.selectedOptions || [])
            .map(o => o.value);
        
        if (!lastName || !firstName || !email) {
            showToast('Veuillez remplir tous les champs obligatoires', 'error');
            return;
        }
        
        if (selectedStudents.length === 0) {
            showToast('Veuillez sélectionner au moins un enfant', 'error');
            return;
        }

        // Normaliser/valider le numéro s'il est renseigné
        let phoneNormalise = phone;
        if (phone) {
            if (!isValidMaliPhone(phone)) {
                showToast('Numéro de téléphone invalide. Entrez 8 chiffres (ex : 76 43 48 74).', 'error');
                document.getElementById('editParentPhone')?.style.setProperty('border-color', '#ef4444', 'important');
                return;
            }
            phoneNormalise = normalizeMaliPhone(phone);
        }
                const { error: parentError } = await supabaseClient
            .from('parents')
            .update({
                first_name: firstName,
                last_name: lastName,
                email: email,
                phone: phoneNormalise,
                updated_at: new Date().toISOString()
            })
            .eq('id', parentId);
        
        if (parentError) throw parentError;
        
        // Mettre à jour le profil
        // (non bloquant : le profil peut ne pas exister pour d'anciens comptes)
        const { error: profilErr } = await supabaseClient
            .from('profiles')
            .update({
                first_name: firstName,
                last_name: lastName,
                email: email,
                phone: phoneNormalise
            })
            .eq('id', parentId);
        if (profilErr) console.warn('⚠️ Profil non mis à jour:', profilErr.message);
        
        // Mettre à jour les liaisons
        // 1. Supprimer les anciennes
        const { error: delErr } = await supabaseClient
            .from('parent_students')
            .delete()
            .eq('parent_id', parentId);
        if (delErr) console.warn('⚠️ Suppression anciens liens:', delErr.message);
        
        // 2. Créer les nouvelles
        if (selectedStudents.length > 0) {
            const links = selectedStudents.map(studentId => ({
                parent_id: parentId,
                student_id: studentId
            }));
            
            let { data: inserted, error: linkError } = await supabaseClient
                .from('parent_students')
                .insert(links)
                .select('parent_id, student_id');
            
            if (linkError) {
                console.error('❌ Liaison enfants échouée:', linkError);
                showToast('Erreur liaison enfants : ' + linkError.message, 'error');
                throw linkError;
            }
            if (!inserted || inserted.length !== links.length) {
                console.warn('⚠️ Liens écrits:', inserted, 'attendus:', links.length);
                showToast('⚠️ Les enfants n\'ont pas tous été liés.', 'warning');
            } else {
                console.log('✅ Enfants liés:', inserted);
            }
        }
        
        showToast('Parent mis à jour avec succès', 'success');
        closeModal('editParentModal');
        await loadParents(true);
        
    } catch (error) {
        console.error('❌ Erreur mise à jour:', error);
        showToast('Erreur: ' + error.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Enregistrer';
        }
    }
};

/**
 * Supprime un parent
 */
window.deleteParent = async function(parentId) {
    console.log('🗑️ Suppression parent:', parentId);
    
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce compte parent ? Cette action est irréversible.')) {
        return;
    }
    
    try {
        // 1. Supprimer les liaisons
        await supabaseClient
            .from('parent_students')
            .delete()
            .eq('parent_id', parentId);
        
        // 2. Supprimer le parent
        await supabaseClient
            .from('parents')
            .delete()
            .eq('id', parentId);
        
        // 3. Supprimer le profil
        await supabaseClient
            .from('profiles')
            .delete()
            .eq('id', parentId)
            .then(null, console.warn); // builder Supabase : pas de .catch
        
        showToast('Parent supprimé avec succès', 'success');
        
        if (currentParentId === parentId) {
            closeModal('parentDetailsModal');
        }
        
        await loadParents(true);
        
    } catch (error) {
        console.error('❌ Erreur suppression:', error);
        showToast('Erreur lors de la suppression: ' + error.message, 'error');
    }
};

/**
 * Actions depuis le modal de détails
 */
window.editCurrentParent = function() {
    if (currentParentId) {
        closeModal('parentDetailsModal');
        editParent(currentParentId);
    }
};

window.deleteCurrentParent = async function() {
    if (currentParentId) {
        closeModal('parentDetailsModal');
        await deleteParent(currentParentId);
    }
};

window.resetParentPassword = function() {
    if (currentParentId) {
        // Rediriger vers la réinitialisation de mot de passe
        closeModal('parentDetailsModal');
        resetUserPasswordModal(currentParentId, 
            document.getElementById('parentDetailsName')?.textContent || '');
    }
};

/**
 * Affiche le SQL pour créer les tables parents
 */
window.showCreateParentsSQL = function() {
    const sql = `-- Créer la table parents
CREATE TABLE IF NOT EXISTS parents (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    address TEXT,
    status TEXT DEFAULT 'actif',
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Créer la table de liaison parent_students
CREATE TABLE IF NOT EXISTS parent_students (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    parent_id UUID REFERENCES parents(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(parent_id, student_id)
);

-- Index
CREATE INDEX idx_parents_email ON parents(email);
CREATE INDEX idx_parents_status ON parents(status);
CREATE INDEX idx_parent_students_parent ON parent_students(parent_id);
CREATE INDEX idx_parent_students_student ON parent_students(student_id);

-- RLS
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_students ENABLE ROW LEVEL SECURITY;

-- Politiques
CREATE POLICY "Parents can view own profile"
    ON parents FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Parents can update own profile"
    ON parents FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Admins full access to parents"
    ON parents FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('super_admin', 'admin')
        )
    );

CREATE POLICY "Admins full access to parent_students"
    ON parent_students FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('super_admin', 'admin')
        )
    );

-- Trigger pour updated_at
CREATE TRIGGER update_parents_updated_at
    BEFORE UPDATE ON parents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();`;
    
    alert('Exécutez ce SQL dans Supabase > SQL Editor:\n\n' + sql);
};

// ============================================
// EXPOSITION GLOBALE
// ============================================

window.loadParents = loadParents;
window.refreshParents = refreshParents;
window.openCreateParentModal = openCreateParentModal;
window.filterParents = filterParents;
window.viewParent = viewParent;
window.editParent = editParent;
window.deleteParent = deleteParent;
window.chargerElevesPourClasse = chargerElevesPourClasse;
window.creerCompteParent = creerCompteParent;
window.updateParent = updateParent;
window.loadAllStudentsForEdit = loadAllStudentsForEdit;
window.editCurrentParent = editCurrentParent;
window.deleteCurrentParent = deleteCurrentParent;
window.resetParentPassword = resetParentPassword;
window.showCreateParentsSQL = showCreateParentsSQL;
window.parentManager = parentManager;


// ── Rendu des lignes du tableau élèves (gabarit d'origine, partagé) ──
// ════════════════════════════════════════════════════════════
// CLOCHE D'ALERTES
// ------------------------------------------------------------
// Elle affichait « 3 » en dur et n'était câblée à rien. Elle agrège
// désormais les signaux réels qui demandent une action du directeur.
// ════════════════════════════════════════════════════════════

window.chargerNotifications = async function () {
    const badge = document.getElementById('notifCount');
    const liste = document.getElementById('notifListe');
    if (!badge || !liste) return;

    const alertes = [];

    // ── 1. Paiements déclarés en attente de validation ──
    try {
        const { count } = await supabaseClient
            .from('payments').select('id', { count: 'exact', head: true })
            .eq('status', 'pending');
        if (count > 0) {
            alertes.push({
                ic: 'fa-money-bill-transfer', couleur: '#B7791F',
                titre: count + ' paiement' + (count > 1 ? 's' : '') + ' à valider',
                detail: 'Des parents ont déclaré un versement mobile money.',
                action: "loadPage('paiements')"
            });
        }
    } catch (e) { console.warn('Notif paiements:', e?.message); }

    // ── 2. Dossiers incomplets au-delà du délai ──
    try {
        const { data } = await supabaseClient
            .from('students')
            .select('id, pieces_recues, date_inscription, created_at')
            .eq('status', 'actif');
        const n = (data || []).filter(function (e) {
            return _piecesComptees(e.pieces_recues) < PIECES_ATTENDUES.length
                && _joursDepuis(e.date_inscription || e.created_at) >= DELAI_PIECES_JOURS;
        }).length;
        if (n > 0) {
            alertes.push({
                ic: 'fa-folder-open', couleur: '#B23B2E',
                titre: n + ' dossier' + (n > 1 ? 's' : '') + ' incomplet' + (n > 1 ? 's' : ''),
                detail: 'Pièces originales non remises depuis plus de ' + DELAI_PIECES_JOURS + ' jours.',
                action: "loadPage('eleves')"
            });
        }
    } catch (e) { console.warn('Notif dossiers:', e?.message); }

    // ── 3. Demandes d'admission en attente ──
    try {
        const { count } = await supabaseClient
            .from('admissions').select('id', { count: 'exact', head: true })
            .eq('status', 'pending');
        if (count > 0) {
            alertes.push({
                ic: 'fa-user-plus', couleur: '#5D4037',
                titre: count + ' demande' + (count > 1 ? 's' : '') + " d'inscription",
                detail: 'En attente d\'étude par la direction.',
                action: "loadPage('admissions')"
            });
        }
    } catch (e) { console.warn('Notif admissions:', e?.message); }

    // ── Rendu ──
    if (!alertes.length) {
        badge.style.display = 'none';
        liste.innerHTML = '<div style="padding:28px 16px;text-align:center;color:#7A6A63;font-size:.86rem;">' +
            '<i class="fas fa-check-circle" style="font-size:1.6rem;color:#2E7D32;display:block;margin-bottom:8px;"></i>' +
            'Rien ne demande votre attention.</div>';
        return;
    }

    const total = alertes.reduce(function (s, a) {
        const m = a.titre.match(/^(\d+)/);
        return s + (m ? parseInt(m[1]) : 1);
    }, 0);
    badge.textContent = total > 99 ? '99+' : total;
    badge.style.display = '';

    liste.innerHTML = alertes.map(function (a) {
        return '<div onclick="' + a.action + ';fermerNotifications();" ' +
            'style="display:flex;gap:11px;padding:13px 16px;border-bottom:1px solid #F3EEEB;cursor:pointer;" ' +
            'onmouseover="this.style.background=\'#FAF8F7\'" onmouseout="this.style.background=\'\'">' +
            '<i class="fas ' + a.ic + '" style="color:' + a.couleur + ';margin-top:3px;width:17px;"></i>' +
            '<div style="flex:1;">' +
                '<div style="font-weight:600;font-size:.87rem;color:#2A211D;">' + a.titre + '</div>' +
                '<div style="font-size:.78rem;color:#7A6A63;line-height:1.4;">' + a.detail + '</div>' +
            '</div>' +
            '<i class="fas fa-chevron-right" style="color:#D7CCC8;font-size:.7rem;margin-top:5px;"></i>' +
        '</div>';
    }).join('');
};

window.fermerNotifications = function () {
    const p = document.getElementById('notifPanel');
    if (p) p.style.display = 'none';
};

// Câblage du bouton
document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('notificationBtn');
    const panel = document.getElementById('notifPanel');
    if (!btn || !panel) return;

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const ouvert = panel.style.display !== 'none';
        panel.style.display = ouvert ? 'none' : 'block';
        if (!ouvert) chargerNotifications();
    });

    // Refermer au clic extérieur
    document.addEventListener('click', function (e) {
        if (!panel.contains(e.target) && !btn.contains(e.target)) {
            panel.style.display = 'none';
        }
    });

    // Premier chargement, puis rafraîchissement toutes les 5 minutes
    setTimeout(chargerNotifications, 2500);
    setInterval(chargerNotifications, 300000);
});

// ════════════════════════════════════════════════════════════
// SUIVI DES PIÈCES JUSTIFICATIVES ORIGINALES
// ------------------------------------------------------------
// Les scans téléversés en ligne ne valent pas les originaux.
// Le secrétariat coche ici ce qu'il a RÉELLEMENT reçu.
// ════════════════════════════════════════════════════════════

// Une seule liste de reference pour toute l'application : le suivi cote
// eleve et le suivi cote admission divergeaient (4 pieces contre 5), alors
// que le site public et le reglement en annoncent cinq aux familles.
const PIECES_ATTENDUES = [
    ['extrait_naissance',  "Extrait de naissance",       'fa-file-lines',    true],
    ['photos_identite',    "Photos d'identité",          'fa-image',         true],
    ['bulletins',          "Bulletins année précédente", 'fa-file-invoice',  false],
    ['certificat_medical', "Certificat médical",         'fa-notes-medical', true],
    ['piece_parent',       "Pièce d'identité du parent", 'fa-id-card',       true]
];

// Délai laissé aux familles pour apporter les originaux
const DELAI_PIECES_JOURS = 7;

function _piecesComptees(pieces) {
    const p = pieces || {};
    return PIECES_ATTENDUES.filter(function (d) { return p[d[0]] && p[d[0]].recu === true; }).length;
}

function _joursDepuis(dateStr) {
    if (!dateStr) return 0;
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// Pastille d'état affichée dans la liste des élèves
function badgePieces(eleve) {
    const n = _piecesComptees(eleve.pieces_recues);
    const total = PIECES_ATTENDUES.length;
    const jours = _joursDepuis(eleve.date_inscription || eleve.created_at);

    if (n === total) {
        return '<span class="badge badge-success" title="Dossier complet">' +
               '<i class="fas fa-check"></i> ' + n + '/' + total + '</span>';
    }
    if (jours >= DELAI_PIECES_JOURS) {
        return '<span class="badge badge-danger" title="Dossier incomplet depuis ' + jours + ' jours">' +
               '<i class="fas fa-triangle-exclamation"></i> ' + n + '/' + total + ' · ' + jours + ' j</span>';
    }
    return '<span class="badge badge-warning" title="Dossier en cours (' + jours + ' j)">' +
           '<i class="fas fa-hourglass-half"></i> ' + n + '/' + total + '</span>';
}

// Alerte : élèves inscrits depuis plus de DELAI_PIECES_JOURS dont le
// dossier physique reste incomplet. Le vrai risque : l'élève suit les
// cours sans dossier, et personne ne s'en aperçoit avant l'examen.
window.chargerAlerteDossiers = async function () {
    const box = document.getElementById('alerteDossiers');
    if (!box) return;
    try {
        const { data, error } = await supabaseClient
            .from('students')
            .select('id, first_name, last_name, pieces_recues, date_inscription, created_at')
            .eq('status', 'actif');
        if (error) throw error;

        const enRetard = (data || []).filter(function (e) {
            return _piecesComptees(e.pieces_recues) < PIECES_ATTENDUES.length
                && _joursDepuis(e.date_inscription || e.created_at) >= DELAI_PIECES_JOURS;
        });

        if (!enRetard.length) { box.style.display = 'none'; return; }

        enRetard.sort(function (a, b) {
            return _joursDepuis(b.date_inscription || b.created_at) -
                   _joursDepuis(a.date_inscription || a.created_at);
        });

        const n = enRetard.length;
        const noms = enRetard.slice(0, 3).map(function (e) {
            return ((e.last_name || '') + ' ' + (e.first_name || '')).trim() +
                   ' (' + _joursDepuis(e.date_inscription || e.created_at) + ' j)';
        }).join(', ');

        document.getElementById('alerteDossiersTitre').textContent =
            n + ' dossier' + (n > 1 ? 's' : '') + ' incomplet' + (n > 1 ? 's' : '') +
            ' depuis plus de ' + DELAI_PIECES_JOURS + ' jours';
        document.getElementById('alerteDossiersDetail').textContent =
            noms + (n > 3 ? ' et ' + (n - 3) + ' autre' + (n - 3 > 1 ? 's' : '') : '') +
            ' — les pièces originales ne sont pas au secrétariat.';
        box.style.display = '';
        window._dossiersEnRetard = enRetard.map(function (e) { return e.id; });
    } catch (e) {
        console.warn('Alerte dossiers:', e?.message);
        box.style.display = 'none';
    }
};

// Filtre la liste sur les seuls dossiers en retard
window.filtrerDossiersIncomplets = function () {
    const ids = window._dossiersEnRetard || [];
    if (!ids.length) return;
    document.querySelectorAll('#elevesTableBody tr').forEach(function (tr) {
        const btn = tr.querySelector('[onclick*="gererPieces"]');
        if (!btn) { tr.style.display = 'none'; return; }
        const m = btn.getAttribute('onclick').match(/gererPieces\('([^']+)'\)/);
        tr.style.display = (m && ids.indexOf(m[1]) !== -1) ? '' : 'none';
    });
    showToast(ids.length + ' élève(s) en attente de pièces', 'warning');
};

// Modal de saisie : le secrétariat coche ce qu'il a reçu
window.gererPieces = async function (eleveId) {
    try {
        const { data: e, error } = await supabaseClient
            .from('students')
            .select('id, first_name, last_name, matricule, pieces_recues, pieces_notes, date_inscription, created_at')
            .eq('id', eleveId).single();
        if (error || !e) throw error || new Error('Élève introuvable');

        const pieces = e.pieces_recues || {};
        const jours = _joursDepuis(e.date_inscription || e.created_at);
        const enRetard = _piecesComptees(pieces) < PIECES_ATTENDUES.length && jours >= DELAI_PIECES_JOURS;

        const lignes = PIECES_ATTENDUES.map(function (d) {
            const cle = d[0], lbl = d[1], ic = d[2], oblig = d[3];
            const p = pieces[cle] || {};
            const coche = p.recu === true;
            return '<label style="display:flex;align-items:center;gap:12px;padding:11px 13px;border:1.5px solid ' +
                   (coche ? '#A5D6A7' : '#E3D9D4') + ';border-radius:10px;margin-bottom:8px;cursor:pointer;' +
                   'background:' + (coche ? '#F1F8E9' : '#fff') + ';">' +
                '<input type="checkbox" data-piece="' + cle + '" ' + (coche ? 'checked' : '') +
                    ' style="width:auto;flex-shrink:0;" onchange="_majLignePiece(this)">' +
                '<i class="fas ' + ic + '" style="color:#8D6E63;width:18px;"></i>' +
                '<span style="flex:1;">' +
                    '<span style="font-weight:600;font-size:.9rem;">' + lbl + '</span>' +
                    (oblig ? '' : ' <span style="font-size:.72rem;color:#7A6A63;">(si applicable)</span>') +
                    (p.date ? '<br><small style="color:#7A6A63;">Reçu le ' +
                        new Date(p.date).toLocaleDateString('fr-FR') + '</small>' : '') +
                '</span>' +
            '</label>';
        }).join('');

        const html =
        '<div class="modal-content" style="max-width:560px;">' +
          '<div class="modal-header">' +
            '<h3><i class="fas fa-folder-open"></i> Pièces justificatives</h3>' +
            '<button class="close-modal" onclick="closeModal(\'piecesModal\')">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<p style="font-size:.86rem;color:#7A6A63;margin:-4px 0 6px;">' +
              '<strong style="color:#2A211D;">' + (e.last_name || '') + ' ' + (e.first_name || '') + '</strong>' +
              ' · ' + (e.matricule || '—') + ' · inscrit il y a ' + jours + ' jour' + (jours > 1 ? 's' : '') +
            '</p>' +
            (enRetard
              ? '<div style="background:#FDECEA;border-left:4px solid #B23B2E;border-radius:8px;padding:11px 13px;margin-bottom:14px;font-size:.85rem;color:#8C2F22;">' +
                '<i class="fas fa-triangle-exclamation"></i> <strong>Dossier incomplet depuis ' + jours + ' jours.</strong> ' +
                'Relancez la famille : les originaux doivent être déposés au secrétariat.</div>'
              : '') +
            '<p style="font-size:.82rem;color:#7A6A63;margin-bottom:12px;">' +
              'Cochez uniquement les pièces <strong>originales physiquement remises</strong> au secrétariat. ' +
              'Les fichiers téléversés en ligne ne sont que des copies.</p>' +
            '<div id="piecesListe">' + lignes + '</div>' +
            '<div class="form-group" style="margin-top:12px;">' +
              '<label>Remarque du secrétariat</label>' +
              '<textarea id="piecesNotes" class="form-control" rows="2" ' +
                'placeholder="Ex. : bulletins promis pour la rentrée">' + (e.pieces_notes || '') + '</textarea>' +
            '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" onclick="closeModal(\'piecesModal\')">Annuler</button> ' +
            '<button class="btn btn-primary" onclick="enregistrerPieces(\'' + e.id + '\')">' +
              '<i class="fas fa-save"></i> Enregistrer</button>' +
          '</div>' +
        '</div>';

        let m = document.getElementById('piecesModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'piecesModal';
            m.className = 'modal';
            document.body.appendChild(m);
        }
        m.innerHTML = html;
        m.style.display = 'flex';
    } catch (err) {
        console.error('❌ Pièces:', err);
        showToast('Impossible d\'ouvrir le dossier : ' + (err.message || ''), 'error');
    }
};

// Retour visuel immédiat au clic
window._majLignePiece = function (cb) {
    const l = cb.closest('label');
    if (!l) return;
    l.style.borderColor = cb.checked ? '#A5D6A7' : '#E3D9D4';
    l.style.background  = cb.checked ? '#F1F8E9' : '#fff';
};

window.enregistrerPieces = async function (eleveId) {
    try {
        const { data: e } = await supabaseClient
            .from('students').select('pieces_recues').eq('id', eleveId).single();
        const avant = (e && e.pieces_recues) || {};

        const pieces = {};
        document.querySelectorAll('#piecesListe input[data-piece]').forEach(function (cb) {
            const cle = cb.dataset.piece;
            if (cb.checked) {
                // On conserve la date d'origine si la pièce était déjà reçue
                pieces[cle] = {
                    recu: true,
                    date: (avant[cle] && avant[cle].date) || new Date().toISOString().slice(0, 10)
                };
            }
        });

        const { error } = await supabaseClient.from('students').update({
            pieces_recues: pieces,
            pieces_notes: document.getElementById('piecesNotes')?.value?.trim() || null
        }).eq('id', eleveId);
        if (error) throw error;

        closeModal('piecesModal');
        // Si on arrivait depuis la fiche eleve, on y retourne : sinon le
        // secretariat perd le fil de ce qu'il consultait.
        if (window._retourFicheEleve) {
            const retour = window._retourFicheEleve;
            window._retourFicheEleve = null;
            setTimeout(function () { voirFicheEleve(retour); }, 250);
        }
        const n = Object.keys(pieces).length;
        showToast(n === PIECES_ATTENDUES.length
            ? 'Dossier complet ✅'
            : 'Pièces enregistrées (' + n + '/' + PIECES_ATTENDUES.length + ')', 'success');
        if (typeof loadEleves === 'function') loadEleves(true);
        if (typeof chargerAlerteDossiers === 'function') chargerAlerteDossiers();
    } catch (err) {
        console.error('❌ Enregistrement pièces:', err);
        showToast('Erreur : ' + (err.message || ''), 'error');
    }
};

function renderElevesRows(list, classesMap) {
    const tbody = document.getElementById('elevesTableBody');
    if (!tbody) return;
    if (!list || !list.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:#9ca3af;">Aucun élève ne correspond à ces critères</td></tr>';
        return;
    }
    tbody.innerHTML = list.map((e, index) => {
            const statusClass = {
                'actif': 'badge-success',
                'suspendu': 'badge-warning',
                'exclu': 'badge-danger'
            }[e.status] || 'badge-secondary';
            
            // Récupérer les infos depuis les maps
            const classeNom = classesMap[e.class_id] || '-';
            // Les infos parent sont directement dans students (father_name, mother_name...)
            const parentNom = e.father_name || e.mother_name || e.tutor_name || '-';
            const parentPhone = e.father_phone || e.mother_phone || e.tutor_phone || '-';
            
            return `
            <tr>
                <td>${e.matricule || '-'}</td>
                <td>${e.last_name || ''} ${e.first_name || ''}</td>
                <td>${classeNom}</td>
                <td>${e.birth_date ? new Date(e.birth_date).toLocaleDateString('fr-FR') : '-'}</td>
                <td>${parentNom}</td>
                <td>${parentPhone}</td>
                <td>${badgePieces(e)}</td>
                <td style="font-weight:600; color:${
                    e.solde > 0 ? '#ef4444' : 
                    e.solde < 0 ? '#f97316' : '#10b981'
                };">
                    ${e.solde !== undefined && e.solde !== null
                        ? parseInt(e.solde).toLocaleString('fr-FR') + ' FCFA'
                        : '-'}
                </td>
                <td><span class="badge ${statusClass}">${e.status || 'actif'}</span></td>
                <td>
                    <button class="btn btn-sm btn-info" onclick="voirFicheEleve('${e.id}')" title="Fiche complète">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="gererPieces('${e.id}')" title="Pièces justificatives">
                        <i class="fas fa-folder-open"></i>
                    </button>
                    <button class="btn btn-sm btn-primary" onclick="editEleve('${e.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteEleve('${e.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
            `;
    }).join('');
}

// ── Filtrage : recherche + classe + statut ──
window.filtrerEleves = function() {
    const q      = (document.getElementById('searchEleve')?.value || '').trim().toLowerCase();
    const classe = document.getElementById('filterClasseEleve')?.value || '';
    const statut = document.getElementById('filterStatutEleve')?.value || '';
    let list = window._elevesAll || [];
    if (q)      list = list.filter(e => ((e.last_name||'') + ' ' + (e.first_name||'') + ' ' + (e.matricule||'')).toLowerCase().includes(q));
    if (classe) list = list.filter(e => String(e.class_id) === String(classe));
    if (statut) list = list.filter(e => (e.status || 'actif') === statut);
    renderElevesRows(list, window._elevesClassesMap || {});
};

async function loadEleves(forceRefresh = false) {
    console.log('👥 Chargement des élèves...', forceRefresh ? '(forcer)' : '');
    
    try {
        // ⚠️ Vider le cache
        if (forceRefresh) {
            dataCache.students = null;
            dataCache.lastUpdate.students = null;
        }
        
        // Étape 1: Récupérer les élèves avec solde calculé
        const { data: eleves, error } = await supabaseClient
            .from('students_with_balance')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('❌ Erreur Supabase élèves:', error);
            throw error;
        }
        
        console.log(`✅ ${eleves?.length || 0} élève(s) chargé(s)`, eleves);
        
        // Étape 1 bis : pièces justificatives.
        // `students_with_balance` est une VUE : elle ne contient pas les
        // colonnes ajoutées ensuite à `students`. On les récupère à part
        // puis on joint en JS (jamais de join PostgREST).
        try {
            const ids = (eleves || []).map(e => e.id).filter(Boolean);
            if (ids.length) {
                const { data: sp } = await supabaseClient
                    .from('students')
                    .select('id, pieces_recues, date_inscription, created_at')
                    .in('id', ids);
                const parId = {};
                (sp || []).forEach(s => { parId[s.id] = s; });
                (eleves || []).forEach(e => {
                    const s = parId[e.id] || {};
                    e.pieces_recues    = s.pieces_recues || {};
                    e.date_inscription = s.date_inscription || s.created_at || null;
                });
            }
        } catch (e) {
            console.warn('⚠️ Pièces justificatives non chargées:', e?.message);
        }
        
        // Étape 2: Récupérer les classes séparément
        let classesMap = {};
        try {
            const { data: classes, error: classesError } = await supabaseClient
                .from('classes')
                .select('id, nom');
            
            if (!classesError && classes) {
                classes.forEach(c => {
                    classesMap[c.id] = c.nom;
                });
                console.log(`📚 ${classes.length} classe(s) chargée(s)`);
            }
        } catch (e) {
            console.warn('⚠️ Erreur chargement classes:', e);
        }
        
        // Étape 3: Récupérer les parents séparément
        let parentsMap = {};
        try {
            const { data: parents, error: parentsError } = await supabaseClient
                .from('parents')
                .select('id, first_name, last_name, phone');
            
            if (!parentsError && parents) {
                parents.forEach(p => {
                    parentsMap[p.id] = p;
                });
                console.log(`👨‍👩‍👧 ${parents.length} parent(s) chargé(s)`);
            }
        } catch (e) {
            console.warn('⚠️ Erreur chargement parents:', e);
        }
        
        // Stats
        const total = eleves?.length || 0;
        const garcons = eleves?.filter(e => e.gender === 'M').length || 0;
        const filles = eleves?.filter(e => e.gender === 'F').length || 0;
        const currentYear = new Date().getFullYear();
        const nouveaux = eleves?.filter(e => {
            const year = new Date(e.created_at).getFullYear();
            return year === currentYear;
        }).length || 0;
        
        updateCounter('totalEleves', total);
        updateCounter('garconsCount', garcons);
        updateCounter('fillesCount', filles);
        updateCounter('nouveauxCount', nouveaux);
        
        // Tableau
        const tbody = document.getElementById('elevesTableBody');
        if (!tbody) return;
        
        // Vider le tableau
        tbody.innerHTML = '';
        
        if (!eleves || eleves.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;">Aucun élève enregistré</td></tr>';
            return;
        }
        
        // Mémoriser pour le filtrage, puis rendre via la fonction partagée
        window._elevesAll = eleves;
        window._elevesClassesMap = classesMap;
        renderElevesRows(eleves, classesMap);
        
        // Mettre en cache
        dataCache.students = eleves;
        dataCache.lastUpdate.students = Date.now();
        
        // Filtres élèves : liaison unique des écouteurs
        [['searchEleve','input'], ['filterClasseEleve','change'], ['filterStatutEleve','change']].forEach(([id, evt]) => {
            const el = document.getElementById(id);
            if (el && !el.dataset.filtreBound) {
                el.dataset.filtreBound = '1';
                el.addEventListener(evt, window.filtrerEleves);
            }
        });
        
        // Charger filtres de classes
        await loadClassesForFilter();
        
    } catch (error) {
        console.error('❌ Erreur élèves:', error);
        showToast('Erreur chargement élèves: ' + error.message, 'error');
        
        const tbody = document.getElementById('elevesTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#ef4444;">Erreur de chargement</td></tr>';
        }
    }
}

async function loadClassesForFilter() {
    const { data: classes } = await supabaseClient
        .from('classes')
        .select('id, nom')
        .order('nom');
    
    const selects = [
        document.getElementById('filterClasseEleve'),
        document.getElementById('admClass'),
        document.getElementById('paymentClasse'),
        document.getElementById('bulletinClasse'),
        document.getElementById('presenceClasse'),
        document.getElementById('noteClasse'),
        document.getElementById('emploiClasseSelect'),
        document.getElementById('parentClassSelect')
    ];
    
    selects.forEach(select => {
        if (!select) return;
        const currentValue = select.value;
        const baseOption = select.options[0]?.text || 'Choisir...';
        select.innerHTML = `<option value="">${baseOption}</option>`;
        
        classes?.forEach(c => {
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.nom;
            select.appendChild(option);
        });
        
        select.value = currentValue;
    });
}

async function loadEnseignants_OLD() {
    console.log('📚 Chargement des enseignants...');
    
    try {
        // Vider le cache pour forcer le rechargement frais
        const { data: teachers, error } = await supabaseClient
            .from('teachers')
            .select(`
                id,
                first_name,
                last_name,
                email,
                phone,
                subjects
            `)
            .order('last_name');
        
        if (error) throw error;
        
        console.log(`✅ ${teachers?.length || 0} enseignant(s) chargé(s)`);
        
        // Mettre à jour les compteurs
        updateCounter('totalEnseignants', teachers?.length || 0);
        
        // Mettre à jour la grille
        const grid = document.getElementById('enseignantsGrid');
        if (!grid) {
            console.warn('⚠️ Grille enseignants non trouvée');
            return;
        }
        
        if (!teachers || teachers.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#666;">Aucun enseignant enregistré</div>';
            return;
        }
        
        grid.innerHTML = teachers.map(t => `
            <div class="card teacher-card" style="animation: fadeIn 0.3s ease;">
                <div class="card-body" style="text-align:center;">
                    <div style="width:80px;height:80px;background:#5D4037;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 15px;font-size:1.5rem;">
                        ${t.first_name?.[0] || ''}${t.last_name?.[0] || ''}
                    </div>
                    <h4>${t.last_name} ${t.first_name}</h4>
                    <p style="color:#666;margin:5px 0;">${t.email || '-'}</p>
                    <p style="color:#888;font-size:0.9rem;margin:5px 0;">${t.subjects?.join(', ') || 'Aucune matière'}</p>
                    <div style="margin-top:15px;">
                        <button class="btn btn-sm btn-primary" onclick="editTeacher('${t.id}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteTeacher('${t.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
        
        // Mettre en cache
        dataCache.teachers = teachers;
        dataCache.lastUpdate.teachers = Date.now();
        
    } catch (error) {
        console.error('❌ Erreur enseignants:', error);
        showToast('Erreur chargement enseignants', 'error');
        
        const grid = document.getElementById('enseignantsGrid');
        if (grid) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#ef4444;">Erreur de chargement</div>';
        }
    }
}
window._deleteTeacher_OLD = async function(teacherId) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cet enseignant ?')) {
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('teachers')
            .delete()
            .eq('id', teacherId);
        
        if (error) throw error;
        
        showToast('Enseignant supprimé avec succès', 'success');
        await loadEnseignants();
        
    } catch (error) {
        console.error('❌ Erreur suppression:', error);
        showToast('Erreur lors de la suppression', 'error');
    }
};
// Dans la section EXPOSITION GLOBALE, ajoutez :
// (deleteTeacher géré par le module enseignants)
window._editTeacher_OLD = function(teacherId) {
    console.log('✏️ Édition enseignant:', teacherId);
    showToast('Fonction d\'édition en cours de développement', 'info');
};

async function loadClasses(forceRefresh = false) {
    console.log('📚 Chargement des classes...', forceRefresh ? '(forcer)' : '');
    
    try {
        // ⚠️ Vider le cache pour forcer le rechargement frais
        if (forceRefresh) {
            dataCache.classes = null;
            dataCache.lastUpdate.classes = null;
        }
        
        // Étape 1: Récupérer les classes SANS jointure
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('*')
            .order('nom');
        
        if (error) {
            console.error('❌ Erreur Supabase:', error);
            throw error;
        }
        
        console.log(`✅ ${classes?.length || 0} classe(s) chargée(s)`, classes);
        
        // Étape 2: Récupérer les professeurs séparément
        let teachersMap = {};
        try {
            const { data: teachers, error: teachersError } = await supabaseClient
                .from('teachers')
                .select('id, first_name, last_name');
            
            if (!teachersError && teachers) {
                teachers.forEach(t => {
                    teachersMap[t.id] = t;
                });
                console.log(`👨‍🏫 ${teachers.length} professeur(s) chargé(s)`);
            }
        } catch (e) {
            console.warn('⚠️ Erreur chargement professeurs:', e);
        }
        
        // Mettre à jour le compteur
        updateCounter('totalClassesCount', classes?.length || 0);

        // ── Effectifs par classe + compteurs de la page ──────────────
        try {
            const { data: eleves } = await supabaseClient
                .from('students').select('class_id, status');
            const actifs = (eleves || []).filter(e => e.status === 'actif' || !e.status);

            // Compter les élèves par classe
            const effectifParClasse = {};
            actifs.forEach(e => {
                if (e.class_id) effectifParClasse[e.class_id] = (effectifParClasse[e.class_id] || 0) + 1;
            });

            const totalEffectif = actifs.length;
            const nbClasses = classes?.length || 0;
            const moyenne = nbClasses ? Math.round(totalEffectif / nbClasses) : 0;
            // Classes "complètes" = effectif >= capacité
            let completes = 0;
            (classes || []).forEach(c => {
                const eff = effectifParClasse[c.id] || 0;
                if (eff >= (c.capacite || 40)) completes++;
            });

            const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
            setTxt('totalEffectif', totalEffectif);
            setTxt('moyenneParClasse', moyenne);
            setTxt('classesCompletes', completes);

            // Stocker pour affichage de l'effectif sur chaque carte
            window._effectifParClasse = effectifParClasse;
        } catch (e) {
            console.warn('⚠️ Calcul effectifs classes:', e);
        }
        
        const grid = document.getElementById('classesGrid');
        if (!grid) {
            console.warn('⚠️ Grille classes non trouvée');
            return;
        }
        
        // Vider la grille avant de remplir
        grid.innerHTML = '';
        
        if (!classes || classes.length === 0) {
            grid.innerHTML = `
                <div style="grid-column:1/-1;text-align:center;padding:40px;color:#666;">
                    <i class="fas fa-school" style="font-size:3rem;margin-bottom:15px;color:#ddd;"></i>
                    <p>Aucune classe enregistrée</p>
                    <button class="btn btn-primary" onclick="openModal('addClasseModal')" style="margin-top:15px;">
                        <i class="fas fa-plus"></i> Créer une classe
                    </button>
                </div>`;
            return;
        }
        
        // Afficher les classes
        const NIV_LABELS = { jardin:'Jardin','1ere':'1ère Année','2eme':'2ème Année','3eme':'3ème Année','4eme':'4ème Année','5eme':'5ème Année','6eme':'6ème Année','7eme':'7ème Année','8eme':'8ème Année','9eme':'9ème Année' };
        const PRIMARY = ['jardin','1ere','2eme','3eme','4eme','5eme','6eme'];
        grid.innerHTML = classes.map(c => {
            // Récupérer le professeur depuis la map
            const teacher = c.professeur_principal_id ? teachersMap[c.professeur_principal_id] : null;
            const isPrimary = PRIMARY.includes(c.niveau);
            const profLine = isPrimary
                ? `<i class="fas fa-user-tie" style="width:20px;color:#8D6E63;"></i> ${teacher ? `${teacher.last_name||''} ${teacher.first_name||''}`.trim()+' <span style="color:#5D4037;font-size:.8rem;">(principal)</span>' : '<span style="color:#f59e0b;">Pas de prof. principal</span>'}`
                : `<i class="fas fa-book" style="width:20px;color:#8D6E63;"></i> <span style="color:#6d28d9;font-size:.88rem;">Profs par matière</span>`;
            const niveauLabel = NIV_LABELS[c.niveau] || c.niveau || '-';
            
            return `
            <div class="card class-card" style="animation: fadeIn 0.3s ease;">
                <div class="card-header" style="background:#5D4037;color:white;padding:15px;">
                    <h4 style="margin:0;">${c.nom || 'Sans nom'}</h4>
                    <span class="badge badge-light">${niveauLabel}</span>
                </div>
                <div class="card-body" style="padding:15px;">
                    <p style="margin:8px 0;">${profLine}</p>
                    <p style="margin:8px 0;"><i class="fas fa-users" style="width:20px;color:#8D6E63;"></i> Effectif: ${(window._effectifParClasse && window._effectifParClasse[c.id]) || 0} / ${c.capacite || 40}</p>
                    <p style="margin:8px 0;"><i class="fas fa-door-open" style="width:20px;color:#8D6E63;"></i> ${c.salle || 'Non assignée'}</p>
                    <hr style="margin:15px 0;border:none;border-top:1px solid #e5e7eb;">
                    <p style="font-size:0.9rem;margin:5px 0;">
                        <strong>Inscription:</strong> ${(c.frais_inscription || 0).toLocaleString('fr-FR')} FCFA
                    </p>
                    <p style="font-size:0.9rem;margin:5px 0;">
                        <strong>Scolarité:</strong> ${(c.frais_scolarite || 0).toLocaleString('fr-FR')} FCFA
                    </p>
                    <div style="display:flex;gap:10px;margin-top:15px;">
                        <button class="btn btn-sm btn-primary" onclick="editClasse('${c.id}')" title="Modifier">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="gererMatieres('${c.id}', '${c.nom?.replace(/'/g, "\\'")}')" title="Gérer les matières">
                            <i class="fas fa-book"></i> Matières
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteClasse('${c.id}')" title="Supprimer">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        
        // Mettre en cache
        dataCache.classes = classes;
        dataCache.lastUpdate.classes = Date.now();
        
    } catch (error) {
        console.error('❌ Erreur loadClasses:', error);
        showToast('Erreur chargement des classes: ' + error.message, 'error');
        
        const grid = document.getElementById('classesGrid');
        if (grid) {
            grid.innerHTML = `
                <div style="grid-column:1/-1;text-align:center;padding:40px;color:#ef4444;">
                    <i class="fas fa-exclamation-triangle" style="font-size:3rem;margin-bottom:15px;"></i>
                    <p>Erreur de chargement</p>
                    <small style="color:#999;">${error.message}</small>
                    <br>
                    <button class="btn btn-primary" onclick="loadClasses(true)" style="margin-top:15px;">
                        <i class="fas fa-redo"></i> Réessayer
                    </button>
                </div>`;
        }
    }
}
async function loadMatieresGlobales(forceRefresh = false) {
    console.log('📚 Chargement des matières...', forceRefresh ? '(forcer)' : '');
    
    try {
        // ⚠️ Vider le cache pour forcer le rechargement frais
        if (forceRefresh) {
            dataCache.matieres = null;
            dataCache.lastUpdate.matieres = null;
        }
        
        const { data: matieres, error } = await supabaseClient
            .from('subjects')
            .select('id, code, name, description')
            .order('name');
        
        if (error) {
            console.error('❌ Erreur Supabase matières:', error);
            throw error;
        }

        // Compter de façon fiable le nombre de classes par matière
        const countParMatiere = {};
        try {
            const { data: liens } = await supabaseClient.from('class_subjects').select('subject_id, class_id');
            (liens || []).forEach(l => {
                if (l.subject_id) {
                    countParMatiere[l.subject_id] = countParMatiere[l.subject_id] || new Set();
                    countParMatiere[l.subject_id].add(l.class_id);
                }
            });
        } catch (e) { console.warn('⚠️ Comptage classes par matière:', e); }
        
        console.log(`✅ ${matieres?.length || 0} matière(s) chargée(s)`, matieres);
        
        const tbody = document.getElementById('matieresGlobalesTable');
        const noMsg = document.getElementById('noMatieresMsg');
        
        if (!tbody) {
            console.warn('⚠️ Tableau matières non trouvé');
            return;
        }
        
        // Vider le tableau avant de remplir
        tbody.innerHTML = '';
        
        if (!matieres || matieres.length === 0) {
            if (noMsg) noMsg.style.display = 'block';
            return;
        }
        
        if (noMsg) noMsg.style.display = 'none';
        
        tbody.innerHTML = matieres.map(m => `
            <tr>
                <td><span class="badge badge-secondary">${m.code || '-'}</span></td>
                <td>${m.name || 'Sans nom'}</td>
                <td>${(countParMatiere[m.id] ? countParMatiere[m.id].size : 0)} classe(s)</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="editMatiere('${m.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteMatiere('${m.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
        
        // Mettre en cache
        dataCache.matieres = matieres;
        dataCache.lastUpdate.matieres = Date.now();
        
    } catch (error) {
        console.error('❌ Erreur matières:', error);
        showToast('Erreur chargement des matières', 'error');
        
        const tbody = document.getElementById('matieresGlobalesTable');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#ef4444;">Erreur de chargement</td></tr>';
        }
    }
}


// ============================================
// FONCTIONS POUR LES MATIÈRES DES ENSEIGNANTS
// ============================================
/**
 * Charge les professeurs dans le select du formulaire classe
 */
async function loadProfesseursForClasseSelect() {
    console.log('👨‍🏫 Chargement des professeurs pour le select classe...');
    
    try {
        const { data: teachers, error } = await supabaseClient
            .from('teachers')
            .select('id, first_name, last_name')
            .order('last_name');
        
        if (error) throw error;
        
        const select = document.getElementById('classeProfesseur');
        if (!select) {
            console.warn('⚠️ Select classeProfesseur non trouvé');
            return;
        }
        
        // Garder l'option par défaut
        const currentValue = select.value;
        select.innerHTML = '<option value="">Choisir un professeur...</option>';
        
        if (!teachers || teachers.length === 0) {
            console.warn('⚠️ Aucun professeur trouvé');
            return;
        }
        
        console.log(`✅ ${teachers.length} professeur(s) chargé(s)`);
        
        teachers.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = `${t.last_name} ${t.first_name}`;
            select.appendChild(option);
        });
        
        // Restaurer la valeur si elle existe
        if (currentValue) select.value = currentValue;
        
    } catch (error) {
        console.error('❌ Erreur chargement professeurs:', error);
    }
}

/**
 * Gère le changement de niveau et adapte le champ professeur
 */
function handleNiveauChange() {
    const niveau = document.getElementById('classeNiveau')?.value;
    const profGroup = document.getElementById('professeurGroup');
    const profLabel = document.getElementById('professeurLabel');
    const profSelect = document.getElementById('classeProfesseur');
    const profOptionnel = document.getElementById('profOptionnel');
    const niveauHelp = document.getElementById('niveauHelp');
    
    // Niveaux Jardin à 6ème : professeur principal obligatoire (un seul)
    const primaryLevels = ['jardin', '1ere', '2eme', '3eme', '4eme', '5eme', '6eme'];
    
    // Niveaux 7ème à 9ème : pas de professeur principal (plusieurs profs par matière)
    const secondaryLevels = ['7eme', '8eme', '9eme'];
    
    if (!niveau) {
        // Aucun niveau sélectionné
        profGroup.style.display = 'block';
        profLabel.textContent = 'Professeur Principal *';
        profSelect.required = true;
        profOptionnel.style.display = 'none';
        niveauHelp.style.display = 'none';
        return;
    }
    
    if (primaryLevels.includes(niveau)) {
        // Jardin à 6ème : Professeur principal obligatoire
        profGroup.style.display = 'block';
        profLabel.textContent = 'Professeur Principal *';
        profSelect.required = true;
        profOptionnel.style.display = 'none';
        niveauHelp.style.display = 'none';
        
        // Charger les professeurs si pas déjà fait
        if (profSelect.options.length <= 1) {
            loadProfesseursForClasseSelect();
        }
        
    } else if (secondaryLevels.includes(niveau)) {
        // 7ème à 9ème : Pas de professeur principal (géré par matière)
        profGroup.style.display = 'none'; // Cacher complètement le champ
        profSelect.required = false;
        profSelect.value = ''; // Vider la sélection
        
        // Note : les professeurs seront assignés via la gestion des matières de la classe
    }
}
/**
 * Charge les matières dans le select du formulaire enseignant
 */
window.loadMatieresForTeacherSelect = async function() {
    console.log('📚 Chargement des matières pour le select enseignant...');
    
    try {
        const { data: matieres, error } = await supabaseClient
            .from('subjects')
            .select('id, name, code')  // name (pas nom)
            .order('name');
        
        if (error) throw error;
        
        const select = document.getElementById('teacherSubjects');
        if (!select) {
            console.warn('⚠️ Select teacherSubjects non trouvé');
            return;
        }
        
        // Vider le select
        select.innerHTML = '';
        
        if (!matieres || matieres.length === 0) {
            const option = document.createElement('option');
            option.textContent = 'Aucune matière disponible';
            option.disabled = true;
            select.appendChild(option);
            console.warn('⚠️ Aucune matière trouvée dans la base de données');
            return;
        }
        
        console.log(`✅ ${matieres.length} matière(s) chargée(s)`);
        
        // Ajouter les options
        matieres.forEach(m => {
            const option = document.createElement('option');
            option.value = m.id;
            option.textContent = `${m.name} (${m.code})`;  // name (pas nom)
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('❌ Erreur chargement matières:', error);
        showToast('Erreur chargement des matières', 'error');
    }
};

// ============================================
// SECTION NOTES - FONCTIONS COMPLÈTES
// ============================================

/**
 * Initialise la page Notes
 */
async function initNotesPage() {
    console.log('📝 Initialisation page Notes...');
    
    // Charger les classes dans le select
    await loadClassesForNotesSelect();
    
    // Charger les matières dans le select
    await loadMatieresForNotesSelect();
    
    // Initialiser le titre
    const titleEl = document.getElementById('noteClassTitle');
    if (titleEl) titleEl.textContent = 'Sélectionnez une classe et une matière';
    
    // Vider le tableau
    const tbody = document.getElementById('notesTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;color:#666;">Sélectionnez une classe et une matière pour charger les élèves</td></tr>';
    }
}

/**
 * Charge les classes dans le select de notes
 */
async function loadClassesForNotesSelect() {
    const select = document.getElementById('noteClasse');
    if (!select) return;
    
    try {
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('id, nom')
            .order('nom');
        
        if (error) throw error;
        
        const currentValue = select.value;
        select.innerHTML = '<option value="">Choisir une classe...</option>';
        
        classes?.forEach(c => {
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.nom;
            select.appendChild(option);
        });
        
        select.value = currentValue;
        
    } catch (error) {
        console.error('❌ Erreur chargement classes:', error);
    }
}

/**
 * Charge les matières dans le select de notes
 */
async function loadMatieresForNotesSelect() {
    const select = document.getElementById('noteMatiere');
    if (!select) return;
    
    try {
        const { data: matieres, error } = await supabaseClient
            .from('subjects')
            .select('id, name, code')
            .order('name');
        
        if (error) throw error;
        
        const currentValue = select.value;
        select.innerHTML = '<option value="">Choisir une matière...</option>';
        
        matieres?.forEach(m => {
            const option = document.createElement('option');
            option.value = m.id;
            option.textContent = `${m.name} (${m.code})`;
            select.appendChild(option);
        });
        
        select.value = currentValue;
        
    } catch (error) {
        console.error('❌ Erreur chargement matières:', error);
    }
}

/**
 * Appelé quand on change de classe dans le select notes
 */
window.onClasseChangeForNotes = async function() {
    const classeId = document.getElementById('noteClasse')?.value;
    
    // Si une classe est sélectionnée, charger ses matières spécifiques
    if (classeId) {
        await loadMatieresForClasse(classeId);
    }
};

/**
 * Charge les matières spécifiques d'une classe
 */
async function loadMatieresForClasse(classeId) {
    const select = document.getElementById('noteMatiere');
    if (!select) return;
    
    try {
        // Récupérer les matières liées à cette classe via class_subjects
        const { data: classSubjects, error } = await supabaseClient
            .from('class_subjects')
            .select(`
                subject_id,
                subjects(id, name, code)
            `)
            .eq('class_id', classeId);
        
        if (error) throw error;
        
        select.innerHTML = '<option value="">Choisir une matière...</option>';
        
        if (!classSubjects || classSubjects.length === 0) {
            // Si pas de matières spécifiques, charger toutes les matières
            await loadMatieresForNotesSelect();
            return;
        }
        
        classSubjects.forEach(cs => {
            if (cs.subjects) {
                const option = document.createElement('option');
                option.value = cs.subjects.id;
                option.textContent = `${cs.subjects.name} (${cs.subjects.code})`;
                select.appendChild(option);
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur chargement matières classe:', error);
        // Fallback : charger toutes les matières
        await loadMatieresForNotesSelect();
    }
}

/**
 * Charge les élèves pour la saisie des notes
 */
window.loadStudentsForNotes = async function() {
    console.log('👥 Chargement des élèves pour notes...');
    
    const classeId = document.getElementById('noteClasse')?.value;
    const matiereId = document.getElementById('noteMatiere')?.value;
    const type = document.getElementById('noteType')?.value;
    const sequence = document.getElementById('noteSequence')?.value;
    
    // Validation
    if (!classeId) {
        showToast('Veuillez sélectionner une classe', 'error');
        return;
    }
    if (!matiereId) {
        showToast('Veuillez sélectionner une matière', 'error');
        return;
    }
    
    const tbody = document.getElementById('notesTableBody');
    const titleEl = document.getElementById('noteClassTitle');
    
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr>';
    }
    
    try {
        // 1. Récupérer les élèves de la classe
        const { data: eleves, error: elevesError } = await supabaseClient
            .from('students')
            .select('id, first_name, last_name, matricule')
            .eq('class_id', classeId)
            .eq('status', 'actif')
            .order('last_name');
        
        if (elevesError) throw elevesError;
        
        if (!eleves || eleves.length === 0) {
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;color:#666;">Aucun élève dans cette classe</td></tr>';
            }
            if (titleEl) titleEl.textContent = 'Aucun élève trouvé';
            return;
        }
        
        // 2. Récupérer les notes existantes pour cette classe/matière/type/séquence
        const { data: existingNotes, error: notesError } = await supabaseClient
            .from('notes')
            .select('*')
            .eq('class_id', classeId)
            .eq('subject_id', matiereId)
            .eq('type', type)
            .eq('sequence', sequence);
        
        if (notesError) throw notesError;
        
        // Créer un map des notes existantes
        const notesMap = {};
        existingNotes?.forEach(n => {
            notesMap[n.student_id] = n;
        });
        
        // 3. Afficher les élèves avec leurs notes
        const classeNom = document.getElementById('noteClasse')?.selectedOptions[0]?.text || '';
        const matiereNom = document.getElementById('noteMatiere')?.selectedOptions[0]?.text || '';
        
        if (titleEl) {
            titleEl.textContent = `${classeNom} - ${matiereNom} (${getTypeLabel(type)} - ${getSequenceLabel(sequence)})`;
        }
        
        if (tbody) {
            tbody.innerHTML = eleves.map((eleve, index) => {
                const existingNote = notesMap[eleve.id];
                const noteValue = existingNote ? existingNote.value : '';
                const observation = existingNote ? existingNote.observation : '';
                const noteId = existingNote ? existingNote.id : '';
                
                return `
                <tr data-student-id="${eleve.id}" data-note-id="${noteId}">
                    <td>${index + 1}</td>
                    <td>
                        <strong>${eleve.last_name} ${eleve.first_name}</strong>
                        <br><small style="color:#666;">${eleve.matricule || '-'}</small>
                    </td>
                    <td>
                        <input type="number" 
                               class="form-control note-input" 
                               value="${noteValue}" 
                               min="0" 
                               max="20" 
                               step="0.25"
                               placeholder="/20"
                               style="width:100px;text-align:center;"
                               onchange="validateNote(this)">
                    </td>
                    <td>
                        <input type="text" 
                               class="form-control observation-input" 
                               value="${observation}"
                               placeholder="Observation (optionnel)"
                               style="width:100%;">
                    </td>
                </tr>
                `;
            }).join('');
        }
        
        console.log(`✅ ${eleves.length} élève(s) chargé(s)`);
        
    } catch (error) {
        console.error('❌ Erreur chargement élèves:', error);
        showToast('Erreur chargement des élèves: ' + error.message, 'error');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;color:#ef4444;">Erreur de chargement</td></tr>';
        }
    }
};

/**
 * Valide la note saisie (entre 0 et 20)
 */
window.validateNote = function(input) {
    let value = parseFloat(input.value);
    
    if (isNaN(value) || value < 0) {
        value = 0;
    } else if (value > 20) {
        value = 20;
    }
    
    // Arrondir à 0.25 près
    value = Math.round(value * 4) / 4;
    
    input.value = value;
    
    // Visual feedback
    if (value < 10) {
        input.style.borderColor = '#ef4444'; // Rouge
        input.style.backgroundColor = '#fef2f2';
    } else if (value < 14) {
        input.style.borderColor = '#f59e0b'; // Orange
        input.style.backgroundColor = '#fffbeb';
    } else {
        input.style.borderColor = '#10b981'; // Vert
        input.style.backgroundColor = '#f0fdf4';
    }
};

/**
 * Sauvegarde toutes les notes
 */
window.saveNotes = async function() {
    console.log('💾 Sauvegarde des notes...');
    
    const classeId = document.getElementById('noteClasse')?.value;
    const matiereId = document.getElementById('noteMatiere')?.value;
    const type = document.getElementById('noteType')?.value;
    const sequence = document.getElementById('noteSequence')?.value;
    
    if (!classeId || !matiereId) {
        showToast('Veuillez sélectionner une classe et une matière', 'error');
        return;
    }
    
    // Récupérer toutes les lignes du tableau
    const rows = document.querySelectorAll('#notesTableBody tr');
    const notesToSave = [];
    const notesToUpdate = [];
    
    rows.forEach(row => {
        const studentId = row.dataset.studentId;
        const noteId = row.dataset.noteId;
        const noteInput = row.querySelector('.note-input');
        const observationInput = row.querySelector('.observation-input');
        
        const value = parseFloat(noteInput?.value);
        
        // Ne sauvegarder que si une note est saisie
        if (!isNaN(value) && noteInput.value !== '') {
            const noteData = {
                student_id: studentId,
                class_id: classeId,
                subject_id: matiereId,
                type: type,
                sequence: sequence,
                value: value,
                observation: observationInput?.value?.trim() || null,
                created_at: new Date().toISOString()
            };
            
            if (noteId) {
                // Mise à jour
                notesToUpdate.push({
                    id: noteId,
                    ...noteData,
                    updated_at: new Date().toISOString()
                });
            } else {
                // Nouvelle note
                notesToSave.push(noteData);
            }
        }
    });
    
    if (notesToSave.length === 0 && notesToUpdate.length === 0) {
        showToast('Aucune note à sauvegarder', 'info');
        return;
    }
    
    // Afficher loading
    const saveBtn = document.querySelector('#notesPage button[onclick="saveNotes()"]');
    const originalText = saveBtn?.innerHTML;
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sauvegarde...';
    }
    
    try {
        let inserted = 0;
        let updated = 0;
        
        // Insérer les nouvelles notes
        if (notesToSave.length > 0) {
            const { data, error } = await supabaseClient
                .from('notes')
                .insert(notesToSave)
                .select();
            
            if (error) throw error;
            inserted = data?.length || 0;
            
            // Mettre à jour les IDs dans le DOM
            data?.forEach((note, index) => {
                const row = document.querySelector(`tr[data-student-id="${note.student_id}"]`);
                if (row) row.dataset.noteId = note.id;
            });
        }
        
        // Mettre à jour les notes existantes
        for (const note of notesToUpdate) {
            const { error } = await supabaseClient
                .from('notes')
                .update({
                    value: note.value,
                    observation: note.observation,
                    updated_at: note.updated_at
                })
                .eq('id', note.id);
            
            if (error) throw error;
            updated++;
        }
        
        showToast(`${inserted} note(s) créée(s), ${updated} note(s) mise(s) à jour`, 'success');
        
        // Recharger pour afficher les IDs mis à jour
        await loadStudentsForNotes();
        
    } catch (error) {
        console.error('❌ Erreur sauvegarde notes:', error);
        showToast('Erreur lors de la sauvegarde: ' + error.message, 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Enregistrer les notes';
        }
    }
};


/**
 * Helpers pour les labels
 */
function getTypeLabel(type) {
    const labels = {
        'devoir': 'Devoir',
        'interrogation': 'Interrogation',
        'examen': 'Composition',
        'participation': 'Participation (ancien)',
        'composition_mensuelle': 'Composition mensuelle'
    };
    return labels[type] || type;
}

function getSequenceLabel(sequence) {
    const labels = {
        '1': '1er Trimestre',
        '2': '2ème Trimestre',
        '3': '3ème Trimestre'
    };
    return labels[sequence] || sequence;
}

// ==========================================
// SECTION BULLETINS - VERSION CORRIGÉE ET COMPLÈTE
// ==========================================
/**
 * Initialise la page des bulletins
 */
async function initBulletinsPage() {
    console.log('📋 Initialisation page bulletins...');
    
    // Charger les classes dans le select
    const select = document.getElementById('bulletinClasse');
    if (select) {
        try {
            const { data: classes, error } = await supabaseClient
                .from('classes')
                .select('id, nom')
                .order('nom');
            
            if (error) throw error;
            
            select.innerHTML = '<option value="">Choisir une classe...</option>';
            
            classes?.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = c.nom;
                select.appendChild(option);
            });
            
        } catch (error) {
            console.error('❌ Erreur chargement classes:', error);
        }
    }
    
    // Définir le trimestre par défaut selon la date
    const today = new Date();
    const month = today.getMonth() + 1;
    let defaultTrimestre = '1';
    if (month >= 1 && month <= 3) defaultTrimestre = '2';
    else if (month >= 4 && month <= 6) defaultTrimestre = '3';
    
    const trimestreSelect = document.getElementById('bulletinTrimestre');
    if (trimestreSelect) trimestreSelect.value = defaultTrimestre;
    
    console.log('✅ Page bulletins initialisée');
}

// Exposer la fonction globalement
window.initBulletinsPage = initBulletinsPage;
/**
 * Génère les bulletins pour une classe et un trimestre
 * VERSION CORRIGÉE - Récupère les vraies notes depuis la table notes
 */
window.generateBulletins = async function() {
    console.log('📊 Génération des bulletins...');
    
    const classeId = document.getElementById('bulletinClasse')?.value;
    const trimestre = document.getElementById('bulletinTrimestre')?.value;
    
    if (!classeId) {
        showToast('Veuillez sélectionner une classe', 'error');
        return;
    }
    
    const container = document.getElementById('bulletinsDetailContainer');
    if (!container) return;
    
    // Loading
    container.innerHTML = `
        <div style="text-align: center; padding: 60px;">
            <i class="fas fa-spinner fa-spin" style="font-size: 3rem; color: #5D4037; margin-bottom: 20px;"></i>
            <p style="color: #666;">Chargement des bulletins...</p>
        </div>
    `;
    
    try {
        // 1. Infos de la classe avec professeur principal
        const { data: classe, error: classeError } = await supabaseClient
            .from('classes')
            .select(`*, teachers:professeur_principal_id(last_name, first_name)`)
            .eq('id', classeId)
            .single();
        
        if (classeError) throw classeError;
        
        // 2. Récupérer les matières de la classe avec leurs coefficients
        const { data: classSubjects, error: subjectsError } = await supabaseClient
            .from('class_subjects')
            .select(`
                coefficient,
                hours_per_week,
                subjects(id, name, code),
                teachers(id, first_name, last_name)
            `)
            .eq('class_id', classeId);
        
        if (subjectsError) throw subjectsError;
        
        console.log(`📚 ${classSubjects?.length || 0} matière(s) trouvée(s)`);
        
        // 3. Récupérer les élèves de la classe
        const { data: eleves, error: elevesError } = await supabaseClient
            .from('students')
            .select('*')
            .eq('class_id', classeId)
            .eq('status', 'actif')
            .order('last_name');
        
        if (elevesError) throw elevesError;
        
        if (!eleves || eleves.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 60px; color: #666;">
                    <i class="fas fa-info-circle" style="font-size: 3rem; margin-bottom: 20px; color: #f59e0b;"></i>
                    <p>Aucun élève actif dans cette classe</p>
                </div>`;
            return;
        }
        
        // 4. Récupérer TOUTES les notes pour ce trimestre et cette classe
        const { data: allNotes, error: notesError } = await supabaseClient
            .from('notes')
            .select('*')
            .eq('class_id', classeId)
            .eq('sequence', trimestre);
        
        if (notesError) throw notesError;
        
        console.log(`📝 ${allNotes?.length || 0} note(s) trouvée(s)`);
        
        // 5. Organiser les notes par élève et par matière
        const notesByStudent = {};
        allNotes?.forEach(note => {
            if (!notesByStudent[note.student_id]) {
                notesByStudent[note.student_id] = {};
            }
            if (!notesByStudent[note.student_id][note.subject_id]) {
                notesByStudent[note.student_id][note.subject_id] = {
                    devoirs: [],
                    examens: [],
                    participations: []
                };
            }
            
            const noteData = {
                value: parseFloat(note.value) || 0,
                observation: note.observation,
                created_at: note.created_at
            };
            
            if (note.type === 'devoir') {
                notesByStudent[note.student_id][note.subject_id].devoirs.push(noteData);
            } else if (note.type === 'examen') {
                notesByStudent[note.student_id][note.subject_id].examens.push(noteData);
            } else if (note.type === 'interrogation') {
                // Au Mali, une interrogation vaut un devoir : elle le complete
                // ou le remplace, avec le meme poids. On la range donc avec eux.
                notesByStudent[note.student_id][note.subject_id].devoirs.push(noteData);
            } else if (note.type === 'participation') {
                // Conserve pour les notes ANCIENNES uniquement : la
                // participation n'est pas pratiquee au Mali et a ete retiree
                // de la saisie. Ignorer ces notes fausserait retroactivement
                // des bulletins deja distribues.
                notesByStudent[note.student_id][note.subject_id].participations.push(noteData);
            }
        });
        
        // 6. Calculer les bulletins pour chaque élève
        const bulletins = [];
        
        for (const eleve of eleves) {
            const bulletin = {
                eleve: eleve,
                matieres: [],
                totalPoints: 0,
                totalCoef: 0,
                moyenne: 0,
                rang: 0
            };
            
            // Calculer pour chaque matière
for (const cs of (classSubjects || [])) {
    const subjectId = cs.subjects?.id;
    const coef = parseFloat(cs.coefficient) || 1;
    const studentNotes = notesByStudent[eleve.id]?.[subjectId] || {
        devoirs: [],
        examens: [],
        participations: []
    };
 
    let moyenneMatiere = 0;
    let totalCoefNotes = 0;
    let sumNotes = 0;
 
    let avgDevoirs = null, avgExamens = null, avgPart = null;
 
    if (studentNotes.devoirs.length > 0) {
        avgDevoirs = studentNotes.devoirs.reduce((s, n) => s + n.value, 0) / studentNotes.devoirs.length;
        sumNotes += avgDevoirs * 1;
        totalCoefNotes += 1;
    }
    if (studentNotes.examens.length > 0) {
        avgExamens = studentNotes.examens.reduce((s, n) => s + n.value, 0) / studentNotes.examens.length;
        sumNotes += avgExamens * 2;
        totalCoefNotes += 2;
    }
    if (studentNotes.participations.length > 0) {
        avgPart = studentNotes.participations.reduce((s, n) => s + n.value, 0) / studentNotes.participations.length;
        sumNotes += avgPart * 0.5;
        totalCoefNotes += 0.5;
    }
 
    if (totalCoefNotes > 0) {
        moyenneMatiere = Math.min(sumNotes / totalCoefNotes, 20);
    }
 
    const total = moyenneMatiere * coef;
 
    bulletin.matieres.push({
        code: cs.subjects?.code || '-',
        nom: cs.subjects?.name || 'Matière inconnue',
        professeur: cs.teachers ? `${cs.teachers.last_name} ${cs.teachers.first_name}` : '-',
        coefficient: coef,
        noteClasse: avgDevoirs,   // ← nouveau : note de classe
        compo: avgExamens,        // ← nouveau : composition
        moyenne: moyenneMatiere,
        total: total,
        appreciation: getAppreciationText(moyenneMatiere),
        details: {
            nbDevoirs: studentNotes.devoirs.length,
            nbExamens: studentNotes.examens.length,
            nbParticipations: studentNotes.participations.length,
            notesDevoirs: studentNotes.devoirs.map(n => n.value),
            notesExamens: studentNotes.examens.map(n => n.value)
        }
    });
 
    if (moyenneMatiere > 0) {
        bulletin.totalPoints += total;
        bulletin.totalCoef += coef;
    }
}
            
            // Calculer la moyenne générale
            bulletin.moyenne = bulletin.totalCoef > 0 ? (bulletin.totalPoints / bulletin.totalCoef) : 0;
            
            bulletins.push(bulletin);
        }
        
        // 7. Trier et attribuer les rangs
        bulletins.sort((a, b) => b.moyenne - a.moyenne);
        
        let currentRank = 1;
        let previousMoyenne = null;
        
        bulletins.forEach((b, index) => {
            if (previousMoyenne !== null && Math.abs(b.moyenne - previousMoyenne) < 0.01) {
                b.rang = bulletins[index - 1].rang;
            } else {
                b.rang = currentRank;
            }
            previousMoyenne = b.moyenne;
            currentRank++;
        });
        
        console.log(`✅ ${bulletins.length} bulletins générés`);
        
        // 8. Afficher
        await renderBulletinsPage(bulletins, classe, trimestre, classSubjects?.length || 0);
        
        showToast(`${bulletins.length} bulletins générés avec succès`, 'success');
        
    } catch (error) {
        console.error('❌ Erreur génération bulletins:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 60px; color: #ef4444;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 20px;"></i>
                <p>Erreur lors de la génération des bulletins</p>
                <small style="color: #666;">${error.message}</small>
                <br>
                <button onclick="generateBulletins()" class="btn btn-primary" style="margin-top: 20px;">
                    <i class="fas fa-redo"></i> Réessayer
                </button>
            </div>`;
    }
};
/**
 * Affiche la page complète des bulletins avec design professionnel
 */
/**
 * Calcule la moyenne ANNUELLE de chaque eleve : moyenne des trois
 * trimestres, comparee a 10 pour la decision du conseil de classe.
 *
 * On recharge les notes des trimestres 1 et 2 (le 3e est deja dans les
 * bulletins passes en parametre) et on applique EXACTEMENT la meme
 * formule que pour un trimestre : poids devoir=1, examen=2,
 * participation=0,5, denominateur adapte aux natures presentes,
 * puis moyenne generale ponderee par les coefficients.
 *
 * Un trimestre sans aucune note n'entre pas dans le calcul : un eleve
 * arrive en cours d'annee ne doit pas etre penalise par des zeros.
 */
async function calculerMoyennesAnnuelles(bulletins, classeId) {
    if (!bulletins || !bulletins.length || !classeId) return;

    // Notes des trimestres 1 et 2. Requete separee : pas de jointure PostgREST.
    const { data: notesAnterieures, error } = await supabaseClient
        .from('notes').select('*')
        .eq('class_id', classeId)
        .in('sequence', [1, 2]);
    if (error) throw error;

    // Coefficients de la classe
    const { data: cs } = await supabaseClient
        .from('class_subjects').select('subject_id, coefficient').eq('class_id', classeId);
    const coefs = {};
    (cs || []).forEach(c => { coefs[c.subject_id] = parseFloat(c.coefficient) || 1; });

    // Interrogation = meme poids qu'un devoir (usage malien : elle le
    // remplace ou le complete). Participation conservee a 0,5 pour les
    // notes anciennes, mais retiree de la saisie.
    const POIDS = { devoir: 1, interrogation: 1, examen: 2, participation: 0.5 };

    // Regroupement : eleve → trimestre → matiere → type → [notes]
    const parEleve = {};
    (notesAnterieures || []).forEach(function (n) {
        if (n.value == null) return;
        const e = parEleve[n.student_id] || (parEleve[n.student_id] = {});
        const t = e[n.sequence] || (e[n.sequence] = {});
        const m = t[n.subject_id] || (t[n.subject_id] = {});
        (m[n.type] || (m[n.type] = [])).push(parseFloat(n.value));
    });

    // Moyenne generale d'un trimestre, formule identique au bulletin.
    function moyenneTrimestre(matieres) {
        let totalPoints = 0, totalCoef = 0;
        Object.keys(matieres || {}).forEach(function (subjectId) {
            const parType = matieres[subjectId];
            let sommePonderee = 0, sommePoids = 0;
            Object.keys(parType).forEach(function (type) {
                const notes = parType[type];
                if (!notes || !notes.length) return;
                const poids = POIDS[type];
                if (!poids) return;
                const moy = notes.reduce((s, v) => s + v, 0) / notes.length;
                sommePonderee += moy * poids;
                sommePoids += poids;   // denominateur adapte aux natures presentes
            });
            if (!sommePoids) return;
            const moyMatiere = Math.min(sommePonderee / sommePoids, 20);
            const coef = coefs[subjectId] || 1;
            totalPoints += moyMatiere * coef;
            totalCoef += coef;
        });
        return totalCoef > 0 ? (totalPoints / totalCoef) : null;
    }

    bulletins.forEach(function (b) {
        const id = b.eleve && b.eleve.id;
        if (!id) return;

        const donnees = parEleve[id] || {};
        const moyennes = [];

        [1, 2].forEach(function (t) {
            const m = moyenneTrimestre(donnees[t]);
            if (m != null) moyennes.push(m);
        });

        // Le 3e trimestre est deja calcule dans le bulletin courant.
        if (b.moyenne != null && b.moyenne > 0) moyennes.push(b.moyenne);

        b.moyennesTrimestres = moyennes;
        b.moyenneAnnuelle = moyennes.length
            ? moyennes.reduce((s, v) => s + v, 0) / moyennes.length
            : null;
    });
}

async function renderBulletinsPage(bulletins, classe, trimestre, nbMatieres) {
    // Les photos vivent dans un bucket PRIVE : leur URL doit etre signee.
    // createProfessionalBulletinHTML est synchrone — on pre-signe donc ici,
    // en parallele, plutot que de rendre toute la chaine asynchrone.
    try {
        await Promise.all((bulletins || []).map(async function (b) {
            if (b && b.eleve && b.eleve.photo_url) {
                b.eleve._photoAffichable = await urlPhotoEleve(b.eleve.photo_url);
            }
        }));
    } catch (e) { console.warn('Photos des bulletins :', e && e.message); }

    // ── MOYENNE ANNUELLE ────────────────────────────────────────────
    // La decision du conseil se prend en fin d'annee sur la moyenne des
    // TROIS trimestres. On ne la calcule donc qu'au 3e, et il faut aller
    // rechercher les notes des deux premiers.
    if (String(trimestre) === '3') {
        try {
            await calculerMoyennesAnnuelles(bulletins, classe.id);
        } catch (e) {
            console.warn('Moyennes annuelles :', e && e.message);
        }
    }

    const container = document.getElementById('bulletinsDetailContainer');
    if (!container) return;
    
    const trimestreLabels = {
        '1': 'Premier Trimestre',
        '2': 'Deuxième Trimestre', 
        '3': 'Troisième Trimestre'
    };
    
    const effectif = bulletins.length;
    const moyenneClasse = effectif > 0 ? bulletins.reduce((sum, b) => sum + b.moyenne, 0) / effectif : 0;
    const admis = bulletins.filter(b => b.moyenne >= 10).length;
    const rattrapage = bulletins.filter(b => b.moyenne >= 8 && b.moyenne < 10).length;
    const redouble = bulletins.filter(b => b.moyenne < 8).length;
    
    const meilleur = bulletins[0];
    window._bulletinsState = { bulletins, classe, trimestre };
    const dernier = bulletins[bulletins.length - 1];
    
    let html = `
        <div style="margin-bottom: 30px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 15px;">
                <div>
                    <h2 style="color: #5D4037; margin: 0; font-size: 1.5rem;">
                        <i class="fas fa-file-alt"></i> Bulletins - ${classe.nom}
                    </h2>
                    <p style="color: #666; margin: 5px 0; font-size: 0.95rem;">
                        ${trimestreLabels[trimestre]} • ${anneeDocument()} • ${nbMatieres} matières
                    </p>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button onclick="togglePublishBulletins('${classe.id}', '${trimestre}')" id="publishBtn" class="btn btn-primary" style="background:#10b981;">
                        <i class="fas fa-globe"></i> <span id="publishBtnLabel">Publier ce trimestre</span>
                    </button>
                    <button onclick="printAllBulletins()" class="btn btn-primary">
                        <i class="fas fa-print"></i> Imprimer tout
                    </button>
                    <button onclick="downloadAllBulletinsPDF()" class="btn btn-secondary">
                        <i class="fas fa-file-pdf"></i> Télécharger tout (PDF)
                    </button>
                    <button onclick="exportBulletinsToExcel()" class="btn btn-secondary">
                        <i class="fas fa-file-excel"></i> Excel
                    </button>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 25px;">
                <div style="background: linear-gradient(135deg, #5D4037 0%, #8D6E63 100%); color: white; padding: 15px; border-radius: 10px; text-align: center;">
                    <div style="font-size: 1.8rem; font-weight: 700;">${effectif}</div>
                    <div style="font-size: 0.85rem;">Élèves</div>
                </div>
                <div style="background: #f3f4f6; padding: 15px; border-radius: 10px; text-align: center; border-left: 4px solid #5D4037;">
                    <div style="font-size: 1.6rem; font-weight: 700; color: #5D4037;">${moyenneClasse.toFixed(2)}</div>
                    <div style="color: #666; font-size: 0.85rem;">Moy. classe</div>
                </div>
                <div style="background: #d1fae5; padding: 15px; border-radius: 10px; text-align: center; border-left: 4px solid #10b981;">
                    <div style="font-size: 1.6rem; font-weight: 700; color: #065f46;">${admis}</div>
                    <div style="color: #065f46; font-size: 0.85rem;">Admis</div>
                </div>
                <div style="background: #fef3c7; padding: 15px; border-radius: 10px; text-align: center; border-left: 4px solid #f59e0b;">
                    <div style="font-size: 1.6rem; font-weight: 700; color: #92400e;">${rattrapage}</div>
                    <div style="color: #92400e; font-size: 0.85rem;">Rattrapage</div>
                </div>
                <div style="background: #fee2e2; padding: 15px; border-radius: 10px; text-align: center; border-left: 4px solid #ef4444;">
                    <div style="font-size: 1.6rem; font-weight: 700; color: #991b1b;">${redouble}</div>
                    <div style="color: #991b1b; font-size: 0.85rem;">Redouble</div>
                </div>
            </div>
        </div>
        <div id="bulletinsList">
    `;
    
   bulletins.forEach(bulletin => {
    html += createProfessionalBulletinHTML(bulletin, classe, trimestreLabels[trimestre], effectif, moyenneClasse, trimestre);
});
    
    html += '</div>';
    container.innerHTML = html;

    // Mettre à jour le bouton de publication selon l'état actuel
    refreshPublishButton(classe.id, trimestre);
}

function createProfessionalBulletinHTML(bulletin, classe, trimestreLabel, effectifTotal, moyenneClasse, trimestre) {
    const eleve = bulletin.eleve;
    const fmt = n => (n == null || n === 0) ? '-' : n.toFixed(2);

    // ── DÉCISION DU CONSEIL DE CLASSE ────────────────────────────────
    // Elle ne se prend qu'en FIN D'ANNÉE, sur la moyenne ANNUELLE
    // (moyenne des trois trimestres), jamais sur un trimestre isolé.
    // Auparavant, chaque bulletin annonçait « ADMIS(E) » ou
    // « REDOUBLANT(E) » dès le premier trimestre : une famille pouvait
    // croire son enfant redoublant en décembre, alors que rien n'était joué.
    const estFinAnnee = String(trimestre) === '3';
    const moyAnnuelle = bulletin.moyenneAnnuelle;   // posée par renderBulletinsPage

    let decision = null;
    if (estFinAnnee && moyAnnuelle != null) {
        if (moyAnnuelle >= 10) {
            decision = { text: 'ADMIS(E)', color: '#065f46', bg: '#d1fae5', icon: 'fa-check-circle' };
        } else {
            decision = { text: 'REDOUBLANT(E)', color: '#991b1b', bg: '#fee2e2', icon: 'fa-times-circle' };
        }
    }
 
    let matieresRows = '';
    let hasNotes = false;
 
    bulletin.matieres.forEach((m, index) => {
        if (m.moyenne > 0) hasNotes = true;
 
        const moyenneStyle = m.moyenne >= 10
            ? 'color: #10b981; font-weight: 700;'
            : (m.moyenne > 0 ? 'color: #ef4444; font-weight: 700;' : 'color: #9ca3af;');
 
        const rowBg = index % 2 === 0 ? 'background: #fff;' : 'background: #f9fafb;';
 
        matieresRows += `
            <tr style="${rowBg}">
                <td style="padding: 10px 12px; border: 1px solid #e5e7eb; text-align: left;">
                    <div style="font-weight: 600; color: #374151;">${m.nom}</div>
                    <div style="font-size: 0.75rem; color: #6b7280; margin-top: 2px;">
                        <i class="fas fa-chalkboard-teacher"></i> ${m.professeur}
                    </div>
                </td>
                <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: center;">${fmt(m.noteClasse)}</td>
                <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: center;">${fmt(m.compo)}</td>
                <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: center; font-weight: 600;">${m.coefficient}</td>
                <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: center; ${moyenneStyle} font-size: 1.1rem;">
                    ${fmt(m.moyenne)}
                </td>
                <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: center; font-weight: 700; color: #5D4037;">
                    ${m.moyenne > 0 ? m.total.toFixed(2) : '-'}
                </td>
                <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: center; font-size: 0.85rem; color: #6b7280;">
                    ${m.moyenne > 0 ? m.appreciation : '-'}
                </td>
            </tr>
        `;
    });
 
    const noNotesWarning = !hasNotes ? `
        <div style="background: #fef3c7; border: 2px dashed #f59e0b; border-radius: 8px; padding: 20px; margin: 20px; text-align: center;">
            <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: #f59e0b; margin-bottom: 10px;"></i>
            <p style="margin: 0; color: #92400e; font-weight: 500;">Aucune note n'a été saisie pour cet élève ce trimestre</p>
            <p style="margin: 5px 0 0 0; color: #a16207; font-size: 0.9rem;">Rendez-vous dans la section "Notes" pour saisir les notes</p>
        </div>
    ` : '';
 
    // _photoAffichable est l'URL signee posee par renderBulletinsPage.
    // Sans elle, on retombe sur les initiales plutot qu'une image cassee.
    const photoHtml = eleve._photoAffichable
        ? `<img src="${eleve._photoAffichable}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:4px solid white;box-shadow:0 4px 6px rgba(0,0,0,0.1);" alt="Photo">`
        : `<div style="width: 80px; height: 80px; background: linear-gradient(135deg, #5D4037 0%, #8D6E63 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 1.8rem; font-weight: 700; border: 4px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">${eleve.first_name?.[0] || ''}${eleve.last_name?.[0] || ''}</div>`;
 
    return `
        <div id="bulletin-${eleve.id}" class="bulletin-card" style="background: white; border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 30px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.07); page-break-inside: avoid;">
            <div style="background: linear-gradient(135deg, #5D4037 0%, #8D6E63 100%); color: white; padding: 25px 20px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 1.4rem; font-weight: 700;">🏫 EPMK</h3>
                    <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 0.85rem;">École Privée Moussa Koné</p>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 1.1rem; font-weight: 600;">BULLETIN DE NOTES</div>
                    <div style="font-size: 0.9rem; opacity: 0.9;">${trimestreLabel}</div>
                    <div style="font-size: 0.8rem; opacity: 0.8; margin-top: 2px;">Année ${anneeDocument()}</div>
                </div>
            </div>
 
            <div style="padding: 20px; background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%); border-bottom: 2px solid #e5e7eb;">
                <div style="display: grid; grid-template-columns: auto 1fr auto auto; gap: 20px; align-items: center;">
                    ${photoHtml}
                    <div>
                        <h4 style="margin: 0 0 8px 0; font-size: 1.3rem; color: #1f2937;">
                            ${eleve.last_name?.toUpperCase() || ''} ${eleve.first_name || ''}
                        </h4>
                        <div style="display: flex; gap: 15px; flex-wrap: wrap; font-size: 0.9rem; color: #6b7280;">
                            <span><i class="fas fa-graduation-cap" style="color: #5D4037;"></i> <strong>${classe.nom}</strong></span>
                            <span><i class="fas fa-id-card" style="color: #5D4037;"></i> ${eleve.matricule || 'Non matriculé'}</span>
                        </div>
                    </div>
                    <div style="text-align: center; background: white; padding: 15px 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <div style="font-size: 0.8rem; color: #6b7280; text-transform: uppercase;">Moy. classe</div>
                        <div style="font-size: 1.8rem; font-weight: 800; color: #5D4037; line-height: 1;">${moyenneClasse.toFixed(2)}</div>
                        <div style="font-size: 0.85rem; color: #9ca3af;">/ 20</div>
                    </div>
                    <div style="text-align: center; background: white; padding: 15px 25px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <div style="font-size: 0.8rem; color: #6b7280; text-transform: uppercase;">Rang</div>
                        <div style="font-size: 2.5rem; font-weight: 800; color: #5D4037; line-height: 1;">${bulletin.rang}</div>
                        <div style="font-size: 0.85rem; color: #9ca3af;">sur ${effectifTotal}</div>
                    </div>
                </div>
            </div>
 
            ${noNotesWarning}
 
            <div style="padding: 20px; overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; border: 2px solid #5D4037;">
                    <thead>
                        <tr style="background: #5D4037; color: white;">
                            <th style="padding: 12px; text-align: left;">Matière / Professeur</th>
                            <th style="padding: 12px; text-align: center;">Note classe</th>
                            <th style="padding: 12px; text-align: center;">Composition</th>
                            <th style="padding: 12px; text-align: center;">Coef</th>
                            <th style="padding: 12px; text-align: center;">Moyenne</th>
                            <th style="padding: 12px; text-align: center;">Total</th>
                            <th style="padding: 12px; text-align: center;">Appréciation</th>
                        </tr>
                    </thead>
                    <tbody>${matieresRows}</tbody>
                    <tfoot>
                        <tr style="background: #f3f4f6; font-weight: 700; border-top: 2px solid #5D4037;">
                            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;" colspan="3">TOTAL</td>
                            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center; font-size: 1.1rem;">${bulletin.totalCoef}</td>
                            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;">-</td>
                            <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center; font-size: 1.1rem; color: #5D4037;">${bulletin.totalPoints.toFixed(2)}</td>
                            <td style="padding: 12px; border: 1px solid #e5e7eb;"></td>
                        </tr>
                        <tr style="background: linear-gradient(135deg, #5D4037 0%, #8D6E63 100%); color: white;">
                            <td colspan="4" style="padding: 15px; font-weight: 700; font-size: 1.1rem;">
                                <i class="fas fa-calculator"></i> MOYENNE GÉNÉRALE
                            </td>
                            <td colspan="3" style="padding: 15px; text-align: center; font-weight: 800; font-size: 1.6rem;">
                                ${bulletin.moyenne.toFixed(2)} <span style="font-size: 0.9rem; opacity: 0.8;">/ 20</span>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
 
            <div style="padding: 20px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        ${decision ? `
                        <h5 style="margin: 0 0 12px 0; color: #374151; font-size: 0.95rem;">
                            <i class="fas fa-gavel"></i> Décision du Conseil de Classe
                        </h5>
                        <div style="padding: 15px; background: ${decision.bg}; color: ${decision.color}; border-radius: 8px; border-left: 5px solid ${decision.color}; font-weight: 700; font-size: 1.1rem; display: flex; align-items: center; gap: 10px;">
                            <i class="fas ${decision.icon}" style="font-size: 1.3rem;"></i>
                            ${decision.text}
                        </div>
                        <p style="margin: 10px 0 0 0; color: #6b7280; font-size: 0.85rem;">
                            Moyenne annuelle : <strong>${moyAnnuelle.toFixed(2)} / 20</strong>
                            <span style="color:#9ca3af;"> (moyenne des trois trimestres)</span>
                        </p>` : `
                        <h5 style="margin: 0 0 12px 0; color: #374151; font-size: 0.95rem;">
                            <i class="fas fa-comment-dots"></i> Appréciation générale
                        </h5>
                        <div style="padding: 15px; background: #f3f4f6; color: #374151; border-radius: 8px; border-left: 5px solid #9ca3af; font-weight: 600; font-size: 1.05rem;">
                            ${getAppreciationText(bulletin.moyenne)}
                        </div>
                        <p style="margin: 10px 0 0 0; color: #6b7280; font-size: 0.85rem; font-style: italic;">
                            La décision du conseil de classe est prise en fin d'année,
                            sur la moyenne des trois trimestres.
                        </p>`}
                    </div>
                    <div>
                        <h5 style="margin: 0 0 12px 0; color: #374151; font-size: 0.95rem;">
                            <i class="fas fa-signature"></i> Signatures
                        </h5>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div style="text-align: center; padding: 15px; background: white; border-radius: 8px; border: 1px dashed #d1d5db;">
                                <div style="height: 50px; border-bottom: 1px solid #9ca3af; margin-bottom: 8px;"></div>
                                <div style="font-size: 0.8rem; color: #6b7280;">Le Directeur</div>
                            </div>
                            <div style="text-align: center; padding: 15px; background: white; border-radius: 8px; border: 1px dashed #d1d5db;">
                                <div style="height: 50px; border-bottom: 1px solid #9ca3af; margin-bottom: 8px;"></div>
                                <div style="font-size: 0.8rem; color: #6b7280;">Prof. Principal</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
 
            <div style="padding: 15px 20px; background: white; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 0.8rem; color: #9ca3af;">
                    <i class="fas fa-info-circle"></i> Document généré le ${new Date().toLocaleDateString('fr-FR')}
                </div>
                <button onclick="printSingleBulletin('${eleve.id}')" class="btn btn-primary" style="padding: 8px 20px;">
                    <i class="fas fa-print"></i> Imprimer
                </button>
                <button onclick="downloadSingleBulletinPDF('${eleve.id}')" class="btn btn-secondary" style="padding: 8px 20px; margin-right: 8px;">
                    <i class="fas fa-file-pdf"></i> Télécharger PDF
                </button>
            </div>
        </div>
    `;
}

 
/* -------------------------------------------------------------
   5) NOUVELLES FONCTIONS — à ajouter n'importe où après
   createProfessionalBulletinHTML (ex : juste avant
   getAppreciationText). Génère un PDF par élève, prêt pour clé
   USB, réutilise le même ajusteur "une seule page A4".
-------------------------------------------------------------- */
window.downloadSingleBulletinPDF = async function(eleveId) {
    const card = document.getElementById(`bulletin-${eleveId}`);
    if (!card) return;
    if (typeof html2pdf === 'undefined') {
        showToast('Bibliothèque PDF non chargée (vérifier html2pdf.js dans Admin.html)', 'error');
        return;
    }
 
    const state = window._bulletinsState || {};
    const found = (state.bulletins || []).find(b => String(b.eleve.id) === String(eleveId));
    const eleve = found ? found.eleve : {};
 
    // Cloner la carte (sans ses boutons) à sa taille NATURELLE.
    // IMPORTANT : pas de transform:scale() ici — html2canvas rend très mal
    // les éléments transformés (texte chevauché, colonnes coupées). On
    // capture toujours à taille réelle, et on réduira l'IMAGE obtenue
    // (pas le DOM) si besoin, ce qui ne déforme jamais le texte.
    const clone = card.cloneNode(true);
    clone.querySelectorAll('button').forEach(btn => btn.remove());
    clone.style.transform = 'none';
    clone.style.width = '210mm';

    // Tableau en largeur fixe : sans cela, le navigateur repartit les colonnes
    // selon leur contenu et le tableau peut deborder des 210mm du clone.
    const table = clone.querySelector('table');
if (table) {
    table.style.tableLayout = 'fixed';
    table.style.width = '100%';
    // Répartition des colonnes (ajuste les % si besoin)
    const colWidths = ['28%', '11%', '11%', '7%', '11%', '11%', '21%'];
    table.querySelectorAll('tr').forEach(row => {
        Array.from(row.children).forEach((cell, i) => {
            if (colWidths[i]) cell.style.width = colWidths[i];
        });
    });
    table.querySelectorAll('th, td').forEach(cell => {
        cell.style.wordBreak = 'break-word';
        cell.style.overflowWrap = 'break-word';
        cell.style.whiteSpace = 'normal';
    });
}

// Neutraliser le scroll horizontal du conteneur parent (pensé pour l'écran, pas pour la capture)
clone.querySelectorAll('[style*="overflow-x"]').forEach(el => {
    el.style.overflowX = 'visible';
});
    // On memorise la position de defilement : la capture exige d'etre en haut
    // de page, on la restituera ensuite.
    const scrollAvant = { x: window.scrollX, y: window.scrollY };

    const wrapper = document.createElement('div');
    // Ne PAS utiliser left:-9999px — html2canvas ne capture que la zone
    // de la fenêtre visible ; un élément hors-écran donne un PDF blanc.
    wrapper.style.cssText = 'position:absolute; top:0; left:0; width:210mm; background:#fff; opacity:0; pointer-events:none; z-index:-1;';
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    // ── ANCRAGE A L'ORIGINE ──────────────────────────────────────────
    // `position:absolute; left:0` se resout contre le plus proche ancetre
    // POSITIONNE, pas contre le document. Dans la mise en page admin (barre
    // laterale), le clone se retrouvait donc a x = 260px environ, et le
    // cadrage de la capture tombait a cote : bulletin coupe.
    // On mesure la position obtenue et on la corrige, au lieu de la supposer.
    window.scrollTo(0, 0);
    const pos = wrapper.getBoundingClientRect();
    if (pos.left !== 0 || pos.top !== 0) {
        wrapper.style.left = (-pos.left) + 'px';
        wrapper.style.top  = (-pos.top) + 'px';
    }
 
    // Resserrer les paddings du tableau et des sections — réduit la
    // hauteur réelle du contenu, pour tenir sur une page À PLEINE LARGEUR
    // sans avoir à rétrécir l'image ensuite (ce qui laisserait des marges
    // blanches sur les côtés). Fait une fois le clone attaché au DOM, pour
    // que getComputedStyle donne des valeurs fiables.
    clone.querySelectorAll('table th, table td').forEach(cell => {
        cell.style.padding = '5px 8px';
    });
    clone.querySelectorAll(':scope > div').forEach(sec => {
        const cs = window.getComputedStyle(sec);
        if (parseInt(cs.paddingTop) > 14) sec.style.paddingTop = '12px';
        if (parseInt(cs.paddingBottom) > 14) sec.style.paddingBottom = '12px';
    });
 
    
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
 
    const clean = t => (t || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const fileName = `Bulletin_${clean(eleve.last_name)}_${clean(eleve.first_name)}_T${state.trimestre || ''}_${anneeDocument()}.pdf`;

    // Re-verification de l'ancrage APRES stabilisation de la mise en page :
    // les ajustements de padding ci-dessus ont pu la faire bouger. On mesure
    // une derniere fois, juste avant la capture.
    const posFinale = wrapper.getBoundingClientRect();
    if (Math.abs(posFinale.left) > 0.5 || Math.abs(posFinale.top) > 0.5) {
        wrapper.style.left = (parseFloat(wrapper.style.left || 0) - posFinale.left) + 'px';
        wrapper.style.top  = (parseFloat(wrapper.style.top  || 0) - posFinale.top)  + 'px';
    }

    // Largeur reelle du clone une fois pose dans le DOM (210mm ~ 794px).
    // Mesuree, et non supposee : si une regle CSS la contraint, on le saura.
    const largeurCapture = clone.offsetWidth || 794;
    console.log('PDF bulletin - ancrage:', wrapper.getBoundingClientRect().left,
                wrapper.getBoundingClientRect().top, '| largeur:', largeurCapture);
 
    try {
        // On passe UNIQUEMENT par l'API officielle de html2pdf (toCanvas /
        // toPdf / get) — pas besoin de window.html2canvas ni window.jspdf,
        // qui ne sont pas exposés globalement par ce bundle.
        const worker = html2pdf().set({
            filename: fileName,
            image: { type: 'jpeg', quality: 0.98 },
            // Le clone a ete ANCRE a l'origine du document juste au-dessus :
            // x:0 / y:0 / scrollX:0 / scrollY:0 sont donc exacts, et le cadrage
            // tombe pile sur le bulletin.
            //
            // On ne touche PAS a windowWidth : le forcer redispose la mise en
            // page admin dans une fenetre virtuelle plus etroite, et le clone ne
            // se retrouve plus a la position ou ses bornes ont ete mesurees
            // (c'est ce qui coupait le bulletin a gauche).
            html2canvas: {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                x: 0,
                y: 0,
                scrollX: 0,
                scrollY: 0,
                width: largeurCapture,
                height: clone.offsetHeight
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(clone);
 
        // 1) Récupérer le canvas rendu (taille naturelle, non déformé)
        await worker.toCanvas();
        const canvas = await worker.get('canvas');
 
        // 2) Récupérer l'instance jsPDF interne créée par html2pdf
        await worker.toPdf();
        const pdf = await worker.get('pdf');
 
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 6;
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - margin * 2;
 
        // Dimensions au ratio naturel du canvas capturé
        let imgWidth = maxWidth;
        let imgHeight = (canvas.height * imgWidth) / canvas.width;
 
        // Si ça dépasse la hauteur d'une page, réduire l'image
        // PROPORTIONNELLEMENT (largeur ET hauteur) — donc pas de déformation
        if (imgHeight > maxHeight) {
            const ratio = maxHeight / imgHeight;
            imgHeight = maxHeight;
            imgWidth = imgWidth * ratio;
        }
 
        const xPos = margin + (maxWidth - imgWidth) / 2; // centré horizontalement
        const yPos = margin;
 
        // 3) html2pdf a pu répartir son rendu par défaut sur plusieurs
        // pages — on repart d'une page unique et vierge, et on n'y met
        // que NOTRE image, à l'échelle calculée ci-dessus
        while (pdf.internal.getNumberOfPages() > 1) {
            pdf.deletePage(pdf.internal.getNumberOfPages());
        }
        pdf.setPage(1);
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
 
        const imgData = canvas.toDataURL('image/jpeg', 0.98);
        pdf.addImage(imgData, 'JPEG', xPos, yPos, imgWidth, imgHeight);
 
        pdf.save(fileName);
    } catch (e) {
        console.error('❌ Erreur génération PDF:', e);
        showToast('Erreur lors de la génération du PDF', 'error');
    } finally {
        document.body.removeChild(wrapper);
        // Rendre a l'utilisateur la position de defilement qu'il avait.
        window.scrollTo(scrollAvant.x, scrollAvant.y);
    }
};
 
// Télécharge un PDF par élève de la classe, l'un après l'autre
window.downloadAllBulletinsPDF = async function() {
    const state = window._bulletinsState || {};
    const bulletins = state.bulletins || [];
    if (!bulletins.length) return showToast('Aucun bulletin à télécharger', 'error');
    if (typeof html2pdf === 'undefined') return showToast('Bibliothèque PDF non chargée', 'error');
 
    showToast(`Génération de ${bulletins.length} PDF...`, 'info');
    for (const b of bulletins) {
        await window.downloadSingleBulletinPDF(b.eleve.id);
    }
    showToast('Tous les bulletins ont été téléchargés', 'success');
};

// Compresse verticalement un clone (paddings/marges/polices) jusqu'à ce
// qu'il tienne dans maxHeightMm, sans jamais toucher à sa largeur.
async function fitCloneHeight(clone, maxHeightMm) {
    const MM_TO_PX = 96 / 25.4;
    const maxHeightPx = maxHeightMm * MM_TO_PX;

    // Mémorise les valeurs ORIGINALES une seule fois (évite la compression cumulative)
    const els = Array.from(clone.querySelectorAll('*'));
    const original = els.map(el => {
        const cs = window.getComputedStyle(el);
        return {
            el,
            fontSize: parseFloat(cs.fontSize) || 0,
            padTop: parseFloat(cs.paddingTop) || 0,
            padBottom: parseFloat(cs.paddingBottom) || 0,
            marginTop: parseFloat(cs.marginTop) || 0,
            marginBottom: parseFloat(cs.marginBottom) || 0,
            lineHeight: parseFloat(cs.lineHeight) || 0
        };
    });

    let factor = 1;
    for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise(r => requestAnimationFrame(r));
        if (clone.scrollHeight <= maxHeightPx) break;

        // Réduit le facteur par petits pas, jamais en dessous de 0.55 (lisibilité)
        factor = Math.max(factor * 0.92, 0.55);

        original.forEach(o => {
            if (o.fontSize) o.el.style.fontSize = (o.fontSize * factor) + 'px';
            if (o.padTop) o.el.style.paddingTop = (o.padTop * factor) + 'px';
            if (o.padBottom) o.el.style.paddingBottom = (o.padBottom * factor) + 'px';
            if (o.marginTop) o.el.style.marginTop = (o.marginTop * factor) + 'px';
            if (o.marginBottom) o.el.style.marginBottom = (o.marginBottom * factor) + 'px';
            if (o.lineHeight) o.el.style.lineHeight = (o.lineHeight * factor) + 'px';
        });
    }
    return factor;
}

function getAppreciationText(moyenne) {
    if (moyenne === 0) return 'Non évalué';
    if (moyenne >= 18) return 'Excellent travail';
    if (moyenne >= 16) return 'Très bien';
    if (moyenne >= 14) return 'Bien';
    if (moyenne >= 12) return 'Assez bien';
    if (moyenne >= 10) return 'Passable';
    if (moyenne >= 8) return 'Insuffisant - Efforts à fournir';
    if (moyenne >= 6) return 'Faible - Rattrapage nécessaire';
    return 'Très faible - Travail sérieux requis';
}

window.printSingleBulletin = function(eleveId) {
    const bulletin = document.getElementById(`bulletin-${eleveId}`);
    if (!bulletin) return;
    // Cloner la carte et retirer son propre bouton "Imprimer" (inutile/non
    // fonctionnel dans la fenêtre d'impression, qui a déjà le sien)
    const clone = bulletin.cloneNode(true);
    clone.querySelectorAll('button').forEach(btn => btn.remove());
    const _htmlImpression_ = (`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Bulletin</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
            <style>
                @page { size: A4 portrait; margin: 8mm; }
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Inter', sans-serif; font-size: 10pt; }
                /* Zone imprimable = 210mm - 8mm (gauche) - 8mm (droite) = 194mm.
                   Déclarer 210mm ici plaçait 16mm du bulletin HORS de la page :
                   le bord droit était coupé à l'impression. */
                .print-page { width: 194mm; height: 281mm; overflow: hidden; position: relative; }
                .print-page .bulletin-card { transform-origin: top left; }
                @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } .no-print { display: none !important; } }
            </style>
        </head>
        <body>
            <div class="print-page">${clone.outerHTML}</div>
            <div class="no-print" style="text-align: center; padding: 20px;">
                <button onclick="window.print()" style="background: #5D4037; color: white; padding: 12px 30px; border: none; border-radius: 6px; cursor: pointer;">Imprimer</button>
            </div>
            <script>
                window.addEventListener('load', function () {
                    setTimeout(function () {
                        const MM_TO_PX = 96 / 25.4;
                        const pageHeightPx = 281 * MM_TO_PX;
                        const card = document.querySelector('.print-page .bulletin-card');
                        if (!card) return;
                        card.style.transform = 'none';
                        card.style.width = '100%';
                        const naturalHeight = card.offsetHeight;
                        if (naturalHeight > pageHeightPx) {
                            const scale = pageHeightPx / naturalHeight;
                            card.style.transform = 'scale(' + scale + ')';
                            card.style.width = (100 / scale) + '%';
                        }
                    }, 150);
                });
            </script>
        </body>
        </html>
    `);
    ouvrirImpression(_htmlImpression_);
};
 
window.printAllBulletins = function() {
    const container = document.getElementById('bulletinsList');
    const bulletins = container?.querySelectorAll('.bulletin-card');
    if (!bulletins?.length) return showToast('Aucun bulletin à imprimer', 'error');
    let content = '';
    bulletins.forEach((b) => {
        const clone = b.cloneNode(true);
        clone.querySelectorAll('button').forEach(btn => btn.remove());
        content += `<div class="print-page">${clone.outerHTML}</div>`;
    });
 
    const _htmlImpression_ = (`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                @page { size: A4 portrait; margin: 8mm; }
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Inter', sans-serif; font-size: 10pt; }
                /* Même correction que pour l'impression individuelle : 194mm,
                   et non 210mm, sinon 16mm débordent hors de la zone imprimable. */
                .print-page { width: 194mm; height: 281mm; overflow: hidden; position: relative; page-break-after: always; }
                .print-page:last-child { page-break-after: auto; }
                .print-page .bulletin-card { transform-origin: top left; }
                @media print { .no-print { display: none !important; } }
            </style>
        </head>
        <body>${content}<div class="no-print" style="text-align: center; padding: 20px;"><button onclick="window.print()">Imprimer ${bulletins.length} bulletins</button></div>
            <script>
                window.addEventListener('load', function () {
                    setTimeout(function () {
                        const MM_TO_PX = 96 / 25.4;
                        const pageHeightPx = 281 * MM_TO_PX;
                        document.querySelectorAll('.print-page').forEach(function (page) {
                            const card = page.querySelector('.bulletin-card');
                            if (!card) return;
                            card.style.transform = 'none';
                            card.style.width = '100%';
                            const naturalHeight = card.offsetHeight;
                            if (naturalHeight > pageHeightPx) {
                                const scale = pageHeightPx / naturalHeight;
                                card.style.transform = 'scale(' + scale + ')';
                                card.style.width = (100 / scale) + '%';
                            }
                        });
                    }, 150);
                });
            </script>
        </body>
        </html>
    `);
    ouvrirImpression(_htmlImpression_);
};
 
 



window.exportBulletinsToExcel = function() {
    // Implémentation de l'export CSV
    showToast('Export en cours...', 'info');
};
// Placeholders pour les autres fonctions
async function initEmploiPage() { 
    await loadEmploiPage();
}


// ============================================
// SECTION PRÉSENCES - FONCTIONS COMPLÈTES
// ============================================

/**
 * Initialise la page des présences
 */
async function initPresencesPage() {
    console.log('📋 Initialisation page présences...');
    
    // Définir la date d'aujourd'hui par défaut
    const dateInput = document.getElementById('presenceDate');
    if (dateInput) {
        dateInput.valueAsDate = new Date();
    }
    
    // Charger les classes dans le select
    await loadClassesForPresenceSelect();

    // Charger les demandes de justification en attente
    await loadJustificationRequests();
}

/**
 * Charge les classes dans le select de présences
 */
async function loadClassesForPresenceSelect() {
    const select = document.getElementById('presenceClasse');
    if (!select) return;
    
    try {
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('id, nom')
            .order('nom');
        
        if (error) throw error;
        
        const currentValue = select.value;
        select.innerHTML = '<option value="">Choisir une classe...</option>';
        
        classes?.forEach(c => {
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.nom;
            select.appendChild(option);
        });
        
        select.value = currentValue;
        
    } catch (error) {
        console.error('❌ Erreur chargement classes:', error);
    }
}

/**
 * Charge la liste des élèves pour la feuille de présence
 */
window.loadPresenceList = async function() {
    console.log('📋 Chargement liste de présence...');
    
    const classeId = document.getElementById('presenceClasse')?.value;
    const dateStr = document.getElementById('presenceDate')?.value;
    
    if (!classeId) {
        showToast('Veuillez sélectionner une classe', 'error');
        return;
    }
    
    if (!dateStr) {
        showToast('Veuillez sélectionner une date', 'error');
        return;
    }
    
    const tbody = document.getElementById('presencesTableBody');
    const titleEl = document.getElementById('presenceTitle');
    
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #8D6E63; margin-bottom: 15px; display: block;"></i>
                    Chargement des élèves...
                </td>
            </tr>
        `;
    }
    
    try {
        // 1. Récupérer les infos de la classe
        const { data: classe, error: classeError } = await supabaseClient
            .from('classes')
            .select('nom')
            .eq('id', classeId)
            .single();
        
        if (classeError) throw classeError;
        
        // Mettre à jour le titre
        if (titleEl) {
            const dateFormatted = new Date(dateStr).toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
            titleEl.textContent = `${classe.nom} - ${dateFormatted}`;
        }
        
        // 2. Récupérer les élèves actifs de la classe
        const { data: eleves, error: elevesError } = await supabaseClient
            .from('students')
            .select('id, first_name, last_name, matricule')
            .eq('class_id', classeId)
            .eq('status', 'actif')
            .order('last_name');
        
        if (elevesError) throw elevesError;
        
        if (!eleves || eleves.length === 0) {
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 40px; color: #666;">
                            <i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 15px; color: #f59e0b;"></i>
                            <p>Aucun élève actif dans cette classe</p>
                        </td>
                    </tr>
                `;
            }
            return;
        }
        
        // 3. Récupérer les présences existantes pour cette date et cette classe
        // Recherche par élèves (et non par classe) : ainsi, un élève qui a
        // changé de classe retrouve son enregistrement du jour au lieu d'en
        // créer un doublon — c'était la cause des présences « fantômes ».
        const { data: existingPresences, error: presencesError } = await supabaseClient
            .from('presences')
            .select('*')
            .in('student_id', (eleves || []).map(e => e.id))
            .eq('date', dateStr);
        
        if (presencesError) throw presencesError;
        
        // Créer un map des présences existantes
        const presencesMap = {};
        existingPresences?.forEach(p => {
            presencesMap[p.student_id] = p;
        });
        
        console.log(`✅ ${eleves.length} élève(s) chargé(s), ${existingPresences?.length || 0} présence(s) existante(s)`);
        
        // 4. Afficher les élèves avec leurs présences
        if (tbody) {
            tbody.innerHTML = eleves.map((eleve, index) => {
                const presence = presencesMap[eleve.id];
                const status = presence?.status || 'present'; // Par défaut présent
                
                const isPresent = status === 'present' ? 'checked' : '';
                const isAbsent = status === 'absent' ? 'checked' : '';
                const isLate = status === 'late' ? 'checked' : '';
                const justification = presence?.justification || '';
                
                return `
                <tr data-student-id="${eleve.id}" data-presence-id="${presence?.id || ''}">
                    <td style="text-align: center;">${index + 1}</td>
                    <td>
                        <strong>${eleve.last_name} ${eleve.first_name}</strong>
                        <br><small style="color: #666;">${eleve.matricule || '-'}</small>
                    </td>
                    <td style="text-align: center;">
                        <input type="radio" name="status_${eleve.id}" value="present" ${isPresent} 
                               onchange="updatePresenceStyle(this)" 
                               style="width: 20px; height: 20px; cursor: pointer;">
                    </td>
                    <td style="text-align: center;">
                        <input type="radio" name="status_${eleve.id}" value="absent" ${isAbsent} 
                               onchange="updatePresenceStyle(this)"
                               style="width: 20px; height: 20px; cursor: pointer;">
                    </td>
                    <td style="text-align: center;">
                        <input type="radio" name="status_${eleve.id}" value="late" ${isLate} 
                               onchange="updatePresenceStyle(this)"
                               style="width: 20px; height: 20px; cursor: pointer;">
                    </td>
                    <td>
                        <input type="text" class="form-control justification-input" 
                               value="${justification}" placeholder="Justification (si absent/retard)"
                               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </td>
                </tr>
                `;
            }).join('');
        }
        
        // Appliquer les styles initiaux
        setTimeout(() => {
            document.querySelectorAll('#presencesTableBody input[type=\"radio\"]:checked').forEach(radio => {
                updatePresenceStyle(radio);
            });
        }, 100);
        
    } catch (error) {
        console.error('❌ Erreur chargement présences:', error);
        showToast('Erreur chargement des données: ' + error.message, 'error');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 40px; color: #ef4444;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 15px;"></i>
                        <p>Erreur de chargement</p>
                    </td>
                </tr>
            `;
        }
    }
};

/**
 * Met à jour le style visuel de la ligne selon le statut
 */
window.updatePresenceStyle = function(radio) {
    const row = radio.closest('tr');
    if (!row) return;
    
    const status = radio.value;
    
    // Réinitialiser les styles
    row.style.backgroundColor = '';
    row.style.borderLeft = '';
    
    // Appliquer le style selon le statut
    switch(status) {
        case 'present':
            row.style.backgroundColor = '#f0fdf4'; // Vert clair
            row.style.borderLeft = '4px solid #10b981';
            break;
        case 'absent':
            row.style.backgroundColor = '#fee2e2'; // Rouge clair
            row.style.borderLeft = '4px solid #ef4444';
            break;
        case 'late':
            row.style.backgroundColor = '#fef3c7'; // Orange clair
            row.style.borderLeft = '4px solid #f59e0b';
            break;
    }
};

/**
 * Sauvegarde toutes les présences
 */
window.savePresences = async function() {
    console.log('💾 Sauvegarde des présences...');
    
    const classeId = document.getElementById('presenceClasse')?.value;
    const dateStr = document.getElementById('presenceDate')?.value;
    
    if (!classeId || !dateStr) {
        showToast('Veuillez sélectionner une classe et une date', 'error');
        return;
    }
    
    const rows = document.querySelectorAll('#presencesTableBody tr');
    if (rows.length === 0) {
        showToast('Aucune donnée à sauvegarder', 'error');
        return;
    }
    
    const presencesToSave = [];
    const presencesToUpdate = [];
    
    rows.forEach(row => {
        const studentId = row.dataset.studentId;
        const presenceId = row.dataset.presenceId;
        
        if (!studentId) return;
        
        // Récupérer le statut sélectionné
        const radio = row.querySelector(`input[name=\"status_${studentId}\"]:checked`);
        const status = radio?.value || 'present';
        
        // Récupérer la justification
        const justificationInput = row.querySelector('.justification-input');
        const justification = justificationInput?.value?.trim() || null;
        
        const presenceData = {
            student_id: studentId,
            class_id: classeId,
            date: dateStr,
            status: status,
            justification: justification,
            updated_at: new Date().toISOString()
        };
        
        if (presenceId) {
            // Mise à jour
            presencesToUpdate.push({
                id: presenceId,
                ...presenceData
            });
        } else {
            // Nouvelle présence
            presencesToSave.push({
                ...presenceData,
                created_at: new Date().toISOString()
            });
        }
    });
    
    if (presencesToSave.length === 0 && presencesToUpdate.length === 0) {
        showToast('Aucune modification à sauvegarder', 'info');
        return;
    }
    
    // Afficher loading
    const saveBtn = document.querySelector('button[onclick=\"savePresences()\"]');
    const originalText = saveBtn?.innerHTML;
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class=\"fas fa-spinner fa-spin\"></i> Sauvegarde...';
    }
    
    try {
        // Insérer les nouvelles présences
        if (presencesToSave.length > 0) {
            const { data, error } = await supabaseClient
                .from('presences')
                .insert(presencesToSave)
                .select();
            
            if (error) throw error;
            
            // Mettre à jour les IDs dans le DOM
            data?.forEach((presence, index) => {
                const row = document.querySelector(`tr[data-student-id=\"${presence.student_id}\"]`);
                if (row) row.dataset.presenceId = presence.id;
            });
            
            console.log(`✅ ${data?.length || 0} présence(s) créée(s)`);
        }
        
        // Mettre à jour les présences existantes
        for (const presence of presencesToUpdate) {
            const { error } = await supabaseClient
                .from('presences')
                .update({
                    status: presence.status,
                    justification: presence.justification,
                    class_id: presence.class_id,   // suit la classe actuelle de l'élève
                    updated_at: presence.updated_at
                })
                .eq('id', presence.id);
            
            if (error) throw error;
        }
        
        console.log(`✅ ${presencesToUpdate.length} présence(s) mise(s) à jour`);
        
        showToast('Présences enregistrées avec succès !', 'success');
        
        // Recharger pour afficher les IDs mis à jour
        await loadPresenceList();
        
    } catch (error) {
        console.error('❌ Erreur sauvegarde présences:', error);
        showToast('Erreur lors de la sauvegarde: ' + error.message, 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalText || '<i class=\"fas fa-save\"></i> Enregistrer';
        }
    }
};

/**
 * Génère un rapport de présences pour une période
 */
window.generatePresenceReport = async function() {
    console.log('📊 Génération rapport de présences...');
    
    const classeId = document.getElementById('presenceClasse')?.value;
    if (!classeId) {
        showToast('Veuillez sélectionner une classe', 'error');
        return;
    }
    
    // TODO: Implémenter la génération de rapport PDF/Excel
    showToast('Fonctionnalité de rapport en développement', 'info');
};

// ============================================
// EXPOSITION GLOBALE
// ============================================

window.loadPresenceList = loadPresenceList;
window.savePresences = savePresences;
window.updatePresenceStyle = updatePresenceStyle;
window.generatePresenceReport = generatePresenceReport;
// ============================================
// SECTION PAIEMENTS - FONCTIONS COMPLÈTES
// ============================================

/**
 * Initialise la page des paiements
 */
async function loadPaiements() {
    console.log('💰 Chargement des paiements...');
    
    try {
        // Charger les classes dans le filtre
        await loadClassesForPaymentFilter();
        
        // Charger les paiements du mois en cours
        await loadPaymentsList();
        
        // Mettre à jour les statistiques
        await updatePaymentStats();
        
    } catch (error) {
        console.error('❌ Erreur initialisation paiements:', error);
    }
}

/**
 * Charge les classes dans le select de filtre
 */
async function loadClassesForPaymentFilter() {
    const select = document.getElementById('paymentClasse');
    if (!select) return;
    
    try {
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('id, nom')
            .order('nom');
        
        if (error) throw error;
        
        const currentValue = select.value;
        select.innerHTML = '<option value="">Choisir une classe...</option>';
        
        classes?.forEach(c => {
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.nom;
            select.appendChild(option);
        });
        
        select.value = currentValue;
        
    } catch (error) {
        console.error('❌ Erreur chargement classes:', error);
    }
}

/**
 * Charge la liste des paiements - VERSION CORRIGÉE
 */

// ============================================
// SECTION REÇUS ET IMPRESSION PROFESSIONNELLE
// ============================================

let currentReceiptData = null;
/**
 * Ouvre le modal de prévisualisation du reçu - VERSION AVEC FONCTION SQL
 */
window.previewReceipt = async function(paymentId) {
    console.log('🧾 Prévisualisation reçu:', paymentId);
    
    try {
        // Utiliser la fonction SQL pour récupérer le paiement avec parent
        const { data, error } = await supabaseClient
            .rpc('get_payment_with_parent', { payment_uuid: paymentId });
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            throw new Error('Paiement non trouvé');
        }
        
        const payment = data[0];

        // Situation financiere de l'eleve a la date d'edition. Le RPC ne
        // renvoie que le paiement courant : il faut sommer les versements.
        // Memes regles que le portail parent, sinon les deux chiffres
        // differeraient et le recu serait contestable.
        try {
            const { data: tous } = await supabaseClient
                .from('payments').select('amount, type, status')
                .eq('student_id', payment.student_id);
            const regle = (tous || [])
                .filter(p => (!p.status || p.status === 'completed') &&
                             (p.type === 'inscription' || p.type === 'scolarite'))
                .reduce((s, p) => s + (parseInt(p.amount) || 0), 0);
            const du = (parseInt(payment.frais_inscription) || 0) +
                       (parseInt(payment.frais_scolarite) || 0);
            payment._situation = { du: du, regle: regle, solde: du - regle };
        } catch (e) {
            console.warn('Situation financière non chargée :', e && e.message);
        }

        // Jeton de vérification : la RPC get_payment_with_parent ne le renvoie
        // pas (elle est antérieure). Requête séparée, jointure en JS.
        try {
            const { data: vt } = await supabaseClient
                .from('payments').select('verify_token').eq('id', paymentId).maybeSingle();
            if (vt?.verify_token) payment.verify_token = vt.verify_token;
        } catch (e) {
            console.warn('verify_token non chargé (script SQL exécuté ?) :', e?.message);
        }
        
        // Reformater les données pour le reçu
        currentReceiptData = {
            ...payment,
            students: {
                first_name: payment.student_first_name,
                last_name: payment.student_last_name,
                matricule: payment.student_matricule
            },
            classes: {
                nom: payment.class_name,
                frais_inscription: payment.frais_inscription,
                frais_scolarite: payment.frais_scolarite
            },
            parent: payment.parent_id ? {
                first_name: payment.parent_first_name,
                last_name: payment.parent_last_name,
                phone: payment.parent_phone,
                email: payment.parent_email
            } : null,
            receiptNumber: generateReceiptNumber(payment),
            dateFormatted: formatReceiptDate(payment.date || payment.created_at, payment.created_at)
        };
        
        // Générer les différentes vues du reçu
        generateReceiptPreview('thermal');
        
        // Ouvrir le modal
        openModal('receiptModal');
        
    } catch (error) {
        console.error('❌ Erreur chargement reçu:', error);
        showToast('Erreur lors du chargement du reçu: ' + error.message, 'error');
    }
};

/**
 * Affiche les détails complets d'un paiement - VERSION AVEC FONCTION SQL
 */
window.viewPayment = async function(paymentId) {
    console.log('👁️ Vue détails paiement:', paymentId);
    
    try {
        // Utiliser la fonction SQL
        const { data, error } = await supabaseClient
            .rpc('get_payment_with_parent', { payment_uuid: paymentId });
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            throw new Error('Paiement non trouvé');
        }
        
        const payment = data[0];
        
        // Reformater pour le modal de détails
        currentPaymentDetails = {
            ...payment,
            students: {
                first_name: payment.student_first_name,
                last_name: payment.student_last_name,
                matricule: payment.student_matricule
            },
            classes: {
                id: payment.class_id,
                nom: payment.class_name,
                niveau: payment.class_level,
                frais_inscription: payment.frais_inscription,
                frais_scolarite: payment.frais_scolarite
            },
            parent: payment.parent_id ? {
                first_name: payment.parent_first_name,
                last_name: payment.parent_last_name,
                phone: payment.parent_phone,
                email: payment.parent_email
            } : null
        };
        
        // Remplir le modal
        fillPaymentDetailsModal(currentPaymentDetails);
        
        // Ouvrir le modal
        openModal('paymentDetailsModal');
        
    } catch (error) {
        console.error('❌ Erreur chargement détails:', error);
        showToast('Erreur lors du chargement des détails', 'error');
    }
};

/**
 * Charge la liste des paiements - VERSION AVEC VUE SQL
 */
async function loadPaymentsList() {
    console.log('📋 Chargement liste des paiements...');
    
    const tbody = document.getElementById('paiementsTableBody');
    
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #8D6E63; margin-bottom: 15px; display: block;"></i>
                    Chargement des paiements...
                </td>
            </tr>
        `;
    }
    
    try {
        // Utiliser la vue SQL qui inclut déjà les parents
        const { data: payments, error } = await supabaseClient
            .from('payments_with_parents')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        
        if (error) throw error;
        
        console.log(`✅ ${payments?.length || 0} paiement(s) chargé(s)`);

        // Récupérer receipt_number depuis la table payments si au moins un manque
        // (la vue payments_with_parents peut ne pas l'inclure ou le renvoyer vide)
        if (payments && payments.length) {
            const manquant = payments.some(p => !p.receipt_number);
            if (manquant) {
                const ids = payments.map(p => p.id).filter(Boolean);
                if (ids.length) {
                    const { data: recs } = await supabaseClient
                        .from('payments').select('id, receipt_number').in('id', ids);
                    const recMap = {};
                    (recs || []).forEach(r => recMap[r.id] = r.receipt_number);
                    payments.forEach(p => { if (!p.receipt_number) p.receipt_number = recMap[p.id] || null; });
                }
            }
        }
        
        if (tbody) {
            if (!payments || payments.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align: center; padding: 40px; color: #666;">
                            <i class="fas fa-money-bill-wave" style="font-size: 2rem; margin-bottom: 15px; color: #ddd;"></i>
                            <p>Aucun paiement enregistré</p>
                        </td>
                    </tr>
                `;
                return;
            }
            
            // Classe de chaque élève : requêtes séparées + jointure JS
            // (la vue payments_with_parents ne porte pas la classe)
            const classeParEleve = {};
            try {
                const sids = [...new Set(payments.map(p => p.student_id).filter(Boolean))];
                if (sids.length) {
                    const { data: studs } = await supabaseClient
                        .from('students').select('id, class_id').in('id', sids);
                    const cids = [...new Set((studs || []).map(s => s.class_id).filter(Boolean))];
                    const nomClasse = {};
                    if (cids.length) {
                        const { data: cls } = await supabaseClient
                            .from('classes').select('id, nom').in('id', cids);
                        (cls || []).forEach(c => { nomClasse[c.id] = c.nom; });
                    }
                    (studs || []).forEach(s => { classeParEleve[s.id] = nomClasse[s.class_id] || null; });
                }
            } catch (e) { console.warn('Classes non chargées:', e?.message); }

            tbody.innerHTML = payments.map(p => {
                const typeLabels = {
                    'inscription': { text: 'Inscription', color: '#5D4037' },
                    'scolarite': { text: 'Scolarité', color: '#4E342E' },
                    'cantine': { text: 'Cantine', color: '#8D6E63' },
                    'uniforme': { text: 'Tenues', color: '#A1887F' }
                };
                
                const typeInfo = typeLabels[p.type] || { text: p.type, color: '#666' };
                
                const methodLabels = {
                    'especes': 'Espèces',
                    'virement': 'Virement',
                    'orange': 'Orange Money',
                    'moov': 'Moov Money',
                    'wave': 'Wave',
                    'cheque': 'Chèque'
                };
                
                const dateFormatted = p.date ? new Date(p.date).toLocaleDateString('fr-FR') : '-';
                
                return `
                <tr data-payment-id="${p.id}">
                    <td>${dateFormatted}</td>
                    <td>
                        ${p.student_id
                            ? `<a href="#" onclick="event.preventDefault(); editEleve('${p.student_id}')"
                                  title="Ouvrir la fiche de l'élève"
                                  style="font-weight:700;color:#4E342E;text-decoration:none;border-bottom:1px dotted #A1887F;">${p.student_last_name} ${p.student_first_name}</a>`
                            : `<strong>${p.student_last_name} ${p.student_first_name}</strong>`}
                        <br>
                        <small style="color:#7A6A63;">
                            ${p.student_matricule || '-'}
                            ${classeParEleve[p.student_id]
                                ? ` · <span style="color:#5D4037;font-weight:600;">${classeParEleve[p.student_id]}</span>`
                                : ''}
                        </small>
                    </td>
                    <td>
                        <span style="background: ${typeInfo.color}20; color: ${typeInfo.color}; padding: 4px 10px; border-radius: 4px; font-size: 0.85rem; font-weight: 500;">
                            ${typeInfo.text}
                        </span>
                    </td>
                    <td style="font-weight: 600; color: #059669;">
                        ${parseInt(p.amount || 0).toLocaleString('fr-FR')} FCFA
                    </td>
                    <td>${methodLabels[p.payment_method] || p.payment_method}</td>
                    <td><span style="font-family:monospace;color:#047857;font-weight:600;">${p.receipt_number || '-'}</span></td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick="viewPayment('${p.id}')" title="Voir détails">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-warning" onclick="editPayment('${p.id}')" title="Modifier" style="background:#d97706;">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="previewReceipt('${p.id}')" title="Imprimer reçu">
                            <i class="fas fa-print"></i>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deletePayment('${p.id}')" title="Supprimer">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
                `;
            }).join('');
        }
        
    } catch (error) {
        console.error('❌ Erreur chargement paiements:', error);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 40px; color: #ef4444;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 15px;"></i>
                        <p>Erreur: ${error.message}</p>
                    </td>
                </tr>
            `;
        }
    }
}


// ============================================
// SECTION DÉTAILS PAIEMENT - COMPLÈTE
// ============================================

let currentPaymentDetails = null;



/**
 * Remplit le modal de détails avec les données
 */
function fillPaymentDetailsModal(data) {
    // Labels
    const typeLabels = {
        'inscription': { text: 'Frais d\'inscription', color: '#5D4037', icon: 'fa-user-plus' },
        'scolarite': { text: 'Frais de scolarité', color: '#4E342E', icon: 'fa-graduation-cap' },
        'cantine': { text: 'Cantine', color: '#8D6E63', icon: 'fa-utensils' },
        'uniforme': { text: 'Tenues scolaires', color: '#A1887F', icon: 'fa-shirt' }
    };
    
    const methodLabels = {
        'especes': { text: 'Espèces', icon: 'fa-money-bill-wave' },
        'virement': { text: 'Virement bancaire', icon: 'fa-university' },
        'orange': { text: 'Orange Money', icon: 'fa-mobile-alt' },
        'moov': { text: 'Moov Money', icon: 'fa-mobile-alt' },
        'wave': { text: 'Wave', icon: 'fa-water' },
        'cheque': { text: 'Chèque', icon: 'fa-money-check' }
    };
    
    const typeInfo = typeLabels[data.type] || { text: data.type, color: '#666', icon: 'fa-circle' };
    const methodInfo = methodLabels[data.payment_method] || { text: data.payment_method, icon: 'fa-circle' };
    
    // Numéro de reçu
    const receiptNum = generateReceiptNumber(data);
    setText('detailReceiptNumber', receiptNum);
    
    // Date
    const dateFormatted = formatReceiptDate(data.date || data.created_at, data.created_at);
    setText('detailPaymentDate', dateFormatted.full);
    
    // Statut
    const statusEl = document.getElementById('detailPaymentStatus');
    if (statusEl) {
        statusEl.innerHTML = `<span style="background: #10b981; color: white; padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 600;">
            <i class="fas fa-check-circle"></i> Complété
        </span>`;
    }
    
    // Type
    setText('detailPaymentType', typeInfo.text);
    const typeIcon = document.getElementById('detailTypeIcon');
    if (typeIcon) {
        typeIcon.className = `fas ${typeInfo.icon}`;
        typeIcon.style.color = typeInfo.color;
    }
    
    // Montant
    setText('detailPaymentAmount', `${parseInt(data.amount).toLocaleString('fr-FR')} FCFA`);
    setText('detailAmountLetters', montantEnLettres(parseInt(data.amount)));
    
    // Méthode
    setHtml('detailPaymentMethod', `<i class="fas ${methodInfo.icon}"></i> ${methodInfo.text}`);
    
    // Référence
    setText('detailPaymentRef', data.payment_ref || 'Aucune référence');
    
    // Élève
    const student = data.students;
    setText('detailStudentName', student ? `${student.last_name} ${student.first_name}` : '-');
    setText('detailStudentMatricule', student?.matricule || '-');
    setText('detailStudentClass', data.classes?.nom || '-');
    setText('detailStudentGender', student?.gender === 'M' ? 'Masculin' : student?.gender === 'F' ? 'Féminin' : '-');
    
    // Parent
    if (data.parent) {
        setText('detailParentName', `${data.parent.last_name} ${data.parent.first_name}`);
        setText('detailParentPhone', data.parent.phone || '-');
        setText('detailParentEmail', data.parent.email || '-');
        document.getElementById('detailParentSection').style.display = 'block';
    } else {
        document.getElementById('detailParentSection').style.display = 'none';
    }
    
    // Classe
    setText('detailClassName', data.classes?.nom || '-');
    setText('detailClassLevel', data.classes?.niveau || '-');
    
    // Frais de référence
    const fraisRef = data.type === 'inscription' ? data.classes?.frais_inscription : data.classes?.frais_scolarite;
    setText('detailClassFees', fraisRef ? `${parseInt(fraisRef).toLocaleString('fr-FR')} FCFA` : '-');
    
    // Boutons d'action
    const printBtn = document.getElementById('detailPrintBtn');
    if (printBtn) {
        printBtn.onclick = () => {
            closeModal('paymentDetailsModal');
            previewReceipt(data.id);
        };
    }
    
    const deleteBtn = document.getElementById('detailDeleteBtn');
    if (deleteBtn) {
        deleteBtn.onclick = () => {
            if (confirm('Êtes-vous sûr de vouloir supprimer ce paiement ?')) {
                closeModal('paymentDetailsModal');
                deletePayment(data.id);
            }
        };
    }
}

/**
 * Helper pour définir le texte d'un élément
 */
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

/**
 * Helper pour définir le HTML d'un élément
 */
function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}
/**
 * Génère un numéro de reçu unique
 */
function generateReceiptNumber(payment) {
    // Utiliser le numéro de reçu officiel stocké en base (généré par trigger)
    if (payment && payment.receipt_number) return payment.receipt_number;
    // Repli (anciens paiements sans numéro) : format cohérent, déterministe sur l'id
    const date = new Date(payment.created_at || payment.date || Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const idPart = (payment.id || '').replace(/\D/g, '').slice(0, 4).padStart(4, '0') || '0000';
    return `EPMK-${year}${month}-${idPart}`;
}

/**
 * Formate la date pour le reçu
 */
function formatReceiptDate(dateString, timeString) {
    // dateString = jour du paiement (colonne DATE, sans heure)
    // timeString = horodatage réel (created_at) pour l'heure
    const date = new Date(dateString);
    const timeSrc = timeString ? new Date(timeString) : null;
    const hasTime = timeSrc && !isNaN(timeSrc.getTime());
    const timeTxt = hasTime
        ? timeSrc.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : '';
    return {
        full: date.toLocaleDateString('fr-FR', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }) + (timeTxt ? ' à ' + timeTxt : ''),
        short: date.toLocaleDateString('fr-FR'),
        time: timeTxt
    };
}

/**
 * Convertit un montant en lettres (français)
 */
function montantEnLettres(montant) {
    const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
    const teens = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
    const tens = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingt', 'quatre-vingt-dix'];
    
    function convertLessThanThousand(n) {
        if (n === 0) return '';
        if (n < 10) return units[n];
        if (n < 20) return teens[n - 10];
        if (n < 100) {
            const ten = Math.floor(n / 10);
            const unit = n % 10;
            if (ten === 7 || ten === 9) {
                return tens[ten - 1] + (unit > 0 ? '-' + teens[unit] : '');
            }
            return tens[ten] + (unit > 0 && ten !== 8 ? '-' + units[unit] : (unit > 0 ? ' ' + units[unit] : ''));
        }
        const hundred = Math.floor(n / 100);
        const rest = n % 100;
        if (hundred === 1) {
            return 'cent' + (rest > 0 ? ' ' + convertLessThanThousand(rest) : '');
        }
        return units[hundred] + ' cent' + (rest > 0 ? ' ' + convertLessThanThousand(rest) : '');
    }
    
    if (montant === 0) return 'zéro franc CFA';
    
    let result = '';
    const billions = Math.floor(montant / 1000000000);
    const millions = Math.floor((montant % 1000000000) / 1000000);
    const thousands = Math.floor((montant % 1000000) / 1000);
    const remainder = montant % 1000;
    
    if (billions > 0) {
        result += convertLessThanThousand(billions) + ' milliard' + (billions > 1 ? 's' : '') + ' ';
    }
    if (millions > 0) {
        result += convertLessThanThousand(millions) + ' million' + (millions > 1 ? 's' : '') + ' ';
    }
    if (thousands > 0) {
        if (thousands === 1) {
            result += 'mille ';
        } else {
            result += convertLessThanThousand(thousands) + ' mille ';
        }
    }
    if (remainder > 0) {
        result += convertLessThanThousand(remainder);
    }
    
    return result.trim() + ' francs CFA';
}

/**
 * Génère la prévisualisation du reçu selon le format
 */
window.generateReceiptPreview = function(format) {
    if (!currentReceiptData) return;
    
    const previewContainer = document.getElementById('receiptPreviewContainer');
    if (!previewContainer) return;
    
    // Mettre à jour les boutons actifs
    document.querySelectorAll('.receipt-format-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.format === format);
    });
    
    switch(format) {
        case 'thermal':
            previewContainer.innerHTML = generateThermalReceipt(currentReceiptData);
            break;
        case 'a4':
            previewContainer.innerHTML = generateA4Receipt(currentReceiptData);
            break;
        case 'simple':
            previewContainer.innerHTML = generateSimpleReceipt(currentReceiptData);
            break;
    }

    // Le QR ne peut être dessiné qu'APRÈS l'injection du HTML.
    injecterQRRecu(currentReceiptData);
};

/**
 * Dessine le code QR du reçu.
 * Le QR contient la RÉFÉRENCE du reçu, pas une preuve : n'importe qui peut
 * fabriquer un QR. Seule la recherche du numéro dans l'admin fait foi.
 * On produit une <img> en data-URL et non un <canvas> : printReceipt() copie
 * le HTML via innerHTML, ce qui perdrait le contenu d'un canvas.
 */
function injecterQRRecu(data) {
    const cible = document.getElementById('qrcode-' + data.id);
    if (!cible) return;   // format thermique ou simple : pas de QR

    if (typeof QRCode === 'undefined') {
        cible.innerHTML = '<div style="font-size:8px;color:#bbb;">QR indisponible</div>';
        console.warn('Bibliothèque QRCode non chargée');
        return;
    }

    // Le QR ne contient QUE le jeton de vérification, jamais les données.
    // Un QR porteur de données ne prouve rien (n'importe qui en fabrique un).
    // Ici, il ouvre la page publique qui interroge la BASE : c'est elle qui fait foi.
    if (!data.verify_token) {
        cible.innerHTML = '<div style="font-size:8px;color:#bbb;">QR indisponible</div>';
        console.warn('verify_token absent : exécutez verification-recus.sql');
        return;
    }
    const texte = 'https://epmk.netlify.app/pages/verifier-recu.html?t=' + data.verify_token;

    // Le format thermique s'imprime sur une imprimante MONOCHROME : un QR marron
    // y sortirait tramé en gris, donc difficilement lisible. On le passe en noir pur.
    const thermique = document.querySelector('.receipt-format-btn.active')?.dataset.format === 'thermal';
    const taille = thermique ? 104 : 88;

    try {
        const tampon = document.createElement('div');
        tampon.style.display = 'none';
        document.body.appendChild(tampon);

        new QRCode(tampon, {
            text: texte,
            width: taille, height: taille,
            colorDark: thermique ? '#000000' : '#5D4037',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });

        const canvas = tampon.querySelector('canvas');
        cible.innerHTML = canvas
            ? '<img src="' + canvas.toDataURL('image/png') + '" alt="Code QR du reçu" ' +
              'style="width:' + taille + 'px;height:' + taille + 'px;display:block;">'
            : '<div style="font-size:8px;color:#bbb;">QR indisponible</div>';
        tampon.remove();
    } catch (e) {
        console.warn('QR non généré:', e);
        cible.innerHTML = '<div style="font-size:8px;color:#bbb;">QR indisponible</div>';
    }
}

/**
 * Génère un reçu format thermique (80mm)
 */
function generateThermalReceipt(data) {
    const typeLabels = {
        'inscription': 'Frais d\'inscription',
        'scolarite': 'Frais de scolarité',
        'cantine': 'Cantine',
        'uniforme': 'Tenues scolaires'
    };
    
    const methodLabels = {
        'especes': 'Espèces',
        'virement': 'Virement bancaire',
        'orange': 'Orange Money',
        'moov': 'Moov Money',
        'wave': 'Wave',
        'cheque': 'Chèque'
    };
    
    return `
        <div class="receipt-thermal" style="
            width: 80mm;
            padding: 10px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            line-height: 1.4;
            background: white;
            color: black;
            margin: 0 auto;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
        ">
            <div style="text-align: center; border-bottom: 2px dashed #000; padding-bottom: 10px; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">🏫 EPMK</div>
                <div style="font-size: 10px;">École Privée Moussa Koné</div>
                <div style="font-size: 9px;">Sébénicoro-Sibiribougou, Bamako, Mali</div>
                <div style="font-size: 9px;">Tel: +223 20 21 22 29</div>
            </div>
            
            <div style="text-align: center; margin: 15px 0;">
                <div style="font-size: 14px; font-weight: bold; border: 2px solid #000; padding: 5px; display: inline-block;">
                    REÇU DE PAIEMENT
                </div>
                <div style="font-size: 10px; margin-top: 5px;">N° ${data.receiptNumber}</div>
            </div>
            
            <div style="margin: 15px 0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>Date:</span>
                    <span>${data.dateFormatted.short} ${data.dateFormatted.time}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>Caissier:</span>
                    <span>Admin</span>
                </div>
            </div>
            
            <div style="border: 1px solid #000; padding: 10px; margin: 15px 0;">
                <div style="font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #000; padding-bottom: 5px;">
                    DÉTAIL DU PAIEMENT
                </div>
                <div style="margin-bottom: 5px;">
                    <span>Élève:</span><br>
                    <strong>${data.students?.last_name} ${data.students?.first_name}</strong>
                </div>
                <div style="margin-bottom: 5px;">
                    <span>Matricule:</span> ${data.students?.matricule || '-'}
                </div>
                <div style="margin-bottom: 5px;">
                    <span>Classe:</span> ${data.classes?.nom || '-'}
                </div>
                ${data.parent ? `
                <div style="margin-bottom: 5px;">
                    <span>Parent:</span> ${data.parent.last_name} ${data.parent.first_name}
                </div>
                ` : ''}
            </div>
            
            <div style="border: 2px solid #000; padding: 10px; margin: 15px 0; text-align: center;">
                <div style="font-size: 10px; margin-bottom: 5px;">TYPE DE PAIEMENT</div>
                <div style="font-size: 14px; font-weight: bold; color: #000;">
                    ${typeLabels[data.type] || data.type}
                </div>
            </div>
            
            <div style="border: 2px solid #000; padding: 15px; margin: 15px 0; text-align: center; background: #f9f9f9;">
                <div style="font-size: 10px; margin-bottom: 5px;">MONTANT PAYÉ</div>
                <div style="font-size: 24px; font-weight: bold; color: #000;">
                    ${parseInt(data.amount).toLocaleString('fr-FR')} FCFA
                </div>
                <div style="font-size: 9px; margin-top: 5px; font-style: italic;">
                    ${montantEnLettres(parseInt(data.amount))}
                </div>
            </div>

            <!-- Situation, en version condensee : 80mm ne permettent pas
                 le bloc complet du A4. Le libelle « au JJ/MM » est
                 indispensable — sans lui, le solde imprime passerait pour
                 definitif alors qu'il change a chaque versement. -->
            ${data._situation && data._situation.du > 0 ? `
            <div style="border-top: 1px dashed #000; border-bottom: 1px dashed #000;
                        padding: 8px 0; margin: 12px 0; font-size: 10px;">
                <div style="text-align: center; font-size: 9px; margin-bottom: 6px;">
                    SITUATION AU ${new Date().toLocaleDateString('fr-FR')} (indicatif)
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                    <span>Frais annuels</span><span>${data._situation.du.toLocaleString('fr-FR')}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                    <span>Total réglé</span><span>${data._situation.regle.toLocaleString('fr-FR')}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-weight: bold;
                            border-top: 1px solid #000; padding-top: 4px; margin-top: 4px;">
                    <span>${data._situation.solde > 0 ? 'RESTE À PAYER' : (data._situation.solde < 0 ? 'TROP-PERÇU' : 'SOLDÉ')}</span>
                    <span>${Math.abs(data._situation.solde).toLocaleString('fr-FR')} FCFA</span>
                </div>
            </div>` : ''}
            
            <div style="margin: 15px 0; font-size: 10px;">
                <div style="margin-bottom: 5px;">
                    <span>Méthode:</span> ${methodLabels[data.payment_method] || data.payment_method}
                </div>
                ${data.payment_ref ? `
                <div style="margin-bottom: 5px;">
                    <span>Référence:</span> ${data.payment_ref}
                </div>
                ` : ''}
            </div>
            
            <!-- Zone de signature du Directeur.
                 Deux corrections successives ici :
                 1. deux colonnes de 45 % (36 mm) — trop étroites pour signer ;
                 2. une zone unique mais de 6 mm de haut — aussi inutilisable.
                 Un cachet d'école mesure ~40 mm de diamètre : il lui faut la largeur
                 ET la hauteur. 28 mm laissent la place de signer et de cacheter. -->
            <div style="border-top: 2px dashed #000; padding-top: 12px; margin-top: 14px; text-align: center;">
                <div style="height: 28mm;"></div>
                <div style="border-top: 1px solid #000; width: 78%; margin: 0 auto; padding-top: 4px;">
                    <div style="font-size: 9.5px; font-weight: 700; color: #000;">Le Directeur</div>
                    <div style="font-size: 7.5px; color: #666;">signature et cachet</div>
                </div>
            </div>
            
            <div style="text-align: center; margin-top: 20px; font-size: 8px; border-top: 1px solid #ccc; padding-top: 10px;">
                <div>Ce reçu est un document officiel de l'école.</div>
                <div>Conservez-le précieusement.</div>
                <div style="margin-top: 5px;">${data.dateFormatted.full}</div>
            </div>
            
            <div style="text-align: center; margin-top: 12px;">
                <div id="qrcode-${data.id}" style="display: flex; justify-content: center;"></div>
                <div style="font-size: 9px; color: #555; margin-top: 4px;">Scanner pour vérifier ce reçu</div>
            </div>
        </div>
    `;
}

/**
 * Génère un reçu format A4 professionnel
 */
function generateA4Receipt(data) {
    const typeLabels = {
        'inscription': 'Frais d\'inscription',
        'scolarite': 'Frais de scolarité',
        'cantine': 'Cantine',
        'uniforme': 'Tenues scolaires'
    };
    
    const methodLabels = {
        'especes': 'Espèces',
        'virement': 'Virement bancaire',
        'orange': 'Orange Money',
        'moov': 'Moov Money',
        'wave': 'Wave',
        'cheque': 'Chèque'
    };
    
    return `
        <div class="receipt-a4" style="
            width: 210mm;
            min-height: 297mm;
            padding: 20mm;
            font-family: 'Arial', sans-serif;
            font-size: 12px;
            line-height: 1.6;
            background: white;
            color: #333;
            margin: 0 auto;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
        ">
            <!-- En-tête -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #5D4037; padding-bottom: 20px; margin-bottom: 30px;">
                <div style="flex: 1;">
                    <div style="font-size: 28px; font-weight: bold; color: #5D4037; margin-bottom: 5px;">🏫 EPMK</div>
                    <div style="font-size: 16px; color: #666; margin-bottom: 5px;">École Privée Moussa Koné</div>
                    <div style="font-size: 12px; color: #999;">
                        Sébénicoro-Sibiribougou, Bamako, Mali<br>
                        Tél: +223 20 21 22 29<br>
                        Email: contact@epmk.ml
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="background: #5D4037; color: white; padding: 15px 25px; border-radius: 8px; text-align: center;">
                        <div style="font-size: 14px; margin-bottom: 5px;">REÇU N°</div>
                        <div style="font-size: 20px; font-weight: bold; letter-spacing: 2px;">${data.receiptNumber}</div>
                    </div>
                    <div style="margin-top: 15px; font-size: 11px; color: #666;">
                        Date d'émission:<br>
                        <strong>${data.dateFormatted.full}</strong>
                    </div>
                </div>
            </div>
            
            <!-- Titre -->
            <div style="text-align: center; margin: 30px 0;">
                <h1 style="font-size: 24px; color: #5D4037; margin: 0; text-transform: uppercase; letter-spacing: 3px;">
                    Reçu de Paiement
                </h1>
                <div style="width: 100px; height: 3px; background: #5D4037; margin: 15px auto;"></div>
            </div>
            
            <!-- Informations -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px;">
                <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; border-left: 4px solid #5D4037;">
                    <h3 style="color: #5D4037; margin: 0 0 15px 0; font-size: 14px; text-transform: uppercase;">Informations de l'élève</h3>
                    <div style="margin-bottom: 8px;"><strong>Nom:</strong> ${data.students?.last_name} ${data.students?.first_name}</div>
                    <div style="margin-bottom: 8px;"><strong>Matricule:</strong> ${data.students?.matricule || '-'}</div>
                    <div style="margin-bottom: 8px;"><strong>Classe:</strong> ${data.classes?.nom || '-'}</div>
                    ${data.parent ? `
                    <div style="margin-top: 15px; padding-top: 15px; border-top: 1px dashed #ccc;">
                        <div style="font-size: 11px; color: #666; margin-bottom: 5px;">Parent/Tuteur:</div>
                        <div><strong>${data.parent.last_name} ${data.parent.first_name}</strong></div>
                        <div style="font-size: 11px; color: #666;">${data.parent.phone || ''}</div>
                    </div>
                    ` : ''}
                </div>
                
                <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; border-left: 4px solid #10b981;">
                    <h3 style="color: #10b981; margin: 0 0 15px 0; font-size: 14px; text-transform: uppercase;">Détails du paiement</h3>
                    <div style="margin-bottom: 8px;"><strong>Type:</strong> ${typeLabels[data.type] || data.type}</div>
                    <div style="margin-bottom: 8px;"><strong>Méthode:</strong> ${methodLabels[data.payment_method] || data.payment_method}</div>
                    ${data.payment_ref ? `<div style="margin-bottom: 8px;"><strong>Référence:</strong> ${data.payment_ref}</div>` : ''}
                    <div style="margin-bottom: 8px;"><strong>Caissier:</strong> Administrateur</div>
                    <div style="margin-top: 15px; padding: 10px; background: #e8f5e9; border-radius: 4px; text-align: center;">
                        <div style="font-size: 11px; color: #666;">Statut</div>
                        <div style="color: #10b981; font-weight: bold; font-size: 14px;">✓ PAYÉ</div>
                    </div>
                </div>
            </div>
            
            <!-- Montant -->
            <div style="background: linear-gradient(135deg, #5D4037 0%, #8D6E63 100%); color: white; padding: 30px; border-radius: 12px; text-align: center; margin: 30px 0;">
                <div style="font-size: 14px; margin-bottom: 10px; opacity: 0.9;">MONTANT TOTAL PAYÉ</div>
                <div style="font-size: 48px; font-weight: bold; margin-bottom: 10px;">
                    ${parseInt(data.amount).toLocaleString('fr-FR')} <span style="font-size: 24px;">FCFA</span>
                </div>
                <div style="font-size: 14px; opacity: 0.9; font-style: italic;">
                    ${montantEnLettres(parseInt(data.amount))}
                </div>
            </div>

            <!-- SITUATION À LA DATE D'ÉDITION
                 Volontairement SÉPARÉE du montant encaissé. Un reçu est une
                 preuve de paiement : elle est définitive. Un solde, lui, change
                 à chaque versement. Les mêler sans le dire rendrait le document
                 trompeur six mois plus tard, quand la famille aura soldé. -->
            ${data._situation && data._situation.du > 0 ? `
            <div style="border: 1.5px solid #D7CCC8; border-radius: 10px; margin: 24px 0; overflow: hidden;">
                <div style="background: #EFEBE9; padding: 10px 18px; font-size: 12px;
                            font-weight: 700; color: #5D4037; letter-spacing: .5px;">
                    SITUATION AU ${new Date().toLocaleDateString('fr-FR')} — À TITRE INDICATIF
                </div>
                <div style="padding: 16px 18px;">
                    <div style="display: flex; justify-content: space-between; padding: 7px 0;
                                border-bottom: 1px solid #F3EEEB;">
                        <span style="color: #7A6A63;">Frais annuels (inscription + scolarité)</span>
                        <strong>${data._situation.du.toLocaleString('fr-FR')} FCFA</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 7px 0;
                                border-bottom: 1px solid #F3EEEB;">
                        <span style="color: #7A6A63;">Total réglé à ce jour</span>
                        <strong style="color: #2E7D32;">${data._situation.regle.toLocaleString('fr-FR')} FCFA</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 9px 0 2px;">
                        <span style="font-weight: 700; color: #2A211D;">
                            ${data._situation.solde > 0 ? 'Reste à payer' : (data._situation.solde < 0 ? 'Trop-perçu (avoir)' : 'Solde')}
                        </span>
                        <strong style="font-size: 17px; color: ${data._situation.solde > 0 ? '#B23B2E' : '#2E7D32'};">
                            ${Math.abs(data._situation.solde).toLocaleString('fr-FR')} FCFA
                        </strong>
                    </div>
                    <div style="margin-top: 12px; font-size: 11px; color: #7A6A63; font-style: italic;
                                line-height: 1.5;">
                        Cette situation reflète les versements enregistrés à la date ci-dessus.
                        Seul le montant encaissé ci-dessus fait l'objet du présent reçu.
                    </div>
                </div>
            </div>` : ''}
            
            <!-- Tableau détaillé -->
            <table style="width: 100%; border-collapse: collapse; margin: 30px 0;">
                <thead>
                    <tr style="background: #5D4037; color: white;">
                        <th style="padding: 12px; text-align: left; border: 1px solid #5D4037;">Description</th>
                        <th style="padding: 12px; text-align: right; border: 1px solid #5D4037; width: 150px;">Montant</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="background: #f9f9f9;">
                        <td style="padding: 12px; border: 1px solid #ddd;">
                            <strong>${typeLabels[data.type] || data.type}</strong><br>
                            <span style="font-size: 11px; color: #666;">Paiement pour l'année scolaire ${anneeDocument()}</span>
                        </td>
                        <td style="padding: 12px; text-align: right; border: 1px solid #ddd; font-weight: bold;">
                            ${parseInt(data.amount).toLocaleString('fr-FR')} FCFA
                        </td>
                    </tr>
                    <tr style="background: white;">
                        <td style="padding: 12px; text-align: right; border: 1px solid #ddd; font-weight: bold;">TOTAL</td>
                        <td style="padding: 12px; text-align: right; border: 1px solid #ddd; font-weight: bold; font-size: 16px; color: #5D4037;">
                            ${parseInt(data.amount).toLocaleString('fr-FR')} FCFA
                        </td>
                    </tr>
                </tbody>
            </table>
            
            <!-- Mentions -->
            <div style="background: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 30px 0; font-size: 11px; color: #666;">
                <strong>Important:</strong> Ce reçu est un document officiel de l'école. Conservez-le précieusement. 
                En cas de réclamation, présentez ce reçu à l'administration. Tout paiement est définitif et non remboursable.
            </div>
            
            <!-- Signatures.
                 Trois zones auparavant, dont « Le Caissier » : l'école n'ayant qu'un
                 seul administrateur, le directeur aurait signé deux fois le même reçu.
                 Les hauteurs (60 px ≈ 16 mm) étaient par ailleurs insuffisantes :
                 un cachet rond d'école mesure ~40 mm de diamètre. -->
            <div style="display: flex; justify-content: space-between; gap: 30px; margin-top: 40px; page-break-inside: avoid;">
                <div style="text-align: center; flex: 1;">
                    <div style="height: 34mm; border: 1.5px dashed #bbb; border-radius: 5px;
                                display: flex; align-items: flex-end; justify-content: center; padding-bottom: 4px;">
                        <span style="font-size: 8px; color: #ccc; font-style: italic;">emplacement du cachet</span>
                    </div>
                    <div style="padding-top: 8px;">
                        <div style="font-weight: bold;">Le Directeur</div>
                        <div style="font-size: 11px; color: #666; margin-top: 3px;">Signature et cachet</div>
                    </div>
                </div>
                <div style="text-align: center; flex: 1;">
                    <div style="height: 34mm; border-bottom: 2px solid #333;"></div>
                    <div style="padding-top: 8px;">
                        <div style="font-weight: bold;">Le Parent / Tuteur</div>
                        <div style="font-size: 11px; color: #666; margin-top: 3px;">Date et signature</div>
                    </div>
                </div>
            </div>
            
            <!-- QR Code et footer -->
            <div style="margin-top: 40px; padding-top: 20px; border-top: 2px dashed #ccc; display: flex; justify-content: space-between; align-items: flex-end;">
                <div style="font-size: 10px; color: #999; max-width: 60%;">
                    <div>Document généré électroniquement par le système de gestion scolaire EPMK.</div>
                    <div>Vérifiez l'authenticité de ce reçu en scannant le code QR ci-contre.</div>
                    <div style="margin-top: 10px;">Reçu n° ${data.receiptNumber || data.receipt_number || '—'}</div>
                </div>
                <div style="text-align: center;">
                    <div id="qrcode-${data.id}" style="margin-bottom: 5px;"></div>
                    <div style="font-size: 9px; color: #999;">Scanner pour vérifier</div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Génère un reçu simple (format email/WhatsApp)
 */
function generateSimpleReceipt(data) {
    const typeLabels = {
        'inscription': 'Frais d\'inscription',
        'scolarite': 'Frais de scolarité',
        'cantine': 'Cantine',
        'uniforme': 'Tenues scolaires'
    };
    
    const methodLabels = {
        'especes': 'Espèces',
        'virement': 'Virement',
        'orange': 'Orange Money',
        'moov': 'Moov Money',
        'wave': 'Wave',
        'cheque': 'Chèque'
    };
    
    const text = `
*🏫 EPMK - REÇU DE PAIEMENT*

*Reçu N°:* ${data.receiptNumber}
*Date:* ${data.dateFormatted.full}

*👤 ÉLÈVE*
Nom: ${data.students?.last_name} ${data.students?.first_name}
Matricule: ${data.students?.matricule || '-'}
Classe: ${data.classes?.nom || '-'}

*💰 PAIEMENT*
Type: ${typeLabels[data.type] || data.type}
Montant: *${parseInt(data.amount).toLocaleString('fr-FR')} FCFA*
Méthode: ${methodLabels[data.payment_method] || data.payment_method}
${data.payment_ref ? `Référence: ${data.payment_ref}` : ''}

*✅ Statut:* PAYÉ

Merci pour votre confiance !
Conservez ce reçu précieusement.
    `.trim();
    
    return `
        <div class="receipt-simple" style="
            max-width: 400px;
            margin: 0 auto;
            padding: 20px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            font-family: monospace;
            white-space: pre-wrap;
            line-height: 1.6;
        ">${text}</div>
        <div style="text-align: center; margin-top: 15px;">
            <button class="btn btn-primary" onclick="copyReceiptText()">
                <i class="fas fa-copy"></i> Copier le texte
            </button>
            <button class="btn btn-success" onclick="shareReceiptWhatsApp()">
                <i class="fab fa-whatsapp"></i> Partager WhatsApp
            </button>
        </div>
    `;
}

/**
 * Imprime le reçu
 */
// =====================================================================
//  ATTENTION - CODE MORT
//  Cette definition de printReceipt est ECRASEE par une seconde,
//  plus bas dans ce meme fichier (chercher : window.printReceipt).
//  En JavaScript, la derniere affectation gagne : modifier CELLE-CI
//  n'a aucun effet a l'execution.
//  C'est ce doublon qui a cause le bug du QR manquant : le reset
//  box-sizing present ici avait ete perdu dans la version active.
//  A supprimer apres verification.
// =====================================================================
window.printReceipt = function() {
    if (!currentReceiptData) return;
    
    const format = document.querySelector('.receipt-format-btn.active')?.dataset.format || 'thermal';
    const receiptContent = document.getElementById('receiptPreviewContainer').innerHTML;    const _htmlImpression_ = (`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Reçu ${currentReceiptData.receiptNumber}</title>
            <style>
                @page { 
                    size: ${format === 'thermal' ? '80mm auto' : 'A4'}; 
                    margin: 0; 
                }
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: ${format === 'thermal' ? '\'Courier New\', monospace' : 'Arial, sans-serif'}; 
                    padding: ${format === 'thermal' ? '0' : '20px'};
                    background: white;
                }
                @media print { 
                    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } 
                }
            </style>
        </head>
        <body>
            ${receiptContent}
            <script>
                window.onload = function() { 
                    setTimeout(function() { 
                        window.print(); 
                    }, 500); 
                };
            <\/script>
        </body>
        </html>
    `);
    ouvrirImpression(_htmlImpression_);
};

/**
 * Télécharge le reçu en PDF
 */
window.downloadReceiptPDF = function() {
    if (!currentReceiptData) return;
    
    showToast('Génération du PDF en cours...', 'info');
    
    // Utiliser la fonction print avec "Enregistrer au format PDF"
    const format = document.querySelector('.receipt-format-btn.active')?.dataset.format || 'a4';
    
    // Changer temporairement le format si nécessaire
    if (format !== 'a4') {
        generateReceiptPreview('a4');
        setTimeout(() => {
            printReceipt();
            // Restaurer le format après
            setTimeout(() => generateReceiptPreview(format), 1000);
        }, 100);
    } else {
        printReceipt();
    }
};

/**
 * Copie le texte du reçu simple
 */
window.copyReceiptText = function() {
    if (!currentReceiptData) return;
    
    const text = document.querySelector('.receipt-simple')?.textContent;
    if (text) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Texte copié dans le presse-papiers', 'success');
        }).catch(() => {
            showToast('Erreur lors de la copie', 'error');
        });
    }
};

/**
 * Partage sur WhatsApp
 */
window.shareReceiptWhatsApp = function() {
    if (!currentReceiptData) return;
    
    const text = document.querySelector('.receipt-simple')?.textContent;
    if (text) {
        const encoded = encodeURIComponent(text);
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
    }
};

/**
 * Envoie le reçu par email (simulation)
 */
window.emailReceipt = function() {
    showToast('Fonctionnalité email en développement', 'info');
};

// ============================================
// EXPOSITION GLOBALE
// ============================================

window.previewReceipt = previewReceipt;
window.generateReceiptPreview = generateReceiptPreview;
window.printReceipt = printReceipt;
window.downloadReceiptPDF = downloadReceiptPDF;
window.copyReceiptText = copyReceiptText;
window.shareReceiptWhatsApp = shareReceiptWhatsApp;
window.emailReceipt = emailReceipt;

/**
 * Met à jour les statistiques des paiements
 */
async function updatePaymentStats() {
    console.log('📊 Mise à jour stats paiements...');
    
    try {
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
        
        // Total encaissé ce mois
        const { data: monthPayments, error: error1 } = await supabaseClient
            .from('payments')
            .select('amount')
            .gte('created_at', firstDayOfMonth);
        
        const totalEncaisse = monthPayments?.reduce((sum, p) => sum + (parseInt(p.amount) || 0), 0) || 0;
        
        // Nombre de transactions
        const nbTransactions = monthPayments?.length || 0;
        
        // ── Impayés : somme des restes à payer sur les frais OBLIGATOIRES
        //    (inscription + scolarité) de chaque élève actif.
        //    Cantine et tenues sont facultatifs : ils n'entrent pas dans le calcul.
        let totalImpayes = 0;
        let nbElevesAvecSolde = 0;
        try {
            // Barème par classe
            const { data: classes } = await supabaseClient
                .from('classes').select('id, frais_scolarite, frais_inscription');
            const bareme = {};
            (classes || []).forEach(c => {
                bareme[c.id] = (parseInt(c.frais_inscription) || 0) + (parseInt(c.frais_scolarite) || 0);
            });

            // Élèves actifs
            const { data: eleves } = await supabaseClient
                .from('students').select('id, class_id').eq('status', 'actif');

            // Paiements validés sur les frais obligatoires
            const { data: regles } = await supabaseClient
                .from('payments')
                .select('student_id, amount, type, status')
                .in('type', ['inscription', 'scolarite']);

            const payeParEleve = {};
            (regles || []).forEach(p => {
                // On ignore les déclarations en attente ou rejetées
                if (p.status && p.status !== 'completed') return;
                payeParEleve[p.student_id] = (payeParEleve[p.student_id] || 0) + (parseInt(p.amount) || 0);
            });

            (eleves || []).forEach(e => {
                const du = bareme[e.class_id] || 0;
                const paye = payeParEleve[e.id] || 0;
                const reste = du - paye;
                if (reste > 0) {
                    totalImpayes += reste;
                    nbElevesAvecSolde++;
                }
            });
        } catch (e) {
            console.warn('Impayés non calculés:', e?.message);
        }
        
        // Mise à jour de l'interface
        const totalEl = document.getElementById('totalEncaisse');
        if (totalEl) totalEl.textContent = totalEncaisse.toLocaleString('fr-FR') + ' FCFA';
        
        const impayesEl = document.getElementById('totalImpayes');
        if (impayesEl) impayesEl.textContent = totalImpayes.toLocaleString('fr-FR') + ' FCFA';
        
        const transEl = document.getElementById('nbTransactions');
        if (transEl) transEl.textContent = nbTransactions;
        
        const soldeEl = document.getElementById('elevesSolde');
        if (soldeEl) soldeEl.textContent = nbElevesAvecSolde;
        
    } catch (error) {
        console.error('❌ Erreur stats paiements:', error);
    }
}

/**
 * Ouvre le modal d'ajout de paiement
 */
window.openPaymentModal = async function() {
    console.log('💳 Ouverture modal paiement...');
    
    // Réinitialiser le formulaire
    const form = document.getElementById('addPaymentForm');
    if (form) form.reset();
    
    // Définir la date d'aujourd'hui
    const dateInput = document.getElementById('paymentDate');
    if (dateInput) dateInput.valueAsDate = new Date();
    
    // Désactiver le select élève
    const studentSelect = document.getElementById('paymentStudent');
    if (studentSelect) {
        studentSelect.innerHTML = '<option value="">Sélectionnez d\'abord une classe...</option>';
        studentSelect.disabled = true;
    }
    
    // Cacher les info frais
    const feesInfo = document.getElementById('classFeesInfo');
    if (feesInfo) feesInfo.style.display = 'none';
    
    // Charger les classes
    await loadClassesForPaymentModal();
    
    // Réinitialiser le mode versement auto et les panneaux
    const modeAuto = document.getElementById('modeVersementAuto');
    if (modeAuto) modeAuto.checked = false;
    const sit = document.getElementById('situationFinanciere');
    if (sit) sit.style.display = 'none';
    const apercu = document.getElementById('apercuRepartition');
    if (apercu) apercu.style.display = 'none';
    if (typeof toggleModeVersement === 'function') toggleModeVersement();
    if (typeof adapterChampReference === 'function') adapterChampReference();

    // Ouvrir le modal
    openModal('addPaymentModal');
};

/**
 * Charge les classes dans le modal de paiement
 */
async function loadClassesForPaymentModal() {
    const select = document.getElementById('paymentClasse');
    if (!select) return;
    
    try {
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('id, nom, frais_inscription, frais_scolarite')
            .order('nom');
        
        if (error) throw error;
        
        select.innerHTML = '<option value="">Choisir une classe...</option>';
        
        classes?.forEach(c => {
            const option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.nom;
            option.dataset.fraisInscription = c.frais_inscription || 0;
            option.dataset.fraisScolarite = c.frais_scolarite || 0;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('❌ Erreur chargement classes:', error);
    }
}

/**
 * Gère le changement de classe dans le modal paiement
 */
window.onPaymentClasseChange = async function() {
    console.log('🏫 Changement classe paiement...');
    
    const classeId = document.getElementById('paymentClasse')?.value;
    const studentSelect = document.getElementById('paymentStudent');
    const feesInfo = document.getElementById('classFeesInfo');
    
    if (!classeId) {
        if (studentSelect) {
            studentSelect.innerHTML = '<option value="">Sélectionnez d\'abord une classe...</option>';
            studentSelect.disabled = true;
        }
        if (feesInfo) feesInfo.style.display = 'none';
        return;
    }
    
    // Afficher les frais de la classe
    const select = document.getElementById('paymentClasse');
    const selectedOption = select?.selectedOptions[0];
    
    if (selectedOption && feesInfo) {
        const fraisInsc = selectedOption.dataset.fraisInscription || 0;
        const fraisScol = selectedOption.dataset.fraisScolarite || 0;
        
        document.getElementById('feeInscription').textContent = parseInt(fraisInsc).toLocaleString('fr-FR') + ' FCFA';
        document.getElementById('feeScolarite').textContent = parseInt(fraisScol).toLocaleString('fr-FR') + ' FCFA';
        
        feesInfo.style.display = 'block';
    }
    
    // Charger les élèves de la classe
    if (studentSelect) {
        studentSelect.innerHTML = '<option value="">Chargement...</option>';
        studentSelect.disabled = true;
        
        try {
            const { data: students, error } = await supabaseClient
                .from('students')
                .select('id, first_name, last_name, matricule')
                .eq('class_id', classeId)
                .eq('status', 'actif')
                .order('last_name');
            
            if (error) throw error;
            
            studentSelect.innerHTML = '<option value="">Choisir un élève...</option>';
            
            students?.forEach(s => {
                const option = document.createElement('option');
                option.value = s.id;
                option.textContent = `${s.last_name} ${s.first_name} (${s.matricule || 'Sans matricule'})`;
                studentSelect.appendChild(option);
            });
            
            studentSelect.disabled = false;
            
        } catch (error) {
            console.error('❌ Erreur chargement élèves:', error);
            studentSelect.innerHTML = '<option value="">Erreur de chargement</option>';
        }
    }
};

/**
 * Sauvegarde un nouveau paiement
 */
// Vérifie qu'un versement ne dépasse pas ce qui reste dû sur ce type de frais.
// Trois cas traités :
//   1. le type est déjà soldé            → alerte de doublon probable
//   2. le versement dépasse le reste dû  → propose d'imputer l'excédent
//   3. doublon exact le même jour        → alerte de double saisie
// L'argent n'est jamais perdu (le solde global l'absorbe), mais le
// directeur doit le savoir AVANT de valider, pas après.
async function verifierTropPercu(formData) {
    try {
        const type = formData.type;
        // Seuls les frais à montant défini sont contrôlables
        if (!['inscription', 'scolarite'].includes(type)) return { ok: true };

        const { data: c } = await supabaseClient
            .from('classes').select('frais_inscription, frais_scolarite')
            .eq('id', formData.class_id).maybeSingle();
        const du = parseInt(type === 'inscription' ? c?.frais_inscription : c?.frais_scolarite) || 0;
        if (!du) return { ok: true };   // barème non défini : on ne bloque pas

        const { data: anciens } = await supabaseClient
            .from('payments').select('amount, status, date')
            .eq('student_id', formData.student_id).eq('type', type);

        const valides = (anciens || []).filter(function (p) {
            return !p.status || p.status === 'completed';
        });
        const dejaPaye = valides.reduce(function (s, p) { return s + (parseInt(p.amount) || 0); }, 0);
        const reste = du - dejaPaye;
        const lbl = type === 'inscription' ? "L'inscription" : 'La scolarité';
        const f = function (n) { return n.toLocaleString('fr-FR') + ' FCFA'; };

        // Doublon exact le même jour
        const memeJour = valides.some(function (p) {
            return p.date === formData.date && parseInt(p.amount) === formData.amount;
        });
        if (memeJour) {
            return { ok: false, message:
                '⚠️ DOUBLE SAISIE PROBABLE\n\n' +
                'Un versement de ' + f(formData.amount) + ' du même type est déjà enregistré ' +
                'pour cet élève à cette date.\n\n' +
                'Vérifiez le relevé mobile money avant de continuer.\n\n' +
                'Enregistrer quand même ?' };
        }

        // Type déjà soldé
        if (reste <= 0) {
            return { ok: false, message:
                '⚠️ ' + lbl.toUpperCase() + ' EST DÉJÀ SOLDÉE\n\n' +
                'Dû : ' + f(du) + '\nDéjà réglé : ' + f(dejaPaye) + '\n\n' +
                'Ce versement de ' + f(formData.amount) + ' constituerait un trop-perçu.\n\n' +
                "S'il s'agit d'un autre frais, annulez et changez le type.\n" +
                "Sinon, l'excédent viendra en déduction du solde global de l'élève.\n\n" +
                'Enregistrer quand même ?' };
        }

        // Versement supérieur au reste dû
        if (formData.amount > reste) {
            return { ok: false, message:
                'ℹ️ MONTANT SUPÉRIEUR AU RESTE DÛ\n\n' +
                lbl + ' : ' + f(du) + '\nDéjà réglé : ' + f(dejaPaye) + '\nReste dû : ' + f(reste) + '\n\n' +
                'Vous saisissez ' + f(formData.amount) + ', soit ' + f(formData.amount - reste) + ' de plus.\n\n' +
                "Cet excédent réduira le solde global de l'élève.\n" +
                'Pour une répartition propre entre plusieurs frais, utilisez plutôt ' +
                '« Versement global ».\n\n' +
                'Continuer ?' };
        }

        return { ok: true };
    } catch (e) {
        console.warn('Contrôle trop-perçu impossible:', e?.message);
        return { ok: true };   // en cas de doute, on ne bloque pas la saisie
    }
}

window.savePayment = async function(e) {
    e.preventDefault();
    console.log('💾 Sauvegarde paiement...');

    // Si mode versement global activé → répartition automatique
    if (document.getElementById('modeVersementAuto')?.checked) {
        await enregistrerVersementReparti();
        return;
    }

    const formData = {
        class_id: document.getElementById('paymentClasse')?.value,
        student_id: document.getElementById('paymentStudent')?.value,
        type: document.getElementById('paymentType')?.value,
        amount: parseInt(document.getElementById('paymentAmount')?.value) || 0,
        payment_method: document.getElementById('paymentMethod')?.value,
        payment_ref: document.getElementById('paymentRef')?.value?.trim() || null,
        date: document.getElementById('paymentDate')?.value,
        status: 'completed',
        created_at: new Date().toISOString()
    };
    
    // Validation
    if (!formData.class_id) {
        showToast('Veuillez sélectionner une classe', 'error');
        return;
    }
    if (!formData.student_id) {
        showToast('Veuillez sélectionner un élève', 'error');
        return;
    }
    if (!formData.type) {
        showToast('Veuillez sélectionner un type de paiement', 'error');
        return;
    }
    if (formData.amount <= 0) {
        showToast('Veuillez saisir un montant valide', 'error');
        return;
    }
    if (!formData.date) {
        showToast('Veuillez sélectionner une date', 'error');
        return;
    }

    // ── Garde-fou : ce versement dépasse-t-il ce qui reste dû ? ──
    // Sans ce contrôle, une inscription réglée deux fois passait sans un mot.
    const controle = await verifierTropPercu(formData);
    if (controle && !controle.ok) {
        if (!confirm(controle.message)) return;
    }
    
    // Désactiver le bouton
    const submitBtn = e.target.querySelector('button[type=\"submit\"]');
    const originalText = submitBtn?.innerHTML;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class=\"fas fa-spinner fa-spin\"></i> Enregistrement...';
    }
    
    try {
        let { data, error } = await supabaseClient
            .from('payments')
            .insert([formData])
            .select()
            .single();

        // Repli si colonnes status/created_at absentes
        if (error && /column .*(status|created_at)/i.test(error.message || '')) {
            const { status, created_at, ...minimal } = formData;
            const retry = await supabaseClient.from('payments').insert([minimal]).select().single();
            data = retry.data; error = retry.error;
        }
        if (error) throw error;
        
        showToast('Paiement enregistré avec succès !', 'success');
        
        // Fermer le modal
        closeModal('addPaymentModal');
        
        // Recharger les données
        await loadPaymentsList();
        await updatePaymentStats();
        
        // Imprimer le reçu automatiquement (optionnel)
        // printReceipt(data.id);
        
    } catch (error) {
        console.error('❌ Erreur sauvegarde paiement:', error);
        showToast('Erreur: ' + error.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText || '<i class=\"fas fa-save\"></i> Enregistrer';
        }
    }
};

/**
 * Affiche les détails d'un paiement
 */
window.viewPayment = async function(paymentId) {
    try {
        const { data: p, error } = await supabaseClient
            .from('payments_with_parents').select('*').eq('id', paymentId).single();
        if (error || !p) throw error || new Error('Paiement introuvable');

        // Récupérer le numéro de reçu depuis la table si absent de la vue
        if (!p.receipt_number) {
            const { data: rec } = await supabaseClient
                .from('payments').select('receipt_number').eq('id', paymentId).single();
            if (rec) p.receipt_number = rec.receipt_number;
        }

        const typeLabels = { inscription:'Inscription', scolarite:'Scolarité', cantine:'Cantine', transport:'Transport', uniforme:'Uniforme', autre:'Autre' };
        const methodLabels = { especes:'Espèces', virement:'Virement', orange:'Orange Money', moov:'Moov Money', wave:'Wave', cheque:'Chèque' };

        let modal = document.getElementById('viewPaymentModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'viewPaymentModal'; modal.className = 'modal';
            document.body.appendChild(modal);
        }
        const ligne = (label, val) => `<tr><td style="padding:8px 12px;color:#6b7280;">${label}</td><td style="padding:8px 12px;font-weight:600;">${val || '-'}</td></tr>`;
        modal.innerHTML = `
            <div class="modal-content" style="max-width:520px;">
                <div class="modal-header" style="background:linear-gradient(135deg,#047857,#059669);">
                    <h3 style="color:#fff;"><i class="fas fa-receipt"></i> Détails du paiement</h3>
                    <button class="modal-close" onclick="closeModal('viewPaymentModal')" style="color:#fff;">&times;</button>
                </div>
                <div class="modal-body">
                    <table style="width:100%;border-collapse:collapse;">
                        ${ligne('N° de reçu', `<span style="font-family:monospace;color:#047857;">${p.receipt_number || '—'}</span>`)}
                        ${ligne('Élève', `${p.student_last_name||''} ${p.student_first_name||''}`)}
                        ${ligne('Matricule', p.student_matricule)}
                        ${ligne('Type', typeLabels[p.type] || p.type)}
                        ${ligne('Montant', `${parseInt(p.amount||0).toLocaleString('fr-FR')} FCFA`)}
                        ${ligne('Méthode', methodLabels[p.payment_method] || p.payment_method)}
                        ${ligne('Référence externe', p.payment_ref || 'Aucune')}
                        ${ligne('Date', p.date ? new Date(p.date).toLocaleDateString('fr-FR') : '-')}
                    </table>
                </div>
                <div class="modal-footer" style="padding:14px 20px;border-top:1px solid #e5e7eb;text-align:right;">
                    <button class="btn btn-secondary" onclick="closeModal('viewPaymentModal')">Fermer</button>
                    <button class="btn btn-primary" onclick="closeModal('viewPaymentModal'); previewReceipt('${p.id}')"><i class="fas fa-print"></i> Imprimer reçu</button>
                </div>
            </div>`;
        openModal('viewPaymentModal');
    } catch (e) {
        console.error('❌ viewPayment:', e);
        showToast('Erreur lors du chargement du paiement', 'error');
    }
};

/**
 * Imprime un reçu de paiement.
 *
 * IMPORTANT : ne reconstruit PAS son propre HTML. Le contenu de
 * #receiptPreviewContainer (généré par generateReceiptPreview) est déjà
 * exact — QR code compris, injecté en <img data:...> par injecterQRRecu
 * justement pour survivre à une copie innerHTML. On imprime donc une copie
 * fidèle de ce qui est affiché à l'écran, avec juste le CSS de mise en page
 * (@page) adapté au format actif. Ça évite aussi que l'aperçu et
 * l'impression divergent quand generateThermalReceipt/A4/Simple changent.
 */
window.printReceipt = function() {
    console.log('🖨️ Impression reçu');

    try {
        if (!currentReceiptData) {
            throw new Error('Aucun paiement sélectionné');
        }

        const previewContainer = document.getElementById('receiptPreviewContainer');
        if (!previewContainer || !previewContainer.innerHTML.trim()) {
            throw new Error('Aperçu du reçu non disponible');
        }

        const format = document.querySelector('.receipt-format-btn.active')?.dataset.format || 'thermal';

        let pageCss;
        if (format === 'a4') {
            // Le reçu A4 fait 210mm de large et porte déjà `padding: 20mm`.
            // Avec `margin: 15mm`, la zone imprimable tombait à 180mm : 30mm
            // étaient coupés à DROITE — précisément là où se trouve le QR
            // (bloc flex `justify-content: space-between`). D'où un QR visible
            // dans l'aperçu mais absent du papier.
            // Marge à 0 : le reçu EST la page, son padding interne fait la marge.
            pageCss = '@page { size: A4; margin: 0; } body { display: flex; justify-content: center; }';
        } else if (format === 'simple') {
            pageCss = '@page { margin: 10mm; } body { display: flex; justify-content: center; }';
        } else {
            // Thermique : la hauteur doit suivre le contenu réel (reçu + QR),
            // sinon le navigateur coupe sur une 2e page dès que ça dépasse
            // la valeur fixe. On mesure le rendu réel et on l'utilise comme
            // hauteur de @page, avec une marge de sécurité.
            const hauteurPx = previewContainer.scrollHeight;
            const hauteurMm = Math.ceil(hauteurPx * 25.4 / 96) + 15;
            pageCss = `@page { size: 80mm ${hauteurMm}mm; margin: 0; } body { padding: 0; } * { page-break-inside: avoid !important; }`;
        }

        const _htmlImpression_ = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Reçu de Paiement - ${currentReceiptData.id}</title>
                <style>
                    /* box-sizing est INDISPENSABLE ici. La fenetre d'impression est
                       un document vierge : sans ce reset, width 210mm + padding 20mm
                       donne 250mm de large au lieu de 210mm, et 40mm sont coupes a
                       droite - exactement ou se trouve le QR. D'ou un QR bien present
                       dans l'apercu (qui herite du reset de la feuille de style admin)
                       mais absent du papier. Idem thermique : 80mm + 20px. */
                    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
                    body { margin: 0; font-family: Arial, sans-serif; }
                    /* L'ombre portee n'a aucun sens sur papier et sort en bande grise. */
                    .receipt-thermal, .receipt-a4 { box-shadow: none !important; }
                    ${pageCss}
                </style>
            </head>
            <body>
                ${previewContainer.innerHTML}
                <script>
                    window.onload = function() { setTimeout(function() { window.print(); }, 500); };
                <\/script>
            </body>
            </html>
        `;

        ouvrirImpression(_htmlImpression_);

    } catch (error) {
        console.error('❌ Erreur impression:', error);
        showToast('Erreur lors de l\'impression: ' + error.message, 'error');
    }
};
/**
 * Supprime un paiement
 */
window.deletePayment = async function(paymentId) {
    console.log('🗑️ Suppression paiement:', paymentId);
    
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce paiement ? Cette action est irréversible.')) {
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('payments')
            .delete()
            .eq('id', paymentId);
        
        if (error) throw error;
        
        showToast('Paiement supprimé avec succès', 'success');
        
        // Recharger les données
        await loadPaymentsList();
        await updatePaymentStats();
        
    } catch (error) {
        console.error('❌ Erreur suppression:', error);
        showToast('Erreur lors de la suppression', 'error');
    }
};

// ============================================
// EXPOSITION GLOBALE
// ============================================

window.openPaymentModal = openPaymentModal;
window.onPaymentClasseChange = onPaymentClasseChange;
window.savePayment = savePayment;
window.viewPayment = viewPayment;
window.printReceipt = printReceipt;
window.deletePayment = deletePayment;
// ============================================
// SECTION FRAIS SCOLARITÉ - COMPLÈTEMENT FONCTIONNELLE
// ============================================

/**
 * Initialise et charge la page des frais de scolarité
 */
async function loadFrais() {
    console.log('💰 Chargement de la section Frais Scolarité...');
    
    try {
        // Mettre à jour l'année scolaire affichée
        const anneeEnCours = document.getElementById('anneeScolaire');
        if (anneeEnCours) {
            anneeEnCours.textContent = getCurrentSchoolYear();
        }
        
        // Charger les frais par classe
        await loadFraisParClasse();
        
        // Charger les autres frais (cantine, transport, uniforme)
        await loadAutresFrais();
        
        // Charger les statistiques
        await loadFraisStats();
        
        console.log('✅ Section Frais Scolarité chargée avec succès');
        
    } catch (error) {
        console.error('❌ Erreur chargement frais:', error);
        showToast('Erreur lors du chargement des frais', 'error');
    }
}

/**
 * Charge les frais par classe depuis Supabase
 */
async function loadFraisParClasse() {
    console.log('📚 Chargement des frais par classe...');

    const tbody = document.getElementById('fraisTableBody');
    if (!tbody) {
        console.warn('⚠️ Tableau fraisTableBody non trouvé');
        return;
    }

    tbody.innerHTML = `
        <tr><td colspan="7" style="text-align: center; padding: 40px;">
            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #8D6E63; margin-bottom: 15px; display: block;"></i>
            Chargement des frais...
        </td></tr>`;

    try {
        // Classes ET leur bareme partage — requetes separees, jointure en JS
        // (pas de jointure PostgREST sur ce projet).
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('id, nom, niveau, frais_inscription, frais_scolarite, capacite, bareme_id')
            .order('nom');
        if (error) throw error;

        if (!classes || classes.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="7" style="text-align: center; padding: 40px; color: #666;">
                    <i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 15px; color: #f59e0b;"></i>
                    <p>Aucune classe configurée</p>
                    <button class="btn btn-primary" onclick="openModal('addClasseModal')" style="margin-top: 15px;">
                        <i class="fas fa-plus"></i> Créer une classe
                    </button>
                </td></tr>`;
            return;
        }

        const baremeIds = [...new Set(classes.map(c => c.bareme_id).filter(Boolean))];
        let baremesMap = {}, tranchesMap = {};
        if (baremeIds.length) {
            const { data: baremes } = await supabaseClient
                .from('baremes_frais').select('id, nom').in('id', baremeIds);
            (baremes || []).forEach(b => { baremesMap[b.id] = b.nom; });

            const { data: tranches } = await supabaseClient
                .from('tranches_bareme').select('bareme_id, ordre, nom, montant')
                .in('bareme_id', baremeIds).order('ordre');
            (tranches || []).forEach(t => {
                (tranchesMap[t.bareme_id] = tranchesMap[t.bareme_id] || []).push(t);
            });
        }

        const fmt = n => (parseInt(n) || 0).toLocaleString('fr-FR');

        tbody.innerHTML = classes.map(c => {
            const nomBareme = baremesMap[c.bareme_id];
            const tranches = tranchesMap[c.bareme_id] || [];
            const total = (parseInt(c.frais_inscription) || 0) + (parseInt(c.frais_scolarite) || 0);

            // Les VRAIES tranches, nommees, en montants absolus — jamais
            // un pourcentage calcule : chaque bareme a sa propre repartition,
            // confirmee par la fiche officielle CSMK.
            const celluleTranches = tranches.length
                ? tranches.map(t =>
                    `<div style="font-size:.78rem;line-height:1.5;">` +
                      `<strong>${t.nom}</strong> : ${fmt(t.montant)} FCFA</div>`
                  ).join('')
                : c.bareme_id
                    ? '<span style="color:#B23B2E;font-size:.8rem;">Barème sans tranches</span>'
                    : '<span style="color:#9ca3af;font-size:.8rem;">Aucun barème rattaché</span>';

            return `
            <tr data-classe-id="${c.id}">
                <td style="font-weight: 600; color: #5D4037;">${c.nom}</td>
                <td style="font-size:.82rem;color:#7A6A63;">
                    ${nomBareme || '<span style="color:#B23B2E;">non défini</span>'}
                </td>
                <td style="text-align: right; font-weight: 500;">
                    ${c.frais_inscription ? fmt(c.frais_inscription) : '-'} FCFA
                </td>
                <td style="text-align: right; font-weight: 500;">
                    ${c.frais_scolarite ? fmt(c.frais_scolarite) : '-'} FCFA
                </td>
                <td>${celluleTranches}</td>
                <td style="text-align: right; font-weight: 700; color: #5D4037; font-size: 1.05rem;">
                    ${fmt(total)} FCFA
                </td>
                <td style="text-align: center;">
                    <button class="btn btn-sm btn-primary" onclick="rattacherBareme('${c.id}')" title="Rattacher / changer de barème">
                        <i class="fas fa-link"></i>
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="voirHistoriqueFrais('${c.id}')" title="Historique">
                        <i class="fas fa-history"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');

        console.log(`✅ ${classes.length} classe(s) chargée(s)`);

    } catch (error) {
        console.error('❌ Erreur chargement frais par classe:', error);
        tbody.innerHTML = `
            <tr><td colspan="7" style="text-align: center; padding: 40px; color: #ef4444;">
                <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 15px;"></i>
                <p>Erreur de chargement</p>
                <small style="color: #999;">${error.message}</small><br>
                <button onclick="loadFraisParClasse()" class="btn btn-primary" style="margin-top: 15px;">
                    <i class="fas fa-redo"></i> Réessayer
                </button>
            </td></tr>`;
    }
}

/**
 * Charge les autres frais (cantine, transport, uniforme)
 */
async function loadAutresFrais() {
    console.log('🚌 Chargement des autres frais...');
    
    const grid = document.getElementById('autresFraisGrid');
    if (!grid) {
        console.warn('⚠️ Grid autresFraisGrid non trouvé');
        return;
    }
    
    try {
        // Récupérer les frais additionnels depuis Supabase
        const { data: fraisAdd, error } = await supabaseClient
            .from('frais_additionnels')
            .select('*')
            .order('type');
        
        if (error && error.code !== '42P01') throw error; // 42P01 = table inexistante
        
        // Si la table n'existe pas ou est vide, afficher les valeurs par défaut
        // Frais réellement pratiqués dans l'établissement : cantine et tenues uniquement
        // (pas de transport, ni informatique, ni bibliothèque, ni sport)
        const fraisParDefaut = [
            {
                id: 'cantine',
                type: 'cantine',
                nom: 'Cantine Scolaire',
                montant_mensuel: 0,
                montant_annuel: 90000,   // fiche officielle CSMK
                nb_tranches: 2,
                description: 'Repas complet du lundi au vendredi — payable en 2 tranches',
                icon: 'fa-utensils',
                color: '#d97706',
                actif: true
            },
            {
                id: 'uniforme',
                type: 'uniforme',
                nom: 'Tenues scolaires',
                montant_mensuel: 0,
                montant_annuel: 25000,
                description: 'Tenue complète (2 chemises + 2 pantalons/jupes)',
                icon: 'fa-tshirt',
                color: '#db2777',
                actif: true
            }
        ];
        
        const fraisToDisplay = fraisAdd && fraisAdd.length > 0 ? fraisAdd : fraisParDefaut;
        
        grid.innerHTML = fraisToDisplay.map(f => `
            <div class="card" style="border-left: 4px solid ${f.color || '#5D4037'}; transition: all 0.3s ease;">
                <div class="card-body" style="padding: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <div style="width: 50px; height: 50px; background: ${f.color || '#5D4037'}20; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                                <i class="fas ${f.icon || 'fa-dollar-sign'}" style="font-size: 1.5rem; color: ${f.color || '#5D4037'};"></i>
                            </div>
                            <div>
                                <h4 style="margin: 0; color: #374151; font-size: 1.1rem;">${f.nom}</h4>
                                <span style="font-size: 0.85rem; color: #6b7280;">${f.description || ''}</span>
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 1.3rem; font-weight: 700; color: ${f.color || '#5D4037'};">
                                ${f.montant_annuel > 0 ? f.montant_annuel.toLocaleString('fr-FR') + ' FCFA/an' : 
                                  f.montant_mensuel > 0 ? f.montant_mensuel.toLocaleString('fr-FR') + ' FCFA/mois' : 'Gratuit'}
                            </div>
                            ${f.montant_mensuel > 0 && f.montant_annuel > 0 ? 
                                `<small style="color: #6b7280;">${f.montant_mensuel.toLocaleString('fr-FR')} FCFA/mois</small>` : ''}
                            ${f.nb_tranches > 1 ? 
                                `<br><small style="color: #6b7280;">Payable en ${f.nb_tranches} tranches</small>` : ''}
                        </div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 15px; border-top: 1px solid #e5e7eb;">
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <span class="badge ${f.actif ? 'badge-success' : 'badge-secondary'}" style="padding: 5px 12px; border-radius: 20px; font-size: 0.8rem;">
                                ${f.actif ? 'Actif' : 'Inactif'}
                            </span>
                            ${f.obligatoire ? '<span class="badge badge-warning" style="padding: 5px 12px; border-radius: 20px; font-size: 0.8rem;">Obligatoire</span>' : ''}
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-sm btn-primary" onclick="editAutreFrais('${f.id}')" title="Modifier">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm ${f.actif ? 'btn-danger' : 'btn-success'}" 
                                    onclick="toggleAutreFrais('${f.id}', ${!f.actif})" 
                                    title="${f.actif ? 'Désactiver' : 'Activer'}">
                                <i class="fas fa-${f.actif ? 'ban' : 'check'}"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
        
        console.log(`✅ ${fraisToDisplay.length} frais additionnels affichés`);
        
    } catch (error) {
        console.error('❌ Erreur chargement autres frais:', error);
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #ef4444;">
                <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 15px;"></i>
                <p>Erreur de chargement des frais additionnels</p>
            </div>
        `;
    }
}

/**
 * Charge les statistiques des frais
 */
async function loadFraisStats() {
    console.log('📊 Chargement des statistiques des frais...');
    
    try {
        // Récupérer toutes les classes
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('frais_inscription, frais_scolarite, capacite');
        
        if (error) throw error;
        
        if (!classes) return;
        
        // Calculer les statistiques
        let totalInscription = 0;
        let totalScolarite = 0;
        let capaciteTotale = 0;
        let revenuPotentiel = 0;
        
        classes.forEach(c => {
            const fi = parseInt(c.frais_inscription) || 0;
            const fs = parseInt(c.frais_scolarite) || 0;
            const cap = parseInt(c.capacite) || 0;
            totalInscription += fi;
            totalScolarite += fs;
            capaciteTotale += cap;
            // Revenu potentiel = (inscription + scolarité) × capacité, par classe
            revenuPotentiel += (fi + fs) * cap;
        });
        
        const moyenneInscription = classes.length > 0 ? Math.round(totalInscription / classes.length) : 0;
        const moyenneScolarite = classes.length > 0 ? Math.round(totalScolarite / classes.length) : 0;
        
        // Créer ou mettre à jour la section des statistiques si elle n'existe pas
        let statsContainer = document.getElementById('fraisStatsContainer');
        if (!statsContainer) {
            // Insérer après le header de la page
            const pageHeader = document.querySelector('#fraisPage .page-header');
            if (pageHeader) {
                statsContainer = document.createElement('div');
                statsContainer.id = 'fraisStatsContainer';
                statsContainer.className = 'stats-grid';
                statsContainer.style.cssText = 'grid-template-columns: repeat(4, 1fr); margin-bottom: 20px;';
                pageHeader.after(statsContainer);
            }
        }
        
        if (statsContainer) {
            statsContainer.innerHTML = `
                <div class="stat-card" style="background: linear-gradient(135deg, #5D4037 0%, #8D6E63 100%); color: white;">
                    <div class="stat-content">
                        <h3>${moyenneInscription.toLocaleString('fr-FR')} FCFA</h3>
                        <p>Moy. Inscription</p>
                    </div>
                </div>
                <div class="stat-card" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white;">
                    <div class="stat-content">
                        <h3>${moyenneScolarite.toLocaleString('fr-FR')} FCFA</h3>
                        <p>Moy. Scolarité</p>
                    </div>
                </div>
                <div class="stat-card" style="background: linear-gradient(135deg, #4f46e5 0%, #818cf8 100%); color: white;">
                    <div class="stat-content">
                        <h3>${classes.length}</h3>
                        <p>Classes configurées</p>
                    </div>
                </div>
                <div class="stat-card" style="background: linear-gradient(135deg, #d97706 0%, #fbbf24 100%); color: white;">
                    <div class="stat-content">
                        <h3>${revenuPotentiel.toLocaleString('fr-FR')} FCFA</h3>
                        <p>Revenu potentiel annuel</p>
                    </div>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('❌ Erreur statistiques frais:', error);
    }
}

window.rattacherBareme = async function(classeId) {
    try {
        const { data: classe } = await supabaseClient
            .from('classes').select('nom, bareme_id').eq('id', classeId).maybeSingle();
        const { data: baremes } = await supabaseClient
            .from('baremes_frais').select('id, nom, cycle, frais_scolarite')
            .eq('actif', true).order('cycle').order('nom');

        let m = document.getElementById('rattacherBaremeModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'rattacherBaremeModal'; m.className = 'modal';
            document.body.appendChild(m);
        }

        const fmt = n => (parseInt(n) || 0).toLocaleString('fr-FR');

        m.innerHTML =
        '<div class="modal-content" style="max-width:520px;">' +
          '<div class="modal-header">' +
            '<h3><i class="fas fa-link"></i> Barème de « ' + (classe?.nom || '') + ' »</h3>' +
            '<button class="close-modal" onclick="closeModal(\'rattacherBaremeModal\')">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<div class="form-group"><label>Barème applicable</label>' +
              '<select id="baremeSelectionne" class="form-control">' +
                '<option value="">— Aucun —</option>' +
                (baremes || []).map(b =>
                  '<option value="' + b.id + '"' + (classe?.bareme_id === b.id ? ' selected' : '') + '>' +
                  b.nom + ' (' + fmt(b.frais_scolarite) + ' FCFA)</option>'
                ).join('') +
              '</select></div>' +
            '<p style="font-size:.82rem;color:#7A6A63;">' +
              'Le montant de l\'inscription, de la scolarité et les tranches sont ' +
              'ceux du barème choisi — ils ne se saisissent plus sur la classe elle-même. ' +
              'Modifier le barème changera automatiquement toutes les classes qui le partagent.' +
            '</p>' +
            '<button type="button" class="btn btn-secondary" onclick="closeModal(\'rattacherBaremeModal\');gererBaremes()" ' +
              'style="width:100%;margin-top:8px;">' +
              '<i class="fas fa-cog"></i> Gérer les barèmes (montants, tranches)</button>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" onclick="closeModal(\'rattacherBaremeModal\')">Annuler</button> ' +
            '<button class="btn btn-primary" onclick="confirmerRattachementBareme(\'' + classeId + '\')">' +
              '<i class="fas fa-save"></i> Enregistrer</button>' +
          '</div>' +
        '</div>';
        m.style.display = 'flex';

    } catch (e) {
        console.error('❌ Ouverture rattachement barème:', e);
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

window.confirmerRattachementBareme = async function(classeId) {
    const baremeId = document.getElementById('baremeSelectionne')?.value || null;
    try {
        // Le trigger epmk_sync_frais_depuis_classe recopie immediatement
        // frais_inscription et frais_scolarite depuis le bareme choisi —
        // aucun calcul a faire ici.
        const { error } = await supabaseClient
            .from('classes').update({ bareme_id: baremeId }).eq('id', classeId);
        if (error) throw error;

        showToast('Barème rattaché', 'success');
        closeModal('rattacherBaremeModal');
        await loadFraisParClasse();
    } catch (e) {
        console.error('❌ Rattachement barème:', e);
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

/**
 * Ecran de gestion des baremes eux-memes : montants d'inscription, de
 * scolarite, et leurs tranches nommees en montants absolus. C'est ICI
 * que se modifient les vrais chiffres — jamais sur une classe.
 */
window.gererBaremes = async function() {
    try {
        const { data: baremes } = await supabaseClient
            .from('baremes_frais').select('*').eq('actif', true)
            .order('cycle').order('nom');
        const ids = (baremes || []).map(b => b.id);
        let tranchesMap = {};
        if (ids.length) {
            const { data: tranches } = await supabaseClient
                .from('tranches_bareme').select('*').in('bareme_id', ids).order('ordre');
            (tranches || []).forEach(t => {
                (tranchesMap[t.bareme_id] = tranchesMap[t.bareme_id] || []).push(t);
            });
        }

        const fmt = n => (parseInt(n) || 0).toLocaleString('fr-FR');

        let m = document.getElementById('gererBaremesModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'gererBaremesModal'; m.className = 'modal';
            document.body.appendChild(m);
        }

        m.innerHTML =
        '<div class="modal-content" style="max-width:820px;">' +
          '<div class="modal-header">' +
            '<h3><i class="fas fa-layer-group"></i> Barèmes de frais</h3>' +
            '<button class="close-modal" onclick="closeModal(\'gererBaremesModal\')">&times;</button>' +
          '</div>' +
          '<div class="modal-body" style="max-height:70vh;overflow-y:auto;">' +
            (baremes || []).map(function (b) {
                const tranches = tranchesMap[b.id] || [];
                const somme = tranches.reduce((s, t) => s + (parseFloat(t.montant) || 0), 0);
                const ecart = somme - (parseFloat(b.frais_scolarite) || 0);
                return '<div style="border:1px solid #E3D9D4;border-radius:10px;padding:14px 16px;margin-bottom:14px;">' +
                  '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">' +
                    '<strong style="color:#3E2723;">' + b.nom + '</strong>' +
                    '<span style="font-size:.78rem;color:#7A6A63;text-transform:uppercase;">' + b.cycle + '</span>' +
                  '</div>' +
                  '<div class="form-row">' +
                    '<div class="form-group" style="margin:0;"><label style="font-size:.8rem;">Inscription</label>' +
                      '<input type="number" class="form-control champ-bareme" data-bareme="' + b.id + '" data-champ="frais_inscription" ' +
                        'value="' + (b.frais_inscription || 0) + '" step="500"></div>' +
                    (b.frais_reinscription != null
                      ? '<div class="form-group" style="margin:0;"><label style="font-size:.8rem;">Réinscription</label>' +
                        '<input type="number" class="form-control champ-bareme" data-bareme="' + b.id + '" data-champ="frais_reinscription" ' +
                          'value="' + (b.frais_reinscription || 0) + '" step="500"></div>'
                      : '') +
                    '<div class="form-group" style="margin:0;"><label style="font-size:.8rem;">Scolarité (total)</label>' +
                      '<input type="number" class="form-control champ-bareme" data-bareme="' + b.id + '" data-champ="frais_scolarite" ' +
                        'value="' + (b.frais_scolarite || 0) + '" step="500" onchange="verifierSommeTranches(\'' + b.id + '\')"></div>' +
                  '</div>' +
                  (b.frais_scolarite_journee_continue != null
                    ? '<div class="form-group" style="margin-top:8px;"><label style="font-size:.8rem;">' +
                        'Variante « journée continue »</label>' +
                      '<input type="number" class="form-control champ-bareme" data-bareme="' + b.id + '" data-champ="frais_scolarite_journee_continue" ' +
                        'value="' + (b.frais_scolarite_journee_continue || 0) + '" step="500"></div>'
                    : '') +
                  '<div style="margin-top:10px;">' +
                    '<label style="font-size:.8rem;color:#7A6A63;display:block;margin-bottom:5px;">' +
                      'Tranches (montants exacts — jamais un pourcentage)</label>' +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                      tranches.map(t =>
                        '<div style="flex:1;min-width:110px;">' +
                          '<input type="text" class="form-control" value="' + t.nom + '" ' +
                            'data-tranche="' + t.id + '" data-champ="nom" style="font-size:.78rem;margin-bottom:3px;">' +
                          '<input type="number" class="form-control champ-tranche" value="' + t.montant + '" ' +
                            'data-tranche="' + t.id + '" data-bareme="' + b.id + '" data-champ="montant" step="500" ' +
                            'onchange="verifierSommeTranches(\'' + b.id + '\')">' +
                        '</div>'
                      ).join('') +
                    '</div>' +
                    '<div id="ecart-' + b.id + '" style="margin-top:6px;font-size:.78rem;' +
                      (ecart !== 0 ? 'color:#B23B2E;font-weight:600;' : 'color:#2E7D32;') + '">' +
                      (ecart === 0
                        ? '✓ Somme des tranches conforme (' + fmt(somme) + ' FCFA)'
                        : '⚠ Écart de ' + fmt(Math.abs(ecart)) + ' FCFA entre la somme des tranches (' +
                          fmt(somme) + ') et la scolarité (' + fmt(b.frais_scolarite) + ')') +
                    '</div>' +
                  '</div>' +
                '</div>';
            }).join('') +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" onclick="closeModal(\'gererBaremesModal\')">Fermer</button> ' +
            '<button class="btn btn-primary" onclick="enregistrerBaremes()">' +
              '<i class="fas fa-save"></i> Enregistrer les modifications</button>' +
          '</div>' +
        '</div>';
        m.style.display = 'flex';

    } catch (e) {
        console.error('❌ Ouverture gestion barèmes:', e);
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

/**
 * Recalcule en direct l'ecart entre la somme des tranches affichees a
 * l'ecran et le montant de scolarite — AVANT meme d'enregistrer, pour
 * que l'admin voie l'erreur au moment ou il la commet, pas apres.
 */
window.verifierSommeTranches = function (baremeId) {
    const zone = document.getElementById('ecart-' + baremeId);
    if (!zone) return;
    const champScolarite = document.querySelector(
        '.champ-bareme[data-bareme="' + baremeId + '"][data-champ="frais_scolarite"]');
    const champsTranches = document.querySelectorAll(
        '.champ-tranche[data-bareme="' + baremeId + '"]');

    const scolarite = parseFloat(champScolarite?.value) || 0;
    let somme = 0;
    champsTranches.forEach(c => { somme += parseFloat(c.value) || 0; });
    const ecart = somme - scolarite;
    const fmt = n => Math.round(n).toLocaleString('fr-FR');

    if (ecart === 0) {
        zone.style.color = '#2E7D32'; zone.style.fontWeight = 'normal';
        zone.textContent = '✓ Somme des tranches conforme (' + fmt(somme) + ' FCFA)';
    } else {
        zone.style.color = '#B23B2E'; zone.style.fontWeight = '600';
        zone.textContent = '⚠ Écart de ' + fmt(Math.abs(ecart)) + ' FCFA';
    }
};

/**
 * Enregistre TOUS les baremes modifies en une fois. Bloque si un ecart
 * subsiste entre la somme des tranches et le total de scolarite : un
 * bareme incoherent ne doit jamais etre enregistre silencieusement.
 */
window.enregistrerBaremes = async function () {
    const parBareme = {};

    document.querySelectorAll('.champ-bareme').forEach(c => {
        const id = c.dataset.bareme;
        (parBareme[id] = parBareme[id] || { champs: {}, tranches: {} })
            .champs[c.dataset.champ] = parseFloat(c.value) || 0;
    });
    // Regroupement des tranches par leur propre identifiant — le champ
    // montant porte data-bareme, les autres (nom) n'en ont pas besoin.
    const tranchesParId = {};
    document.querySelectorAll('[data-tranche]').forEach(c => {
        const tid = c.dataset.tranche;
        (tranchesParId[tid] = tranchesParId[tid] || {})[c.dataset.champ] = c.value;
    });

    // Controle de coherence AVANT tout enregistrement.
    for (const [baremeId, info] of Object.entries(parBareme)) {
        const champsTranches = document.querySelectorAll(
            '.champ-tranche[data-bareme="' + baremeId + '"]');
        let somme = 0;
        champsTranches.forEach(c => { somme += parseFloat(c.value) || 0; });
        const scolarite = info.champs.frais_scolarite || 0;
        if (Math.round(somme) !== Math.round(scolarite)) {
            showToast('Écart détecté sur un barème : la somme des tranches (' +
                somme.toLocaleString('fr-FR') + ') ne correspond pas à la scolarité (' +
                scolarite.toLocaleString('fr-FR') + '). Corrigez avant d\'enregistrer.', 'error', 9000);
            return;
        }
    }

    try {
        for (const [baremeId, info] of Object.entries(parBareme)) {
            const { error } = await supabaseClient
                .from('baremes_frais').update(info.champs).eq('id', baremeId);
            if (error) throw error;
        }
        for (const [tid, champs] of Object.entries(tranchesParId)) {
            const maj = {};
            if (champs.nom !== undefined) maj.nom = champs.nom;
            if (champs.montant !== undefined) maj.montant = parseFloat(champs.montant) || 0;
            const { error } = await supabaseClient
                .from('tranches_bareme').update(maj).eq('id', tid);
            if (error) throw error;
        }

        showToast('Barèmes mis à jour', 'success');
        closeModal('gererBaremesModal');
        await loadFraisParClasse();

    } catch (e) {
        console.error('❌ Enregistrement barèmes:', e);
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

/**
 * Affiche l'historique des modifications de frais
 */
window.voirHistoriqueFrais = async function(classeId) {
    console.log('📜 Historique des frais pour la classe:', classeId);
    
    try {
        const { data: historique, error } = await supabaseClient
            .from('historique_frais')
            .select('*, profiles(full_name)')
            .eq('classe_id', classeId)
            .order('modified_at', { ascending: false })
            .limit(10);
        
        if (error && error.code !== '42P01') throw error;
        
        // Créer le modal d'historique
        let modal = document.getElementById('historiqueFraisModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'historiqueFraisModal';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }
        
        const content = historique && historique.length > 0 
            ? historique.map(h => `
                <div style="padding: 15px; border-bottom: 1px solid #e5e7eb; ${h.frais_scolarite_new !== h.frais_scolarite_old ? 'background: #fef3c7;' : ''}">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                        <span style="font-weight: 600; color: #5D4037;">
                            ${new Date(h.modified_at).toLocaleDateString('fr-FR', { 
                                day: '2-digit', 
                                month: 'long', 
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            })}
                        </span>
                        <span style="color: #666; font-size: 0.9rem;">
                            par ${h.profiles?.full_name || 'Admin'}
                        </span>
                    </div>
                    ${h.frais_inscription_new !== h.frais_inscription_old ? `
                        <div style="margin-bottom: 5px;">
                            <span style="color: #666;">Inscription:</span>
                            <span style="text-decoration: line-through; color: #ef4444; margin-left: 10px;">
                                ${(h.frais_inscription_old || 0).toLocaleString('fr-FR')} FCFA
                            </span>
                            <i class="fas fa-arrow-right" style="margin: 0 10px; color: #666;"></i>
                            <span style="color: #10b981; font-weight: 600;">
                                ${(h.frais_inscription_new || 0).toLocaleString('fr-FR')} FCFA
                            </span>
                        </div>
                    ` : ''}
                    ${h.frais_scolarite_new !== h.frais_scolarite_old ? `
                        <div>
                            <span style="color: #666;">Scolarité:</span>
                            <span style="text-decoration: line-through; color: #ef4444; margin-left: 10px;">
                                ${(h.frais_scolarite_old || 0).toLocaleString('fr-FR')} FCFA
                            </span>
                            <i class="fas fa-arrow-right" style="margin: 0 10px; color: #666;"></i>
                            <span style="color: #10b981; font-weight: 600;">
                                ${(h.frais_scolarite_new || 0).toLocaleString('fr-FR')} FCFA
                            </span>
                        </div>
                    ` : ''}
                </div>
            `).join('')
            : '<div style="padding: 40px; text-align: center; color: #666;">Aucun historique disponible</div>';
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header" style="background: #5D4037; color: white;">
                    <h3><i class="fas fa-history"></i> Historique des modifications</h3>
                    <button class="close-modal" onclick="closeModal('historiqueFraisModal')" style="background: none; border: none; color: white; font-size: 1.5rem;">&times;</button>
                </div>
                <div class="modal-body" style="padding: 0; max-height: 500px; overflow-y: auto;">
                    ${content}
                </div>
            </div>
        `;
        
        openModal('historiqueFraisModal');
        
    } catch (error) {
        console.error('❌ Erreur chargement historique:', error);
        showToast('Erreur lors du chargement de l\'historique', 'error');
    }
};

/**
 * Édite un frais additionnel (cantine, transport, etc.)
 */
window.editAutreFrais = async function(fraisId) {
    console.log('✏️ Édition du frais:', fraisId);
    
    try {
        // Récupérer les données actuelles (peut ne pas exister encore en base)
        let frais = null;
        try {
            const { data } = await supabaseClient
                .from('frais_additionnels')
                .select('*')
                .eq('id', fraisId)
                .maybeSingle();
            frais = data;
        } catch (_) { frais = null; }

        // Valeurs par défaut connues si le frais n'est pas encore en base
        if (!frais) {
            const defauts = {
                cantine:  { id:'cantine',  type:'cantine',  nom:'Cantine Scolaire', montant_mensuel:15000, montant_annuel:135000, description:'Repas complet du lundi au vendredi' },
                uniforme: { id:'uniforme', type:'uniforme', nom:'Tenues scolaires', montant_mensuel:0, montant_annuel:25000, description:'Tenue complète (2 chemises + 2 pantalons/jupes)' }
            };
            frais = defauts[fraisId] || { id: fraisId, type: fraisId, nom: '', montant_mensuel:0, montant_annuel:0, description:'' };
        }
        
        // Créer le modal
        let modal = document.getElementById('editAutreFraisModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'editAutreFraisModal';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }
        
        const typesFrais = [
            { value: 'cantine', label: 'Cantine Scolaire', icon: 'fa-utensils' },
            { value: 'uniforme', label: 'Tenues scolaires', icon: 'fa-tshirt' },
            { value: 'examen', label: 'Frais d\'examen', icon: 'fa-file-alt' },
            { value: 'autre', label: 'Autre frais', icon: 'fa-dollar-sign' }
        ];
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header" style="background: linear-gradient(135deg, #5D4037 0%, #8D6E63 100%); color: white;">
                    <h3><i class="fas fa-edit"></i> Modifier le Frais</h3>
                    <button class="close-modal" onclick="closeModal('editAutreFraisModal')" style="background: none; border: none; color: white; font-size: 1.5rem;">&times;</button>
                </div>
                <div class="modal-body" style="padding: 25px;">
                    <form id="editAutreFraisForm" onsubmit="saveAutreFrais(event)">
                        <input type="hidden" id="editAutreFraisId" value="${frais?.id || fraisId}">
                        
                        <div class="form-group" style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Type de frais</label>
                            <select id="editAutreFraisType" class="form-control" required 
                                    style="width: 100%; padding: 10px; border: 2px solid #8D6E63; border-radius: 6px;">
                                ${typesFrais.map(t => `
                                    <option value="${t.value}" ${frais?.type === t.value ? 'selected' : ''}>
                                        ${t.label}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                        
                        <div class="form-group" style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Nom affiché</label>
                            <input type="text" id="editAutreFraisNom" required
                                   value="${frais?.nom || ''}"
                                   style="width: 100%; padding: 10px; border: 2px solid #8D6E63; border-radius: 6px;">
                        </div>
                        
                        <div class="form-row" style="display: flex; gap: 15px; margin-bottom: 15px;">
                            <div class="form-group" style="flex: 1;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">Montant mensuel (FCFA)</label>
                                <input type="number" id="editAutreFraisMensuel" min="0" step="1000"
                                       value="${frais?.montant_mensuel || 0}"
                                       style="width: 100%; padding: 10px; border: 2px solid #8D6E63; border-radius: 6px;">
                            </div>
                            <div class="form-group" style="flex: 1;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 600;">Montant annuel (FCFA)</label>
                                <input type="number" id="editAutreFraisAnnuel" min="0" step="5000"
                                       value="${frais?.montant_annuel || 0}"
                                       style="width: 100%; padding: 10px; border: 2px solid #8D6E63; border-radius: 6px;">
                            </div>
                        </div>
                        
                        <div class="form-group" style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Description</label>
                            <textarea id="editAutreFraisDesc" rows="2"
                                      style="width: 100%; padding: 10px; border: 2px solid #8D6E63; border-radius: 6px;">${frais?.description || ''}</textarea>
                        </div>
                        
                        <div class="form-group" style="margin-bottom: 20px;">
                            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                                <input type="checkbox" id="editAutreFraisObligatoire" ${frais?.obligatoire ? 'checked' : ''}
                                       style="width: 18px; height: 18px;">
                                <span>Ce frais est obligatoire pour tous les élèves</span>
                            </label>
                        </div>
                        
                        <div class="form-actions" style="display: flex; gap: 10px; justify-content: flex-end;">
                            <button type="button" class="btn btn-secondary" onclick="closeModal('editAutreFraisModal')"
                                    style="background: #9E9E9E; color: white; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer;">
                                Annuler
                            </button>
                            <button type="submit" class="btn btn-primary"
                                    style="background: #5D4037; color: white; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer;">
                                <i class="fas fa-save" style="margin-right: 5px;"></i> Enregistrer
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        openModal('editAutreFraisModal');
        
    } catch (error) {
        console.error('❌ Erreur édition frais additionnel:', error);
        showToast('Erreur: ' + error.message, 'error');
    }
};

/**
 * Sauvegarde un frais additionnel
 */
window.saveAutreFrais = async function(e) {
    e.preventDefault();
    
    const id = document.getElementById('editAutreFraisId')?.value;
    const type = document.getElementById('editAutreFraisType')?.value;
    const nom = document.getElementById('editAutreFraisNom')?.value;
    const montantMensuel = parseInt(document.getElementById('editAutreFraisMensuel')?.value) || 0;
    const montantAnnuel = parseInt(document.getElementById('editAutreFraisAnnuel')?.value) || 0;
    const description = document.getElementById('editAutreFraisDesc')?.value;
    const obligatoire = document.getElementById('editAutreFraisObligatoire')?.checked || false;
    
    try {
        const fraisData = {
            id,
            type,
            nom,
            montant_mensuel: montantMensuel,
            montant_annuel: montantAnnuel,
            description,
            obligatoire,
            actif: true,
            updated_at: new Date().toISOString()
        };

        // upsert : insère si absent, met à jour si présent (selon la clé primaire id)
        const { error } = await supabaseClient
            .from('frais_additionnels')
            .upsert([fraisData], { onConflict: 'id' });

        if (error) {
            if (error.code === '42P01') {
                showToast('La table « frais_additionnels » n\'existe pas. Exécutez sql-frais-additionnels.sql.', 'error');
                return;
            }
            throw error;
        }

        showToast('Frais enregistré avec succès', 'success');
        closeModal('editAutreFraisModal');
        await loadAutresFrais();
        
    } catch (error) {
        console.error('❌ Erreur sauvegarde frais:', error);
        showToast('Erreur: ' + (error.message || 'réessayez'), 'error');
    }
};

/**
 * Active/désactive un frais additionnel
 */
window.toggleAutreFrais = async function(fraisId, activer) {
    console.log(`${activer ? '✅ Activation' : '❌ Désactivation'} du frais:`, fraisId);
    
    if (!confirm(`Êtes-vous sûr de vouloir ${activer ? 'activer' : 'désactiver'} ce frais ?`)) {
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('frais_additionnels')
            .update({ 
                actif: activer,
                updated_at: new Date().toISOString()
            })
            .eq('id', fraisId);
        
        if (error) throw error;
        
        showToast(`Frais ${activer ? 'activé' : 'désactivé'} avec succès`, 'success');
        await loadAutresFrais();
        
    } catch (error) {
        console.error('❌ Erreur toggle frais:', error);
        showToast('Erreur: ' + error.message, 'error');
    }
};

/**
 * Retourne l'année scolaire en cours
 */
function getCurrentSchoolYear() {
    const now = new Date();
    const month = now.getMonth(); // 0-11
    const year = now.getFullYear();
    
    // Si on est avant septembre, l'année scolaire a commencé l'année précédente
    if (month < 8) { // Avant septembre (index 8)
        return `${year - 1}-${year}`;
    }
    return `${year}-${year + 1}`;
}

/**
 * Exporte la configuration des frais en CSV
 */
window.exportFraisCSV = async function() {
    console.log('📤 Export des frais en CSV...');

    try {
        // Classes ET leurs vraies tranches nommees — requetes separees,
        // jointure en JS (pas de jointure PostgREST sur ce projet).
        const { data: classes, error } = await supabaseClient
            .from('classes')
            .select('nom, niveau, frais_inscription, frais_scolarite, bareme_id')
            .order('nom');
        if (error) throw error;

        const baremeIds = [...new Set(classes.map(c => c.bareme_id).filter(Boolean))];
        let tranchesMap = {};
        if (baremeIds.length) {
            const { data: tranches } = await supabaseClient
                .from('tranches_bareme').select('bareme_id, ordre, nom, montant')
                .in('bareme_id', baremeIds).order('ordre');
            (tranches || []).forEach(t => {
                (tranchesMap[t.bareme_id] = tranchesMap[t.bareme_id] || []).push(t);
            });
        }

        // Le nombre de tranches varie d'un bareme a l'autre (pas de
        // pourcentage fixe) : l'en-tete s'adapte au maximum reellement
        // rencontre, plutot que de figer 3 colonnes a l'avance.
        const maxTranches = Math.max(1, ...Object.values(tranchesMap).map(t => t.length));
        const entetesTranches = Array.from({ length: maxTranches },
            (_, i) => `Tranche ${i + 1}`).join(',');

        let csv = `Classe,Niveau,Frais Inscription (FCFA),Frais Scolarité (FCFA),${entetesTranches},Total Annuel\n`;

        classes.forEach(c => {
            const tranches = tranchesMap[c.bareme_id] || [];
            const total = (parseInt(c.frais_inscription) || 0) + (parseInt(c.frais_scolarite) || 0);
            // Chaque colonne porte le NOM et le MONTANT reels de la tranche —
            // jamais un pourcentage recalcule.
            const colonnesTranches = Array.from({ length: maxTranches }, (_, i) => {
                const t = tranches[i];
                return t ? `${t.nom}: ${t.montant}` : '';
            }).join(',');

            csv += `"${c.nom}","${c.niveau || ''}",${c.frais_inscription || 0},${c.frais_scolarite || 0},${colonnesTranches},${total}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `frais_scolarite_${getCurrentSchoolYear()}.csv`;
        link.click();

        showToast('Export CSV téléchargé', 'success');

    } catch (error) {
        console.error('❌ Erreur export CSV:', error);
        showToast('Erreur lors de l\'export', 'error');
    }
};

// ============================================
// EXPOSITION GLOBALE
// ============================================

window.loadFrais = loadFrais;
window.saveFraisClasse = saveFraisClasse;
window.voirHistoriqueFrais = voirHistoriqueFrais;
window.editAutreFrais = editAutreFrais;
window.saveAutreFrais = saveAutreFrais;
window.toggleAutreFrais = toggleAutreFrais;
window.exportFraisCSV = exportFraisCSV;

// ============================================
// SECTION UTILISATEURS - COMPLÈTEMENT FONCTIONNELLE
// ============================================

let allUsers = [];
let currentUserId = null;

/**
 * Charge la liste des utilisateurs
 */
async function loadUtilisateurs() {
    console.log('👥 Chargement des utilisateurs...');
    
    const tbody = document.getElementById('usersTableBody');
    const countEl = document.getElementById('usersCount');
    
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #8D6E63; margin-bottom: 15px; display: block;"></i>
                    Chargement des utilisateurs...
                </td>
            </tr>
        `;
    }
    
    try {
        // Récupérer tous les profils depuis la table profiles
        const { data: profiles, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('❌ Erreur Supabase:', error);
            
            // Si la table n'existe pas, afficher un message
            if (error.code === '42P01') {
                if (tbody) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="7" style="text-align: center; padding: 40px; color: #f59e0b;">
                                <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 15px;"></i>
                                <p>La table des profils n'existe pas encore</p>
                                <small style="color: #666;">Exécutez le script SQL pour créer la table profiles</small>
                                <br>
                                <button onclick="showCreateProfilesSQL()" class="btn btn-primary" style="margin-top: 15px;">
                                    <i class="fas fa-database"></i> Voir le SQL
                                </button>
                            </td>
                        </tr>
                    `;
                }
                return;
            }
            throw error;
        }
        
        allUsers = profiles || [];
        console.log(`✅ ${allUsers.length} utilisateur(s) chargé(s)`);
        
        // Dernière connexion réelle (depuis le journal des connexions)
        try {
            const { data: jc } = await supabaseClient
                .from('journal_connexions')
                .select('user_id, created_at')
                .eq('action', 'connexion')
                .order('created_at', { ascending: false })
                .limit(800);
            const lastMap = {};
            (jc || []).forEach(j => { if (!lastMap[j.user_id]) lastMap[j.user_id] = j.created_at; });
            allUsers.forEach(u => { if (lastMap[u.id]) u.last_login = lastMap[u.id]; });
        } catch (e) { console.warn('Journal connexions non disponible:', e?.message); }
        
        // Mettre à jour les statistiques
        updateUserStats(allUsers);
        
        // Afficher les utilisateurs
        renderUsersTable(allUsers);
        
        // Journal des connexions (panneau dédié)
        loadJournalConnexions();
        
        if (countEl) {
            countEl.textContent = allUsers.length;
        }
        
    } catch (error) {
        console.error('❌ Erreur chargement utilisateurs:', error);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 40px; color: #ef4444;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 15px;"></i>
                        <p>Erreur: ${error.message}</p>
                        <button onclick="loadUtilisateurs()" class="btn btn-primary" style="margin-top: 15px;">
                            <i class="fas fa-redo"></i> Réessayer
                        </button>
                    </td>
                </tr>
            `;
        }
    }
}

/**
 * Met à jour les statistiques des utilisateurs
 */
function updateUserStats(users) {
    const total = users.length;
    // Administration = tous les rôles de gestion (super admin, admin, comptable)
    const administration = users.filter(u => ['super_admin', 'admin', 'comptable'].includes(u.role)).length;
    const suspendus = users.filter(u => u.status === 'suspendu').length;
    
    updateCounter('totalUsers', total);
    updateCounter('adminCount', administration);
    updateCounter('suspendusCount', suspendus);
    // Parents actifs (30 j) : calcul asynchrone depuis le journal
    updateParentsActifs();
}

// Nombre de comptes parents DISTINCTS connectés ces 30 derniers jours
async function updateParentsActifs() {
    try {
        const depuis = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabaseClient
            .from('journal_connexions')
            .select('user_id, role, created_at')
            .eq('role', 'parent')
            .eq('action', 'connexion')
            .gte('created_at', depuis);
        if (error) throw error;
        const distincts = new Set((data || []).map(j => j.user_id));
        updateCounter('parentsActifsCount', distincts.size);
    } catch (e) {
        console.warn('Parents actifs non calculés:', e?.message);
        updateCounter('parentsActifsCount', 0);
    }
}

/**
 * Affiche le tableau des utilisateurs
 */
function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    const noMsg = document.getElementById('noUsersMsg');
    
    if (!tbody) return;
    
    // Appliquer les filtres
    const roleFilter = document.getElementById('filterUserRole')?.value || 'all';
    const statusFilter = document.getElementById('filterUserStatus')?.value || 'all';
    const searchTerm = document.getElementById('searchUser')?.value?.toLowerCase()?.trim();
    
    let filtered = users;
    
    if (roleFilter !== 'all') {
        filtered = filtered.filter(u => u.role === roleFilter);
    }
    
    if (statusFilter !== 'all') {
        filtered = filtered.filter(u => u.status === statusFilter);
    }
    
    if (searchTerm) {
        filtered = filtered.filter(u => {
            const fullName = `${u.last_name || ''} ${u.first_name || ''}`.toLowerCase();
            const email = (u.email || '').toLowerCase();
            return fullName.includes(searchTerm) || email.includes(searchTerm);
        });
    }
    
    const countEl = document.getElementById('usersCount');
    if (countEl) countEl.textContent = filtered.length;
    
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 60px; color: #9ca3af;">
                    <i class="fas fa-users-slash" style="font-size: 3rem; margin-bottom: 20px; display: block;"></i>
                    <p>Aucun utilisateur trouvé</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = filtered.map((user, index) => {
        const roleLabels = {
            'super_admin': { text: 'Super Admin', color: '#7c3aed', bg: '#ede9fe' },
            'admin': { text: 'Administrateur', color: '#4f46e5', bg: '#e0e7ff' },
            'enseignant': { text: 'Enseignant', color: '#059669', bg: '#d1fae5' },
            'comptable': { text: 'Comptable', color: '#d97706', bg: '#fef3c7' },
            'parent': { text: 'Parent', color: '#8B5A2B', bg: '#fef3c7' },
            'eleve': { text: 'Élève', color: '#2563eb', bg: '#dbeafe' }
        };
        
        const roleInfo = roleLabels[user.role] || { text: user.role, color: '#6b7280', bg: '#f3f4f6' };
        
        const statusLabels = {
            'actif': { text: 'Actif', color: '#10b981', bg: '#d1fae5' },
            'inactif': { text: 'Inactif', color: '#9ca3af', bg: '#f3f4f6' },
            'suspendu': { text: 'Suspendu', color: '#ef4444', bg: '#fee2e2' }
        };
        
        const statusInfo = statusLabels[user.status] || { text: user.status || 'Inconnu', color: '#6b7280', bg: '#f3f4f6' };
        
        const lastLogin = user.last_login ? new Date(user.last_login).toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : 'Jamais';
        
        return `
        <tr data-user-id="${user.id}">
            <td style="text-align: center;">${index + 1}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 35px; height: 35px; background: linear-gradient(135deg, #5D4037, #8D6E63); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 0.9rem;">
                        ${(user.first_name?.[0] || '')}${(user.last_name?.[0] || '')}
                    </div>
                    <div>
                        <strong style="color: #374151;">${user.last_name || ''} ${user.first_name || ''}</strong>
                        ${user.role === 'enseignant' ? '<br><small style="color: #666;">' + (user.subjects?.join(', ') || '') + '</small>' : ''}
                    </div>
                </div>
            </td>
            <td>
                <span style="color: #2563eb;">${user.email || '-'}</span>
                ${user.phone ? `<br><small style="color: #666;">${user.phone}</small>` : ''}
            </td>
            <td>
                <span style="background: ${roleInfo.bg}; color: ${roleInfo.color}; padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; font-weight: 500; display: inline-block;">
                    ${roleInfo.text}
                </span>
            </td>
            <td>
                <span style="background: ${statusInfo.bg}; color: ${statusInfo.color}; padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; font-weight: 500; display: inline-block;">
                    ${statusInfo.text}
                </span>
            </td>
            <td style="font-size: 0.9rem; color: #6b7280;">${lastLogin}</td>
            <td>
                <div style="display: flex; gap: 5px; justify-content: center;">
                    ${user.status === 'suspendu'
                        ? `<button class="btn btn-sm btn-success" onclick="toggleUserStatus('${user.id}', 'suspendu')" title="Réactiver ce compte">
                               <i class="fas fa-user-check"></i> Réactiver
                           </button>`
                        : `<button class="btn btn-sm btn-warning" onclick="toggleUserStatus('${user.id}', '${user.status || 'actif'}')" title="Suspendre : bloque la connexion, réversible">
                               <i class="fas fa-user-slash"></i> Suspendre
                           </button>`}
                    <button class="btn btn-sm btn-danger" onclick="deleteUser('${user.id}')" title="Supprimer définitivement">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

/**
 * Filtre les utilisateurs
 */
window.filterUsers = function() {
    console.log('🔍 Filtrage des utilisateurs...');
    renderUsersTable(allUsers);
};

/**
 * Rafraîchit la liste des utilisateurs
 */
window.refreshUtilisateurs = async function() {
    console.log('🔄 Rafraîchissement utilisateurs...');
    await loadUtilisateurs();
    showToast('Données actualisées', 'success');
};

/**
 * Ouvre le modal d'ajout d'utilisateur
 */
window.openAddUserModal = function() {
    console.log('🚀 Ouverture modal ajout utilisateur...');
    
    // Réinitialiser le formulaire
    const form = document.getElementById('userForm');
    if (form) form.reset();
    
    document.getElementById('userId').value = '';
    document.getElementById('userModalTitle').innerHTML = '<i class="fas fa-user-plus"></i> Nouvel Utilisateur';
    document.getElementById('userSubmitBtn').innerHTML = '<i class="fas fa-save"></i> Créer l\'utilisateur';
    document.getElementById('passwordField').style.display = 'block';
    document.getElementById('userRoleSpecificSection').style.display = 'none';
    
    // Valeurs par défaut
    document.getElementById('userPassword').value = 'User123!';
    document.getElementById('userStatus').value = 'actif';
    
    openModal('userModal');
};

/**
 * Génère un mot de passe aléatoire
 */
window.generatePassword = function() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$';
    let password = '';
    for (let i = 0; i < 10; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById('userPassword').value = password;
};

/**
 * Gère le changement de rôle
 */
window.onUserRoleChange = function() {
    const role = document.getElementById('userRole')?.value;
    const section = document.getElementById('userRoleSpecificSection');
    
    if (!section) return;
    
    section.style.display = 'none';
    section.innerHTML = '';
    
    if (role === 'enseignant') {
        section.style.display = 'block';
        section.innerHTML = `
            <h5 style="margin: 0 0 10px 0; color: #374151; font-size: 0.95rem;">
                <i class="fas fa-chalkboard-teacher"></i> Informations enseignant
            </h5>
            <div class="form-group">
                <label style="display: block; margin-bottom: 5px; font-weight: 500;">Matières enseignées</label>
                <select id="teacherSubjects" multiple style="width: 100%; padding: 8px; border: 2px solid #8D6E63; border-radius: 6px; min-height: 100px;">
                    ${getMatieresOptions()}
                </select>
                <small style="color: #666;">Maintenez Ctrl pour sélectionner plusieurs matières</small>
            </div>
        `;
        loadMatieresForTeacherSelect();
    }
};

/**
 * Sauvegarde un utilisateur (création ou modification)
 */
window.saveUser = async function(e) {
    e.preventDefault();
    console.log('💾 Sauvegarde utilisateur...');
    
    const userId = document.getElementById('userId')?.value;
    const isNew = !userId;
    
    const userData = {
        first_name: document.getElementById('userFirstName')?.value?.trim(),
        last_name: document.getElementById('userLastName')?.value?.trim(),
        email: document.getElementById('userEmail')?.value?.trim(),
        role: document.getElementById('userRole')?.value,
        status: document.getElementById('userStatus')?.value || 'actif',
        updated_at: new Date().toISOString()
    };
    
    // Validation
    if (!userData.first_name || !userData.last_name) {
        showToast('Veuillez saisir le nom et prénom', 'error');
        return;
    }
    
    if (!userData.email) {
        showToast('Veuillez saisir un email', 'error');
        return;
    }
    
    if (!userData.role) {
        showToast('Veuillez sélectionner un rôle', 'error');
        return;
    }
    
    const submitBtn = document.getElementById('userSubmitBtn');
    const originalText = submitBtn?.innerHTML;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...';
    }
    
    try {
        if (isNew) {
            // Création d'un nouvel utilisateur
            const password = document.getElementById('userPassword')?.value;
            if (!password) {
                showToast('Veuillez saisir un mot de passe', 'error');
                return;
            }
            
            // Créer dans Auth
            const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
    options: {
        data: {
            first_name: firstName,
            last_name: lastName,
            role: 'parent'
        }
    }
});
            
            if (authError) throw authError;
            
            if (!authData.user) {
                throw new Error('Erreur lors de la création du compte');
            }
            
            // Créer le profil
            const { error: profileError } = await supabaseClient
                .from('profiles')
                .insert([{
                    id: authData.user.id,
                    first_name: userData.first_name,
                    last_name: userData.last_name,
                    email: userData.email,
                    role: userData.role,
                    status: userData.status,
                    created_at: new Date().toISOString()
                }]);
            
            if (profileError) {
                // Rollback
                await supabaseClient.auth.admin.deleteUser(authData.user.id).catch(console.error);
                throw profileError;
            }
            
            // Rôle spécifique
            if (userData.role === 'enseignant') {
                const subjects = Array.from(document.getElementById('teacherSubjects')?.selectedOptions || [])
                    .map(o => o.value);
                
                await supabaseClient
                    .from('teachers')
                    .insert([{
                        id: authData.user.id,
                        first_name: userData.first_name,
                        last_name: userData.last_name,
                        email: userData.email,
                        subjects: subjects
                    }])
                    .then(null, console.warn); // builder Supabase : pas de .catch
            }
            
            showToast('Utilisateur créé avec succès !', 'success');
            
        } else {
            // Modification
            const { error } = await supabaseClient
                .from('profiles')
                .update(userData)
                .eq('id', userId);
            
            if (error) throw error;
            
            showToast('Utilisateur modifié avec succès', 'success');
        }
        
        closeModal('userModal');
        await loadUtilisateurs();
        
    } catch (error) {
        console.error('❌ Erreur sauvegarde:', error);
        showToast('Erreur: ' + error.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Enregistrer';
        }
    }
};

/**
 * Voir les détails d'un utilisateur
 */
window.viewUser = async function(userId) {
    console.log('👁️ Vue utilisateur:', userId);
    currentUserId = userId;
    
    try {
        const { data: user, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        
        if (error) throw error;
        
        if (!user) {
            showToast('Utilisateur non trouvé', 'error');
            return;
        }
        
        // Avatar
        const avatar = document.getElementById('detailsAvatar');
        if (avatar) {
            avatar.textContent = (user.first_name?.[0] || '') + (user.last_name?.[0] || '');
        }
        
        document.getElementById('detailsFullName').textContent = `${user.last_name || ''} ${user.first_name || ''}`;
        document.getElementById('detailsEmail').textContent = user.email || '-';
        
        const roleLabels = {
            'super_admin': 'Super Administrateur',
            'admin': 'Administrateur',
            'enseignant': 'Enseignant',
            'comptable': 'Comptable',
            'parent': 'Parent',
            'eleve': 'Élève'
        };
        document.getElementById('detailsRole').textContent = roleLabels[user.role] || user.role;
        
        const statusLabels = {
            'actif': 'Actif',
            'inactif': 'Inactif',
            'suspendu': 'Suspendu'
        };
        document.getElementById('detailsStatus').textContent = statusLabels[user.status] || user.status;
        
        const lastLogin = user.last_login ? new Date(user.last_login).toLocaleString('fr-FR') : 'Jamais';
        document.getElementById('detailsLastLogin').textContent = lastLogin;
        
        const created = user.created_at ? new Date(user.created_at).toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : '-';
        document.getElementById('detailsCreatedAt').textContent = created;
        
        openModal('userDetailsModal');
        
    } catch (error) {
        console.error('❌ Erreur chargement détails:', error);
        showToast('Erreur: ' + error.message, 'error');
    }
};

/**
 * Éditer un utilisateur
 */
window.editUser = async function(userId) {
    console.log('✏️ Édition utilisateur:', userId);
    currentUserId = userId;
    
    try {
        const { data: user, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
        
        if (error) throw error;
        
        document.getElementById('userId').value = user.id;
        document.getElementById('userLastName').value = user.last_name || '';
        document.getElementById('userFirstName').value = user.first_name || '';
        document.getElementById('userEmail').value = user.email || '';
        document.getElementById('userRole').value = user.role || '';
        document.getElementById('userStatus').value = user.status || 'actif';
        
        document.getElementById('passwordField').style.display = 'none';
        document.getElementById('userModalTitle').innerHTML = '<i class="fas fa-edit"></i> Modifier l\'utilisateur';
        document.getElementById('userSubmitBtn').innerHTML = '<i class="fas fa-save"></i> Enregistrer les modifications';
        
        onUserRoleChange();
        
        openModal('userModal');
        
    } catch (error) {
        console.error('❌ Erreur chargement utilisateur:', error);
        showToast('Erreur: ' + error.message, 'error');
    }
};

/**
 * Ouvre le modal de réinitialisation de mot de passe
 */
window.resetUserPasswordModal = function(userId, userName) {
    console.log('🔐 Réinitialisation mot de passe:', userId);
    
    document.getElementById('resetUserId').value = userId;
    document.getElementById('resetUserName').textContent = userName;
    document.getElementById('newPassword').value = generateSecurePassword();
    
    openModal('resetPasswordModal');
};

/**
 * Génère un mot de passe sécurisé
 */
function generateSecurePassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

window.generateNewPassword = generateSecurePassword;

/**
 * Réinitialise le mot de passe d'un utilisateur
 */
window.resetUserPassword = async function(e) {
    e.preventDefault();
    
    const userId = document.getElementById('resetUserId')?.value;
    const newPassword = document.getElementById('newPassword')?.value;
    
    if (!userId || !newPassword) {
        showToast('Erreur: données manquantes', 'error');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn?.innerHTML;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Réinitialisation...';
    }
    
    try {
        // Note: Cette opération nécessite des privilèges admin
        // Idéalement, utilisez une fonction Edge Function
        const { error } = await supabaseClient.auth.admin.updateUserById(userId, {
            password: newPassword
        });
        
        if (error) throw error;
        
        showToast('Mot de passe réinitialisé avec succès !', 'success');
        closeModal('resetPasswordModal');
        
    } catch (error) {
        console.error('❌ Erreur réinitialisation:', error);
        showToast('Erreur: ' + error.message + '. Utilisez la fonction "Mot de passe oublié" à la place.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText || '<i class="fas fa-key"></i> Réinitialiser';
        }
    }
};

/**
 * Édite l'utilisateur courant depuis le modal de détails
 */
window.editCurrentUser = function() {
    if (currentUserId) {
        closeModal('userDetailsModal');
        editUser(currentUserId);
    }
};

/**
 * Supprime l'utilisateur courant
 */
window.deleteCurrentUser = async function() {
    if (currentUserId) {
        closeModal('userDetailsModal');
        await deleteUser(currentUserId);
    }
};

/**
 * Supprime un utilisateur
 */
window.deleteUser = async function(userId) {
    console.log('🗑️ Suppression utilisateur:', userId);
    
    try {
        const { data: { user: me } } = await supabaseClient.auth.getUser();
        if (me && me.id === userId) {
            showToast('Vous ne pouvez pas supprimer votre propre compte.', 'error');
            return;
        }
    } catch (_) {}
    
    if (!confirm('Supprimer définitivement ce compte ?\n\nSes liaisons (enfants, rôles) seront retirées. Préférez « Suspendre » si vous voulez seulement bloquer l\'accès.')) {
        return;
    }
    
    try {
        // Nettoyer les liaisons parent-enfants avant la fiche parent
        await supabaseClient
            .from('parent_students')
            .delete()
            .eq('parent_id', userId)
            .then(null, console.warn);
        
        // Supprimer le profil
        const { error: profileError } = await supabaseClient
            .from('profiles')
            .delete()
            .eq('id', userId);
        
        if (profileError) throw profileError;
        
        // Supprimer les rôles spécifiques
        await supabaseClient
            .from('teachers')
            .delete()
            .eq('id', userId)
            .then(null, console.warn); // builder Supabase : pas de .catch
        
        await supabaseClient
            .from('parents')
            .delete()
            .eq('id', userId)
            .then(null, console.warn); // builder Supabase : pas de .catch
        
        // Note: La suppression de l'utilisateur Auth nécessite des privilèges admin
        // Idéalement, utilisez une fonction Edge Function
        
        showToast('Utilisateur supprimé avec succès', 'success');
        await loadUtilisateurs();
        
    } catch (error) {
        console.error('❌ Erreur suppression:', error);
        showToast('Erreur: ' + error.message, 'error');
    }
};

/**
 * Affiche le SQL pour créer la table profiles
 */
window.showCreateProfilesSQL = function() {
    const sql = `-- Créer la table profiles
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name TEXT,
    last_name TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    role TEXT DEFAULT 'user',
    status TEXT DEFAULT 'actif',
    avatar_url TEXT,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_status ON profiles(status);
CREATE INDEX idx_profiles_email ON profiles(email);

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Politiques
CREATE POLICY "Users can view their own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
    ON profiles FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('super_admin', 'admin')
        )
    );

CREATE POLICY "Admins can update all profiles"
    ON profiles FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('super_admin', 'admin')
        )
    );

CREATE POLICY "Admins can delete profiles"
    ON profiles FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('super_admin')
        )
    );

-- Trigger pour updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();`;
    
    alert('Exécutez ce SQL dans Supabase > SQL Editor:\n\n' + sql);
};

/**
 * Récupère les options de matières pour le select
 */
function getMatieresOptions() {
    let options = '';
    if (dataCache.matieres) {
        dataCache.matieres.forEach(m => {
            options += `<option value="${m.id}">${m.name} (${m.code})</option>`;
        });
    }
    return options;
}

// ============================================
// EXPOSITION GLOBALE
// ============================================

// ── Suspendre / réactiver un compte (bloque la connexion, réversible) ──
window.toggleUserStatus = async function(userId, currentStatus) {
    const suspendre = currentStatus !== 'suspendu';
    try {
        const { data: { user: me } } = await supabaseClient.auth.getUser();
        if (me && me.id === userId) {
            showToast('Vous ne pouvez pas suspendre votre propre compte.', 'error');
            return;
        }
    } catch (_) {}

    const msg = suspendre
        ? 'Suspendre ce compte ?\n\nLa personne ne pourra plus se connecter tant que le compte ne sera pas réactivé.'
        : 'Réactiver ce compte ?\n\nLa personne pourra de nouveau se connecter.';
    if (!confirm(msg)) return;

    try {
        const { error } = await supabaseClient
            .from('profiles')
            .update({ status: suspendre ? 'suspendu' : 'actif' })
            .eq('id', userId);
        if (error) throw error;
        showToast(suspendre ? 'Compte suspendu — connexion bloquée.' : 'Compte réactivé.', 'success');
        await loadUtilisateurs();
    } catch (e) {
        console.error('toggleUserStatus:', e);
        showToast('Erreur : ' + e.message, 'error');
    }
};

window.loadUtilisateurs = loadUtilisateurs;

// ══════════ JOURNAL DES CONNEXIONS ══════════
window.loadJournalConnexions = async function() {
    const tbody = document.getElementById('journalTableBody');
    if (!tbody) return;
    const actionF = document.getElementById('filterJournalAction')?.value || '';
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#9ca3af;"><i class="fas fa-spinner fa-spin"></i> Chargement…</td></tr>';
    try {
        let q = supabaseClient.from('journal_connexions')
            .select('*').order('created_at', { ascending: false }).limit(100);
        if (actionF) q = q.eq('action', actionF);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || !data.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:#9ca3af;">Aucun événement enregistré pour le moment</td></tr>';
            return;
        }
        tbody.innerHTML = data.map(j => {
            const d = new Date(j.created_at);
            const quand = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
                        + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            const estConn = j.action === 'connexion';
            const appareil = /Mobi|Android/i.test(j.user_agent || '') ? 'Téléphone' : 'Ordinateur';
            const roleTxt = j.role === 'admin' ? 'Administration' : 'Parent';
            return `<tr>
                <td style="white-space:nowrap;font-weight:600;">${quand}</td>
                <td>${j.email || '—'}</td>
                <td><span class="badge ${j.role === 'admin' ? 'badge-info' : 'badge-secondary'}">${roleTxt}</span></td>
                <td><span class="badge ${estConn ? 'badge-success' : 'badge-secondary'}">
                    <i class="fas ${estConn ? 'fa-right-to-bracket' : 'fa-right-from-bracket'}"></i> ${estConn ? 'Connexion' : 'Déconnexion'}</span></td>
                <td style="color:#6b7280;font-size:.85rem;">${appareil}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        console.error('Journal:', e);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#9c4a2e;">Journal indisponible — exécutez le script SQL journal-connexions.sql</td></tr>';
    }
};
window.refreshUtilisateurs = refreshUtilisateurs;
window.openAddUserModal = openAddUserModal;
window.filterUsers = filterUsers;
window.viewUser = viewUser;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.resetUserPasswordModal = resetUserPasswordModal;
window.resetUserPassword = resetUserPassword;
window.generatePassword = generatePassword;
window.generateNewPassword = generateNewPassword;
window.onUserRoleChange = onUserRoleChange;
window.saveUser = saveUser;
window.editCurrentUser = editCurrentUser;
window.deleteCurrentUser = deleteCurrentUser;
window.showCreateProfilesSQL = showCreateProfilesSQL;

// ============================================
// SECTION PARAMÈTRES - COMPLÈTEMENT FONCTIONNELLE
// ============================================

/**
 * Charge la page des paramètres
 */
/**
 * Affiche, sous le menu de choix du fournisseur SMS, les noms EXACTS des
 * secrets a poser dans Supabase pour ce fournisseur precis. Les secrets
 * eux-memes ne se posent JAMAIS ici — seulement leurs noms, pour eviter
 * a l'admin de redemander a chaque fois ou chercher dans une conversation
 * passee.
 */
window.afficherAideFournisseurSms = function () {
    const select = document.getElementById('smsProvider');
    const zone = document.getElementById('aideFournisseurSms');
    if (!select || !zone) return;

    const aide = {
        twilio: 'Secrets à poser dans Supabase → Edge Functions → Secrets : ' +
            '<code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, ' +
            '<code>TWILIO_PHONE_NUMBER</code>. Un nom d\'expéditeur personnalisé ' +
            '(ci-contre) exige un compte payant — indisponible en essai gratuit.',
        d7: 'Secret à poser : <code>D7_API_TOKEN</code>. ' +
            'Le nom d\'expéditeur ci-contre est transmis tel quel.',
        orange: 'Secrets à poser : <code>ORANGE_CLIENT_ID</code>, ' +
            '<code>ORANGE_CLIENT_SECRET</code>, <code>ORANGE_SENDER_NUMBER</code> ' +
            '(le numéro Orange associé à l\'abonnement SMS Mali).',
        africastalking: 'Secrets à poser : <code>AT_USERNAME</code>, <code>AT_API_KEY</code>. ' +
            'En test (compte tout juste créé) : nom d\'utilisateur <code>sandbox</code> — ' +
            'aucun SMS n\'est réellement livré tant qu\'une application de production ' +
            'n\'a pas été créée et <code>AT_SANDBOX</code> réglé sur <code>false</code>.'
    };

    zone.innerHTML = aide[select.value] || '';
};

async function loadParametres() {
    console.log('⚙️ Chargement des paramètres...');
    
    try {
        // Charger les paramètres de l'école
        await loadEcoleParams();
        
        // Charger les paramètres de l'année scolaire
        await loadAnneeParams();
        
        // Charger les paramètres de notification
        await loadNotifParams();
        
        // Charger les paramètres système
        await loadSystemParams();
        
        console.log('✅ Paramètres chargés avec succès');
        
    } catch (error) {
        console.error('❌ Erreur chargement paramètres:', error);
        showToast('Erreur lors du chargement des paramètres', 'error');
    }
}

/**
 * Charge les paramètres de l'école depuis Supabase
 */
/**
 * Charge les paramètres de l'école depuis Supabase
 */
// Encadre les sélecteurs de date par l'année scolaire définie dans Paramètres
window.appliquerBornesAnnee = function() {
    const b = window.anneeBornes;
    if (!b || (!b.debut && !b.fin)) return;
    ['presenceDate', 'attendanceDate'].forEach(id => {
        const el = document.getElementById(id);
        if (!el || el.type !== 'date') return;
        if (b.debut) el.min = b.debut;
        if (b.fin) el.max = b.fin;
        el.title = 'Année scolaire : du ' + (b.debut || '?') + ' au ' + (b.fin || '?');
    });
};

// Année scolaire à afficher sur les documents (Paramètres > Année scolaire)
function anneeDocument() {
    return window.anneeScolaireActive || (typeof getCurrentSchoolYear === 'function' ? getCurrentSchoolYear() : '');
}

async function loadEcoleParams() {
    console.log('🏫 Chargement des paramètres de l\'école...');
    
    try {
        // Récupérer les paramètres depuis la table parametres_ecole
        const { data: params, error } = await supabaseClient
            .from('parametres_ecole')
            .select('*')
            .eq('id', 1)
            .maybeSingle(); // Utiliser maybeSingle() au lieu de single()
        
        // Si erreur 42P01 (table inexistante)
        if (error && error.code === '42P01') {
            console.warn('⚠️ Table parametres_ecole inexistante');
        }
        
        // Si pas de données, utiliser les valeurs par défaut
        const ecoleData = params || {
            nom: 'École Privée Moussa Koné',
            adresse: 'Sébénicoro-Sibiribougou, Bamako, Mali',
            telephone: '',
            email: 'contact@epmk.ml',
            rccm: 'XX-XXXX-X',
            nif: 'XXXXXXXX',
            devise: 'FCFA',
            logo_url: null
        };
        
        // Remplir le formulaire
        const nomEl = document.getElementById('ecoleNom');
        const adresseEl = document.getElementById('ecoleAdresse');
        const telephoneEl = document.getElementById('ecoleTelephone');
        const emailEl = document.getElementById('ecoleEmail');
        
        if (nomEl) nomEl.value = ecoleData.nom || '';
        if (adresseEl) adresseEl.value = ecoleData.adresse || '';
        if (telephoneEl) telephoneEl.value = ecoleData.telephone || '';
        if (emailEl) emailEl.value = ecoleData.email || '';
        
        // Numéros marchands (affichés aux parents sur le portail)
        const nOr = document.getElementById('numeroOrangeMoney');
        const nMo = document.getElementById('numeroMoovMoney');
        const nWa = document.getElementById('numeroWave');
        if (nOr) nOr.value = ecoleData.numero_orange_money || '';
        if (nMo) nMo.value = ecoleData.numero_moov_money || '';
        if (nWa) nWa.value = ecoleData.numero_wave || '';
        
        // Aperçu du logo déjà enregistré
        const logoPrev = document.getElementById('ecoleLogoPreview');
        if (logoPrev && ecoleData.logo_url) {
            logoPrev.src = ecoleData.logo_url;
            logoPrev.style.display = 'block';
        }
        
        // Stocker les données pour la sauvegarde
        window.currentEcoleParams = ecoleData;
        
    } catch (error) {
        console.error('❌ Erreur chargement paramètres école:', error);
        // Ne pas bloquer l'interface
    }
}

/**
 * Sauvegarde les paramètres de l'école
 */
// Aperçu immédiat du logo choisi (avant enregistrement)
window.previewEcoleLogo = function(input) {
    const img = document.getElementById('ecoleLogoPreview');
    const f = input?.files?.[0];
    if (!img || !f) return;
    if (f.size > 1024 * 1024) {
        showToast('Le logo dépasse 1 Mo. Choisissez une image plus légère.', 'error');
        input.value = '';
        return;
    }
    img.src = URL.createObjectURL(f);
    img.style.display = 'block';
};

// Numéros marchands : ce que les parents voient sur le portail.
// Un champ vide masque le moyen de paiement correspondant.
window.saveNumerosPaiement = async function(e) {
    e.preventDefault();
    const val = id => document.getElementById(id)?.value?.trim() || null;
    try {
        const { error } = await supabaseClient
            .from('parametres_ecole')
            .upsert([{
                id: 1,
                numero_orange_money: val('numeroOrangeMoney'),
                numero_moov_money:   val('numeroMoovMoney'),
                numero_wave:         val('numeroWave'),
                updated_at: new Date().toISOString()
            }], { onConflict: 'id' });
        if (error) throw error;
        showToast('Numéros de paiement enregistrés', 'success');
    } catch (err) {
        console.error('❌ Numéros de paiement:', err);
        showToast('Erreur : ' + err.message, 'error');
    }
};

window.saveEcoleParams = async function(e) {
    e.preventDefault();
    
    const nom = document.getElementById('ecoleNom')?.value?.trim();
    const adresse = document.getElementById('ecoleAdresse')?.value?.trim();
    const telephone = document.getElementById('ecoleTelephone')?.value?.trim();
    const email = document.getElementById('ecoleEmail')?.value?.trim();

    // Logo : téléversement vers Supabase Storage (bucket 'public')
    let logoUrl = null;
    const fichierLogo = document.getElementById('ecoleLogo')?.files?.[0];
    if (fichierLogo) {
        if (fichierLogo.size > 1024 * 1024) {
            showToast('Le logo dépasse 1 Mo. Choisissez une image plus légère.', 'error');
            return;
        }
        try {
            const ext = (fichierLogo.name.split('.').pop() || 'png').toLowerCase();
            const chemin = `ecole/logo_${Date.now()}.${ext}`;
            const { error: upErr } = await supabaseClient.storage
                .from('public').upload(chemin, fichierLogo, { upsert: true, cacheControl: '3600' });
            if (upErr) throw upErr;
            const { data: pub } = supabaseClient.storage.from('public').getPublicUrl(chemin);
            logoUrl = pub?.publicUrl || null;
        } catch (e) {
            console.error('❌ Téléversement du logo:', e);
            showToast("Le logo n'a pas pu être envoyé : " + (e.message || 'erreur'), 'error');
            return;
        }
    }
    
    // Validation
    if (!nom) {
        showToast('Le nom de l\'école est obligatoire', 'error');
        return;
    }
    
    try {
        const paramsData = {
            id: 1,
            nom: nom,
            adresse: adresse,
            telephone: telephone,
            email: email,
            updated_at: new Date().toISOString(),
            ...(logoUrl ? { logo_url: logoUrl } : {})
        };
        
        // Upsert (insert ou update)
        const { error } = await supabaseClient
            .from('parametres_ecole')
            .upsert([paramsData], { onConflict: 'id' });
        
        if (error) throw error;
        
        // Mettre à jour le nom affiché dans la sidebar
        const schoolNameEl = document.getElementById('schoolName');
        if (schoolNameEl) schoolNameEl.textContent = nom;
        
        showToast('Paramètres de l\'école enregistrés avec succès', 'success');
        
    } catch (error) {
        console.error('❌ Erreur sauvegarde paramètres école:', error);
        showToast('Erreur lors de la sauvegarde: ' + error.message, 'error');
    }
};

/**
 * Charge les paramètres de l'année scolaire
 */
/**
 * Charge les paramètres de l'année scolaire
 */
async function loadAnneeParams() {
    console.log('📅 Chargement des paramètres de l\'année scolaire...');
    
    try {
        const { data: params, error } = await supabaseClient
            .from('parametres_annee')
            .select('*')
            .eq('id', 1)
            .maybeSingle(); // Utiliser maybeSingle() au lieu de single()
        
        // Si erreur 42P01 (table inexistante)
        if (error && error.code === '42P01') {
            console.warn('⚠️ Table parametres_annee inexistante');
        }
        
        const anneeData = params || {
            annee_en_cours: getCurrentSchoolYear(),
            date_debut: new Date(new Date().getFullYear(), 8, 1).toISOString().split('T')[0], // 1er septembre
            date_fin: new Date(new Date().getFullYear() + 1, 5, 30).toISOString().split('T')[0] // 30 juin
        };
        
        const anneeEl = document.getElementById('anneeEnCours');
        const dateDebutEl = document.getElementById('dateDebutAnnee');
        const dateFinEl = document.getElementById('dateFinAnnee');
        
        if (anneeEl) anneeEl.value = anneeData.annee_en_cours || getCurrentSchoolYear();
        if (dateDebutEl) dateDebutEl.value = anneeData.date_debut || '';
        if (dateFinEl) dateFinEl.value = anneeData.date_fin || '';
        
        // Les dates bornent la saisie des présences (hors année scolaire = impossible)
        window.anneeBornes = { debut: anneeData.date_debut || null, fin: anneeData.date_fin || null };
        appliquerBornesAnnee();
        
        // Mettre à jour l'affichage dans la sidebar
        const schoolYearEl = document.getElementById('schoolYear');
        // Année active : utilisée par les bulletins, reçus et rapports
        window.anneeScolaireActive = anneeData.annee_en_cours || getCurrentSchoolYear();
        if (schoolYearEl && anneeData.annee_en_cours) {
            schoolYearEl.textContent = anneeData.annee_en_cours;
        }
        
        window.currentAnneeParams = anneeData;
        
    } catch (error) {
        console.error('❌ Erreur chargement paramètres année:', error);
    }
}
/**
 * Sauvegarde les paramètres de l'année scolaire
 */
window.saveAnneeParams = async function(e) {
    e.preventDefault();
    
    const anneeEnCours = document.getElementById('anneeEnCours')?.value?.trim();
    const dateDebut = document.getElementById('dateDebutAnnee')?.value;
    const dateFin = document.getElementById('dateFinAnnee')?.value;
    
    if (!anneeEnCours || !dateDebut || !dateFin) {
        showToast('Tous les champs sont obligatoires', 'error');
        return;
    }
    
    // Validation des dates
    if (new Date(dateDebut) >= new Date(dateFin)) {
        showToast('La date de fin doit être après la date de début', 'error');
        return;
    }
    
    try {
        const paramsData = {
            id: 1,
            annee_en_cours: anneeEnCours,
            date_debut: dateDebut,
            date_fin: dateFin,
            updated_at: new Date().toISOString()
        };
        
        const { error } = await supabaseClient
            .from('parametres_annee')
            .upsert([paramsData], { onConflict: 'id' });
        
        if (error) throw error;
        
        // Mettre à jour l'affichage
        const schoolYearEl = document.getElementById('schoolYear');
        if (schoolYearEl) schoolYearEl.textContent = anneeEnCours;
        
        const anneeScolaireEl = document.getElementById('anneeScolaire');
        if (anneeScolaireEl) anneeScolaireEl.textContent = anneeEnCours;
        
        showToast('Paramètres de l\'année scolaire enregistrés', 'success');
        
    } catch (error) {
        console.error('❌ Erreur sauvegarde paramètres année:', error);
        showToast('Erreur lors de la sauvegarde: ' + error.message, 'error');
    }
};

/**
 * Charge les paramètres de notification
 */
/**
 * Charge les paramètres de notification
 */
async function loadNotifParams() {
    console.log('📧 Chargement des paramètres de notification...');
    
    try {
        const { data: params, error } = await supabaseClient
            .from('parametres_notification')
            .select('*')
            .eq('id', 1)
            .maybeSingle(); // Utiliser maybeSingle() au lieu de single()
        
        // Si erreur 42P01 (table inexistante) ou pas de données
        if (error && error.code === '42P01') {
            console.warn('⚠️ Table parametres_notification inexistante');
            return;
        }
        
        const notifData = params || {
            api_sms: '',
            sms_sender: 'EPMK',
            api_email: '',
            email_sender: 'noreply@epmk.ml',
            notifications_actives: true
        };
        
        const smsSenderEl = document.getElementById('smsSender');
        const smsProviderEl = document.getElementById('smsProvider');
        const smsActifEl = document.getElementById('smsActif');
        
        if (smsSenderEl) smsSenderEl.value = notifData.sms_sender || 'EPMK';
        if (smsProviderEl && notifData.sms_provider) smsProviderEl.value = notifData.sms_provider;
        if (smsActifEl) smsActifEl.checked = !!notifData.sms_actif;
        afficherAideFournisseurSms();
        
        window.currentNotifParams = notifData;
        
    } catch (error) {
        console.error('❌ Erreur chargement paramètres notification:', error);
        // Ne pas bloquer l'interface si la table n'existe pas
    }
}

/**
 * Sauvegarde les paramètres de notification
 */
window.saveNotifParams = async function(e) {
    e.preventDefault();
    
    const smsSender = document.getElementById('smsSender')?.value?.trim() || 'EPMK';
    const smsProvider = document.getElementById('smsProvider')?.value || 'twilio';
    const smsActif = document.getElementById('smsActif')?.checked || false;
    
    try {
        const paramsData = {
            id: 1,
            sms_sender: smsSender,
            sms_provider: smsProvider,
            sms_actif: smsActif,
            updated_at: new Date().toISOString()
            // NB : aucune clé secrète ici — elle vit dans les secrets Supabase.
        };
        
        const { error } = await supabaseClient
            .from('parametres_notification')
            .upsert([paramsData], { onConflict: 'id' });
        
        if (error) throw error;
        
        showToast('Paramètres de notification enregistrés', 'success');
        
    } catch (error) {
        console.error('❌ Erreur sauvegarde paramètres notification:', error);
        showToast('Erreur lors de la sauvegarde: ' + error.message, 'error');
    }
};

/**
 * Charge les paramètres système
 */
/**
 * Charge les paramètres système
 */
async function loadSystemParams() {
    console.log('🔧 Chargement des paramètres système...');
    
    try {
        const { data: params, error } = await supabaseClient
            .from('parametres_systeme')
            .select('*')
            .eq('id', 1)
            .maybeSingle(); // Utiliser maybeSingle() au lieu de single()
        
        // Si erreur 42P01 (table inexistante)
        if (error && error.code === '42P01') {
            console.warn('⚠️ Table parametres_systeme inexistante');
            window.currentSystemParams = {
                maintenance_mode: false,
                backup_auto: true,
                debug_mode: false
            };
            return;
        }
        
        window.currentSystemParams = params || {
            maintenance_mode: false,
            backup_auto: true,
            debug_mode: false
        };
        
    } catch (error) {
        console.error('❌ Erreur chargement paramètres système:', error);
        // Valeurs par défaut en cas d'erreur
        window.currentSystemParams = {
            maintenance_mode: false,
            backup_auto: true,
            debug_mode: false
        };
    }
}

/**
 * Exporte la base de données (simulation)
 */
// ════════════════════════════════════════════════════════════════════
// SAUVEGARDE COMPLETE — le filet de securite du plan Supabase gratuit
// --------------------------------------------------------------------
// L'ancienne version ne couvrait que 5 tables sur trente, et tronquait
// silencieusement a 1000 lignes par table — un fichier qui donnait
// l'illusion d'une sauvegarde complete sans jamais le dire. Ici :
//   - TOUTES les tables reellement utilisees par l'application ;
//   - AUCUNE limite de lignes (pagination reelle, page par page) ;
//   - un fichier EXCEL (.xlsx), un onglet par table, lisible tel quel ;
//   - un fichier SQL rejouable, dans l'ORDRE qui respecte les cles
//     etrangeres, pour une vraie restauration.
//
// CE QUE CETTE SAUVEGARDE NE COUVRE PAS, sciemment :
//   - les comptes de connexion (auth.users : mots de passe, emails
//     de connexion) — jamais accessibles depuis le navigateur, quel
//     que soit le role. Restaurer les DONNEES ne recree pas les
//     COMPTES : il faudra les recreer separement (memes emails) si
//     la base entiere devait etre reconstruite ailleurs.
//   - les fichiers du stockage (photos, justificatifs) — un espace
//     distinct de la base de donnees, a sauvegarder separement.
//   - le SCHEMA (structure des tables, politiques RLS, fonctions) —
//     le fichier SQL suppose que ces tables EXISTENT DEJA (via les
//     scripts deja fournis au projet), il ne fait que les REMPLIR.
// ════════════════════════════════════════════════════════════════════

// Ordre topologique : une table ne peut se remplir qu'apres celles
// qu'elle reference par cle etrangere (une classe avant un eleve, un
// eleve avant une note). Sans cet ordre, le fichier SQL echouerait a
// la restauration sur la premiere contrainte de cle etrangere venue.
const TABLES_SAUVEGARDE = [
    'parametres_ecole', 'parametres_annee', 'parametres_notification', 'parametres_systeme',
    'subjects', 'classes', 'logos',
    'teachers', 'parents', 'admissions', 'students',
    'class_subjects', 'parent_students', 'taux_enseignant',
    'notes', 'presences', 'bulletins_publies', 'emploi_du_temps', 'absences_enseignant',
    'payments', 'frais_additionnels', 'historique_frais', 'salaires', 'salaire_lignes', 'depenses',
    'annonces', 'sms_broadcasts', 'journal_connexions', 'historique_sauvegardes',
    'profiles'
];

/**
 * Recupere TOUTE une table, sans jamais se limiter aux 1000 premieres
 * lignes : Supabase plafonne chaque reponse a 1000 par defaut, donc on
 * boucle page par page jusqu'a ce qu'une page revienne incomplete.
 */
async function recupererTableComplete(table) {
    const TAILLE_PAGE = 1000;
    let toutes = [];
    let depart = 0;
    while (true) {
        const { data, error } = await supabaseClient
            .from(table).select('*').range(depart, depart + TAILLE_PAGE - 1);
        if (error) {
            // Une table absente ou inaccessible ne doit pas arreter les
            // 29 autres : on le signale et on continue.
            console.warn(`Sauvegarde — table « ${table} » ignorée :`, error.message);
            return null;
        }
        toutes = toutes.concat(data || []);
        if (!data || data.length < TAILLE_PAGE) break;
        depart += TAILLE_PAGE;
    }
    return toutes;
}

/**
 * Echappe une valeur JS pour une instruction SQL INSERT. NULL, nombres
 * et booleens s'ecrivent tels quels ; tout le reste (texte, dates,
 * objets JSON) devient une chaine entre quotes, apostrophes doublees.
 */
function echapperValeurSql(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'object') {
        // JSON/JSONB : reinjecte comme texte JSON, caste explicitement.
        return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
    }
    return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Construit le bloc SQL d'UNE table : les colonnes sont lues sur la
 * PREMIERE ligne — une table vide ne genere donc aucun INSERT, ce qui
 * est correct (rien a restaurer pour elle).
 */
function construireSqlTable(table, lignes) {
    if (!lignes || !lignes.length) return `-- ${table} : aucune ligne\n`;
    const colonnes = Object.keys(lignes[0]);
    const valeurs = lignes.map(ligne =>
        '  (' + colonnes.map(c => echapperValeurSql(ligne[c])).join(', ') + ')'
    ).join(',\n');
    return `-- ${table} — ${lignes.length} ligne(s)\n` +
        `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES\n${valeurs}\n` +
        `ON CONFLICT (id) DO NOTHING;\n\n`;
}

/**
 * Sauvegarde complete : parcourt les 29 tables, produit un .xlsx
 * (un onglet par table, ouvrable directement dans Excel) ET un .sql
 * rejouable dans l'ordre qui respecte les cles etrangeres.
 */
window.exportDatabase = async function() {
    if (typeof XLSX === 'undefined') {
        showToast('Bibliothèque Excel non chargée — rechargez la page (Ctrl+F5)', 'error');
        return;
    }

    showToast('Sauvegarde en cours — cela peut prendre une minute…', 'info', 8000);

    const classeur = XLSX.utils.book_new();
    let sqlComplet =
        '-- ═══════════════════════════════════════════════════════════\n' +
        '--  SAUVEGARDE EPMK — ' + new Date().toLocaleString('fr-FR') + '\n' +
        '-- ---------------------------------------------------------\n' +
        '--  A rejouer sur une base qui possede DEJA la structure des\n' +
        '--  tables (scripts SQL du projet). Ne recree ni schema, ni\n' +
        '--  comptes de connexion (auth.users), ni fichiers de stockage.\n' +
        '-- ═══════════════════════════════════════════════════════════\n\n';

    const resume = [];
    let tablesEchouees = 0;

    for (const table of TABLES_SAUVEGARDE) {
        const lignes = await recupererTableComplete(table);
        if (lignes === null) { tablesEchouees++; continue; }

        resume.push({ Table: table, Lignes: lignes.length });
        sqlComplet += construireSqlTable(table, lignes);

        // Un onglet Excel par table. Nom d'onglet limite a 31
        // caracteres par Excel — sans risque ici, nos noms sont courts.
        const feuille = lignes.length
            ? XLSX.utils.json_to_sheet(lignes)
            : XLSX.utils.aoa_to_sheet([['(table vide)']]);
        XLSX.utils.book_append_sheet(classeur, feuille, table.substring(0, 31));
    }

    // Un onglet recapitulatif en tete, pour voir d'un coup d'oeil ce
    // qui a ete sauvegarde et en quelle quantite.
    const feuilleResume = XLSX.utils.json_to_sheet(resume);
    XLSX.utils.book_append_sheet(classeur, feuilleResume, 'Résumé');
    // Reordonner pour que le resume soit le premier onglet visible.
    classeur.SheetNames.unshift(classeur.SheetNames.pop());

    const horodatage = new Date().toISOString().slice(0, 10);

    // ── Fichier 1 : Excel, pour consultation humaine ──
    XLSX.writeFile(classeur, `sauvegarde_epmk_${horodatage}.xlsx`);

    // ── Fichier 2 : SQL, pour une vraie restauration ──
    const blobSql = new Blob([sqlComplet], { type: 'text/plain' });
    const lienSql = document.createElement('a');
    lienSql.href = URL.createObjectURL(blobSql);
    lienSql.download = `sauvegarde_epmk_${horodatage}.sql`;
    lienSql.click();

    const total = resume.reduce((s, r) => s + r.Lignes, 0);
    showToast(
        `Sauvegarde terminée : ${resume.length} table(s), ${total} ligne(s)` +
        (tablesEchouees ? ` — ${tablesEchouees} table(s) ignorée(s), voir la console` : ''),
        tablesEchouees ? 'warning' : 'success', 8000
    );
};

/**
 * Sauvegarde manuelle : LE seul bouton de l'interface. Trace l'operation
 * dans l'historique (avant l'export, pour qu'un plantage pendant
 * l'export laisse quand meme une trace de la tentative), puis
 * declenche l'export complet.
 */
window.backupData = async function() {
    showToast('Sauvegarde en cours…', 'info');
    let ligneHistorique = null;
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        const { data: hist } = await supabaseClient.from('historique_sauvegardes').insert([{
            type: 'manuelle', created_by: user?.id || null,
            created_at: new Date().toISOString(), status: 'en_cours'
        }]).select('id').single();
        ligneHistorique = hist?.id || null;

        await exportDatabase();

        if (ligneHistorique) {
            await supabaseClient.from('historique_sauvegardes')
                .update({ status: 'completed' }).eq('id', ligneHistorique);
        }
        chargerHistoriqueSauvegardes();

    } catch (error) {
        console.error('❌ Erreur sauvegarde:', error);
        showToast('Erreur lors de la sauvegarde : ' + (error.message || ''), 'error');
        if (ligneHistorique) {
            await supabaseClient.from('historique_sauvegardes')
                .update({ status: 'echec' }).eq('id', ligneHistorique).catch(() => {});
        }
        chargerHistoriqueSauvegardes();
    }
};

/**
 * Affiche les 5 dernieres sauvegardes, avec leur statut — un vrai
 * logiciel professionnel montre ce qui a deja ete fait, pas seulement
 * un bouton pour agir a l'aveugle.
 */
async function chargerHistoriqueSauvegardes() {
    const zone = document.getElementById('historiqueSauvegardesZone');
    if (!zone) return;
    try {
        const { data, error } = await supabaseClient
            .from('historique_sauvegardes').select('*')
            .order('created_at', { ascending: false }).limit(5);
        if (error) throw error;

        if (!data || !data.length) {
            zone.innerHTML = '<p style="text-align:center;color:#9ca3af;font-size:.85rem;padding:12px 0;">' +
                'Aucune sauvegarde effectuée pour l\'instant.</p>';
            return;
        }

        const badge = (s) => ({
            completed: '<span class="badge badge-success">Réussie</span>',
            en_cours:  '<span class="badge badge-warning">En cours</span>',
            echec:     '<span class="badge badge-danger">Échec</span>'
        }[s] || '<span class="badge badge-secondary">' + (s || '—') + '</span>');

        zone.innerHTML =
            '<div style="font-size:.79rem;color:#7A6A63;text-transform:uppercase;' +
              'letter-spacing:.04em;margin-bottom:8px;">Historique récent</div>' +
            '<table class="data-table" style="font-size:.86rem;"><tbody>' +
            data.map(h => '<tr>' +
                '<td>' + new Date(h.created_at).toLocaleString('fr-FR') + '</td>' +
                '<td style="text-align:right;">' + badge(h.status) + '</td>' +
            '</tr>').join('') +
            '</tbody></table>';
    } catch (e) {
        console.warn('Historique des sauvegardes :', e && e.message);
        zone.innerHTML = '';
    }
}

/**
 * Vide le cache du navigateur
 */
window.clearCache = function() {
    console.log('🗑️ Vidage du cache...');
    
    if (!confirm('Êtes-vous sûr de vouloir vider le cache ? Cela déconnectera toutes les sessions actives.')) {
        return;
    }
    
    try {
        // Vider localStorage sauf les données essentielles
        const currentPage = localStorage.getItem('currentPage');
        
        localStorage.clear();
        
        // Restaurer les données essentielles
        if (currentPage) localStorage.setItem('currentPage', currentPage);
        
        // Vider le cache des données
        Object.keys(dataCache).forEach(key => {
            dataCache[key] = null;
        });
        
        showToast('Cache vidé avec succès', 'success');
        
        // Recharger la page après 1 seconde
        setTimeout(() => {
            window.location.reload();
        }, 1000);
        
    } catch (error) {
        console.error('❌ Erreur vidage cache:', error);
        showToast('Erreur lors du vidage du cache', 'error');
    }
};

/**
 * Gestion du logo de l'école
 */
window.handleLogoUpload = async function(input) {
    const file = input.files[0];
    if (!file) return;
    
    // Validation
    if (file.size > 2 * 1024 * 1024) {
        showToast('L\'image est trop volumineuse (max 2MB)', 'error');
        return;
    }
    
    if (!file.type.startsWith('image/')) {
        showToast('Veuillez sélectionner une image', 'error');
        return;
    }
    
    try {
        showToast('Upload du logo en cours...', 'info');
        
        // Upload vers Supabase Storage
        const fileExt = file.name.split('.').pop();
        const fileName = `logo_ecole_${Date.now()}.${fileExt}`;
        
        const { data: uploadData, error: uploadError } = await supabaseClient
            .storage
            .from('logos')
            .upload(fileName, file);
        
        if (uploadError) throw uploadError;
        
        // Récupérer l'URL publique
        const { data: { publicUrl } } = supabaseClient
            .storage
            .from('logos')
            .getPublicUrl(fileName);
        
        // Mettre à jour les paramètres
        const { error: updateError } = await supabaseClient
            .from('parametres_ecole')
            .update({ logo_url: publicUrl })
            .eq('id', 1);
        
        if (updateError) throw updateError;
        
        // Afficher l'aperçu
        const previewEl = document.getElementById('logoPreview');
        if (previewEl) {
            previewEl.src = publicUrl;
            previewEl.style.display = 'block';
        }
        
        showToast('Logo mis à jour avec succès', 'success');
        
    } catch (error) {
        console.error('❌ Erreur upload logo:', error);
        showToast('Erreur lors de l\'upload: ' + error.message, 'error');
    }
};

// ============================================
// GESTIONNAIRES DE FORMULAIRES
// ============================================
function initFormHandlers() {
    if (window.__formHandlersInit__) return;
    window.__formHandlersInit__ = true;
    if (window.__FORM_HANDLERS_INITIALIZED__) {
        console.log('⚠️ Form handlers déjà initialisés');
        return;
    }
    window.__FORM_HANDLERS_INITIALIZED__ = true;
    
    // Formulaire d'ajout de classe
    const classeForm = document.getElementById('addClasseForm');
    if (classeForm) {
        const newForm = classeForm.cloneNode(true);
        classeForm.parentNode.replaceChild(newForm, classeForm);
        newForm.addEventListener('submit', saveNewClasse);
    }
    
    // Formulaire de matière globale
    const matiereForm = document.getElementById('addMatiereGlobalForm');
    if (matiereForm) {
        const newForm = matiereForm.cloneNode(true);
        matiereForm.parentNode.replaceChild(newForm, matiereForm);
        newForm.addEventListener('submit', saveMatiereGlobale);
    }
    
    // Formulaire d'enseignant
    const teacherForm = document.getElementById('addTeacherForm');
    if (teacherForm) {
        const newForm = teacherForm.cloneNode(true);
        teacherForm.parentNode.replaceChild(newForm, teacherForm);
        newForm.addEventListener('submit', saveTeacher);
    }
    
    // Formulaire de parent
    const parentForm = document.getElementById('createParentForm');
    if (parentForm) {
        const newForm = parentForm.cloneNode(true);
        parentForm.parentNode.replaceChild(newForm, parentForm);
        newForm.addEventListener('submit', (e) => {
            e.preventDefault();
            creerCompteParent();
        });
    }
    
    // ⚠️ Formulaire d'admission/inscription
    const admissionForm = document.getElementById('admissionForm');
    if (admissionForm) {
        const newForm = admissionForm.cloneNode(true);
        admissionForm.parentNode.replaceChild(newForm, admissionForm);
        newForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveAdmission();
        });
        console.log('✅ Écouteur admission attaché');
    }
    
    // Wizard d'inscription
    initWizardHandlers();
}


// ── Masque de saisie pour le champ date de naissance ──────────────────────
function initDateMask() {
    const el = document.getElementById('admBirthDate');
    if (!el || el.dataset.maskInit) return;
    el.dataset.maskInit = 'true';

    // ── Calendrier flatpickr (pro) : navigation par mois/année,
    //    en français, saisie manuelle JJ/MM/AAAA toujours possible ──
    if (window.flatpickr) {
        flatpickr(el, {
            locale: (flatpickr.l10ns && flatpickr.l10ns.fr) || 'default',
            dateFormat: 'd/m/Y',
            allowInput: true,
            maxDate: 'today',
            disableMobile: false
        });
        return;
    }

    // ── Repli hors-ligne : masque de saisie JJ/MM/AAAA ──
    el.addEventListener('input', function(e) {
        let v = this.value.replace(/\D/g, '').substring(0, 8);
        if (v.length >= 3) v = v.substring(0,2) + '/' + v.substring(2);
        if (v.length >= 6) v = v.substring(0,5) + '/' + v.substring(5);
        this.value = v;
    });

    el.addEventListener('keydown', function(e) {
        if (e.key === 'Backspace') {
            const v = this.value;
            if (v.endsWith('/')) {
                e.preventDefault();
                this.value = v.slice(0, -1);
            }
        }
    });
}

function initWizardHandlers() {
    window.changeStep = changeStep;
}



// Dans la section EXPOSITION GLOBALE
window.openAdmissionModal = openAdmissionModal;
window.updateAdmissionFees = updateAdmissionFees;
window.changeStep = changeStep; // Si pas déjà exposé
// ============================================
// SECTION ADMISSIONS/INSCRIPTIONS - FONCTIONS CORRIGÉES
// ============================================

let currentAdmissionId = null; // Pour les actions sur une inscription

/**
 * Rafraîchit manuellement les admissions
 */
window.refreshAdmissions = async function() {
    console.log('🔄 Rafraîchissement manuel...');
    await loadAdmissions();
    showToast('Données actualisées', 'success');
};

/**
 * Charge toutes les admissions avec leurs statistiques
 */

// Dans initSupabase(), après la création du client :
window.supabaseClient = supabaseClient;
// OU si vous utilisez déjà window.supabaseClient, assurez-vous qu'il est disponible
// Fonction pour afficher le SQL de création
window.showCreateTableSQL = function() {
    const sql = `-- Créer la table admissions
CREATE TABLE IF NOT EXISTS admissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    student_first_name TEXT NOT NULL,
    student_last_name TEXT NOT NULL,
    birth_date DATE,
    birth_place TEXT,
    gender TEXT,
    nationality TEXT DEFAULT 'Malienne',
    class_id UUID REFERENCES classes(id),
    father_name TEXT,
    father_phone TEXT,
    mother_name TEXT,
    mother_phone TEXT,
    amount INTEGER DEFAULT 0,
    payment_method TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index
CREATE INDEX idx_admissions_status ON admissions(status);
CREATE INDEX idx_admissions_created ON admissions(created_at DESC);

-- RLS
ALTER TABLE admissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access" ON admissions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role IN ('super_admin', 'admin', 'directeur', 'secretaire')
        )
    );`;
    
    alert('Exécutez ce SQL dans Supabase > SQL Editor:\n\n' + sql);
};


/**
 * Filtre les admissions (appelé par les inputs de filtre)
 */
window.filterAdmissions = function() {
    console.log('🔍 Filtrage des admissions...');
    // Utiliser allAdmissions qui est maintenant globale
    renderAdmissionsTable(allAdmissions);
};

// Fonction pour voir les détails d'une inscription
window.viewAdmission = async function(admissionId) {
    console.log('👁️ Vue détails admission:', admissionId);
    currentAdmissionId = admissionId;
    
    try {
        const { data: admission, error } = await supabaseClient
            .from('admissions')
            .select('*')
            .eq('id', admissionId)
            .single();
        
        if (error) throw error;
        
        // Remplir le modal de détails
        fillAdmissionDetails(admission);
        
        // Ouvrir le modal
        openModal('admissionDetailsModal');
        
    } catch (error) {
        console.error('❌ Erreur chargement détails:', error);
        showToast('Erreur chargement des détails', 'error');
    }
};

// Affiche le parcours d'inscription et les frais dus.
// Étapes réelles d'une école privée à Bamako :
// dossier reçu → étude → contact famille → règlement + originaux au secrétariat → inscription.
// Masque les blocs du détail d'admission dont TOUS les champs sont vides,
// et signale d'un mot qu'ils se remplissent au secrétariat.
function masquerBlocsVides() {
    const blocs = [
        ['detailFatherName','detailFatherPhone','detailFatherEmail','detailFatherJob'],
        ['detailMotherName','detailMotherPhone','detailMotherEmail','detailMotherJob'],
        ['detailTutorName','detailTutorPhone','detailTutorRelation'],
        ['detailBloodGroup','detailDoctor','detailAllergies','detailDiseases']
    ];

    const vide = v => !v || v === '-' || /^(Aucune?|Non renseign)/i.test(v);
    let nbMasques = 0;

    blocs.forEach(function (ids) {
        const champs = ids.map(id => document.getElementById(id)).filter(Boolean);
        if (!champs.length) return;
        const tousVides = champs.every(el => vide(el.textContent.trim()));

        // Structure reelle du modal :
        //   div(bloc gris) > h5(titre) + div.info-grid > div(cellule) > div#detailXxx
        // Il faut donc remonter jusqu'au bloc gris pour masquer AUSSI son titre.
        // `.info-section` n'existe pas ici : c'est ce qui faisait echouer
        // le masquage et laissait les rangees de tirets visibles.
        let section = champs[0].closest('.info-grid')?.parentElement;
        if (!section) section = champs[0].closest('.info-section');
        if (!section) return;

        section.style.display = tousVides ? 'none' : '';
        if (tousVides) nbMasques++;
    });

    // Un mot pour expliquer l'absence, plutôt qu'un silence.
    let note = document.getElementById('noteDossierIncomplet');
    if (nbMasques > 0) {
        if (!note) {
            note = document.createElement('div');
            note.id = 'noteDossierIncomplet';
            note.style.cssText = 'background:#FFFDF7;border:1.5px solid #E6C976;' +
                'border-radius:10px;padding:12px 14px;margin-bottom:16px;' +
                'font-size:.85rem;color:#8a6414;line-height:1.5;';
            note.innerHTML = '<i class="fas fa-circle-info"></i> <strong>Dossier a completer.</strong> ' +
                'La demande en ligne ne recueille que l\'essentiel. Filiation, sante et ' +
                'scolarite anterieure se renseignent au secretariat, sur la fiche ' +
                'd\'inscription imprimee.';
            const cible = document.querySelector('#admissionDetailsModal .modal-body');
            if (cible) cible.insertBefore(note, cible.firstChild);
        }
        note.style.display = '';
    } else if (note) {
        note.style.display = 'none';
    }
}

async function renderParcoursAdmission(admission) {
    const statut = admission.status || 'pending';

    // ── Frais d'inscription de la classe demandée ──
    const elFrais = document.getElementById('detailFraisInscription');
    const elEtat  = document.getElementById('detailPaiementEtat');
    let frais = 0;
    try {
        if (admission.class_id) {
            const { data: c } = await supabaseClient
                .from('classes').select('frais_inscription, nom').eq('id', admission.class_id).maybeSingle();
            frais = parseInt(c?.frais_inscription) || 0;
        } else if (admission.class_name) {
            // Section pas encore affectee : on prend les frais d'une classe
            // du niveau demande. Les sections d'un meme niveau partagent le
            // meme bareme, le montant annonce a la famille est donc exact.
            const { data: cls } = await supabaseClient
                .from('classes').select('nom, frais_inscription');
            const niveau = String(admission.class_name).trim().toLowerCase();
            const c = (cls || []).find(x =>
                String(x.nom || '').trim().toLowerCase().startsWith(niveau));
            frais = parseInt(c?.frais_inscription) || 0;
        }
    } catch (e) { console.warn('Frais non chargés:', e?.message); }

    if (elFrais) {
        elFrais.textContent = frais > 0
            ? frais.toLocaleString('fr-FR') + ' FCFA'
            : 'Non défini pour cette classe';
    }

    if (elEtat) {
        if (statut === 'accepted') {
            elEtat.innerHTML = '<i class="fas fa-circle-check" style="color:#2E7D32"></i> ' +
                'Élève inscrit. Les paiements se suivent désormais dans la section ' +
                '<a href="#" onclick="event.preventDefault();closeModal(\'admissionDetailsModal\');loadPage(\'paiements\')" ' +
                'style="color:#5D4037;font-weight:600;">Paiements</a>.';
        } else if (statut === 'rejected') {
            elEtat.innerHTML = '<i class="fas fa-circle-xmark" style="color:#B23B2E"></i> Demande refusée — aucun règlement attendu.';
        } else {
            elEtat.innerHTML = '<i class="fas fa-circle-info" style="color:#8a6414"></i> ' +
                'À régler <strong>au secrétariat</strong> lors de la finalisation. ' +
                'La pré-inscription en ligne ne collecte aucun paiement.';
        }
    }

    // ── Les étapes ──
    // 0 = faite · 1 = en cours · 2 = à venir
    let etats;
    if (statut === 'accepted')      etats = [0, 0, 0, 0, 0];
    else if (statut === 'rejected') etats = [0, 0, 3, 3, 3];   // 3 = annulée
    else                            etats = [0, 1, 2, 2, 2];

    const etapes = [
        ['Dossier reçu',              'La demande est enregistrée dans le système.'],
        ['Étude du dossier',          'Vérification des informations et des pièces fournies.'],
        ['Contact de la famille',     'Appel au parent pour confirmer et convenir de la suite.'],
        ['Règlement & originaux',     'Frais d\'inscription réglés au secrétariat, pièces originales remises.'],
        ['Inscription définitive',    'Matricule attribué, compte parent créé, identifiants envoyés par SMS.']
    ];

    const style = {
        0: { pastille: '#2E7D32', fond: '#fff', ic: 'fa-check',       txt: '#2A211D', op: '1'   },
        1: { pastille: '#8a6414', fond: '#FFFDF7', ic: 'fa-hourglass-half', txt: '#2A211D', op: '1' },
        2: { pastille: '#D7CCC8', fond: '#fff', ic: 'fa-circle',      txt: '#7A6A63', op: '.75' },
        3: { pastille: '#D7CCC8', fond: '#fff', ic: 'fa-xmark',       txt: '#A1887F', op: '.5'  }
    };

    const ol = document.getElementById('admissionEtapes');
    if (!ol) return;
    ol.innerHTML = etapes.map(function (e, i) {
        const s = style[etats[i]];
        const dernier = i === etapes.length - 1;
        return '<li style="position:relative;padding-left:34px;padding-bottom:' + (dernier ? '0' : '16px') + ';opacity:' + s.op + '">' +
            (dernier ? '' : '<span style="position:absolute;left:10px;top:22px;bottom:2px;width:2px;background:#E3D9D4"></span>') +
            '<span style="position:absolute;left:0;top:1px;width:22px;height:22px;border-radius:50%;' +
                'display:grid;place-items:center;background:' + s.pastille + ';color:#fff;font-size:.62rem;">' +
                '<i class="fas ' + s.ic + '"></i></span>' +
            '<div style="font-weight:600;font-size:.88rem;color:' + s.txt + ';">' + e[0] + '</div>' +
            '<div style="font-size:.78rem;color:#7A6A63;line-height:1.45;">' + e[1] + '</div>' +
        '</li>';
    }).join('');
}

function fillAdmissionDetails(admission) {
    // Photo de l'élève
    const photoImg = document.getElementById('detailStudentPhoto');
    if (photoImg) {
        if (admission.photo_url) {
            photoImg.src = admission.photo_url;
            photoImg.style.display = 'block';
            photoImg.onerror = () => {
                photoImg.src = 'https://ui-avatars.com/api/?name=' + 
                    encodeURIComponent(admission.student_first_name + ' ' + admission.student_last_name) + 
                    '&background=5D4037&color=fff&size=128';
            };
        } else {
            photoImg.src = 'https://ui-avatars.com/api/?name=' + 
                encodeURIComponent(admission.student_first_name + ' ' + admission.student_last_name) + 
                '&background=5D4037&color=fff&size=128';
            photoImg.style.display = 'block';
        }
    }
    
    // Référence
    const refEl = document.getElementById('detailReference');
    if (refEl) refEl.textContent = `Réf: #${admission.id?.substring(0, 8).toUpperCase()}`;
    
    // Statut avec couleur
    const statusBanner = document.getElementById('detailStatusBanner');
    const statusText = document.getElementById('detailStatusText');
    const statusConfig = {
        'pending': { color: '#f59e0b', text: 'En attente de validation' },
        'accepted': { color: '#10b981', text: 'Inscription acceptée' },
        'rejected': { color: '#ef4444', text: 'Inscription rejetée' }
    };
    const config = statusConfig[admission.status] || statusConfig['pending'];
    if (statusBanner) statusBanner.style.background = config.color;
    if (statusText) statusText.textContent = config.text;
    
    // Informations élève
    // ATTENTION : l'ID du modal d'admission est admDetailStudentName.
    // 'detailStudentName' appartient au modal des reçus → le nom restait vide.
    setText('admDetailStudentName', `${admission.student_last_name} ${admission.student_first_name}`);
    setText('detailClass', admission.class_name || 'Non assignée');
    setText('detailBirthDate', admission.birth_date ? new Date(admission.birth_date).toLocaleDateString('fr-FR') : '-');
    setText('detailBirthPlace', admission.birth_place || '-');
    setText('detailGender', admission.gender === 'M' ? 'Masculin' : admission.gender === 'F' ? 'Féminin' : '-');
    setText('detailNationality', admission.nationality || 'Malienne');
    setText('detailPreviousSchool', admission.previous_school || 'Aucun');
    
    // Parents
    setText('detailFatherName', admission.father_name || '-');
    setText('detailFatherPhone', admission.father_phone || '-');
    setText('detailFatherEmail', admission.father_email || '-');
    setText('detailFatherJob', admission.father_job || '-');
    
    setText('detailMotherName', admission.mother_name || '-');
    setText('detailMotherPhone', admission.mother_phone || '-');
    setText('detailMotherEmail', admission.mother_email || '-');
    setText('detailMotherJob', admission.mother_job || '-');
    
    // Tuteur
    const tutorSection = document.getElementById('detailTutorSection');
    if (tutorSection) {
        if (admission.tutor_name) {
            tutorSection.style.display = 'block';
            setText('detailTutorName', admission.tutor_name);
            setText('detailTutorPhone', admission.tutor_phone || '-');
            setText('detailTutorRelation', admission.tutor_relation || '-');
        } else {
            tutorSection.style.display = 'none';
        }
    }
    
    // Contact
    setText('detailAddress', admission.address || '-');
    setText('detailCity', admission.city || '-');
    setText('detailCommune', admission.commune || '-');
    setText('detailEmergencyPhone', admission.emergency_phone || '-');
    
    // Parcours d'inscription + frais dus (école du Mali : le règlement se fait
    // au secrétariat ; la pré-inscription en ligne ne collecte aucun paiement)
    renderParcoursAdmission(admission);

    // Depuis la simplification du formulaire public, la pré-inscription ne
    // collecte plus que l'essentiel. Filiation complète, santé et scolarité
    // antérieure se remplissent AU SECRÉTARIAT : afficher vingt tirets
    // laisserait croire à un défaut du logiciel.
    masquerBlocsVides();

    // Santé
    setText('detailBloodGroup', admission.blood_group || 'Non renseigné');
    setText('detailDoctor', admission.doctor || '-');
    setText('detailAllergies', admission.allergies || 'Aucune allergie connue');
    setText('detailDiseases', admission.diseases || 'Aucune maladie chronique');
    
    // Date de réception de la demande (affichée en tête du parcours).
    // Le bloc « Montant payé / Méthode / Référence » a été retiré : la
    // pré-inscription en ligne ne collecte aucun paiement, ces champs
    // affichaient donc invariablement 0 FCFA et des tirets.
    setText('detailDate', new Date(admission.created_at).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }));
    
    // Documents avec visualisation
    const docsList = document.getElementById('detailDocuments');
    if (docsList) {
        docsList.innerHTML = '';
        const docs = admission.documents || {};
        
        const docTypes = [
            { key: 'extrait_naissance', label: 'Extrait de naissance', icon: 'fa-file-alt' },
            { key: 'photos_identite', label: 'Photos d\'identité', icon: 'fa-images' },
            { key: 'bulletins', label: 'Bulletins scolaires', icon: 'fa-graduation-cap' },
            { key: 'certificat_medical', label: 'Certificat médical', icon: 'fa-heartbeat' }
        ];
        
        docTypes.forEach(doc => {
            const entry = docs[doc.key];

            // Compatibilité : nouveau format {files:[{name,url}]} OU ancien {count, names}
            let files = [];
            let recuOriginal = false;
            if (entry) {
                // Nouveau format : piece ORIGINALE remise au secretariat,
                // enregistree depuis « Compléter la fiche ». Aucun fichier.
                if (entry.recu === true) recuOriginal = true;
                if (Array.isArray(entry.files)) files = entry.files;
                else if (Array.isArray(entry.names)) files = entry.names.map(n => ({ name: n, url: null }));
                else if (entry.count) files = Array.from({ length: entry.count }, () => ({ name: 'Fichier', url: null }));
            }

            const li = document.createElement('li');
            li.style.cssText = 'padding:10px 0;border-bottom:1px solid #e5e7eb;';

            // « Non fourni » accusait la famille d'un manquement. Le formulaire
            // public ne demande plus aucun document : la piece est simplement
            // attendue au secretariat, en ORIGINAL.
            let body = '<span style="color:#8a6414;font-size:.85rem;">' +
                       '<i class="fas fa-hourglass-half"></i> À remettre au secrétariat (original)</span>';
            if (recuOriginal) {
                body = '<span style="color:#2E7D32;font-size:.85rem;font-weight:600;">' +
                       '<i class="fas fa-circle-check"></i> Original reçu' +
                       (entry.date ? ' le ' + new Date(entry.date).toLocaleDateString('fr-FR') : '') +
                       '</span>';
            }
            if (files.length) {
                body = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">' +
                    files.map(f => {
                        if (!f.url) {
                            return `<span style="background:#f3f4f6;padding:4px 8px;border-radius:6px;font-size:.8rem;">${f.name}</span>`;
                        }
                        const isImg = /\.(jpe?g|png|gif|webp)$/i.test(f.url);
                        if (isImg) {
                            return `<img src="${f.url}" alt="${f.name}"
                                        onclick="openImagePreview('${f.url}', '${(f.name || '').replace(/'/g, "\\'")}')"
                                        style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;cursor:pointer;"
                                        title="Agrandir : ${f.name}">`;
                        }
                        return `<a href="${f.url}" target="_blank" rel="noopener" title="Ouvrir : ${f.name}">
                                    <div style="width:72px;height:72px;border-radius:6px;background:#f3f4f6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;">
                                        <i class="fas fa-file-pdf" style="font-size:1.5rem;color:#d33;"></i>
                                        <span style="font-size:.6rem;color:#666;">PDF</span>
                                    </div>
                                </a>`;
                    }).join('') + '</div>';
            }

            li.innerHTML = `
                <div style="display:flex;align-items:center;gap:10px;">
                    <i class="fas ${doc.icon}" style="color:${files.length ? '#10b981' : '#9ca3af'};width:20px;"></i>
                    <span style="flex:1;font-weight:500;">${doc.label}</span>
                    <span style="color:${files.length ? '#10b981' : '#9ca3af'};font-size:.85rem;">${files.length ? '✓ ' + files.length : ''}</span>
                </div>
                ${body}
            `;
            docsList.appendChild(li);
        });
    }
    
    // Notes
    setText('detailNotes', admission.notes || 'Aucune remarque');
    
    // Boutons d'action selon le statut
    const acceptBtn = document.getElementById('acceptBtn');
    const rejectBtn = document.getElementById('rejectBtn');
    const excludeBtn = document.getElementById('excludeBtn');
    
    if (admission.status === 'accepted') {
        if (acceptBtn) acceptBtn.style.display = 'none';
        if (rejectBtn) rejectBtn.style.display = 'none';
        if (excludeBtn) excludeBtn.style.display = 'block';
    } else if (admission.status === 'rejected') {
        if (acceptBtn) acceptBtn.style.display = 'none';
        if (rejectBtn) rejectBtn.style.display = 'none';
        if (excludeBtn) excludeBtn.style.display = 'none';
    } else {
        if (acceptBtn) acceptBtn.style.display = 'block';
        if (rejectBtn) rejectBtn.style.display = 'block';
        if (excludeBtn) excludeBtn.style.display = 'none';
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

/**
 * Visionneuse d'image intégrée (lightbox) avec bouton de fermeture.
 * Reste dans l'espace admin : pas de changement d'onglet.
 */
window.openImagePreview = function(url, name) {
    let overlay = document.getElementById('imagePreviewOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'imagePreviewOverlay';
        overlay.style.cssText = `
            position:fixed; inset:0; background:rgba(0,0,0,.85);
            display:flex; align-items:center; justify-content:center;
            z-index:100000; padding:30px; flex-direction:column; gap:14px;`;
        overlay.innerHTML = `
            <button id="imagePreviewClose" title="Fermer (Échap)"
                style="position:absolute; top:18px; right:24px; width:44px; height:44px;
                       border:none; border-radius:50%; background:rgba(255,255,255,.15);
                       color:#fff; font-size:1.6rem; cursor:pointer; line-height:1;">&times;</button>
            <img id="imagePreviewImg" src="" alt=""
                style="max-width:90vw; max-height:78vh; object-fit:contain;
                       border-radius:10px; box-shadow:0 10px 40px rgba(0,0,0,.5);">
            <div id="imagePreviewName" style="color:#eee; font-size:.95rem;"></div>
            <a id="imagePreviewOpen" href="#" target="_blank" rel="noopener"
                style="color:#9fd6ff; font-size:.85rem; text-decoration:none;">
                <i class="fas fa-external-link-alt"></i> Ouvrir dans un onglet
            </a>`;
        document.body.appendChild(overlay);

        const close = () => { overlay.style.display = 'none'; };
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        overlay.querySelector('#imagePreviewClose').addEventListener('click', close);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && overlay.style.display !== 'none') close();
        });
    }

    overlay.querySelector('#imagePreviewImg').src = url;
    overlay.querySelector('#imagePreviewName').textContent = name || '';
    overlay.querySelector('#imagePreviewOpen').href = url;
    overlay.style.display = 'flex';
};
/**
 * Accepte une inscription et crée l'élève
 */
/**
 * Rattache l'eleve nouvellement cree a un compte parent — en creant ce
 * compte s'il n'existe pas, ou en le retrouvant par NUMERO DE TELEPHONE
 * s'il existe deja (un meme parent inscrivant un second enfant, par
 * exemple). Fusionne ce qui etait auparavant deux etapes separees :
 * l'admission, puis un second formulaire de creation de compte ou
 * l'admin devait retaper un nom et un telephone deja saisis.
 */
async function rattacherOuCreerParentDepuisAdmission(admission, studentId) {
    const telephoneBrut = admission.father_phone || admission.telephone_parent;
    if (!telephoneBrut) return;   // rien a faire sans contact

    const telephone = normalizeMaliPhone(telephoneBrut);
    const nomComplet = (admission.father_name || admission.nom_parent || '').trim();
    const [prenom, ...resteNom] = nomComplet.split(' ');
    const nom = resteNom.join(' ') || prenom || 'Parent';
    const email = admission.father_email || admission.email_parent || null;

    // 1) Ce numero correspond-il a un parent DEJA CONNU ?
    // Simple rattachement : pas de nouveau compte, pas de nouveau SMS —
    // le parent a deja ses identifiants pour son premier enfant.
    const { data: existant } = await supabaseClient
        .from('parents').select('id').eq('phone', telephone).maybeSingle();

    if (existant) {
        const { error: errLien } = await supabaseClient.from('parent_students').insert([{
            parent_id: existant.id, student_id: studentId,
            relation: 'parent', is_primary: true,
            created_at: new Date().toISOString()
        }]);
        if (errLien) throw errLien;
        console.log('👥 Élève rattaché à un parent déjà existant :', existant.id);
        return;
    }

    // 2) Aucun compte pour ce numero : on le cree, avec les informations
    // DEJA saisies a l'admission — l'admin ne retape rien.
    const emailCompte = email || `${telephone.replace('+', '')}@parent.epmk.ml`;
    const motDePasse = genererMotDePasseEnseignant();   // meme algorithme, sans caracteres ambigus

    const { data: { session: sessionAdmin } } = await supabaseClient.auth.getSession();

    const { data: signUpData, error: errSignUp } = await supabaseClient.auth.signUp({
        email: emailCompte, password: motDePasse
    });

    // signUp connecte automatiquement le nouveau compte : on restaure
    // IMMEDIATEMENT la session admin, avant toute autre ecriture.
    if (sessionAdmin) await supabaseClient.auth.setSession(sessionAdmin);

    if (errSignUp) throw errSignUp;
    const authUserId = signUpData?.user?.id;
    if (!authUserId) throw new Error('Compte parent non créé (aucun identifiant renvoyé).');

    const { error: errParent } = await supabaseClient.from('parents').insert([{
        id: authUserId, first_name: prenom || 'Parent', last_name: nom,
        phone: telephone, email: email, address: admission.address || admission.commune || null,
        created_at: new Date().toISOString()
    }]);
    if (errParent) throw errParent;

    const { error: errProfil } = await supabaseClient.from('profiles').upsert({
        id: authUserId, email: emailCompte, role: 'parent', status: 'actif',
        created_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (errProfil) console.warn('Profil parent :', errProfil.message);

    const { error: errLien } = await supabaseClient.from('parent_students').insert([{
        parent_id: authUserId, student_id: studentId,
        relation: 'parent', is_primary: true,
        created_at: new Date().toISOString()
    }]);
    if (errLien) throw errLien;

    // SMS des identifiants : non bloquant. Le compte existe deja si le
    // reseau echoue — l'admin pourra reenvoyer depuis la fiche parent.
    try {
        await envoyerSmsEnseignant(telephone, prenom || 'Parent', emailCompte, motDePasse);
        console.log('📱 Identifiants envoyés par SMS au', telephone);
    } catch (errSms) {
        console.warn('SMS parent non envoyé :', errSms && errSms.message);
    }
}

window.acceptAdmission = async function(admissionId) {
    console.log('✅ Acceptation admission:', admissionId);
    
    if (!confirm('Êtes-vous sûr de vouloir accepter cette inscription ? Cela créera un compte élève.')) {
        return;
    }
    
    try {
        // 1. Récupérer les données de l'admission
        const { data: admission, error: fetchError } = await supabaseClient
            .from('admissions')
            .select('*')
            .eq('id', admissionId)
            .single();
        
        if (fetchError) throw fetchError;

        // Sans section, l'eleve serait cree sans classe : ni bulletin, ni
        // emploi du temps, ni frais calculables. Le formulaire public ne
        // demande qu'un NIVEAU — la section se choisit dans « Compléter la fiche ».
        if (!admission.class_id) {
            showToast('Choisissez d\'abord la section dans « Compléter la fiche » : ' +
                      'la demande porte sur le niveau « ' + (admission.class_name || '—') +
                      ' », sans section précisée.', 'error', 10000);
            return;
        }
        
        // 2. Générer un matricule unique
        const year = new Date().getFullYear();
        const random = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
        const matricule = `EPMK${year}${random}`;
        
        // 3. Créer l'élève
        const { data: student, error: studentError } = await supabaseClient
            .from('students')
            .insert([{
                first_name: admission.student_first_name,
                last_name: admission.student_last_name,
                birth_date: admission.birth_date,
                birth_place: admission.birth_place,
                gender: admission.gender,
                class_id: admission.class_id,
                matricule: matricule,
                status: 'actif',
                father_name: admission.father_name,
                father_phone: admission.father_phone,
                mother_name: admission.mother_name,
                mother_phone: admission.mother_phone,
                address: admission.address,
                city: admission.city,
                emergency_phone: admission.emergency_phone,
                photo_url: admission.photo_url || null,   // la photo suit l'élève
                documents: admission.documents || null    // et ses pièces justificatives
            }])
            .select()
            .single();
        
        if (studentError) throw studentError;
        
        console.log('✅ Élève créé:', student.id);

        // La photo prise pendant l'admission est rangee sous l'identifiant
        // de l'ADMISSION, que la politique de stockage ne reconnait pas.
        // On la deplace sous celui de l'ELEVE : sans cela, son parent ne
        // pourrait jamais la voir depuis le portail ni l'application.
        if (admission.photo_url && !/^https?:\/\//i.test(admission.photo_url)) {
            try {
                const nomFichier = admission.photo_url.split('/').pop();
                const nouveauChemin = student.id + '/' + nomFichier;
                const { error: errMove } = await supabaseClient.storage
                    .from('photos-eleves').move(admission.photo_url, nouveauChemin);
                if (!errMove) {
                    await supabaseClient.from('students')
                        .update({ photo_url: nouveauChemin }).eq('id', student.id);
                    console.log('📷 Photo déplacée :', nouveauChemin);
                }
            } catch (errPhoto) {
                // Non bloquant : l'eleve est cree. La photo se reprend
                // depuis sa fiche si besoin.
                console.warn('Photo non déplacée :', errPhoto && errPhoto.message);
            }
        }
        
        // 4. RATTACHER OU CRÉER LE COMPTE PARENT — fusion admission+compte.
        // Le formulaire public ne capture qu'UN contact (colonnes father_*
        // par convention historique). On evite ici la ressaisie que
        // l'admin devait faire ensuite dans un second formulaire separe,
        // et on detecte un parent DEJA connu par son numero pour eviter
        // les doublons quand un meme parent inscrit un second enfant.
        try {
            await rattacherOuCreerParentDepuisAdmission(admission, student.id);
        } catch (errParent) {
            // Non bloquant : l'eleve est cree, l'admin peut toujours
            // rattacher un parent manuellement depuis la fiche eleve.
            console.warn('Rattachement parent :', errParent && errParent.message);
        }

        // 5. Créer le paiement associé
        if (admission.amount > 0) {
            const { error: paymentError } = await supabaseClient
                .from('payments')
                .insert([{
                    student_id: student.id,
                    amount: admission.amount,
                    type: 'inscription',
                    payment_method: admission.payment_method,
                    payment_ref: admission.payment_ref,
                    date: new Date().toISOString()
                }]);
            
            if (paymentError) {
                console.warn('⚠️ Erreur création paiement:', paymentError);
            }
        }
        
        // 5. Mettre à jour le statut de l'admission
        const { error: updateError } = await supabaseClient
            .from('admissions')
            .update({ 
                status: 'accepted',
                student_id: student.id,
                accepted_at: new Date().toISOString()
            })
            .eq('id', admissionId);
        
        if (updateError) throw updateError;
        
        showToast('Inscription acceptée avec succès ! Élève créé.', 'success');
        await loadAdmissions();
        
    } catch (error) {
        console.error('❌ Erreur acceptation:', error);
        showToast('Erreur: ' + error.message, 'error');
    }
};

// ════════════════════════════════════════════════════════════════════
// ACTIONS SUR L'ADMISSION OUVERTE
// --------------------------------------------------------------------
// Les boutons du modal appelaient acceptCurrentAdmission(),
// rejectCurrentAdmission() et excludeCurrentAdmission() — trois fonctions
// qui n'ont jamais existe. Les vraies s'appellent acceptAdmission(id) /
// rejectAdmission(id) et attendent un identifiant. D'ou le
// « ReferenceError: acceptCurrentAdmission is not defined » a chaque clic.
// ════════════════════════════════════════════════════════════════════

/**
 * Complete une demande d'admission AVANT de l'accepter.
 * 
 * Le formulaire public ne recueille que l'essentiel (identite, classe,
 * contact). Filiation complete, sante et scolarite anterieure se
 * renseignent ici, au moment ou la famille se presente au secretariat
 * avec ses originaux. Sans cet ecran, il faudrait accepter l'eleve puis
 * le retrouver dans la liste pour completer sa fiche : deux etapes
 * separees, et un dossier incomplet entre les deux.
 */
// ════════════════════════════════════════════════════════════════════
// PHOTOS D'ÉLÈVES — bucket privé + URL signée
// --------------------------------------------------------------------
// Les photos partaient dans le bucket `admissions`, qui est PUBLIC :
// un portrait d'enfant y etait accessible a qui devine l'URL, sans
// authentification et indefiniment. Elles vivent desormais dans
// `photos-eleves`, prive, consultable par URL signee valable une heure.
//
// `students.photo_url` contient le CHEMIN dans le bucket, pas une URL :
// une URL signee expire, elle ne peut pas servir de reference durable.
// ════════════════════════════════════════════════════════════════════

const BUCKET_PHOTOS = 'photos-eleves';
const _cachePhotos = {};   // evite de resigner la meme photo a chaque rendu

/**
 * Transforme la valeur de photo_url en URL affichable.
 * Reconnait les DEUX formats :
 *   - une URL complete (ancienne photo du bucket public) → renvoyee telle quelle
 *   - un chemin dans le bucket prive → URL signee generee a la demande
 */
async function urlPhotoEleve(valeur) {
    if (!valeur) return null;
    if (/^https?:\/\//i.test(valeur)) return valeur;   // heritage : URL publique

    if (_cachePhotos[valeur] && _cachePhotos[valeur].expire > Date.now()) {
        return _cachePhotos[valeur].url;
    }
    try {
        const { data, error } = await supabaseClient.storage
            .from(BUCKET_PHOTOS).createSignedUrl(valeur, 3600);
        if (error || !data?.signedUrl) return null;
        _cachePhotos[valeur] = { url: data.signedUrl, expire: Date.now() + 3300000 };
        return data.signedUrl;
    } catch (e) {
        console.warn('Photo non signee :', e && e.message);
        return null;
    }
}
window.urlPhotoEleve = urlPhotoEleve;

/**
 * Depose une photo dans le bucket prive et renvoie son CHEMIN.
 * Le nom du fichier ne contient ni le nom ni le matricule de l'eleve :
 * un chemin parlant identifierait l'enfant meme hors contexte.
 */
async function televerserPhotoEleve(fichier, eleveId) {
    if (!fichier) return null;
    if (fichier.size > 2 * 1024 * 1024) {
        throw new Error('La photo dépasse 2 Mo. Choisissez une image plus légère.');
    }
    const ext = (fichier.name.split('.').pop() || 'jpg').toLowerCase();
    // Le chemin commence par l'IDENTIFIANT de l'eleve. C'est la seule
    // facon pour la politique de stockage de savoir a qui appartient la
    // photo, et donc d'autoriser SON parent a la lire sans ouvrir le
    // bucket a tout le monde. Un UUID n'identifie personne pour un humain :
    // le chemin reste muet, contrairement a « photo_TOURE_Hamidou.jpg ».
    const prefixe = eleveId ? (eleveId + '/') : '';
    const chemin = prefixe + Date.now() + '-' +
                   Math.random().toString(36).slice(2, 10) + '.' + ext;

    const { error } = await supabaseClient.storage
        .from(BUCKET_PHOTOS).upload(chemin, fichier, { upsert: false });
    if (error) throw error;
    return chemin;
}
window.televerserPhotoEleve = televerserPhotoEleve;

// Pieces attendues d'un dossier d'admission.
// [cle, libelle, icone, obligatoire]
// Alias : eleves et admissions attendent exactement les memes pieces.
const PIECES_ADMISSION = PIECES_ATTENDUES;

window.completerFicheAdmission = async function () {
    if (!currentAdmissionId) {
        showToast('Aucune demande selectionnee', 'error');
        return;
    }

    try {
        const { data: a, error } = await supabaseClient
            .from('admissions').select('*').eq('id', currentAdmissionId).single();
        if (error || !a) throw error || new Error('Demande introuvable');

        const docs = a.documents || {};
        const v = (x) => (x === null || x === undefined) ? '' : String(x);
        const champ = (id, lbl, valeur, type) =>
            '<div class="form-group">' +
              '<label>' + lbl + '</label>' +
              '<input type="' + (type || 'text') + '" id="' + id + '" class="form-control" value="' +
                  v(valeur).replace(/"/g, '&quot;') + '">' +
            '</div>';

        const html =
        '<div class="modal-content" style="max-width:760px;">' +
          '<div class="modal-header">' +
            '<h3><i class="fas fa-pen-to-square"></i> Compléter la fiche</h3>' +
            '<button class="close-modal" onclick="closeModal(\'completerModal\')">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<p style="font-size:.86rem;color:#7A6A63;margin:-4px 0 16px;">' +
              '<strong style="color:#2A211D;">' + v(a.student_last_name) + ' ' + v(a.student_first_name) + '</strong>' +
              ' — renseignez ce que la famille apporte. Les champs vides restent vides.</p>' +

            // La photo se prend AU SECRETARIAT, au moment ou la famille se
            // presente : cadrage et fond homogenes pour la carte d'eleve,
            // et aucune photo d'enfant stockee pour un dossier jamais admis.
            '<div style="display:flex;align-items:center;gap:16px;background:#FAF8F7;' +
              'border:1.5px solid #D7CCC8;border-radius:12px;padding:14px 16px;margin-bottom:18px;">' +
              '<div id="cfPhotoApercu" style="width:82px;height:82px;border-radius:10px;' +
                'background:#EFEBE9;display:grid;place-items:center;overflow:hidden;flex-shrink:0;">' +
                '<i class="fas fa-camera" style="color:#A1887F;font-size:1.5rem;"></i></div>' +
              '<div style="flex:1;">' +
                '<label style="font-weight:600;font-size:.9rem;color:#4E342E;">Photo de l\'élève</label>' +
                '<p style="font-size:.79rem;color:#7A6A63;margin:3px 0 8px;line-height:1.45;">' +
                  'Prise ici, au secrétariat : cadrage et fond homogènes pour la carte ' +
                  'd\'élève et le bulletin. JPG ou PNG, 2 Mo maximum.</p>' +
                '<input type="file" id="cf_photo" accept="image/*" capture="environment" ' +
                  'onchange="apercuPhotoEleve(this)" style="font-size:.85rem;">' +
              '</div>' +
            '</div>' +

            // Le formulaire public ne demande qu'un NIVEAU (« 9e Année ») :
            // la section (A, B...) releve de l'organisation interne et se
            // choisit ici, selon les effectifs de chaque section.
            '<div style="background:#FFFDF7;border:1.5px solid #E6C976;border-radius:12px;' +
              'padding:14px 16px;margin-bottom:18px;">' +
              '<label style="font-weight:600;font-size:.9rem;color:#8a6414;">' +
                'Classe demandée : ' + (a.class_name || '—') + '</label>' +
              '<p style="font-size:.79rem;color:#7A6A63;margin:3px 0 8px;">' +
                'Choisissez la section d\'affectation. Sans elle, l\'élève ne pourra ' +
                'être inscrit dans aucune classe.</p>' +
              '<select id="cf_class_id" class="form-control">' +
                '<option value="">Section à choisir…</option>' +
              '</select>' +
            '</div>' +

            '<h4 style="margin:0 0 10px;color:#4E342E;font-size:.95rem;">Élève</h4>' +
            '<div class="form-row">' +
              champ('cf_birth_place', 'Lieu de naissance', a.birth_place) +
              champ('cf_nationality', 'Nationalité', a.nationality || 'Malienne') +
            '</div>' +
            champ('cf_previous_school', 'École précédente', a.previous_school) +

            '<h4 style="margin:18px 0 10px;color:#4E342E;font-size:.95rem;">Père</h4>' +
            '<div class="form-row">' +
              champ('cf_father_name', 'Nom et prénom', a.father_name) +
              champ('cf_father_phone', 'Téléphone', a.father_phone, 'tel') +
            '</div>' +
            '<div class="form-row">' +
              champ('cf_father_job', 'Profession', a.father_job) +
              champ('cf_father_email', 'E-mail', a.father_email, 'email') +
            '</div>' +

            '<h4 style="margin:18px 0 10px;color:#4E342E;font-size:.95rem;">Mère</h4>' +
            '<div class="form-row">' +
              champ('cf_mother_name', 'Nom et prénom', a.mother_name) +
              champ('cf_mother_phone', 'Téléphone', a.mother_phone, 'tel') +
            '</div>' +
            '<div class="form-row">' +
              champ('cf_mother_job', 'Profession', a.mother_job) +
              champ('cf_mother_email', 'E-mail', a.mother_email, 'email') +
            '</div>' +

            '<h4 style="margin:18px 0 10px;color:#4E342E;font-size:.95rem;">Tuteur (si différent)</h4>' +
            '<div class="form-row">' +
              champ('cf_tutor_name', 'Nom et prénom', a.tutor_name) +
              champ('cf_tutor_phone', 'Téléphone', a.tutor_phone, 'tel') +
            '</div>' +
            champ('cf_tutor_relation', 'Lien avec l\'élève', a.tutor_relation) +

            '<h4 style="margin:18px 0 10px;color:#4E342E;font-size:.95rem;">Adresse</h4>' +
            champ('cf_address', 'Adresse (quartier, rue, porte)', a.address) +

            '<h4 style="margin:18px 0 10px;color:#4E342E;font-size:.95rem;">Santé</h4>' +
            '<div class="form-row">' +
              champ('cf_blood_group', 'Groupe sanguin', a.blood_group) +
              champ('cf_doctor', 'Centre de santé / médecin', a.doctor) +
            '</div>' +
            champ('cf_allergies', 'Allergies connues', a.allergies) +
            champ('cf_diseases', 'Maladies chroniques', a.diseases) +

            // Pieces ORIGINALES remises au secretariat. Le formulaire public ne
            // demande plus aucun televersement : c'est ici qu'on enregistre ce
            // que la famille apporte physiquement.
            '<h4 style="margin:18px 0 6px;color:#4E342E;font-size:.95rem;">' +
              'Pièces reçues au secrétariat</h4>' +
            '<p style="font-size:.8rem;color:#7A6A63;margin:0 0 10px;">' +
              'Cochez uniquement les <strong>originaux</strong> effectivement remis.</p>' +
            PIECES_ADMISSION.map(function (p) {
                const recu = !!(docs[p[0]] && docs[p[0]].recu);
                return '<label style="display:flex;align-items:center;gap:11px;padding:10px 13px;' +
                    'border:1.5px solid ' + (recu ? '#A5D6A7' : '#E3D9D4') + ';border-radius:10px;' +
                    'margin-bottom:7px;cursor:pointer;background:' + (recu ? '#F1F8E9' : '#fff') + ';">' +
                    '<input type="checkbox" id="cfdoc_' + p[0] + '" ' + (recu ? 'checked' : '') +
                        ' style="width:auto;flex-shrink:0;">' +
                    '<i class="fas ' + p[2] + '" style="color:#8D6E63;width:17px;"></i>' +
                    '<span style="flex:1;font-size:.89rem;">' + p[1] +
                        (p[3] ? '' : ' <span style="font-size:.78rem;color:#7A6A63;">(si applicable)</span>') +
                        (docs[p[0]] && docs[p[0]].date
                            ? '<br><small style="color:#7A6A63;">Reçu le ' +
                              new Date(docs[p[0]].date).toLocaleDateString('fr-FR') + '</small>'
                            : '') +
                    '</span></label>';
            }).join('') +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" onclick="closeModal(\'completerModal\')">Annuler</button> ' +
            '<button class="btn btn-primary" onclick="enregistrerFicheAdmission()">' +
              '<i class="fas fa-save"></i> Enregistrer</button>' +
          '</div>' +
        '</div>';

        let m = document.getElementById('completerModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'completerModal';
            m.className = 'modal';
            document.body.appendChild(m);
        }
        m.innerHTML = html;
        m.style.display = 'flex';

        // Sections correspondant au niveau demande. On propose en priorite
        // celles dont le nom commence par le niveau ; a defaut, toutes.
        try {
            const { data: classes } = await supabaseClient
                .from('classes').select('id, nom').order('nom');
            const niveau = (a.class_name || '').trim().toLowerCase();
            const correspond = (classes || []).filter(c =>
                niveau && (c.nom || '').trim().toLowerCase().startsWith(niveau));
            const autres = (classes || []).filter(c => !correspond.includes(c));

            const sel = document.getElementById('cf_class_id');
            if (sel) {
                let opts = '<option value="">Section à choisir…</option>';
                if (correspond.length) {
                    opts += '<optgroup label="Sections du niveau demandé">' +
                        correspond.map(c => '<option value="' + c.id + '"' +
                            (a.class_id === c.id ? ' selected' : '') + '>' + c.nom + '</option>').join('') +
                        '</optgroup>';
                }
                if (autres.length) {
                    opts += '<optgroup label="Autres classes">' +
                        autres.map(c => '<option value="' + c.id + '"' +
                            (a.class_id === c.id ? ' selected' : '') + '>' + c.nom + '</option>').join('') +
                        '</optgroup>';
                }
                sel.innerHTML = opts;
                // Une seule section pour ce niveau : on la choisit d'office.
                if (correspond.length === 1 && !a.class_id) sel.value = correspond[0].id;
            }
        } catch (e) { console.warn('Sections :', e && e.message); }

    } catch (err) {
        console.error('Completer la fiche :', err);
        showToast('Impossible d\'ouvrir la fiche : ' + (err.message || ''), 'error');
    }
};

// Apercu immediat : le secretariat voit tout de suite si le cadrage
// convient, sans avoir a enregistrer puis rouvrir la fiche.
window.apercuPhotoEleve = function (input) {
    const zone = document.getElementById('cfPhotoApercu');
    const f = input && input.files && input.files[0];
    if (!zone || !f) return;
    if (f.size > 2 * 1024 * 1024) {
        showToast('La photo dépasse 2 Mo. Choisissez une image plus légère.', 'error');
        input.value = '';
        return;
    }
    const url = URL.createObjectURL(f);
    zone.innerHTML = '<img src="' + url + '" alt="" ' +
        'style="width:100%;height:100%;object-fit:cover;">';
};

window.enregistrerFicheAdmission = async function () {
    if (!currentAdmissionId) return;
    const val = id => document.getElementById(id)?.value?.trim() || null;

    try {
        const maj = {
            class_id:        val('cf_class_id'),
            birth_place:     val('cf_birth_place'),
            nationality:     val('cf_nationality'),
            previous_school: val('cf_previous_school'),
            father_name:     val('cf_father_name'),
            father_phone:    normalizeMaliPhone(val('cf_father_phone')) || val('cf_father_phone'),
            father_job:      val('cf_father_job'),
            father_email:    val('cf_father_email'),
            mother_name:     val('cf_mother_name'),
            mother_phone:    normalizeMaliPhone(val('cf_mother_phone')) || val('cf_mother_phone'),
            mother_job:      val('cf_mother_job'),
            mother_email:    val('cf_mother_email'),
            tutor_name:      val('cf_tutor_name'),
            tutor_phone:     normalizeMaliPhone(val('cf_tutor_phone')) || val('cf_tutor_phone'),
            tutor_relation:  val('cf_tutor_relation'),
            address:         val('cf_address'),
            blood_group:     val('cf_blood_group'),
            doctor:          val('cf_doctor'),
            allergies:       val('cf_allergies'),
            diseases:        val('cf_diseases')
        };

        // Photo : deposee dans le bucket PRIVE, on enregistre son CHEMIN.
        const champPhoto = document.getElementById('cf_photo');
        const fichier = champPhoto && champPhoto.files && champPhoto.files[0];
        if (fichier) {
            try {
                maj.photo_url = await televerserPhotoEleve(fichier, currentAdmissionId);
            } catch (errPhoto) {
                // La photo n'est pas bloquante : le reste de la fiche doit
                // s'enregistrer meme si le depot echoue.
                console.error('Photo :', errPhoto);
                showToast('Photo non enregistrée : ' + (errPhoto.message || ''), 'warning', 8000);
            }
        }

        // Pieces reçues : on conserve la date d'origine si la piece l'etait deja.
        const { data: avant } = await supabaseClient
            .from('admissions').select('documents').eq('id', currentAdmissionId).maybeSingle();
        const ancien = (avant && avant.documents) || {};
        const documents = {};
        PIECES_ADMISSION.forEach(function (p) {
            const cb = document.getElementById('cfdoc_' + p[0]);
            if (cb && cb.checked) {
                documents[p[0]] = {
                    recu: true,
                    label: p[1],
                    date: (ancien[p[0]] && ancien[p[0]].date) || new Date().toISOString().slice(0, 10)
                };
            }
        });
        maj.documents = documents;

        const { error } = await supabaseClient
            .from('admissions').update(maj).eq('id', currentAdmissionId);
        if (error) throw error;

        closeModal('completerModal');
        showToast('Fiche complétée', 'success');

        // Recharger le detail pour que les blocs masques reapparaissent
        if (typeof viewAdmission === 'function') viewAdmission(currentAdmissionId);

    } catch (err) {
        console.error('Enregistrement de la fiche :', err);
        showToast('Erreur : ' + (err.message || ''), 'error');
    }
};

window.acceptCurrentAdmission = function () {
    if (!currentAdmissionId) {
        showToast('Aucune demande selectionnee', 'error');
        return;
    }
    return acceptAdmission(currentAdmissionId);
};

window.rejectCurrentAdmission = function () {
    if (!currentAdmissionId) {
        showToast('Aucune demande selectionnee', 'error');
        return;
    }
    return rejectAdmission(currentAdmissionId);
};

window.excludeCurrentAdmission = function () {
    if (!currentAdmissionId) {
        showToast('Aucune demande selectionnee', 'error');
        return;
    }
    if (typeof window.excludeAdmission === 'function') {
        return window.excludeAdmission(currentAdmissionId);
    }
    showToast("L'exclusion n'est pas disponible", 'warning');
};

window.printAdmissionDetails = function() {
    if (!currentAdmissionId) return;

    // Valeur d'un champ du modal. Les champs vides ne sont plus rendus par un
    // tiret : depuis la simplification du formulaire public, la fiche imprimee
    // sert de FORMULAIRE PAPIER que la famille complete au secretariat.
    // Un champ vide doit donc offrir une LIGNE A ECRIRE.
    const LIGNE = '<span class="aremplir"></span>';
    const brut = id => document.getElementById(id)?.textContent?.trim() || '';
    const estVide = v => !v || v === '-' || /^(Aucune?|Non renseign)/i.test(v);
    const g = id => { const v = brut(id); return estVide(v) ? LIGNE : v; };
    const photoSrc   = document.getElementById('detailStudentPhoto')?.src || '';
    const studentName = g('admDetailStudentName');   // ID du modal d'admission
    const studentClass = g('detailClass');
    const ref         = g('detailReference');
    const statusText  = g('detailStatusText');
    const statusColor = document.getElementById('detailStatusBanner')?.style?.background || '#f59e0b';

    const now = new Date().toLocaleDateString('fr-FR', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    function buildPrintDoc(photoDataUrl) {

        const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Fiche d'inscription — ${studentName}</title>
<style>
@page{size:A4 portrait;margin:7mm 11mm}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:9pt;color:#1a1a2e;background:#fff}
.header{display:flex;align-items:stretch;border:2px solid #5D4037;border-radius:6px;overflow:hidden;margin-bottom:6px}
.hlogo{width:72px;background:linear-gradient(160deg,#5D4037,#8D6E63);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px;flex-shrink:0}
.hlogo-circle{width:46px;height:46px;border-radius:50%;border:2px solid rgba(255,255,255,.6);background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:20pt;font-weight:900;color:#fff;margin-bottom:4px}
.hlogo-lbl{font-size:7pt;font-weight:700;color:rgba(255,255,255,.9);letter-spacing:1px}
.hschool{flex:1;padding:8px 12px;border-left:2px solid #5D4037;border-right:2px solid #5D4037}
.hschool-name{font-size:13pt;font-weight:800;color:#5D4037;margin-bottom:3px}
.hschool-sub{font-size:7.5pt;color:#6b7280;line-height:1.6}
.hschool-agr{display:inline-block;margin-top:4px;background:#f0fdf4;border:1px solid #10b981;border-radius:3px;padding:1px 6px;font-size:7pt;color:#065f46;font-weight:600}
.hdoc{width:110px;background:linear-gradient(160deg,#5D4037,#8D6E63);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px;flex-shrink:0}
.hdoc h1{font-size:8.5pt;font-weight:800;color:#fff;text-align:center;letter-spacing:.5px;margin-bottom:4px}
.hdoc .ref{font-size:7pt;color:rgba(255,255,255,.85);text-align:center;margin-bottom:4px}
.hdoc .annee{font-size:7.5pt;font-weight:700;background:rgba(255,255,255,.2);color:#fff;padding:2px 6px;border-radius:10px}
.status-bar{display:flex;align-items:center;justify-content:center;gap:8px;padding:4px 12px;border-radius:4px;font-size:8.5pt;font-weight:700;color:#fff;margin-bottom:6px;background:${statusColor}}
.student-block{display:flex;gap:10px;border:1.5px solid #e5e7eb;border-radius:6px;padding:8px;margin-bottom:6px;background:linear-gradient(135deg,#fdfcfb,#f5f0ec)}
.photo-frame{width:84px;height:104px;border:2.5px solid #5D4037;border-radius:6px;overflow:hidden;background:#f3f4f6;flex-shrink:0}
.photo-frame img{width:100%;height:100%;object-fit:cover}
.photo-ph{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#9ca3af;font-size:7pt;gap:4px}
.photo-ph .ic{font-size:24pt}
.sinfo{flex:1;display:flex;flex-direction:column;gap:4px}
.sname{font-size:14pt;font-weight:800;color:#5D4037;border-bottom:2px solid #8D6E63;padding-bottom:4px}
.stag{display:inline-flex;align-items:center;gap:5px;background:#5D4037;color:#fff;padding:3px 10px;border-radius:12px;font-size:8pt;font-weight:600;width:fit-content}
.chips{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.chip{background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:3px 7px}
.chip-lbl{font-size:6.5pt;color:#9ca3af;text-transform:uppercase;letter-spacing:.4px}
.chip-val{font-size:8.5pt;font-weight:600;color:#1f2937}
.section{margin-bottom:4px;page-break-inside:avoid}
.shead{display:flex;align-items:center;gap:6px;background:linear-gradient(90deg,#5D4037,#8D6E63);color:#fff;padding:4px 10px;border-radius:4px 4px 0 0;font-size:8pt;font-weight:700;letter-spacing:.5px}
.sbody{border:1.5px solid #e5e7eb;border-top:none;border-radius:0 0 4px 4px;padding:6px;background:#fff}
.sbody.nopad{padding:0}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.full{grid-column:1/-1}
.field{background:#f9fafb;border-left:3px solid #8D6E63;border-radius:0 4px 4px 0;padding:4px 8px}
/* Champ non renseigne en ligne : ligne pointillee a completer au stylo. */
.aremplir{display:inline-block;min-width:70%;border-bottom:1px dotted #9ca3af;height:9pt;vertical-align:bottom}
.field.danger{border-left-color:#ef4444;background:#fff5f5}
.flbl{font-size:6.5pt;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;margin-bottom:1px}
.fval{font-size:8.5pt;font-weight:600;color:#1f2937}
.field.danger .fval{color:#dc2626;font-size:10pt}
.pg{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.pc{border:1px solid #e5e7eb;border-radius:4px;overflow:hidden}
.pc-head{background:#f3f4f6;padding:4px 8px;font-size:7.5pt;font-weight:700;color:#374151;border-bottom:1px solid #e5e7eb}
.pc-body{padding:5px 8px}
.pl{font-size:8pt;color:#4b5563;padding:1.5px 0;display:flex;gap:5px}
.pl strong{color:#1f2937;min-width:60px}
.dt{width:100%;border-collapse:collapse;font-size:8pt}
.dt thead tr{background:#5D4037;color:#fff}
.dt th{padding:5px 8px;text-align:left;font-weight:600;font-size:7.5pt}
.dt td{padding:5px 8px;border-bottom:1px solid #f3f4f6}
.dt tr:nth-child(even) td{background:#f9fafb}
.ok{color:#059669;font-weight:700}
.nok{color:#9ca3af}
.paystrip{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:2px solid #10b981;border-radius:6px;padding:8px 14px}
.payl{font-size:7pt;color:#6b7280;text-transform:uppercase}
.paya{font-size:16pt;font-weight:800;color:#065f46}
.payd{text-align:right;font-size:8pt;color:#374151}
.payd strong{display:block;font-size:9pt}
.sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:10px;page-break-inside:avoid}
.sig-box{text-align:center}
.sig-lbl{font-size:8.5pt;font-weight:700;color:#374151;margin-bottom:2px}
.sig-sub{font-size:7pt;color:#6b7280;font-style:italic;margin-bottom:5px;min-height:9pt}
/* Zone de signature : 22 mm de haut — la hauteur d'une signature manuscrite.
   Auparavant 18px (≈4,8 mm) : matériellement impossible à signer. */
.sig-zone{height:20mm;border-bottom:1.5px solid #374151}
/* Cachet : un tampon rond d'école mesure 40 mm de diamètre.
   Il lui faut un cadre dédié, pas une simple ligne. */
.sig-zone.cachet{height:30mm;border:1.5px dashed #9ca3af;border-radius:5px;
  display:flex;align-items:flex-end;justify-content:center;padding-bottom:3px}
.sig-zone.cachet::after{content:'emplacement du cachet';font-size:6pt;color:#c7cdd4;font-style:italic}
/* Bandeau de reçu à remplir à la main lors de l'encaissement */
.payrec{display:flex;gap:14px;margin-top:8px;font-size:8pt;color:#374151}
.payrec span{flex:1}
.payrec .fill{display:inline-block;min-width:60px;border-bottom:1px dotted #9ca3af}
.dfooter{margin-top:5px;padding-top:6px;border-top:1px dashed #d1d5db;display:flex;justify-content:space-between;align-items:center;font-size:7pt;color:#9ca3af}
.conf{background:#fef3c7;border:1px solid #f59e0b;color:#92400e;padding:1px 6px;border-radius:3px;font-size:6.5pt;font-weight:700}
.no-print{position:fixed;bottom:20px;right:20px;display:flex;gap:8px;z-index:999}
.btn-p{background:#5D4037;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:10pt;cursor:pointer;font-weight:600;box-shadow:0 4px 12px rgba(93,64,55,.4)}
.btn-c{background:#6b7280;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:10pt;cursor:pointer;font-weight:600}
@media print{.no-print{display:none!important}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.section{page-break-inside:avoid}.sigs,.paystrip,.student-block,.dfooter{page-break-inside:avoid}html,body{height:auto}}
</style>
</head>
<body>
<div id="fiche">
<div class="header">
  <div class="hlogo"><div class="hlogo-circle">M</div><div class="hlogo-lbl">EPMK</div></div>
  <div class="hschool">
    <div class="hschool-name">École Privée Moussa Koné</div>
    <div class="hschool-sub">Sébénicoro-Sibiribougou, Bamako, Mali &nbsp;·&nbsp; Tél : +223 20 21 22 29 &nbsp;·&nbsp; contact@epmk.ml<br>
      <span class="hschool-agr">✓ Agréée — Ministère de l'Éducation Nationale du Mali</span></div>
  </div>
  <div class="hdoc"><h1>FICHE D'INSCRIPTION</h1><div class="ref">${ref}</div><div class="annee">${anneeDocument()}</div></div>
</div>

<div class="status-bar">● ${statusText}</div>

<div class="student-block">
  <div class="photo-frame">
    ${photoDataUrl ? `<img src="${photoDataUrl}" alt="Photo élève">` : `<div class="photo-ph"><div class="ic">👤</div><div>Photo d'identité</div></div>`}
  </div>
  <div class="sinfo">
    <div class="sname">${studentName}</div>
    <div class="stag">📚 ${studentClass}</div>
    <div class="chips">
      <div class="chip"><div class="chip-lbl">Date de naissance</div><div class="chip-val">${g('detailBirthDate')}</div></div>
      <div class="chip"><div class="chip-lbl">Lieu de naissance</div><div class="chip-val">${g('detailBirthPlace')}</div></div>
      <div class="chip"><div class="chip-lbl">Sexe</div><div class="chip-val">${g('detailGender')}</div></div>
      <div class="chip"><div class="chip-lbl">Nationalité</div><div class="chip-val">${g('detailNationality')}</div></div>
      <div class="chip"><div class="chip-lbl">Étab. précédent</div><div class="chip-val">${g('detailPreviousSchool')}</div></div>
      <div class="chip"><div class="chip-lbl">Date d'inscription</div><div class="chip-val">${g('detailDate')}</div></div>
    </div>
  </div>
</div>

<div class="section">
  <div class="shead">👨‍👩‍👧 INFORMATIONS DES PARENTS / TUTEURS</div>
  <div class="sbody">
    <div class="pg">
      <div class="pc"><div class="pc-head">👨 Père</div><div class="pc-body">
        <div class="pl"><strong>Nom :</strong>${g('detailFatherName')}</div>
        <div class="pl"><strong>Tél :</strong>${g('detailFatherPhone')}</div>
        <div class="pl"><strong>Email :</strong>${g('detailFatherEmail')}</div>
        <div class="pl"><strong>Profession :</strong>${g('detailFatherJob')}</div>
      </div></div>
      <div class="pc"><div class="pc-head">👩 Mère</div><div class="pc-body">
        <div class="pl"><strong>Nom :</strong>${g('detailMotherName')}</div>
        <div class="pl"><strong>Tél :</strong>${g('detailMotherPhone')}</div>
        <div class="pl"><strong>Email :</strong>${g('detailMotherEmail')}</div>
        <div class="pl"><strong>Profession :</strong>${g('detailMotherJob')}</div>
      </div></div>
    </div>
  </div>
</div>

<div class="section">
  <div class="shead">📍 ADRESSE & CONTACT D'URGENCE</div>
  <div class="sbody">
    <div class="g2">
      <div class="field full"><div class="flbl">Adresse complète</div><div class="fval">${g('detailAddress')} — ${g('detailCity')} / ${g('detailCommune')}</div></div>
      <div class="field full danger"><div class="flbl">🚨 Téléphone d'urgence</div><div class="fval">${g('detailEmergencyPhone')}</div></div>
    </div>
  </div>
</div>

<div class="section">
  <div class="shead">❤️ INFORMATIONS MÉDICALES</div>
  <div class="sbody">
    <div class="g3">
      <div class="field"><div class="flbl">Groupe sanguin</div><div class="fval">${g('detailBloodGroup')}</div></div>
      <div class="field"><div class="flbl">Centre de santé / médecin</div><div class="fval">${g('detailDoctor')}</div></div>
      <div class="field"><div class="flbl">Allergies</div><div class="fval">${g('detailAllergies')}</div></div>
      <div class="field full"><div class="flbl">Maladies / Traitements</div><div class="fval">${g('detailDiseases')}</div></div>
    </div>
  </div>
</div>

<div class="section">
  <div class="shead">📂 DOCUMENTS FOURNIS</div>
  <div class="sbody nopad">
    <table class="dt">
      <thead><tr><th>Document requis</th><th style="width:90px">Statut</th><th>Observation</th></tr></thead>
      <tbody>
        <tr><td>📄 Extrait de naissance</td><td id="pd_birth"></td><td>Original + photocopie</td></tr>
        <tr><td>📸 Photos d'identité (×2)</td><td id="pd_photos"></td><td>Fond blanc, récentes</td></tr>
        <tr><td>📋 Bulletins scolaires</td><td id="pd_bul"></td><td>Année précédente si transfert</td></tr>
        <tr><td>🏥 Certificat médical</td><td id="pd_med"></td><td>Moins de 3 mois</td></tr>
      </tbody>
    </table>
  </div>
</div>

<div class="section">
  <div class="shead">💰 FRAIS D'INSCRIPTION</div>
  <div class="sbody">
    <div class="paystrip">
      <div><div class="payl">Montant dû</div><div class="paya">${g('detailFraisInscription')}</div></div>
      <div class="payd">À régler au secrétariat<br><small style="color:#6b7280">Demande reçue le ${g('detailDate')}</small></div>
    </div>
    <div class="payrec">
      <span>Reçu n° : <b class="fill"></b></span>
      <span>Montant perçu : <b class="fill"></b></span>
      <span>Le : <b class="fill"></b></span>
    </div>
  </div>
</div>

<div class="sigs">
  <div class="sig-box">
    <div class="sig-lbl">Signature du Parent / Tuteur</div>
    <div class="sig-sub">« J'atteste l'exactitude des informations »</div>
    <div class="sig-zone"></div>
  </div>
  <div class="sig-box">
    <div class="sig-lbl">Signature du Directeur</div>
    <div class="sig-sub">École Privée Moussa Koné</div>
    <div class="sig-zone"></div>
  </div>
  <div class="sig-box">
    <div class="sig-lbl">Cachet de l'établissement</div>
    <div class="sig-sub">&nbsp;</div>
    <div class="sig-zone cachet"></div>
  </div>
</div>

<div class="dfooter">
  <div>Document généré le ${now} | Système EPMK</div>
  <div class="conf">CONFIDENTIEL</div>
  <div>École Privée Moussa Koné — Bamako, Mali</div>
</div>

</div><!-- /#fiche -->

<div class="no-print">
  <button class="btn-p" onclick="window.print()">🖨️ Imprimer</button>
  <button class="btn-c" onclick="window.close()">✖ Fermer</button>
</div>

<script>
  function fillDoc(elId,kw){const el=document.getElementById(elId);if(!el)return;const list=window.opener?.document.getElementById('detailDocuments');if(list){const items=list.querySelectorAll('li');for(const item of items){if(item.textContent.toLowerCase().includes(kw)&&item.innerHTML.includes('fa-check')){el.innerHTML='<span class="ok">✔ Fourni</span>';return;}}}el.innerHTML='<span class="nok">✗ Non fourni</span>';}
  fillDoc('pd_birth','extrait');fillDoc('pd_photos','photo');fillDoc('pd_bul','bulletin');fillDoc('pd_med','médical');
  // Garantit UNE seule page A4, quel que soit le contenu du dossier
  // (présence d'un tuteur, nombre de documents, longueur des noms…).
  // On mesure la hauteur réelle puis on réduit d'autant — jamais l'inverse.
  function tenirSurUnePage(){
    var doc = document.getElementById('fiche');
    if(!doc) return;
    doc.style.zoom = 1;
    var pxParMm = 96/25.4;
    // A4 = 297 mm de haut, moins les marges @page (7 mm en haut et en bas),
    // moins 2 mm de sécurité contre les arrondis d'arrondi du navigateur.
    var hUtile  = (297 - 7 - 7 - 2) * pxParMm;
    var hReelle = doc.scrollHeight;
    if(hReelle > hUtile){
      var e = Math.max(0.62, hUtile/hReelle);   // plancher : en deçà, illisible
      doc.style.zoom = e;
      console.log('Fiche ajustée à ' + Math.round(e*100) + '% pour tenir sur une page A4');
    }
  }
  window.onload=function(){ tenirSurUnePage(); setTimeout(function(){window.print();},800); };
<\/script>
</body>
</html>`;

        // On ouvre un document Blob avec 'noopener' : la fenêtre d'impression
        // obtient son propre processus. Sans cela, la boîte d'impression gelait
        // l'admin tant qu'elle restait ouverte (fil d'exécution partagé).
        try {
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url  = URL.createObjectURL(blob);
            const pw   = window.open(url, '_blank', 'noopener,width=900,height=700');
            if (!pw && !window.open) {
                showToast('Autorisez les popups pour imprimer', 'error');
            }
            // Libère la mémoire une fois la fenêtre chargée
            setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        } catch (e) {
            console.error('Impression:', e);
            showToast("Impression impossible : " + (e.message || ''), 'error');
        }
    }

    // Convertir photo en base64 pour l'impression
    if (photoSrc && photoSrc.startsWith('http')) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                canvas.getContext('2d').drawImage(img, 0, 0);
                buildPrintDoc(canvas.toDataURL('image/jpeg', 0.9));
            } catch(e) {
                buildPrintDoc(photoSrc);
            }
        };
        img.onerror = () => buildPrintDoc('');
        img.src = photoSrc;
    } else {
        buildPrintDoc(photoSrc || '');
    }
};
// Fonction helper pour le statut des documents dans l'impression
function getDocStatusIcon(type) {
    const docsList = document.getElementById('detailDocuments');
    if (!docsList) return '<i class="fas fa-times-circle cross-icon"></i> Non fourni';
    
    const items = docsList.querySelectorAll('li');
    for (let item of items) {
        if (item.textContent.toLowerCase().includes(type.replace('_', ' '))) {
            if (item.innerHTML.includes('fa-check')) {
                return '<i class="fas fa-check-circle check-icon"></i> Fourni';
            }
        }
    }
    return '<i class="fas fa-times-circle cross-icon"></i> Non fourni';
}

/**
 * Rejette une inscription
 */
window.rejectAdmission = async function(admissionId) {
    console.log('❌ Rejet admission:', admissionId);
    
    const reason = prompt('Motif du rejet (optionnel):');
    if (reason === null) return; // Annulé
    
    try {
        const { error } = await supabaseClient
            .from('admissions')
            .update({ 
                status: 'rejected',
                rejected_at: new Date().toISOString(),
                rejection_reason: reason || null
            })
            .eq('id', admissionId);
        
        if (error) throw error;
        
        showToast('Inscription rejetée', 'info');
        await loadAdmissions();
        
    } catch (error) {
        console.error('❌ Erreur rejet:', error);
        showToast('Erreur lors du rejet', 'error');
    }
};

/**
 * Génère une carte d'élève (placeholder)
 */
window.generateStudentCard = function(admissionId) {
    console.log('🎴 Génération carte:', admissionId);
    showToast('Génération de la carte en cours...', 'info');
    // TODO: Implémenter la génération de carte
};
/**
 * Navigation vers la page admissions depuis les élèves
 */
window.goToAdmissions = async function() {
    console.log('➡️ Navigation vers admissions...');
    await loadPage('admissions');
    // Attendre que la page soit chargée puis ouvrir le modal
    setTimeout(() => {
        openAdmissionModal();
    }, 300);
};
// ============================================
// FONCTIONS DE SAUVEGARDE
// ============================================



async function saveNewClasse(e) {
    e.preventDefault();
    
    // ⚠️ EMPÊCHER DOUBLE SOUMISSION
    if (isSubmittingClasse) {
        console.log('⚠️ Soumission déjà en cours...');
        return;
    }
    isSubmittingClasse = true;
    
    // Désactiver le bouton
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn?.innerHTML;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création...';
    }
    
    try {
        const niveau = document.getElementById('classeNiveau')?.value;
        const profSelect = document.getElementById('classeProfesseur');
        
        // Niveaux Jardin à 6ème
        const primaryLevels = ['jardin', '1ere', '2eme', '3eme', '4eme', '5eme', '6eme'];
        
        const formData = {
            nom: document.getElementById('classeNom')?.value,
            niveau: niveau,
            capacite: parseInt(document.getElementById('classeCapacite')?.value) || 40,
            salle: document.getElementById('classeSalle')?.value,
            frais_inscription: parseInt(document.getElementById('classeFraisInscription')?.value) || 0,
            frais_scolarite: parseInt(document.getElementById('classeFraisScolarite')?.value) || 0
        };
        
        // Ajouter le professeur principal seulement pour Jardin-6ème
        if (primaryLevels.includes(niveau) && profSelect?.value) {
            formData.professeur_principal_id = profSelect.value;
        } else {
            formData.professeur_principal_id = null; // 7e-9e : pas de prof principal
        }

        const editId = document.getElementById('classeEditId')?.value || null;
        let data, error;

        if (editId) {
            ({ data, error } = await supabaseClient.from('classes').update(formData).eq('id', editId).select());
            if (error) throw error;
            console.log('✅ Classe modifiée:', data);
            showToast('Classe modifiée avec succès', 'success');
        } else {
            ({ data, error } = await supabaseClient.from('classes').insert([formData]).select());
            if (error) throw error;
            console.log('✅ Classe créée:', data);
            showToast('Classe créée avec succès', 'success');
        }

        // Fermer le modal et réinitialiser
        closeModal('addClasseModal');
        document.getElementById('addClasseForm')?.reset();
        const ce = document.getElementById('classeEditId'); if (ce) ce.value = '';
        const ct = document.getElementById('addClasseModalTitle'); if (ct) ct.textContent = 'Nouvelle Classe';
        handleNiveauChange();
        
        // Recharger la liste
        await loadClasses(true);
        
    } catch (error) {
        console.error('❌ Erreur création classe:', error);
        showToast('Erreur: ' + error.message, 'error');
    } finally {
        // Réactiver le bouton
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Créer la classe';
        }
        isSubmittingClasse = false;
    }
}
window.loadProfesseursForClasseSelect = loadProfesseursForClasseSelect;


async function saveMatiereGlobale(e) {
    e.preventDefault();
    
    // ⚠️ EMPÊCHER DOUBLE SOUMISSION
    if (isSubmittingMatiere) return;
    isSubmittingMatiere = true;
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...';
    }
    
    try {
        const formData = {
            code: document.getElementById('matiereGlobalCode')?.value.toUpperCase(),
            name: document.getElementById('matiereGlobalNom')?.value,
            description: document.getElementById('matiereGlobalDesc')?.value
        };

        const editId = document.getElementById('matiereEditId')?.value || null;
        if (editId) {
            const { error } = await supabaseClient.from('subjects').update(formData).eq('id', editId);
            if (error) throw error;
            showToast('Matière modifiée avec succès', 'success');
        } else {
            const { error } = await supabaseClient.from('subjects').insert([formData]);
            if (error) throw error;
            showToast('Matière créée avec succès', 'success');
        }
        closeModal('addMatiereGlobalModal');

        // Réinitialiser le formulaire
        document.getElementById('addMatiereGlobalForm')?.reset();
        const me = document.getElementById('matiereEditId'); if (me) me.value = '';
        const mt = document.getElementById('addMatiereModalTitle'); if (mt) mt.textContent = 'Nouvelle Matière';

        // ⚠️ FORCER le rechargement immédiat
        await loadMatieresGlobales(true);
        
    } catch (error) {
        console.error('Erreur création matière:', error);
        showToast('Erreur: ' + error.message, 'error');
    } finally {
        isSubmittingMatiere = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-save"></i> Enregistrer';
        }
    }
}

async function saveTeacher_OLD(e) {
    e.preventDefault();
    
    // Récupérer les matières sélectionnées
    const select = document.getElementById('teacherSubjects');
    const selectedOptions = Array.from(select?.selectedOptions || []);
    const subjects = selectedOptions.map(o => o.value);
    
    const formData = {
        first_name: document.getElementById('teacherFirstName')?.value,
        last_name: document.getElementById('teacherLastName')?.value,
        email: document.getElementById('teacherEmail')?.value,
        subjects: subjects
    };
    
    try {
        console.log('💾 Création enseignant:', formData);
        const { error } = await supabaseClient.from('teachers').insert([formData]);
        if (error) throw error;
        
        showToast('Enseignant créé avec succès', 'success');
        closeModal('addTeacherModal');
        
        // IMPORTANT : Réinitialiser le cache avant de recharger
        dataCache.teachers = null;
        dataCache.lastUpdate.teachers = null;
        
        // Forcer le rechargement des données
        await loadEnseignants();
        
        // Mettre à jour les compteurs manuellement aussi
        const { count } = await supabaseClient
            .from('teachers')
            .select('*', { count: 'exact', head: true });
        updateCounter('totalEnseignants', count || 0);
        
    } catch (error) {
        console.error('❌ Erreur création enseignant:', error);
        showToast('Erreur: ' + error.message, 'error');
    }
}
// Dans la section EXPOSITION GLOBALE, ajoutez :
window.loadMatieresForTeacherSelect = loadMatieresForTeacherSelect;





// ============================================
// FONCTIONS UTILITAIRES
// ============================================




// Gestion du niveau pour les classes
/**
 * Gère le changement de niveau et adapte l'interface
 * Jardin-6ème : Un seul prof principal obligatoire
 * 7ème-9ème : Plusieurs profs possibles (optionnel)
 */
window.handleNiveauChange = function() {
    const niveau = document.getElementById('classeNiveau')?.value;
    const profGroup = document.getElementById('professeurGroup');
    const profLabel = document.getElementById('professeurLabel');
    const profSelect = document.getElementById('classeProfesseur');
    const profOptionnel = document.getElementById('profOptionnel');
    const niveauHelp = document.getElementById('niveauHelp');
    const defBadge = document.getElementById('defBadge');
    
    // Niveaux avec un seul professeur principal (Jardin à 6ème)
    const singleTeacherLevels = ['jardin', '1ere', '2eme', '3eme', '4eme', '5eme', '6eme'];
    
    // Niveaux avec plusieurs professeurs (7ème à 9ème)
    const multiTeacherLevels = ['7eme', '8eme', '9eme'];
    
    // Cacher le badge DEF par défaut
    if (defBadge) defBadge.style.display = 'none';
    
    if (singleTeacherLevels.includes(niveau)) {
        // Jardin à 6ème : Un seul professeur principal obligatoire
        profLabel.textContent = 'Professeur Principal *';
        profSelect.required = true;
        profSelect.multiple = false;
        profOptionnel.style.display = 'none';
        niveauHelp.style.display = 'none';
        profGroup.style.display = 'block';
        
    } else if (multiTeacherLevels.includes(niveau)) {
        // 7ème à 9ème : Plusieurs professeurs possibles (par matière)
        profLabel.textContent = 'Professeurs (par matière)';
        profSelect.required = false;
        profSelect.multiple = true; // Permettre sélection multiple
        profOptionnel.style.display = 'block';
        profOptionnel.innerHTML = '<i class="fas fa-info-circle"></i> Sélectionnez plusieurs professeurs selon les matières';
        niveauHelp.style.display = 'block';
        
        // Info spéciale pour 9ème (DEF)
        if (niveau === '9eme') {
            niveauHelp.innerHTML = '<i class="fas fa-graduation-cap"></i> <strong>Diplôme d\'Études Fondamentales (DEF)</strong> - Classes d\'examen';
            if (defBadge) defBadge.style.display = 'inline-block';
        } else {
            niveauHelp.innerHTML = '<i class="fas fa-info-circle"></i> Classes d\'examen : plusieurs professeurs seront assignés selon les matières';
        }
        
        profGroup.style.display = 'block';
        
        // Recharger les professeurs avec leurs matières
        loadProfesseursForClasseSelectWithMatieres();
    }
};
/**
 * Charge les professeurs avec indication de leurs matières
 */
async function loadProfesseursForClasseSelectWithMatieres() {
    console.log('👨‍🏫 Chargement des professeurs avec matières...');
    
    try {
        const { data: teachers, error } = await supabaseClient
            .from('teachers')
            .select('id, first_name, last_name, subjects')
            .order('last_name');
        
        if (error) throw error;
        
        const select = document.getElementById('classeProfesseur');
        if (!select) return;
        
        select.innerHTML = '<option value="">Choisir les professeurs...</option>';
        
        teachers?.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            const matieres = t.subjects?.join(', ') || 'Non spécifié';
            option.textContent = `${t.last_name} ${t.first_name} (${matieres})`;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('❌ Erreur:', error);
    }
}
// Charger les professeurs pour le select
window.loadProfesseursForSelect = async function() {
    const { data: teachers } = await supabaseClient
        .from('teachers')
        .select('id, first_name, last_name')
        .order('last_name');
    
    const selects = [
        document.getElementById('classeProfesseur'),
        document.getElementById('coursProfesseur'),
        document.getElementById('selectProfMatiere')
    ];
    
    selects.forEach(select => {
        if (!select) return;
        const currentValue = select.value;
        const baseOption = select.options[0];
        select.innerHTML = '';
        if (baseOption) select.appendChild(baseOption);
        
        teachers?.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = `${t.last_name} ${t.first_name}`;
            select.appendChild(option);
        });
        
        select.value = currentValue;
    });
};

// ============================================
// EXPOSITION GLOBALE
// ============================================

// Fonctions qui doivent être accessibles depuis HTML
window.loadPage = loadPage;
window.openModal = openModal;
window.closeModal = closeModal;
window.showToast = showToast;
window.updateCounter = updateCounter;

// Fonctions spécifiques
window.saveNewClasse = saveNewClasse;
window.saveMatiereGlobale = saveMatiereGlobale;
// (saveTeacher géré par le module enseignants)
window.creerCompteParent = creerCompteParent;
window.saveAdmission = saveAdmission;
window.handleNiveauChange = handleNiveauChange;
window.loadProfesseursForSelect = loadProfesseursForSelect;



window._gererMatieres_OLD = function(classeId, classeNom) {
    document.getElementById('matiereClasseNom').textContent = classeNom;
    openModal('classeMatieresModal');
    // Charger matières existantes
};



// Styles pour animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

console.log('📦 Admin.js V2 chargé - Système anti-rechargement actif');

// ============================================
// EXPOSITION GLOBALE - TOUTES LES FONCTIONS
// ============================================

window.loadPage = loadPage;
window.openModal = openModal;
window.closeModal = closeModal;
window.showToast = showToast;
window.updateCounter = updateCounter;

// Fonctions Classes
window.saveNewClasse = saveNewClasse;
window.handleNiveauChange = handleNiveauChange;
window.loadProfesseursForSelect = loadProfesseursForSelect;
window.editClasse = async function(id) {
    try {
        const { data: c, error } = await supabaseClient.from('classes').select('*').eq('id', id).single();
        if (error || !c) throw error || new Error('Classe introuvable');

        const setVal = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = (v ?? ''); };
        setVal('classeEditId', c.id);
        setVal('classeNom', c.nom);
        setVal('classeNiveau', c.niveau);
        setVal('classeCapacite', c.capacite || 40);
        setVal('classeSalle', c.salle);
        setVal('classeFraisInscription', c.frais_inscription || 0);
        setVal('classeFraisScolarite', c.frais_scolarite || 0);

        if (typeof handleNiveauChange === 'function') handleNiveauChange();
        if (typeof loadProfesseursForClasseSelect === 'function') {
            await loadProfesseursForClasseSelect();
            const profSel = document.getElementById('classeProfesseur');
            if (profSel && c.professeur_principal_id) profSel.value = c.professeur_principal_id;
        }

        const title = document.getElementById('addClasseModalTitle');
        if (title) title.textContent = 'Modifier la Classe';
        openModal('addClasseModal');
    } catch (e) {
        console.error('❌ editClasse:', e);
        showToast('Erreur lors du chargement de la classe', 'error');
    }
};
// (gererMatieres géré par le module enseignants)
window.deleteClasse = async function(id) {
    try {
        const { count } = await supabaseClient.from('students')
            .select('id', { count: 'exact', head: true }).eq('class_id', id);
        if (count && count > 0) {
            showToast(`Impossible : ${count} élève(s) sont inscrits dans cette classe. Réaffectez-les d'abord.`, 'error');
            return;
        }
        if (!confirm('Supprimer cette classe ? Cette action est irréversible.')) return;
        await supabaseClient.from('class_subjects').delete().eq('class_id', id);
        const { error } = await supabaseClient.from('classes').delete().eq('id', id);
        if (error) throw error;
        await loadClasses(true);
        showToast('Classe supprimée', 'success');
    } catch (e) {
        console.error('❌ deleteClasse:', e);
        showToast('Erreur : ' + (e.message || 'réessayez'), 'error');
    }
};

// Fonctions Matières
window.saveMatiereGlobale = saveMatiereGlobale;
window.loadMatieresForTeacherSelect = loadMatieresForTeacherSelect;
window.editMatiere = async function(id) {
    try {
        const { data: m, error } = await supabaseClient.from('subjects').select('*').eq('id', id).single();
        if (error || !m) throw error || new Error('Matière introuvable');
        const setVal = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = (v ?? ''); };
        setVal('matiereEditId', m.id);
        setVal('matiereGlobalNom', m.name);
        setVal('matiereGlobalCode', m.code);
        setVal('matiereGlobalDesc', m.description);
        const title = document.getElementById('addMatiereModalTitle');
        if (title) title.textContent = 'Modifier la Matière';
        openModal('addMatiereGlobalModal');
    } catch (e) {
        console.error('❌ editMatiere:', e);
        showToast('Erreur lors du chargement de la matière', 'error');
    }
};
window.deleteMatiere = async function(id) {
    try {
        // Vérifier si la matière est utilisée dans des classes
        const { count } = await supabaseClient.from('class_subjects')
            .select('id', { count: 'exact', head: true }).eq('subject_id', id);
        if (count && count > 0) {
            if (!confirm(`Cette matière est utilisée dans ${count} classe(s). La supprimer retirera aussi ces affectations (et risque d'affecter les notes). Continuer ?`)) return;
            await supabaseClient.from('class_subjects').delete().eq('subject_id', id);
        } else {
            if (!confirm('Supprimer cette matière ?')) return;
        }
        const { error } = await supabaseClient.from('subjects').delete().eq('id', id);
        if (error) throw error;
        await loadMatieresGlobales(true);
        showToast('Matière supprimée', 'success');
    } catch (e) {
        console.error('❌ deleteMatiere:', e);
        showToast('Erreur : ' + (e.message || 'réessayez'), 'error');
    }
};

// Fonctions Enseignants
// (saveTeacher géré par le module enseignants)
// (deleteTeacher géré par le module enseignants)
window._editTeacher_OLD2 = function(id) { console.log('Édition enseignant:', id); };

// Fonctions Parents
window.openCreateParentModal = openCreateParentModal;
window.chargerElevesPourClasse = chargerElevesPourClasse;
window.creerCompteParent = creerCompteParent;
window.editParent = editParent;
window.deleteParent = deleteParent;

// Fonctions Élèves
// (editEleve géré par la version complète plus haut)
window.deleteEleve = async function(id) {
    if (!confirm('Supprimer cet élève ?')) return;
    await supabaseClient.from('students').delete().eq('id', id);
    await loadEleves(true);
    showToast('Élève supprimé', 'success');
};

// Fonctions Admissions/INSCRIPTIONS - ⚠️ IMPORTANT
window.openAdmissionModal = openAdmissionModal;
window.refreshAdmissions = refreshAdmissions;
window.filterAdmissions = filterAdmissions;
window.viewAdmission = viewAdmission;
window.acceptAdmission = acceptAdmission;
window.rejectAdmission = rejectAdmission;
window.generateStudentCard = generateStudentCard;
window.goToAdmissions = goToAdmissions;
window.updateAdmissionFees = updateAdmissionFees;

// Wizard

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGERIE SMS — Broadcast aux parents
// ══════════════════════════════════════════════════════════════════════════════

const SUPABASE_FUNCTIONS_URL_MSG = 'https://phbfwmwqiisqidscpzeh.supabase.co/functions/v1';
const ANON_KEY_MSG = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoYmZ3bXdxaWlzcWlkc2NwemVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTE0MTcsImV4cCI6MjA4Nzk4NzQxN30.UPGusoIjj5e_crNG_Dv_i9Sd2rbjLA_Hg0trfzBWq0Y';

// Templates SMS prédéfinis
const SMS_TEMPLATES = {
    examen: `Bonjour {prenom},\nLes examens du [TRIMESTRE] auront lieu du [DATE_DEBUT] au [DATE_FIN].\nMerci de veiller a la ponctualite.\nEPMK`,
    bulletins: `Bonjour {prenom},\nLes bulletins du [TRIMESTRE] sont disponibles sur le portail parents :\nepmk.netlify.app\nEPMK`,
    paiement: `Bonjour {prenom},\nNous vous rappelons que les frais de scolarite du [TRIMESTRE] sont dus avant le [DATE_LIMITE].\nMerci de regulariser votre situation.\nEPMK`,
    conge: `Bonjour {prenom},\nL'ecole sera en conge du [DATE_DEBUT] au [DATE_FIN].\nLa reprise des cours est prevue le [DATE_REPRISE].\nBonnes vacances !\nEPMK`,
};

/**
 * Initialise la page messagerie SMS
 */
async function initMessageriePage() {
    console.log('📱 Init page messagerie...');
    await Promise.all([
        chargerClassesBroadcast(),
        chargerStatsBroadcast(),
        chargerHistoriqueBroadcast(),
    ]);

    const form = document.getElementById('broadcastSmsForm');
    if (form) {
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        newForm.addEventListener('submit', envoyerBroadcastSms);
    }

    const msgTextarea = document.getElementById('broadcastMessage');
    if (msgTextarea) {
        msgTextarea.addEventListener('input', updateSmsPreview);
        msgTextarea.addEventListener('input', updateCharCount);
    }
}

/**
 * Charge les classes dans le select broadcast
 */
async function chargerClassesBroadcast() {
    const select = document.getElementById('broadcastClasse');
    if (!select) return;

    const { data: classes } = await supabaseClient
        .from('classes')
        .select('id, nom, niveau')
        .order('niveau');

    if (!classes?.length) {
        select.innerHTML = '<option value="">Aucune classe trouvée</option>';
        return;
    }

    select.innerHTML = '<option value="">-- Choisir une classe --</option>' +
        classes.map(c => `<option value="${c.id}">${c.nom} (${c.niveau})</option>`).join('');

    select.addEventListener('change', async () => {
        const classId = select.value;
        if (!classId) {
            const el = document.getElementById('classeParentsCount');
            if (el) el.textContent = '';
            return;
        }
        // Compter les parents avec numéro dans cette classe
        try {
            const { data: students } = await supabaseClient
                .from('students')
                .select('id')
                .eq('class_id', classId);

            const studentIds = (students || []).map(s => s.id);
            if (!studentIds.length) {
                document.getElementById('classeParentsCount').textContent = '⚠️ Aucun élève dans cette classe';
                return;
            }

            const { data: links } = await supabaseClient
                .from('parent_students')
                .select('parent_id, parents!inner(id, phone, status)')
                .in('student_id', studentIds);

            const withPhone = (links || []).filter(r => r.parents?.phone && r.parents?.status === 'actif');
            const unique = new Set(withPhone.map(r => r.parents.id)).size;
            document.getElementById('classeParentsCount').textContent =
                `→ ${unique} parent(s) avec numéro dans cette classe`;
        } catch(e) {
            console.warn('Comptage parents:', e);
        }
    });
}

/**
 * Charge les statistiques SMS
 */
async function chargerStatsBroadcast() {
    try {
        const [parentsRes, broadcastsRes] = await Promise.all([
            supabaseClient.from('parents').select('id, phone, sms_status').not('phone', 'is', null),
            supabaseClient.from('sms_broadcasts').select('sent').order('sent_at', { ascending: false }).limit(50),
        ]);

        const parents    = parentsRes.data || [];
        const broadcasts = broadcastsRes.data || [];
        const totalSent  = broadcasts.reduce((sum, b) => sum + (b.sent || 0), 0);
        const confirmed  = parents.filter(p => p.sms_status === 'confirmed').length;

        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el('smsTotalEnvoyes',      totalSent);
        el('smsParentsConfirmes',  confirmed);
        el('smsBroadcastsTotal',   broadcasts.length);
        el('smsParentsTotal',      parents.length);
    } catch (e) {
        console.warn('Stats broadcast:', e);
    }
}

/**
 * Charge l'historique des broadcasts
 */
async function chargerHistoriqueBroadcast() {
    const container = document.getElementById('broadcastHistory');
    if (!container) return;

    const { data: history } = await supabaseClient
        .from('sms_broadcasts')
        .select('*, classes(nom)')
        .order('sent_at', { ascending: false })
        .limit(10);

    if (!history?.length) {
        container.innerHTML = `
            <div style="text-align:center;padding:30px;color:#9ca3af">
                <i class="fas fa-inbox" style="font-size:2rem;margin-bottom:8px;display:block"></i>
                Aucun envoi encore
            </div>`;
        return;
    }

    container.innerHTML = history.map(h => {
        const date   = new Date(h.sent_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
        const classe = h.classes?.nom || (h.destinataires === 'all' ? 'Tous les parents' : '-');
        const taux   = h.total > 0 ? Math.round((h.sent / h.total) * 100) : 0;
        const couleur = taux >= 90 ? '#059669' : taux >= 60 ? '#f59e0b' : '#ef4444';
        return `
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div>
                    <span style="font-weight:600;color:#374151;font-size:.9rem">
                        <i class="fas fa-school" style="color:#5D4037"></i> ${classe}
                    </span>
                    <div style="font-size:.78rem;color:#9ca3af;margin-top:2px">${date}</div>
                </div>
                <span style="background:${couleur}20;color:${couleur};padding:4px 10px;border-radius:20px;font-size:.8rem;font-weight:600">
                    ${h.sent}/${h.total} envoyés
                </span>
            </div>
            <div style="background:#f9fafb;border-radius:6px;padding:8px;font-size:.82rem;color:#6b7280;font-style:italic">
                "${h.message?.substring(0, 120)}${h.message?.length > 120 ? '…' : ''}"
            </div>
            ${h.failed > 0 ? `<div style="margin-top:6px;font-size:.78rem;color:#ef4444">⚠️ ${h.failed} échec(s)</div>` : ''}
        </div>`;
    }).join('');
}

/**
 * Envoie le broadcast SMS
 */
async function envoyerBroadcastSms(e) {
    e.preventDefault();

    const btn          = document.getElementById('broadcastSendBtn');
    const message      = document.getElementById('broadcastMessage')?.value?.trim();
    const destinataires = document.getElementById('broadcastDestinataires')?.value;
    const classId      = document.getElementById('broadcastClasse')?.value;

    if (!message) { showToast('Veuillez écrire un message', 'error'); return; }
    if (destinataires === 'classe' && !classId) { showToast('Veuillez sélectionner une classe', 'error'); return; }

    const nbDest = document.getElementById('classeParentsCount')?.textContent || '';
    const confirmation = destinataires === 'all'
        ? 'Envoyer ce SMS à TOUS les parents actifs ?'
        : `Envoyer ce SMS aux parents de cette classe ?\n${nbDest}`;
    if (!confirm(confirmation)) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi en cours…';

    try {
        const payload = {
            action: 'broadcast',
            message,
            destinataires,
            ...(destinataires === 'classe' && { class_id: classId }),
        };

        const resp = await fetch(`${SUPABASE_FUNCTIONS_URL_MSG}/send-sms-parent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ANON_KEY_MSG}`,
                'apikey': ANON_KEY_MSG,
            },
            body: JSON.stringify(payload),
        });

        const result = await resp.json();

        if (result.success) {
            showToast(
                `✅ ${result.sent} SMS envoyé(s) sur ${result.total} destinataire(s)` +
                (result.failed > 0 ? ` — ⚠️ ${result.failed} échec(s)` : ''),
                result.failed > 0 ? 'warning' : 'success',
                8000
            );
            document.getElementById('broadcastMessage').value = '';
            updateSmsPreview();
            await chargerHistoriqueBroadcast();
            await chargerStatsBroadcast();
        } else {
            showToast('Erreur : ' + (result.error || 'Erreur inconnue'), 'error');
        }
    } catch (err) {
        showToast('Erreur réseau : ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer le SMS';
    }
}

window.toggleClasseSelect = function() {
    const val = document.getElementById('broadcastDestinataires')?.value;
    const wrapper = document.getElementById('classeSelectWrapper');
    if (wrapper) wrapper.style.display = val === 'all' ? 'none' : 'block';
    updateSmsPreview();
};

window.useTemplate = function(type) {
    const textarea = document.getElementById('broadcastMessage');
    if (!textarea || !SMS_TEMPLATES[type]) return;
    textarea.value = SMS_TEMPLATES[type];
    updateCharCount();
    updateSmsPreview();
};

window.updateCharCount = function() {
    const msg = document.getElementById('broadcastMessage')?.value || '';
    const el  = document.getElementById('charCount');
    if (!el) return;
    const len   = msg.length;
    const color = len > 160 ? '#ef4444' : len > 130 ? '#f59e0b' : '#6b7280';
    el.style.color = color;
    el.textContent = `${len} / 160 caractères${len > 160 ? ' (2 SMS)' : ''}`;
    updateSmsPreview();
};

function updateSmsPreview() {
    const msg     = document.getElementById('broadcastMessage')?.value || '';
    const preview = document.getElementById('smsPreview');
    if (!preview) return;
    const displayed = msg
        ? `EPMK - ${msg.replace(/{prenom}/g, 'Modibo')}`.substring(0, 300)
        : 'EPMK - Votre message apparaîtra ici...';
    preview.textContent = displayed;
}

window.initMessageriePage = initMessageriePage;
window.chargerStatsBroadcast = chargerStatsBroadcast;

window.changeStep = changeStep;

console.log('📦 Admin.js V2 chargé - Toutes les fonctions exposées');

// ============================================
// SECTION GESTION DES MATIÈRES DE CLASSE
// ============================================

let currentClasseId = null;
let currentClasseNom = null;

/**
 * Ouvre le modal de gestion des matières pour une classe
 */
window.gererMatieres = async function(classeId, classeNom) {
    console.log('📚 Gestion des matières pour:', classeId, classeNom);
    
    currentClasseId = classeId;
    currentClasseNom = classeNom;
    
    // Mettre à jour le titre
    const titreEl = document.getElementById('matiereClasseNom');
    if (titreEl) titreEl.textContent = classeNom;
    
    // Ouvrir le modal
    openModal('classeMatieresModal');
    
    // Réinitialiser le formulaire de nouvelle matière
    const newMatiereForm = document.getElementById('newMatiereForm');
    const toggleIcon = document.getElementById('newMatiereToggleIcon');
    if (newMatiereForm) newMatiereForm.style.display = 'none';
    if (toggleIcon) toggleIcon.className = 'fas fa-chevron-down';
    
    // Charger les données
    await Promise.all([
        loadMatieresForSelect(),
        loadProfesseursForMatiereSelect(),
        loadClasseMatieres(classeId)
    ]);
};

/**
 * Bascule l'affichage du formulaire de création de nouvelle matière
 */
window.toggleNewMatiereForm = function() {
    const form = document.getElementById('newMatiereForm');
    const icon = document.getElementById('newMatiereToggleIcon');
    
    if (!form || !icon) return;
    
    if (form.style.display === 'none') {
        form.style.display = 'block';
        icon.className = 'fas fa-chevron-up';
    } else {
        form.style.display = 'none';
        icon.className = 'fas fa-chevron-down';
    }
};

/**
 * Charge toutes les matières disponibles dans le select
 */
async function loadMatieresForSelect() {
    console.log('📚 Chargement des matières disponibles...');
    
    try {
        const { data: matieres, error } = await supabaseClient
            .from('subjects')
            .select('id, name, code')
            .order('name');
        
        if (error) throw error;
        
        const select = document.getElementById('selectMatiere');
        if (!select) return;
        
        // Garder l'option par défaut
        select.innerHTML = '<option value="">Choisir une matière existante...</option>';
        
        if (!matieres || matieres.length === 0) {
            console.warn('⚠️ Aucune matière disponible');
            return;
        }
        
        console.log(`✅ ${matieres.length} matière(s) chargée(s)`);
        
        matieres.forEach(m => {
            const option = document.createElement('option');
            option.value = m.id;
            option.textContent = `${m.name} (${m.code})`;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('❌ Erreur chargement matières:', error);
        showToast('Erreur chargement des matières', 'error');
    }
}

/**
 * Charge les professeurs dans le select du modal matières
 */
async function loadProfesseursForMatiereSelect() {
    console.log('👨‍🏫 Chargement des professeurs...');
    
    try {
        const { data: teachers, error } = await supabaseClient
            .from('teachers')
            .select('id, first_name, last_name')
            .order('last_name');
        
        if (error) throw error;
        
        const select = document.getElementById('selectProfMatiere');
        if (!select) return;
        
        select.innerHTML = '<option value="">Choisir un professeur...</option>';
        
        teachers?.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = `${t.last_name} ${t.first_name}`;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('❌ Erreur chargement professeurs:', error);
    }
}

/**
 * Charge les matières déjà assignées à la classe
 */
async function loadClasseMatieres(classeId) {
    console.log('📋 Chargement des matières de la classe:', classeId);
    
    try {
        const { data: classSubjects, error } = await supabaseClient
            .from('class_subjects')
            .select(`
                id,
                coefficient,
                hours_per_week,
                subjects(id, name, code),
                teachers(id, first_name, last_name)
            `)
            .eq('class_id', classeId)
            .order('created_at');
        
        if (error) throw error;
        
        const tbody = document.getElementById('classeMatieresTable');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (!classSubjects || classSubjects.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 40px; color: #666;">
                        <i class="fas fa-book" style="font-size: 2rem; margin-bottom: 10px; color: #ddd;"></i>
                        <p>Aucune matière assignée à cette classe</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = classSubjects.map(cs => `
            <tr>
                <td style="font-weight: 500;">${cs.subjects?.name || 'Matière inconnue'}</td>
                <td><span class="badge badge-secondary">${cs.subjects?.code || '-'}</span></td>
                <td style="text-align: center;">
                    <input type="number" min="1" max="20" value="${cs.coefficient || 1}"
                        onchange="updateMatiereCoef('${cs.id}', this)"
                        title="Coefficient de la matière dans les bulletins"
                        style="width: 64px; text-align: center; font-weight: 600; padding: 6px; border: 1.5px solid #e7e3d6; border-radius: 8px; background: #fbfaf4;">
                </td>
                <td style="text-align: center;">${cs.hours_per_week || 2}h</td>
                <td>${cs.teachers ? `${cs.teachers.last_name} ${cs.teachers.first_name}` : '-'}</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="removeMatiereFromClasse('${cs.id}')" title="Retirer">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('❌ Erreur chargement matières classe:', error);
        showToast('Erreur chargement des matières', 'error');
    }
}

/**
 * Met à jour le coefficient d'une matière assignée (édition inline)
 */
window.updateMatiereCoef = async function(id, input) {
    const coef = parseInt(input.value);
    if (!coef || coef < 1 || coef > 20) {
        showToast('Coefficient invalide : entre 1 et 20', 'error');
        input.value = input.defaultValue;
        return;
    }
    try {
        const { error } = await supabaseClient
            .from('class_subjects')
            .update({ coefficient: coef })
            .eq('id', id);
        if (error) throw error;
        input.defaultValue = coef;
        dataCache.lastUpdate.classes = null;
        showToast('Coefficient mis à jour — les prochains bulletins en tiendront compte', 'success');
    } catch (e) {
        console.error('❌ updateMatiereCoef:', e);
        showToast('Erreur lors de la mise à jour du coefficient', 'error');
        input.value = input.defaultValue;
    }
};

/**
 * Crée une nouvelle matière globale (restaurée)
 */
window.createNewMatiere = async function() {
    const nomInput = document.getElementById('newMatiereNom');
    const codeInput = document.getElementById('newMatiereCode');
    const nom = nomInput?.value?.trim();
    let code = codeInput?.value?.trim()?.toUpperCase() || '';

    if (!nom) {
        showToast('Saisissez le nom de la matière', 'error');
        return;
    }
    if (!code) code = nom.replace(/\s+/g, '').substring(0, 6).toUpperCase();

    try {
        // Éviter les doublons de nom
        const { data: dup } = await supabaseClient
            .from('subjects').select('id').ilike('name', nom).maybeSingle();
        if (dup) {
            showToast('Une matière portant ce nom existe déjà', 'error');
            return;
        }

        const { data: created, error } = await supabaseClient
            .from('subjects')
            .insert([{ name: nom, code: code }])
            .select('id')
            .single();
        if (error) throw error;

        showToast('Matière « ' + nom + ' » créée avec succès', 'success');
        if (nomInput) nomInput.value = '';
        if (codeInput) codeInput.value = '';

        // Recharger la liste et pré-sélectionner la nouvelle matière
        await loadMatieresForSelect();
        const sel = document.getElementById('selectMatiere');
        if (sel && created?.id) sel.value = created.id;
    } catch (e) {
        console.error('❌ createNewMatiere:', e);
        showToast('Erreur : ' + (e.message || 'création impossible'), 'error');
    }
};

/**
 * Ajoute une matière existante à la classe
 */
window.addMatiereToClasse = async function() {
    console.log('➕ Ajout matière à la classe...');
    
    if (!currentClasseId) {
        showToast('Erreur: ID de classe manquant', 'error');
        return;
    }
    
    const matiereSelect = document.getElementById('selectMatiere');
    const coefInput = document.getElementById('matiereCoef');
    const hoursInput = document.getElementById('matiereHours');
    const profSelect = document.getElementById('selectProfMatiere');
    
    const subjectId = matiereSelect?.value;
    const coefficient = parseInt(coefInput?.value) || 1;
    const hoursPerWeek = parseInt(hoursInput?.value) || 2;
    const teacherId = profSelect?.value || null;
    
    if (!subjectId) {
        showToast('Veuillez sélectionner une matière', 'error');
        return;
    }
    
    try {
        // Vérifier si la matière n'est pas déjà assignée
        const { data: existing } = await supabaseClient
            .from('class_subjects')
            .select('id')
            .eq('class_id', currentClasseId)
            .eq('subject_id', subjectId)
            .single();
        
        if (existing) {
            showToast('Cette matière est déjà assignée à cette classe', 'error');
            return;
        }
        
        const { error } = await supabaseClient
            .from('class_subjects')
            .insert([{
                class_id: currentClasseId,
                subject_id: subjectId,
                coefficient: coefficient,
                hours_per_week: hoursPerWeek,
                teacher_id: teacherId
            }]);
        
        if (error) throw error;
        
        showToast('Matière ajoutée avec succès', 'success');
        
        // Réinitialiser les champs
        if (matiereSelect) matiereSelect.value = '';
        if (coefInput) coefInput.value = '1';
        if (hoursInput) hoursInput.value = '2';
        if (profSelect) profSelect.value = '';
        
        // Recharger la liste
        await loadClasseMatieres(currentClasseId);
        
        // Mettre à jour le cache
        dataCache.lastUpdate.classes = null;
        
    } catch (error) {
        console.error('❌ Erreur ajout matière:', error);
        showToast('Erreur: ' + error.message, 'error');
    }
};

/**
 * Retire une matière d'une classe
 */
window.removeMatiereFromClasse = async function(classSubjectId) {
    console.log('🗑️ Suppression matière de classe:', classSubjectId);
    
    if (!confirm('Êtes-vous sûr de vouloir retirer cette matière de la classe ?')) {
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('class_subjects')
            .delete()
            .eq('id', classSubjectId);
        
        if (error) throw error;
        
        showToast('Matière retirée avec succès', 'success');
        
        // Recharger la liste
        if (currentClasseId) {
            await loadClasseMatieres(currentClasseId);
        }
        
        // Mettre à jour le cache
        dataCache.lastUpdate.classes = null;
        
    } catch (error) {
        console.error('❌ Erreur suppression:', error);
        showToast('Erreur lors de la suppression', 'error');
    }
};

// ============================================
// EXPOSITION GLOBALE
// ============================================

// (gererMatieres géré par le module enseignants)
// NB : toggleNewMatiereForm, createNewMatiere, addMatiereToClasse et
// removeMatiereFromClasse sont déjà exposées via window.* à leur définition.
// Les ré-exports par identifiants nus provoquaient une ReferenceError fatale.



// ============================================================
// ANNONCES AUX PARENTS (école → parents, sens unique)
// ============================================================
const ANNONCE_CATEGORIES = {
    general:   { label: 'Général',     color: '#3b82f6', bg: '#dbeafe', icon: 'fa-info-circle' },
    reunion:   { label: 'Réunion',     color: '#7c3aed', bg: '#ede9fe', icon: 'fa-users' },
    evenement: { label: 'Événement',   color: '#059669', bg: '#d1fae5', icon: 'fa-calendar-star' },
    paiement:  { label: 'Paiement',    color: '#b45309', bg: '#fef3c7', icon: 'fa-money-bill' },
    urgent:    { label: 'Urgent',      color: '#dc2626', bg: '#fee2e2', icon: 'fa-exclamation-triangle' }
};

async function loadAnnonces() {
    const container = document.getElementById('annoncesContainer');
    if (!container) return;

    // Charger les classes pour le ciblage
    let classes = [];
    try {
        const { data } = await supabaseClient.from('classes').select('id, nom').order('nom');
        classes = data || [];
    } catch (_) {}

    const catOptions = Object.entries(ANNONCE_CATEGORIES)
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    const classOptions = classes.map(c => `<option value="${c.id}">${c.nom}</option>`).join('');

    container.innerHTML = `
        <style>
            #annoncesContainer { max-width:100%; box-sizing:border-box; overflow-x:hidden; }
            #annoncesContainer * { box-sizing:border-box; }
            #annoncesContainer .ann-grid {
                display:grid; grid-template-columns: 1fr 1.3fr; gap:24px; align-items:start;
                width:100%; max-width:100%;
            }
            #annoncesContainer .ann-field {
                width:100%; max-width:100%; padding:10px 12px; border:1.5px solid #d1d5db; border-radius:8px;
                margin:4px 0 12px; background:#ffffff !important; color:#1f2937 !important;
                font-size:.9rem; box-sizing:border-box; font-family:inherit;
            }
            #annoncesContainer .ann-field:focus { outline:none; border-color:#5D4037; box-shadow:0 0 0 3px rgba(93,64,55,.12); }
            #annoncesContainer .ann-label { font-size:.85rem; font-weight:600; color:#374151; display:block; }
            #annoncesContainer textarea.ann-field { resize:vertical; min-height:110px; }
            @media (max-width: 1024px) { #annoncesContainer .ann-grid { grid-template-columns: 1fr; } }
        </style>
        <div class="ann-grid">
            <!-- Formulaire -->
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:22px;box-shadow:0 2px 8px rgba(0,0,0,.06);min-width:0;">
                <h3 style="margin:0 0 18px;color:#1f2937;"><i class="fas fa-plus-circle" style="color:#5D4037;"></i> Nouvelle annonce</h3>

                <label class="ann-label">Titre *</label>
                <input id="annTitre" type="text" class="ann-field" placeholder="Ex : Réunion de parents">

                <label class="ann-label">Catégorie</label>
                <select id="annCategorie" class="ann-field">${catOptions}</select>

                <label class="ann-label">Destinataires</label>
                <select id="annCible" onchange="onAnnonceCibleChange()" class="ann-field">
                    <option value="tous">Tous les parents</option>
                    <option value="classe">Une classe précise</option>
                    <option value="eleve">Un élève précis</option>
                </select>

                <div id="annClasseWrap" style="display:none;">
                    <label class="ann-label">Classe</label>
                    <select id="annClasse" class="ann-field">${classOptions}</select>
                </div>

                <div id="annEleveWrap" style="display:none;">
                    <label class="ann-label">Élève (tapez le nom)</label>
                    <input id="annEleveSearch" type="text" class="ann-field" placeholder="Rechercher un élève..." oninput="searchAnnonceEleve(this.value)" style="margin-bottom:0;">
                    <div id="annEleveResults" style="max-height:140px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:8px;margin:4px 0;"></div>
                    <input id="annEleveId" type="hidden">
                    <div id="annEleveSelected" style="font-size:.85rem;color:#059669;margin:0 0 12px;font-weight:600;"></div>
                </div>

                <label class="ann-label">Contenu *</label>
                <textarea id="annContenu" rows="5" class="ann-field" placeholder="Rédigez votre annonce..."></textarea>

                <button onclick="publierAnnonce()" class="btn btn-primary" style="width:100%;padding:12px;background:#5D4037;border:none;border-radius:8px;color:#fff;font-weight:600;cursor:pointer;">
                    <i class="fas fa-paper-plane"></i> Publier l'annonce
                </button>
            </div>

            <!-- Liste -->
            <div style="min-width:0;">
                <h3 style="margin:0 0 18px;color:#1f2937;"><i class="fas fa-list" style="color:#5D4037;"></i> Annonces publiées</h3>
                <div id="annoncesListe"><div style="text-align:center;padding:30px;color:#999;"><i class="fas fa-spinner fa-spin"></i></div></div>
            </div>
        </div>
    `;

    renderAnnoncesListe();
}

window.onAnnonceCibleChange = function() {
    const cible = document.getElementById('annCible')?.value;
    document.getElementById('annClasseWrap').style.display = cible === 'classe' ? 'block' : 'none';
    document.getElementById('annEleveWrap').style.display  = cible === 'eleve'  ? 'block' : 'none';
};

window.searchAnnonceEleve = async function(q) {
    const box = document.getElementById('annEleveResults');
    if (!box || (q || '').trim().length < 2) { if (box) box.innerHTML = ''; return; }
    try {
        const { data } = await supabaseClient.from('students')
            .select('id, first_name, last_name, classes(nom)')
            .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`).limit(8);
        box.innerHTML = (data || []).map(s =>
            `<div onclick="selectAnnonceEleve('${s.id}','${(s.last_name||'')} ${(s.first_name||'')}')" style="padding:7px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:.9rem;">
                ${s.last_name||''} ${s.first_name||''} <span style="color:#999;">${s.classes?.nom||''}</span>
            </div>`).join('') || '<div style="padding:8px;color:#999;font-size:.85rem;">Aucun élève</div>';
    } catch (_) {}
};

window.selectAnnonceEleve = function(id, nom) {
    document.getElementById('annEleveId').value = id;
    document.getElementById('annEleveSelected').textContent = '✓ ' + nom;
    document.getElementById('annEleveResults').innerHTML = '';
    document.getElementById('annEleveSearch').value = nom;
};

window.publierAnnonce = async function() {
    const titre = document.getElementById('annTitre')?.value?.trim();
    const contenu = document.getElementById('annContenu')?.value?.trim();
    const categorie = document.getElementById('annCategorie')?.value || 'general';
    const cible = document.getElementById('annCible')?.value || 'tous';

    if (!titre || !contenu) { showToast('Titre et contenu obligatoires', 'error'); return; }

    const annonce = { titre, contenu, categorie, cible, published: true };
    if (cible === 'classe') {
        annonce.class_id = document.getElementById('annClasse')?.value;
        if (!annonce.class_id) { showToast('Sélectionnez une classe', 'error'); return; }
    } else if (cible === 'eleve') {
        annonce.student_id = document.getElementById('annEleveId')?.value;
        if (!annonce.student_id) { showToast('Sélectionnez un élève', 'error'); return; }
    }

    try {
        const { error } = await supabaseClient.from('annonces').insert([annonce]);
        if (error) throw error;
        showToast('Annonce publiée !', 'success');
        document.getElementById('annTitre').value = '';
        document.getElementById('annContenu').value = '';
        renderAnnoncesListe();
    } catch (err) {
        console.error('Erreur publication annonce:', err);
        showToast('Erreur : ' + (err.message || 'réessayez'), 'error');
    }
};

async function renderAnnoncesListe() {
    const box = document.getElementById('annoncesListe');
    if (!box) return;
    try {
        const { data: annonces, error } = await supabaseClient
            .from('annonces')
            .select('*, classes(nom), students(first_name, last_name)')
            .order('created_at', { ascending: false }).limit(50);
        if (error) throw error;

        if (!annonces || !annonces.length) {
            box.innerHTML = '<div style="text-align:center;padding:30px;color:#999;border:2px dashed #e5e7eb;border-radius:10px;">Aucune annonce publiée</div>';
            return;
        }

        box.innerHTML = annonces.map(a => {
            const cat = ANNONCE_CATEGORIES[a.categorie] || ANNONCE_CATEGORIES.general;
            const cibleTxt = a.cible === 'classe' ? `Classe : ${a.classes?.nom || '—'}`
                : a.cible === 'eleve' ? `Élève : ${a.students?.last_name || ''} ${a.students?.first_name || ''}`
                : 'Tous les parents';
            const date = new Date(a.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
            return `
                <div style="background:#fff;border:1px solid #e5e7eb;border-left:4px solid ${cat.color};border-radius:10px;padding:14px 16px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;">
                        <div style="flex:1;">
                            <span style="display:inline-block;background:${cat.bg};color:${cat.color};padding:2px 10px;border-radius:999px;font-size:.75rem;font-weight:600;">
                                <i class="fas ${cat.icon}"></i> ${cat.label}
                            </span>
                            <h4 style="margin:8px 0 4px;color:#1f2937;">${a.titre}</h4>
                            <p style="margin:0 0 6px;color:#4b5563;font-size:.9rem;white-space:pre-wrap;">${a.contenu}</p>
                            <div style="font-size:.78rem;color:#9ca3af;">
                                <i class="fas fa-bullseye"></i> ${cibleTxt} &nbsp;•&nbsp; <i class="fas fa-clock"></i> ${date}
                            </div>
                        </div>
                        <button onclick="supprimerAnnonce('${a.id}')" title="Supprimer" style="border:none;background:none;color:#ef4444;cursor:pointer;font-size:1rem;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
        }).join('');
    } catch (err) {
        console.error('Erreur liste annonces:', err);
        box.innerHTML = '<div style="color:#ef4444;padding:20px;">Erreur de chargement. La table "annonces" existe-t-elle ?</div>';
    }
}

window.supprimerAnnonce = async function(id) {
    if (!confirm('Supprimer cette annonce ?')) return;
    try {
        const { error } = await supabaseClient.from('annonces').delete().eq('id', id);
        if (error) throw error;
        showToast('Annonce supprimée', 'success');
        renderAnnoncesListe();
    } catch (err) {
        showToast('Erreur : ' + (err.message || 'réessayez'), 'error');
    }
};

window.loadAnnonces = loadAnnonces;

/**
 * Justifications d'absence soumises par les parents
 */
async function loadJustificationRequests() {
    let host = document.getElementById('justifRequestsHost');
    // Créer le conteneur s'il n'existe pas (injecté en haut de la page présences)
    if (!host) {
        const page = document.getElementById('presencesPage');
        if (!page) return;
        host = document.createElement('div');
        host.id = 'justifRequestsHost';
        host.style.marginBottom = '20px';
        const header = page.querySelector('.page-header');
        if (header && header.nextSibling) page.insertBefore(host, header.nextSibling);
        else page.insertBefore(host, page.firstChild);
    }

    try {
        // Charger les demandes SANS jointure (pas de FK déclarée entre presences et students)
        const { data: demandes, error } = await supabaseClient
            .from('presences')
            .select('id, date, status, justification_demande, justification_statut, student_id, class_id')
            .eq('justification_statut', 'en_attente')
            .order('date', { ascending: false });
        if (error) throw error;

        // Récupérer les noms d'élèves et de classes séparément
        const studentIds = [...new Set((demandes || []).map(d => d.student_id).filter(Boolean))];
        const classIds = [...new Set((demandes || []).map(d => d.class_id).filter(Boolean))];
        const studMap = {}, clsMap = {};
        if (studentIds.length) {
            const { data: studs } = await supabaseClient.from('students')
                .select('id, first_name, last_name').in('id', studentIds);
            (studs || []).forEach(s => studMap[s.id] = s);
        }
        if (classIds.length) {
            const { data: cls } = await supabaseClient.from('classes')
                .select('id, nom').in('id', classIds);
            (cls || []).forEach(c => clsMap[c.id] = c);
        }
        // Attacher les infos à chaque demande
        (demandes || []).forEach(d => {
            d.students = studMap[d.student_id] || null;
            d.classes = clsMap[d.class_id] || null;
        });

        if (!demandes || !demandes.length) {
            host.innerHTML = `
                <div class="card" style="border-left:4px solid #10b981;">
                    <div class="card-body" style="padding:14px 18px;color:#666;">
                        <i class="fas fa-check-circle" style="color:#10b981;"></i> Aucune demande de justification en attente.
                    </div>
                </div>`;
            return;
        }

        host.innerHTML = `
            <div class="card" style="border-left:4px solid #f59e0b;">
                <div class="card-body" style="padding:16px 18px;">
                    <h3 style="margin:0 0 12px;"><i class="fas fa-bell" style="color:#f59e0b;"></i> Demandes de justification en attente (${demandes.length})</h3>
                    <div style="display:flex;flex-direction:column;gap:10px;">
                        ${demandes.map(d => {
                            const nom = `${d.students?.last_name||''} ${d.students?.first_name||''}`.trim();
                            const date = new Date(d.date).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' });
                            const typeLbl = d.status === 'absent' ? 'Absence' : d.status === 'late' ? 'Retard' : d.status;
                            return `
                            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                                <div style="flex:1;min-width:220px;">
                                    <div style="font-weight:600;">${nom} <span style="color:#888;font-weight:400;">— ${d.classes?.nom||''}</span></div>
                                    <div style="font-size:.85rem;color:#666;margin:2px 0;"><span style="color:#ef4444;">${typeLbl}</span> du ${date}</div>
                                    <div style="font-size:.9rem;color:#374151;background:#f9fafb;padding:6px 10px;border-radius:6px;margin-top:4px;">
                                        <i class="fas fa-comment-dots" style="color:#888;"></i> ${d.justification_demande || '(aucun motif)'}
                                    </div>
                                </div>
                                <div style="display:flex;gap:8px;">
                                    <button class="btn btn-success" style="padding:8px 14px;" onclick="validerJustification('${d.id}', true)">
                                        <i class="fas fa-check"></i> Valider
                                    </button>
                                    <button class="btn btn-secondary" style="padding:8px 14px;background:#ef4444;color:#fff;" onclick="validerJustification('${d.id}', false)">
                                        <i class="fas fa-times"></i> Refuser
                                    </button>
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            </div>`;
    } catch (err) {
        console.error('Erreur demandes justification:', err);
        host.innerHTML = `<div class="card"><div class="card-body" style="color:#ef4444;padding:14px;">Erreur de chargement des demandes. Les colonnes justification_demande / justification_statut existent-elles ?</div></div>`;
    }
}

window.validerJustification = async function(presenceId, accepter) {
    try {
        let update;
        if (accepter) {
            // Récupérer le motif demandé pour le passer en justification officielle
            const { data: p } = await supabaseClient.from('presences')
                .select('justification_demande').eq('id', presenceId).single();
            update = {
                justification: p?.justification_demande || null,
                justification_statut: 'validee',
                updated_at: new Date().toISOString()
            };
        } else {
            update = { justification_statut: 'refusee', updated_at: new Date().toISOString() };
        }
        const { error } = await supabaseClient.from('presences').update(update).eq('id', presenceId);
        if (error) throw error;
        showToast(accepter ? 'Justification validée' : 'Justification refusée', 'success');
        await loadJustificationRequests();
    } catch (err) {
        console.error('Erreur validation:', err);
        showToast('Erreur : ' + (err.message || 'réessayez'), 'error');
    }
};

// ── Publication des bulletins (visibilité côté parents) ──────────────
async function isBulletinPublished(classId, sequence) {
    try {
        const { data } = await supabaseClient
            .from('bulletins_publies')
            .select('published')
            .eq('class_id', classId)
            .eq('sequence', parseInt(sequence))
            .maybeSingle();
        return !!(data && data.published);
    } catch (_) { return false; }
}

async function refreshPublishButton(classId, sequence) {
    const btn = document.getElementById('publishBtn');
    const lbl = document.getElementById('publishBtnLabel');
    if (!btn || !lbl) return;
    const published = await isBulletinPublished(classId, sequence);
    if (published) {
        btn.style.background = '#ef4444';
        lbl.textContent = 'Dépublier ce trimestre';
        btn.querySelector('i').className = 'fas fa-eye-slash';
    } else {
        btn.style.background = '#10b981';
        lbl.textContent = 'Publier ce trimestre';
        btn.querySelector('i').className = 'fas fa-globe';
    }
}

window.togglePublishBulletins = async function(classId, sequence) {
    const seq = parseInt(sequence);
    try {
        const published = await isBulletinPublished(classId, seq);
        if (published) {
            // Dépublier
            const { error } = await supabaseClient
                .from('bulletins_publies')
                .update({ published: false })
                .eq('class_id', classId).eq('sequence', seq);
            if (error) throw error;
            showToast('Bulletins masqués aux parents pour ce trimestre', 'success');
        } else {
            // Publier (upsert sur la contrainte unique class_id+sequence)
            const { error } = await supabaseClient
                .from('bulletins_publies')
                .upsert({ class_id: classId, sequence: seq, published: true, published_at: new Date().toISOString() },
                        { onConflict: 'class_id,sequence' });
            if (error) throw error;
            showToast('Bulletins publiés ! Les parents peuvent désormais les consulter.', 'success');
        }
        refreshPublishButton(classId, seq);
    } catch (err) {
        console.error('Erreur publication:', err);
        showToast('Erreur : ' + (err.message || 'réessayez'), 'error');
    }
};

// ============================================================
// SECTION ENSEIGNANTS — version professionnelle complète
// Logique : Jardin→6ème = 1 prof principal pour toute la classe
//           7ème→9ème   = 1 prof par matière (via class_subjects.teacher_id)
// ============================================================

const PRIMARY_LEVELS = ['jardin', '1ere', '2eme', '3eme', '4eme', '5eme', '6eme'];
const SECONDARY_LEVELS = ['7eme', '8eme', '9eme'];
const NIVEAU_LABELS = {
    jardin: 'Jardin', '1ere': '1ère année', '2eme': '2ème année', '3eme': '3ème année',
    '4eme': '4ème année', '5eme': '5ème année', '6eme': '6ème année',
    '7eme': '7ème année', '8eme': '8ème année', '9eme': '9ème année'
};

// ─────────────────────────────────────────────────────────────
// LISTE DES ENSEIGNANTS (avec affectations)
// ─────────────────────────────────────────────────────────────
async function loadEnseignants() {
    const grid = document.getElementById('enseignantsGrid');
    if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#999;"><i class="fas fa-spinner fa-spin" style="font-size:1.6rem;"></i></div>';

    try {
        const { data: teachers, error } = await supabaseClient
            .from('teachers')
            .select('id, first_name, last_name, email, phone, subjects, status, photo_url')
            .order('last_name');
        if (error) throw error;

        updateCounter('totalEnseignants', teachers?.length || 0);

        if (!grid) return;
        if (!teachers || !teachers.length) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#666;">Aucun enseignant enregistré. Cliquez sur « Nouvel enseignant » pour commencer.</div>';
            return;
        }

        // Récupérer les affectations : prof principal (classes) + matières (class_subjects)
        const ids = teachers.map(t => t.id);

        // a) Classes dont ces profs sont principaux
        let classesPrincipal = [];
        try {
            const { data, error } = await supabaseClient
                .from('classes').select('id, nom, niveau, professeur_principal_id').in('professeur_principal_id', ids);
            if (error) throw error;
            classesPrincipal = data || [];
        } catch (e) { console.warn('⚠️ Lecture classes principales:', e.message); }

        // b) Matières assignées à ces profs (7e-9e)
        let csRows = [];
        try {
            const { data, error } = await supabaseClient
                .from('class_subjects').select('teacher_id, class_id, subject_id, classes(nom), subjects(name)').in('teacher_id', ids);
            if (error) throw error;
            csRows = data || [];
        } catch (e) {
            console.warn('⚠️ Lecture class_subjects avec jointures échouée, essai sans jointures:', e.message);
            // Repli sans jointures (au cas où les relations FK ne sont pas configurées)
            try {
                const { data } = await supabaseClient.from('class_subjects')
                    .select('teacher_id, class_id, subject_id').in('teacher_id', ids);
                csRows = data || [];
            } catch (e2) { console.warn('⚠️ class_subjects sans jointure aussi échouée:', e2.message); }
        }

        // c) Noms des matières et classes (pour le repli sans jointures)
        let allSubjects = [], allClasses = [];
        try { const { data } = await supabaseClient.from('subjects').select('id, name'); allSubjects = data || []; } catch(_){}
        try { const { data } = await supabaseClient.from('classes').select('id, nom'); allClasses = data || []; } catch(_){}

        console.log('🔎 Enseignants:', teachers.length, '| classes principales:', classesPrincipal.length, '| liens matières:', csRows.length);

        // Mettre à jour les compteurs de la page
        updateCounter('totalEnseignants', teachers.length);
        // Profs principaux = nombre d'enseignants distincts affectés comme principal
        const profsPrincipauxSet = new Set(classesPrincipal.map(c => c.professeur_principal_id).filter(Boolean));
        const elProfP = document.getElementById('profPrincipaux');
        if (elProfP) elProfP.textContent = profsPrincipauxSet.size;
        // Matières enseignées = nombre de liens matière-prof distincts
        const elMat = document.getElementById('matieresCount');
        if (elMat) elMat.textContent = csRows.length;

        const subjMap = {}; allSubjects.forEach(s => subjMap[s.id] = s.name);
        const classMap = {}; allClasses.forEach(c => classMap[c.id] = c.nom);

        // Indexer par enseignant
        const principalBy = {}; classesPrincipal.forEach(c => {
            (principalBy[c.professeur_principal_id] = principalBy[c.professeur_principal_id] || []).push(c);
        });
        const matieresBy = {}; csRows.forEach(cs => {
            // normaliser : garantir nom matière et classe même sans jointure
            cs._subjectName = cs.subjects?.name || subjMap[cs.subject_id] || 'Matière';
            cs._className = cs.classes?.nom || classMap[cs.class_id] || '';
            (matieresBy[cs.teacher_id] = matieresBy[cs.teacher_id] || []).push(cs);
        });

        grid.innerHTML = teachers.map(t => {
            const initials = `${t.first_name?.[0] || ''}${t.last_name?.[0] || ''}`.toUpperCase();
            const principal = principalBy[t.id] || [];
            const matieres = matieresBy[t.id] || [];

            // Badges classe principale (Jardin-6e)
            const principalBadges = principal.map(c =>
                `<span style="background:#e8f5e9;color:#5D4037;padding:3px 10px;border-radius:999px;font-size:.74rem;font-weight:600;margin:2px;display:inline-block;">
                    <i class="fas fa-chalkboard"></i> ${c.nom} (principal)</span>`).join('');

            // Badges matière+classe (7e-9e)
            const matiereBadges = matieres.map(cs =>
                `<span style="background:#ede9fe;color:#6d28d9;padding:3px 10px;border-radius:999px;font-size:.74rem;font-weight:600;margin:2px;display:inline-block;">
                    <i class="fas fa-book"></i> ${cs._subjectName} · ${cs._className}</span>`).join('');

            const affectations = (principalBadges + matiereBadges) ||
                '<span style="color:#9ca3af;font-size:.82rem;font-style:italic;">Aucun enseignement assigné</span>';

            const nbAff = principal.length + matieres.length;

            return `
            <div class="card teacher-card" style="background:#fff;border:1px solid #e8efe9;border-radius:14px;padding:0;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05);">
                <div style="background:linear-gradient(135deg,#5D4037,#6D4C41);padding:18px;text-align:center;">
                    ${t.photo_url
                        ? `<img src="${t.photo_url}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;margin:0 auto 8px;border:2px solid rgba(255,255,255,.6);display:block;">`
                        : `<div style="width:64px;height:64px;background:rgba(255,255,255,.2);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-size:1.3rem;font-weight:700;border:2px solid rgba(255,255,255,.4);">${initials}</div>`}
                    <h4 style="margin:0;color:#fff;font-size:1.05rem;">${t.last_name} ${t.first_name}</h4>
                    <div style="color:rgba(255,255,255,.85);font-size:.8rem;margin-top:2px;">${nbAff} enseignement${nbAff > 1 ? 's' : ''}</div>
                </div>
                <div style="padding:16px;">
                    <div style="font-size:.84rem;color:#374151;margin-bottom:6px;"><i class="fas fa-envelope" style="color:#9ca3af;width:16px;"></i> ${t.email || '—'}</div>
                    <div style="font-size:.84rem;color:#374151;margin-bottom:12px;"><i class="fas fa-phone" style="color:#9ca3af;width:16px;"></i> ${t.phone || '—'}</div>
                    <div style="border-top:1px solid #f0f2f1;padding-top:10px;margin-bottom:12px;min-height:32px;">${affectations}</div>
                    <div style="display:flex;gap:6px;justify-content:flex-end;">
                        <button class="parent-action-btn view" onclick="viewTeacher('${t.id}')" title="Détails"><i class="fas fa-eye"></i></button>
                        <button class="parent-action-btn edit" onclick="editTeacher('${t.id}')" title="Modifier"><i class="fas fa-pen"></i></button>
                        <button class="parent-action-btn del" onclick="deleteTeacher('${t.id}')" title="Supprimer"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>`;
        }).join('');

    } catch (error) {
        console.error('❌ Erreur enseignants:', error);
        if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#ef4444;">Erreur de chargement</div>';
    }
}

// ─────────────────────────────────────────────────────────────
// CRÉER / MODIFIER un enseignant
// ─────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
// COMPTE DE CONNEXION DES ENSEIGNANTS
// ------------------------------------------------------------------------
// Jusqu'ici, la page « Enseignants » ne creait qu'une FICHE DE PERSONNEL :
// aucun compte Auth, donc aucun enseignant ne pouvait se connecter.
// Seule la page « Utilisateurs » creait un vrai compte — et sans sauvegarder
// la session, ce qui deconnectait le directeur.
// Ces fonctions unifient le parcours sur le modele deja eprouve des parents.
// ════════════════════════════════════════════════════════════════════════

window.onTeacherAccountToggle = function () {
    const coche = document.getElementById('teacherCreateAccount')?.checked;
    const zone  = document.getElementById('teacherAccountFields');
    if (zone) zone.style.display = coche ? 'block' : 'none';
    // Un mot de passe est propose des l'ouverture : le directeur n'a rien a inventer.
    if (coche && !document.getElementById('teacherPassword')?.value) {
        genererMotDePasseEnseignant();
    }
};

window.genererMotDePasseEnseignant = function () {
    // Caracteres sans ambiguite : ni O/0, ni I/l/1. Un mot de passe dicte au
    // telephone ou recopie a la main ne doit pas preter a confusion.
    const lettres = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
    const chiffres = '23456789';
    const speciaux = '!@#$%&*';
    let mdp = '';
    for (let i = 0; i < 8; i++) mdp += lettres.charAt(Math.floor(Math.random() * lettres.length));
    for (let i = 0; i < 3; i++) mdp += chiffres.charAt(Math.floor(Math.random() * chiffres.length));
    mdp += speciaux.charAt(Math.floor(Math.random() * speciaux.length));
    const champ = document.getElementById('teacherPassword');
    if (champ) champ.value = mdp;
    return mdp;
};

/**
 * Cree le compte Auth d'un enseignant et renvoie son identifiant.
 * Renvoie null si aucun compte n'est demande.
 *
 * POINT CRITIQUE : signUp() connecte automatiquement le nouveau compte et
 * REMPLACE la session courante. Sans sauvegarde/restauration, le directeur
 * se retrouverait deconnecte — ou pire, connecte en tant que l'enseignant
 * qu'il vient de creer. C'est le bug present dans la page « Utilisateurs ».
 */
async function creerCompteEnseignant(email, motDePasse) {
    const { data: { session: sessionAdmin } } = await supabaseClient.auth.getSession();

    const restaurer = async () => {
        if (sessionAdmin) {
            try { await supabaseClient.auth.setSession(sessionAdmin); }
            catch (e) { console.warn('Restauration de session:', e?.message); }
        }
    };

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: motDePasse
        });

        if (error) {
            await restaurer();
            // Message parlant plutot que le libelle technique de Supabase
            if (/already registered|already exists/i.test(error.message || '')) {
                throw new Error("Cette adresse e-mail possede deja un compte.");
            }
            throw error;
        }
        if (!data?.user?.id) {
            await restaurer();
            throw new Error("Le compte n'a pas pu etre cree (aucun identifiant renvoye).");
        }

        const idAuth = data.user.id;
        await restaurer();   // le directeur redevient lui-meme AVANT toute ecriture

        // Profil : role 'enseignant'. La table `profiles` melange administrateurs,
        // enseignants et parents — le champ `role` est ce qui les distingue.
        const { error: errProfil } = await supabaseClient.from('profiles').upsert({
            id: idAuth,
            email: email,
            role: 'enseignant',
            status: 'actif',
            created_at: new Date().toISOString()
        }, { onConflict: 'id' });
        if (errProfil) console.warn('Profil enseignant:', errProfil.message);

        return idAuth;
    } catch (err) {
        await restaurer();
        throw err;
    }
}

/**
 * Transmet les identifiants par SMS. Reutilise l'Edge Function des parents :
 * le message est le meme (ecole, identifiant, mot de passe).
 */
async function envoyerSmsEnseignant(telephone, prenom, email, motDePasse) {
    try {
        const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-sms-parent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ANON_KEY_SMS}`,
                'apikey': ANON_KEY_SMS
            },
            body: JSON.stringify({
                phone: telephone, firstName: prenom, email: email,
                password: motDePasse, action: 'send'
            })
        });
        return await resp.json();
    } catch (err) {
        console.error('SMS enseignant:', err);
        return { success: false, error: err.message };
    }
}

// Bascule entre taux horaire et forfait dans la fiche enseignant.
window.majChampsRemuneration = function () {
    const mode = document.getElementById('teacherRemuneration')?.value || 'horaire';
    const h = document.getElementById('blocTauxHoraire');
    const f = document.getElementById('blocForfait');
    if (h) h.style.display = mode === 'horaire' ? '' : 'none';
    if (f) f.style.display = mode === 'forfait' ? '' : 'none';
};

async function saveTeacher(e) {
    if (e) e.preventDefault();
    const editId = document.getElementById('teacherEditId')?.value || null;
    const role = document.getElementById('teacherRole')?.value || 'aucun';

    const select = document.getElementById('teacherSubjects');
    const subjects = Array.from(select?.selectedOptions || []).map(o => o.value);

    const formData = {
        first_name: document.getElementById('teacherFirstName')?.value?.trim(),
        last_name: document.getElementById('teacherLastName')?.value?.trim(),
        email: document.getElementById('teacherEmail')?.value?.trim(),
        phone: document.getElementById('teacherPhone')?.value?.trim() || null,
        gender: document.getElementById('teacherGender')?.value || null,
        hire_date: document.getElementById('teacherHireDate')?.value || null,
        qualification: document.getElementById('teacherQualification')?.value?.trim() || null,
        // Remuneration : le taux propre a chaque enseignant, base de sa paie.
        type_remuneration: document.getElementById('teacherRemuneration')?.value || 'horaire',
        taux_horaire: parseFloat(document.getElementById('teacherTaux')?.value) || null,
        salaire_forfait: parseFloat(document.getElementById('teacherForfait')?.value) || null,
        address: document.getElementById('teacherAddress')?.value?.trim() || null,
        subjects: role === 'matieres' ? subjects : []
    };

    if (!formData.first_name || !formData.last_name) {
        showToast('Nom et prénom obligatoires', 'error'); return;
    }
    // Validations selon le rôle
    if (role === 'principal' && !document.getElementById('teacherPrincipalClass')?.value) {
        showToast('Choisissez la classe principale', 'error'); return;
    }
    if (role === 'matieres' && subjects.length === 0) {
        showToast('Sélectionnez au moins une matière', 'error'); return;
    }

    // ── Compte de connexion (nouveaux enseignants uniquement) ──
    const creerCompte = !editId && document.getElementById('teacherCreateAccount')?.checked;
    const motDePasse  = document.getElementById('teacherPassword')?.value?.trim() || '';
    const envoyerSms  = document.getElementById('teacherSendSms')?.checked;

    if (creerCompte) {
        // L'e-mail EST l'identifiant de connexion : sans lui, pas de compte.
        if (!formData.email) {
            showToast("L'adresse e-mail est obligatoire pour créer un compte de connexion.", 'error');
            return;
        }
        if (motDePasse.length < 8) {
            showToast('Le mot de passe doit contenir au moins 8 caractères.', 'error');
            return;
        }
        if (envoyerSms && !formData.phone) {
            showToast("Renseignez un téléphone, ou décochez l'envoi par SMS.", 'error');
            return;
        }
    }

    // Upload de la photo si fournie
    const photoFile = document.getElementById('teacherPhoto')?.files?.[0];
    if (photoFile) {
        try {
            const ext = photoFile.name.split('.').pop();
            const fileName = `teacher_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
            const { error: upErr } = await supabaseClient.storage.from('admissions').upload(fileName, photoFile);
            if (!upErr) {
                const { data: { publicUrl } } = supabaseClient.storage.from('admissions').getPublicUrl(fileName);
                formData.photo_url = publicUrl;
            } else {
                console.warn('⚠️ Upload photo prof:', upErr.message);
            }
        } catch (e) { console.warn('⚠️ Photo:', e); }
    }

    try {
        let teacherId = editId;
        if (editId) {
            const { error } = await supabaseClient.from('teachers').update(formData).eq('id', editId);
            if (error) throw error;
        } else {
            // Si un compte est demande, on le cree D'ABORD : la ligne `teachers`
            // doit porter le MEME identifiant que le compte Auth. C'est cette
            // egalite (teachers.id = auth.uid()) qui permettra plus tard aux
            // politiques RLS de reconnaitre l'enseignant connecte.
            let idAuth = null;
            if (creerCompte) {
                idAuth = await creerCompteEnseignant(formData.email, motDePasse);
                formData.id = idAuth;
            }

            const { data, error } = await supabaseClient.from('teachers').insert([formData]).select('id').single();
            if (error) throw error;
            teacherId = data.id;

            // Transmission des identifiants
            if (creerCompte) {
                if (envoyerSms) {
                    const res = await envoyerSmsEnseignant(
                        formData.phone, formData.first_name, formData.email, motDePasse);
                    if (res?.success || res?.sms_sent) {
                        showToast('Compte créé et identifiants envoyés par SMS.', 'success', 7000);
                    } else {
                        // Le compte EXISTE : il ne faut surtout pas laisser croire a un echec.
                        showToast('Compte créé, mais le SMS n\'est pas parti. ' +
                                  'Transmettez le mot de passe : ' + motDePasse, 'warning', 15000);
                    }
                } else {
                    showToast('Compte créé. Mot de passe à transmettre : ' + motDePasse,
                              'success', 15000);
                }
                console.log('Compte enseignant créé — identifiant :', formData.email);
            }
        }

        // Appliquer le rôle
        if (role === 'principal') {
            const classId = document.getElementById('teacherPrincipalClass').value;
            // Détacher ce prof d'anciennes classes principales, puis affecter la nouvelle
            await supabaseClient.from('classes').update({ professeur_principal_id: null }).eq('professeur_principal_id', teacherId);
            const { data: updated, error: cerr } = await supabaseClient.from('classes')
                .update({ professeur_principal_id: teacherId }).eq('id', classId).select('id, nom, professeur_principal_id');
            if (cerr) throw cerr;
            console.log('✅ Prof principal affecté à la classe:', updated);
            if (!updated || !updated.length) {
                showToast('⚠️ La classe n\'a pas pu être mise à jour (vérifiez les droits)', 'warning');
            }
        } else if (role === 'matieres') {
            const classSel = document.getElementById('teacherSecondaryClasses');
            const classIds = Array.from(classSel?.selectedOptions || []).map(o => o.value);
            // Pour chaque classe sélectionnée × chaque matière, créer le lien s'il n'existe pas
            for (const classId of classIds) {
                for (const subjId of subjects) {
                    // Le SELECT precedent pouvait echouer SILENCIEUSEMENT (RLS,
                    // session expiree) : `existing` restait alors undefined,
                    // et le code tombait sur l'INSERT malgre une ligne deja
                    // presente -> conflit 409 sur la contrainte d'unicite.
                    // On verifie desormais l'erreur, et on utilise un UPSERT
                    // reel : la base elle-meme decide creation ou mise a jour,
                    // sans etat intermediaire pouvant se tromper.
                    const { error: errUpsert } = await supabaseClient
                        .from('class_subjects')
                        .upsert(
                            { class_id: classId, subject_id: subjId, teacher_id: teacherId },
                            { onConflict: 'class_id,subject_id' }
                        );
                    if (errUpsert) {
                        console.error('❌ Affectation classe/matière :', errUpsert);
                        showToast('Affectation impossible (' + (errUpsert.message || 'droits insuffisants') + ')', 'error', 8000);
                    }
                }
            }
        }

        showToast(editId ? 'Enseignant modifié' : 'Enseignant créé', 'success');
        closeModal('addTeacherModal');
        if (typeof dataCache !== 'undefined') { dataCache.teachers = null; }
        await loadEnseignants();
    } catch (error) {
        console.error('❌ Erreur sauvegarde enseignant:', error);
        showToast('Erreur : ' + (error.message || 'réessayez'), 'error');
    }
}

/**
 * Verifie SI l'enseignant a deja un compte de connexion, et adapte le
 * bloc en consequence. auth.users n'est pas lisible directement par le
 * client : passe par une fonction RPC SECURITY DEFINER.
 */
async function afficherStatutCompteEnseignant(teacherId) {
    const bloc = document.getElementById('teacherAccountBlock');
    if (!bloc) return;

    try {
        const { data: existe, error } = await supabaseClient
            .rpc('epmk_enseignant_a_un_compte', { p_teacher_id: teacherId });
        if (error) throw error;

        if (existe) {
            bloc.innerHTML =
                '<div style="display:flex;align-items:center;gap:9px;color:#2E7D32;font-weight:600;">' +
                  '<i class="fas fa-circle-check"></i> Compte de connexion actif</div>' +
                '<p style="font-size:.8rem;color:#7A6A63;margin:8px 0 8px;">' +
                  'Cet enseignant peut déjà se connecter à l\'application.</p>' +
                '<button type="button" class="btn btn-secondary" ' +
                  'onclick="resetTeacherPasswordSms(\'' + teacherId + '\')">' +
                  '<i class="fas fa-key"></i> Réinitialiser le mot de passe</button>';
        } else {
            bloc.innerHTML =
                '<label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-weight:600;color:#4E342E;">' +
                  '<input type="checkbox" id="teacherCreateAccount" style="width:auto;" onchange="onTeacherAccountToggle()">' +
                  '<span><i class="fas fa-key"></i> Créer un compte de connexion pour l\'application</span>' +
                '</label>' +
                '<p style="font-size:.8rem;color:#7A6A63;margin:8px 0 0;">' +
                  'Cet enseignant n\'a actuellement aucun compte. Nécessaire pour qu\'il ' +
                  'puisse saisir ses notes depuis son téléphone.</p>' +
                '<div id="teacherAccountFields" style="display:none;margin-top:12px;">' +
                  '<div class="form-group"><label>Mot de passe provisoire *</label>' +
                    '<div style="display:flex;gap:8px;">' +
                      '<input type="text" id="teacherPassword" class="form-control" ' +
                        'placeholder="Généré automatiquement" style="flex:1;">' +
                      '<button type="button" class="btn btn-secondary" onclick="genererMotDePasseEnseignant()" ' +
                        'title="Générer un nouveau mot de passe"><i class="fas fa-sync-alt"></i></button>' +
                    '</div></div>' +
                  '<label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:.88rem;color:#2A211D;">' +
                    '<input type="checkbox" id="teacherSendSms" checked style="width:auto;"> ' +
                    'Envoyer les identifiants par SMS (nécessite un numéro de téléphone)</label>' +
                '</div>';
        }
    } catch (e) {
        console.error('Statut du compte enseignant :', e);
        bloc.innerHTML = '<p style="color:#B23B2E;font-size:.85rem;">' +
            '<i class="fas fa-triangle-exclamation"></i> Statut du compte non vérifiable ' +
            '(' + (e.message || 'erreur') + '). Vérifiez manuellement avant de créer un doublon.</p>';
    }
}

window.editTeacher = async function(teacherId) {
    try {
        const { data: t, error } = await supabaseClient.from('teachers')
            .select('*').eq('id', teacherId).single();
        if (error || !t) throw error || new Error('Enseignant introuvable');

        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        setVal('teacherEditId', t.id);
        setVal('teacherLastName', t.last_name);
        setVal('teacherFirstName', t.first_name);
        setVal('teacherEmail', t.email);
        setVal('teacherPhone', t.phone);
        setVal('teacherGender', t.gender);
        setVal('teacherHireDate', t.hire_date);
        setVal('teacherQualification', t.qualification);
        // Remuneration : sans pre-remplissage, une modification de fiche
        // effacerait le taux horaire de l'enseignant.
        setVal('teacherRemuneration', t.type_remuneration || 'horaire');
        setVal('teacherTaux', t.taux_horaire);
        setVal('teacherForfait', t.salaire_forfait);
        if (typeof majChampsRemuneration === 'function') majChampsRemuneration();
        setVal('teacherAddress', t.address);
        const photoInput = document.getElementById('teacherPhoto'); if (photoInput) photoInput.value = '';

        // Déterminer le rôle actuel : est-il prof principal d'une classe ?
        const { data: principalClass } = await supabaseClient.from('classes')
            .select('id').eq('professeur_principal_id', teacherId).maybeSingle();

        const roleSel = document.getElementById('teacherRole');
        if (principalClass) {
            if (roleSel) roleSel.value = 'principal';
            await onTeacherRoleChange();
            setVal('teacherPrincipalClass', principalClass.id);
        } else if (Array.isArray(t.subjects) && t.subjects.length) {
            if (roleSel) roleSel.value = 'matieres';
            await onTeacherRoleChange();
            const sel = document.getElementById('teacherSubjects');
            if (sel) Array.from(sel.options).forEach(o => { o.selected = t.subjects.includes(o.value); });
        } else {
            if (roleSel) roleSel.value = 'aucun';
            await onTeacherRoleChange();
        }

        const title = document.getElementById('addTeacherModalTitle');
        if (title) title.textContent = 'Modifier l\'enseignant';

        // Le bloc « Créer un compte » s'affichait pour TOUT enseignant en
        // édition, sans jamais vérifier s'il en avait déjà un. On interroge
        // la vérité (auth.users) et on adapte le bloc en conséquence.
        await afficherStatutCompteEnseignant(teacherId);

        openModal('addTeacherModal');
    } catch (e) {
        console.error('❌ editTeacher:', e);
        showToast('Erreur lors du chargement', 'error');
    }
};

// Réinitialiser le formulaire pour une création
window.openCreateTeacherModal = async function() {
    const f = document.getElementById('addTeacherForm');
    if (f) f.reset();
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('teacherEditId', '');
    setVal('teacherRole', '');
    const pw = document.getElementById('teacherPrincipalWrap'); if (pw) pw.style.display = 'none';
    const mw = document.getElementById('teacherMatieresWrap'); if (mw) mw.style.display = 'none';
    const title = document.getElementById('addTeacherModalTitle');
    if (title) title.textContent = 'Nouvel enseignant';

    // Un NOUVEL enseignant n'a par definition jamais de compte : on
    // restaure le bloc d'origine, au cas ou editTeacher l'aurait
    // remplace par l'etat « compte deja actif » lors d'une consultation
    // precedente dans la meme session.
    const bloc = document.getElementById('teacherAccountBlock');
    if (bloc) {
        bloc.innerHTML =
            '<label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-weight:600;color:#4E342E;">' +
              '<input type="checkbox" id="teacherCreateAccount" style="width:auto;" onchange="onTeacherAccountToggle()">' +
              '<span><i class="fas fa-key"></i> Créer un compte de connexion pour l\'application</span>' +
            '</label>' +
            '<p style="font-size:.8rem;color:#7A6A63;margin:8px 0 0;">' +
              'Nécessaire pour que l\'enseignant puisse saisir ses notes depuis son téléphone. ' +
              'L\'adresse e-mail devient son identifiant.</p>' +
            '<div id="teacherAccountFields" style="display:none;margin-top:12px;">' +
              '<div class="form-group"><label>Mot de passe provisoire *</label>' +
                '<div style="display:flex;gap:8px;">' +
                  '<input type="text" id="teacherPassword" class="form-control" ' +
                    'placeholder="Généré automatiquement" style="flex:1;">' +
                  '<button type="button" class="btn btn-secondary" onclick="genererMotDePasseEnseignant()" ' +
                    'title="Générer un nouveau mot de passe"><i class="fas fa-sync-alt"></i></button>' +
                '</div></div>' +
              '<label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:.88rem;color:#2A211D;">' +
                '<input type="checkbox" id="teacherSendSms" checked style="width:auto;"> ' +
                'Envoyer les identifiants par SMS (nécessite un numéro de téléphone)</label>' +
            '</div>';
    }

    openModal('addTeacherModal');
};

window.deleteTeacher = async function(teacherId) {
    if (!confirm('Supprimer cet enseignant ? Ses affectations seront aussi retirées.')) return;
    try {
        // Détacher des classes (prof principal) et des matières
        await supabaseClient.from('classes').update({ professeur_principal_id: null }).eq('professeur_principal_id', teacherId);
        await supabaseClient.from('class_subjects').update({ teacher_id: null }).eq('teacher_id', teacherId);
        const { error } = await supabaseClient.from('teachers').delete().eq('id', teacherId);
        if (error) throw error;
        showToast('Enseignant supprimé', 'success');
        await loadEnseignants();
    } catch (error) {
        console.error('❌ Suppression enseignant:', error);
        showToast('Erreur lors de la suppression', 'error');
    }
};

// ─────────────────────────────────────────────────────────────
// DÉTAIL d'un enseignant (classes + matières enseignées)
// ─────────────────────────────────────────────────────────────
window.viewTeacher = async function(teacherId) {
    try {
        const { data: t } = await supabaseClient.from('teachers').select('*').eq('id', teacherId).single();
        if (!t) { showToast('Enseignant introuvable', 'error'); return; }

        const [{ data: principal }, { data: cs }] = await Promise.all([
            supabaseClient.from('classes').select('nom, niveau').eq('professeur_principal_id', teacherId),
            supabaseClient.from('class_subjects').select('classes(nom), subjects(name)').eq('teacher_id', teacherId)
        ]);

        // Matières déclarées par le prof (sa spécialité), même sans classe assignée
        let declaredSubjects = [];
        if (Array.isArray(t.subjects) && t.subjects.length) {
            const { data: subs } = await supabaseClient.from('subjects').select('id, name').in('id', t.subjects);
            declaredSubjects = (subs || []).map(s => s.name);
        }

        const principalHtml = (principal || []).length
            ? principal.map(c => `<li><b>${c.nom}</b> — ${NIVEAU_LABELS[c.niveau] || c.niveau} <span style="color:#5D4037;">(professeur principal, toutes matières)</span></li>`).join('')
            : '<li style="color:#9ca3af;">Aucune classe en tant que professeur principal</li>';

        // Construire l'affichage des matières : assignations précises + matières déclarées
        let matieresHtml = '';
        if ((cs || []).length) {
            matieresHtml += cs.map(x => `<li><b>${x.subjects?.name || 'Matière'}</b> en <b>${x.classes?.nom || '—'}</b></li>`).join('');
        }
        if (declaredSubjects.length) {
            matieresHtml += `<li style="margin-top:6px;color:#6b7280;"><b>Spécialité(s) :</b> ${declaredSubjects.join(', ')}</li>`;
        }
        if (!matieresHtml) {
            matieresHtml = '<li style="color:#9ca3af;">Aucune matière enseignée</li>';
        }

        // Calculs RH
        const initials = `${(t.first_name?.[0]||'')}${(t.last_name?.[0]||'')}`.toUpperCase();
        const genreLabel = t.gender === 'M' ? 'Masculin' : t.gender === 'F' ? 'Féminin' : '—';
        const statut = (t.status === 'inactif')
            ? '<span style="background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:999px;font-size:.78rem;font-weight:600;">Inactif</span>'
            : '<span style="background:#d1fae5;color:#065f46;padding:3px 10px;border-radius:999px;font-size:.78rem;font-weight:600;">Actif</span>';
        let anciennete = '—';
        if (t.hire_date) {
            const d = new Date(t.hire_date);
            const mois = Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000*60*60*24*30.44)));
            anciennete = mois >= 12 ? `${Math.floor(mois/12)} an(s)${mois%12 ? ' ' + (mois%12) + ' mois' : ''}` : `${mois} mois`;
        }
        const hireStr = t.hire_date ? new Date(t.hire_date).toLocaleDateString('fr-FR') : '—';

        // En-tête : photo ou initiales
        const avatar = t.photo_url
            ? `<img src="${t.photo_url}" alt="" style="width:84px;height:84px;border-radius:50%;object-fit:cover;border:3px solid #5D4037;">`
            : `<div style="width:84px;height:84px;background:linear-gradient(135deg,#5D4037,#6D4C41);color:#fff;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:700;">${initials}</div>`;

        const nbClasses = (principal || []).length;
        const nbMatieres = Math.max((cs || []).length, declaredSubjects.length);

        const host = document.getElementById('teacherDetailsBody');
        if (host) {
            host.innerHTML = `
                <div style="text-align:center;margin-bottom:18px;">
                    ${avatar}
                    <h3 style="margin:10px 0 2px;color:#1f2937;">${t.last_name} ${t.first_name}</h3>
                    <div style="margin-bottom:6px;">${statut}</div>
                    <div style="color:#6b7280;font-size:.88rem;">${t.qualification || 'Qualification non renseignée'}</div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
                    <div style="background:#f8faf8;border-radius:10px;padding:12px;text-align:center;">
                        <div style="font-size:1.4rem;font-weight:700;color:#5D4037;">${nbClasses}</div>
                        <div style="font-size:.78rem;color:#6b7280;">Classe(s) principale(s)</div>
                    </div>
                    <div style="background:#faf5ff;border-radius:10px;padding:12px;text-align:center;">
                        <div style="font-size:1.4rem;font-weight:700;color:#6d28d9;">${nbMatieres}</div>
                        <div style="font-size:.78rem;color:#6b7280;">Matière(s) enseignée(s)</div>
                    </div>
                </div>

                <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:12px;">
                    <h4 style="margin:0 0 10px;color:#374151;font-size:.95rem;"><i class="fas fa-id-card"></i> Informations</h4>
                    <table style="width:100%;font-size:.86rem;color:#374151;border-collapse:collapse;">
                        <tr><td style="padding:4px 0;color:#9ca3af;width:42%;">Email</td><td>${t.email || '—'}</td></tr>
                        <tr><td style="padding:4px 0;color:#9ca3af;">Téléphone</td><td>${t.phone || '—'}</td></tr>
                        <tr><td style="padding:4px 0;color:#9ca3af;">Genre</td><td>${genreLabel}</td></tr>
                        <tr><td style="padding:4px 0;color:#9ca3af;">Adresse</td><td>${t.address || '—'}</td></tr>
                        <tr><td style="padding:4px 0;color:#9ca3af;">Date d'embauche</td><td>${hireStr}</td></tr>
                        <tr><td style="padding:4px 0;color:#9ca3af;">Ancienneté</td><td>${anciennete}</td></tr>
                    </table>
                </div>

                <div style="background:#f8faf8;border-radius:10px;padding:14px;margin-bottom:12px;">
                    <h4 style="margin:0 0 8px;color:#5D4037;font-size:.95rem;"><i class="fas fa-chalkboard"></i> Classe(s) principale(s) — Jardin à 6e</h4>
                    <ul style="margin:0;padding-left:20px;color:#374151;line-height:1.8;font-size:.88rem;">${principalHtml}</ul>
                </div>
                <div style="background:#faf5ff;border-radius:10px;padding:14px;">
                    <h4 style="margin:0 0 8px;color:#6d28d9;font-size:.95rem;"><i class="fas fa-book"></i> Matières enseignées — 7e à 9e</h4>
                    <ul style="margin:0;padding-left:20px;color:#374151;line-height:1.8;font-size:.88rem;">${matieresHtml}</ul>
                </div>`;
        }
        openModal('teacherDetailsModal');
    } catch (e) {
        console.error('❌ viewTeacher:', e);
        showToast('Erreur lors du chargement', 'error');
    }
};

// ─────────────────────────────────────────────────────────────
// GÉRER LES MATIÈRES D'UNE CLASSE (assigner matière + prof) — 7e-9e
// ─────────────────────────────────────────────────────────────
window.gererMatieres = async function(classeId, classeNom) {
    document.getElementById('matiereClasseNom').textContent = classeNom;
    document.getElementById('matiereClasseId')?.setAttribute('value', classeId);
    const host = document.getElementById('classeMatieresBody');
    if (host) host.innerHTML = '<div style="text-align:center;padding:20px;color:#999;"><i class="fas fa-spinner fa-spin"></i></div>';
    openModal('classeMatieresModal');
    await renderClasseMatieres(classeId);
};

async function renderClasseMatieres(classeId) {
    const host = document.getElementById('classeMatieresBody');
    if (!host) return;
    try {
        // Niveau de la classe : détermine le mode (principal vs par matière)
        const { data: classe } = await supabaseClient.from('classes')
            .select('niveau, professeur_principal_id').eq('id', classeId).maybeSingle();
        const niveau = classe?.niveau;

        const [{ data: subjects }, { data: teachers }, { data: existing }] = await Promise.all([
            supabaseClient.from('subjects').select('id, name, code').order('name'),
            supabaseClient.from('teachers').select('id, first_name, last_name').order('last_name'),
            supabaseClient.from('class_subjects').select('id, subject_id, teacher_id, coefficient, subjects(name), teachers(first_name, last_name)').eq('class_id', classeId)
        ]);

        // Avertissement selon le niveau
        let banner = '';
        if (PRIMARY_LEVELS.includes(niveau)) {
            banner = `<div style="background:#e8f5e9;color:#5D4037;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:.85rem;">
                <i class="fas fa-info-circle"></i> Niveau ${NIVEAU_LABELS[niveau] || niveau} : un <b>professeur principal</b> enseigne toutes les matières. Définissez-le dans la fiche de la classe.</div>`;
        } else if (SECONDARY_LEVELS.includes(niveau)) {
            banner = `<div style="background:#ede9fe;color:#6d28d9;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:.85rem;">
                <i class="fas fa-info-circle"></i> Niveau ${NIVEAU_LABELS[niveau] || niveau} : assignez <b>un professeur par matière</b>.</div>`;
        }

        const teacherOptions = (teachers || []).map(t => `${t.id}::${t.last_name} ${t.first_name}`);

        // Matières déjà assignées
        const existingHtml = (existing || []).length ? (existing || []).map(cs => {
            const prof = cs.teachers ? `${cs.teachers.last_name} ${cs.teachers.first_name}` : '<span style="color:#f59e0b;">Aucun prof</span>';
            const teacherSelect = `<select onchange="updateMatiereTeacher('${cs.id}', this.value, '${classeId}')" style="padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#1f2937;">
                <option value="">— Prof —</option>
                ${(teachers||[]).map(t => `<option value="${t.id}" ${t.id===cs.teacher_id?'selected':''}>${t.last_name} ${t.first_name}</option>`).join('')}
            </select>`;
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;background:#fff;flex-wrap:wrap;">
                <div style="font-weight:600;color:#1f2937;"><i class="fas fa-book" style="color:#6d28d9;"></i> ${cs.subjects?.name || 'Matière'}</div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="font-size:.72rem;color:#6b7280;font-weight:600;">Coef</span>
                    <input type="number" min="1" max="20" value="${cs.coefficient || 1}"
                        onchange="updateMatiereCoef('${cs.id}', this)"
                        title="Coefficient de la matière dans le calcul du bulletin"
                        style="width:54px;padding:5px 6px;border:1px solid #d1d5db;border-radius:6px;text-align:center;font-weight:600;background:#fff;color:#1f2937;">
                    ${teacherSelect}
                    <button onclick="retirerMatiere('${cs.id}','${classeId}')" title="Retirer" style="border:none;background:none;color:#ef4444;cursor:pointer;"><i class="fas fa-times"></i></button>
                </div>
            </div>`;
        }).join('') : '<div style="color:#9ca3af;text-align:center;padding:16px;">Aucune matière assignée à cette classe.</div>';

        // Formulaire d'ajout
        const usedIds = new Set((existing || []).map(e => e.subject_id));
        const availSubjects = (subjects || []).filter(s => !usedIds.has(s.id));
        const addForm = `
            <div style="border-top:1px dashed #e5e7eb;padding-top:12px;margin-top:8px;">
                <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;">
                    <div style="flex:1;min-width:140px;">
                        <label style="font-size:.8rem;color:#374151;font-weight:600;">Matière</label>
                        <select id="newMatiereSubject" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#1f2937;">
                            ${availSubjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('') || '<option value="">Toutes assignées</option>'}
                        </select>
                    </div>
                    <div style="width:76px;">
                        <label style="font-size:.8rem;color:#374151;font-weight:600;" title="Coefficient au bulletin">Coef</label>
                        <input type="number" id="newMatiereCoef" value="1" min="1" max="20"
                            style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#1f2937;text-align:center;font-weight:600;">
                    </div>
                    <div style="flex:1;min-width:140px;">
                        <label style="font-size:.8rem;color:#374151;font-weight:600;">Professeur</label>
                        <select id="newMatiereTeacher" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#1f2937;">
                            <option value="">— Optionnel —</option>
                            ${(teachers||[]).map(t => `<option value="${t.id}">${t.last_name} ${t.first_name}</option>`).join('')}
                        </select>
                    </div>
                    <button onclick="ajouterMatiere('${classeId}')" class="btn btn-primary" style="background:#5D4037;padding:8px 14px;border:none;border-radius:6px;color:#fff;cursor:pointer;">
                        <i class="fas fa-plus"></i> Ajouter
                    </button>
                </div>
            </div>`;

        host.innerHTML = banner + existingHtml + addForm;
    } catch (e) {
        console.error('❌ renderClasseMatieres:', e);
        host.innerHTML = '<div style="color:#ef4444;padding:16px;">Erreur de chargement</div>';
    }
}

window.ajouterMatiere = async function(classeId) {
    const subjectId = document.getElementById('newMatiereSubject')?.value;
    const teacherId = document.getElementById('newMatiereTeacher')?.value || null;
    const coefficient = Math.min(20, Math.max(1, parseInt(document.getElementById('newMatiereCoef')?.value) || 1));
    if (!subjectId) { showToast('Choisissez une matière', 'error'); return; }
    try {
        const { error } = await supabaseClient.from('class_subjects')
            .insert([{ class_id: classeId, subject_id: subjectId, teacher_id: teacherId, coefficient: coefficient }]);
        if (error) throw error;
        showToast('Matière ajoutée', 'success');
        await renderClasseMatieres(classeId);
    } catch (e) {
        showToast('Erreur : ' + (e.message || 'réessayez'), 'error');
    }
};

window.updateMatiereTeacher = async function(csId, teacherId, classeId) {
    try {
        const { error } = await supabaseClient.from('class_subjects')
            .update({ teacher_id: teacherId || null }).eq('id', csId);
        if (error) throw error;
        showToast('Professeur mis à jour', 'success');
    } catch (e) {
        showToast('Erreur : ' + (e.message || 'réessayez'), 'error');
    }
};

window.retirerMatiere = async function(csId, classeId) {
    if (!confirm('Retirer cette matière de la classe ?')) return;
    try {
        const { error } = await supabaseClient.from('class_subjects').delete().eq('id', csId);
        if (error) throw error;
        showToast('Matière retirée', 'success');
        await renderClasseMatieres(classeId);
    } catch (e) {
        showToast('Erreur : ' + (e.message || 'réessayez'), 'error');
    }
};

// Exposition
window.loadEnseignants = loadEnseignants;
window.saveTeacher = saveTeacher;

// ─────────────────────────────────────────────────────────────
// CHOIX DU RÔLE à la création/édition
// ─────────────────────────────────────────────────────────────
window.onTeacherRoleChange = async function() {
    const role = document.getElementById('teacherRole')?.value;
    const principalWrap = document.getElementById('teacherPrincipalWrap');
    const matieresWrap = document.getElementById('teacherMatieresWrap');
    if (principalWrap) principalWrap.style.display = role === 'principal' ? 'block' : 'none';
    if (matieresWrap) matieresWrap.style.display = role === 'matieres' ? 'block' : 'none';

    if (role === 'principal') {
        await loadClassesForTeacherRole('principal');
    } else if (role === 'matieres') {
        await loadMatieresForTeacherSelect();
        await loadClassesForTeacherRole('secondary');
    }
};

// Charge les classes selon le rôle (principal = Jardin-6e, secondary = 7e-9e)
async function loadClassesForTeacherRole(mode) {
    try {
        const { data: classes } = await supabaseClient.from('classes').select('id, nom, niveau').order('nom');
        const levels = mode === 'principal' ? PRIMARY_LEVELS : SECONDARY_LEVELS;
        const filtered = (classes || []).filter(c => levels.includes(c.niveau));

        if (mode === 'principal') {
            const sel = document.getElementById('teacherPrincipalClass');
            if (sel) {
                sel.innerHTML = '<option value="">— Choisir une classe (Jardin à 6e) —</option>' +
                    filtered.map(c => `<option value="${c.id}">${c.nom} (${NIVEAU_LABELS[c.niveau] || c.niveau})</option>`).join('');
            }
        } else {
            const sel = document.getElementById('teacherSecondaryClasses');
            if (sel) {
                sel.innerHTML = filtered.map(c => `<option value="${c.id}">${c.nom} (${NIVEAU_LABELS[c.niveau] || c.niveau})</option>`).join('')
                    || '<option value="" disabled>Aucune classe 7e-9e</option>';
            }
        }
    } catch (e) { console.warn('Chargement classes rôle:', e); }
}
window.loadClassesForTeacherRole = loadClassesForTeacherRole;


// ============================================================
// SECTION RAPPORTS — génération de rapports avec données réelles
// ============================================================

function _rapportModalShow(titre, contenuHtml) {
    let modal = document.getElementById('rapportResultModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'rapportResultModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:780px;">
                <div class="modal-header" style="background:linear-gradient(135deg,#5D4037,#6D4C41);">
                    <h3 style="color:#fff;" id="rapportResultTitle"></h3>
                    <button class="modal-close" onclick="closeModal('rapportResultModal')" style="color:#fff;">&times;</button>
                </div>
                <div class="modal-body" id="rapportResultBody" style="max-height:65vh;overflow-y:auto;"></div>
                <div class="modal-footer" style="padding:14px 20px;border-top:1px solid #e5e7eb;display:flex;gap:10px;justify-content:flex-end;">
                    <button class="btn btn-secondary" onclick="closeModal('rapportResultModal')">Fermer</button>
                    <button class="btn btn-primary" style="background:#5D4037;" onclick="imprimerRapport()"><i class="fas fa-print"></i> Imprimer</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }
    document.getElementById('rapportResultTitle').textContent = titre;
    document.getElementById('rapportResultBody').innerHTML = contenuHtml;
    window._dernierRapport = { titre, html: contenuHtml };
    openModal('rapportResultModal');
}

function _loading(msg) {
    return `<div style="text-align:center;padding:40px;color:#999;"><i class="fas fa-spinner fa-spin" style="font-size:1.6rem;"></i><p style="margin-top:10px;">${msg || 'Génération...'}</p></div>`;
}

const _NIV = { jardin:'Jardin','1ere':'1ère A.','2eme':'2ème A.','3eme':'3ème A.','4eme':'4ème A.','5eme':'5ème A.','6eme':'6ème A.','7eme':'7ème A.','8eme':'8ème A.','9eme':'9ème A.' };
const _fcfa = n => (parseInt(n)||0).toLocaleString('fr-FR') + ' FCFA';

window.generateReport = async function(type) {
    const titres = {
        effectifs: 'Rapport des Effectifs', financier: 'Rapport Financier',
        scolaire: 'Rapport Scolaire', presence: 'Rapport de Présence',
        annuel: 'Rapport Annuel'
    };
    _rapportModalShow(titres[type] || 'Rapport', _loading());
    try {
        let html = '';
        if (type === 'effectifs')      html = await _rapportEffectifs();
        else if (type === 'financier') html = await _rapportFinancier();
        else if (type === 'presence')  html = await _rapportPresence();
        else if (type === 'scolaire')  html = await _rapportScolaire();
        else if (type === 'annuel')    html = await _rapportAnnuel();
        else html = '<p>Type de rapport inconnu.</p>';
        document.getElementById('rapportResultBody').innerHTML = html;
        window._dernierRapport.html = html;
    } catch (e) {
        console.error('❌ Rapport:', e);
        document.getElementById('rapportResultBody').innerHTML = '<p style="color:#ef4444;text-align:center;padding:20px;">Erreur lors de la génération du rapport.</p>';
    }
};

// En-tête commun imprimable
function _enteteRapport(sousTitre) {
    return `<div style="text-align:center;margin-bottom:18px;border-bottom:2px solid #5D4037;padding-bottom:12px;">
        <h2 style="margin:0;color:#5D4037;">École Privée Moussa Koné</h2>
        <div style="color:#6b7280;font-size:.85rem;">Sébénicoro-Sibiribougou, Bamako · Année 2026-2027</div>
        <h3 style="margin:8px 0 0;color:#374151;">${sousTitre}</h3>
        <div style="color:#9ca3af;font-size:.8rem;">Généré le ${new Date().toLocaleDateString('fr-FR')}</div>
    </div>`;
}

// ── EFFECTIFS ────────────────────────────────────────────────
async function _rapportEffectifs() {
    const { data: classes } = await supabaseClient.from('classes').select('id, nom, niveau, capacite').order('nom');
    const { data: students } = await supabaseClient.from('students').select('class_id, gender, status');
    const actifs = (students || []).filter(s => s.status === 'actif' || !s.status);

    let totalG = 0, totalF = 0;
    const rows = (classes || []).map(c => {
        const elevesClasse = actifs.filter(s => s.class_id === c.id);
        const g = elevesClasse.filter(s => s.gender === 'M').length;
        const f = elevesClasse.filter(s => s.gender === 'F').length;
        totalG += g; totalF += f;
        const total = elevesClasse.length;
        const taux = c.capacite ? Math.round(total / c.capacite * 100) : 0;
        return `<tr>
            <td>${c.nom}</td><td>${_NIV[c.niveau] || c.niveau}</td>
            <td style="text-align:center;">${g}</td><td style="text-align:center;">${f}</td>
            <td style="text-align:center;font-weight:700;">${total}</td>
            <td style="text-align:center;">${c.capacite || '-'}</td>
            <td style="text-align:center;color:${taux>=100?'#dc2626':taux>=80?'#d97706':'#059669'};">${taux}%</td>
        </tr>`;
    }).join('');

    const totalEleves = actifs.length;
    return _enteteRapport('Effectifs par classe') + `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
            <div style="background:#eef2ff;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:1.6rem;font-weight:700;color:#4f46e5;">${totalEleves}</div><div style="font-size:.78rem;color:#6b7280;">Élèves inscrits</div></div>
            <div style="background:#eff6ff;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:1.6rem;font-weight:700;color:#2563eb;">${totalG}</div><div style="font-size:.78rem;color:#6b7280;">Garçons</div></div>
            <div style="background:#fdf2f8;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:1.6rem;font-weight:700;color:#db2777;">${totalF}</div><div style="font-size:.78rem;color:#6b7280;">Filles</div></div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:.86rem;">
            <thead><tr style="background:#f3f4f6;">
                <th style="padding:8px;text-align:left;">Classe</th><th style="padding:8px;">Niveau</th>
                <th style="padding:8px;">G</th><th style="padding:8px;">F</th><th style="padding:8px;">Total</th>
                <th style="padding:8px;">Capacité</th><th style="padding:8px;">Remplissage</th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:20px;color:#999;">Aucune classe</td></tr>'}</tbody>
        </table>`;
}

// ── FINANCIER ────────────────────────────────────────────────
async function _rapportFinancier() {
    const { data: payments } = await supabaseClient.from('payments').select('amount, type, date');
    const pays = payments || [];
    const total = pays.reduce((s, p) => s + (parseInt(p.amount)||0), 0);

    // Par type
    const parType = {};
    pays.forEach(p => { parType[p.type || 'autre'] = (parType[p.type || 'autre'] || 0) + (parseInt(p.amount)||0); });
    const typeRows = Object.entries(parType).map(([t, m]) =>
        `<tr><td style="text-transform:capitalize;">${t}</td><td style="text-align:right;font-weight:600;">${_fcfa(m)}</td><td style="text-align:right;">${Math.round(m/total*100)||0}%</td></tr>`).join('');

    // Par mois (6 derniers)
    const parMois = {};
    pays.forEach(p => {
        if (!p.date) return;
        const m = new Date(p.date).toLocaleDateString('fr-FR', { month:'short', year:'2-digit' });
        parMois[m] = (parMois[m] || 0) + (parseInt(p.amount)||0);
    });
    const moisRows = Object.entries(parMois).slice(-6).map(([m, v]) =>
        `<tr><td>${m}</td><td style="text-align:right;font-weight:600;">${_fcfa(v)}</td></tr>`).join('');

    return _enteteRapport('Bilan financier') + `
        <div style="background:#ecfdf5;border-radius:10px;padding:18px;text-align:center;margin-bottom:16px;">
            <div style="font-size:.85rem;color:#065f46;">Total encaissé</div>
            <div style="font-size:2rem;font-weight:700;color:#059669;">${_fcfa(total)}</div>
            <div style="font-size:.8rem;color:#6b7280;">${pays.length} paiement(s)</div>
        </div>
        <h4 style="color:#374151;margin:14px 0 8px;">Répartition par type</h4>
        <table style="width:100%;border-collapse:collapse;font-size:.86rem;margin-bottom:16px;">
            <thead><tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;">Type</th><th style="padding:8px;text-align:right;">Montant</th><th style="padding:8px;text-align:right;">Part</th></tr></thead>
            <tbody>${typeRows || '<tr><td colspan="3" style="text-align:center;padding:16px;color:#999;">Aucun paiement</td></tr>'}</tbody>
        </table>
        <h4 style="color:#374151;margin:14px 0 8px;">Encaissements par mois</h4>
        <table style="width:100%;border-collapse:collapse;font-size:.86rem;">
            <thead><tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;">Mois</th><th style="padding:8px;text-align:right;">Montant</th></tr></thead>
            <tbody>${moisRows || '<tr><td colspan="2" style="text-align:center;padding:16px;color:#999;">Aucune donnée</td></tr>'}</tbody>
        </table>`;
}

// ── PRÉSENCE ─────────────────────────────────────────────────
async function _rapportPresence() {
    const { data: presences } = await supabaseClient.from('presences').select('status, class_id');
    const pres = presences || [];
    const total = pres.length;
    const present = pres.filter(p => p.status === 'present').length;
    const absent = pres.filter(p => p.status === 'absent').length;
    const retard = pres.filter(p => p.status === 'late').length;
    const taux = total ? Math.round(present / total * 100) : 0;

    const { data: classes } = await supabaseClient.from('classes').select('id, nom');
    const cmap = {}; (classes||[]).forEach(c => cmap[c.id] = c.nom);
    const parClasse = {};
    pres.forEach(p => {
        const k = p.class_id || 'inconnu';
        parClasse[k] = parClasse[k] || { t:0, pr:0 };
        parClasse[k].t++; if (p.status === 'present') parClasse[k].pr++;
    });
    const rows = Object.entries(parClasse).map(([cid, v]) =>
        `<tr><td>${cmap[cid] || '—'}</td><td style="text-align:center;">${v.t}</td><td style="text-align:center;color:#059669;font-weight:600;">${Math.round(v.pr/v.t*100)||0}%</td></tr>`).join('');

    return _enteteRapport('Assiduité') + `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
            <div style="background:#ecfdf5;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:1.4rem;font-weight:700;color:#059669;">${taux}%</div><div style="font-size:.72rem;color:#6b7280;">Présence</div></div>
            <div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:1.4rem;font-weight:700;color:#16a34a;">${present}</div><div style="font-size:.72rem;color:#6b7280;">Présents</div></div>
            <div style="background:#fef2f2;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:1.4rem;font-weight:700;color:#dc2626;">${absent}</div><div style="font-size:.72rem;color:#6b7280;">Absents</div></div>
            <div style="background:#fffbeb;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:1.4rem;font-weight:700;color:#d97706;">${retard}</div><div style="font-size:.72rem;color:#6b7280;">Retards</div></div>
        </div>
        <h4 style="color:#374151;margin:14px 0 8px;">Taux de présence par classe</h4>
        <table style="width:100%;border-collapse:collapse;font-size:.86rem;">
            <thead><tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;">Classe</th><th style="padding:8px;">Relevés</th><th style="padding:8px;">Taux présence</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3" style="text-align:center;padding:16px;color:#999;">Aucune donnée de présence</td></tr>'}</tbody>
        </table>`;
}

// ── SCOLAIRE ─────────────────────────────────────────────────
async function _rapportScolaire() {
    const { data: notes } = await supabaseClient.from('notes').select('valeur, note, class_id, student_id');
    const ns = notes || [];
    // Le champ de note peut s'appeler "valeur" ou "note"
    const val = n => parseFloat(n.valeur ?? n.note ?? NaN);
    const valides = ns.filter(n => !isNaN(val(n)));

    const { data: classes } = await supabaseClient.from('classes').select('id, nom');
    const cmap = {}; (classes||[]).forEach(c => cmap[c.id] = c.nom);

    const parClasse = {};
    valides.forEach(n => {
        const k = n.class_id || 'inconnu';
        parClasse[k] = parClasse[k] || [];
        parClasse[k].push(val(n));
    });
    const rows = Object.entries(parClasse).map(([cid, arr]) => {
        const moy = arr.reduce((s,x)=>s+x,0) / arr.length;
        const reussite = arr.filter(x => x >= 10).length / arr.length * 100;
        return `<tr><td>${cmap[cid] || '—'}</td><td style="text-align:center;">${arr.length}</td>
            <td style="text-align:center;font-weight:700;color:${moy>=10?'#059669':'#dc2626'};">${moy.toFixed(2)}/20</td>
            <td style="text-align:center;">${Math.round(reussite)}%</td></tr>`;
    }).join('');

    const moyGen = valides.length ? (valides.reduce((s,n)=>s+val(n),0)/valides.length).toFixed(2) : '—';

    return _enteteRapport('Résultats scolaires') + `
        <div style="background:#eff6ff;border-radius:10px;padding:18px;text-align:center;margin-bottom:16px;">
            <div style="font-size:.85rem;color:#1e40af;">Moyenne générale de l'établissement</div>
            <div style="font-size:2rem;font-weight:700;color:#2563eb;">${moyGen}/20</div>
            <div style="font-size:.8rem;color:#6b7280;">${valides.length} note(s) analysée(s)</div>
        </div>
        <h4 style="color:#374151;margin:14px 0 8px;">Moyenne par classe</h4>
        <table style="width:100%;border-collapse:collapse;font-size:.86rem;">
            <thead><tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;">Classe</th><th style="padding:8px;">Notes</th><th style="padding:8px;">Moyenne</th><th style="padding:8px;">Réussite</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:16px;color:#999;">Aucune note enregistrée</td></tr>'}</tbody>
        </table>`;
}

// ── ANNUEL (synthèse) ────────────────────────────────────────
async function _rapportAnnuel() {
    const [eff, fin] = await Promise.all([_rapportEffectifs(), _rapportFinancier()]);
    // On combine effectifs + financier en un bilan
    return _enteteRapport('Bilan annuel ' + anneeDocument()) +
        '<div style="margin-bottom:24px;">' + eff.replace(/<div style="text-align:center;margin-bottom:18px;[^]*?<\/div>\s*<\/div>/, '') + '</div>' +
        '<div>' + fin.replace(/<div style="text-align:center;margin-bottom:18px;[^]*?<\/div>\s*<\/div>/, '') + '</div>';
}

// ── IMPRESSION ───────────────────────────────────────────────
window.imprimerRapport = function() {
    if (!window._dernierRapport) return;
    const html =
        '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
        '<title>' + window._dernierRapport.titre + '</title>' +
        '<style>body{font-family:Arial,sans-serif;padding:24px;color:#1f2937;}' +
        'table{width:100%;border-collapse:collapse;}' +
        'th,td{border:1px solid #e5e7eb;padding:6px;}th{background:#f3f4f6;}' +
        '@media print{.no-print{display:none!important}}</style>' +
        '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},300);};</scr' + 'ipt>' +
        '</head><body>' + window._dernierRapport.html + '</body></html>';
    ouvrirImpression(html);
};

// ── EXPORT PERSONNALISÉ (CSV) ────────────────────────────────
window.exportCustomData = async function() {
    const choix = prompt('Que voulez-vous exporter en CSV ?\n\n1 = Élèves\n2 = Paiements\n3 = Enseignants\n\nTapez 1, 2 ou 3 :');
    if (!choix) return;
    try {
        let rows = [], filename = 'export.csv';
        if (choix.trim() === '1') {
            const { data } = await supabaseClient.from('students').select('matricule, first_name, last_name, gender, class_id, status');
            const { data: cls } = await supabaseClient.from('classes').select('id, nom');
            const cmap = {}; (cls||[]).forEach(c => cmap[c.id]=c.nom);
            rows = [['Matricule','Prénom','Nom','Genre','Classe','Statut']]
                .concat((data||[]).map(s => [s.matricule, s.first_name, s.last_name, s.gender, cmap[s.class_id]||'', s.status]));
            filename = 'eleves.csv';
        } else if (choix.trim() === '2') {
            const { data } = await supabaseClient.from('payments').select('date, type, amount, payment_method');
            rows = [['Date','Type','Montant','Méthode']]
                .concat((data||[]).map(p => [p.date, p.type, p.amount, p.payment_method]));
            filename = 'paiements.csv';
        } else if (choix.trim() === '3') {
            const { data } = await supabaseClient.from('teachers').select('last_name, first_name, email, phone, qualification');
            rows = [['Nom','Prénom','Email','Téléphone','Qualification']]
                .concat((data||[]).map(t => [t.last_name, t.first_name, t.email, t.phone, t.qualification]));
            filename = 'enseignants.csv';
        } else { showToast('Choix invalide', 'error'); return; }

        const csv = rows.map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        showToast('Export CSV téléchargé', 'success');
    } catch (e) {
        console.error('❌ Export:', e);
        showToast('Erreur lors de l\'export', 'error');
    }
};


// ============================================================
// PASSAGE D'ANNÉE — promotion des élèves en fin d'année
// Logique linéaire : jardin→1ere→2eme→...→9eme
// L'élève n'est PAS réinscrit : on change seulement sa classe.
// ============================================================

const _NIVEAU_ORDRE = ['jardin','1ere','2eme','3eme','4eme','5eme','6eme','7eme','8eme','9eme'];
const _NIVEAU_LBL = { jardin:'Jardin','1ere':'1ère Année','2eme':'2ème Année','3eme':'3ème Année','4eme':'4ème Année','5eme':'5ème Année','6eme':'6ème Année','7eme':'7ème Année','8eme':'8ème Année','9eme':'9ème Année' };

// Niveau suivant dans la progression linéaire
function _niveauSuivant(niveau) {
    const i = _NIVEAU_ORDRE.indexOf(niveau);
    if (i === -1 || i === _NIVEAU_ORDRE.length - 1) return null; // 9ème = sortant
    return _NIVEAU_ORDRE[i + 1];
}

// Extraire le suffixe de classe (A, B, C...) depuis le nom
function _suffixeClasse(nom) {
    const m = (nom || '').match(/\b([A-Z])\s*$/);
    return m ? m[1] : '';
}

// Ouvrir l'assistant de passage d'année
window.ouvrirPassageAnnee = async function() {
    let modal = document.getElementById('passageAnneeModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'passageAnneeModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:820px;">
                <div class="modal-header" style="background:linear-gradient(135deg,#7c3aed,#a78bfa);">
                    <h3 style="color:#fff;"><i class="fas fa-arrow-up-right-dots"></i> Passage à l'année suivante</h3>
                    <button class="modal-close" onclick="closeModal('passageAnneeModal')" style="color:#fff;">&times;</button>
                </div>
                <div class="modal-body" id="passageAnneeBody" style="max-height:70vh;overflow-y:auto;"></div>
            </div>`;
        document.body.appendChild(modal);
    }
    document.getElementById('passageAnneeBody').innerHTML = '<div style="text-align:center;padding:40px;color:#999;"><i class="fas fa-spinner fa-spin" style="font-size:1.6rem;"></i></div>';
    openModal('passageAnneeModal');
    await _renderPassageClasses();
};

// Lit la destination choisie dans le menu de la ligne, puis ouvre le traitement
window._traiterPassage = function(classeId, classeNom, niveau) {
    const sel = document.getElementById('destSel_' + classeId);
    if (!sel || !sel.value) { showToast('Choisissez une classe de destination', 'error'); return; }
    const destNom = (sel.options[sel.selectedIndex]?.text || '').replace(/'/g, '');
    ouvrirPassageEleves(classeId, sel.value, classeNom, destNom, niveau);
};

async function _renderPassageClasses() {
    const host = document.getElementById('passageAnneeBody');
    try {
        const { data: classes } = await supabaseClient.from('classes').select('id, nom, niveau').order('nom');
        const { data: students } = await supabaseClient.from('students')
            .select('id, first_name, last_name, matricule, class_id, status');
        const actifs = (students || []).filter(s => s.status === 'actif' || !s.status);

        // Compter les élèves par classe
        const effectif = {};
        actifs.forEach(s => { if (s.class_id) effectif[s.class_id] = (effectif[s.class_id]||0)+1; });

        // Classes disponibles par niveau (pour proposer les destinations)
        const classesParNiveau = {};
        (classes || []).forEach(c => {
            (classesParNiveau[c.niveau] = classesParNiveau[c.niveau] || []).push(c);
        });

        const rows = (classes || []).map(c => {
            const nivSuiv = _niveauSuivant(c.niveau);
            const suffixe = _suffixeClasse(c.nom);
            const nb = effectif[c.id] || 0;
            const nomEsc = (c.nom || '').replace(/'/g, '');

            let destCell, actionCell;
            if (!nivSuiv) {
                // 9ème : fin de cycle
                destCell = '<span style="color:#6d28d9;">Sortants (fin de cycle)</span>';
                actionCell = nb > 0
                    ? `<button class="btn btn-sm btn-primary" style="background:#7c3aed;" onclick="ouvrirPassageEleves('${c.id}', '', '${nomEsc}', 'Sortants', '${c.niveau}')">Traiter</button>`
                    : '<span style="color:#d1d5db;">—</span>';
            } else {
                const candidates = classesParNiveau[nivSuiv] || [];
                if (!candidates.length) {
                    // Aucune classe au niveau suivant : on guide, on ne devine pas
                    destCell = `<span style="color:#f59e0b;"><i class="fas fa-triangle-exclamation"></i> Aucune classe « ${_NIVEAU_LBL[nivSuiv]} » — créez-la d'abord dans la section Classes</span>`;
                    actionCell = nb > 0
                        ? `<span style="color:#d1d5db;cursor:not-allowed;" title="Créez d'abord une classe de niveau ${_NIVEAU_LBL[nivSuiv]}"><i class="fas fa-lock"></i></span>`
                        : '<span style="color:#d1d5db;">—</span>';
                } else {
                    // Présélection : même suffixe (A→A), sinon classe unique, sinon la première
                    const parSuffixe = candidates.find(k => _suffixeClasse(k.nom) === suffixe);
                    const preselect = parSuffixe || (candidates.length === 1 ? candidates[0] : candidates[0]);
                    destCell = `<select id="destSel_${c.id}" style="padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#1f2937;max-width:200px;">
                        ${candidates.map(k => `<option value="${k.id}" ${k.id === preselect.id ? 'selected' : ''}>${k.nom}</option>`).join('')}
                    </select>`;
                    actionCell = nb > 0
                        ? `<button class="btn btn-sm btn-primary" style="background:#7c3aed;" onclick="_traiterPassage('${c.id}', '${nomEsc}', '${c.niveau}')">Traiter</button>`
                        : '<span style="color:#d1d5db;">—</span>';
                }
            }

            return `<tr>
                <td style="padding:10px;"><b>${c.nom}</b><br><span style="font-size:.78rem;color:#9ca3af;">${_NIVEAU_LBL[c.niveau]||c.niveau}</span></td>
                <td style="padding:10px;text-align:center;">${nb} élève(s)</td>
                <td style="padding:10px;"><i class="fas fa-arrow-right" style="color:#7c3aed;"></i> ${destCell}</td>
                <td style="padding:10px;text-align:center;">${actionCell}</td>
            </tr>`;
        }).join('');

        host.innerHTML = `
            <div style="background:#fef3c7;color:#92400e;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:.86rem;">
                <i class="fas fa-info-circle"></i> <b>Comment ça marche :</b> Les élèves ne sont pas réinscrits. Pour chaque classe, choisissez qui passe à la classe suivante, qui redouble, et qui est sortant. Le matricule et l'historique de chaque élève sont conservés.
            </div>
            <p style="font-size:.85rem;color:#6b7280;margin-bottom:10px;">Traitez chaque classe une par une :</p>
            <table style="width:100%;border-collapse:collapse;font-size:.88rem;">
                <thead><tr style="background:#f3f4f6;">
                    <th style="padding:10px;text-align:left;">Classe actuelle</th>
                    <th style="padding:10px;">Effectif</th>
                    <th style="padding:10px;text-align:left;">Destination (passage)</th>
                    <th style="padding:10px;">Action</th>
                </tr></thead>
                <tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:20px;color:#999;">Aucune classe</td></tr>'}</tbody>
            </table>`;
    } catch (e) {
        console.error('❌ Passage classes:', e);
        host.innerHTML = '<p style="color:#ef4444;text-align:center;padding:20px;">Erreur de chargement</p>';
    }
}

// Traiter les élèves d'une classe (passe / redouble / sortant)
window.ouvrirPassageEleves = async function(classeId, destId, classeNom, destNom, niveau) {
    const host = document.getElementById('passageAnneeBody');
    host.innerHTML = '<div style="text-align:center;padding:30px;color:#999;"><i class="fas fa-spinner fa-spin"></i></div>';
    try {
        const { data: students } = await supabaseClient.from('students')
            .select('id, first_name, last_name, matricule, status')
            .eq('class_id', classeId).order('last_name');
        const actifs = (students || []).filter(s => s.status === 'actif' || !s.status);

        const est9eme = niveau === '9eme';
        const estSortant = !destId;

        if (est9eme) {
            // 9ème année : DEF en DEUX PHASES
            // On lit les données DEF déjà saisies (numéro, résultat)
            let defData = {};
            try {
                const { data: full, error: defErr } = await supabaseClient.from('students')
                    .select('id, def_numero, def_resultat').eq('class_id', classeId);
                if (defErr) {
                    showToast('Erreur lecture DEF : ' + defErr.message + ' (avez-vous exécuté sql-def.sql ?)', 'error');
                }
                (full || []).forEach(s => defData[s.id] = s);
            } catch(e) { console.error('Relecture DEF:', e); }

            // Y a-t-il déjà des numéros saisis ? → on est en phase résultats
            const avecNumero = actifs.filter(s => defData[s.id]?.def_numero).length;
            const phaseResultats = avecNumero > 0;

            const rows = actifs.map(s => {
                const d = defData[s.id] || {};
                const num = d.def_numero || '';
                const res = d.def_resultat || '';
                if (phaseResultats) {
                    // PHASE 2 : résultats (numéro affiché en lecture, on coche admis/non admis)
                    return `<tr data-eleve="${s.id}">
                        <td style="padding:8px;"><b>${s.last_name} ${s.first_name}</b><br><span style="font-size:.76rem;color:#9ca3af;">${s.matricule||''}</span></td>
                        <td style="padding:8px;text-align:center;font-weight:600;color:#6d28d9;">${num || '<span style="color:#f59e0b;">non saisi</span>'}</td>
                        <td style="padding:8px;text-align:center;">
                            <select class="def-resultat" data-eleve="${s.id}" style="padding:6px;border:1px solid #d1d5db;border-radius:6px;background:#fff;">
                                <option value="">— Résultat —</option>
                                <option value="admis" ${res==='admis'?'selected':''}>Admis → lycée</option>
                                <option value="non_admis" ${res==='non_admis'?'selected':''}>Non admis → redouble</option>
                            </select>
                        </td>
                    </tr>`;
                }
                // PHASE 1 : saisie des numéros de place
                return `<tr data-eleve="${s.id}">
                    <td style="padding:8px;"><b>${s.last_name} ${s.first_name}</b><br><span style="font-size:.76rem;color:#9ca3af;">${s.matricule||''}</span></td>
                    <td style="padding:8px;text-align:center;">
                        <input type="text" class="def-numero" data-eleve="${s.id}" value="${num}" placeholder="N° de place" style="width:130px;padding:6px;border:1px solid #d1d5db;border-radius:6px;">
                    </td>
                </tr>`;
            }).join('');

            const banner = phaseResultats
                ? `<div style="background:#ede9fe;color:#6d28d9;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:.85rem;">
                     <i class="fas fa-landmark"></i> <b>Phase 2 — Proclamation des résultats.</b> Les numéros de place sont saisis. À la sortie des résultats officiels du gouvernement, cochez Admis ou Non admis pour chaque candidat.<br>
                     <b>Admis</b> → sortant (lycée). <b>Non admis</b> → redouble la 9ème.
                   </div>`
                : `<div style="background:#dbeafe;color:#1e40af;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:.85rem;">
                     <i class="fas fa-pen"></i> <b>Phase 1 — Inscription au DEF.</b> Saisissez le numéro de place attribué par le gouvernement à chaque candidat. Les résultats se saisiront plus tard, à la proclamation.
                   </div>`;

            const tableHead = phaseResultats
                ? '<th style="padding:8px;text-align:left;">Candidat</th><th style="padding:8px;">N° de place</th><th style="padding:8px;">Résultat DEF</th>'
                : '<th style="padding:8px;text-align:left;">Candidat</th><th style="padding:8px;">N° de place</th>';

            const actionBtn = phaseResultats
                ? `<button class="btn btn-primary" style="background:#6d28d9;" onclick="_appliquerDEF('${classeId}')"><i class="fas fa-check"></i> Enregistrer les résultats</button>`
                : `<button class="btn btn-primary" style="background:#2563eb;" onclick="_enregistrerNumerosDEF('${classeId}')"><i class="fas fa-save"></i> Enregistrer les numéros</button>`;

            host.innerHTML = `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
                    <button class="btn btn-sm btn-secondary" onclick="_renderPassageClasses()"><i class="fas fa-arrow-left"></i> Retour</button>
                    <h3 style="margin:0;color:#1f2937;">${classeNom} — DEF ${phaseResultats ? '(Résultats)' : '(Numéros)'}</h3>
                </div>
                ${banner}
                <table style="width:100%;border-collapse:collapse;font-size:.88rem;">
                    <thead><tr style="background:#f3f4f6;">${tableHead}</tr></thead>
                    <tbody>${rows || `<tr><td colspan="3" style="text-align:center;padding:20px;color:#999;">Aucun élève</td></tr>`}</tbody>
                </table>
                <div style="margin-top:18px;text-align:right;">
                    <button class="btn btn-secondary" onclick="_renderPassageClasses()">Annuler</button>
                    ${actionBtn}
                </div>`;
            return;
        }

        // Classes Jardin → 8ème : passage interne classique
        const rows = actifs.map(s => `
            <tr data-eleve="${s.id}">
                <td style="padding:8px;"><b>${s.last_name} ${s.first_name}</b><br><span style="font-size:.76rem;color:#9ca3af;">${s.matricule||''}</span></td>
                <td style="padding:8px;text-align:center;">
                    <select class="passage-choix" data-eleve="${s.id}" style="padding:6px;border:1px solid #d1d5db;border-radius:6px;background:#fff;">
                        ${estSortant
                            ? '<option value="sortant" selected>Sortant (fin de cycle)</option><option value="redouble">Redouble</option>'
                            : '<option value="passe" selected>Passe</option><option value="redouble">Redouble</option><option value="sortant">Sortant / Départ</option>'}
                    </select>
                </td>
            </tr>`).join('');

        host.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
                <button class="btn btn-sm btn-secondary" onclick="_renderPassageClasses()"><i class="fas fa-arrow-left"></i> Retour</button>
                <h3 style="margin:0;color:#1f2937;">${classeNom} <i class="fas fa-arrow-right" style="color:#7c3aed;font-size:.9rem;"></i> ${destNom}</h3>
            </div>
            <div style="margin-bottom:10px;display:flex;gap:8px;">
                <button class="btn btn-sm" style="background:#e8f5e9;color:#5D4037;" onclick="_passageToutSur('passe')">Tout : Passe</button>
                <button class="btn btn-sm" style="background:#fef3c7;color:#92400e;" onclick="_passageToutSur('redouble')">Tout : Redouble</button>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:.88rem;">
                <thead><tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;">Élève</th><th style="padding:8px;">Décision</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="2" style="text-align:center;padding:20px;color:#999;">Aucun élève actif</td></tr>'}</tbody>
            </table>
            <div style="margin-top:18px;text-align:right;">
                <button class="btn btn-secondary" onclick="_renderPassageClasses()">Annuler</button>
                <button class="btn btn-primary" style="background:#7c3aed;" onclick="_appliquerPassage('${classeId}','${destId}')">
                    <i class="fas fa-check"></i> Appliquer le passage
                </button>
            </div>`;
    } catch (e) {
        console.error('❌ Passage élèves:', e);
        host.innerHTML = '<p style="color:#ef4444;text-align:center;padding:20px;">Erreur de chargement</p>';
    }
};

// PHASE 1 : enregistrer les numéros de place
window._enregistrerNumerosDEF = async function(classeId) {
    const inputs = Array.from(document.querySelectorAll('.def-numero'));
    const data = inputs.map(inp => ({ eleveId: inp.getAttribute('data-eleve'), numero: inp.value.trim() }))
                       .filter(d => d.numero);
    if (!data.length) { showToast('Saisissez au moins un numéro de place', 'error'); return; }
    try {
        let ok = 0, err = 0;
        for (const d of data) {
            const { data: upd, error } = await supabaseClient.from('students')
                .update({ def_numero: d.numero, def_annee: (new Date().getFullYear()).toString() })
                .eq('id', d.eleveId).select('id, def_numero');
            if (error) { console.error('Écriture numéro DEF:', error.message); err++; }
            else { ok++; }
        }
        if (err && err === data.length) {
            showToast('Les colonnes DEF n\'existent pas encore. Exécutez sql-def.sql dans Supabase.', 'error');
            return;
        }
        showToast(`${ok} numéro(s) enregistré(s). Les résultats se saisiront à la proclamation.`, 'success');
        await ouvrirPassageEleves(classeId, '', '', '', '9eme'); // recharge → passe en phase résultats
    } catch (e) {
        console.error('❌ Numéros DEF:', e);
        showToast('Erreur lors de l\'enregistrement', 'error');
    }
};

// PHASE 2 : appliquer les résultats DEF
window._appliquerDEF = async function(classeId) {
    const lignes = Array.from(document.querySelectorAll('.def-resultat'));
    const data = lignes.map(sel => {
        const id = sel.getAttribute('data-eleve');
        return { eleveId: id, resultat: sel.value };
    });

    const nonSaisis = data.filter(d => !d.resultat).length;
    if (nonSaisis === data.length) { showToast('Saisissez au moins un résultat', 'error'); return; }

    const admis = data.filter(d => d.resultat === 'admis').length;
    const nonAdmis = data.filter(d => d.resultat === 'non_admis').length;

    if (!confirm(`Enregistrer les résultats du DEF ?\n\n• ${admis} admis → deviennent sortants (lycée)\n• ${nonAdmis} non admis → redoublent la 9ème\n${nonSaisis ? '• ' + nonSaisis + ' sans résultat (ignorés)\n' : ''}`)) return;

    try {
        let ok = 0, err = 0;
        for (const d of data) {
            if (!d.resultat) continue;
            const update = {};
            if (d.resultat === 'admis') {
                update.status = 'sortant';
            } else if (d.resultat === 'non_admis') {
                update.class_id = classeId; // redouble la 9ème (reste)
                update.status = 'actif';
            }
            // On enregistre UNIQUEMENT le résultat et l'année.
            // ⚠️ On ne touche PAS à def_numero (déjà saisi en phase 1) pour ne pas l'écraser.
            update.def_resultat = d.resultat;
            update.def_annee = (new Date().getFullYear()).toString();

            let { error } = await supabaseClient.from('students').update(update).eq('id', d.eleveId);
            if (error) {
                // Repli : si les colonnes def_* n'existent pas, réessayer sans elles
                const { def_resultat, def_annee, ...base } = update;
                const retry = await supabaseClient.from('students').update(base).eq('id', d.eleveId);
                if (retry.error) err++; else ok++;
            } else ok++;
        }
        showToast(`Résultats DEF enregistrés : ${ok} élève(s)${err ? ', ' + err + ' erreur(s)' : ''}.`, err ? 'warning' : 'success');
        await _renderPassageClasses();
        if (typeof loadClasses === 'function') loadClasses(true);
    } catch (e) {
        console.error('❌ Application DEF:', e);
        showToast('Erreur lors de l\'enregistrement', 'error');
    }
};

window._passageToutSur = function(valeur) {
    document.querySelectorAll('.passage-choix').forEach(sel => {
        if (Array.from(sel.options).some(o => o.value === valeur)) sel.value = valeur;
    });
};

window._appliquerPassage = async function(classeId, destId) {
    const choix = Array.from(document.querySelectorAll('.passage-choix'))
        .map(sel => ({ eleveId: sel.getAttribute('data-eleve'), decision: sel.value }));
    if (!choix.length) { showToast('Aucun élève à traiter', 'error'); return; }

    const nbPasse = choix.filter(c => c.decision === 'passe').length;
    const nbRedouble = choix.filter(c => c.decision === 'redouble').length;
    const nbSortant = choix.filter(c => c.decision === 'sortant').length;

    if (!confirm(`Confirmer le passage ?\n\n• ${nbPasse} élève(s) passent à la classe suivante\n• ${nbRedouble} redoublent\n• ${nbSortant} sortants\n\nCette action modifie la classe des élèves.`)) return;

    try {
        let ok = 0, err = 0;
        for (const c of choix) {
            let update = null;
            if (c.decision === 'passe' && destId) {
                update = { class_id: destId };
            } else if (c.decision === 'redouble') {
                update = { class_id: classeId }; // reste dans la même classe
            } else if (c.decision === 'sortant') {
                update = { status: 'sortant' }; // marqué sortant, n'apparaît plus dans les actifs
            }
            if (update) {
                const { error } = await supabaseClient.from('students').update(update).eq('id', c.eleveId);
                if (error) err++; else ok++;
            }
        }
        showToast(`Passage appliqué : ${ok} élève(s) traité(s)${err ? ', ' + err + ' erreur(s)' : ''}.`, err ? 'warning' : 'success');
        await _renderPassageClasses();
        // Rafraîchir les autres vues si elles existent
        if (typeof loadClasses === 'function') loadClasses(true);
    } catch (e) {
        console.error('❌ Application passage:', e);
        showToast('Erreur lors du passage', 'error');
    }
};

window._renderPassageClasses = _renderPassageClasses;


// ============================================================
// BARRE DE RECHERCHE GLOBALE (header)
// Recherche élèves, enseignants, classes + navigation au clic
// ============================================================
(function initGlobalSearch() {
    function attach() {
        const input = document.getElementById('globalSearch');
        if (!input) { setTimeout(attach, 500); return; }
        if (input._searchAttached) return;
        input._searchAttached = true;

        // Conteneur de résultats (dropdown)
        let box = document.getElementById('globalSearchResults');
        if (!box) {
            box = document.createElement('div');
            box.id = 'globalSearchResults';
            box.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);margin-top:6px;max-height:380px;overflow-y:auto;z-index:1000;display:none;';
            const container = input.closest('.search-container');
            if (container) { container.style.position = 'relative'; container.appendChild(box); }
        }

        let timer = null;
        input.addEventListener('input', function() {
            clearTimeout(timer);
            const q = this.value.trim();
            if (q.length < 2) { box.style.display = 'none'; return; }
            timer = setTimeout(() => doGlobalSearch(q, box), 300);
        });

        // Fermer en cliquant ailleurs
        document.addEventListener('click', e => {
            if (!e.target.closest('.search-container')) box.style.display = 'none';
        });
    }

    async function doGlobalSearch(q, box) {
        box.style.display = 'block';
        box.innerHTML = '<div style="padding:14px;text-align:center;color:#999;"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            const like = `%${q}%`;
            const [eleves, profs, classes] = await Promise.all([
                supabaseClient.from('students').select('id, first_name, last_name, matricule, class_id, birth_date')
                    .or(`first_name.ilike.${like},last_name.ilike.${like},matricule.ilike.${like}`).limit(6),
                supabaseClient.from('teachers').select('id, first_name, last_name, email')
                    .or(`first_name.ilike.${like},last_name.ilike.${like}`).limit(4),
                supabaseClient.from('classes').select('id, nom, niveau')
                    .ilike('nom', like).limit(4)
            ]);

            let html = '';
            const el = eleves.data || [], pr = profs.data || [], cl = classes.data || [];

            // Nom de la classe de chaque eleve trouve. `class_id` etait deja
            // charge mais jamais resolu : deux « Coulibaly » etaient donc
            // impossibles a distinguer avant d'ouvrir la fiche.
            // Requete separee : pas de jointure PostgREST (PGRST200).
            const nomsClasses = {};
            try {
                const ids = [...new Set(el.map(s => s.class_id).filter(Boolean))];
                if (ids.length) {
                    const { data: cls } = await supabaseClient
                        .from('classes').select('id, nom').in('id', ids);
                    (cls || []).forEach(c => { nomsClasses[c.id] = c.nom; });
                }
            } catch (e) { console.warn('Classes (recherche) :', e && e.message); }

            if (el.length) {
                html += `<div style="padding:8px 14px;font-size:.72rem;font-weight:700;color:#9ca3af;text-transform:uppercase;background:#f9fafb;">Élèves</div>`;
                html += el.map(s => {
                    const classe = nomsClasses[s.class_id];
                    return `<div class="gs-item" style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;border-bottom:1px solid #f3f4f6;" onclick="ouvrirDepuisRecherche('eleve','${s.id}')">
                    <span style="flex:1;min-width:0;">
                        <b>${s.last_name||''} ${s.first_name||''}</b>
                        <span style="display:block;font-size:.78rem;color:#9ca3af;">${s.matricule||'—'}${s.birth_date ? ` · né(e) le ${new Date(s.birth_date).toLocaleDateString('fr-FR')}` : ''}</span>
                    </span>
                    ${classe
                        ? `<span style="flex-shrink:0;font-size:.76rem;font-weight:600;color:#5D4037;background:#EFEBE9;padding:.2rem .55rem;border-radius:999px;white-space:nowrap;">${classe}</span>`
                        : `<span style="flex-shrink:0;font-size:.76rem;color:#B23B2E;" title="Aucune classe affectée">sans classe</span>`}
                    </div>`;
                }).join('');
            }
            if (pr.length) {
                html += `<div style="padding:8px 14px;font-size:.72rem;font-weight:700;color:#9ca3af;text-transform:uppercase;background:#f9fafb;">Enseignants</div>`;
                html += pr.map(t => `<div class="gs-item" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f3f4f6;" onclick="ouvrirDepuisRecherche('prof','${t.id}')">
                    <b>${t.last_name||''} ${t.first_name||''}</b>
                    <span style="display:block;font-size:.78rem;color:#9ca3af;">${t.email||'—'}</span></div>`).join('');
            }
            if (cl.length) {
                html += `<div style="padding:8px 14px;font-size:.72rem;font-weight:700;color:#9ca3af;text-transform:uppercase;background:#f9fafb;">Classes</div>`;
                html += cl.map(c => `<div class="gs-item" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f3f4f6;" onclick="ouvrirDepuisRecherche('classe','${c.id}')">
                    <b>${c.nom||''}</b>${c.niveau ? `<span style="display:block;font-size:.78rem;color:#9ca3af;">${c.niveau}</span>` : ''}</div>`).join('');
            }

            box.innerHTML = html || `<div style="padding:16px;text-align:center;color:#9ca3af;">Aucun résultat pour « ${q} »</div>`;

            // Effet hover
            box.querySelectorAll('.gs-item').forEach(it => {
                it.addEventListener('mouseenter', () => it.style.background = '#f9fafb');
                it.addEventListener('mouseleave', () => it.style.background = '#fff');
            });
        } catch (e) {
            console.error('Recherche globale:', e);
            box.innerHTML = '<div style="padding:14px;color:#ef4444;">Erreur de recherche</div>';
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();
})();


// ============================================================
// BOUTONS D'ACTIONS RAPIDES (tableau de bord)
// ============================================================
(function initQuickActions() {
    function attach() {
        const btns = document.querySelectorAll('.quick-action-btn[data-action]');
        if (!btns.length) { setTimeout(attach, 500); return; }
        btns.forEach(btn => {
            if (btn._qaAttached) return;
            btn._qaAttached = true;
            btn.style.cursor = 'pointer';
            btn.addEventListener('click', () => handleQuickAction(btn.getAttribute('data-action')));
        });
        // Bouton "admission" (data-type) du dashboard
        const adm = document.querySelector('.quick-actions-grid .add-option[data-type="admission"]');
        if (adm && !adm._qaAttached) {
            adm._qaAttached = true;
            adm.style.cursor = 'pointer';
            adm.addEventListener('click', () => loadPage('admissions'));
        }
    }

    function handleQuickAction(action) {
        switch (action) {
            case 'addGrade':       // Ajouter une note
                loadPage('notes');
                break;
            case 'addPayment':     // Enregistrer un paiement
                loadPage('paiements');
                setTimeout(() => { if (typeof openPaymentModal === 'function') openPaymentModal(); }, 400);
                break;
            case 'addAttendance':  // Faire l'appel / présence
                loadPage('presences');
                break;
            case 'generateReport': // Générer un rapport
                loadPage('rapports');
                break;
            case 'sendNotification': // Envoyer une annonce
                loadPage('annonces');
                break;
            default:
                console.warn('Action rapide inconnue:', action);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();
})();


// ============================================================
// SECTION EMPLOI DU TEMPS (admin)
// ============================================================

const EMPLOI_JOURS = { 1:'Lundi', 2:'Mardi', 3:'Mercredi', 4:'Jeudi', 5:'Vendredi', 6:'Samedi' };

// Chargement de la page : remplir le sélecteur de classes
async function loadEmploiPage() {
    try {
        const { data: classes } = await supabaseClient.from('classes').select('id, nom, niveau').order('nom');
        const sel = document.getElementById('emploiClasseSelect');
        if (sel) {
            sel.innerHTML = '<option value="">Choisir une classe...</option>' +
                (classes || []).map(c => `<option value="${c.id}">${c.nom}</option>`).join('');
        }
    } catch (e) {
        console.error('❌ loadEmploiPage:', e);
    }
}
window.loadEmploiPage = loadEmploiPage;

// Changement de classe → afficher son emploi du temps
window.onEmploiClasseChange = async function() {
    const classId = document.getElementById('emploiClasseSelect')?.value;
    const titre = document.getElementById('emploiTitre');
    const container = document.getElementById('emploiContainer');
    if (!classId) {
        if (titre) titre.textContent = 'Sélectionnez une classe pour voir son emploi du temps';
        if (container) container.innerHTML = '<div style="text-align:center;padding:60px;color:#9ca3af;"><i class="fas fa-calendar-alt" style="font-size:3rem;margin-bottom:20px;"></i><p>Veuillez sélectionner une classe</p></div>';
        return;
    }
    const sel = document.getElementById('emploiClasseSelect');
    const nomClasse = sel?.options[sel.selectedIndex]?.text || '';
    if (titre) titre.textContent = 'Emploi du temps — ' + nomClasse;
    await renderEmploiGrid(classId);
};

// Construire la grille de l'emploi du temps
async function renderEmploiGrid(classId) {
    const container = document.getElementById('emploiContainer');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;"><i class="fas fa-spinner fa-spin"></i></div>';
    try {
        const { data: cours } = await supabaseClient
            .from('emploi_du_temps')
            .select('id, jour, heure_debut, heure_fin, salle, subject_id, teacher_id')
            .eq('class_id', classId)
            .order('heure_debut');

        const list = cours || [];
        if (!list.length) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;"><i class="fas fa-calendar-plus" style="font-size:2rem;margin-bottom:14px;"></i><p>Aucun cours pour cette classe. Cliquez sur « Ajouter un cours ».</p></div>';
            return;
        }

        // Charger noms de matières et profs séparément (pas de FK → pas de jointure)
        const subjIds = [...new Set(list.map(c => c.subject_id).filter(Boolean))];
        const teachIds = [...new Set(list.map(c => c.teacher_id).filter(Boolean))];
        const subjMap = {}, teachMap = {};
        if (subjIds.length) {
            const { data: s } = await supabaseClient.from('subjects').select('id, name').in('id', subjIds);
            (s||[]).forEach(x => subjMap[x.id] = x.name);
        }
        if (teachIds.length) {
            const { data: t } = await supabaseClient.from('teachers').select('id, first_name, last_name').in('id', teachIds);
            (t||[]).forEach(x => teachMap[x.id] = `${x.last_name||''} ${x.first_name||''}`.trim());
        }

        // Organiser par jour
        const parJour = {1:[],2:[],3:[],4:[],5:[],6:[]};
        list.forEach(c => { if (parJour[c.jour]) parJour[c.jour].push(c); });

        // Grille : une colonne par jour
        let html = '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;min-width:760px;">';
        for (let j = 1; j <= 6; j++) {
            html += `<div>
                <div style="background:#5D4037;color:#fff;padding:8px;border-radius:8px 8px 0 0;text-align:center;font-weight:600;font-size:.88rem;">${EMPLOI_JOURS[j]}</div>
                <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;min-height:120px;padding:6px;">`;
            if (!parJour[j].length) {
                html += '<div style="color:#d1d5db;text-align:center;padding:14px;font-size:.8rem;">—</div>';
            } else {
                parJour[j].forEach(c => {
                    const prof = teachMap[c.teacher_id] || '';
                    html += `<div style="background:#f0f9f1;border-left:3px solid #5D4037;border-radius:6px;padding:8px;margin-bottom:6px;font-size:.8rem;">
                        <div style="font-weight:600;color:#5D4037;">${(c.heure_debut||'').slice(0,5)} - ${(c.heure_fin||'').slice(0,5)}</div>
                        <div style="color:#1f2937;font-weight:600;">${subjMap[c.subject_id] || 'Matière'}</div>
                        ${prof ? `<div style="color:#6b7280;font-size:.74rem;">${prof}</div>` : ''}
                        ${c.salle ? `<div style="color:#9ca3af;font-size:.74rem;"><i class="fas fa-door-open"></i> ${c.salle}</div>` : ''}
                        <div style="margin-top:4px;display:flex;gap:6px;">
                            <button onclick="editCours('${c.id}')" title="Modifier" style="border:none;background:none;color:#2563eb;cursor:pointer;padding:0;"><i class="fas fa-pen"></i></button>
                            <button onclick="deleteCours('${c.id}','${classId}')" title="Supprimer" style="border:none;background:none;color:#ef4444;cursor:pointer;padding:0;"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>`;
                });
            }
            html += '</div></div>';
        }
        html += '</div>';
        container.innerHTML = html;
    } catch (e) {
        console.error('❌ renderEmploiGrid:', e);
        container.innerHTML = '<div style="color:#ef4444;padding:20px;text-align:center;">Erreur de chargement. La table « emploi_du_temps » existe-t-elle ? Exécutez sql-emploi.sql.</div>';
    }
}
window.renderEmploiGrid = renderEmploiGrid;

// Ouvrir le modal d'ajout de cours
window.openAddCoursModal = async function() {
    const classId = document.getElementById('emploiClasseSelect')?.value;
    if (!classId) { showToast('Sélectionnez d\'abord une classe', 'error'); return; }

    const f = document.getElementById('coursForm');
    if (f) f.reset();
    document.getElementById('coursId').value = '';
    document.getElementById('coursModalTitle').textContent = 'Nouveau Cours';

    // Charger matières + profs
    await _remplirMatieresEtProfs(classId);
    openModal('coursModal');
};

async function _remplirMatieresEtProfs(classId) {
    const mSel = document.getElementById('coursMatiere');
    const pSel = document.getElementById('coursProfesseur');
    try {
        // 1) Assignations de CETTE classe (matière ↔ professeur)
        const { data: liens } = await supabaseClient.from('class_subjects')
            .select('subject_id, teacher_id').eq('class_id', classId);
        window._epmkEmploiLiens = liens || [];
        const subjIds  = [...new Set(window._epmkEmploiLiens.map(l => l.subject_id).filter(Boolean))];
        const teachIds = [...new Set(window._epmkEmploiLiens.map(l => l.teacher_id).filter(Boolean))];

        // 2) Matières : UNIQUEMENT celles assignées à la classe
        //    (repli : toutes, si aucune assignation n'existe encore)
        let subjects = [];
        if (subjIds.length) {
            ({ data: subjects } = await supabaseClient.from('subjects')
                .select('id, name').in('id', subjIds).order('name'));
        } else {
            ({ data: subjects } = await supabaseClient.from('subjects')
                .select('id, name').order('name'));
            showToast('Aucune matière assignée à cette classe — liste complète affichée. Assignez les matières dans la section « Matières ».', 'info');
        }

        // 3) Professeurs : ceux qui enseignent dans cette classe (repli : tous)
        let teachers = [];
        if (teachIds.length) {
            ({ data: teachers } = await supabaseClient.from('teachers')
                .select('id, first_name, last_name').in('id', teachIds).order('last_name'));
        } else {
            ({ data: teachers } = await supabaseClient.from('teachers')
                .select('id, first_name, last_name').order('last_name'));
        }
        window._epmkEmploiProfs = teachers || [];

        const optProf = t => `<option value="${t.id}">${t.last_name} ${t.first_name}</option>`;
        if (mSel) mSel.innerHTML = '<option value="">Choisir une matière...</option>' +
            (subjects||[]).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        if (pSel) pSel.innerHTML = '<option value="">Choisir un professeur...</option>' +
            window._epmkEmploiProfs.map(optProf).join('');

        // 4) Quand la matière change : ne proposer que ses professeurs,
        //    et pré-sélectionner automatiquement s'il n'y en a qu'un
        if (mSel && pSel) mSel.onchange = () => {
            const sid = mSel.value;
            let list = window._epmkEmploiProfs;
            if (sid) {
                const tIds = [...new Set(window._epmkEmploiLiens
                    .filter(l => String(l.subject_id) === String(sid))
                    .map(l => l.teacher_id).filter(Boolean))];
                if (tIds.length) list = window._epmkEmploiProfs.filter(t => tIds.includes(t.id));
            }
            const keep = pSel.value;
            pSel.innerHTML = '<option value="">Choisir un professeur...</option>' + list.map(optProf).join('');
            if (keep && list.some(t => String(t.id) === String(keep))) pSel.value = keep;
            else if (list.length === 1) pSel.value = list[0].id;
        };
    } catch (e) { console.warn('Matières/profs:', e); }
}

// Enregistrer un cours (création ou édition)
window.saveCours = async function(e) {
    if (e) e.preventDefault();
    const classId = document.getElementById('emploiClasseSelect')?.value;
    if (!classId) { showToast('Sélectionnez une classe', 'error'); return; }

    const coursId = document.getElementById('coursId')?.value || null;
    const data = {
        class_id: classId,
        jour: parseInt(document.getElementById('coursJour')?.value),
        heure_debut: document.getElementById('coursHeureDebut')?.value,
        heure_fin: document.getElementById('coursHeureFin')?.value,
        salle: document.getElementById('coursSalle')?.value?.trim() || null,
        subject_id: document.getElementById('coursMatiere')?.value || null,
        teacher_id: document.getElementById('coursProfesseur')?.value || null
    };

    if (!data.jour || !data.heure_debut || !data.heure_fin || !data.subject_id) {
        showToast('Jour, heures et matière sont obligatoires', 'error'); return;
    }
    if (data.heure_fin <= data.heure_debut) {
        showToast('L\'heure de fin doit être après l\'heure de début', 'error'); return;
    }

    try {
        if (coursId) {
            const { error } = await supabaseClient.from('emploi_du_temps').update(data).eq('id', coursId);
            if (error) throw error;
            showToast('Cours modifié', 'success');
        } else {
            const { error } = await supabaseClient.from('emploi_du_temps').insert([data]);
            if (error) throw error;
            showToast('Cours ajouté', 'success');
        }
        closeModal('coursModal');
        await renderEmploiGrid(classId);
    } catch (e) {
        console.error('❌ saveCours:', e);
        showToast('Erreur : ' + (e.message || 'réessayez'), 'error');
    }
};

// Éditer un cours
window.editCours = async function(coursId) {
    try {
        const { data: c } = await supabaseClient.from('emploi_du_temps').select('*').eq('id', coursId).single();
        if (!c) { showToast('Cours introuvable', 'error'); return; }
        await _remplirMatieresEtProfs(c.class_id);
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v ?? ''); };
        setVal('coursId', c.id);
        setVal('coursJour', c.jour);
        setVal('coursHeureDebut', (c.heure_debut||'').slice(0,5));
        setVal('coursHeureFin', (c.heure_fin||'').slice(0,5));
        setVal('coursSalle', c.salle);
       setVal('coursMatiere', c.subject_id);
        // Matière non/plus assignée à la classe : on l'ajoute quand même pour l'édition
        const mSelEdit = document.getElementById('coursMatiere');
        if (mSelEdit && c.subject_id && mSelEdit.value !== String(c.subject_id)) {
            const { data: s } = await supabaseClient.from('subjects').select('name').eq('id', c.subject_id).maybeSingle();
            mSelEdit.insertAdjacentHTML('beforeend', `<option value="${c.subject_id}">${s?.name || 'Matière'} (non assignée)</option>`);
            mSelEdit.value = c.subject_id;
        }
        setVal('coursProfesseur', c.teacher_id);
        const pSelEdit = document.getElementById('coursProfesseur');
        if (pSelEdit && c.teacher_id && pSelEdit.value !== String(c.teacher_id)) {
            const { data: t } = await supabaseClient.from('teachers').select('first_name, last_name').eq('id', c.teacher_id).maybeSingle();
            pSelEdit.insertAdjacentHTML('beforeend', `<option value="${c.teacher_id}">${t ? (t.last_name + ' ' + t.first_name) : 'Professeur'} (non assigné)</option>`);
            pSelEdit.value = c.teacher_id;
        }
        document.getElementById('coursModalTitle').textContent = 'Modifier le Cours';
        openModal('coursModal');
    } catch (e) {
        console.error('❌ editCours:', e);
        showToast('Erreur lors du chargement', 'error');
    }
};

// Supprimer un cours
window.deleteCours = async function(coursId, classId) {
    if (!confirm('Supprimer ce cours de l\'emploi du temps ?')) return;
    try {
        const { error } = await supabaseClient.from('emploi_du_temps').delete().eq('id', coursId);
        if (error) throw error;
        showToast('Cours supprimé', 'success');
        await renderEmploiGrid(classId);
    } catch (e) {
        console.error('❌ deleteCours:', e);
        showToast('Erreur lors de la suppression', 'error');
    }
};

// Imprimer l'emploi du temps
window.imprimerEmploi = function() {
    const classId = document.getElementById('emploiClasseSelect')?.value;
    if (!classId) { showToast('Sélectionnez une classe', 'error'); return; }
    const sel = document.getElementById('emploiClasseSelect');
    const nom = sel?.options[sel.selectedIndex]?.text || '';
    const grid = document.getElementById('emploiContainer')?.innerHTML || '';
    const html =
        '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
        '<title>Emploi du temps - ' + nom + '</title>' +
        '<style>body{font-family:Arial,sans-serif;padding:20px;}' +
        'h2{color:#5D4037;text-align:center;}' +
        'table{width:100%;border-collapse:collapse;}' +
        'th,td{border:1px solid #e5e7eb;padding:6px;}</style>' +
        '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},300);};</scr' + 'ipt>' +
        '</head><body><h2>École Privée Moussa Koné<br>Emploi du temps — ' + nom + '</h2>' +
        grid + '</body></html>';
    ouvrirImpression(html);
};


// Ouvre directement l'element choisi dans la recherche globale
/**
 * Fiche complete d'un eleve — vue d'ensemble en lecture.
 *
 * La recherche ouvrait directement le formulaire de MODIFICATION, ce qui
 * oblige a chercher l'information au milieu de champs modifiables et
 * expose a une modification par megarde. Cette fiche rassemble tout ce
 * qu'on veut savoir d'un eleve en un coup d'oeil, sans rien pouvoir
 * changer : identite, famille, situation financiere, assiduite, dossier.
 *
 * Chaque bloc est charge par une requete SEPAREE puis assemble en JS :
 * les cles etrangeres ne sont pas toutes declarees, une jointure
 * PostgREST renverrait PGRST200.
 */
/**
 * Change ou ajoute la photo d'un eleve depuis sa fiche.
 * Ouvre le selecteur de fichier, depose dans le bucket PRIVE, met a jour
 * students.photo_url puis rouvre la fiche pour montrer le resultat.
 */
// ════════════════════════════════════════════════════════════════════
// RATTACHEMENT D'UN PARENT A UN ELEVE
// --------------------------------------------------------------------
// Un eleve sans parent rattache n'apparait sur AUCUN portail : la
// famille ne voit ni notes, ni absences, ni paiements. C'est une erreur
// silencieuse — tout semble normal cote administration.
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// ÉLÈVES NON À JOUR — relance des familles
// --------------------------------------------------------------------
// Seuls l'inscription et la scolarite sont OBLIGATOIRES : cantine et
// tenues sont facultatives et n'entrent pas dans le solde.
// Seuls les paiements VALIDES comptent — une declaration en attente
// n'est pas un versement encaisse.
// ════════════════════════════════════════════════════════════════════

let _impayes = [];

// ════════════════════════════════════════════════════════════════════
// TARIFS FIXES — cantine et tenues
// --------------------------------------------------------------------
// Ces frais ne se saisissent plus a la main : le montant se CALCULE a
// partir du bareme de `frais_additionnels`. Deux parents payant la meme
// chose doivent payer le meme prix — un montant libre ouvrait la porte
// aux erreurs de frappe et aux ecarts inexplicables.
//
//   cantine  : au mois (montant_mensuel) ou a l'annee (montant_annuel)
//   uniforme : a l'unite (montant_annuel = prix d'une tenue)
// ════════════════════════════════════════════════════════════════════

let _bareme = null;

async function chargerBareme() {
    if (_bareme) return _bareme;
    _bareme = {};
    try {
        const { data } = await supabaseClient
            .from('frais_additionnels').select('type, nom, montant_mensuel, montant_annuel, actif');
        (data || []).forEach(function (f) {
            if (f.actif === false) return;
            _bareme[f.type] = {
                nom: f.nom,
                mensuel: parseInt(f.montant_mensuel) || 0,
                annuel: parseInt(f.montant_annuel) || 0
            };
        });
    } catch (e) {
        console.warn('Barème non chargé :', e && e.message);
    }
    return _bareme;
}

/**
 * Affiche ou masque le bloc de tarification selon le type choisi.
 * Appele par le select « Type de paiement ».
 */
window.majBlocTarif = async function () {
    const type = document.getElementById('paymentType')?.value;
    const bloc = document.getElementById('blocTarif');
    const champMontant = document.getElementById('paymentAmount');
    const formule = document.getElementById('tarifFormule');
    const label = document.getElementById('tarifLabel');
    const blocQte = document.getElementById('blocQuantite');
    if (!bloc || !formule) return;

    // Inscription et scolarite gardent la saisie libre : un parent verse
    // ce qu'il peut, la repartition se fait ensuite.
    if (type !== 'cantine' && type !== 'uniforme') {
        bloc.style.display = 'none';
        if (champMontant) { champMontant.readOnly = false; champMontant.style.background = ''; }
        return;
    }

    const bareme = await chargerBareme();
    const t = bareme[type];

    if (!t || (!t.mensuel && !t.annuel)) {
        bloc.style.display = 'none';
        if (champMontant) { champMontant.readOnly = false; champMontant.style.background = ''; }
        showToast('Aucun tarif défini pour ce frais — saisissez le montant, ' +
                  'ou renseignez le barème dans Paramètres.', 'warning', 8000);
        return;
    }

    bloc.style.display = 'block';
    // Le montant devient calcule : on empeche la saisie directe pour que
    // deux familles ne paient jamais un prix different pour la meme chose.
    if (champMontant) { champMontant.readOnly = true; champMontant.style.background = '#F3EEEB'; }

    if (type === 'cantine') {
        if (label) label.textContent = 'Formule';
        if (blocQte) blocQte.style.display = '';
        let opts = '';
        if (t.mensuel) opts += '<option value="mensuel">Au mois — ' +
            t.mensuel.toLocaleString('fr-FR') + ' FCFA</option>';
        if (t.annuel) opts += '<option value="annuel">Année entière — ' +
            t.annuel.toLocaleString('fr-FR') + ' FCFA</option>';
        formule.innerHTML = opts;
    } else {
        if (label) label.textContent = 'Article';
        if (blocQte) blocQte.style.display = '';
        formule.innerHTML = '<option value="unite">' + (t.nom || 'Tenue scolaire') +
            ' — ' + (t.annuel || t.mensuel).toLocaleString('fr-FR') + ' FCFA l\'unité</option>';
    }

    calculerMontantTarif();
};

window.calculerMontantTarif = function () {
    const type = document.getElementById('paymentType')?.value;
    const formule = document.getElementById('tarifFormule')?.value;
    const qte = Math.max(1, parseInt(document.getElementById('tarifQuantite')?.value) || 1);
    const champMontant = document.getElementById('paymentAmount');
    const detail = document.getElementById('tarifDetail');
    const t = (_bareme || {})[type];
    if (!t || !champMontant) return;

    let unitaire = 0, libelle = '';
    if (type === 'cantine') {
        if (formule === 'annuel') {
            unitaire = t.annuel;
            libelle = qte > 1 ? qte + ' années' : 'Année entière';
        } else {
            unitaire = t.mensuel;
            libelle = qte + ' mois';
        }
    } else {
        unitaire = t.annuel || t.mensuel;
        libelle = qte + ' tenue' + (qte > 1 ? 's' : '');
    }

    const total = unitaire * qte;
    champMontant.value = total;

    if (detail) {
        detail.innerHTML = '<strong>' + libelle + '</strong> × ' +
            unitaire.toLocaleString('fr-FR') + ' FCFA = ' +
            '<strong style="color:#3E2723;font-size:1.05rem;">' +
            total.toLocaleString('fr-FR') + ' FCFA</strong>';
    }

    if (typeof apercuRepartition === 'function') apercuRepartition();
};

window.ouvrirImpayes = async function () {
    let m = document.getElementById('impayesModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'impayesModal';
        m.className = 'modal';
        document.body.appendChild(m);
    }
    m.innerHTML = '<div class="modal-content" style="max-width:920px;">' +
        '<div class="modal-body" style="text-align:center;padding:60px 20px;color:#7A6A63;">' +
        '<i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i>' +
        '<div style="margin-top:12px;">Calcul des soldes…</div></div></div>';
    m.style.display = 'flex';

    try {
        // Requetes SEPAREES puis jointure en JS (pas de join PostgREST).
        const { data: eleves } = await supabaseClient
            .from('students').select('id, first_name, last_name, matricule, class_id, status')
            .eq('status', 'actif');

        const { data: classes } = await supabaseClient
            .from('classes').select('id, nom, frais_inscription, frais_scolarite');
        const parClasse = {};
        (classes || []).forEach(c => { parClasse[c.id] = c; });

        const { data: paiements } = await supabaseClient
            .from('payments').select('student_id, amount, type, status');

        // Seuls les paiements VALIDES et les frais OBLIGATOIRES.
        const paye = {};
        (paiements || []).forEach(function (p) {
            if (p.status && p.status !== 'completed') return;
            if (p.type !== 'inscription' && p.type !== 'scolarite') return;
            paye[p.student_id] = (paye[p.student_id] || 0) + (parseInt(p.amount) || 0);
        });

        // Parents rattaches, pour la relance
        const { data: liens } = await supabaseClient
            .from('parent_students').select('student_id, parent_id');
        const parentsDe = {};
        (liens || []).forEach(function (l) {
            (parentsDe[l.student_id] || (parentsDe[l.student_id] = [])).push(l.parent_id);
        });

        const idsParents = [...new Set((liens || []).map(l => l.parent_id))];
        const infosParents = {};
        if (idsParents.length) {
            const { data: ps } = await supabaseClient
                .from('parents').select('id, first_name, last_name, phone').in('id', idsParents);
            (ps || []).forEach(p => { infosParents[p.id] = p; });
        }

        _impayes = (eleves || []).map(function (e) {
            const c = parClasse[e.class_id];
            const du = (parseInt(c?.frais_inscription) || 0) + (parseInt(c?.frais_scolarite) || 0);
            const regle = paye[e.id] || 0;
            const solde = du - regle;
            const parents = (parentsDe[e.id] || []).map(id => infosParents[id]).filter(Boolean);
            return {
                eleve: e, classe: c ? c.nom : '—',
                du: du, regle: regle, solde: solde,
                parents: parents,
                joignable: parents.some(p => p && p.phone)
            };
        }).filter(x => x.solde > 0 && x.du > 0)
          .sort((a, b) => b.solde - a.solde);

        afficherImpayes();

    } catch (e) {
        console.error('Impayés :', e);
        m.innerHTML = '<div class="modal-content" style="max-width:520px;">' +
            '<div class="modal-body" style="padding:40px 24px;text-align:center;">' +
            '<i class="fas fa-triangle-exclamation" style="font-size:2rem;color:#B23B2E;"></i>' +
            '<p style="margin-top:12px;">Calcul impossible.<br><small style="color:#7A6A63;">' +
            (e.message || '') + '</small></p>' +
            '<button class="btn btn-secondary" onclick="closeModal(\'impayesModal\')">Fermer</button>' +
            '</div></div>';
    }
};

function afficherImpayes() {
    const m = document.getElementById('impayesModal');
    if (!m) return;

    const fmt = n => (parseInt(n) || 0).toLocaleString('fr-FR') + ' FCFA';
    const esc = s => String(s == null ? '' : s)
        .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

    const total = _impayes.reduce((s, x) => s + x.solde, 0);
    const joignables = _impayes.filter(x => x.joignable).length;
    const sansParent = _impayes.filter(x => !x.parents.length).length;

    const lignes = _impayes.map(function (x, i) {
        const nom = esc((x.eleve.last_name || '') + ' ' + (x.eleve.first_name || ''));
        const contact = x.parents.length
            ? x.parents.map(p => esc((p.last_name || '') + ' ' + (p.first_name || '')) +
                (p.phone ? ' <span style="color:#7A6A63;">' + esc(p.phone) + '</span>'
                         : ' <span style="color:#B23B2E;">sans téléphone</span>')).join('<br>')
            : '<span style="color:#B23B2E;">Aucun parent rattaché</span>';
        return '<tr>' +
            '<td><input type="checkbox" class="impaye-case" data-i="' + i + '"' +
                (x.joignable ? ' checked' : ' disabled') + '></td>' +
            '<td><strong>' + nom + '</strong><br>' +
                '<small style="color:#7A6A63;">' + esc(x.eleve.matricule || '') + '</small></td>' +
            '<td>' + esc(x.classe) + '</td>' +
            '<td style="text-align:right;">' + fmt(x.du) + '</td>' +
            '<td style="text-align:right;color:#2E7D32;">' + fmt(x.regle) + '</td>' +
            '<td style="text-align:right;font-weight:700;color:#B23B2E;">' + fmt(x.solde) + '</td>' +
            '<td style="font-size:.83rem;">' + contact + '</td>' +
        '</tr>';
    }).join('');

    m.innerHTML =
    '<div class="modal-content" style="max-width:980px;">' +
      '<div class="modal-header">' +
        '<h3><i class="fas fa-triangle-exclamation"></i> Élèves non à jour</h3>' +
        '<button class="close-modal" onclick="closeModal(\'impayesModal\')">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        (_impayes.length ? (
          '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px;">' +
            '<div style="flex:1;min-width:150px;background:#FDECEA;border:1px solid #E6A79E;' +
              'border-radius:10px;padding:12px 14px;">' +
              '<div style="font-size:.78rem;color:#8C2F22;text-transform:uppercase;">Total dû</div>' +
              '<div style="font-family:Fraunces,serif;font-size:1.35rem;font-weight:600;color:#8C2F22;">' +
                fmt(total) + '</div></div>' +
            '<div style="flex:1;min-width:150px;background:#FAF8F7;border:1px solid #D7CCC8;' +
              'border-radius:10px;padding:12px 14px;">' +
              '<div style="font-size:.78rem;color:#7A6A63;text-transform:uppercase;">Élèves concernés</div>' +
              '<div style="font-family:Fraunces,serif;font-size:1.35rem;font-weight:600;color:#3E2723;">' +
                _impayes.length + '</div></div>' +
            '<div style="flex:1;min-width:150px;background:#FAF8F7;border:1px solid #D7CCC8;' +
              'border-radius:10px;padding:12px 14px;">' +
              '<div style="font-size:.78rem;color:#7A6A63;text-transform:uppercase;">Familles joignables</div>' +
              '<div style="font-family:Fraunces,serif;font-size:1.35rem;font-weight:600;color:#3E2723;">' +
                joignables + ' / ' + _impayes.length + '</div></div>' +
          '</div>' +
          (sansParent
            ? '<div style="background:#FDECEA;border-left:4px solid #B23B2E;border-radius:8px;' +
              'padding:11px 14px;margin-bottom:14px;font-size:.86rem;color:#8C2F22;">' +
              '<i class="fas fa-triangle-exclamation"></i> <strong>' + sansParent +
              ' élève(s) sans parent rattaché</strong> — impossible de les relancer. ' +
              'Rattachez un parent depuis leur fiche.</div>'
            : '') +
          '<div style="overflow-x:auto;"><table class="data-table"><thead><tr>' +
            '<th style="width:34px;"><input type="checkbox" checked onchange="toutCocherImpayes(this)"></th>' +
            '<th>Élève</th><th>Classe</th>' +
            '<th style="text-align:right;">Dû</th>' +
            '<th style="text-align:right;">Réglé</th>' +
            '<th style="text-align:right;">Reste</th>' +
            '<th>Parent</th></tr></thead><tbody>' + lignes + '</tbody></table></div>'
        ) : (
          '<div style="text-align:center;padding:48px 20px;">' +
            '<i class="fas fa-circle-check" style="font-size:2.4rem;color:#2E7D32;"></i>' +
            '<p style="margin-top:14px;font-size:1.05rem;color:#2A211D;">' +
            'Toutes les familles sont à jour.</p></div>'
        )) +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal(\'impayesModal\')">Fermer</button> ' +
        (_impayes.length
          ? '<button class="btn btn-secondary" onclick="imprimerImpayes()">' +
              '<i class="fas fa-print"></i> Imprimer la liste</button> ' +
            '<button class="btn btn-primary" onclick="preparerRelanceImpayes()">' +
              '<i class="fas fa-comment-sms"></i> Préparer la relance</button>'
          : '') +
      '</div>' +
    '</div>';
}

/**
 * Prepare la relance : le directeur RELIT et MODIFIE le message avant
 * tout envoi. Une relance financiere touche a la dignite des familles —
 * elle ne doit jamais partir automatiquement.
 */
/**
 * Liste imprimable des eleves non a jour, pour le secretariat.
 * Une colonne « Observation » reste vide : elle se remplit au stylo
 * quand une famille passe et s'explique.
 */
window.imprimerImpayes = async function () {
    if (!_impayes.length) return;

    let nomEcole = 'École Privée Moussa Koné';
    try {
        const { data: pe } = await supabaseClient
            .from('parametres_ecole').select('nom').limit(1).maybeSingle();
        if (pe && pe.nom) nomEcole = pe.nom;
    } catch (e) { /* le nom par defaut suffit */ }

    const annee = (typeof anneeDocument === 'function') ? anneeDocument() : '';
    const fmt = n => (parseInt(n) || 0).toLocaleString('fr-FR');
    const esc = s => String(s == null ? '' : s)
        .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

    const total = _impayes.reduce((s, x) => s + x.solde, 0);

    const lignes = _impayes.map(function (x, i) {
        const p = x.parents[0];
        return '<tr>' +
            '<td>' + (i + 1) + '</td>' +
            '<td><strong>' + esc((x.eleve.last_name || '') + ' ' + (x.eleve.first_name || '')) + '</strong>' +
                '<br><small>' + esc(x.eleve.matricule || '') + '</small></td>' +
            '<td>' + esc(x.classe) + '</td>' +
            '<td class="n">' + fmt(x.du) + '</td>' +
            '<td class="n">' + fmt(x.regle) + '</td>' +
            '<td class="n solde">' + fmt(x.solde) + '</td>' +
            '<td>' + (p ? esc((p.last_name || '') + ' ' + (p.first_name || '')) +
                          (p.phone ? '<br><small>' + esc(p.phone) + '</small>' : '')
                        : '<em>aucun</em>') + '</td>' +
            '<td class="obs"></td>' +
        '</tr>';
    }).join('');

    const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
    '<title>Élèves non à jour</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">' +
    '<style>' +
    '@page{size:A4 portrait;margin:10mm}' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:Inter,Arial,sans-serif;color:#2A211D;font-size:9pt;' +
      '-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.tete{display:flex;justify-content:space-between;align-items:flex-end;' +
      'border-bottom:2px solid #5D4037;padding-bottom:6px}' +
    '.tete h1{font-family:Fraunces,serif;font-size:15pt;color:#3E2723;font-weight:600}' +
    '.tete .sub{font-size:9pt;color:#7A6A63;margin-top:2px}' +
    '.tete .meta{text-align:right;font-size:9pt;color:#5D4037}' +
    'table{width:100%;border-collapse:collapse;margin-top:10px}' +
    'th{background:#5D4037;color:#fff;padding:5px 4px;font-size:8pt;font-weight:600;' +
      'border:.5pt solid #4E342E;text-align:left}' +
    'td{padding:5px 4px;border:.5pt solid #E3D9D4;vertical-align:top}' +
    'td small{color:#7A6A63;font-size:7pt}' +
    'td.n{text-align:right;white-space:nowrap}' +
    'td.solde{font-weight:700;color:#8C2F22}' +
    'td.obs{width:32mm;background:#FAFAFA}' +
    'tr:nth-child(even) td{background:#FAF8F7}' +
    'tr:nth-child(even) td.obs{background:#F5F3F1}' +
    '.pied{margin-top:14px;display:flex;justify-content:space-between;' +
      'font-size:8.5pt;color:#5D4037}' +
    '.sig{margin-top:14mm;border-top:.5pt solid #5D4037;padding-top:3px;' +
      'width:55mm;text-align:center}' +
    '@media print{.no-print{display:none!important}}' +
    '</style></head><body>' +
    '<div class="tete">' +
      '<div><h1>Élèves non à jour</h1>' +
      '<div class="sub">' + esc(nomEcole) + ' — ' + esc(annee) + '</div></div>' +
      '<div class="meta">' + _impayes.length + ' élève(s)<br>' +
        '<strong>' + fmt(total) + ' FCFA</strong> restant dus</div>' +
    '</div>' +
    '<table><thead><tr><th style="width:8mm;">N°</th><th>Élève</th><th>Classe</th>' +
      '<th style="text-align:right;">Dû</th><th style="text-align:right;">Réglé</th>' +
      '<th style="text-align:right;">Reste</th><th>Parent</th><th>Observation</th>' +
      '</tr></thead><tbody>' + lignes + '</tbody></table>' +
    '<div class="pied"><div>Édité le ' + new Date().toLocaleDateString('fr-FR') +
      '<br><em>Document interne — à ne pas diffuser aux familles.</em></div>' +
      '<div class="sig">Le Directeur</div></div>' +
    '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},500);};</scr' + 'ipt>' +
    '</body></html>';

    ouvrirImpression(html, 1000, 760);
};

window.preparerRelanceImpayes = async function () {
    const choisis = Array.from(document.querySelectorAll('.impaye-case:checked'))
        .map(c => _impayes[parseInt(c.dataset.i)])
        .filter(x => x && x.joignable);

    if (!choisis.length) {
        showToast('Aucune famille joignable sélectionnée', 'error');
        return;
    }

    // Nom et telephone de l'ecole : le parent doit savoir qui l'ecrit
    // et ou se rendre.
    let nomEcole = 'École Privée Moussa Koné', telEcole = '';
    try {
        const { data: pe } = await supabaseClient
            .from('parametres_ecole').select('nom, telephone').limit(1).maybeSingle();
        if (pe) { nomEcole = pe.nom || nomEcole; telEcole = pe.telephone || ''; }
    } catch (e) { console.warn('Contact école :', e && e.message); }

    // Message par defaut : courtois, factuel, sans injonction ni menace.
    // Les variables sont remplacees famille par famille a l'envoi.
    const modele =
        'Bonjour, {parent}. ' + nomEcole + ' vous informe qu\'un solde de ' +
        '{solde} FCFA reste dû pour la scolarité de {eleve} ({classe}). ' +
        'Nous vous remercions de bien vouloir passer au secrétariat' +
        (telEcole ? ' ou de nous joindre au ' + telEcole : '') + '. Merci.';

    let m = document.getElementById('relanceModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'relanceModal';
        m.className = 'modal';
        document.body.appendChild(m);
    }

    const esc = s => String(s == null ? '' : s)
        .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

    m.innerHTML =
    '<div class="modal-content" style="max-width:620px;">' +
      '<div class="modal-header">' +
        '<h3><i class="fas fa-comment-sms"></i> Relance des familles</h3>' +
        '<button class="close-modal" onclick="closeModal(\'relanceModal\')">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<p style="font-size:.88rem;color:#7A6A63;margin:-4px 0 14px;">' +
          '<strong style="color:#2A211D;">' + choisis.length + ' famille(s)</strong> recevront ce message. ' +
          'Relisez-le : il sera envoyé tel quel.</p>' +

        '<div class="form-group">' +
          '<label>Message</label>' +
          '<textarea id="relanceMessage" class="form-control" rows="5" ' +
            'oninput="majApercuRelance()">' + esc(modele) + '</textarea>' +
          '<small style="color:#7A6A63;font-size:.79rem;">' +
            'Variables remplacées automatiquement : <code>{parent}</code>, ' +
            '<code>{eleve}</code>, <code>{classe}</code>, <code>{solde}</code>.</small>' +
        '</div>' +

        '<div style="background:#FAF8F7;border:1.5px solid #D7CCC8;border-radius:10px;' +
          'padding:13px 15px;margin-bottom:14px;">' +
          '<div style="font-size:.78rem;color:#7A6A63;text-transform:uppercase;' +
            'letter-spacing:.05em;margin-bottom:6px;">Aperçu — première famille</div>' +
          '<div id="relanceApercu" style="font-size:.89rem;color:#2A211D;line-height:1.55;"></div>' +
          '<div id="relanceTaille" style="font-size:.78rem;color:#7A6A63;margin-top:8px;"></div>' +
        '</div>' +

        '<div style="background:#FFFDF7;border-left:4px solid #E6C976;border-radius:8px;' +
          'padding:11px 14px;font-size:.84rem;color:#8a6414;">' +
          '<i class="fas fa-circle-info"></i> Une relance financière touche à la dignité ' +
          'des familles. Vérifiez que les paiements en espèces récents ont bien été saisis ' +
          'avant d\'envoyer.' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal(\'relanceModal\')">Annuler</button> ' +
        '<button class="btn btn-primary" id="btnEnvoyerRelance" ' +
          'onclick="envoyerRelanceImpayes()">' +
          '<i class="fas fa-paper-plane"></i> Envoyer à ' + choisis.length + ' famille(s)</button>' +
      '</div>' +
    '</div>';
    m.style.display = 'flex';

    window._relanceChoisis = choisis;
    majApercuRelance();
};

// Un SMS depasse 160 caracteres = deux messages factures. Le directeur
// doit le voir avant d'envoyer a 200 familles.
window.majApercuRelance = function () {
    const modele = document.getElementById('relanceMessage')?.value || '';
    const liste = window._relanceChoisis || [];
    if (!liste.length) return;
    const texte = composerRelance(modele, liste[0]);
    const apercu = document.getElementById('relanceApercu');
    const taille = document.getElementById('relanceTaille');
    if (apercu) apercu.textContent = texte;
    if (taille) {
        const n = texte.length;
        const sms = Math.ceil(n / 160) || 1;
        taille.innerHTML = n + ' caractères — <strong>' + sms + ' SMS</strong> par famille' +
            (sms > 1 ? ' <span style="color:#B23B2E;">(coût doublé)</span>' : '');
    }
};

function composerRelance(modele, x) {
    const p = x.parents.find(q => q && q.phone) || x.parents[0] || {};
    return modele
        .replace(/\{parent\}/g, ((p.last_name || '') + ' ' + (p.first_name || '')).trim() || 'Madame, Monsieur')
        .replace(/\{eleve\}/g, ((x.eleve.last_name || '') + ' ' + (x.eleve.first_name || '')).trim())
        .replace(/\{classe\}/g, x.classe || '')
        .replace(/\{solde\}/g, (x.solde || 0).toLocaleString('fr-FR'));
}

window.envoyerRelanceImpayes = async function () {
    const liste = window._relanceChoisis || [];
    const modele = document.getElementById('relanceMessage')?.value?.trim();
    if (!liste.length || !modele) return;

    if (!confirm('Envoyer ' + liste.length + ' message(s) ?\n\n' +
                 'Cette action est irréversible.')) return;

    const btn = document.getElementById('btnEnvoyerRelance');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi…'; }

    let envoyes = 0, echecs = 0;

    for (const x of liste) {
        const p = x.parents.find(q => q && q.phone);
        if (!p) { echecs++; continue; }
        try {
            const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-sms-parent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ANON_KEY_SMS}`,
                    'apikey': ANON_KEY_SMS
                },
                body: JSON.stringify({
                    action: 'broadcast',
                    phone: p.phone,
                    message: composerRelance(modele, x)
                })
            });
            const r = await resp.json();
            if (r && (r.success || r.sms_sent)) envoyes++; else echecs++;
        } catch (e) {
            console.warn('Relance ' + (p.phone || '') + ' :', e && e.message);
            echecs++;
        }
        // Souffle entre deux envois : les operateurs limitent la cadence.
        await new Promise(r => setTimeout(r, 350));
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer'; }
    closeModal('relanceModal');

    if (echecs === 0) {
        showToast(envoyes + ' message(s) envoyé(s)', 'success', 7000);
    } else {
        showToast(envoyes + ' envoyé(s), ' + echecs + ' échec(s). ' +
                  'Vérifiez la configuration SMS dans Paramètres.', 'warning', 10000);
    }
};

window.toutCocherImpayes = function (source) {
    document.querySelectorAll('.impaye-case:not([disabled])')
        .forEach(c => { c.checked = source.checked; });
};

window.ouvrirLiaisonParent = async function (eleveId) {
    if (!eleveId) return;

    let m = document.getElementById('liaisonParentModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'liaisonParentModal';
        m.className = 'modal';
        document.body.appendChild(m);
    }

    m.innerHTML =
    '<div class="modal-content" style="max-width:560px;">' +
      '<div class="modal-header">' +
        '<h3><i class="fas fa-user-plus"></i> Rattacher un parent</h3>' +
        '<button class="close-modal" onclick="closeModal(\'liaisonParentModal\')">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="form-group">' +
          '<label>Rechercher un parent existant</label>' +
          '<input type="text" id="rechercheParent" class="form-control" ' +
            'placeholder="Nom, prénom, téléphone ou e-mail" ' +
            'oninput="chercherParentALier(\'' + eleveId + '\')" autocomplete="off">' +
          '<small style="color:#7A6A63;font-size:.79rem;">' +
            'Tapez au moins deux caractères.</small>' +
        '</div>' +
        '<div id="resultatsParents" style="max-height:320px;overflow-y:auto;"></div>' +
        '<div style="margin-top:16px;padding-top:14px;border-top:1px solid #E3D9D4;">' +
          '<p style="font-size:.85rem;color:#7A6A63;margin:0 0 10px;">' +
            'Le parent n\'existe pas encore&nbsp;?</p>' +
          '<button class="btn btn-secondary" ' +
            'onclick="closeModal(\'liaisonParentModal\');closeModal(\'ficheEleveModal\');' +
            'loadPage(\'parents\')">' +
            '<i class="fas fa-user-plus"></i> Créer un compte parent</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    m.style.display = 'flex';

    setTimeout(function () { document.getElementById('rechercheParent')?.focus(); }, 120);
    chercherParentALier(eleveId);   // affiche les derniers parents créés
};

let _rechercheParentTimer = null;

window.chercherParentALier = function (eleveId) {
    clearTimeout(_rechercheParentTimer);
    // Anti-rebond : une requete par frappe saturerait la base.
    _rechercheParentTimer = setTimeout(async function () {
        const zone = document.getElementById('resultatsParents');
        const terme = (document.getElementById('rechercheParent')?.value || '').trim();
        if (!zone) return;

        zone.innerHTML = '<p style="text-align:center;color:#7A6A63;padding:20px 0;">' +
            '<i class="fas fa-spinner fa-spin"></i></p>';

        try {
            // Parents deja rattaches : on ne les propose pas deux fois.
            const { data: liens } = await supabaseClient
                .from('parent_students').select('parent_id').eq('student_id', eleveId);
            const dejaLies = new Set((liens || []).map(l => l.parent_id));

            let requete = supabaseClient
                .from('parents').select('id, first_name, last_name, phone, email')
                .order('created_at', { ascending: false }).limit(20);

            if (terme.length >= 2) {
                const t = '%' + terme + '%';
                requete = requete.or(
                    'first_name.ilike.' + t + ',last_name.ilike.' + t +
                    ',phone.ilike.' + t + ',email.ilike.' + t);
            }

            const { data: parents, error } = await requete;
            if (error) throw error;

            const dispo = (parents || []).filter(p => !dejaLies.has(p.id));

            if (!dispo.length) {
                zone.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px 0;font-size:.88rem;">' +
                    (terme ? 'Aucun parent ne correspond.' : 'Aucun parent disponible.') + '</p>';
                return;
            }

            zone.innerHTML = dispo.map(function (p) {
                const nom = ((p.last_name || '') + ' ' + (p.first_name || '')).trim() || 'Sans nom';
                const init = ((p.last_name || '?')[0] + (p.first_name || '')[0] || '?').toUpperCase();
                return '<div style="display:flex;align-items:center;gap:11px;padding:10px 12px;' +
                    'border:1px solid #E3D9D4;border-radius:10px;margin-bottom:8px;">' +
                    '<div style="width:38px;height:38px;border-radius:50%;flex-shrink:0;' +
                      'background:linear-gradient(135deg,#5D4037,#8D6E63);color:#fff;' +
                      'display:grid;place-items:center;font-weight:700;font-size:.8rem;">' + init + '</div>' +
                    '<div style="flex:1;min-width:0;">' +
                      '<div style="font-weight:600;font-size:.9rem;">' + nom + '</div>' +
                      '<div style="font-size:.79rem;color:#7A6A63;white-space:nowrap;' +
                        'overflow:hidden;text-overflow:ellipsis;">' +
                        (p.phone || p.email || '—') + '</div>' +
                    '</div>' +
                    '<button class="btn btn-sm btn-primary" ' +
                      'onclick="lierParent(\'' + eleveId + '\',\'' + p.id + '\')">' +
                      '<i class="fas fa-link"></i> Lier</button>' +
                '</div>';
            }).join('');

        } catch (e) {
            console.error('Recherche parent :', e);
            zone.innerHTML = '<p style="text-align:center;color:#B23B2E;padding:20px 0;font-size:.86rem;">' +
                'Recherche impossible : ' + (e.message || '') + '</p>';
        }
    }, 250);
};

window.lierParent = async function (eleveId, parentId) {
    if (!eleveId || !parentId) return;
    try {
        // Un parent deja lie ne doit pas creer de doublon.
        const { data: existe } = await supabaseClient
            .from('parent_students').select('parent_id')
            .eq('student_id', eleveId).eq('parent_id', parentId).maybeSingle();
        if (existe) {
            showToast('Ce parent est déjà rattaché à cet élève', 'warning');
            return;
        }

        // `is_primary` : le premier parent rattache devient le contact principal.
        const { data: dejaUn } = await supabaseClient
            .from('parent_students').select('parent_id').eq('student_id', eleveId).limit(1);

        const { error } = await supabaseClient.from('parent_students').insert([{
            parent_id: parentId,
            student_id: eleveId,
            relation: 'parent',
            is_primary: !(dejaUn && dejaUn.length),
            created_at: new Date().toISOString()
        }]);
        if (error) throw error;

        showToast('Parent rattaché', 'success');
        closeModal('liaisonParentModal');
        closeModal('ficheEleveModal');
        setTimeout(function () { voirFicheEleve(eleveId); }, 250);

    } catch (e) {
        console.error('Liaison parent :', e);
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

window.detacherParent = async function (eleveId, parentId) {
    if (!eleveId || !parentId) return;
    if (!confirm('Détacher ce parent de l\'élève ?\n\n' +
                 'Il ne verra plus ni les notes, ni les absences, ni les paiements ' +
                 'de cet enfant sur le portail.')) return;
    try {
        const { error } = await supabaseClient.from('parent_students').delete()
            .eq('student_id', eleveId).eq('parent_id', parentId);
        if (error) throw error;

        showToast('Parent détaché', 'success');
        closeModal('ficheEleveModal');
        setTimeout(function () { voirFicheEleve(eleveId); }, 250);
    } catch (e) {
        console.error('Détachement :', e);
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

window.changerPhotoEleve = function (eleveId) {
    if (!eleveId) return;

    // Un input cree a la volee : pas d'element cache a maintenir dans le HTML.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';   // ouvre l'appareil photo sur mobile

    input.onchange = async function () {
        const f = input.files && input.files[0];
        if (!f) return;

        if (f.size > 2 * 1024 * 1024) {
            showToast('La photo dépasse 2 Mo. Choisissez une image plus légère.', 'error');
            return;
        }

        showToast('Envoi de la photo…', 'info', 3000);
        try {
            // On releve l'ancien chemin AVANT de le remplacer, pour pouvoir
            // supprimer le fichier devenu inutile et ne pas accumuler des
            // portraits d'enfants orphelins dans le bucket.
            const { data: avant } = await supabaseClient
                .from('students').select('photo_url').eq('id', eleveId).maybeSingle();
            const ancien = avant && avant.photo_url;

            const chemin = await televerserPhotoEleve(f, eleveId);

            const { error } = await supabaseClient
                .from('students').update({ photo_url: chemin }).eq('id', eleveId);
            if (error) throw error;

            // Suppression de l'ancienne photo, uniquement si elle vivait dans
            // le bucket prive (une URL heritee ne s'y trouve pas).
            if (ancien && !/^https?:\/\//i.test(ancien)) {
                try {
                    await supabaseClient.storage.from(BUCKET_PHOTOS).remove([ancien]);
                } catch (e) { console.warn('Ancienne photo non supprimée :', e && e.message); }
            }

            showToast('Photo enregistrée', 'success');
            closeModal('ficheEleveModal');
            setTimeout(function () { voirFicheEleve(eleveId); }, 250);

        } catch (err) {
            console.error('Changement de photo :', err);
            showToast('Photo non enregistrée : ' + (err.message || ''), 'error', 8000);
        }
    };

    input.click();
};

// ════════════════════════════════════════════════════════════════════
// CARTES SCOLAIRES
// --------------------------------------------------------------------
// L'ecole ne delivre la carte qu'aux candidats au DEF (9e annee) : le
// selecteur s'ouvre donc sur ces classes, sans interdire les autres au
// cas ou la direction etendrait la pratique.
// Format bancaire ISO (85,6 x 54 mm), 10 par feuille A4 avec reperes
// de decoupe — le mode d'impression reel des ecoles de Bamako.
// ════════════════════════════════════════════════════════════════════

let _elevesCartes = [];
let _classeCarte = null;

// ════════════════════════════════════════════════════════════════════
// COMPOSITIONS MENSUELLES — second cycle
// --------------------------------------------------------------------
// Pratique interne de l'ecole : une composition chaque mois en 7e, 8e
// et 9e. Ces notes N'ENTRENT PAS dans la moyenne du trimestre — elles
// portent le type `composition_mensuelle`, que le calcul des moyennes
// ignore (il ne pondere que devoir, examen et participation).
// ════════════════════════════════════════════════════════════════════

const MOIS_NOMS = { 1:'Janvier', 2:'Février', 3:'Mars', 4:'Avril', 5:'Mai', 6:'Juin',
                    9:'Septembre', 10:'Octobre', 11:'Novembre', 12:'Décembre' };

let _compoEleves = [];
let _compoMatieres = [];
let _compoClasse = null;
// Toutes les notes du mois, en memoire : on change de matiere sans
// perdre ce qui a ete saisi dans les precedentes.
let _compoNotes = {};

// Reconnait 7e, 8e, 9e — le second cycle malien.
function estSecondCycle(nom) {
    return /(^|\s)[789]\s*(e|è|ème|eme)?\b/i.test(nom || '');
}

// ════════════════════════════════════════════════════════════════════
// FINANCES — dépenses, salaires, résultat. Réservé au directeur.
// --------------------------------------------------------------------
// L'application ne suivait que les recettes : le « bilan financier »
// montrait l'argent qui entre, jamais celui qui sort.
//
// Ces donnees contiennent les SALAIRES : la politique RLS les reserve
// au role `super_admin`. L'interface le rappelle, mais c'est la BASE
// qui protege — masquer un ecran n'a jamais protege une donnee.
// ════════════════════════════════════════════════════════════════════

const CATEGORIES_DEPENSE = {
    salaires:        'Salaires',
    fournitures:     'Fournitures scolaires',
    entretien:       'Entretien et réparations',
    loyer:           'Loyer',
    eau_electricite: 'Eau et électricité',
    transport:       'Transport et carburant',
    cantine_achats:  'Achats cantine',
    equipement:      'Équipement et mobilier',
    tenues_achats:   'Achat de tenues',
    administratif:   'Frais administratifs',
    divers:          'Divers'
};

let _vueFinance = 'depenses';

async function initFinancesPage() {
    ouvrirVueFinance(_vueFinance || 'depenses');
}

window.ouvrirVueFinance = function (vue) {
    _vueFinance = vue;
    document.querySelectorAll('.fin-onglet').forEach(function (b) {
        b.classList.toggle('actif', b.dataset.vue === vue);
    });
    if (vue === 'depenses')      chargerDepenses();
    else if (vue === 'salaires') chargerSalaires();
    else if (vue === 'resultat') chargerResultat();
};

// ── DÉPENSES ────────────────────────────────────────────────────────
// ── RÉSULTAT ────────────────────────────────────────────────────────
// Recettes ENCAISSEES moins depenses. Seuls les paiements `completed`
// comptent : une declaration en attente n'est pas de l'argent recu.
// C'est la difference entre un resultat et une esperance.
window.chargerResultat = async function () {
    const zone = document.getElementById('financeVue');
    if (!zone) return;
    zone.innerHTML = '<p style="text-align:center;color:#7A6A63;padding:40px 0;">' +
        '<i class="fas fa-spinner fa-spin"></i> Calcul…</p>';

    try {
        const [pRes, dRes] = await Promise.all([
            supabaseClient.from('payments').select('amount, type, date, status'),
            supabaseClient.from('depenses').select('montant, categorie, date')
        ]);
        if (dRes.error) throw dRes.error;

        const paiements = (pRes.data || []).filter(p => !p.status || p.status === 'completed');
        const depenses = dRes.data || [];

        const fmt = n => Math.round(n || 0).toLocaleString('fr-FR') + ' FCFA';

        // Douze derniers mois : la saisonnalite d'une ecole est forte,
        // un total annuel seul masque les mois creux.
        const mois = [];
        const maintenant = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
            mois.push({
                cle: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
                label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
                recettes: 0, depenses: 0
            });
        }
        const parCle = {};
        mois.forEach(m => { parCle[m.cle] = m; });

        const cleDe = d => {
            const x = new Date(d);
            return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0');
        };

        let totalRecettes = 0, totalDepenses = 0;
        paiements.forEach(function (p) {
            const v = parseFloat(p.amount) || 0;
            totalRecettes += v;
            const m = parCle[cleDe(p.date)];
            if (m) m.recettes += v;
        });
        depenses.forEach(function (d) {
            const v = parseFloat(d.montant) || 0;
            totalDepenses += v;
            const m = parCle[cleDe(d.date)];
            if (m) m.depenses += v;
        });

        const solde = totalRecettes - totalDepenses;
        const maxi = Math.max(1, ...mois.map(m => Math.max(m.recettes, m.depenses)));

        // Repartition des depenses, poste par poste
        const parPoste = {};
        depenses.forEach(d => {
            parPoste[d.categorie] = (parPoste[d.categorie] || 0) + (parseFloat(d.montant) || 0);
        });
        const postes = Object.keys(parPoste).sort((a, b) => parPoste[b] - parPoste[a]);

        zone.innerHTML =
            '<div class="fin-stats">' +
              '<div class="fin-stat recette"><div class="lbl">Recettes encaissées</div>' +
                '<div class="val">' + fmt(totalRecettes) + '</div></div>' +
              '<div class="fin-stat depense"><div class="lbl">Dépenses</div>' +
                '<div class="val">' + fmt(totalDepenses) + '</div></div>' +
              '<div class="fin-stat solde"><div class="lbl">' +
                (solde >= 0 ? 'Excédent' : 'Déficit') + '</div>' +
                '<div class="val" style="color:' + (solde >= 0 ? '#1B5E20' : '#8C2F22') + ';">' +
                fmt(Math.abs(solde)) + '</div></div>' +
            '</div>' +

            '<div class="fin-carte" style="margin-bottom:16px;">' +
              '<h4 style="margin:0 0 14px;color:#4E342E;font-size:.95rem;">Douze derniers mois</h4>' +
              '<div style="display:flex;align-items:flex-end;gap:6px;height:150px;">' +
                mois.map(function (m) {
                    const hr = (m.recettes / maxi) * 100;
                    const hd = (m.depenses / maxi) * 100;
                    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;">' +
                      '<div style="flex:1;display:flex;align-items:flex-end;gap:2px;width:100%;">' +
                        '<div title="Recettes : ' + fmt(m.recettes) + '" ' +
                          'style="flex:1;height:' + hr + '%;background:#2E7D32;border-radius:2px 2px 0 0;min-height:2px;"></div>' +
                        '<div title="Dépenses : ' + fmt(m.depenses) + '" ' +
                          'style="flex:1;height:' + hd + '%;background:#B23B2E;border-radius:2px 2px 0 0;min-height:2px;"></div>' +
                      '</div>' +
                      '<div style="font-size:.68rem;color:#7A6A63;white-space:nowrap;">' + m.label + '</div>' +
                    '</div>';
                }).join('') +
              '</div>' +
              '<div style="display:flex;gap:16px;justify-content:center;margin-top:10px;font-size:.8rem;color:#7A6A63;">' +
                '<span><span style="display:inline-block;width:10px;height:10px;background:#2E7D32;border-radius:2px;"></span> Recettes</span>' +
                '<span><span style="display:inline-block;width:10px;height:10px;background:#B23B2E;border-radius:2px;"></span> Dépenses</span>' +
              '</div>' +
            '</div>' +

            (postes.length
              ? '<div class="fin-carte" style="margin-bottom:16px;">' +
                  '<h4 style="margin:0 0 12px;color:#4E342E;font-size:.95rem;">Où va l\'argent</h4>' +
                  postes.map(function (p) {
                      const pct = totalDepenses > 0 ? (parPoste[p] / totalDepenses * 100) : 0;
                      return '<div style="margin-bottom:9px;">' +
                        '<div style="display:flex;justify-content:space-between;font-size:.86rem;">' +
                          '<span>' + (CATEGORIES_DEPENSE[p] || p) + '</span>' +
                          '<strong>' + fmt(parPoste[p]) + ' <span style="color:#7A6A63;font-weight:400;">(' +
                            pct.toFixed(0) + '%)</span></strong></div>' +
                        '<div style="height:6px;background:#EFEBE9;border-radius:3px;margin-top:4px;">' +
                          '<div style="height:100%;width:' + pct + '%;background:#8D6E63;border-radius:3px;"></div>' +
                        '</div></div>';
                  }).join('') +
                '</div>'
              : '') +

            '<div style="background:#FFFDF7;border-left:4px solid #E6C976;border-radius:8px;' +
              'padding:12px 15px;font-size:.84rem;color:#8a6414;">' +
              '<i class="fas fa-circle-info"></i> Seuls les paiements <strong>validés</strong> ' +
              'sont comptés : une déclaration en attente n\'est pas de l\'argent encaissé. ' +
              'Ce suivi de trésorerie ne remplace pas une comptabilité tenue par un professionnel.' +
            '</div>';

    } catch (e) {
        console.error('Résultat :', e);
        zone.innerHTML = '<div class="fin-alerte">' +
            (/does not exist|42P01/i.test(e.message || '')
                ? 'Exécutez <strong>paie-enseignants.sql</strong> : les tables n\'existent pas encore.'
                : 'Calcul impossible : ' + (e.message || '')) + '</div>';
    }
};

window.imprimerDepenses = async function () {
    try {
        const { data } = await supabaseClient
            .from('depenses').select('*').order('date', { ascending: false });
        const dep = data || [];
        if (!dep.length) { showToast('Aucune dépense à imprimer', 'error'); return; }

        const fmt = n => (parseInt(n) || 0).toLocaleString('fr-FR');
        const esc = s => String(s == null ? '' : s)
            .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
        const total = dep.reduce((s, d) => s + (parseFloat(d.montant) || 0), 0);

        const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
        '<title>Journal des dépenses</title>' +
        '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">' +
        '<style>@page{size:A4 portrait;margin:10mm}*{margin:0;padding:0;box-sizing:border-box}' +
        'body{font-family:Inter,Arial,sans-serif;color:#2A211D;font-size:9pt;' +
          '-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
        '.tete{display:flex;justify-content:space-between;align-items:flex-end;' +
          'border-bottom:2px solid #5D4037;padding-bottom:6px}' +
        '.tete h1{font-family:Fraunces,serif;font-size:15pt;color:#3E2723;font-weight:600}' +
        'table{width:100%;border-collapse:collapse;margin-top:10px}' +
        'th{background:#5D4037;color:#fff;padding:5px 4px;font-size:8pt;text-align:left;' +
          'border:.5pt solid #4E342E}' +
        'td{padding:5px 4px;border:.5pt solid #E3D9D4}' +
        'td.n{text-align:right;white-space:nowrap;font-weight:600}' +
        'tr:nth-child(even) td{background:#FAF8F7}' +
        '.conf{background:#FDECEA;border-left:3px solid #B23B2E;padding:6px 9px;' +
          'margin:8px 0;font-size:8pt;color:#8C2F22}' +
        '.pied{margin-top:14px;display:flex;justify-content:space-between;font-size:8.5pt;color:#5D4037}' +
        '</style></head><body>' +
        '<div class="tete"><div><h1>Journal des dépenses</h1></div>' +
          '<div style="text-align:right;">' + dep.length + ' écriture(s)<br>' +
          '<strong>' + fmt(total) + ' FCFA</strong></div></div>' +
        '<div class="conf"><strong>Document confidentiel.</strong> Contient les salaires. ' +
          'Suivi de trésorerie — sans valeur de pièce comptable.</div>' +
        '<table><thead><tr><th>Date</th><th>Poste</th><th>Libellé</th>' +
          '<th>Bénéficiaire</th><th style="text-align:right;">Montant</th></tr></thead><tbody>' +
        dep.map(d => '<tr><td>' + new Date(d.date).toLocaleDateString('fr-FR') + '</td>' +
          '<td>' + esc(CATEGORIES_DEPENSE[d.categorie] || d.categorie) + '</td>' +
          '<td>' + esc(d.libelle) + '</td>' +
          '<td>' + esc(d.beneficiaire || '—') + '</td>' +
          '<td class="n">' + fmt(d.montant) + '</td></tr>').join('') +
        '</tbody></table>' +
        '<div class="pied"><div>Édité le ' + new Date().toLocaleDateString('fr-FR') + '</div>' +
          '<div>Le Directeur</div></div>' +
        '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},400);};</scr' + 'ipt>' +
        '</body></html>';

        ouvrirImpression(html);
    } catch (e) {
        showToast('Impression impossible : ' + (e.message || ''), 'error');
    }
};

// ── SALAIRES ────────────────────────────────────────────────────────
// Les enseignants sont payes A L'HEURE, a un taux qui leur est propre.
// Certains membres du personnel sont au forfait mensuel.
//
// Le taux est FIGE sur chaque bulletin : si un enseignant est augmente
// en janvier, le bulletin de decembre conserve l'ancien taux. Sans cela,
// tout l'historique deviendrait faux retroactivement et un bulletin
// reimprime ne correspondrait plus au montant reellement verse.

const MOIS_PAIE = { 1:'Janvier', 2:'Février', 3:'Mars', 4:'Avril', 5:'Mai', 6:'Juin',
                    7:'Juillet', 8:'Août', 9:'Septembre', 10:'Octobre',
                    11:'Novembre', 12:'Décembre' };

let _moisPaie = new Date().getMonth() + 1;

window.chargerSalaires = async function () {
    const zone = document.getElementById('financeVue');
    if (!zone) return;
    zone.innerHTML = '<p style="text-align:center;color:#7A6A63;padding:40px 0;">' +
        '<i class="fas fa-spinner fa-spin"></i> Chargement…</p>';

    const annee = (typeof anneeDocument === 'function') ? anneeDocument() : '';

    try {
        const { data: ens, error } = await supabaseClient
            .from('teachers')
            .select('id, first_name, last_name, type_remuneration, taux_horaire, salaire_forfait, status')
            .order('last_name');
        if (error) throw error;
        const enseignants = (ens || []).filter(t => !t.status || t.status === 'actif');

        const { data: bulletins } = await supabaseClient
            .from('salaires').select('*')
            .eq('annee_scolaire', annee).eq('mois', _moisPaie);
        const parEns = {};
        (bulletins || []).forEach(b => { parEns[b.teacher_id] = b; });

        // Combien de matieres tarifees par enseignant : indique s'il peut
        // etre paye, mieux qu'un taux unique qui n'est qu'un defaut.
        const nbTauxParEns = {};
        try {
            const { data: tx } = await supabaseClient
                .from('taux_enseignant').select('teacher_id').eq('actif', true);
            (tx || []).forEach(x => {
                nbTauxParEns[x.teacher_id] = (nbTauxParEns[x.teacher_id] || 0) + 1;
            });
        } catch (e) { console.warn('Barèmes :', e && e.message); }

        // Les heures vivent desormais dans salaire_lignes : on les somme
        // par bulletin pour l'affichage de la liste.
        const heuresParBulletin = {};
        if ((bulletins || []).length) {
            try {
                const { data: lg } = await supabaseClient
                    .from('salaire_lignes').select('salaire_id, heures')
                    .in('salaire_id', bulletins.map(b => b.id));
                (lg || []).forEach(function (l) {
                    heuresParBulletin[l.salaire_id] =
                        (heuresParBulletin[l.salaire_id] || 0) + (parseFloat(l.heures) || 0);
                });
            } catch (e) { console.warn('Lignes de paie :', e && e.message); }
        }

        const fmt = n => Math.round(n || 0).toLocaleString('fr-FR') + ' FCFA';
        const esc = s => String(s == null ? '' : s)
            .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

        const aPayer = (bulletins || []).filter(b => b.statut === 'a_payer');
        const payes  = (bulletins || []).filter(b => b.statut === 'paye');
        const totalAPayer = aPayer.reduce((s, b) => s + (parseFloat(b.montant_net) || 0), 0);
        const totalPaye   = payes.reduce((s, b) => s + (parseFloat(b.montant_net) || 0), 0);
        const sansTaux = enseignants.filter(t =>
            (t.type_remuneration || 'horaire') === 'horaire'
                ? (!nbTauxParEns[t.id] && !parseFloat(t.taux_horaire))
                : !parseFloat(t.salaire_forfait)).length;

        zone.innerHTML =
            '<div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">' +
              '<div class="form-group" style="min-width:190px;margin:0;">' +
                '<label>Mois de paie</label>' +
                '<select class="form-control" onchange="changerMoisPaie(this.value)">' +
                  Object.keys(MOIS_PAIE).map(m =>
                    '<option value="' + m + '"' + (parseInt(m) === _moisPaie ? ' selected' : '') + '>' +
                    MOIS_PAIE[m] + '</option>').join('') +
                '</select></div>' +
              '<div style="color:#7A6A63;font-size:.86rem;padding-bottom:9px;">' +
                'Année ' + esc(annee) + '</div>' +
            '</div>' +

            '<div class="fin-stats">' +
              '<div class="fin-stat depense"><div class="lbl">Reste à payer</div>' +
                '<div class="val">' + fmt(totalAPayer) + '</div></div>' +
              '<div class="fin-stat recette"><div class="lbl">Déjà payé</div>' +
                '<div class="val">' + fmt(totalPaye) + '</div></div>' +
              '<div class="fin-stat"><div class="lbl">Bulletins établis</div>' +
                '<div class="val">' + (bulletins || []).length + ' / ' + enseignants.length + '</div></div>' +
            '</div>' +

            (sansTaux
              ? '<div class="fin-alerte"><i class="fas fa-triangle-exclamation"></i> ' +
                '<strong>' + sansTaux + ' enseignant(s) sans taux défini.</strong> ' +
                'Renseignez leur taux horaire pour pouvoir établir leur bulletin.</div>'
              : '') +

            '<div class="fin-carte" style="overflow-x:auto;">' +
              '<table class="data-table"><thead><tr>' +
                '<th>Enseignant</th><th>Rémunération</th>' +
                '<th style="text-align:center;">Heures</th>' +
                '<th style="text-align:right;">Net à payer</th>' +
                '<th style="text-align:center;">Statut</th><th></th>' +
              '</tr></thead><tbody>' +
              (enseignants.length ? enseignants.map(function (t) {
                  const b = parEns[t.id];
                  const horaire = (t.type_remuneration || 'horaire') === 'horaire';
                  // Le vrai bareme est PAR MATIERE : ce chiffre n'est que le
                  // taux par defaut. Le nombre de matieres tarifees dit mieux
                  // si l'enseignant est pret a etre paye.
                  const nbTaux = nbTauxParEns[t.id] || 0;
                  const taux = horaire
                      ? (nbTaux
                          ? nbTaux + ' matière' + (nbTaux > 1 ? 's' : '') + ' tarifée' + (nbTaux > 1 ? 's' : '') +
                            (parseFloat(t.taux_horaire) ? ' <small style="color:#7A6A63;">(défaut ' + fmt(t.taux_horaire) + '/h)</small>' : '')
                          : (parseFloat(t.taux_horaire)
                              ? fmt(t.taux_horaire) + ' / h <small style="color:#7A6A63;">(défaut)</small>'
                              : '<span style="color:#B23B2E;">non défini</span>'))
                      : (parseFloat(t.salaire_forfait) ? fmt(t.salaire_forfait) + ' / mois' : '<span style="color:#B23B2E;">non défini</span>');

                  let statut = '<span style="color:#7A6A63;font-size:.84rem;">Aucun bulletin</span>';
                  if (b && b.statut === 'paye') {
                      statut = '<span class="badge badge-success">Payé' +
                          (b.date_paiement ? ' le ' + new Date(b.date_paiement).toLocaleDateString('fr-FR') : '') +
                          '</span>';
                  } else if (b) {
                      statut = '<span class="badge badge-warning">À payer</span>';
                  }

                  return '<tr>' +
                    '<td><strong>' + esc((t.last_name || '') + ' ' + (t.first_name || '')) + '</strong></td>' +
                    '<td>' + taux + '</td>' +
                    '<td style="text-align:center;">' +
                      (b && horaire
                        ? (Math.round((heuresParBulletin[b.id] || 0) * 100) / 100) + ' h'
                        : '—') + '</td>' +
                    '<td style="text-align:right;font-weight:700;">' +
                      (b ? fmt(b.montant_net) : '—') + '</td>' +
                    '<td style="text-align:center;">' + statut + '</td>' +
                    '<td style="white-space:nowrap;">' +
                      '<button class="btn btn-sm btn-secondary" onclick="ouvrirBaremeEnseignant(\'' + t.id + '\')" ' +
                        'title="Taux horaire par matière"><i class="fas fa-tags"></i></button> ' +
                      '<button class="btn btn-sm btn-secondary" onclick="ouvrirBulletinPaie(\'' + t.id + '\')" ' +
                        'title="Établir ou modifier le bulletin"><i class="fas fa-pen"></i></button> ' +
                      (b ? '<button class="btn btn-sm btn-secondary" onclick="imprimerBulletinPaie(\'' + b.id + '\')" ' +
                            'title="Imprimer"><i class="fas fa-print"></i></button> ' : '') +
                      (b && b.statut === 'a_payer'
                        ? '<button class="btn btn-sm btn-primary" onclick="marquerPaye(\'' + b.id + '\')" ' +
                          'title="Marquer comme payé"><i class="fas fa-check"></i></button>' : '') +
                    '</td></tr>';
              }).join('')
              : '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:36px 0;">' +
                'Aucun enseignant actif.</td></tr>') +
              '</tbody></table></div>';

    } catch (e) {
        console.error('Salaires :', e);
        zone.innerHTML = '<div class="fin-alerte">' +
            (/does not exist|42P01|column/i.test(e.message || '')
                ? 'Exécutez <strong>paie-enseignants.sql</strong> : la table ou les colonnes manquent.'
                : 'Chargement impossible : ' + (e.message || '')) + '</div>';
    }
};

/**
 * Barème d'un enseignant : un taux horaire PAR MATIÈRE.
 * Un professeur peut enseigner les mathématiques à 2 000 F/h et
 * l'informatique à 1 500 F/h : un taux unique par personne rendait la
 * paie fausse dès qu'il couvrait deux matières.
 */
/**
 * Annee calendaire d'un mois dans une annee scolaire.
 * « 2026-2027 » : septembre a decembre relevent de 2026,
 * janvier a aout de 2027. Sans cela, un bulletin de janvier compterait
 * les jours du mauvais mois.
 */
function anneeCalendaire(mois, anneeScolaire) {
    const m = parseInt(mois) || 1;
    const parts = String(anneeScolaire || '').match(/(\d{4})\s*[-\/]\s*(\d{4})/);
    if (!parts) return new Date().getFullYear();
    return m >= 9 ? parseInt(parts[1]) : parseInt(parts[2]);
}

window.ouvrirBaremeEnseignant = async function (teacherId) {
    try {
        const { data: t } = await supabaseClient
            .from('teachers').select('first_name, last_name, taux_horaire')
            .eq('id', teacherId).single();

        // Matieres reellement enseignees par cet enseignant, d'abord.
        const { data: cs } = await supabaseClient
            .from('class_subjects').select('subject_id').eq('teacher_id', teacherId);
        const siennes = [...new Set((cs || []).map(x => x.subject_id).filter(Boolean))];

        const { data: mats } = await supabaseClient.from('subjects').select('id, name').order('name');
        const { data: taux } = await supabaseClient
            .from('taux_enseignant').select('subject_id, taux_horaire')
            .eq('teacher_id', teacherId);
        const parMatiere = {};
        (taux || []).forEach(x => { parMatiere[x.subject_id] = parseFloat(x.taux_horaire) || 0; });

        const enseignees = (mats || []).filter(m => siennes.includes(m.id));
        const autres     = (mats || []).filter(m => !siennes.includes(m.id));
        const esc = s => String(s == null ? '' : s).replace(/"/g, '&quot;');

        const bloc = (liste, titre) => liste.length
            ? '<div style="margin-bottom:14px;">' +
              '<div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;' +
                'color:#7A6A63;margin-bottom:7px;">' + titre + '</div>' +
              liste.map(m =>
                '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;' +
                  'border-bottom:1px solid #F3EEEB;">' +
                  '<span style="flex:1;font-size:.9rem;">' + esc(m.name) + '</span>' +
                  '<input type="number" class="form-control" style="width:130px;" min="0" step="50" ' +
                    'placeholder="FCFA / h" data-matiere="' + m.id + '" ' +
                    'value="' + (parMatiere[m.id] || '') + '">' +
                '</div>').join('') +
              '</div>'
            : '';

        let m = document.getElementById('baremeModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'baremeModal'; m.className = 'modal';
            document.body.appendChild(m);
        }

        m.innerHTML =
        '<div class="modal-content" style="max-width:560px;">' +
          '<div class="modal-header">' +
            '<h3><i class="fas fa-tags"></i> Taux horaire par matière</h3>' +
            '<button class="close-modal" onclick="closeModal(\'baremeModal\')">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<p style="font-size:.88rem;color:#7A6A63;margin:-4px 0 16px;">' +
              '<strong style="color:#2A211D;">' + (t.last_name || '') + ' ' + (t.first_name || '') + '</strong>' +
              ' — laissez vide une matière qu\'il n\'enseigne pas.</p>' +

            (enseignees.length ? bloc(enseignees, 'Matières enseignées') : '') +
            (autres.length ? bloc(autres, 'Autres matières') : '') +

            '<div class="form-group" style="margin-top:14px;padding-top:14px;' +
              'border-top:1px solid #E3D9D4;">' +
              '<label>Taux par défaut (FCFA / h)</label>' +
              '<input type="number" id="bar_defaut" class="form-control" min="0" step="50" ' +
                'value="' + (parseFloat(t.taux_horaire) || '') + '">' +
              '<small style="color:#7A6A63;font-size:.78rem;">' +
                'Appliqué à une matière sans taux propre.</small>' +
            '</div>' +

            '<div style="background:#FFFDF7;border-left:4px solid #E6C976;border-radius:8px;' +
              'padding:11px 14px;margin-top:14px;font-size:.83rem;color:#8a6414;">' +
              '<i class="fas fa-circle-info"></i> Modifier un taux ne change <strong>aucun ' +
              'bulletin déjà établi</strong> : chaque bulletin conserve le taux en vigueur ' +
              'au moment où il a été créé.' +
            '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" onclick="closeModal(\'baremeModal\')">Annuler</button> ' +
            '<button class="btn btn-primary" onclick="enregistrerBareme(\'' + teacherId + '\')">' +
              '<i class="fas fa-save"></i> Enregistrer</button>' +
          '</div>' +
        '</div>';
        m.style.display = 'flex';

    } catch (e) {
        console.error('Barème :', e);
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

window.enregistrerBareme = async function (teacherId) {
    try {
        const champs = document.querySelectorAll('#baremeModal input[data-matiere]');
        const aGarder = [];
        champs.forEach(function (c) {
            const v = parseFloat(c.value);
            if (v > 0) aGarder.push({
                teacher_id: teacherId, subject_id: c.dataset.matiere,
                taux_horaire: v, actif: true, updated_at: new Date().toISOString()
            });
        });

        // Remplacement en bloc : un champ vidé doit faire disparaître le taux.
        await supabaseClient.from('taux_enseignant').delete().eq('teacher_id', teacherId);
        if (aGarder.length) {
            const { error } = await supabaseClient.from('taux_enseignant').insert(aGarder);
            if (error) throw error;
        }

        const defaut = parseFloat(document.getElementById('bar_defaut')?.value) || null;
        await supabaseClient.from('teachers').update({ taux_horaire: defaut }).eq('id', teacherId);

        closeModal('baremeModal');
        showToast(aGarder.length + ' taux enregistré(s)', 'success');
        chargerSalaires();

    } catch (e) {
        console.error('Enregistrement barème :', e);
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

window.ouvrirBulletinPaie = async function (teacherId) {
    window._teacherPaieCourant = teacherId;
    const annee = (typeof anneeDocument === 'function') ? anneeDocument() : '';
    try {
        const { data: t } = await supabaseClient
            .from('teachers')
            .select('id, first_name, last_name, type_remuneration, taux_horaire, salaire_forfait')
            .eq('id', teacherId).single();
        if (!t) throw new Error('Enseignant introuvable');

        const { data: existant } = await supabaseClient
            .from('salaires').select('*')
            .eq('teacher_id', teacherId).eq('mois', _moisPaie)
            .eq('annee_scolaire', annee).maybeSingle();

        const horaire = (t.type_remuneration || 'horaire') === 'horaire';
        let lignes = [];

        if (horaire) {
            if (existant) {
                // Bulletin deja etabli : on reprend SES lignes, avec leurs
                // taux figes — surtout pas le bareme courant.
                const { data: l } = await supabaseClient
                    .from('salaire_lignes').select('*')
                    .eq('salaire_id', existant.id).order('libelle');
                lignes = (l || []).map(x => ({
                    subject_id: x.subject_id, libelle: x.libelle,
                    prevues: parseFloat(x.heures_prevues) || 0,
                    absence: parseFloat(x.heures_absence) || 0,
                    sup: parseFloat(x.heures_sup) || 0,
                    heures: parseFloat(x.heures) || 0,
                    taux: parseFloat(x.taux_horaire) || 0
                }));
            } else {
                // Decompte REEL du mois : on compte les occurrences effectives
                // de chaque jour, pas un forfait de 4,33 semaines. L'ecart
                // atteint plus de 3 heures selon les mois — indefendable
                // devant un enseignant qui compte ses heures.
                // Les absences retenues sont deja deduites par la fonction.
                try {
                    const anneeCal = anneeCalendaire(_moisPaie, annee);
                    const { data: h } = await supabaseClient.rpc('epmk_heures_mois', {
                        p_teacher: teacherId, p_mois: _moisPaie, p_annee: anneeCal
                    });
                    lignes = (h || []).map(x => ({
                        subject_id: x.subject_id,
                        libelle: x.matiere || 'Matière',
                        prevues: parseFloat(x.heures_prevues) || 0,
                        absence: parseFloat(x.heures_absence) || 0,
                        sup: 0,
                        heures: parseFloat(x.heures_payees) || 0,
                        taux: parseFloat(x.taux) || 0
                    }));
                } catch (e) { console.warn('Heures du mois :', e && e.message); }
            }
            if (!lignes.length) lignes = [{ subject_id: null, libelle: '', prevues: 0, absence: 0, sup: 0, heures: 0, taux: 0 }];
        }

        window._lignesPaie = lignes;

        // Matieres disponibles pour le selecteur de ligne
        const { data: mats } = await supabaseClient.from('subjects').select('id, name').order('name');
        window._matieresPaie = mats || [];

        const base = existant ? (parseFloat(existant.montant_base) || 0)
                              : (horaire ? 0 : (parseFloat(t.salaire_forfait) || 0));

        let m = document.getElementById('paieModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'paieModal'; m.className = 'modal';
            document.body.appendChild(m);
        }

        m.innerHTML =
        '<div class="modal-content" style="max-width:720px;">' +
          '<div class="modal-header">' +
            '<h3><i class="fas fa-money-check-dollar"></i> Bulletin de paie</h3>' +
            '<button class="close-modal" onclick="closeModal(\'paieModal\')">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<p style="font-size:.88rem;color:#7A6A63;margin:-4px 0 16px;">' +
              '<strong style="color:#2A211D;">' + (t.last_name || '') + ' ' + (t.first_name || '') + '</strong>' +
              ' · ' + MOIS_PAIE[_moisPaie] + ' ' + annee +
              ' · ' + (horaire ? 'payé à l\'heure' : 'forfait mensuel') + '</p>' +

            (horaire
              ? '<div style="margin-bottom:14px;">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
                    '<strong style="font-size:.92rem;color:#4E342E;">Détail par matière</strong>' +
                    '<button type="button" class="btn btn-sm btn-secondary" onclick="ajouterLignePaie()">' +
                      '<i class="fas fa-plus"></i> Ligne</button>' +
                  '</div>' +
                  '<div id="lignesPaie"></div>' +
                  '<small style="color:#7A6A63;font-size:.78rem;">' +
                    'Heures pré-remplies d\'après l\'emploi du temps, taux d\'après le barème. ' +
                    'Ajustez selon le réel — les valeurs sont figées sur ce bulletin.</small>' +
                '</div>'
              : '<div class="form-group"><label>Salaire forfaitaire (FCFA) *</label>' +
                  '<input type="number" id="pa_base" class="form-control" min="0" step="1000" ' +
                  'value="' + base + '" oninput="calculerPaie()"></div>') +

            '<div class="form-row">' +
              '<div class="form-group"><label>Primes</label>' +
                '<input type="number" id="pa_primes" class="form-control" min="0" step="500" ' +
                'value="' + (existant ? parseFloat(existant.primes) || 0 : 0) + '" oninput="calculerPaie()"></div>' +
              '<div class="form-group"><label>Retenues (avances, absences)</label>' +
                '<input type="number" id="pa_retenues" class="form-control" min="0" step="500" ' +
                'value="' + (existant ? parseFloat(existant.retenues) || 0 : 0) + '" oninput="calculerPaie()"></div>' +
            '</div>' +

            '<div style="background:#EFEBE9;border-radius:10px;padding:14px 16px;margin:14px 0;">' +
              '<div style="display:flex;justify-content:space-between;font-size:.88rem;padding:4px 0;">' +
                '<span style="color:#7A6A63;">Total des heures</span>' +
                '<strong id="pa_apercu_heures">—</strong></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:.88rem;padding:4px 0;">' +
                '<span style="color:#7A6A63;">Rémunération de base</span>' +
                '<strong id="pa_apercu_base">—</strong></div>' +
              '<div style="display:flex;justify-content:space-between;padding:8px 0 2px;' +
                'border-top:1px solid #D7CCC8;margin-top:6px;">' +
                '<span style="font-weight:700;">Net à payer</span>' +
                '<strong id="pa_apercu_net" style="font-size:1.25rem;color:#3E2723;">—</strong></div>' +
            '</div>' +

            '<div class="form-group"><label>Note</label>' +
              '<textarea id="pa_notes" class="form-control" rows="2">' +
              (existant && existant.notes ? existant.notes : '') + '</textarea></div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" onclick="closeModal(\'paieModal\')">Annuler</button> ' +
            '<button class="btn btn-primary" onclick="enregistrerBulletinPaie(\'' + teacherId + '\',' +
              (existant ? '\'' + existant.id + '\'' : 'null') + ',' + (horaire ? 'true' : 'false') + ')">' +
              '<i class="fas fa-save"></i> Enregistrer</button>' +
          '</div>' +
        '</div>';
        m.style.display = 'flex';

        if (horaire) rendreLignesPaie();
        calculerPaie();

    } catch (e) {
        console.error('Bulletin de paie :', e);
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

// Une ligne par matiere : matiere, heures, taux, montant calcule.
function rendreLignesPaie() {
    const zone = document.getElementById('lignesPaie');
    if (!zone) return;
    const mats = window._matieresPaie || [];
    const lignes = window._lignesPaie || [];

    zone.innerHTML = lignes.map(function (l, i) {
        // Heures payees = prevues − absences + supplementaires.
        // Le detail est affiche : une retenue non expliquee est contestable.
        const payees = Math.max(0, (l.prevues || 0) - (l.absence || 0) + (l.sup || 0));
        l.heures = payees;

        return '<div style="border:1px solid #E3D9D4;border-radius:9px;padding:9px 11px;' +
            'margin-bottom:9px;background:#fff;">' +
          '<div style="display:flex;gap:8px;align-items:center;margin-bottom:7px;">' +
            '<select class="form-control" style="flex:1;min-width:0;" ' +
              'onchange="majLignePaie(' + i + ',\'subject\',this.value)">' +
              '<option value="">— Matière —</option>' +
              mats.map(m => '<option value="' + m.id + '"' +
                (l.subject_id === m.id ? ' selected' : '') + '>' + m.name + '</option>').join('') +
              (l.subject_id === null && l.libelle
                ? '<option value="" selected>' + l.libelle + '</option>' : '') +
            '</select>' +
            '<input type="number" class="form-control" style="width:100px;" min="0" step="50" ' +
              'placeholder="taux/h" value="' + (l.taux || '') + '" ' +
              'oninput="majLignePaie(' + i + ',\'taux\',this.value)">' +
            '<button type="button" class="btn btn-sm btn-danger" onclick="retirerLignePaie(' + i + ')" ' +
              'title="Retirer"><i class="fas fa-xmark"></i></button>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;font-size:.8rem;">' +
            '<label style="color:#7A6A63;white-space:nowrap;">Prévues</label>' +
            '<input type="number" class="form-control" style="width:70px;" min="0" step="0.5" ' +
              'value="' + (l.prevues || 0) + '" ' +
              'oninput="majLignePaie(' + i + ',\'prevues\',this.value)">' +
            '<label style="color:#B23B2E;white-space:nowrap;">− Absences</label>' +
            '<input type="number" class="form-control" style="width:70px;" min="0" step="0.5" ' +
              'value="' + (l.absence || 0) + '" ' +
              'oninput="majLignePaie(' + i + ',\'absence\',this.value)">' +
            '<label style="color:#2E7D32;white-space:nowrap;">+ Sup.</label>' +
            '<input type="number" class="form-control" style="width:70px;" min="0" step="0.5" ' +
              'value="' + (l.sup || 0) + '" ' +
              'oninput="majLignePaie(' + i + ',\'sup\',this.value)">' +
            '<span style="flex:1;text-align:right;font-weight:700;color:#3E2723;white-space:nowrap;">' +
              payees + ' h × ' + (l.taux || 0) + ' = ' +
              Math.round(payees * (l.taux || 0)).toLocaleString('fr-FR') + ' F</span>' +
          '</div>' +
        '</div>';
    }).join('');
}

window.majLignePaie = function (i, champ, valeur) {
    const l = (window._lignesPaie || [])[i];
    if (!l) return;
    if (champ === 'subject') {
        l.subject_id = valeur || null;
        const m = (window._matieresPaie || []).find(x => x.id === valeur);
        l.libelle = m ? m.name : (l.libelle || 'Matière');
        // Le bareme de la matiere choisie remplit le taux, s'il est vide.
        if (!l.taux && valeur) chargerTauxLigne(i, valeur);
    } else if (champ === 'prevues') {
        l.prevues = parseFloat(valeur) || 0;
    } else if (champ === 'absence') {
        l.absence = parseFloat(valeur) || 0;
    } else if (champ === 'sup') {
        l.sup = parseFloat(valeur) || 0;
    } else if (champ === 'taux') {
        l.taux = parseFloat(valeur) || 0;
    }
    rendreLignesPaie();
    calculerPaie();
};

async function chargerTauxLigne(i, subjectId) {
    const teacherId = window._teacherPaieCourant;
    if (!teacherId) return;
    try {
        const { data } = await supabaseClient
            .from('taux_enseignant').select('taux_horaire')
            .eq('teacher_id', teacherId).eq('subject_id', subjectId)
            .eq('actif', true).maybeSingle();
        if (data && window._lignesPaie[i]) {
            window._lignesPaie[i].taux = parseFloat(data.taux_horaire) || 0;
            rendreLignesPaie();
            calculerPaie();
        }
    } catch (e) { /* le directeur saisira le taux a la main */ }
}

window.ajouterLignePaie = function () {
    (window._lignesPaie || (window._lignesPaie = []))
        .push({ subject_id: null, libelle: '', prevues: 0, absence: 0, sup: 0, heures: 0, taux: 0 });
    rendreLignesPaie();
};

window.retirerLignePaie = function (i) {
    if (!window._lignesPaie) return;
    window._lignesPaie.splice(i, 1);
    if (!window._lignesPaie.length) {
        window._lignesPaie.push({ subject_id: null, libelle: '', prevues: 0, absence: 0, sup: 0, heures: 0, taux: 0 });
    }
    rendreLignesPaie();
    calculerPaie();
};

window.calculerPaie = function () {
    const n = id => parseFloat(document.getElementById(id)?.value) || 0;
    const champForfait = document.getElementById('pa_base');

    let base = 0, heures = 0;
    if (champForfait) {
        base = n('pa_base');
    } else {
        (window._lignesPaie || []).forEach(function (l) {
            heures += (l.heures || 0);
            base   += (l.heures || 0) * (l.taux || 0);
        });
    }
    const net = base + n('pa_primes') - n('pa_retenues');
    const f = v => Math.round(v).toLocaleString('fr-FR') + ' FCFA';

    const h = document.getElementById('pa_apercu_heures');
    const b = document.getElementById('pa_apercu_base');
    const t = document.getElementById('pa_apercu_net');
    if (h) h.textContent = champForfait ? '—' : (Math.round(heures * 100) / 100) + ' h';
    if (b) b.textContent = f(base);
    if (t) {
        t.textContent = f(net);
        // Un net negatif signale une retenue superieure au salaire :
        // presque toujours une erreur de saisie.
        t.style.color = net < 0 ? '#B23B2E' : '#3E2723';
    }
};

window.enregistrerBulletinPaie = async function (teacherId, bulletinId, horaire) {
    const n = id => parseFloat(document.getElementById(id)?.value) || 0;
    const annee = (typeof anneeDocument === 'function') ? anneeDocument() : '';

    // Seules les lignes reellement renseignees sont conservees.
    const lignes = (window._lignesPaie || []).filter(l => (l.heures > 0) && (l.taux > 0));
    const base = horaire
        ? lignes.reduce((s, l) => s + l.heures * l.taux, 0)
        : n('pa_base');
    const net = base + n('pa_primes') - n('pa_retenues');

    if (horaire && !lignes.length) {
        showToast('Renseignez au moins une matière avec ses heures et son taux', 'error');
        return;
    }
    if (base <= 0) {
        showToast('Le montant de base est nul', 'error');
        return;
    }
    if (net < 0) {
        showToast('Le net est négatif : les retenues dépassent le salaire.', 'error');
        return;
    }

    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        const entete = {
            teacher_id: teacherId, mois: _moisPaie, annee_scolaire: annee,
            type_remuneration: horaire ? 'horaire' : 'forfait',
            montant_base: base, primes: n('pa_primes'),
            retenues: n('pa_retenues'), montant_net: net,
            notes: document.getElementById('pa_notes')?.value?.trim() || null
        };

        let idBulletin = bulletinId;
        if (bulletinId) {
            entete.updated_at = new Date().toISOString();
            const { error } = await supabaseClient.from('salaires').update(entete).eq('id', bulletinId);
            if (error) throw error;
        } else {
            entete.statut = 'a_payer';
            entete.created_by = user?.id || null;
            const { data, error } = await supabaseClient
                .from('salaires').insert([entete]).select('id').single();
            if (error) throw error;
            idBulletin = data.id;
        }

        // Les lignes sont remplacees en bloc : plus simple et plus sur
        // qu'un rapprochement ligne a ligne.
        if (horaire) {
            await supabaseClient.from('salaire_lignes').delete().eq('salaire_id', idBulletin);
            const { error } = await supabaseClient.from('salaire_lignes').insert(
                lignes.map(l => ({
                    salaire_id: idBulletin, subject_id: l.subject_id || null,
                    libelle: l.libelle || 'Matière',
                    heures_prevues: l.prevues || 0,
                    heures_absence: l.absence || 0,
                    heures_sup: l.sup || 0,
                    heures: l.heures, taux_horaire: l.taux,
                    montant: l.heures * l.taux
                })));
            if (error) throw error;
        }

        closeModal('paieModal');
        showToast('Bulletin enregistré', 'success');
        chargerSalaires();

    } catch (e) {
        console.error('Enregistrement paie :', e);
        if (/duplicate|unique/i.test(e.message || '')) {
            showToast('Un bulletin existe déjà pour cet enseignant ce mois-ci.', 'error');
        } else {
            showToast('Erreur : ' + (e.message || ''), 'error');
        }
    }
};

/**
 * Marque un bulletin comme paye ET cree la depense correspondante.
 * Sans ce lien, le resultat financier ignorerait les salaires — soit le
 * poste le plus lourd d'une ecole.
 */
/**
 * Bulletin de paie imprimable.
 * Reprend la structure reelle d'un bulletin : identite, periode, base de
 * calcul detaillee (heures x taux), primes, retenues, net a payer en
 * chiffres et en lettres, et deux signatures.
 *
 * La mention « recu la somme » et la signature de l'enseignant sont ce
 * qui donne au document sa valeur de preuve pour l'ecole.
 */
window.imprimerBulletinPaie = async function (bulletinId) {
    try {
        const { data: b, error } = await supabaseClient
            .from('salaires').select('*').eq('id', bulletinId).single();
        if (error || !b) throw error || new Error('Bulletin introuvable');

        const { data: t } = await supabaseClient
            .from('teachers').select('first_name, last_name, phone, qualification, matricule_paie')
            .eq('id', b.teacher_id).maybeSingle();

        // Detail par matiere, avec les taux FIGES a l'etablissement.
        const { data: lg } = await supabaseClient
            .from('salaire_lignes').select('*').eq('salaire_id', bulletinId).order('libelle');
        const lignesDetail = lg || [];
        const totalHeures = lignesDetail.reduce((s, l) => s + (parseFloat(l.heures) || 0), 0);

        let nomEcole = 'École Privée Moussa Koné', adresse = '', tel = '';
        try {
            const { data: pe } = await supabaseClient
                .from('parametres_ecole').select('nom, adresse, telephone').limit(1).maybeSingle();
            if (pe) {
                nomEcole = pe.nom || nomEcole;
                adresse = pe.adresse || '';
                tel = pe.telephone || '';
            }
        } catch (e) { /* les valeurs par defaut suffisent */ }

        const fmt = n => Math.round(parseFloat(n) || 0).toLocaleString('fr-FR');
        const esc = s => String(s == null ? '' : s)
            .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
        const nom = t ? ((t.last_name || '') + ' ' + (t.first_name || '')).trim() : '—';
        const horaire = (b.type_remuneration || 'horaire') === 'horaire';
        const lettres = (typeof montantEnLettres === 'function')
            ? montantEnLettres(Math.round(parseFloat(b.montant_net) || 0)) : '';

        const ligne = (lbl, val, gras) =>
            '<tr><td>' + lbl + '</td><td class="n"' + (gras ? ' style="font-weight:700;"' : '') + '>' +
            val + '</td></tr>';

        const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
        '<title>Bulletin de paie — ' + esc(nom) + '</title>' +
        '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">' +
        '<style>' +
        '@page{size:A4 portrait;margin:14mm}' +
        '*{margin:0;padding:0;box-sizing:border-box}' +
        'body{font-family:Inter,Arial,sans-serif;color:#2A211D;font-size:10pt;' +
          '-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
        '.tete{display:flex;justify-content:space-between;align-items:flex-start;' +
          'border-bottom:2px solid #5D4037;padding-bottom:10px;margin-bottom:4px}' +
        '.tete h1{font-family:Fraunces,serif;font-size:13pt;color:#3E2723;font-weight:600}' +
        '.tete .sub{font-size:8.5pt;color:#7A6A63;margin-top:2px;line-height:1.4}' +
        '.titre{text-align:center;margin:18px 0 4px}' +
        '.titre h2{font-family:Fraunces,serif;font-size:16pt;color:#3E2723;font-weight:600}' +
        '.titre .periode{font-size:10pt;color:#5D4037;margin-top:3px}' +
        '.ident{background:#FAF8F7;border:1px solid #E3D9D4;border-radius:8px;' +
          'padding:12px 14px;margin:16px 0}' +
        '.ident div{display:flex;justify-content:space-between;padding:3px 0;font-size:9.5pt}' +
        '.ident span:first-child{color:#7A6A63}' +
        'table{width:100%;border-collapse:collapse;margin:14px 0}' +
        'th{background:#5D4037;color:#fff;padding:7px 10px;font-size:9pt;text-align:left;' +
          'border:.5pt solid #4E342E}' +
        'th.n,td.n{text-align:right}' +
        'td{padding:7px 10px;border:.5pt solid #E3D9D4}' +
        'tr.total td{background:#EFEBE9;font-weight:700;font-size:11.5pt;color:#3E2723}' +
        '.lettres{font-style:italic;color:#5D4037;font-size:9pt;margin-top:6px;text-align:right}' +
        '.recu{border:1px dashed #8D6E63;border-radius:8px;padding:12px 14px;' +
          'margin-top:18px;font-size:9.5pt;line-height:1.7}' +
        '.sigs{display:flex;justify-content:space-between;margin-top:22px;gap:30px}' +
        '.sig{flex:1;text-align:center}' +
        '.sig .zone{height:20mm;border-bottom:.5pt solid #5D4037;margin-bottom:4px}' +
        '.sig .lbl{font-size:9pt;color:#5D4037}' +
        '.pied{margin-top:20px;text-align:center;font-size:7.5pt;color:#A1887F;' +
          'border-top:.5pt solid #E3D9D4;padding-top:6px}' +
        '</style></head><body>' +

        '<div class="tete">' +
          '<div><h1>' + esc(nomEcole) + '</h1>' +
          '<div class="sub">' + esc(adresse) + (tel ? '<br>Tél. ' + esc(tel) : '') + '</div></div>' +
          '<div style="text-align:right;font-size:8.5pt;color:#7A6A63;">' +
            'Édité le ' + new Date().toLocaleDateString('fr-FR') + '</div>' +
        '</div>' +

        '<div class="titre"><h2>Bulletin de paie</h2>' +
          '<div class="periode">' + (MOIS_PAIE[b.mois] || '') + ' ' + esc(b.annee_scolaire) + '</div></div>' +

        '<div class="ident">' +
          '<div><span>Nom et prénom</span><strong>' + esc(nom) + '</strong></div>' +
          (t && t.qualification ? '<div><span>Qualification</span><span>' + esc(t.qualification) + '</span></div>' : '') +
          (t && t.matricule_paie ? '<div><span>Matricule</span><span>' + esc(t.matricule_paie) + '</span></div>' : '') +
          '<div><span>Mode de rémunération</span><span>' +
            (horaire ? 'Horaire' : 'Forfait mensuel') + '</span></div>' +
        '</div>' +

        '<table><thead><tr><th>Éléments de rémunération</th><th class="n">Montant (FCFA)</th></tr></thead><tbody>' +
          (horaire
            ? lignesDetail.map(function (l) {
                // Le decompte est detaille : une retenue que l'enseignant ne
                // peut pas verifier est une retenue qu'il contestera.
                const p = parseFloat(l.heures_prevues) || 0;
                const a = parseFloat(l.heures_absence) || 0;
                const s = parseFloat(l.heures_sup) || 0;
                let detail = fmt(l.heures) + ' h × ' + fmt(l.taux_horaire) + ' FCFA';
                if (a > 0 || s > 0) {
                    detail = fmt(p) + ' h prévues' +
                        (a > 0 ? ' − ' + fmt(a) + ' h d\'absence' : '') +
                        (s > 0 ? ' + ' + fmt(s) + ' h sup.' : '') +
                        ' = ' + detail;
                }
                return '<tr><td>' + esc(l.libelle) +
                  '<br><small style="color:#7A6A63;">' + detail + '</small></td>' +
                  '<td class="n">' + fmt(l.montant) + '</td></tr>';
              }).join('') +
              ligne('<strong>Rémunération de base</strong> — ' +
                    fmt(totalHeures) + ' h au total', fmt(b.montant_base), true)
            : ligne('<strong>Salaire forfaitaire</strong>', fmt(b.montant_base), true)) +
          (parseFloat(b.primes) > 0 ? ligne('Primes et indemnités', '+ ' + fmt(b.primes)) : '') +
          (parseFloat(b.retenues) > 0 ? ligne('Retenues (avances, absences)', '− ' + fmt(b.retenues)) : '') +
          '<tr class="total"><td>NET À PAYER</td><td class="n">' + fmt(b.montant_net) + ' FCFA</td></tr>' +
        '</tbody></table>' +
        (lettres ? '<div class="lettres">Arrêté à la somme de ' + esc(lettres) + '</div>' : '') +

        (b.notes ? '<div style="font-size:9pt;color:#5D4037;margin-top:10px;">' +
          '<strong>Observation :</strong> ' + esc(b.notes) + '</div>' : '') +

        '<div class="recu">' +
          'Je soussigné(e) <strong>' + esc(nom) + '</strong> reconnais avoir reçu de ' +
          esc(nomEcole) + ' la somme de <strong>' + fmt(b.montant_net) + ' FCFA</strong> ' +
          'au titre de ma rémunération du mois de ' + (MOIS_PAIE[b.mois] || '') + '.' +
          (b.statut === 'paye' && b.date_paiement
            ? '<br>Versement effectué le ' + new Date(b.date_paiement).toLocaleDateString('fr-FR') +
              (b.mode_paiement ? ' — ' + esc(b.mode_paiement) : '') + '.'
            : '<br><em style="color:#8a6414;">En attente de versement.</em>') +
        '</div>' +

        '<div class="sigs">' +
          '<div class="sig"><div class="zone"></div><div class="lbl">L\'intéressé(e)</div></div>' +
          '<div class="sig"><div class="zone"></div><div class="lbl">Le Directeur</div></div>' +
        '</div>' +

        '<div class="pied">Document interne — établi par le système de gestion de ' +
          esc(nomEcole) + '. Sans valeur de bulletin de salaire au sens de la ' +
          'réglementation du travail.</div>' +

        '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},400);};</scr' + 'ipt>' +
        '</body></html>';

        ouvrirImpression(html, 900, 780);

    } catch (e) {
        console.error('Impression bulletin de paie :', e);
        showToast('Impression impossible : ' + (e.message || ''), 'error');
    }
};

window.marquerPaye = async function (bulletinId) {
    const mode = prompt('Mode de paiement (especes, virement, orange, moov, wave) :', 'especes');
    if (mode === null) return;

    try {
        const { data: b } = await supabaseClient
            .from('salaires').select('*').eq('id', bulletinId).single();
        if (!b) throw new Error('Bulletin introuvable');

        const { data: t } = await supabaseClient
            .from('teachers').select('first_name, last_name').eq('id', b.teacher_id).maybeSingle();
        const nom = t ? ((t.last_name || '') + ' ' + (t.first_name || '')).trim() : 'Enseignant';

        const { data: { user } } = await supabaseClient.auth.getUser();
        const aujourdHui = new Date().toISOString().slice(0, 10);

        // La depense d'abord : si elle echoue, le bulletin ne doit pas
        // passer en « paye », sinon le resultat serait fausse en silence.
        const { data: dep, error: errDep } = await supabaseClient.from('depenses').insert([{
            date: aujourdHui, categorie: 'salaires',
            libelle: 'Salaire ' + MOIS_PAIE[b.mois] + ' — ' + nom,
            montant: b.montant_net, beneficiaire: nom,
            mode_paiement: mode || 'especes',
            annee: b.annee_scolaire, created_by: user?.id || null
        }]).select('id').single();
        if (errDep) throw errDep;

        const { error } = await supabaseClient.from('salaires').update({
            statut: 'paye', date_paiement: aujourdHui,
            mode_paiement: mode || 'especes', depense_id: dep?.id || null,
            updated_at: new Date().toISOString()
        }).eq('id', bulletinId);
        if (error) throw error;

        showToast('Salaire marqué payé — dépense enregistrée', 'success', 6000);
        chargerSalaires();

    } catch (e) {
        console.error('Paiement salaire :', e);
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

window.changerMoisPaie = function (m) {
    _moisPaie = parseInt(m) || 1;
    chargerSalaires();
};

window.ouvrirDepense = async function (id) {
    let d = { date: new Date().toISOString().slice(0, 10), categorie: '', libelle: '',
              montant: '', beneficiaire: '', mode_paiement: 'especes', reference: '', notes: '' };
    if (id) {
        try {
            const { data } = await supabaseClient.from('depenses').select('*').eq('id', id).single();
            if (data) d = data;
        } catch (e) { showToast('Dépense introuvable', 'error'); return; }
    }

    const v = x => (x == null ? '' : String(x)).replace(/"/g, '&quot;');

    let m = document.getElementById('depenseModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'depenseModal'; m.className = 'modal';
        document.body.appendChild(m);
    }

    m.innerHTML =
    '<div class="modal-content" style="max-width:600px;">' +
      '<div class="modal-header">' +
        '<h3><i class="fas fa-arrow-trend-down"></i> ' + (id ? 'Modifier la dépense' : 'Nouvelle dépense') + '</h3>' +
        '<button class="close-modal" onclick="closeModal(\'depenseModal\')">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="form-row">' +
          '<div class="form-group"><label>Date *</label>' +
            '<input type="date" id="dep_date" class="form-control" value="' + v(d.date) + '"></div>' +
          '<div class="form-group"><label>Poste de dépense *</label>' +
            '<select id="dep_categorie" class="form-control">' +
              '<option value="">Choisir…</option>' +
              Object.keys(CATEGORIES_DEPENSE).map(k =>
                '<option value="' + k + '"' + (d.categorie === k ? ' selected' : '') + '>' +
                CATEGORIES_DEPENSE[k] + '</option>').join('') +
            '</select></div>' +
        '</div>' +
        '<div class="form-group"><label>Libellé *</label>' +
          '<input type="text" id="dep_libelle" class="form-control" value="' + v(d.libelle) + '" ' +
          'placeholder="Ex. : salaires enseignants — septembre"></div>' +
        '<div class="form-row">' +
          '<div class="form-group"><label>Montant (FCFA) *</label>' +
            '<input type="number" id="dep_montant" class="form-control" min="1" step="100" value="' + v(d.montant) + '"></div>' +
          '<div class="form-group"><label>Bénéficiaire</label>' +
            '<input type="text" id="dep_beneficiaire" class="form-control" value="' + v(d.beneficiaire) + '" ' +
            'placeholder="Fournisseur, personne…"></div>' +
        '</div>' +
        '<div class="form-row">' +
          '<div class="form-group"><label>Mode de paiement</label>' +
            '<select id="dep_mode" class="form-control">' +
              ['especes:Espèces','virement:Virement','cheque:Chèque',
               'orange:Orange Money','moov:Moov Money','wave:Wave'].map(function (o) {
                const [k, l] = o.split(':');
                return '<option value="' + k + '"' + (d.mode_paiement === k ? ' selected' : '') + '>' + l + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="form-group"><label>Référence / n° facture</label>' +
            '<input type="text" id="dep_reference" class="form-control" value="' + v(d.reference) + '"></div>' +
        '</div>' +
        '<div class="form-group"><label>Notes</label>' +
          '<textarea id="dep_notes" class="form-control" rows="2">' + (d.notes || '') + '</textarea></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal(\'depenseModal\')">Annuler</button> ' +
        '<button class="btn btn-primary" onclick="enregistrerDepense(' + (id ? '\'' + id + '\'' : '') + ')">' +
          '<i class="fas fa-save"></i> Enregistrer</button>' +
      '</div>' +
    '</div>';
    m.style.display = 'flex';
};

window.enregistrerDepense = async function (id) {
    const val = x => document.getElementById(x)?.value?.trim() || null;
    const montant = parseFloat(val('dep_montant'));

    if (!val('dep_categorie')) { showToast('Choisissez un poste de dépense', 'error'); return; }
    if (!val('dep_libelle'))   { showToast('Le libellé est obligatoire', 'error'); return; }
    if (!montant || montant <= 0) { showToast('Le montant doit être supérieur à zéro', 'error'); return; }

    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        const ligne = {
            date: val('dep_date') || new Date().toISOString().slice(0, 10),
            categorie: val('dep_categorie'),
            libelle: val('dep_libelle'),
            montant: montant,
            beneficiaire: val('dep_beneficiaire'),
            mode_paiement: val('dep_mode'),
            reference: val('dep_reference'),
            notes: val('dep_notes'),
            annee: (typeof anneeDocument === 'function') ? anneeDocument() : null
        };

        if (id) {
            ligne.updated_at = new Date().toISOString();
            const { error } = await supabaseClient.from('depenses').update(ligne).eq('id', id);
            if (error) throw error;
        } else {
            ligne.created_by = user?.id || null;
            const { error } = await supabaseClient.from('depenses').insert([ligne]);
            if (error) throw error;
        }

        closeModal('depenseModal');
        showToast(id ? 'Dépense modifiée' : 'Dépense enregistrée', 'success');
        chargerDepenses();

    } catch (e) {
        console.error('Enregistrement dépense :', e);
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

window.supprimerDepense = async function (id) {
    if (!confirm('Supprimer cette dépense ?\n\nElle disparaîtra du résultat.')) return;
    try {
        const { error } = await supabaseClient.from('depenses').delete().eq('id', id);
        if (error) throw error;
        showToast('Dépense supprimée', 'success');
        chargerDepenses();
    } catch (e) {
        showToast('Erreur : ' + (e.message || ''), 'error');
    }
};

window.chargerDepenses = async function () {
    const zone = document.getElementById('financeVue');
    if (!zone) return;
    zone.innerHTML = '<p style="text-align:center;color:#7A6A63;padding:40px 0;">' +
        '<i class="fas fa-spinner fa-spin"></i> Chargement…</p>';

    try {
        const { data, error } = await supabaseClient
            .from('depenses').select('*').order('date', { ascending: false }).limit(200);
        if (error) throw error;
        const dep = data || [];

        const fmt = n => (parseInt(n) || 0).toLocaleString('fr-FR') + ' FCFA';
        const esc = s => String(s == null ? '' : s)
            .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

        // Mois en cours, pour situer la dépense courante.
        const debutMois = new Date(); debutMois.setDate(1);
        const duMois = dep.filter(d => new Date(d.date) >= debutMois);
        const totalMois = duMois.reduce((s, d) => s + (parseFloat(d.montant) || 0), 0);
        const total = dep.reduce((s, d) => s + (parseFloat(d.montant) || 0), 0);

        // Répartition par poste : c'est elle qui révèle les dérives.
        const parPoste = {};
        dep.forEach(d => {
            parPoste[d.categorie] = (parPoste[d.categorie] || 0) + (parseFloat(d.montant) || 0);
        });
        const postes = Object.keys(parPoste).sort((a, b) => parPoste[b] - parPoste[a]);

        zone.innerHTML =
            '<div class="fin-stats">' +
              '<div class="fin-stat depense"><div class="lbl">Ce mois-ci</div>' +
                '<div class="val">' + fmt(totalMois) + '</div></div>' +
              '<div class="fin-stat"><div class="lbl">Total enregistré</div>' +
                '<div class="val">' + fmt(total) + '</div></div>' +
              '<div class="fin-stat"><div class="lbl">Écritures</div>' +
                '<div class="val">' + dep.length + '</div></div>' +
            '</div>' +

            '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">' +
              '<button class="btn btn-primary" onclick="ouvrirDepense()">' +
                '<i class="fas fa-plus"></i> Nouvelle dépense</button>' +
              '<button class="btn btn-secondary" onclick="imprimerDepenses()">' +
                '<i class="fas fa-print"></i> Imprimer</button>' +
            '</div>' +

            (postes.length
              ? '<div class="fin-carte" style="margin-bottom:16px;">' +
                  '<h4 style="margin:0 0 12px;color:#4E342E;font-size:.95rem;">Répartition par poste</h4>' +
                  postes.map(function (p) {
                      const pct = total > 0 ? (parPoste[p] / total * 100) : 0;
                      return '<div style="margin-bottom:9px;">' +
                        '<div style="display:flex;justify-content:space-between;font-size:.86rem;">' +
                          '<span>' + (CATEGORIES_DEPENSE[p] || p) + '</span>' +
                          '<strong>' + fmt(parPoste[p]) + ' <span style="color:#7A6A63;font-weight:400;">(' +
                            pct.toFixed(0) + '%)</span></strong></div>' +
                        '<div style="height:6px;background:#EFEBE9;border-radius:3px;margin-top:4px;">' +
                          '<div style="height:100%;width:' + pct + '%;background:#8D6E63;border-radius:3px;"></div>' +
                        '</div></div>';
                  }).join('') +
                '</div>'
              : '') +

            '<div class="fin-carte" style="overflow-x:auto;">' +
              (dep.length
                ? '<table class="data-table"><thead><tr>' +
                    '<th>Date</th><th>Poste</th><th>Libellé</th><th>Bénéficiaire</th>' +
                    '<th style="text-align:right;">Montant</th><th></th></tr></thead><tbody>' +
                  dep.map(function (d) {
                      return '<tr>' +
                        '<td>' + new Date(d.date).toLocaleDateString('fr-FR') + '</td>' +
                        '<td>' + esc(CATEGORIES_DEPENSE[d.categorie] || d.categorie) + '</td>' +
                        '<td><strong>' + esc(d.libelle) + '</strong>' +
                          (d.reference ? '<br><small style="color:#7A6A63;">réf. ' + esc(d.reference) + '</small>' : '') +
                        '</td>' +
                        '<td>' + esc(d.beneficiaire || '—') + '</td>' +
                        '<td style="text-align:right;font-weight:700;color:#8C2F22;">' + fmt(d.montant) + '</td>' +
                        '<td style="white-space:nowrap;">' +
                          '<button class="btn btn-sm btn-secondary" onclick="ouvrirDepense(\'' + d.id + '\')" title="Modifier">' +
                            '<i class="fas fa-pen"></i></button> ' +
                          '<button class="btn btn-sm btn-danger" onclick="supprimerDepense(\'' + d.id + '\')" title="Supprimer">' +
                            '<i class="fas fa-trash"></i></button>' +
                        '</td></tr>';
                  }).join('') + '</tbody></table>'
                : '<p style="text-align:center;color:#9ca3af;padding:40px 0;">' +
                  'Aucune dépense enregistrée.</p>') +
            '</div>';

    } catch (e) {
        console.error('Dépenses :', e);
        zone.innerHTML = '<div class="fin-alerte">' +
            (/does not exist|42P01/i.test(e.message || '')
                ? 'Exécutez <strong>paie-enseignants.sql</strong> : les tables n\'existent pas encore.'
                : 'Chargement impossible : ' + (e.message || '')) + '</div>';
    }
};

async function initCompositionsPage() {
    const select = document.getElementById('compoClasse');
    const mois = document.getElementById('compoMois');
    if (!select) return;

    // Mois courant par defaut : on saisit generalement le mois qui s'acheve.
    if (mois && !mois.dataset.init) {
        const m = new Date().getMonth() + 1;
        if (MOIS_NOMS[m]) mois.value = String(m);
        mois.dataset.init = '1';
    }

    try {
        const { data: classes, error } = await supabaseClient
            .from('classes').select('id, nom').order('nom');
        if (error) throw error;

        const cycle2 = (classes || []).filter(c => estSecondCycle(c.nom));
        const autres = (classes || []).filter(c => !estSecondCycle(c.nom));

        let html = '<option value="">Choisir une classe</option>';
        if (cycle2.length) {
            html += '<optgroup label="Second cycle">' +
                cycle2.map(c => '<option value="' + c.id + '">' + c.nom + '</option>').join('') +
                '</optgroup>';
        }
        if (autres.length) {
            html += '<optgroup label="Autres classes (hors pratique habituelle)">' +
                autres.map(c => '<option value="' + c.id + '">' + c.nom + '</option>').join('') +
                '</optgroup>';
        }
        select.innerHTML = html;
    } catch (e) {
        console.error('Classes (compositions) :', e);
        showToast('Classes non chargées', 'error');
    }
}

window.chargerGrilleCompo = async function () {
    const classeId = document.getElementById('compoClasse')?.value;
    const mois = parseInt(document.getElementById('compoMois')?.value) || 0;
    const grille = document.getElementById('compoGrille');
    const info = document.getElementById('compoInfo');
    const btnSave = document.getElementById('btnEnregistrerCompo');
    const btnPrint = document.getElementById('btnImprimerCompo');
    if (!grille) return;

    if (btnSave) btnSave.disabled = true;
    if (btnPrint) btnPrint.disabled = true;
    _compoEleves = []; _compoMatieres = [];

    if (!classeId || !mois) {
        grille.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:36px 0;">' +
            'Choisissez une classe et un mois.</p>';
        if (info) info.textContent = '—';
        return;
    }

    grille.innerHTML = '<p style="text-align:center;color:#7A6A63;padding:36px 0;">' +
        '<i class="fas fa-spinner fa-spin"></i> Chargement…</p>';

    try {
        // Requetes SEPAREES puis jointure en JS : les cles etrangeres ne
        // sont pas toutes declarees, un join PostgREST renverrait PGRST200.
        const { data: c } = await supabaseClient
            .from('classes').select('id, nom').eq('id', classeId).maybeSingle();
        _compoClasse = c;

        const { data: eleves } = await supabaseClient
            .from('students').select('id, first_name, last_name, matricule, status')
            .eq('class_id', classeId).order('last_name');
        _compoEleves = (eleves || []).filter(e => !e.status || e.status === 'actif');

        const { data: cs } = await supabaseClient
            .from('class_subjects').select('subject_id, coefficient').eq('class_id', classeId);
        const subjectIds = (cs || []).map(x => x.subject_id).filter(Boolean);
        const coefs = {};
        (cs || []).forEach(x => { coefs[x.subject_id] = parseFloat(x.coefficient) || 1; });

        let matieres = [];
        if (subjectIds.length) {
            const { data: subs } = await supabaseClient
                .from('subjects').select('id, name').in('id', subjectIds);
            matieres = (subs || []).map(s => ({ id: s.id, nom: s.name, coef: coefs[s.id] || 1 }));
            matieres.sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
        }
        _compoMatieres = matieres;

        if (!_compoEleves.length || !_compoMatieres.length) {
            grille.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:36px 0;">' +
                (!_compoEleves.length ? 'Aucun élève actif dans cette classe.'
                                      : 'Aucune matière affectée à cette classe.') + '</p>';
            if (info) info.textContent = '0';
            return;
        }

        // Notes deja saisies pour ce mois
        const { data: notes } = await supabaseClient
            .from('notes').select('student_id, subject_id, value')
            .eq('class_id', classeId).eq('mois', mois).eq('type', 'composition_mensuelle');
        const existantes = {};
        (notes || []).forEach(n => { existantes[n.student_id + '|' + n.subject_id] = n.value; });

        // Saisie MATIÈRE PAR MATIÈRE, comme la page Notes : une colonne
        // de 12 champs se remplit d'une traite, alors qu'une grille de
        // 30 x 8 cases oblige à chercher où l'on en est.
        _compoNotes = existantes;

        let onglets = '<div class="compo-onglets">' +
            _compoMatieres.map(function (m, i) {
                const saisies = _compoEleves.filter(e => existantes[e.id + '|' + m.id] != null).length;
                const complet = saisies === _compoEleves.length;
                return '<button type="button" class="compo-onglet' + (i === 0 ? ' actif' : '') + '" ' +
                    'data-matiere="' + m.id + '" onclick="ouvrirMatiereCompo(\'' + m.id + '\')">' +
                    '<span>' + m.nom + '</span>' +
                    '<span class="pastille' + (complet ? ' ok' : '') + '">' +
                        saisies + '/' + _compoEleves.length + '</span>' +
                '</button>';
            }).join('') + '</div>';

        grille.innerHTML = onglets + '<div id="compoColonne"></div>';
        ouvrirMatiereCompo(_compoMatieres[0].id);
        if (info) info.textContent = _compoEleves.length + ' élève(s) · ' +
            _compoMatieres.length + ' matière(s) · ' + (MOIS_NOMS[mois] || '');
        if (btnSave) btnSave.disabled = false;
        if (btnPrint) btnPrint.disabled = false;

    } catch (e) {
        console.error('Grille compositions :', e);
        grille.innerHTML = '<p style="text-align:center;color:#B23B2E;padding:36px 0;">' +
            'Chargement impossible : ' + (e.message || '') + '</p>';
    }
};

// Retour immediat : une note hors bornes se voit avant l'enregistrement.
window.enregistrerCompo = async function () {
    const classeId = document.getElementById('compoClasse')?.value;
    const mois = parseInt(document.getElementById('compoMois')?.value) || 0;
    if (!classeId || !mois) return;

    // La colonne affichee n'est pas encore en memoire : on la sauve d'abord.
    sauverColonneCompo();

    const aEcrire = [];
    let invalides = 0;

    Object.keys(_compoNotes).forEach(function (cle) {
        const v = _compoNotes[cle];
        if (v == null) return;
        if (isNaN(v) || v < 0 || v > 20) { invalides++; return; }
        const [eleve, matiere] = cle.split('|');
        aEcrire.push({
            student_id: eleve, class_id: classeId, subject_id: matiere,
            type: 'composition_mensuelle', mois: mois, value: v,
            sequence: null, created_at: new Date().toISOString()
        });
    });

    if (invalides) {
        showToast(invalides + ' note(s) hors bornes — corrigez avant d\'enregistrer', 'error');
        return;
    }

    const btn = document.getElementById('btnEnregistrerCompo');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement…'; }

    try {
        // On remplace les notes du mois : plus simple et plus sûr qu'un
        // upsert ligne a ligne, et cela traite les champs vides (effacement).
        const { error: errDel } = await supabaseClient.from('notes').delete()
            .eq('class_id', classeId).eq('mois', mois).eq('type', 'composition_mensuelle');
        if (errDel) throw errDel;

        if (aEcrire.length) {
            const { error } = await supabaseClient.from('notes').insert(aEcrire);
            if (error) throw error;
        }

        showToast(aEcrire.length + ' note(s) enregistrée(s) pour ' + (MOIS_NOMS[mois] || ''), 'success');

    } catch (e) {
        console.error('Enregistrement compositions :', e);
        // Message parlant si le script SQL n'a pas ete execute.
        if (/mois|column|constraint|check/i.test(e.message || '')) {
            showToast('Exécutez compositions-mensuelles.sql : la colonne « mois » ' +
                      'ou le type manque en base.', 'error', 10000);
        } else {
            showToast('Erreur : ' + (e.message || ''), 'error');
        }
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Enregistrer'; }
    }
};

/**
 * Releve mensuel imprimable, avec classement.
 * La moyenne est ponderee par les coefficients — comme le bulletin —
 * pour que les deux chiffres restent comparables par les familles.
 * Les ex aequo partagent le meme rang, a 0,01 pres.
 */
window.imprimerReleveCompo = function () {
    if (!_compoEleves.length || !_compoMatieres.length) return;

    const mois = parseInt(document.getElementById('compoMois')?.value) || 0;
    const classeNom = (_compoClasse && _compoClasse.nom) || '';
    const annee = (typeof anneeDocument === 'function') ? anneeDocument() : '';
    const esc = s => String(s == null ? '' : s)
        .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

    // Etat courant, y compris les notes non encore enregistrees.
    sauverColonneCompo();
    const notes = _compoNotes;

    // Moyenne ponderee par eleve
    const lignes = _compoEleves.map(function (e) {
        let points = 0, coefs = 0;
        const parMatiere = {};
        _compoMatieres.forEach(function (m) {
            const v = notes[e.id + '|' + m.id];
            parMatiere[m.id] = v;
            if (v != null) { points += v * m.coef; coefs += m.coef; }
        });
        return {
            eleve: e, parMatiere: parMatiere,
            moyenne: coefs > 0 ? points / coefs : null,
            coefs: coefs
        };
    });

    // Classement : les eleves sans aucune note ne sont pas classes.
    const classes = lignes.filter(l => l.moyenne != null)
                          .sort((a, b) => b.moyenne - a.moyenne);
    let rang = 0, precedente = null;
    classes.forEach(function (l, i) {
        if (precedente === null || Math.abs(precedente - l.moyenne) >= 0.01) rang = i + 1;
        l.rang = rang;
        precedente = l.moyenne;
    });
    const effectif = classes.length;
    const moyClasse = effectif
        ? classes.reduce((s, l) => s + l.moyenne, 0) / effectif : 0;

    const corps = lignes
        .sort((a, b) => (a.moyenne == null) - (b.moyenne == null) ||
                        (b.moyenne || 0) - (a.moyenne || 0))
        .map(function (l) {
            const cls = l.moyenne == null ? ' class="sansnote"' : '';
            return '<tr' + cls + '>' +
                '<td class="rg">' + (l.rang || '—') + '</td>' +
                '<td class="el">' + esc((l.eleve.last_name || '') + ' ' + (l.eleve.first_name || '')) +
                    '<br><small>' + esc(l.eleve.matricule || '') + '</small></td>' +
                _compoMatieres.map(function (m) {
                    const v = l.parMatiere[m.id];
                    return '<td class="nt">' + (v != null ? v.toFixed(2) : '—') + '</td>';
                }).join('') +
                '<td class="moy">' + (l.moyenne != null ? l.moyenne.toFixed(2) : '—') + '</td>' +
            '</tr>';
        }).join('');

    const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
    '<title>Composition mensuelle — ' + esc(classeNom) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">' +
    '<style>' +
    // Paysage : une colonne par matiere, le portrait serait trop etroit.
    '@page{size:A4 landscape;margin:10mm}' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:Inter,Arial,sans-serif;color:#2A211D;font-size:9pt;' +
      '-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.tete{display:flex;justify-content:space-between;align-items:flex-end;' +
      'border-bottom:2px solid #5D4037;padding-bottom:6px;margin-bottom:4px}' +
    '.tete h1{font-family:Fraunces,serif;font-size:15pt;color:#3E2723;font-weight:600}' +
    '.tete .sub{font-size:9pt;color:#7A6A63;margin-top:2px}' +
    '.tete .meta{text-align:right;font-size:8.5pt;color:#5D4037}' +
    '.avert{background:#FAF8F7;border-left:3px solid #8D6E63;padding:5px 8px;' +
      'margin:8px 0;font-size:8pt;color:#5D4037}' +
    'table{width:100%;border-collapse:collapse;margin-top:6px}' +
    'th{background:#5D4037;color:#fff;padding:5px 4px;font-size:8pt;font-weight:600;' +
      'text-align:center;border:.5pt solid #4E342E}' +
    'th.el{text-align:left;min-width:52mm}' +
    'td{padding:4px;border:.5pt solid #E3D9D4;text-align:center}' +
    'td.el{text-align:left;font-weight:600}' +
    'td.el small{color:#7A6A63;font-weight:400;font-size:7pt}' +
    'td.rg{font-weight:700;color:#5D4037;width:10mm}' +
    'td.moy{font-weight:700;color:#3E2723;background:#EFEBE9}' +
    'tr.sansnote{color:#A1887F;font-style:italic}' +
    'tr:nth-child(even) td{background:#FAF8F7}' +
    'tr:nth-child(even) td.moy{background:#E8E2DE}' +
    '.pied{display:flex;justify-content:space-between;margin-top:14px;font-size:8.5pt;color:#5D4037}' +
    '.sig{margin-top:16mm;border-top:.5pt solid #5D4037;padding-top:3px;width:55mm;text-align:center}' +
    '@media print{.no-print{display:none!important}}' +
    '</style></head><body>' +
    '<div class="tete">' +
      '<div><h1>Composition mensuelle</h1>' +
      '<div class="sub">' + esc(classeNom) + ' — ' + esc(MOIS_NOMS[mois] || '') + ' ' + esc(annee) + '</div></div>' +
      '<div class="meta">Effectif classé : <strong>' + effectif + '</strong><br>' +
        'Moyenne de la classe : <strong>' + moyClasse.toFixed(2) + ' / 20</strong></div>' +
    '</div>' +
    '<div class="avert">Ce relevé est un document de suivi interne. ' +
      'Ces notes n\'entrent pas dans la moyenne du trimestre ni sur le bulletin.</div>' +
    '<table><thead><tr><th>Rang</th><th class="el">Élève</th>' +
      _compoMatieres.map(m => '<th>' + esc(m.nom) + '<br><small>coef ' + m.coef + '</small></th>').join('') +
      '<th>Moyenne</th></tr></thead><tbody>' + corps + '</tbody></table>' +
    '<div class="pied"><div>Édité le ' + new Date().toLocaleDateString('fr-FR') + '</div>' +
      '<div class="sig">Le Directeur</div></div>' +
    '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},500);};</scr' + 'ipt>' +
    '</body></html>';

    ouvrirImpression(html, 1100, 760);
};

/**
 * Affiche la colonne d'une matiere : un champ par eleve, comme la page
 * Notes. Les valeurs des autres matieres restent en memoire.
 */
window.ouvrirMatiereCompo = function (matiereId) {
    const zone = document.getElementById('compoColonne');
    if (!zone) return;

    // Sauvegarder la colonne affichee avant de changer
    sauverColonneCompo();

    const m = _compoMatieres.find(x => x.id === matiereId);
    if (!m) return;

    document.querySelectorAll('.compo-onglet').forEach(function (b) {
        b.classList.toggle('actif', b.dataset.matiere === matiereId);
    });

    zone.innerHTML =
        '<div class="compo-entete">' +
          '<div><strong>' + m.nom + '</strong> <span style="color:#7A6A63;">· coefficient ' + m.coef + '</span></div>' +
          '<div class="compo-aide">Entrée ou ↓ pour passer à l\'élève suivant</div>' +
        '</div>' +
        '<table class="data-table"><thead><tr>' +
          '<th style="width:46px;">N°</th><th>Élève</th>' +
          '<th style="width:130px;text-align:center;">Note / 20</th>' +
        '</tr></thead><tbody>' +
        _compoEleves.map(function (e, i) {
            const v = _compoNotes[e.id + '|' + matiereId];
            return '<tr>' +
                '<td>' + (i + 1) + '</td>' +
                '<td><strong>' + (e.last_name || '') + ' ' + (e.first_name || '') + '</strong>' +
                  '<br><small style="color:#7A6A63;">' + (e.matricule || '') + '</small></td>' +
                '<td style="text-align:center;">' +
                  '<input type="number" inputmode="decimal" min="0" max="20" step="0.25" ' +
                    'class="compo-note" data-eleve="' + e.id + '" data-matiere="' + matiereId + '" ' +
                    'value="' + (v != null ? v : '') + '" placeholder="/20" ' +
                    'onchange="validerNoteCompo(this)" onkeydown="naviguerCompo(event,this)">' +
                '</td></tr>';
        }).join('') +
        '</tbody></table>';

    // Le premier champ vide prend le focus : la saisie commence sans clic.
    const champs = zone.querySelectorAll('.compo-note');
    for (const c of champs) { if (!c.value) { c.focus(); break; } }
};

// Memorise la colonne affichee avant de basculer sur une autre matiere.
function sauverColonneCompo() {
    document.querySelectorAll('#compoColonne .compo-note').forEach(function (c) {
        const cle = c.dataset.eleve + '|' + c.dataset.matiere;
        if (c.value === '') delete _compoNotes[cle];
        else {
            const v = parseFloat(c.value);
            if (!isNaN(v)) _compoNotes[cle] = v;
        }
    });
    majPastillesCompo();
}

// Compteur « 12/30 » sur chaque onglet : on voit d'un coup d'oeil ce
// qui reste a saisir.
function majPastillesCompo() {
    document.querySelectorAll('.compo-onglet').forEach(function (b) {
        const id = b.dataset.matiere;
        const n = _compoEleves.filter(e => _compoNotes[e.id + '|' + id] != null).length;
        const p = b.querySelector('.pastille');
        if (p) {
            p.textContent = n + '/' + _compoEleves.length;
            p.classList.toggle('ok', n === _compoEleves.length);
        }
    });
}

/**
 * Navigation au clavier : Entree et fleche bas passent a l'eleve suivant,
 * fleche haut remonte. Trente notes se saisissent sans toucher la souris.
 */
window.naviguerCompo = function (e, input) {
    const champs = Array.from(document.querySelectorAll('#compoColonne .compo-note'));
    const i = champs.indexOf(input);
    if (i === -1) return;

    if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        const suivant = champs[i + 1];
        if (suivant) { suivant.focus(); suivant.select(); }
        else {
            // Dernier eleve : on bascule sur la matiere suivante.
            const idx = _compoMatieres.findIndex(m => m.id === input.dataset.matiere);
            const mSuivante = _compoMatieres[idx + 1];
            if (mSuivante) {
                showToast('Matière suivante : ' + mSuivante.nom, 'info', 2500);
                ouvrirMatiereCompo(mSuivante.id);
            } else {
                input.blur();
                showToast('Dernière matière terminée', 'success', 2500);
            }
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const precedent = champs[i - 1];
        if (precedent) { precedent.focus(); precedent.select(); }
    }
};

window.validerNoteCompo = function (input) {
    const v = parseFloat(input.value);
    if (input.value === '') { input.style.borderColor = '#E3D9D4'; return; }
    if (isNaN(v) || v < 0 || v > 20) {
        input.style.borderColor = '#B23B2E';
        showToast('Une note doit être comprise entre 0 et 20', 'error');
    } else {
        input.style.borderColor = '#A5D6A7';
    }
};

async function initCartesPage() {
    const select = document.getElementById('carteClasse');
    if (!select) return;

    try {
        const { data: classes, error } = await supabaseClient
            .from('classes').select('id, nom').order('nom');
        if (error) throw error;

        // Les classes de 9e d'abord : ce sont les seules concernees aujourd'hui.
        const est9e = c => /(^|\s)9\s*(e|è|ème)?\b/i.test(c.nom || '');
        const neuf = (classes || []).filter(est9e);
        const autres = (classes || []).filter(c => !est9e(c));

        let html = '<option value="">Choisir une classe</option>';
        if (neuf.length) {
            html += '<optgroup label="Candidats au DEF">' +
                neuf.map(c => '<option value="' + c.id + '">' + c.nom + '</option>').join('') +
                '</optgroup>';
        }
        if (autres.length) {
            html += '<optgroup label="Autres classes">' +
                autres.map(c => '<option value="' + c.id + '">' + c.nom + '</option>').join('') +
                '</optgroup>';
        }
        select.innerHTML = html;

        // S'il n'y a qu'une classe de 9e, on la selectionne d'office.
        if (neuf.length === 1) {
            select.value = neuf[0].id;
            await chargerElevesCartes();
        }
    } catch (e) {
        console.error('Classes (cartes) :', e);
        showToast('Classes non chargées', 'error');
    }
}

/**
 * Imprime les cartes de la classe selectionnee.
 *
 * Format bancaire ISO 7810 ID-1 : 85,6 x 54 mm. Dix cartes par feuille A4
 * (2 colonnes x 5 rangees), avec traits de decoupe — c'est ainsi que les
 * ecoles de Bamako procedent : papier cartonne, decoupe, plastification
 * chez un prestataire du quartier.
 */
window.imprimerCartes = async function () {
    if (!_elevesCartes.length) {
        showToast('Aucun élève à imprimer', 'error');
        return;
    }
    if (typeof QRCode === 'undefined') {
        showToast('Bibliothèque QR non chargée — rechargez la page (Ctrl+F5)', 'error');
        return;
    }

    // Le nom et le TELEPHONE de l'ecole, lus en base : window.ecoleData
    // n'est pas expose globalement, et le numero doit figurer sur la carte
    // pour qu'un document trouve puisse etre rendu sans avoir a scanner.
    let nomEcole = 'École Privée Moussa Koné';
    let telEcole = null;
    try {
        const { data: pe } = await supabaseClient
            .from('parametres_ecole').select('nom, telephone').limit(1).maybeSingle();
        if (pe) {
            nomEcole = pe.nom || nomEcole;
            telEcole = pe.telephone || null;
        }
    } catch (err) { console.warn('Contact école :', err && err.message); }

    const classeNom = (_classeCarte && _classeCarte.nom) || '';

    const esc = s => String(s == null ? '' : s)
        .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const dat = d => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

    // Validité de 2 ans : usage malien. La carte ne mentionne donc NI
    // l'année scolaire seule, NI le statut « candidat au DEF » — celui-ci
    // change chaque année et rendrait la carte fausse dès la rentrée suivante.
    const aujourdHui = new Date();
    const expiration = new Date(aujourdHui);
    expiration.setFullYear(expiration.getFullYear() + 2);
    const periode = aujourdHui.getFullYear() + ' – ' + expiration.getFullYear();

    showToast('Génération des cartes…', 'info', 3000);

    // Jetons de vérification : indispensables au QR. Requête séparée,
    // `students_with_balance` ne porte pas cette colonne.
    let jetons = {};
    try {
        const ids = _elevesCartes.map(e => e.id);
        const { data } = await supabaseClient
            .from('students').select('id, carte_token').in('id', ids);
        (data || []).forEach(s => { jetons[s.id] = s.carte_token; });
    } catch (err) {
        console.warn('Jetons de carte non chargés :', err && err.message);
    }

    const manquants = _elevesCartes.filter(e => !jetons[e.id]).length;
    if (manquants === _elevesCartes.length) {
        showToast('Exécutez verification-cartes.sql : aucun jeton en base.', 'error', 9000);
        return;
    }

    // Le QR est produit en <img> data-URL : un <canvas> perdrait son
    // contenu à la copie du HTML vers la fenêtre d'impression.
    function qrDataUrl(texte) {
        const tampon = document.createElement('div');
        tampon.style.display = 'none';
        document.body.appendChild(tampon);
        try {
            new QRCode(tampon, {
                text: texte, width: 132, height: 132,
                colorDark: '#3E2723', colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
            const c = tampon.querySelector('canvas');
            return c ? c.toDataURL('image/png') : null;
        } catch (e) {
            console.warn('QR :', e);
            return null;
        } finally {
            tampon.remove();
        }
    }

    const cartes = _elevesCartes.map(function (e) {
        const init = ((e.last_name || '?')[0] + (e.first_name || '')[0] || '?').toUpperCase();
        const jeton = jetons[e.id];
        const qr = jeton
            ? qrDataUrl('https://epmk.netlify.app/pages/verifier-carte.html?c=' + jeton)
            : null;

        return '' +
        '<div class="carte">' +
          '<div class="bande">' +
            '<div class="blason">EPMK</div>' +
            '<div class="ecole">' +
              '<div class="ecole-nom">' + esc(nomEcole) + '</div>' +
              '<div class="ecole-sub">Carte scolaire</div>' +
            '</div>' +
          '</div>' +
          '<div class="filet"></div>' +
          '<div class="corps">' +
            '<div class="photo">' +
              (e._photo ? '<img src="' + esc(e._photo) + '" alt="">'
                        : '<span class="init">' + esc(init) + '</span>') +
            '</div>' +
            '<div class="infos">' +
              '<div class="nom">' + esc(e.last_name || '') + '</div>' +
              '<div class="prenom">' + esc(e.first_name || '') + '</div>' +
              '<table class="det">' +
                '<tr><td>Matricule</td><th>' + esc(e.matricule || '—') + '</th></tr>' +
                '<tr><td>Classe</td><th>' + esc(classeNom) + '</th></tr>' +
                '<tr><td>Né(e) le</td><th>' + dat(e.birth_date) + '</th></tr>' +
              '</table>' +
            '</div>' +
            '<div class="qr">' +
              (qr ? '<img src="' + qr + '" alt="">' : '<div class="qr-vide">—</div>') +
              '<div class="qr-lbl">Vérifier</div>' +
            '</div>' +
          '</div>' +
          '<div class="pied">' +
            '<span class="valid">Valable ' + periode + '</span>' +
            (telEcole
                ? '<span class="tel"><i class="ico">✆</i> ' + esc(telEcole) + '</span>'
                : '') +
            '<span class="sig">Le Directeur</span>' +
          '</div>' +
        '</div>';
    }).join('');

    const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
    '<title>Cartes scolaires — ' + esc(classeNom) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">' +
    '<style>' +
    // 5 rangees x 54mm + 4 espaces de 3mm = 282mm, pour 285mm utiles.
    '@page{size:A4 portrait;margin:6mm 10mm}' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:Inter,Arial,sans-serif;background:#fff;' +
      '-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.feuille{display:grid;grid-template-columns:repeat(2,85.6mm);gap:3mm 8mm;justify-content:center}' +
    // Format bancaire ISO 7810 ID-1.
    '.carte{width:85.6mm;height:54mm;border:1px dashed #cfc6c1;border-radius:3mm;' +
      'overflow:hidden;display:flex;flex-direction:column;background:#fff;page-break-inside:avoid}' +
    // Marron et blanc : les couleurs de l\'ecole, celles de la tenue.
    '.bande{background:linear-gradient(135deg,#3E2723,#5D4037);color:#fff;padding:2.2mm 3mm;' +
      'display:flex;align-items:center;gap:2.5mm}' +
    '.blason{width:8mm;height:8mm;border-radius:50%;background:rgba(255,255,255,.12);' +
      'border:.4mm solid rgba(215,204,200,.55);display:flex;align-items:center;justify-content:center;' +
      'font-family:Fraunces,serif;font-size:2.3mm;font-weight:600;flex-shrink:0}' +
    '.ecole-nom{font-family:Fraunces,serif;font-size:3mm;font-weight:600;line-height:1.15}' +
    '.ecole-sub{font-size:2.1mm;color:#D7CCC8;letter-spacing:.5px;margin-top:.4mm;text-transform:uppercase}' +
    '.filet{height:.8mm;background:#8D6E63}' +
    '.corps{flex:1;display:flex;gap:2.6mm;padding:2.6mm 3mm}' +
    '.photo{width:17mm;height:22mm;border-radius:1.4mm;overflow:hidden;background:#EFEBE9;' +
      'border:.3mm solid #D7CCC8;display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '.photo img{width:100%;height:100%;object-fit:cover}' +
    '.init{font-family:Fraunces,serif;font-size:6.5mm;font-weight:600;color:#8D6E63}' +
    '.infos{flex:1;min-width:0;display:flex;flex-direction:column}' +
    '.nom{font-family:Fraunces,serif;font-size:3.7mm;font-weight:600;color:#3E2723;' +
      'text-transform:uppercase;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.prenom{font-size:3mm;color:#2A211D;margin-bottom:1.4mm;white-space:nowrap;' +
      'overflow:hidden;text-overflow:ellipsis}' +
    '.det{width:100%;border-collapse:collapse;font-size:2.3mm}' +
    '.det td{color:#7A6A63;padding:.45mm 0;width:14mm}' +
    '.det th{text-align:left;font-weight:600;color:#2A211D;padding:.45mm 0}' +
    '.qr{width:14mm;flex-shrink:0;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:.5mm}' +
    '.qr img{width:13mm;height:13mm;display:block}' +
    '.qr-vide{width:13mm;height:13mm;border:.3mm dashed #D7CCC8;border-radius:1mm;' +
      'display:grid;place-items:center;color:#D7CCC8;font-size:3mm}' +
    '.qr-lbl{font-size:1.7mm;color:#7A6A63;text-transform:uppercase;letter-spacing:.2px}' +
    '.pied{background:#FAF8F7;border-top:.3mm solid #E3D9D4;padding:1.5mm 3mm;' +
      'display:flex;justify-content:space-between;align-items:center}' +
    // Trois elements dans 79,6 mm utiles : les corps sont resserres et
    // le pied passe en `space-between` avec un ecart minimal.
    '.pied>*{white-space:nowrap}' +
    '.valid{font-size:2.1mm;font-weight:700;color:#3E2723;background:#EFEBE9;' +
      'padding:.5mm 1.4mm;border-radius:1mm;letter-spacing:.1px}' +
    '.tel{font-size:2.1mm;font-weight:600;color:#5D4037}' +
    '.tel .ico{font-style:normal;color:#8D6E63;margin-right:.4mm}' +
    '.sig{font-size:2.1mm;color:#7A6A63;font-style:italic}' +
    '@media print{.no-print{display:none!important}}' +
    '</style></head><body>' +
    '<div class="no-print" style="text-align:center;padding:14px;background:#EFEBE9;' +
      'font-size:13px;color:#5D4037;margin-bottom:10px;">' +
      '<strong>' + _elevesCartes.length + ' carte(s)</strong> — ' + esc(classeNom) +
      ' · Valables ' + periode + ' · Papier cartonné, découpe suivant les pointillés, plastification. ' +
      '<button onclick="window.print()" style="margin-left:10px;padding:6px 14px;border:none;' +
      'border-radius:6px;background:#5D4037;color:#fff;cursor:pointer;">Imprimer</button></div>' +
    '<div class="feuille">' + cartes + '</div>' +
    '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},700);};</scr' + 'ipt>' +
    '</body></html>';

    ouvrirImpression(html, 1000, 760);

    // Trace de l'emission : la validite de 2 ans se compte a partir de la.
    try {
        await supabaseClient.from('students')
            .update({ carte_emise_le: new Date().toISOString().slice(0, 10) })
            .in('id', _elevesCartes.map(e => e.id));
    } catch (err) {
        console.warn('Date d\'émission non enregistrée :', err && err.message);
    }
};

window.chargerElevesCartes = async function () {
    const select = document.getElementById('carteClasse');
    const liste = document.getElementById('cartesListe');
    const compteur = document.getElementById('cartesCompteur');
    const bouton = document.getElementById('btnImprimerCartes');
    const alerte = document.getElementById('cartesAlerte');
    if (!select || !liste) return;

    const classeId = select.value;
    _elevesCartes = [];
    if (bouton) bouton.disabled = true;
    if (alerte) alerte.innerHTML = '';

    if (!classeId) {
        liste.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:36px 0;">' +
            'Choisissez une classe pour afficher ses élèves.</p>';
        if (compteur) compteur.textContent = '0';
        return;
    }

    liste.innerHTML = '<p style="text-align:center;color:#7A6A63;padding:36px 0;">' +
        '<i class="fas fa-spinner fa-spin"></i> Chargement…</p>';

    try {
        const { data: c } = await supabaseClient
            .from('classes').select('id, nom').eq('id', classeId).maybeSingle();
        _classeCarte = c;

        const { data: eleves, error } = await supabaseClient
            .from('students')
            .select('id, first_name, last_name, matricule, birth_date, gender, photo_url, status')
            .eq('class_id', classeId)
            .order('last_name');
        if (error) throw error;

        _elevesCartes = (eleves || []).filter(e => !e.status || e.status === 'actif');

        if (!_elevesCartes.length) {
            liste.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:36px 0;">' +
                'Aucun élève actif dans cette classe.</p>';
            if (compteur) compteur.textContent = '0';
            return;
        }

        // Signature des photos en parallele : elles vivent dans un bucket prive.
        await Promise.all(_elevesCartes.map(async function (e) {
            e._photo = await urlPhotoEleve(e.photo_url);
        }));

        const sansPhoto = _elevesCartes.filter(e => !e._photo).length;
        if (sansPhoto && alerte) {
            alerte.innerHTML =
                '<div style="background:#FAF8F7;border:1.5px solid #D7CCC8;border-left:5px solid #8D6E63;' +
                'border-radius:12px;padding:13px 16px;margin-bottom:18px;font-size:.88rem;color:#5D4037;">' +
                '<i class="fas fa-circle-info"></i> <strong>' + sansPhoto + ' élève(s) sans photo.</strong> ' +
                'Leur carte affichera les initiales. Ajoutez la photo depuis la fiche de l\'élève ' +
                'pour un rendu complet.</div>';
        }

        liste.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;">' +
            _elevesCartes.map(function (e) {
                const init = ((e.last_name || '?')[0] + (e.first_name || '')[0] || '?').toUpperCase();
                return '<div style="display:flex;align-items:center;gap:10px;padding:10px;' +
                    'border:1px solid #E3D9D4;border-radius:10px;background:#fff;">' +
                    (e._photo
                        ? '<img src="' + e._photo + '" alt="" style="width:42px;height:42px;' +
                          'border-radius:8px;object-fit:cover;flex-shrink:0;">'
                        : '<div style="width:42px;height:42px;border-radius:8px;background:#EFEBE9;' +
                          'display:grid;place-items:center;color:#8D6E63;font-weight:700;font-size:.8rem;' +
                          'flex-shrink:0;">' + init + '</div>') +
                    '<div style="min-width:0;">' +
                      '<div style="font-weight:600;font-size:.86rem;white-space:nowrap;overflow:hidden;' +
                        'text-overflow:ellipsis;">' + (e.last_name || '') + ' ' + (e.first_name || '') + '</div>' +
                      '<div style="font-size:.75rem;color:#7A6A63;">' + (e.matricule || '—') + '</div>' +
                    '</div></div>';
            }).join('') + '</div>';

        if (compteur) compteur.textContent = _elevesCartes.length;
        if (bouton) bouton.disabled = false;

    } catch (e) {
        console.error('Élèves (cartes) :', e);
        liste.innerHTML = '<p style="text-align:center;color:#B23B2E;padding:36px 0;">' +
            'Chargement impossible : ' + (e.message || '') + '</p>';
    }
};

window.voirFicheEleve = async function (eleveId) {
    if (!eleveId) return;

    let m = document.getElementById('ficheEleveModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'ficheEleveModal';
        m.className = 'modal';
        document.body.appendChild(m);
    }
    m.innerHTML = '<div class="modal-content" style="max-width:820px;">' +
        '<div class="modal-body" style="text-align:center;padding:60px 20px;color:#7A6A63;">' +
        '<i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i>' +
        '<div style="margin-top:12px;">Chargement de la fiche…</div></div></div>';
    m.style.display = 'flex';

    try {
        // ── Élève ──
        const { data: e, error } = await supabaseClient
            .from('students').select('*').eq('id', eleveId).single();
        if (error || !e) throw error || new Error('Élève introuvable');

        // ── Classe ──
        let classe = null;
        if (e.class_id) {
            const { data: c } = await supabaseClient
                .from('classes').select('nom, frais_inscription, frais_scolarite')
                .eq('id', e.class_id).maybeSingle();
            classe = c;
        }

        // ── Parents rattachés ──
        let parents = [];
        try {
            const { data: liens } = await supabaseClient
                .from('parent_students').select('parent_id').eq('student_id', eleveId);
            const ids = (liens || []).map(l => l.parent_id).filter(Boolean);
            if (ids.length) {
                const { data: ps } = await supabaseClient
                    .from('parents').select('id, first_name, last_name, phone, email').in('id', ids);
                parents = ps || [];
            }
        } catch (err) { console.warn('Parents :', err && err.message); }

        // ── Paiements ──
        let paiements = [];
        try {
            const { data: p } = await supabaseClient
                .from('payments').select('amount, type, date, status')
                .eq('student_id', eleveId).order('date', { ascending: false });
            paiements = p || [];
        } catch (err) { console.warn('Paiements :', err && err.message); }

        const valides = paiements.filter(p => !p.status || p.status === 'completed');
        const enAttente = paiements.filter(p => p.status === 'pending');
        const paye = valides
            .filter(p => p.type === 'inscription' || p.type === 'scolarite')
            .reduce((s, p) => s + (parseInt(p.amount) || 0), 0);
        const du = (parseInt(classe?.frais_inscription) || 0) + (parseInt(classe?.frais_scolarite) || 0);
        const solde = du - paye;

        // ── Absences ──
        let absences = 0, retards = 0;
        try {
            const { data: pr } = await supabaseClient
                .from('presences').select('status').eq('student_id', eleveId);
            absences = (pr || []).filter(x => x.status === 'absent').length;
            retards  = (pr || []).filter(x => x.status === 'retard').length;
        } catch (err) { console.warn('Présences :', err && err.message); }

        // ── Rendu ──
        const fmt = n => (parseInt(n) || 0).toLocaleString('fr-FR') + ' FCFA';
        const dat = d => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
        const esc = s => String(s == null ? '' : s)
            .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

        const ligne = (lbl, val) =>
            '<div style="display:flex;justify-content:space-between;gap:14px;padding:8px 0;' +
            'border-bottom:1px solid #F3EEEB;">' +
            '<span style="color:#7A6A63;font-size:.85rem;">' + lbl + '</span>' +
            '<span style="font-weight:600;text-align:right;">' + (val || '—') + '</span></div>';

        const carte = (titre, icone, contenu) =>
            '<div style="background:#fff;border:1px solid #E3D9D4;border-radius:12px;' +
            'padding:16px 18px;margin-bottom:14px;">' +
            '<h4 style="margin:0 0 10px;color:#4E342E;font-size:.95rem;' +
            'display:flex;align-items:center;gap:.5rem;">' +
            '<i class="fas ' + icone + '" style="color:#8D6E63;"></i>' + titre + '</h4>' +
            contenu + '</div>';

        // photo_url contient soit une URL heritee, soit un chemin dans le
        // bucket prive : urlPhotoEleve() gere les deux cas.
        const photoAffichable = await urlPhotoEleve(e.photo_url);

        const nbPieces = _piecesComptees(e.pieces_recues);
        const totalPieces = (typeof PIECES_ATTENDUES !== 'undefined') ? PIECES_ATTENDUES.length : 4;

        const html =
        '<div class="modal-content" style="max-width:820px;">' +
          '<div class="modal-header">' +
            '<h3><i class="fas fa-id-card"></i> Fiche de l\'élève</h3>' +
            '<button class="close-modal" onclick="closeModal(\'ficheEleveModal\')">&times;</button>' +
          '</div>' +
          '<div class="modal-body" style="background:#FAF8F7;">' +

            '<div style="display:flex;align-items:center;gap:16px;margin-bottom:18px;">' +
              (photoAffichable
                ? '<img src="' + esc(photoAffichable) + '" alt="" style="width:74px;height:74px;' +
                  'border-radius:50%;object-fit:cover;border:3px solid #D7CCC8;">'
                : '<div style="width:74px;height:74px;border-radius:50%;background:' +
                  'linear-gradient(135deg,#5D4037,#8D6E63);color:#fff;display:grid;' +
                  'place-items:center;font-weight:700;font-size:1.4rem;">' +
                  esc((e.last_name || '?')[0] + (e.first_name || '')[0] || '?') + '</div>') +
              '<div>' +
                // Changer la photo sans quitter la fiche : c'est ici qu'on
                // s'apercoit qu'elle manque ou qu'elle est mauvaise.
                '<button class="btn btn-sm btn-secondary" ' +
                  'onclick="changerPhotoEleve(\'' + eleveId + '\')" ' +
                  'style="margin-bottom:6px;">' +
                  '<i class="fas fa-camera"></i> ' +
                  (photoAffichable ? 'Changer la photo' : 'Ajouter une photo') +
                '</button>' +
                '<div style="font-family:Fraunces,serif;font-size:1.35rem;font-weight:600;color:#3E2723;">' +
                  esc(e.last_name) + ' ' + esc(e.first_name) + '</div>' +
                '<div style="color:#7A6A63;font-size:.9rem;">' +
                  esc(e.matricule || 'Sans matricule') +
                  (classe ? ' · ' + esc(classe.nom) : '') + '</div>' +
              '</div>' +
            '</div>' +

            carte('Identité', 'fa-child',
                ligne('Date de naissance', dat(e.birth_date)) +
                ligne('Sexe', e.gender === 'M' ? 'Masculin' : (e.gender === 'F' ? 'Féminin' : '—')) +
                ligne('Matricule', esc(e.matricule)) +
                ligne('Statut', esc(e.status || 'actif')) +
                ligne('Inscrit le', dat(e.date_inscription || e.created_at))) +

            carte('Famille', 'fa-users',
                (parents.length
                    ? parents.map(p =>
                        '<div style="display:flex;justify-content:space-between;align-items:center;' +
                          'gap:12px;padding:9px 0;border-bottom:1px solid #F3EEEB;">' +
                          '<div><div style="font-weight:600;">' +
                            esc((p.last_name || '') + ' ' + (p.first_name || '')) + '</div>' +
                            '<div style="font-size:.82rem;color:#7A6A63;">' +
                            esc(p.phone || p.email || '—') + '</div></div>' +
                          '<button class="btn btn-sm btn-danger" title="Détacher ce parent" ' +
                            'onclick="detacherParent(\'' + eleveId + '\',\'' + p.id + '\')">' +
                            '<i class="fas fa-link-slash"></i></button>' +
                        '</div>').join('')
                    : '<p style="color:#B23B2E;font-size:.86rem;margin:0 0 12px;">' +
                      '<i class="fas fa-triangle-exclamation"></i> Aucun parent rattaché — ' +
                      'cet élève n\'apparaîtra sur aucun portail.</p>') +
                // Rattacher un parent sans quitter la fiche : c'est ici qu'on
                // s'apercoit qu'il en manque un.
                '<button class="btn btn-sm btn-primary" style="margin-top:12px;" ' +
                  'onclick="ouvrirLiaisonParent(\'' + eleveId + '\')">' +
                  '<i class="fas fa-user-plus"></i> Rattacher un parent</button>') +

            carte('Situation financière', 'fa-money-bill-wave',
                ligne('Frais dus (inscription + scolarité)', fmt(du)) +
                ligne('Réglé', '<span style="color:#2E7D32;">' + fmt(paye) + '</span>') +
                ligne(solde > 0 ? 'Reste à payer' : 'Trop-perçu',
                      '<span style="color:' + (solde > 0 ? '#B23B2E' : '#2E7D32') + ';">' +
                      fmt(Math.abs(solde)) + '</span>') +
                (enAttente.length
                    ? ligne('En attente de validation',
                        '<span style="color:#B7791F;">' + enAttente.length + ' déclaration(s)</span>')
                    : '') +
                ligne('Nombre de versements', valides.length)) +

            carte('Assiduité', 'fa-calendar-check',
                ligne('Absences enregistrées', absences) +
                ligne('Retards', retards)) +

            carte('Dossier — pièces originales', 'fa-folder-open',
                '<div style="display:flex;justify-content:space-between;align-items:center;' +
                  'margin:-4px 0 12px;">' +
                  '<span style="font-size:.85rem;color:' +
                    (nbPieces === totalPieces ? '#2E7D32' : '#B7791F') + ';font-weight:600;">' +
                    nbPieces + ' pièce(s) sur ' + totalPieces + (nbPieces === totalPieces ? ' — complet' : '') +
                  '</span>' +
                  '<button class="btn btn-sm btn-secondary" ' +
                    'onclick="window._retourFicheEleve=\'' + eleveId + '\';closeModal(\'ficheEleveModal\');' +
                    'gererPieces(\'' + eleveId + '\')">' +
                    '<i class="fas fa-pen-to-square"></i> Modifier</button>' +
                '</div>' +
                // Le compteur seul ne disait pas QUELLE piece manquait :
                // le secretariat devait ouvrir un second ecran pour le savoir.
                PIECES_ATTENDUES.map(function (p) {
                    const info = (e.pieces_recues || {})[p[0]];
                    const recu = !!(info && info.recu);
                    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;' +
                        'border-bottom:1px solid #F3EEEB;">' +
                        '<i class="fas ' + (recu ? 'fa-circle-check' : 'fa-circle') + '" ' +
                            'style="color:' + (recu ? '#2E7D32' : '#D7CCC8') + ';font-size:.9rem;"></i>' +
                        '<span style="flex:1;font-size:.88rem;color:' +
                            (recu ? '#2A211D' : '#7A6A63') + ';">' + p[1] +
                            (p[3] ? '' : ' <small style="color:#A1887F;">(si applicable)</small>') +
                        '</span>' +
                        '<span style="font-size:.8rem;color:#7A6A63;white-space:nowrap;">' +
                            (recu
                                ? (info.date ? 'reçu le ' + new Date(info.date).toLocaleDateString('fr-FR') : 'reçu')
                                : 'en attente') +
                        '</span></div>';
                }).join('') +
                (e.pieces_notes
                    ? '<div style="margin-top:12px;padding:10px 12px;background:#FAF8F7;' +
                      'border-left:3px solid #D7CCC8;border-radius:0 8px 8px 0;font-size:.85rem;' +
                      'color:#7A6A63;"><strong>Remarque :</strong> ' + esc(e.pieces_notes) + '</div>'
                    : '')) +

          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" onclick="closeModal(\'ficheEleveModal\')">Fermer</button> ' +
            '<button class="btn btn-secondary" onclick="closeModal(\'ficheEleveModal\');gererPieces(\'' + eleveId + '\')">' +
              '<i class="fas fa-folder-open"></i> Pièces</button> ' +
            '<button class="btn btn-primary" onclick="closeModal(\'ficheEleveModal\');editEleve(\'' + eleveId + '\')">' +
              '<i class="fas fa-pen-to-square"></i> Modifier</button>' +
          '</div>' +
        '</div>';

        m.innerHTML = html;

    } catch (err) {
        console.error('Fiche élève :', err);
        m.innerHTML = '<div class="modal-content" style="max-width:520px;">' +
            '<div class="modal-body" style="padding:40px 24px;text-align:center;">' +
            '<i class="fas fa-triangle-exclamation" style="font-size:2rem;color:#B23B2E;"></i>' +
            '<p style="margin-top:12px;">Impossible de charger la fiche.<br>' +
            '<small style="color:#7A6A63;">' + (err.message || '') + '</small></p>' +
            '<button class="btn btn-secondary" onclick="closeModal(\'ficheEleveModal\')">Fermer</button>' +
            '</div></div>';
    }
};

window.ouvrirDepuisRecherche = async function(type, id) {
    const box = document.getElementById('globalSearchResults');
    if (box) box.style.display = 'none';
    const input = document.getElementById('globalSearch');
    if (input) input.value = '';

    try {
        if (type === 'eleve') {
            // Vue d'ensemble en lecture plutot que le formulaire de modification :
            // on cherche une information, on ne veut pas risquer de la changer.
            await voirFicheEleve(id);
        } else if (type === 'prof') {
            await loadPage('enseignants');
            setTimeout(() => viewTeacher(id), 350);
        } else if (type === 'classe') {
            await loadPage('classes');
        }
    } catch (e) {
        console.error('Ouverture depuis la recherche:', e);
    }
};

// ============================================================
// RECHERCHE DANS LA LISTE DES PAIEMENTS
// ============================================================
(function initPaymentSearch() {
    function attach() {
        const input = document.getElementById('searchPaiement');
        if (!input) { setTimeout(attach, 600); return; }
        if (input._searchAttached) return;
        input._searchAttached = true;

        input.addEventListener('input', function() {
            const q = this.value.trim().toLowerCase();
            const rows = document.querySelectorAll('#paiementsTableBody tr[data-payment-id]');
            let visibles = 0;
            rows.forEach(row => {
                const txt = row.textContent.toLowerCase();
                const match = !q || txt.includes(q);
                row.style.display = match ? '' : 'none';
                if (match) visibles++;
            });
            // Message si aucun résultat
            let msg = document.getElementById('paySearchNoResult');
            if (q && visibles === 0) {
                if (!msg) {
                    const tbody = document.getElementById('paiementsTableBody');
                    msg = document.createElement('tr');
                    msg.id = 'paySearchNoResult';
                    msg.innerHTML = '<td colspan="7" style="text-align:center;padding:30px;color:#9ca3af;">Aucun paiement ne correspond à votre recherche.</td>';
                    tbody?.appendChild(msg);
                }
            } else if (msg) {
                msg.remove();
            }
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();
})();


// ============================================================
// MODIFIER UN PAIEMENT EXISTANT
// ============================================================
window.editPayment = async function(paymentId) {
    try {
        const { data: p, error } = await supabaseClient
            .from('payments_with_parents').select('*').eq('id', paymentId).single();
        if (error || !p) throw error || new Error('Paiement introuvable');

        let modal = document.getElementById('editPaymentModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'editPaymentModal'; modal.className = 'modal';
            document.body.appendChild(modal);
        }
        const opt = (v, cur, label) => `<option value="${v}" ${v===cur?'selected':''}>${label}</option>`;
        modal.innerHTML = `
            <div class="modal-content" style="max-width:520px;">
                <div class="modal-header" style="background:linear-gradient(135deg,#047857,#059669);">
                    <h3 style="color:#fff;"><i class="fas fa-pen"></i> Modifier le paiement</h3>
                    <button class="modal-close" onclick="closeModal('editPaymentModal')" style="color:#fff;">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="editPayId" value="${p.id}">
                    <div style="background:#f9fafb;padding:10px 12px;border-radius:8px;margin-bottom:14px;">
                        <strong>${p.student_last_name||''} ${p.student_first_name||''}</strong>
                        <small style="color:#6b7280;"> ${p.student_matricule||''}</small>
                    </div>
                    <div class="form-group"><label>Type</label>
                        <select id="editPayType" class="form-control">
                            ${opt('scolarite',p.type,'Scolarité')}${opt('inscription',p.type,'Inscription')}${opt('cantine',p.type,'Cantine')}${opt('uniforme',p.type,'Tenues')}${opt('autre',p.type,'Autre')}
                        </select>
                    </div>
                    <div class="form-group"><label>Montant (FCFA)</label>
                        <input type="number" id="editPayAmount" class="form-control" value="${parseInt(p.amount)||0}" min="1"></div>
                    <div class="form-group"><label>Méthode</label>
                        <select id="editPayMethod" class="form-control">
                            ${opt('especes',p.payment_method,'Espèces')}${opt('orange',p.payment_method,'Orange Money')}${opt('moov',p.payment_method,'Moov Money')}${opt('wave',p.payment_method,'Wave')}${opt('virement',p.payment_method,'Virement')}${opt('cheque',p.payment_method,'Chèque')}
                        </select>
                    </div>
                    <div class="form-group"><label>Référence</label>
                        <input type="text" id="editPayRef" class="form-control" value="${p.payment_ref||''}"></div>
                    <div class="form-group"><label>Date</label>
                        <input type="date" id="editPayDate" class="form-control" value="${p.date ? p.date.split('T')[0] : ''}"></div>
                </div>
                <div class="modal-footer" style="padding:14px 20px;border-top:1px solid #e5e7eb;text-align:right;">
                    <button class="btn btn-secondary" onclick="closeModal('editPaymentModal')">Annuler</button>
                    <button class="btn btn-primary" style="background:#047857;" onclick="saveEditPayment()"><i class="fas fa-save"></i> Enregistrer</button>
                </div>
            </div>`;
        openModal('editPaymentModal');
    } catch (e) {
        console.error('❌ editPayment:', e);
        showToast('Erreur lors du chargement', 'error');
    }
};

window.saveEditPayment = async function() {
    const id = document.getElementById('editPayId')?.value;
    const amount = parseInt(document.getElementById('editPayAmount')?.value) || 0;
    if (amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const update = {
        type: document.getElementById('editPayType')?.value,
        amount,
        payment_method: document.getElementById('editPayMethod')?.value,
        payment_ref: document.getElementById('editPayRef')?.value?.trim() || null,
        date: document.getElementById('editPayDate')?.value || null
    };
    try {
        const { data, error } = await supabaseClient.from('payments').update(update).eq('id', id).select('id');
        if (error) throw error;
        if (!data || !data.length) { showToast('Aucune ligne modifiée (droits RLS ?)', 'warning'); return; }
        showToast('Paiement modifié', 'success');
        closeModal('editPaymentModal');
        await loadPaymentsList();
        await updatePaymentStats();
    } catch (e) {
        console.error('❌ saveEditPayment:', e);
        showToast('Erreur : ' + (e.message || 'réessayez'), 'error');
    }
};


// ============================================================
// SITUATION FINANCIÈRE & VERSEMENT AVEC RÉPARTITION AUTO
// ============================================================
// Logique : on doit l'INSCRIPTION puis la SCOLARITÉ (en tranches).
// Un versement global est réparti : d'abord ce qui reste sur
// l'inscription, puis le reste sur la scolarité.

// Calcule la situation financière d'un élève pour une classe donnée
async function calculerSoldeEleve(studentId, classId) {
    // Frais de la classe
    const { data: classe } = await supabaseClient
        .from('classes').select('frais_inscription, frais_scolarite').eq('id', classId).single();
    const fraisInscription = parseInt(classe?.frais_inscription) || 0;
    const fraisScolarite = parseInt(classe?.frais_scolarite) || 0;

    // Frais optionnels de référence (cantine, tenues) depuis frais_additionnels
    let fraisCantine = 0, fraisTenues = 0;
    try {
        const { data: fa } = await supabaseClient
            .from('frais_additionnels').select('type, montant_annuel');
        (fa || []).forEach(f => {
            if (f.type === 'cantine') fraisCantine = parseInt(f.montant_annuel) || 0;
            else if (f.type === 'uniforme') fraisTenues = parseInt(f.montant_annuel) || 0;
        });
    } catch (_) {}

    // Paiements déjà effectués par l'élève
    const { data: paiements } = await supabaseClient
        .from('payments').select('type, amount').eq('student_id', studentId);

    let payeInscription = 0, payeScolarite = 0, payeCantine = 0, payeTenues = 0, payeAutre = 0;
    (paiements || []).forEach(p => {
        const m = parseInt(p.amount) || 0;
        if (p.type === 'inscription') payeInscription += m;
        else if (p.type === 'scolarite') payeScolarite += m;
        else if (p.type === 'cantine') payeCantine += m;
        else if (p.type === 'uniforme') payeTenues += m;
        else payeAutre += m;
    });

    const resteInscription = Math.max(0, fraisInscription - payeInscription);
    const resteScolarite = Math.max(0, fraisScolarite - payeScolarite);
    const totalDu = fraisInscription + fraisScolarite;
    const totalPaye = payeInscription + payeScolarite;
    const resteTotal = Math.max(0, totalDu - totalPaye);

    return {
        fraisInscription, fraisScolarite, totalDu,
        payeInscription, payeScolarite, totalPaye,
        resteInscription, resteScolarite, resteTotal,
        inscriptionSoldee: resteInscription === 0 && fraisInscription > 0,
        // Frais optionnels (suivis séparément, NON inclus dans le solde obligatoire)
        fraisCantine, payeCantine, resteCantine: Math.max(0, fraisCantine - payeCantine),
        fraisTenues, payeTenues, resteTenues: Math.max(0, fraisTenues - payeTenues)
    };
}
window.calculerSoldeEleve = calculerSoldeEleve;

// Répartit un montant global : d'abord inscription, puis scolarité
function repartirVersement(montant, solde) {
    const repartition = [];
    let reste = montant;
    // 1) Inscription d'abord
    if (solde.resteInscription > 0 && reste > 0) {
        const part = Math.min(reste, solde.resteInscription);
        repartition.push({ type: 'inscription', amount: part });
        reste -= part;
    }
    // 2) Puis scolarité
    if (solde.resteScolarite > 0 && reste > 0) {
        const part = Math.min(reste, solde.resteScolarite);
        repartition.push({ type: 'scolarite', amount: part });
        reste -= part;
    }
    // 3) Excédent éventuel (si le parent verse plus que dû) → scolarité (avance)
    if (reste > 0) {
        repartition.push({ type: 'scolarite', amount: reste, avance: true });
        reste = 0;
    }
    return repartition;
}
window.repartirVersement = repartirVersement;

// Affiche la situation financière sous le sélecteur d'élève
window.afficherSituationEleve = async function() {
    const studentId = document.getElementById('paymentStudent')?.value;
    const classId = document.getElementById('paymentClasse')?.value;
    const host = document.getElementById('situationFinanciere');
    if (!host) return;
    if (!studentId || !classId) { host.style.display = 'none'; return; }

    host.style.display = 'block';
    host.innerHTML = '<div style="padding:10px;color:#999;"><i class="fas fa-spinner fa-spin"></i> Calcul...</div>';
    try {
        const s = await calculerSoldeEleve(studentId, classId);
        const fmt = n => n.toLocaleString('fr-FR') + ' FCFA';
        const barre = (paye, total) => {
            const pct = total ? Math.min(100, Math.round(paye/total*100)) : 0;
            const couleur = pct >= 100 ? '#059669' : (pct > 0 ? '#d97706' : '#ef4444');
            return `<div style="background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden;margin-top:4px;">
                <div style="background:${couleur};height:100%;width:${pct}%;"></div></div>`;
        };
        host.innerHTML = `
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:10px 0;">
                <div style="font-weight:600;margin-bottom:10px;color:#1f2937;"><i class="fas fa-wallet"></i> Situation financière</div>
                <div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:.86rem;">
                        <span>Inscription</span>
                        <span><b>${fmt(s.payeInscription)}</b> / ${fmt(s.fraisInscription)} ${s.inscriptionSoldee ? '✅' : ''}</span>
                    </div>
                    ${barre(s.payeInscription, s.fraisInscription)}
                </div>
                <div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:.86rem;">
                        <span>Scolarité</span>
                        <span><b>${fmt(s.payeScolarite)}</b> / ${fmt(s.fraisScolarite)}</span>
                    </div>
                    ${barre(s.payeScolarite, s.fraisScolarite)}
                </div>
                <div style="border-top:1px solid #e5e7eb;padding-top:8px;display:flex;justify-content:space-between;font-weight:700;">
                    <span>Reste à payer (obligatoire)</span>
                    <span style="color:${s.resteTotal > 0 ? '#ef4444' : '#059669'};">${fmt(s.resteTotal)}</span>
                </div>
                ${(s.fraisCantine > 0 || s.fraisTenues > 0 || s.payeCantine > 0 || s.payeTenues > 0) ? `
                <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #d1d5db;">
                    <div style="font-size:.78rem;color:#9ca3af;text-transform:uppercase;font-weight:600;margin-bottom:6px;">Frais optionnels</div>
                    ${(s.fraisCantine > 0 || s.payeCantine > 0) ? `
                    <div style="display:flex;justify-content:space-between;font-size:.84rem;margin-bottom:4px;">
                        <span><i class="fas fa-utensils" style="color:#d97706;"></i> Cantine</span>
                        <span><b>${fmt(s.payeCantine)}</b>${s.fraisCantine > 0 ? ' / ' + fmt(s.fraisCantine) : ''}</span>
                    </div>` : ''}
                    ${(s.fraisTenues > 0 || s.payeTenues > 0) ? `
                    <div style="display:flex;justify-content:space-between;font-size:.84rem;">
                        <span><i class="fas fa-tshirt" style="color:#db2777;"></i> Tenues</span>
                        <span><b>${fmt(s.payeTenues)}</b>${s.fraisTenues > 0 ? ' / ' + fmt(s.fraisTenues) : ''}</span>
                    </div>` : ''}
                </div>` : ''}
            </div>`;
    } catch (e) {
        console.error('Situation:', e);
        host.style.display = 'none';
    }
};

// Aperçu de la répartition quand on saisit un montant en mode "versement global"
window.apercuRepartition = async function() {
    const montant = parseInt(document.getElementById('paymentAmount')?.value) || 0;
    const studentId = document.getElementById('paymentStudent')?.value;
    const classId = document.getElementById('paymentClasse')?.value;
    const host = document.getElementById('apercuRepartition');
    const modeAuto = document.getElementById('modeVersementAuto')?.checked;
    if (!host) return;
    if (!modeAuto || !montant || !studentId || !classId) { host.style.display = 'none'; return; }

    try {
        const solde = await calculerSoldeEleve(studentId, classId);
        const rep = repartirVersement(montant, solde);
        const fmt = n => n.toLocaleString('fr-FR') + ' FCFA';
        const labels = { inscription:'Inscription', scolarite:'Scolarité' };
        host.style.display = 'block';
        host.innerHTML = `
            <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:12px;margin:10px 0;">
                <div style="font-weight:600;margin-bottom:8px;color:#047857;"><i class="fas fa-sitemap"></i> Répartition automatique</div>
                ${rep.map(r => `<div style="display:flex;justify-content:space-between;font-size:.86rem;padding:3px 0;">
                    <span>${labels[r.type]}${r.avance ? ' (avance)' : ''}</span>
                    <span><b>${fmt(r.amount)}</b></span>
                </div>`).join('')}
            </div>`;
    } catch (e) {
        host.style.display = 'none';
    }
};

// Enregistre un versement réparti (plusieurs lignes de paiement)
window.enregistrerVersementReparti = async function() {
    const montant = parseInt(document.getElementById('paymentAmount')?.value) || 0;
    const studentId = document.getElementById('paymentStudent')?.value;
    const classId = document.getElementById('paymentClasse')?.value;
    const method = document.getElementById('paymentMethod')?.value;
    const ref = document.getElementById('paymentRef')?.value?.trim() || null;
    const date = document.getElementById('paymentDate')?.value;

    if (!studentId || !classId) { showToast('Sélectionnez la classe et l\'élève', 'error'); return; }
    if (montant <= 0) { showToast('Montant invalide', 'error'); return; }
    if (!date) { showToast('Sélectionnez une date', 'error'); return; }

    try {
        const solde = await calculerSoldeEleve(studentId, classId);
        const rep = repartirVersement(montant, solde);
        // Créer une ligne de paiement par part
        const lignes = rep.map(r => ({
            class_id: classId, student_id: studentId,
            type: r.type, amount: r.amount,
            payment_method: method, payment_ref: ref, date
        }));
        const { error } = await supabaseClient.from('payments').insert(lignes);
        if (error) throw error;

        const fmt = n => n.toLocaleString('fr-FR') + ' FCFA';
        const detail = rep.map(r => `${r.type}: ${fmt(r.amount)}`).join(', ');
        showToast(`Versement de ${fmt(montant)} réparti (${detail})`, 'success');
        closeModal('addPaymentModal');
        await loadPaymentsList();
        await updatePaymentStats();
    } catch (e) {
        console.error('❌ Versement réparti:', e);
        showToast('Erreur : ' + (e.message || 'réessayez'), 'error');
    }
};

// Bascule l'affichage selon le mode (versement auto vs type manuel)
window.toggleModeVersement = function() {
    const auto = document.getElementById('modeVersementAuto')?.checked;
    const typeGroup = document.getElementById('paymentType')?.closest('.form-group');
    if (typeGroup) typeGroup.style.display = auto ? 'none' : '';
    // En mode auto, le type n'est pas requis
    const typeSel = document.getElementById('paymentType');
    if (typeSel) typeSel.required = !auto;
    // Rafraîchir l'aperçu
    apercuRepartition();
};


// ============================================================
// ADAPTER LE CHAMP RÉFÉRENCE SELON LA MÉTHODE DE PAIEMENT
// ============================================================
window.adapterChampReference = function() {
    const method = document.getElementById('paymentMethod')?.value;
    const group = document.getElementById('paymentRefGroup');
    const label = document.getElementById('paymentRefLabel');
    const input = document.getElementById('paymentRef');
    const hint = document.getElementById('paymentRefHint');
    if (!group || !input) return;

    const config = {
        especes:  { show:false },
        orange:   { show:true,  label:'N° de transaction Orange Money', ph:'Ex : PP240115.1430.A12345', hint:'Copiez le numéro du SMS de confirmation Orange Money' },
        wave:     { show:true,  label:'N° de transaction Wave', ph:'Ex : TXN-XXXXXXXX', hint:'Référence visible dans l\'historique Wave' },
        moov:     { show:true,  label:'N° de transaction Moov Money', ph:'Ex : MV240115XXXXX', hint:'Référence du SMS de confirmation Moov' },
        virement: { show:true,  label:'Référence du virement', ph:'Ex : VIR-2025-001', hint:'Référence bancaire du virement' },
        cheque:   { show:true,  label:'N° du chèque', ph:'Ex : 0001234', hint:'Numéro inscrit sur le chèque' },
    };
    const c = config[method] || { show:true, label:'Référence de paiement', ph:'N° de transaction, chèque...', hint:'' };

    if (!c.show) {
        // Espèces : pas de référence externe
        group.style.display = 'none';
        input.value = '';
    } else {
        group.style.display = '';
        if (label) label.textContent = c.label;
        input.placeholder = c.ph || '';
        if (hint) hint.textContent = c.hint || '';
    }
};