// ============================================================
// ADMIN-PAIEMENTS-ATTENTE.JS — École Privée Moussa Koné
// ------------------------------------------------------------
// Module AUTONOME : injecte un panneau « Déclarations en attente »
// au-dessus du tableau des paiements de l'espace admin, avec
// boutons Valider / Rejeter.
//
// INSTALLATION : dans Admin.html, ajouter APRÈS admin.js :
//   <script src="js/admin-paiements-attente.js"></script>
//
// PRINCIPES RESPECTÉS :
// - Ne modifie PAS admin.js ; noms préfixés epmkPending* (zéro collision)
// - Réutilise window.supabaseClient (jamais de nouvelle instance)
// - Requêtes séparées puis jointure manuelle (pas de join PostgREST)
// - Réutilise showToast() et loadPaymentsList() s'ils existent
// ============================================================
(function () {
    'use strict';

    var PANEL_ID = 'epmkPendingPanel';
    var TYPE_LABELS = {
        inscription: "Frais d'inscription", scolarite: 'Scolarité',
        cantine: 'Cantine', uniforme: 'Tenues / Uniforme',
        transport: 'Transport', assurance: 'Assurance', autre: 'Autre'
    };
    var METHOD_LABELS = { orange: 'Orange Money', moov: 'Moov Money', wave: 'Wave', especes: 'Espèces', cheque: 'Chèque' };

    // ── Utilitaires ─────────────────────────────────────────
    function sb() { return window.supabaseClient || null; }

    function toast(msg, type) {
        if (typeof window.showToast === 'function') { window.showToast(msg, type || 'info'); return; }
        alert(msg);
    }

    function fmtF(n) { return Number(n || 0).toLocaleString('fr-FR') + ' FCFA'; }
    function fmtDate(d) {
        if (!d) return '—';
        try { return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); }
        catch (_) { return d; }
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ── Injection du panneau ────────────────────────────────
    function ensurePanel() {
        if (document.getElementById(PANEL_ID)) return true;
        var tbody = document.getElementById('paiementsTableBody');
        if (!tbody) return false;
        var table = tbody.closest('table');
        var anchor = (table && (table.closest('.table-container') || table.parentElement)) || table;
        if (!anchor || !anchor.parentElement) return false;

        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = 'margin:0 0 18px;background:#fffdf5;border:1.5px solid #e6d9b8;' +
            'border-left:5px solid #c79a3b;border-radius:14px;overflow:hidden;' +
            'font-family:inherit;box-shadow:0 2px 10px rgba(20,40,30,.06);';
        panel.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;' +
                'padding:14px 18px;border-bottom:1px solid #efe6cf;">' +
                '<div style="display:flex;align-items:center;gap:10px;">' +
                    '<span style="width:38px;height:38px;border-radius:11px;display:inline-flex;align-items:center;' +
                        'justify-content:center;background:#c79a3b;color:#fff;font-size:1rem;">' +
                        '<i class="fas fa-hourglass-half"></i></span>' +
                    '<div>' +
                        '<div style="font-weight:700;color:#14532d;font-size:1.02rem;">Déclarations de paiement en attente ' +
                            '<span id="epmkPendingCount" style="display:inline-block;min-width:22px;text-align:center;' +
                            'background:#dc2626;color:#fff;border-radius:999px;font-size:.75rem;padding:2px 8px;' +
                            'vertical-align:2px;margin-left:4px;">…</span></div>' +
                        '<div style="font-size:.8rem;color:#8a7a52;">Paiements mobile money déclarés par les parents — ' +
                            'vérifiez la réception sur le téléphone marchand avant de valider.</div>' +
                    '</div>' +
                '</div>' +
                '<button id="epmkPendingRefresh" style="border:1.5px solid #d9cba0;background:#fff;color:#8a6414;' +
                    'font-family:inherit;font-size:.8rem;font-weight:600;padding:.45rem .9rem;border-radius:999px;' +
                    'cursor:pointer;"><i class="fas fa-rotate"></i> Actualiser</button>' +
            '</div>' +
            '<div id="epmkPendingList" style="padding:12px 16px 14px;"></div>';

        anchor.parentElement.insertBefore(panel, anchor);
        document.getElementById('epmkPendingRefresh').addEventListener('click', function () { load(true); });
        return true;
    }

    // ── Chargement des déclarations ─────────────────────────
    async function load(manual) {
        var client = sb();
        var list = document.getElementById('epmkPendingList');
        var badge = document.getElementById('epmkPendingCount');
        if (!client || !list) return;

        if (manual) list.innerHTML = '<div style="padding:14px;color:#8a7a52;font-size:.9rem;">' +
            '<i class="fas fa-spinner fa-spin"></i> Actualisation…</div>';

        try {
            // 1) Paiements en attente
            var r1 = await client.from('payments')
                .select('id, student_id, class_id, type, amount, payment_method, payment_ref, date, created_at')
                .eq('status', 'pending')
                .order('created_at', { ascending: false });
            if (r1.error) throw r1.error;
            var pend = r1.data || [];

            if (badge) {
                badge.textContent = pend.length;
                badge.style.background = pend.length ? '#dc2626' : '#10b981';
            }

            if (!pend.length) {
                list.innerHTML = '<div style="padding:10px 4px;color:#6b7280;font-size:.88rem;">' +
                    '<i class="fas fa-circle-check" style="color:#10b981;"></i> Aucune déclaration en attente. Tout est à jour.</div>';
                return;
            }

            // 2) Élèves (jointure manuelle — jamais de join PostgREST)
            var sids = pend.map(function (p) { return p.student_id; }).filter(Boolean);
            var studMap = {};
            var classeMap = {};
            if (sids.length) {
                var r2 = await client.from('students')
                    .select('id, first_name, last_name, matricule, class_id').in('id', sids);
                (r2.data || []).forEach(function (s) { studMap[s.id] = s; });

                // Nom de la classe de chaque élève
                var cids = (r2.data || []).map(function (s) { return s.class_id; }).filter(Boolean);
                cids = cids.filter(function (v, i) { return cids.indexOf(v) === i; });
                if (cids.length) {
                    var r3 = await client.from('classes').select('id, nom').in('id', cids);
                    var nomCls = {};
                    (r3.data || []).forEach(function (c) { nomCls[c.id] = c.nom; });
                    (r2.data || []).forEach(function (s) { classeMap[s.id] = nomCls[s.class_id] || null; });
                }
            }

            // 3) Rendu
            list.innerHTML = pend.map(function (p) {
                var s = studMap[p.student_id] || {};
                var nom = ((s.first_name || '') + ' ' + (s.last_name || '')).trim() || 'Élève inconnu';
                return '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;' +
                    'background:#fff;border:1px solid #efe6cf;border-radius:11px;padding:12px 14px;margin-bottom:10px;">' +
                    '<div style="flex:1;min-width:220px;">' +
                        '<div style="font-weight:700;color:#2A211D;font-size:.95rem;">' + esc(nom) +
                            (s.matricule ? ' <span style="font-weight:500;color:#A1887F;font-size:.78rem;">· ' + esc(s.matricule) + '</span>' : '') +
                            (classeMap[p.student_id] ? ' <span style="font-weight:600;color:#5D4037;font-size:.78rem;">· ' + esc(classeMap[p.student_id]) + '</span>' : '') +
                        '</div>' +
                        '<div style="font-size:.82rem;color:#59685d;margin-top:2px;">' +
                            '<strong style="color:#1b5e20;">' + fmtF(p.amount) + '</strong> — ' +
                            esc(TYPE_LABELS[p.type] || p.type) + ' · ' + esc(METHOD_LABELS[p.payment_method] || p.payment_method || '—') +
                            ' · déclaré le ' + fmtDate(p.created_at) +
                        '</div>' +
                        '<div style="font-size:.8rem;color:#8a6414;margin-top:3px;">' +
                            '<i class="fas fa-hashtag"></i> Réf. transaction : <strong style="user-select:all;">' + esc(p.payment_ref || '—') + '</strong>' +
                        '</div>' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;flex-shrink:0;">' +
                        '<button onclick="epmkPendingValider(\'' + p.id + '\')" style="border:none;background:#1b5e20;color:#fff;' +
                            'font-family:inherit;font-size:.82rem;font-weight:600;padding:.5rem 1rem;border-radius:999px;cursor:pointer;">' +
                            '<i class="fas fa-check"></i> Valider</button>' +
                        '<button onclick="epmkPendingRejeter(\'' + p.id + '\')" style="border:1.5px solid #e5b4a6;background:#fff;color:#9c4a2e;' +
                            'font-family:inherit;font-size:.82rem;font-weight:600;padding:.5rem 1rem;border-radius:999px;cursor:pointer;">' +
                            '<i class="fas fa-xmark"></i> Rejeter</button>' +
                    '</div>' +
                '</div>';
            }).join('');
        } catch (err) {
            console.error('[PaiementsAttente]', err);
            list.innerHTML = '<div style="padding:10px 4px;color:#9c4a2e;font-size:.88rem;">' +
                '<i class="fas fa-triangle-exclamation"></i> Impossible de charger les déclarations. ' +
                'Vérifiez que le script SQL (politiques admin) a bien été exécuté.</div>';
        }
    }

    // ── Actions ─────────────────────────────────────────────
    async function setStatus(id, status, confirmMsg, okMsg) {
        if (confirmMsg && !window.confirm(confirmMsg)) return;
        var client = sb();
        if (!client) return;
        try {
            var r = await client.from('payments').update({ status: status }).eq('id', id).eq('status', 'pending');
            if (r.error) throw r.error;
            toast(okMsg, status === 'completed' ? 'success' : 'info');
            load();
            // Rafraîchir le tableau principal des paiements s'il est présent
            if (typeof window.loadPaymentsList === 'function') { try { window.loadPaymentsList(); } catch (_) {} }
            else if (typeof loadPaymentsList === 'function') { try { loadPaymentsList(); } catch (_) {} }
        } catch (err) {
            console.error('[PaiementsAttente] setStatus', err);
            toast("L'opération a échoué. Réessayez.", 'error');
        }
    }

    window.epmkPendingValider = function (id) {
        setStatus(id, 'completed',
            'Confirmer la validation ?\n\nAssurez-vous d\'avoir vérifié la réception du transfert sur le téléphone marchand.',
            'Paiement validé — le reçu est désormais disponible pour le parent.');
    };
    window.epmkPendingRejeter = function (id) {
        setStatus(id, 'rejected',
            'Rejeter cette déclaration ?\n\nLe parent verra le statut « Rejeté » dans son portail.',
            'Déclaration rejetée.');
    };

    // ── Démarrage : attendre supabaseClient + le tableau ────
    var tries = 0;
    var boot = setInterval(function () {
        tries++;
        if (sb() && ensurePanel()) {
            clearInterval(boot);
            load();
            // Rafraîchissement périodique discret (60 s)
            setInterval(function () { load(); }, 60000);
        } else if (tries > 100) { // ~30 s puis on abandonne silencieusement
            clearInterval(boot);
        }
    }, 300);
})();