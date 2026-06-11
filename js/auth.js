/* ── AUTH MODULE (BACKEND CONNECTED) ── */

// 🔥 API BASE
const API_BASE = "http://localhost:5000";

// 🔥 TOKEN (JWT ready)
const tokenStore = {
  set(token) {
    localStorage.setItem('sentra_token', token);
  },
  get() {
    return localStorage.getItem('sentra_token');
  },
  clear() {
    localStorage.removeItem('sentra_token');
  }
};

// ── Session ──
const session = {
  set(user) {
    localStorage.setItem('sentra_session', JSON.stringify({
      name      : user.name,
      email     : user.email,
      role      : user.role,
      loggedInAt: new Date().toISOString()
    }));
  },

  get() {
    const s = localStorage.getItem('sentra_session');
    return s ? JSON.parse(s) : null;
  },

  clear() {
    localStorage.removeItem('sentra_session');
  },

  exists() {
    return !!this.get();
  }
};

// ── Validators ──
const validate = {
  email(email) {
    return /^[a-zA-Z0-9]+([._%+-]?[a-zA-Z0-9]+)*@[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})+$/.test(email);
  },
  password(pw) {
    return pw.length >= 8;
  },
  name(name) {
    return name.trim().length >= 2;
  }
};

// ── UI Error Handling ──
function showError(inputId, message) {
  clearError(inputId);
  const input = document.getElementById(inputId);
  if (!input) return;
  input.style.borderColor = 'var(--red)';
  const err = document.createElement('div');
  err.className   = 'field-error';
  err.id          = inputId + '-error';
  err.textContent = message;
  err.style.cssText = 'color:var(--red);font-size:11px;margin-top:4px;';
  input.parentNode.appendChild(err);
}

function clearError(inputId) {
  const input = document.getElementById(inputId);
  if (input) input.style.borderColor = '';
  const err = document.getElementById(inputId + '-error');
  if (err) err.remove();
}

function clearAllErrors(ids) {
  ids.forEach(id => clearError(id));
}

function showFormMsg(formId, message, type = 'error') {
  clearFormMsg(formId);
  const form = document.getElementById(formId);
  if (!form) return;
  const msg = document.createElement('div');
  msg.id            = formId + '-msg';
  msg.textContent   = message;
  msg.style.cssText = `
    padding: 10px 14px;
    border-radius: 7px;
    font-size: 12px;
    margin-bottom: 14px;
    border-left: 3px solid;
    background: ${type === 'error' ? 'var(--red-bg)' : type === 'warning' ? 'var(--orange-bg)' : 'var(--green-bg)'};
    border-color: ${type === 'error' ? 'var(--red)' : type === 'warning' ? 'var(--orange)' : 'var(--green)'};
    color: ${type === 'error' ? 'var(--red)' : type === 'warning' ? 'var(--orange)' : 'var(--green)'};
  `;
  form.prepend(msg);
}

function clearFormMsg(formId) {
  const msg = document.getElementById(formId + '-msg');
  if (msg) msg.remove();
}

function clearAuthErrors() {
  clearAllErrors(['login-email', 'login-pass']);
  clearAllErrors(['signup-firstname', 'signup-lastname', 'signup-email', 'signup-pass', 'signup-confirm']);
  clearFormMsg('login-form');
  clearFormMsg('signup-form');

  const signupLink = document.querySelector('#auth-login .auth-switch a');
  if (signupLink) {
    signupLink.style.color      = '';
    signupLink.style.fontWeight = '';
    signupLink.textContent      = 'Create one';
  }
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? 'Please wait...' : btn.dataset.label;
}

// ── LOGIN ──
async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pass').value;
  const rememberEl = document.getElementById('login-remember');
  const remember   = rememberEl ? rememberEl.checked : false;

  clearAllErrors(['login-email', 'login-pass']);
  clearFormMsg('login-form');

  const signupLink = document.querySelector('#auth-login .auth-switch a');
  if (signupLink) {
    signupLink.style.color      = '';
    signupLink.style.fontWeight = '';
    signupLink.textContent      = 'Create one';
  }

  // ✅ FIXED: was incorrectly targeting 'signup-email' in original
  if (!validate.email(email)) {
    showError('login-email', 'Enter a valid email (e.g. user@gmail.com)');
    return;
  }

  if (!password) {
    showError('login-pass', 'Password is required');
    return;
  }

  setLoading('login-btn', true);

  try {
    const response = await fetch(`${API_BASE}/api/login`, {   // ✅ UPDATED
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      setLoading('login-btn', false);

      if (response.status === 404) {
        showFormMsg('login-form', 'No account found with this email.', 'error');
        if (signupLink) {
          signupLink.style.color      = 'var(--red)';
          signupLink.style.fontWeight = 'bold';
          signupLink.textContent      = 'Create one now →';
        }
      } else {
        showFormMsg('login-form', data.error || 'Incorrect password. Please try again.', 'error');
      }
      return;
    }

    // 🔥 NEW: optional JWT support
    if (data.token) tokenStore.set(data.token);

    session.set(data.user);

    if (remember) {
      localStorage.setItem('sentra_remember', email);
    } else {
      localStorage.removeItem('sentra_remember');
    }

    setLoading('login-btn', false);
    enterApp(data.user);

  } catch (error) {
    setLoading('login-btn', false);
    showFormMsg('login-form', 'Connection error. Is your Node server running?', 'error');
  }
}

