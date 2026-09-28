/* ==========================================================================
   Date Night Planner — app.js
   - Supabase client initialization
   - Auth state management (sign up, log in, log out)
   - CRUD operations on the `dates` table
   - Rendering of the dashboard (board grouped by status)
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   Configuration & constants
   -------------------------------------------------------------------------- */

// Credentials come from config.js (window.ENV). See README.md.
const SUPABASE_URL = window.ENV?.SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = window.ENV?.SUPABASE_ANON_KEY?.trim();

const TABLE = 'dates';
const STATUSES = ['Wishlist', 'Maybe', 'Definite'];
const MAX_TITLE_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 40;

// Emoji shown next to well-known categories; anything else gets a sparkle.
const CATEGORY_EMOJI = {
  coffee: '☕',
  dinner: '🍝',
  outdoors: '🌲',
  movies: '🎬',
  adventure: '🧭',
  'stay in': '🛋️',
  culture: '🎨',
};

/* --------------------------------------------------------------------------
   App state
   -------------------------------------------------------------------------- */

let supabaseClient = null;
let currentUser = null;
let dates = [];            // Local cache of the user's rows
let activeFilter = 'all';  // 'all' | 'open' | 'done'

/* --------------------------------------------------------------------------
   DOM helpers
   -------------------------------------------------------------------------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Create an element with optional class name and text content (text is never parsed as HTML). */
function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Show exactly one of the top-level screens. */
function showScreen(id) {
  ['loading-screen', 'config-error', 'auth-screen', 'app-screen'].forEach((screenId) => {
    $(`#${screenId}`).classList.toggle('hidden', screenId !== id);
  });
}

/** Put a button into / out of a loading state. */
function setButtonLoading(button, isLoading) {
  if (!button) return;
  button.disabled = isLoading;
  button.classList.toggle('is-loading', isLoading);
  button.setAttribute('aria-busy', String(isLoading));
}

/* --------------------------------------------------------------------------
   Notifications
   -------------------------------------------------------------------------- */

/** Show a transient toast. type: 'success' | 'error' | 'info' */
function toast(message, type = 'info', duration = 3500) {
  const root = $('#toast-root');
  const node = el('div', `toast toast-${type}`, message);
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  root.appendChild(node);

  setTimeout(() => {
    node.classList.add('is-leaving');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
    // Fallback removal in case transitions are disabled
    setTimeout(() => node.remove(), 400);
  }, duration);
}

/** Show an inline message on the auth card. */
function setAuthMessage(message, type = 'error') {
  const box = $('#auth-message');
  if (!message) {
    box.classList.add('hidden');
    box.textContent = '';
    return;
  }
  box.textContent = message;
  box.className = `mb-4 rounded-lg px-4 py-3 text-sm ${type === 'error' ? 'msg-error' : 'msg-info'}`;
}

/** Turn Supabase / network errors into something a human can read. */
function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  const msg = String(error.message || error.error_description || error);

  if (/failed to fetch|networkerror|network request failed/i.test(msg)) {
    return 'Can’t reach the server. Check your connection and try again.';
  }
  if (/invalid login credentials/i.test(msg)) return 'That email and password don’t match.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first — check your inbox.';
  if (/user already registered/i.test(msg)) return 'An account with that email already exists. Try logging in.';
  if (/rate limit/i.test(msg)) return 'Too many attempts. Please wait a moment and try again.';
  if (/jwt expired|invalid jwt/i.test(msg)) return 'Your session expired. Please log in again.';
  if (/row-level security/i.test(msg)) return 'You don’t have permission to do that.';

  return msg || fallback;
}

/* --------------------------------------------------------------------------
   Initialization
   -------------------------------------------------------------------------- */

