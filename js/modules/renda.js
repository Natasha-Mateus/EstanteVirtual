import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy } from '../firebase-config.js';
import { formatBRL, formatDate, todayISO, currentMonthRef } from '../helpers.js';

const contasCol = collection(db, 'contasBancarias');
const rendaCol = collection(db, 'rendaMensal');

export async function getContas() {
  return new Promise((resolve) => {
    const unsub = onSnapshot(contasCol, (snap) => {
      resolve(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      unsub();
    });
  });
}

export function renderRenda(container) {
  const unsubs = [];

  container.innerHTML = `
    <h2 class="module-title">Renda e Reservas</h2>

    <div class="card" style="margin-bottom:24px">
      <h3>Contas cadastradas</h3>
      <form id="form-conta" class="grid grid-3" style="margin-top:12px">
        <div>
          <label>Pessoa</label>
          <select id="conta-pessoa" required>
            <option value="Natasha">Natasha</option>
            <option value="Daniel">Daniel</option>
          </select>
        </div>
        <div>
          <label>Tipo</label>
          <select id="conta-tipo" required>
            <option value="PF">PF</option>
            <option value="PJ">PJ</option>
          </select>
        </div>
        <div>
          <label>Nome/Banco</label>
          <input type="text" id="conta-nome" placeholder="Ex: Nubank">
        </div>
      </form>
      <button class="btn" id="btn-add-conta">Adicionar conta</button>
      <div id="lista-contas" style="margin-top:20px"></div>
    </div>

    <div class="card" style="margin-bottom:24px">
      <h3>Renda do mês</h3>
      <p style="color:var(--text-dim); font-size:13px; margin-top:0">Referência: ${currentMonthRef()}</p>
      <div id="renda-form-area"></div>
    </div>

    <div class="card">
      <h3>Resumo de reserva (10%)</h3>
      <div id="reserva-resumo" class="grid grid-3" style="margin-top:12px"></div>
    </div>
  `;

  document.getElementById('btn-add-conta').addEventListener('click', async () => {
    const pessoa = document.getElementById('conta-pessoa').value;
    const tipo = document.getElementById('conta-tipo').value;
    const nome = document.getElementById('conta-nome').value || `${pessoa} ${tipo}`;
    await addDoc(contasCol, { pessoa, tipo, nome, saldoAtual: 0, saldoAtualizadoEm: todayISO() });
    document.getElementById('conta-nome').value = '';
  });

  const unsubContas = onSnapshot(contasCol, (snap) => {
    const contas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderListaContas(contas);
    renderRendaForm(contas);
    renderReservaResumo(contas);
  });
  unsubs.push(unsubContas);

  function renderListaContas(contas) {
    const el = document.getElementById('lista-contas');
    if (!contas.length) {
      el.innerHTML = '<div class="empty-state">Nenhuma conta cadastrada ainda.</div>';
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>Pessoa</th><th>Tipo</th><th>Nome</th><th>Saldo atual</th><th>Atualizado em</th><th></th></tr></thead>
        <tbody>
          ${contas.map(c => `
            <tr>
              <td>${c.pessoa}</td>
              <td><span class="tag">${c.tipo}</span></td>
              <td>${c.nome}</td>
              <td>
                <input type="number" step="0.01" data-conta-id="${c.id}" class="input-saldo" value="${c.saldoAtual || 0}" style="margin-bottom:0; width:120px">
              </td>
              <td>${formatDate(c.saldoAtualizadoEm)}</td>
              <td><button class="btn-danger" data-del-conta="${c.id}">Remover</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    el.querySelectorAll('.input-saldo').forEach(inp => {
      inp.addEventListener('change', async () => {
        await updateDoc(doc(db, 'contasBancarias', inp.dataset.contaId), {
          saldoAtual: parseFloat(inp.value) || 0,
          saldoAtualizadoEm: todayISO()
        });
      });
    });
    el.querySelectorAll('[data-del-conta]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Remover esta conta?')) await deleteDoc(doc(db, 'contasBancarias', btn.dataset.delConta));
      });
    });
  }

  function renderRendaForm(contas) {
    const el = document.getElementById('renda-form-area');
    if (!contas.length) {
      el.innerHTML = '<div class="empty-state">Cadastre uma conta primeiro para lançar renda.</div>';
      return;
    }
    const mes = currentMonthRef();
    el.innerHTML = `
      <table>
        <thead><tr><th>Conta</th><th>Renda do mês</th><th>Reserva sugerida (10%)</th></tr></thead>
        <tbody>
          ${contas.map(c => `
            <tr>
              <td>${c.nome} (${c.pessoa} - ${c.tipo})</td>
              <td><input type="number" step="0.01" class="input-renda" data-conta-id="${c.id}" style="margin-bottom:0; width:140px" placeholder="0,00"></td>
              <td class="reserva-preview" data-conta-id="${c.id}" style="color:var(--olive)">R$ 0,00</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    contas.forEach(async (c) => {
      const q = query(collection(db, 'rendaMensal'));
      const snap = await new Promise(res => { const u = onSnapshot(q, s => { res(s); u(); }); });
      const existing = snap.docs.find(d => d.data().contaId === c.id && d.data().mes === mes);
      if (existing) {
        const input = el.querySelector(`.input-renda[data-conta-id="${c.id}"]`);
        input.value = existing.data().valor;
        el.querySelector(`.reserva-preview[data-conta-id="${c.id}"]`).textContent = formatBRL(existing.data().valor * 0.1);
      }
    });

    el.querySelectorAll('.input-renda').forEach(inp => {
      inp.addEventListener('change', async () => {
        const valor = parseFloat(inp.value) || 0;
        const contaId = inp.dataset.contaId;
        el.querySelector(`.reserva-preview[data-conta-id="${contaId}"]`).textContent = formatBRL(valor * 0.1);
        const q = query(collection(db, 'rendaMensal'));
        const snap = await new Promise(res => { const u = onSnapshot(q, s => { res(s); u(); }); });
        const existing = snap.docs.find(d => d.data().contaId === contaId && d.data().mes === mes);
        if (existing) {
          await updateDoc(doc(db, 'rendaMensal', existing.id), { valor });
        } else {
          await addDoc(collection(db, 'rendaMensal'), { contaId, mes, valor });
        }
        renderReservaResumo(contas);
      });
    });
  }

  async function renderReservaResumo(contas) {
    const el = document.getElementById('reserva-resumo');
    const mes = currentMonthRef();
    const snap = await new Promise(res => { const u = onSnapshot(query(rendaCol), s => { res(s); u(); }); });
    const rendasMes = snap.docs.map(d => d.data()).filter(r => r.mes === mes);
    const totalRenda = rendasMes.reduce((s, r) => s + (r.valor || 0), 0);
    const totalReserva = totalRenda * 0.1;
    const totalSaldo = contas.reduce((s, c) => s + (c.saldoAtual || 0), 0);

    el.innerHTML = `
      <div class="ledger-figure">
        <div class="value">${formatBRL(totalRenda)}</div>
        <div class="label">Renda total do casal (mês)</div>
      </div>
      <div class="ledger-figure">
        <div class="value">${formatBRL(totalReserva)}</div>
        <div class="label">Reserva do mês (10%)</div>
      </div>
      <div class="ledger-figure">
        <div class="value">${formatBRL(totalSaldo)}</div>
        <div class="label">Saldo somado em contas</div>
      </div>
    `;
  }

  return unsubs;
}
