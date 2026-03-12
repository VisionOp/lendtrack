function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then(() => { window.location.href = 'dashboard.html'; })
    .catch(err => showAuthError(err.message));
}

function signInWithEmail(email, password) {
  auth.signInWithEmailAndPassword(email, password)
    .then(() => { window.location.href = 'dashboard.html'; })
    .catch(err => showAuthError(err.message));
}

function signUpWithEmail(email, password, name) {
  auth.createUserWithEmailAndPassword(email, password)
    .then(cred => cred.user.updateProfile({ displayName: name }))
    .then(() => { window.location.href = 'dashboard.html'; })
    .catch(err => showAuthError(err.message));
}

function signOut() {
  auth.signOut().then(() => { window.location.href = 'index.html'; });
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  if (el) { el.textContent = msg; el.classList.remove('d-none'); }
}
