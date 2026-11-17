// ============================================================
// SITE-CONFIG.JS — Données dynamiques du site public · EPMK
// ------------------------------------------------------------
// Lit les tables gérées dans l'espace admin :
//   · parametres_ecole (id=1) : nom, adresse, telephone, email, logo_url
//   · parametres_annee (id=1) : annee_en_cours
// et remplit les éléments marqués dans le HTML :
//   · [data-ecole="telephone"] , [data-ecole="email"] ,
//     [data-ecole="adresse"]   , [data-ecole="nom"]
//   · [data-annee]  → année scolaire en cours
//   · [data-year]   → année civile courante (copyright)
//   · .logo-img     → remplacée par logo_url si défini
//
// PRINCIPE : le HTML contient des valeurs par défaut ; ce script
// ne fait que les REMPLACER si la base répond. Jamais de trou.
//
// PRÉREQUIS sur la page (avant ce fichier) :
//   <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
//   <script src="../js/supabase-config.js"></script>   (ou js/ à la racine)
// NE CRÉE JAMAIS de nouvelle instance Supabase (réutilise
// window.supabaseClient), conformément au reste du site.
// ============================================================
(function () {
    'use strict';

    var CACHE_KEY = 'epmk_site_config';
    var CACHE_TTL = 10 * 60 * 1000; // 10 minutes

    // ── Année civile (copyright) : aucun besoin de la base ──
    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('[data-year]').forEach(function (el) {
            el.textContent = new Date().getFullYear();
        });
    });

    // ── Application des valeurs dans le DOM ─────────────────
    function apply(cfg) {
        if (!cfg) return;

        var map = {
            telephone: cfg.ecole && cfg.ecole.telephone,
            email:     cfg.ecole && cfg.ecole.email,
            adresse:   cfg.ecole && cfg.ecole.adresse,
            nom:       cfg.ecole && cfg.ecole.nom
        };

        Object.keys(map).forEach(function (key) {
            var val = map[key];
            if (!val) return;
            document.querySelectorAll('[data-ecole="' + key + '"]').forEach(function (el) {
                el.textContent = val;
                // Liens cliquables cohérents
                if (el.tagName === 'A') {
                    if (key === 'telephone') el.href = 'tel:' + val.replace(/\s+/g, '');
                    if (key === 'email')     el.href = 'mailto:' + val;
                }
            });
        });

        // Logo dynamique (uploadé depuis l'admin)
        if (cfg.ecole && cfg.ecole.logo_url) {
            document.querySelectorAll('.logo-img').forEach(function (img) {
                img.src = cfg.ecole.logo_url;
                img.style.display = '';
            });
        }

        // Année scolaire (admin → Paramètres)
        if (cfg.annee) {
            document.querySelectorAll('[data-annee]').forEach(function (el) {
                el.textContent = cfg.annee;
            });
        }
    }

    // ── Cache session (évite une requête à chaque page) ─────
    function readCache() {
        try {
            var raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            var obj = JSON.parse(raw);
            if (Date.now() - obj.t > CACHE_TTL) return null;
            return obj.data;
        } catch (_) { return null; }
    }
    function writeCache(data) {
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data: data })); }
        catch (_) {}
    }

    // ── Attendre le client Supabase existant ────────────────
    function waitSB(ms) {
        return new Promise(function (resolve) {
            var t0 = Date.now();
            (function tick() {
                if (window.supabaseClient) return resolve(window.supabaseClient);
                if (Date.now() - t0 > (ms || 6000)) return resolve(null);
                setTimeout(tick, 120);
            })();
        });
    }

    // ── Chargement ──────────────────────────────────────────
    async function load() {
        // 1) Cache d'abord : affichage instantané
        var cached = readCache();
        if (cached) apply(cached);

        // 2) Puis rafraîchissement depuis la base
        var sb = await waitSB();
        if (!sb) {
            if (!cached) console.info('ℹ️ site-config : Supabase indisponible, valeurs HTML conservées.');
            return;
        }

        var cfg = { ecole: null, annee: null };

        try {
            var r1 = await sb.from('parametres_ecole')
                .select('nom, adresse, telephone, email, logo_url')
                .eq('id', 1).maybeSingle();
            if (r1 && r1.data) cfg.ecole = r1.data;
        } catch (_) {}

        try {
            var r2 = await sb.from('parametres_annee')
                .select('annee_en_cours')
                .eq('id', 1).maybeSingle();
            if (r2 && r2.data && r2.data.annee_en_cours) cfg.annee = r2.data.annee_en_cours;
        } catch (_) {}

        if (cfg.ecole || cfg.annee) {
            apply(cfg);
            writeCache(cfg);
            console.log('✅ site-config : infos école chargées depuis la base');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', load);
    } else {
        load();
    }
})();
