/**
 * @deprecated Utilisez plutôt js/supabase-module.js
 * Ce fichier est conservé pour la compatibilité avec l'ancien code
 */

// Détection du mode module vs script classique
if (typeof module !== 'undefined' && module.exports) {
    // Node.js / ES Modules
    module.exports = { supabaseManager };
} else {
    // Navigateur - chargement classique
    (async function() {
        // Attendre que Supabase soit chargé
        if (typeof supabase === 'undefined') {
            await new Promise(resolve => {
                const check = setInterval(() => {
                    if (typeof supabase !== 'undefined') {
                        clearInterval(check);
                        resolve();
                    }
                }, 50);
            });
        }

        // Initialisation legacy
        const supabaseUrl = 'https://phbfwmwqiisqidscpzeh.supabase.co';
        const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoYmZ3bXdxaWlzcWlkc2NwemVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTE0MTcsImV4cCI6MjA4Nzk4NzQxN30.UPGusoIjj5e_crNG_Dv_i9Sd2rbjLA_Hg0trfzBWq0Y';

        window.supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
        
        console.log('✅ Supabase Legacy initialisé (utilisez supabase-module.js pour les nouveaux projets)');
    })();
}