function init() {
  // Guard: SDK or credentials missing → show setup instructions instead of crashing.
  if (!window.supabase?.createClient) {
    console.error('Supabase SDK failed to load.');
    showScreen('config-error');
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('YOUR_')) {
    console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in config.js');
    showScreen('config-error');
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (error) {
    console.error('Failed to create Supabase client:', error);
    showScreen('config-error');
    return;
  }

  bindAuthEvents();
  bindAppEvents();

  // onAuthStateChange fires INITIAL_SESSION on load, so it drives the first screen.
  // Work is deferred with setTimeout because awaiting Supabase calls inside this
  // callback can deadlock the auth client.
  supabaseClient.auth.onAuthStateChange((event, session) => {
    setTimeout(() => handleSession(event, session), 0);
  });
}

/** React to any auth change: show the right screen and load data as needed. */
async function handleSession(event, session) {
  const user = session?.user ?? null;

  if (!user) {
    currentUser = null;
    dates = [];
    showScreen('auth-screen');
    return;
  }

  // Token refreshes etc. for the same user don't need a full reload.
  if (currentUser?.id === user.id && event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN') {
    currentUser = user;
    return;
  }
  const isSameUser = currentUser?.id === user.id;
  currentUser = user;

  $('#user-email').textContent = user.email ?? '';
  showScreen('app-screen');
  if (!isSameUser) await loadDates();
}

/* --------------------------------------------------------------------------
   Authentication
   -------------------------------------------------------------------------- */

function bindAuthEvents() {
  $('#tab-login').addEventListener('click', () => switchAuthTab('login'));
  $('#tab-register').addEventListener('click', () => switchAuthTab('register'));
  $('#login-form').addEventListener('submit', handleLogin);
  $('#register-form').addEventListener('submit', handleRegister);
  $('#logout-btn').addEventListener('click', handleLogout);
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  $('#tab-login').classList.toggle('is-active', isLogin);
  $('#tab-register').classList.toggle('is-active', !isLogin);
  $('#tab-login').setAttribute('aria-selected', String(isLogin));
  $('#tab-register').setAttribute('aria-selected', String(!isLogin));
  $('#login-form').classList.toggle('hidden', !isLogin);
  $('#register-form').classList.toggle('hidden', isLogin);
  setAuthMessage('');
}

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const email = form.email.value.trim();
  const password = form.password.value;

  if (!isValidEmail(email)) return setAuthMessage('Please enter a valid email address.');
  if (!password) return setAuthMessage('Please enter your password.');

  setAuthMessage('');
  setButtonLoading(button, true);
  try {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    form.reset();
    // onAuthStateChange takes it from here.
  } catch (error) {
    console.error('Login failed:', error);
    setAuthMessage(friendlyError(error));
  } finally {
    setButtonLoading(button, false);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const email = form.email.value.trim();
  const password = form.password.value;
  const confirm = form.confirm.value;

  if (!isValidEmail(email)) return setAuthMessage('Please enter a valid email address.');
  if (password.length < 6) return setAuthMessage('Password must be at least 6 characters.');
  if (password !== confirm) return setAuthMessage('Passwords don’t match.');

  setAuthMessage('');
  setButtonLoading(button, true);
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    if (error) throw error;

    form.reset();
    if (!data.session) {
      // Email confirmation is enabled in the Supabase project.
      switchAuthTab('login');
      setAuthMessage('Almost there! Check your inbox to confirm your email, then log in.', 'info');
    }
    // If a session was returned, onAuthStateChange signs the user in.
  } catch (error) {
    console.error('Registration failed:', error);
    setAuthMessage(friendlyError(error));
  } finally {
    setButtonLoading(button, false);
  }
}

async function handleLogout() {
  const button = $('#logout-btn');
  setButtonLoading(button, true);
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    toast('Logged out. See you soon!', 'info');
  } catch (error) {
    console.error('Logout failed:', error);
    // Clear the local session anyway so the user isn't stuck.
    await supabaseClient.auth.signOut({ scope: 'local' }).catch(() => {});
    toast(friendlyError(error, 'Logged out locally.'), 'error');
  } finally {
    setButtonLoading(button, false);
  }
}

/* --------------------------------------------------------------------------
   CRUD — data access layer
   Row Level Security in Supabase ensures users only touch their own rows;
   user_id filters here are defense in depth.
   -------------------------------------------------------------------------- */

