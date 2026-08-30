'use strict';
// Traduzioni IT/EN: dizionario piatto chiave -> testo, interpolazione minima
// con {placeholder}. La lingua e' una preferenza del dispositivo (come lo
// sfondo), non un dato dell'utente: si sceglie al primo avvio, prima ancora
// che esista un account, quindi non puo' vivere sul server.
window.MindkeepI18n = (() => {
  const LANG_KEY = 'mindkeep-lang';
  const LANGS = ['it', 'en'];

  const STRINGS = {
    it: {
      app_name: 'Mindkeep',
      lang_pick_title: 'Mindkeep',
      lang_pick_sub: 'Scegli la lingua — Choose your language',
      lang_it: 'Italiano',
      lang_en: 'English',
      lang_continue: 'Continua',

      auth_sub_setup: 'Primo avvio: crea il tuo accesso personale.',
      auth_sub_login: 'Il tuo spazio personale, al sicuro.',
      auth_username: 'Username',
      auth_password: 'Password',
      auth_code: 'Codice di verifica',
      auth_code_placeholder: '6 cifre dall\'app',
      auth_code_hint: 'Oppure uno dei codici di recupero, se non hai il telefono.',
      auth_submit_setup: 'Crea accesso',
      auth_submit_login: 'Entra',
      auth_submit_verify: 'Verifica ed entra',
      search_placeholder: 'Cerca in tutto Mindkeep…',
      taskbar_start: 'Avvio',
      taskbar_new: 'Nuovo',

      nav_projects: 'Progetti',
      nav_ideas: 'Note',
      nav_vault: 'Vault',
      nav_accounts: 'Abbonamenti',
      nav_drive: 'Drive',
      nav_dossiers: 'Cartelle',
      nav_reminders: 'Scadenze',
      nav_calendar: 'Calendario',
      nav_trash: 'Cestino',
      nav_security: 'Sicurezza',

      btn_save: 'Salva',
      btn_cancel: 'Annulla',
      btn_create: 'Crea',
      btn_upload: 'Carica',
      btn_edit: 'Modifica',
      btn_delete: 'Elimina',
      btn_close: 'Chiudi',
      btn_download: 'Scarica',
      btn_link_folder: 'Cartella',
      btn_back_to_folder: '← Torna alla cartella',
      btn_new_item: '+ Nuovo elemento',
      confirm_generic: 'Sei sicuro?',

      settings_language: 'Lingua',
      settings_language_hint: 'Solo su questo dispositivo.',
    },
    en: {
      app_name: 'Mindkeep',
      lang_pick_title: 'Mindkeep',
      lang_pick_sub: 'Scegli la lingua — Choose your language',
      lang_it: 'Italiano',
      lang_en: 'English',
      lang_continue: 'Continue',

      auth_sub_setup: 'First run: create your personal login.',
      auth_sub_login: 'Your personal space, safely kept.',
      auth_username: 'Username',
      auth_password: 'Password',
      auth_code: 'Verification code',
      auth_code_placeholder: '6 digits from the app',
      auth_code_hint: 'Or one of your recovery codes, if you don\'t have your phone.',
      auth_submit_setup: 'Create account',
      auth_submit_login: 'Sign in',
      auth_submit_verify: 'Verify and sign in',
      search_placeholder: 'Search all of Mindkeep…',
      taskbar_start: 'Start',
      taskbar_new: 'New',

      nav_projects: 'Projects',
      nav_ideas: 'Notes',
      nav_vault: 'Vault',
      nav_accounts: 'Subscriptions',
      nav_drive: 'Drive',
      nav_dossiers: 'Folders',
      nav_reminders: 'Reminders',
      nav_calendar: 'Calendar',
      nav_trash: 'Trash',
      nav_security: 'Security',

      btn_save: 'Save',
      btn_cancel: 'Cancel',
      btn_create: 'Create',
      btn_upload: 'Upload',
      btn_edit: 'Edit',
      btn_delete: 'Delete',
      btn_close: 'Close',
      btn_download: 'Download',
      btn_link_folder: 'Folder',
      btn_back_to_folder: '← Back to folder',
      btn_new_item: '+ New item',
      confirm_generic: 'Are you sure?',

      settings_language: 'Language',
      settings_language_hint: 'This device only.',
    },
  };

  function getLang() {
    try {
      const stored = localStorage.getItem(LANG_KEY);
      if (LANGS.includes(stored)) return stored;
    } catch (e) { /* storage non disponibile: si va con l'italiano di default */ }
    return 'it';
  }

  function setLang(lang) {
    if (!LANGS.includes(lang)) return;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignorato */ }
  }

  function hasChosenLang() {
    try { return LANGS.includes(localStorage.getItem(LANG_KEY)); } catch (e) { return false; }
  }

  function t(key, vars) {
    const dict = STRINGS[getLang()] || STRINGS.it;
    let str = dict[key] != null ? dict[key] : (STRINGS.it[key] != null ? STRINGS.it[key] : key);
    if (vars) {
      Object.keys(vars).forEach((k) => { str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]); });
    }
    return str;
  }

  // Applica le traduzioni a ogni elemento statico dell'HTML marcato con
  // data-i18n (testo) o data-i18n-placeholder (attributo placeholder) —
  // serve per lo scheletro fisso in index.html, che non passa da nessuna
  // vista JS e quindi non può chiamare t() al momento del render.
  function applyStaticTranslations(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    (root || document).querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
    });
  }

  return { t, getLang, setLang, hasChosenLang, LANGS, applyStaticTranslations };
})();