// ── SIGNUP ──
async function handleSignup() {
  const firstName = document.getElementById('signup-firstname').value.trim();
  const lastName  = document.getElementById('signup-lastname').value.trim();
  const email     = document.getElementById('signup-email').value.trim();
  const role      = document.getElementById('signup-role').value;
  const password  = document.getElementById('signup-pass').value;
  const confirm   = document.getElementById('signup-confirm').value;

  clearAllErrors(['signup-firstname', 'signup-lastname', 'signup-email', 'signup-pass', 'signup-confirm']);
  clearFormMsg('signup-form');

  let hasError = false;
  if (!validate.name(firstName))     { showError('signup-firstname', 'Enter your first name');                  hasError = true; }
  if (!validate.name(lastName))      { showError('signup-lastname',  'Enter your last name');                   hasError = true; }
  if (!validate.email(email))        { showError('signup-email',     'Enter a valid email address');            hasError = true; }
  if (!validate.password(password))  { showError('signup-pass',      'Password must be at least 8 characters'); hasError = true; }
  if (password !== confirm)          { showError('signup-confirm',   'Passwords do not match');                 hasError = true; }

  if (hasError) return;

  setLoading('signup-btn', true);

  try {
    const response = await fetch(`${API_BASE}/api/signup`, {   // ✅ UPDATED
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName,
        lastName,
        email: email.toLowerCase(),
        password,
        nodeRole: role
      })
    });

    const data = await response.json();

    if (response.ok) {
      setLoading('signup-btn', false);
      showLogin();
      showFormMsg('login-form', 'Account created! You can now sign in.', 'success');
    } else {
      setLoading('signup-btn', false);
      showFormMsg('signup-form', data.error || 'Signup failed', 'error');
    }
  } catch (error) {
    setLoading('signup-btn', false);
    showFormMsg('signup-form', 'Connection error to database server.', 'error');
  }
}

// 🔥 NEW: Protect App
function requireAuth() {
  if (!session.exists()) {
    logout();
    alert("Please login first");
  }
}

// ── ENTER APP ──
function enterApp(user) {
  const nameEl   = document.getElementById('displayUserName') || document.querySelector('.user-name');
  const roleEl   = document.getElementById('displayUserRole') || document.querySelector('.user-role');
  const avatarEl = document.getElementById('avatarLetter')   || document.querySelector('.user-avatar');

  if (nameEl)   nameEl.textContent   = user.name;
  if (roleEl)   roleEl.textContent   = user.role.split(' — ')[0];
  if (avatarEl) avatarEl.textContent = user.name.charAt(0).toUpperCase();

  document.getElementById('auth-login').style.display   = 'none';
  document.getElementById('auth-signup').style.display  = 'none';
  const authBtn = document.getElementById('authThemeBtn');
  if (authBtn) authBtn.style.display = 'none';
  document.getElementById('app').style.display = 'block';

  if (typeof initApp === 'function')     initApp();
  if (typeof initCharts === 'function')  initCharts();
  if (typeof renderFeed === 'function')  renderFeed();
  if (typeof renderNodes === 'function') renderNodes();
  if (typeof startClock === 'function')  startClock();
}

// ── LOGOUT ──
function logout() {
  session.clear();
  tokenStore.clear(); // 🔥 also clear token on logout
  document.getElementById('app').style.display = 'none';
  const authBtn = document.getElementById('authThemeBtn');
  if (authBtn) authBtn.style.display = 'block';

  const emailInput = document.getElementById('login-email');
  const passInput  = document.getElementById('login-pass');
  if (emailInput) emailInput.value = '';
  if (passInput)  passInput.value  = '';

  clearFormMsg('login-form');
  document.getElementById('auth-login').style.display = 'flex';
}

// ── PAGE SWITCHERS ──
function showSignup() {
  clearAuthErrors();
  document.getElementById('auth-login').style.display  = 'none';
  document.getElementById('auth-signup').style.display = 'flex';
}

function showLogin() {
  clearAuthErrors();
  document.getElementById('auth-signup').style.display = 'none';
  document.getElementById('auth-login').style.display  = 'flex';
}

// ── THEME TOGGLE ──
function toggleTheme() {
  const html  = document.documentElement;
  const next  = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);

  const icon    = document.getElementById('themeIcon');
  const label   = document.getElementById('themeLabel');
  const authBtn = document.getElementById('authThemeBtn');

  if (next === 'light') {
    if (icon)    icon.textContent    = '🌙';
    if (label)   label.textContent   = 'Dark mode';
    if (authBtn) authBtn.textContent = '🌙';
  } else {
    if (icon)    icon.textContent    = '☀️';
    if (label)   label.textContent   = 'Light mode';
    if (authBtn) authBtn.textContent = '☀️';
  }
}

// ── AUTO LOGIN ──
window.addEventListener('DOMContentLoaded', () => {
  const existing = session.get();

  // 🔥 safer check: ensure session has email before auto-entering
  if (existing && existing.email) {
    enterApp(existing);
    return;
  }

  const remembered = localStorage.getItem('sentra_remember');
  if (remembered) {
    const emailInput  = document.getElementById('login-email');
    const rememberChk = document.getElementById('login-remember');
    if (emailInput)   emailInput.value   = remembered;
    if (rememberChk) rememberChk.checked = true;
  }
});