async function fetchDates() {
  const { data, error } = await supabaseClient
    .from(TABLE)
    .select('id, title, category, status, is_completed, created_at')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function createDate({ title, category, status }) {
  const { data, error } = await supabaseClient
    .from(TABLE)
    .insert({ user_id: currentUser.id, title, category, status, is_completed: false })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateDate(id, changes) {
  const { data, error } = await supabaseClient
    .from(TABLE)
    .update(changes)
    .eq('id', id)
    .eq('user_id', currentUser.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function removeDate(id) {
  const { error } = await supabaseClient
    .from(TABLE)
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);
  if (error) throw error;
}

/* --------------------------------------------------------------------------
   Dashboard actions
   -------------------------------------------------------------------------- */

function bindAppEvents() {
  $('#add-form').addEventListener('submit', handleAdd);

  $$('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      activeFilter = chip.dataset.filter;
      $$('.filter-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
      render();
    });
  });

  // Event delegation for card actions (toggle / delete / status change).
  const board = $('#board');
  board.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (button.dataset.action === 'toggle') handleToggle(id);
    if (button.dataset.action === 'delete') handleDelete(id);
  });
  board.addEventListener('change', (event) => {
    const select = event.target.closest('select[data-action="status"]');
    if (!select) return;
    const id = select.closest('[data-id]')?.dataset.id;
    if (id) handleStatusChange(id, select.value);
  });
}

async function loadDates() {
  $('#list-loading').classList.remove('hidden');
  $('#board').classList.add('hidden');
  $('#empty-state').classList.add('hidden');
  try {
    dates = await fetchDates();
  } catch (error) {
    console.error('Failed to load dates:', error);
    dates = [];
    toast(friendlyError(error, 'Couldn’t load your dates.'), 'error');
  } finally {
    $('#list-loading').classList.add('hidden');
    render();
  }
}

async function handleAdd(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const title = form.title.value.trim();
  const category = form.category.value.trim();
  const status = form.status.value;

  // Validation
  form.title.setAttribute('aria-invalid', String(!title));
  form.category.setAttribute('aria-invalid', String(!category));
  if (!title || !category) return toast('Please add a title and a category.', 'error');
  if (title.length > MAX_TITLE_LENGTH) return toast(`Title must be ${MAX_TITLE_LENGTH} characters or fewer.`, 'error');
  if (category.length > MAX_CATEGORY_LENGTH) return toast(`Category must be ${MAX_CATEGORY_LENGTH} characters or fewer.`, 'error');
  if (!STATUSES.includes(status)) return toast('Please pick a valid status.', 'error');

  setButtonLoading(button, true);
  try {
    const created = await createDate({ title, category, status });
    dates.unshift(created);
    render();
    form.reset();
    form.title.focus();
    toast('Date idea added ✨', 'success');
  } catch (error) {
    console.error('Failed to add date:', error);
    toast(friendlyError(error, 'Couldn’t add that date.'), 'error');
  } finally {
    setButtonLoading(button, false);
  }
}

/**
 * Apply an update optimistically, then reconcile with the server.
 * Rolls back the local change if the request fails.
 */
async function applyUpdate(id, changes, successMessage) {
  const index = dates.findIndex((d) => d.id === id);
  if (index === -1) return;

  const previous = { ...dates[index] };
  dates[index] = { ...previous, ...changes };
  render();
  setCardBusy(id, true);

  try {
    const saved = await updateDate(id, changes);
    const i = dates.findIndex((d) => d.id === id);
    if (i !== -1) dates[i] = saved;
    if (successMessage) toast(successMessage, 'success', 2000);
  } catch (error) {
    console.error('Failed to update date:', error);
    const i = dates.findIndex((d) => d.id === id);
    if (i !== -1) dates[i] = previous;
    toast(friendlyError(error, 'Couldn’t save that change.'), 'error');
  } finally {
    render();
  }
}

function handleToggle(id) {
  const item = dates.find((d) => d.id === id);
  if (!item) return;
  const nowCompleted = !item.is_completed;
  applyUpdate(id, { is_completed: nowCompleted }, nowCompleted ? 'Memory made 💛' : 'Marked as not done');
}

function handleStatusChange(id, status) {
  if (!STATUSES.includes(status)) return;
  applyUpdate(id, { status }, `Moved to ${status}`);
}

