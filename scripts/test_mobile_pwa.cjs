const assert = require('assert');

console.log('=== TEST UNITAIRE : LOGIQUE DE NAVIGATION MOBILE & ANTI-FERMETURE ACCIDENTELLE ===');

// Simulation de la pile d'historique du navigateur
class MockHistory {
  constructor() {
    this.stack = [{ screen: 'home' }];
    this.currentIndex = 0;
  }

  get state() {
    return this.stack[this.currentIndex];
  }

  pushState(state, title, url) {
    this.stack = this.stack.slice(0, this.currentIndex + 1);
    this.stack.push(state);
    this.currentIndex++;
  }

  replaceState(state, title, url) {
    this.stack[this.currentIndex] = state;
  }

  back() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return true;
    }
    return false;
  }
}

const mockHistory = new MockHistory();

// Simulation du contrôleur de navigation mobile
let activeModal = null;
let isDrawerOpen = false;
let activeGame = null;
let pwaExited = false;
let toastVisible = false;
let lastBackPressTime = 0;

function handleBackGesture(now = Date.now()) {
  // 1. Si un modal est ouvert -> fermer le modal
  if (activeModal) {
    activeModal = null;
    return 'MODAL_CLOSED';
  }

  // 2. Si le drawer de navigation est ouvert -> fermer le drawer
  if (isDrawerOpen) {
    isDrawerOpen = false;
    return 'DRAWER_CLOSED';
  }

  // 3. Si un jeu est en cours -> quitter la partie proprement sans fermer l'app
  if (activeGame) {
    activeGame = null;
    return 'GAME_EXITED';
  }

  // 4. À la racine : protection double-tap
  if (lastBackPressTime > 0 && now - lastBackPressTime < 2000) {
    pwaExited = true;
    return 'APP_EXITED';
  }

  lastBackPressTime = now;
  toastVisible = true;
  return 'EXIT_TOAST_SHOWN';
}

// Scénario 1 : L'utilisateur ouvre les paramètres puis appuie sur Retour
activeModal = 'settings';
let action = handleBackGesture();
assert.strictEqual(action, 'MODAL_CLOSED');
assert.strictEqual(activeModal, null, 'Le modal doit être fermé');
assert.strictEqual(pwaExited, false, 'La PWA ne doit JAMAIS se fermer sur retour de modal');
console.log('✓ Scénario 1 validé : Le retour ferme le modal sans fermer la PWA.');

// Scénario 2 : L'utilisateur lance un jeu puis appuie sur Retour
activeGame = 'androdun.zip';
action = handleBackGesture();
assert.strictEqual(action, 'GAME_EXITED');
assert.strictEqual(activeGame, null, 'Le jeu doit être quitté vers la bibliothèque');
assert.strictEqual(pwaExited, false, 'La PWA ne doit JAMAIS se fermer en pleine partie');
console.log('✓ Scénario 2 validé : Le retour quitte le jeu vers la bibliothèque sans fermer la PWA.');

// Scénario 3 : L'utilisateur est sur la bibliothèque et appuie sur Retour une première fois
action = handleBackGesture(1000);
assert.strictEqual(action, 'EXIT_TOAST_SHOWN');
assert.strictEqual(toastVisible, true, 'Le toast "Appuyez à nouveau pour quitter" doit s\'afficher');
assert.strictEqual(pwaExited, false, 'La PWA ne doit PAS se fermer au premier appui');
console.log('✓ Scénario 3 validé : Premier appui affiche le toast sans fermer l\'application.');

// Scénario 4 : Deuxième appui après 3 secondes (délai expiré)
action = handleBackGesture(5000);
assert.strictEqual(action, 'EXIT_TOAST_SHOWN');
assert.strictEqual(pwaExited, false, 'Le délai étant dépassé, l\'app ne se ferme pas');
console.log('✓ Scénario 4 validé : Délai de double-tap respecté.');

// Scénario 5 : Deuxième appui rapide (dans les 2 secondes)
action = handleBackGesture(5500);
assert.strictEqual(action, 'APP_EXITED');
assert.strictEqual(pwaExited, true, 'Deux appuis rapprochés permettent la sortie volontaire');
console.log('✓ Scénario 5 validé : Double-tap rapide confirme la sortie de l\'application.');

console.log('=== TOUS LES TESTS DE NAVIGATION MOBILE SONT VALIDÉS AVEC SUCCÈS ! ===');
