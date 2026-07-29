import { auth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from './firebase-config.js';

import { renderDashboard } from './modules/dashboard.js';
import { renderContasFixas } from './modules/contasFixas.js';
import { renderMercadoCompra, renderMercadoEmUso, renderMercadoLista } from './modules/mercado.js';
import { renderCartao } from './modules/cartao.js';
import { renderRenda } from './modules/renda.js';

const loginScreen = document.getElementById('login-screen');
const appShell = document.getElementById('app-shell');
const mainContent = document.getElementById('main-content');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const sidebar = document.getElementById('sidebar');

const routes = {
  dashboard: renderDashboard,
  contasFixas: renderContasFixas,
  'mercado.compra': renderMercadoCompra,
  'mercado.emUso': renderMercadoEmUso,
  'mercado.lista': renderMercadoLista,
  cartao: renderCartao,
  renda: renderRenda
};

let currentRoute = 'dashboard';
let currentUnsubscribers = [];

function cleanupRoute() {
  currentUnsubscribers.forEach(fn => { try { fn(); } catch (e) {} });
  currentUnsubscribers = [];
}

function setActiveNav(route) {
  document.querySelectorAll('.nav-item[data-route]').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });
  document.querySelectorAll('.nav-subitem').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });
  if (route.startsWith('mercado.')) {
    document.querySelector('.nav-parent[data-parent="mercado"]').classList.add('open');
    document.getElementById('submenu-mercado').classList.add('open');
  }
}

async function loadRoute(route) {
  cleanupRoute();
  currentRoute = route;
  setActiveNav(route);
  mainContent.innerHTML = '<p style="color:#A5A9B3">Carregando...</p>';
  const renderFn = routes[route];
  const unsubs = await renderFn(mainContent);
  if (Array.isArray(unsubs)) currentUnsubscribers = unsubs;
}

document.querySelectorAll('.nav-item[data-route]').forEach(el => {
  el.addEventListener('click', () => loadRoute(el.dataset.route));
});

document.querySelectorAll('.nav-subitem[data-route]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    loadRoute(el.dataset.route);
  });
});

document.querySelector('.nav-parent[data-parent="mercado"]').addEventListener('click', () => {
  const submenu = document.getElementById('submenu-mercado');
  const parent = document.querySelector('.nav-parent[data-parent="mercado"]');
  const isOpen = submenu.classList.contains('open');
  if (!isOpen) {
    submenu.classList.add('open');
    parent.classList.add('open');
    loadRoute('mercado.compra');
  } else if (currentRoute.startsWith('mercado.')) {
    submenu.classList.remove('open');
    parent.classList.remove('open');
  } else {
    loadRoute('mercado.compra');
  }
});

document.getElementById('collapse-btn').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

document.getElementById('logout-btn').addEventListener('click', () => {
  cleanupRoute();
  signOut(auth);
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = 'E-mail ou senha inválidos.';
    loginError.style.display = 'block';
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.style.display = 'none';
    appShell.classList.add('active');
    loadRoute(currentRoute);
  } else {
    cleanupRoute();
    appShell.classList.remove('active');
    loginScreen.style.display = 'flex';
  }
});