async function handleDelete(id) {
  const item = dates.find((d) => d.id === id);
  if (!item) return;
  if (!window.confirm(`Delete “${item.title}”? This can’t be undone.`)) return;

  setCardBusy(id, true);
  try {
    await removeDate(id);
    dates = dates.filter((d) => d.id !== id);
    toast('Date deleted', 'info', 2000);
  } catch (error) {
    console.error('Failed to delete date:', error);
    toast(friendlyError(error, 'Couldn’t delete that date.'), 'error');
  } finally {
    render();
  }
}

function setCardBusy(id, busy) {
  const card = $(`#board [data-id="${CSS.escape(id)}"]`);
  card?.classList.toggle('is-busy', busy);
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

function render() {
  renderStats();

  const visible = dates.filter((d) => {
    if (activeFilter === 'open') return !d.is_completed;
    if (activeFilter === 'done') return d.is_completed;
    return true;
  });

  const hasAny = dates.length > 0;
  $('#board').classList.toggle('hidden', !hasAny);
  $('#empty-state').classList.toggle('hidden', hasAny);
  if (!hasAny) return;

  STATUSES.forEach((status) => {
    // Open items first, then completed; newest first within each group.
    const items = visible
      .filter((d) => d.status === status)
      .sort((a, b) => Number(a.is_completed) - Number(b.is_completed)
        || new Date(b.created_at) - new Date(a.created_at));

    const list = $(`[data-list="${status}"]`);
    list.replaceChildren(
      ...(items.length ? items.map(createCard) : [el('li', 'column-empty', emptyColumnText())])
    );
    $(`[data-count="${status}"]`).textContent = String(items.length);
  });
}

function emptyColumnText() {
  if (activeFilter === 'done') return 'Nothing completed here yet';
  if (activeFilter === 'open') return 'All caught up';
  return 'No ideas here yet';
}

function renderStats() {
  const done = dates.filter((d) => d.is_completed).length;
  $('#stat-total').textContent = String(dates.length);
  $('#stat-definite').textContent = String(dates.filter((d) => d.status === 'Definite' && !d.is_completed).length);
  $('#stat-open').textContent = String(dates.length - done);
  $('#stat-done').textContent = String(done);
}

/** Build a single date card. All user content is set via textContent (XSS-safe). */
function createCard(item) {
  const card = el('li', `date-card${item.is_completed ? ' is-completed' : ''}`);
  card.dataset.id = item.id;

  // Row 1: completion toggle + title
  const top = el('div', 'flex items-start gap-3');
  const toggle = el('button', 'complete-toggle mt-0.5', '✓');
  toggle.type = 'button';
  toggle.dataset.action = 'toggle';
  toggle.setAttribute('aria-pressed', String(item.is_completed));
  toggle.setAttribute('aria-label', item.is_completed ? `Mark “${item.title}” as not done` : `Mark “${item.title}” as done`);
  toggle.title = item.is_completed ? 'Mark as not done' : 'Mark as done';

  const body = el('div', 'min-w-0 flex-1');
  body.appendChild(el('p', 'date-title', item.title));

  const meta = el('div', 'mt-1.5 flex flex-wrap items-center gap-1.5');
  const emoji = CATEGORY_EMOJI[item.category?.toLowerCase()] ?? '✨';
  meta.appendChild(el('span', 'category-badge', `${emoji} ${item.category}`));
  if (item.is_completed) meta.appendChild(el('span', 'done-badge', 'Done'));
  body.appendChild(meta);

  top.append(toggle, body);

  // Row 2: status select + date + delete
  const bottom = el('div', 'mt-3 flex items-center justify-between gap-2');
  const left = el('div', 'flex items-center gap-2 min-w-0');

  const select = el('select', 'status-select');
  select.dataset.action = 'status';
  select.setAttribute('aria-label', `Status for “${item.title}”`);
  STATUSES.forEach((status) => {
    const option = el('option', '', status);
    option.value = status;
    option.selected = status === item.status;
    select.appendChild(option);
  });

  const created = el('time', 'text-xs text-cocoa-500 truncate', formatDate(item.created_at));
  if (item.created_at) created.dateTime = item.created_at;

  left.append(select, created);

  const del = el('button', 'icon-btn', 'Delete');
  del.type = 'button';
  del.dataset.action = 'delete';
  del.setAttribute('aria-label', `Delete “${item.title}”`);

  bottom.append(left, del);
  card.append(top, bottom);
  return card;
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
