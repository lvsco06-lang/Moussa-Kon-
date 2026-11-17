/**
 * admission.js — Pré-inscription en ligne
 * ---------------------------------------------------------------
 * École Privée Moussa Koné (EPMK) — Bamako, Mali
 *
 * PARTI PRIS : le formulaire ne collecte QUE ce qui permet au
 * secrétariat de rappeler la famille. Aucun document n'est
 * téléversé — seuls les ORIGINAUX remis au secrétariat font foi,
 * les scans n'avaient donc aucune valeur administrative tout en
 * coûtant du forfait données et en provoquant des abandons.
 *
 * Le dossier complet (santé, filiation, école précédente, adresse)
 * se remplit sur place, sur la fiche d'inscription papier.
 */

(function () {
    'use strict';

    // ── Attente du client Supabase (initialisé de façon asynchrone) ──
    function attendreClient() {
        return new Promise(function (resolve, reject) {
            if (window.supabaseClient) return resolve(window.supabaseClient);
            var ecoule = 0;
            var iv = setInterval(function () {
                if (window.supabaseClient) { clearInterval(iv); resolve(window.supabaseClient); }
                else if ((ecoule += 100) > 8000) {
                    clearInterval(iv);
                    reject(new Error('Service indisponible'));
                }
            }, 100);
        });
    }

    var sb = null;
    var envoiEnCours = false;

    // ── Utilitaires ─────────────────────────────────────────────
    function val(id) {
        var el = document.getElementById(id);
        return el && el.value ? el.value.trim() : null;
    }

    function afficherMessage(texte, type) {
        var zone = document.getElementById('formMessage');
        if (!zone) return;
        var couleurs = {
            error:   { fond: '#fdecea', bord: '#e6a79e', texte: '#8c2f22', icone: 'fa-circle-exclamation' },
            success: { fond: '#eaf6ec', bord: '#a5d6a7', texte: '#1b5e20', icone: 'fa-circle-check' },
            info:    { fond: '#fff8e6', bord: '#f0d9a8', texte: '#7a5c12', icone: 'fa-circle-info' }
        };
        var c = couleurs[type] || couleurs.info;
        zone.style.cssText = 'display:block;background:' + c.fond + ';border:1px solid ' + c.bord +
            ';border-left:4px solid ' + c.texte + ';border-radius:10px;padding:13px 16px;' +
            'margin:18px 0;font-size:.92rem;color:' + c.texte + ';line-height:1.5;';
        zone.innerHTML = '<i class="fas ' + c.icone + '" style="margin-right:.5rem;"></i>' + texte;
        zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /**
     * Normalise un numéro malien au format +223XXXXXXXX.
     * Les familles saisissent indifféremment « 70 00 00 00 »,
     * « 00223 70000000 » ou « +223-70-00-00-00 ».
     */
    function normaliserTelephone(brut) {
        if (!brut) return null;
        var chiffres = String(brut).replace(/[^0-9]/g, '');
        if (chiffres.indexOf('00223') === 0) chiffres = chiffres.slice(5);
        else if (chiffres.indexOf('223') === 0 && chiffres.length === 11) chiffres = chiffres.slice(3);
        if (chiffres.length !== 8) return null;   // un numéro malien fait 8 chiffres
        return '+223' + chiffres;
    }

    // ── Chargement des classes proposées ────────────────────────
    async function chargerClasses() {
        var select = document.getElementById('niveau_demande');
        if (!select) return;
        try {
            var reponse = await sb.from('classes').select('id, nom').order('nom');
            var classes = reponse.data || [];
            if (!classes.length) {
                select.innerHTML = '<option value="">Aucune classe disponible</option>';
                return;
            }
            select.innerHTML = '<option value="">Choisir une classe</option>' +
                classes.map(function (c) {
                    return '<option value="' + c.id + '">' + c.nom + '</option>';
                }).join('');
        } catch (e) {
            console.warn('Classes non chargees :', e && e.message);
            select.innerHTML = '<option value="">Liste momentanement indisponible</option>';
        }
    }

    // ── Validation ──────────────────────────────────────────────
    function validerFormulaire() {
        var champs = [
            ['nom_eleve',        "Le nom de l'eleve est obligatoire."],
            ['prenom_eleve',     "Le prenom de l'eleve est obligatoire."],
            ['date_naissance',   "La date de naissance est obligatoire."],
            ['sexe_eleve',       "Merci d'indiquer s'il s'agit d'un garcon ou d'une fille."],
            ['niveau_demande',   "Merci de choisir la classe demandee."],
            ['nom_parent',       "Votre nom est obligatoire."],
            ['telephone_parent', "Votre numero de telephone est obligatoire."]
        ];

        for (var i = 0; i < champs.length; i++) {
            if (!val(champs[i][0])) {
                afficherMessage(champs[i][1], 'error');
                var el = document.getElementById(champs[i][0]);
                if (el) { el.focus(); el.style.borderColor = '#b23b2e'; }
                return false;
            }
        }

        // Le telephone est le seul moyen de rappeler la famille :
        // un numero invalide rend la demande inexploitable.
        if (!normaliserTelephone(val('telephone_parent'))) {
            afficherMessage('Le numero de telephone doit contenir 8 chiffres. ' +
                            'Exemple : 70 00 00 00', 'error');
            document.getElementById('telephone_parent').focus();
            return false;
        }

        // Date de naissance dans le futur, ou age aberrant.
        var naissance = new Date(val('date_naissance'));
        var age = (Date.now() - naissance.getTime()) / (365.25 * 24 * 3600 * 1000);
        if (isNaN(age) || age < 2 || age > 25) {
            afficherMessage("Verifiez la date de naissance de l'eleve.", 'error');
            document.getElementById('date_naissance').focus();
            return false;
        }

        var consent = document.getElementById('confirmation_donnees');
        if (!consent || !consent.checked) {
            afficherMessage("Merci de cocher la case de confirmation avant d'envoyer.", 'error');
            return false;
        }
        return true;
    }

    // ── Envoi ───────────────────────────────────────────────────
    async function envoyerDemande(e) {
        e.preventDefault();
        if (envoiEnCours) return;
        if (!validerFormulaire()) return;

        envoiEnCours = true;
        var bouton = document.getElementById('submitBtn');
        var libelle = document.getElementById('submitBtnText');
        var ancien = libelle ? libelle.textContent : '';
        if (bouton) bouton.disabled = true;
        if (libelle) libelle.textContent = 'Envoi en cours...';

        try {
            var selectClasse = document.getElementById('niveau_demande');
            var nomClasse = selectClasse && selectClasse.selectedIndex > 0
                ? selectClasse.options[selectClasse.selectedIndex].text : null;

            var telephone = normaliserTelephone(val('telephone_parent'));

            var donnees = {
                student_first_name: val('prenom_eleve'),
                student_last_name:  val('nom_eleve'),
                birth_date:         val('date_naissance'),
                gender:             val('sexe_eleve'),
                class_id:           val('niveau_demande'),
                class_name:         nomClasse,

                // Un seul contact au stade de la pre-inscription. La filiation
                // complete (pere, mere, tuteur) se remplit au secretariat.
                father_name:        val('nom_parent'),
                father_phone:       telephone,
                father_email:       val('email_parent'),
                emergency_phone:    telephone,

                city:               'Bamako',
                commune:            val('commune'),

                // La pre-inscription ne collecte aucun paiement :
                // le reglement se fait au secretariat.
                amount:             0,
                payment_method:     'pending',

                status:             'pending',   // impose aussi par la politique RLS
                // 'online' est la seule valeur acceptee par la contrainte
                // CHECK admissions_source_check. 'site_web' etait rejete.
                source:             'online',
                created_at:         new Date().toISOString()
            };

            var reponse = await sb.from('admissions').insert([donnees]);
            if (reponse.error) throw reponse.error;

            afficherMessage(
                '<strong>Votre demande a bien ete enregistree.</strong><br>' +
                'Le secretariat vous rappellera sous 48 heures au numero indique.',
                'success');

            setTimeout(function () {
                window.location.href = 'confirmation-inscription.html';
            }, 2200);

        } catch (err) {
            console.error('Envoi de la demande :', err);
            afficherMessage(
                "L'envoi a echoue. Verifiez votre connexion et reessayez. " +
                "Si le probleme persiste, contactez le secretariat.",
                'error');
            envoiEnCours = false;
            if (bouton) bouton.disabled = false;
            if (libelle) libelle.textContent = ancien;
        }
    }

    // ── Demarrage ───────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async function () {
        try {
            sb = await attendreClient();
        } catch (e) {
            afficherMessage('Service momentanement indisponible. Reessayez dans un instant.', 'error');
            return;
        }

        chargerClasses();

        var formulaire = document.getElementById('admissionForm');
        if (formulaire) formulaire.addEventListener('submit', envoyerDemande);

        // Effacer le lisere rouge des que le parent corrige son champ
        document.querySelectorAll('#admissionForm input, #admissionForm select')
            .forEach(function (champ) {
                champ.addEventListener('input', function () { champ.style.borderColor = ''; });
            });
    });
})();