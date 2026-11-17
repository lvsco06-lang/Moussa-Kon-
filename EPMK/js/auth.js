// ============================================================
// AUTH.JS — Gestion de la connexion Admin
// École Mali Excellence
// Utilise window.supabaseClient créé par supabase-config.js
// NE crée PAS de nouvelle instance Supabase
// ============================================================

(function () {

    // Attendre que supabaseClient soit disponible (créé par supabase-config.js)
    async function waitClient() {
        let t = 0;
        while (!window.supabaseClient && t < 80) {
            await new Promise(r => setTimeout(r, 100));
            t++;
        }
        if (!window.supabaseClient) throw new Error('supabaseClient non disponible');
        return window.supabaseClient;
    }

    // ── Vérifier session au chargement ─────────────────────
    async function checkSession() {
        try {
            const sb = await waitClient();
            const { data: { session } } = await sb.auth.getSession();

            if (session) {
                // Déjà connecté → rediriger vers Admin
                console.log('✅ Session active, redirection vers Admin.html');
                window.location.href = 'Admin.html';
                return;
            }

            // Pas de session → afficher le formulaire
            hideSpinner();
            console.log('ℹ️ Pas de session, affichage du formulaire');
        } catch (err) {
            console.error('Erreur vérification session:', err);
            hideSpinner();
        }
    }

    // ── Connexion ───────────────────────────────────────────
    async function doLogin(email, password) {
        const sb = await waitClient();
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Enregistrer la date de dernière connexion (lue par la colonne
        // "Dernière connexion" du tableau Utilisateurs côté admin).
        // Non-bloquant : un échec (RLS, réseau…) ne doit pas empêcher la connexion.
        if (data?.user?.id) {
            try {
                await sb.from('profiles')
                    .update({ last_login: new Date().toISOString() })
                    .eq('id', data.user.id);
            } catch (e) {
                console.warn('last_login non mis à jour:', e);
            }
        }

        // Blocage des comptes suspendus (géré depuis Utilisateurs)
        if (data?.user?.id) {
            try {
                const { data: prof } = await sb.from('profiles')
                    .select('status').eq('id', data.user.id).maybeSingle();
                if (prof && prof.status === 'suspendu') {
                    await sb.auth.signOut();
                    throw new Error('Ce compte a été suspendu par la direction.');
                }
            } catch (e) {
                if (e.message?.includes('suspendu')) throw e;
                console.warn('Vérification du statut:', e);
            }
        }

        return data;
    }

    // ── UI helpers ──────────────────────────────────────────
    function showSpinner() {
        const spinner = document.getElementById('spinner');
        const btnText = document.getElementById('btnText');
        const loginBtn = document.getElementById('loginBtn');
        if (spinner) spinner.classList.remove('hidden');
        if (btnText) btnText.textContent = 'Vérification de la session...';
        if (loginBtn) loginBtn.disabled = true;
    }

    function hideSpinner() {
        const spinner = document.getElementById('spinner');
        const btnText = document.getElementById('btnText');
        const loginBtn = document.getElementById('loginBtn');
        if (spinner) spinner.classList.add('hidden');
        if (btnText) btnText.textContent = 'Se connecter';
        if (loginBtn) loginBtn.disabled = false;
    }

    function showMessage(text, type = 'error') {
        const container = document.getElementById('messageContainer');
        const msgText = document.getElementById('messageText');
        const icon = container?.querySelector('.error-icon');
        if (!container || !msgText) return;
        msgText.textContent = text;
        container.classList.remove('hidden');
        if (icon) {
            icon.className = type === 'success'
                ? 'fas fa-check-circle error-icon'
                : 'fas fa-exclamation-circle error-icon';
        }
        container.style.borderColor = type === 'success' ? '#10b981' : '#ef4444';
    }

    function hideMessage() {
        document.getElementById('messageContainer')?.classList.add('hidden');
    }

    // ── Init DOM ────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {

        // Vérifier session existante
        showSpinner();
        checkSession();

        // Formulaire de connexion
        const form = document.getElementById('loginForm');
        if (form) {
            form.addEventListener('submit', async function (e) {
                e.preventDefault();
                hideMessage();

                const email    = document.getElementById('email')?.value?.trim();
                const password = document.getElementById('password')?.value;

                if (!email || !password) {
                    showMessage('Veuillez remplir tous les champs.');
                    return;
                }

                const loginBtn = document.getElementById('loginBtn');
                const btnText  = document.getElementById('btnText');
                const spinner  = document.getElementById('spinner');
                if (loginBtn) loginBtn.disabled = true;
                if (btnText) btnText.textContent = 'Connexion…';
                if (spinner) spinner.classList.remove('hidden');

                try {
                    await doLogin(email, password);
                    // Journal des connexions (non bloquant)
                    try {
                        const cli = window.supabaseClient;
                        const { data: { user } } = await cli.auth.getUser();
                        if (user) await cli.from('journal_connexions').insert([{ user_id: user.id, email: user.email, role: 'admin', action: 'connexion', user_agent: navigator.userAgent }]);
                    } catch (_) {}
                    showMessage('Connexion réussie ! Redirection…', 'success');
                    setTimeout(() => { window.location.href = 'Admin.html'; }, 800);
                } catch (err) {
                    console.error('Erreur login:', err);
                    let msg = 'Email ou mot de passe incorrect.';
                    if (err.message?.includes('suspendu')) msg = err.message;
                    if (err.message?.includes('Email not confirmed')) {
                        msg = 'Veuillez confirmer votre email avant de vous connecter.';
                    } else if (err.message?.includes('Too many requests')) {
                        msg = 'Trop de tentatives. Veuillez patienter quelques minutes.';
                    }
                    showMessage(msg);
                    hideSpinner();
                }
            });
        }

        // Afficher/masquer mot de passe
        const toggleBtn = document.getElementById('togglePassword');
        const pwdInput  = document.getElementById('password');
        if (toggleBtn && pwdInput) {
            toggleBtn.addEventListener('click', function () {
                const isHidden = pwdInput.type === 'password';
                pwdInput.type = isHidden ? 'text' : 'password';
                this.querySelector('i').className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
            });
        }

        // Fermer message d'erreur
        document.getElementById('closeMessage')?.addEventListener('click', hideMessage);

        // Modal réinitialisation mot de passe
        const forgotBtn     = document.getElementById('forgotPassword');
        const resetModal    = document.getElementById('resetModal');
        const closeModal    = document.getElementById('closeResetModal');
        const sendResetBtn  = document.getElementById('sendResetLink');

        forgotBtn?.addEventListener('click', e => {
            e.preventDefault();
            resetModal?.classList.remove('hidden');
        });
        closeModal?.addEventListener('click', () => resetModal?.classList.add('hidden'));

        sendResetBtn?.addEventListener('click', async function () {
            const email = document.getElementById('resetEmail')?.value?.trim();
            if (!email) { showMessage('Entrez votre email.'); return; }
            try {
                const sb = await waitClient();
                const { error } = await sb.auth.resetPasswordForEmail(email, {
                    redirectTo: window.location.origin + '/reset-password.html'
                });
                if (error) throw error;
                resetModal?.classList.add('hidden');
                showMessage('Email de réinitialisation envoyé !', 'success');
            } catch (err) {
                showMessage('Erreur : ' + (err.message || 'Réessayez.'));
            }
        });
    });

})();