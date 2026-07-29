import { db, collection, onSnapshot, query } from '../firebase-config.js';
import { formatBRL, currentMonthRef, monthRefFromDate, todayISO, daysBetween } from '../helpers.js';

export function renderDashboard(container) {
  const unsubs = [];

  container.innerHTML = `
    <h2 class="module-title">Dashboard</h2>
    <div class="grid grid-3" style="margin-bottom:24px" id="resumo-topo"></div>
    <div class="grid grid-2" style="margin-bottom:24px">
      <div class="card">
        <h3>Mercado (mês)</h3>
        <div id="card-mercado" style="margin-top:12px"></div>
      </div>
      <div class="card">
        <h3>Cartão de Crédito (mês)</h3>
        <div id="card-cartao" style="margin-top:12px"></div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-bottom:24px">
      <div class="card">
        <h3>Alertas e pendências</h3>
        <div id="card-alertas" style="margin-top:12px"></div>
      </div>
      <div class="card">
        <h3>Saldo em contas</h3>
        <div id="card-saldo" style="margin-top:12px"></div>
      </div>
    </div>
  `;

  const mes = currentMonthRef();

  const unsub1 = onSnapshot(query(collection(db, 'mercadoCompras')), (snap) => {
    const compras = snap.docs.map(d => d.data()).filter(c => monthRefFromDate(c.data) === mes);
    const total = compras.reduce((s, c) => s + (c.valorTotal || 0), 0);
    document.getElementById('card-mercado').innerHTML = `
      <div class="ledger-figure">
        <div class="value">${formatBRL(total)}</div>
        <div class="label">${compras.length} ida(s) ao mercado este mês</div>
      </div>
    `;
    atualizarTotalGeral();
  });
  unsubs.push(unsub1);

  const unsub2 = onSnapshot(query(collection(db, 'cartaoLancamentos')), (snap) => {
    const lancs = snap.docs.map(d => d.data());
    let totalMes = 0;
    let totalHerdado = 0;
    lancs.forEach(l => {
      const parcelas = l.parcelado ? l.numParcelas : 1;
      const valorParcela = l.valorTotal / parcelas;
      const mesBase = monthRefFromDate(l.data);
      const [ano, mesN] = mesBase.split('-').map(Number);
      for (let p = 0; p < parcelas; p++) {
        const d = new Date(ano, (mesN - 1) + p, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key === mes) {
          totalMes += valorParcela;
          if (p > 0) totalHerdado += valorParcela;
        }
      }
    });
    document.getElementById('card-cartao').innerHTML = `
      <div class="ledger-figure">
        <div class="value">${formatBRL(totalMes)}</div>
        <div class="label">Total das faturas este mês</div>
      </div>
      <p style="color:var(--text-dim); font-size:13px; margin-top:10px">${formatBRL(totalHerdado)} são parcelas de compras anteriores</p>
    `;
    atualizarTotalGeral();
  });
  unsubs.push(unsub2);

  let totalMercado = 0, totalCartao = 0, totalFixas = 0, totalRenda = 0, totalGuardado = 0;

  const unsub3 = onSnapshot(query(collection(db, 'contasFixas')), (snap) => {
    const fixas = snap.docs.map(d => d.data()).filter(c => c.mesReferencia === mes);
    totalFixas = fixas.reduce((s, c) => s + (c.valor || 0), 0);
    const pendentes = fixas.filter(c => c.status !== 'pago');
    renderAlertas(pendentes);
    atualizarTotalGeral();
  });
  unsubs.push(unsub3);

  const unsub4 = onSnapshot(query(collection(db, 'itensEmUso')), (snap) => {
    const itens = snap.docs.map(d => d.data()).filter(i => i.status === 'em_uso');
    const emUsoHaMuito = itens.filter(i => daysBetween(i.dataCompra, todayISO()) > 20);
    renderAlertasItens(emUsoHaMuito);
  });
  unsubs.push(unsub4);

  const unsub5 = onSnapshot(query(collection(db, 'contasBancarias')), (snap) => {
    const contas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const totalSaldo = contas.reduce((s, c) => s + (c.saldoAtual || 0), 0);
    document.getElementById('card-saldo').innerHTML = contas.length ? `
      ${contas.map(c => `
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border)">
          <span>${c.nome} <span class="tag">${c.pessoa} · ${c.tipo}</span></span>
          <span>${formatBRL(c.saldoAtual)}</span>
        </div>
      `).join('')}
      <div class="ledger-figure"><div class="value">${formatBRL(totalSaldo)}</div><div class="label">Total somado</div></div>
    ` : '<div class="empty-state">Nenhuma conta cadastrada ainda.</div>';
  });
  unsubs.push(unsub5);

  const unsub6 = onSnapshot(query(collection(db, 'rendaMensal')), (snap) => {
    const rendas = snap.docs.map(d => d.data()).filter(r => r.mes === mes);
    totalRenda = rendas.reduce((s, r) => s + (r.valor || 0), 0);
    totalGuardado = totalRenda * 0.1;
    atualizarTotalGeral();
  });
  unsubs.push(unsub6);

  function atualizarTotalGeral() {
    const totalGastos = totalMercado + totalCartao + totalFixas;
    const sobra = totalRenda - totalGastos - totalGuardado;
    document.getElementById('resumo-topo').innerHTML = `
      <div class="ledger-figure">
        <div class="value">${formatBRL(totalRenda)}</div>
        <div class="label">Renda do mês (casal)</div>
      </div>
      <div class="ledger-figure">
        <div class="value">${formatBRL(totalGastos)}</div>
        <div class="label">Total gasto (mercado + cartão + fixas)</div>
      </div>
      <div class="ledger-figure">
        <div class="value" style="color:${sobra >= 0 ? 'var(--olive)' : 'var(--terracota)'}">${formatBRL(sobra)}</div>
        <div class="label">Sobra estimada do mês</div>
      </div>
    `;
  }

  function renderAlertas(pendentes) {
    const el = document.getElementById('card-alertas');
    if (!pendentes.length) {
      el.innerHTML = '<div class="empty-state">Nenhuma conta fixa pendente. 🎉</div>';
      return;
    }
    el.innerHTML = pendentes.map(c => `
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border)">
        <span>${c.nome} — vence dia ${c.diaVencimento || '-'}</span>
        <span style="color:var(--terracota)">${formatBRL(c.valor)}</span>
      </div>
    `).join('');
  }

  function renderAlertasItens(itens) {
    const el = document.getElementById('card-alertas');
    if (!itens.length) return;
    const extra = itens.map(i => `
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border)">
        <span>${i.itemNome} está em uso há ${daysBetween(i.dataCompra, todayISO())} dias</span>
        <span class="tag">verificar estoque</span>
      </div>
    `).join('');
    el.innerHTML += extra;
  }

  return unsubs;
}
