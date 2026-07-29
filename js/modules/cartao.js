import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import { formatBRL, formatDate, todayISO, monthRefFromDate } from '../helpers.js';

const cartoesCol = collection(db, 'cartoes');
const lancamentosCol = collection(db, 'cartaoLancamentos');
const mercadoComprasCol = collection(db, 'mercadoCompras');
const valeConfigCol = collection(db, 'valeAlimentacaoConfig');

const CATEGORIAS = ['Mercado', 'Lazer', 'Vestuário', 'Saúde', 'Casa', 'Outros'];

export async function getCartoes() {
  return new Promise((resolve) => {
    const unsub = onSnapshot(cartoesCol, (snap) => {
      resolve(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      unsub();
    });
  });
}

// Chamado pelo módulo de Mercado quando a forma de pagamento é Crédito.
// Cria (ou atualiza) o lançamento espelho, vinculado à compra de origem.
export async function upsertLancamentoDeMercado({ mercadoCompraId, cartaoId, valorTotal, parcelado, numParcelas, data }) {
  const snap = await new Promise(res => { const u = onSnapshot(query(lancamentosCol), s => { res(s); u(); }); });
  const existing = snap.docs.find(d => d.data().mercadoCompraId === mercadoCompraId);
  const payload = {
    cartaoId,
    descricao: 'Compra de mercado',
    categoria: 'Mercado',
    valorTotal,
    parcelado: !!parcelado,
    numParcelas: parcelado ? numParcelas : 1,
    data,
    origem: 'mercado',
    mercadoCompraId
  };
  if (existing) {
    await updateDoc(doc(db, 'cartaoLancamentos', existing.id), payload);
  } else {
    await addDoc(lancamentosCol, payload);
  }
}

export async function removerLancamentoDeMercado(mercadoCompraId) {
  const snap = await new Promise(res => { const u = onSnapshot(query(lancamentosCol), s => { res(s); u(); }); });
  const existing = snap.docs.find(d => d.data().mercadoCompraId === mercadoCompraId);
  if (existing) await deleteDoc(doc(db, 'cartaoLancamentos', existing.id));
}

export function renderCartao(container) {
  const unsubs = [];

  container.innerHTML = `
    <h2 class="module-title">Cartão de Crédito</h2>
    <div class="tabs">
      <div class="tab active" data-tab="cartoes">Cartões</div>
      <div class="tab" data-tab="vale">Vale Alimentação</div>
      <div class="tab" data-tab="lancamentos">Lançamentos</div>
      <div class="tab" data-tab="faturas">Faturas futuras</div>
    </div>
    <div id="tab-content"></div>
  `;

  const tabContent = document.getElementById('tab-content');
  let activeTab = 'cartoes';

  container.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      renderTab();
    });
  });

  function renderTab() {
    if (activeTab === 'cartoes') renderCartoesTab();
    if (activeTab === 'vale') renderValeTab();
    if (activeTab === 'lancamentos') renderLancamentosTab();
    if (activeTab === 'faturas') renderFaturasTab();
  }

  async function renderValeTab() {
    const mes = monthRefFromDate(todayISO());
    tabContent.innerHTML = `
      <div class="card" style="margin-bottom:24px">
        <h3>Vale Alimentação (Natasha)</h3>
        <p style="color:var(--text-dim); font-size:13px; margin-top:0">O vale do Daniel não é controlado aqui — só o seu, pra acompanhar as idas ao mercado.</p>
        <div class="grid grid-2" style="margin-top:12px; max-width:500px">
          <div>
            <label>Valor recebido este mês</label>
            <input type="number" step="0.01" id="vale-valor-mensal">
          </div>
        </div>
        <button class="btn" id="btn-salvar-vale">Salvar valor do mês</button>
      </div>
      <div class="card">
        <h3>Consumo do mês</h3>
        <div id="vale-resumo" style="margin-top:16px"></div>
      </div>
    `;

    const snapConfig = await new Promise(res => { const u = onSnapshot(query(valeConfigCol), s => { res(s); u(); }); });
    const configExistente = snapConfig.docs.find(d => d.data().mes === mes);
    if (configExistente) {
      document.getElementById('vale-valor-mensal').value = configExistente.data().valorMensal;
    }

    document.getElementById('btn-salvar-vale').addEventListener('click', async () => {
      const valorMensal = parseFloat(document.getElementById('vale-valor-mensal').value) || 0;
      if (configExistente) {
        await updateDoc(doc(db, 'valeAlimentacaoConfig', configExistente.id), { valorMensal });
      } else {
        await addDoc(valeConfigCol, { mes, valorMensal });
      }
      renderValeTab();
    });

    const unsub = onSnapshot(query(mercadoComprasCol), (snap) => {
      const compras = snap.docs.map(d => d.data());
      const usadasVale = compras.filter(c =>
        c.formaPagamento === 'vale' && c.valeTitular === 'Natasha' && monthRefFromDate(c.data) === mes
      );
      const totalUsado = usadasVale.reduce((s, c) => s + (c.valorTotal || 0), 0);
      const valorMensal = configExistente ? configExistente.data().valorMensal : 0;
      const percentual = valorMensal > 0 ? Math.min(100, (totalUsado / valorMensal) * 100) : 0;
      const restante = valorMensal - totalUsado;

      document.getElementById('vale-resumo').innerHTML = `
        <div class="grid grid-3">
          <div class="ledger-figure">
            <div class="value">${formatBRL(totalUsado)}</div>
            <div class="label">Usado este mês</div>
          </div>
          <div class="ledger-figure">
            <div class="value">${percentual.toFixed(0)}%</div>
            <div class="label">Do total disponível</div>
          </div>
          <div class="ledger-figure">
            <div class="value" style="color:${restante >= 0 ? 'var(--olive)' : 'var(--terracota)'}">${formatBRL(restante)}</div>
            <div class="label">Saldo restante</div>
          </div>
        </div>
        <div style="margin-top:16px; background:var(--surface-2); border-radius:6px; height:10px; overflow:hidden">
          <div style="width:${percentual}%; height:100%; background:${percentual >= 90 ? 'var(--terracota)' : 'var(--gold)'}"></div>
        </div>
        <p style="color:var(--text-dim); font-size:13px; margin-top:16px">${usadasVale.length} compra(s) de mercado paga(s) com o vale este mês.</p>
      `;
    });
    unsubs.push(unsub);
  }

  function renderCartoesTab() {
    tabContent.innerHTML = `
      <div class="card" style="margin-bottom:24px">
        <h3>Novo cartão</h3>
        <div class="grid grid-4" style="margin-top:12px">
          <div><label>Apelido</label><input type="text" id="c-apelido" placeholder="Ex: Nubank Natasha"></div>
          <div><label>Titular</label>
            <select id="c-titular"><option>Natasha</option><option>Daniel</option></select>
          </div>
          <div><label>Dia fechamento</label><input type="number" id="c-fechamento" min="1" max="31"></div>
          <div><label>Dia vencimento</label><input type="number" id="c-vencimento" min="1" max="31"></div>
        </div>
        <button class="btn" id="btn-add-cartao">Adicionar cartão</button>
      </div>
      <div id="lista-cartoes"></div>
    `;
    document.getElementById('btn-add-cartao').addEventListener('click', async () => {
      const apelido = document.getElementById('c-apelido').value;
      if (!apelido) return;
      await addDoc(cartoesCol, {
        apelido,
        titular: document.getElementById('c-titular').value,
        diaFechamento: parseInt(document.getElementById('c-fechamento').value) || null,
        diaVencimento: parseInt(document.getElementById('c-vencimento').value) || null
      });
      document.getElementById('c-apelido').value = '';
    });

    const unsub = onSnapshot(cartoesCol, (snap) => {
      const cartoes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const el = document.getElementById('lista-cartoes');
      if (!cartoes.length) {
        el.innerHTML = '<div class="empty-state">Nenhum cartão cadastrado ainda.</div>';
        return;
      }
      el.innerHTML = `
        <table>
          <thead><tr><th>Apelido</th><th>Titular</th><th>Fechamento</th><th>Vencimento</th><th></th></tr></thead>
          <tbody>
            ${cartoes.map(c => `
              <tr>
                <td>${c.apelido}</td><td>${c.titular}</td>
                <td>dia ${c.diaFechamento || '-'}</td><td>dia ${c.diaVencimento || '-'}</td>
                <td><button class="btn-danger" data-del="${c.id}">Remover</button></td>
              </tr>`).join('')}
          </tbody>
        </table>`;
      el.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Remover cartão?')) await deleteDoc(doc(db, 'cartoes', btn.dataset.del));
        });
      });
    });
    unsubs.push(unsub);
  }

  async function renderLancamentosTab() {
    const cartoes = await getCartoes();
    tabContent.innerHTML = `
      <div class="card" style="margin-bottom:24px">
        <h3>Novo lançamento manual</h3>
        <p style="color:var(--text-dim); font-size:13px">Lançamentos de mercado entram automaticamente aqui — não precisam ser adicionados manualmente.</p>
        <div class="grid grid-3" style="margin-top:12px">
          <div><label>Cartão</label>
            <select id="l-cartao">${cartoes.map(c => `<option value="${c.id}">${c.apelido}</option>`).join('')}</select>
          </div>
          <div><label>Descrição</label><input type="text" id="l-descricao"></div>
          <div><label>Categoria</label>
            <select id="l-categoria">${CATEGORIAS.map(c => `<option>${c}</option>`).join('')}</select>
          </div>
          <div><label>Valor total</label><input type="number" step="0.01" id="l-valor"></div>
          <div><label>Data</label><input type="date" id="l-data" value="${todayISO()}"></div>
          <div><label>Parcelado?</label>
            <select id="l-parcelado"><option value="nao">Não</option><option value="sim">Sim</option></select>
          </div>
          <div id="l-parcelas-wrap" class="conditional"><label>Número de parcelas</label><input type="number" id="l-parcelas" min="2"></div>
        </div>
        <button class="btn" id="btn-add-lancamento">Adicionar lançamento</button>
      </div>
      <div id="lista-lancamentos"></div>
    `;
    document.getElementById('l-parcelado').addEventListener('change', (e) => {
      document.getElementById('l-parcelas-wrap').classList.toggle('show', e.target.value === 'sim');
    });
    document.getElementById('btn-add-lancamento').addEventListener('click', async () => {
      const parcelado = document.getElementById('l-parcelado').value === 'sim';
      await addDoc(lancamentosCol, {
        cartaoId: document.getElementById('l-cartao').value,
        descricao: document.getElementById('l-descricao').value || 'Sem descrição',
        categoria: document.getElementById('l-categoria').value,
        valorTotal: parseFloat(document.getElementById('l-valor').value) || 0,
        parcelado,
        numParcelas: parcelado ? (parseInt(document.getElementById('l-parcelas').value) || 1) : 1,
        data: document.getElementById('l-data').value,
        origem: 'manual'
      });
      document.getElementById('l-descricao').value = '';
      document.getElementById('l-valor').value = '';
    });

    const unsub = onSnapshot(query(lancamentosCol), (snap) => {
      const lancs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
      const el = document.getElementById('lista-lancamentos');
      if (!lancs.length) {
        el.innerHTML = '<div class="empty-state">Nenhum lançamento ainda.</div>';
        return;
      }
      el.innerHTML = `
        <table>
          <thead><tr><th>Data</th><th>Cartão</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Parcelas</th><th>Origem</th><th></th></tr></thead>
          <tbody>
            ${lancs.map(l => {
              const cartao = cartoes.find(c => c.id === l.cartaoId);
              return `<tr>
                <td>${formatDate(l.data)}</td>
                <td>${cartao ? cartao.apelido : '-'}</td>
                <td>${l.descricao}</td>
                <td><span class="tag">${l.categoria}</span></td>
                <td>${formatBRL(l.valorTotal)}</td>
                <td>${l.parcelado ? l.numParcelas + 'x' : '-'}</td>
                <td>${l.origem === 'mercado' ? '<span class="tag">Mercado (auto)</span>' : 'Manual'}</td>
                <td>${l.origem !== 'mercado' ? `<button class="btn-danger" data-del="${l.id}">Remover</button>` : ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
      el.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Remover lançamento?')) await deleteDoc(doc(db, 'cartaoLancamentos', btn.dataset.del));
        });
      });
    });
    unsubs.push(unsub);
  }

  async function renderFaturasTab() {
    const cartoes = await getCartoes();
    const snap = await new Promise(res => { const u = onSnapshot(query(lancamentosCol), s => { res(s); u(); }); });
    const lancs = snap.docs.map(d => d.data());

    // Projeta parcelas futuras por mês (6 meses à frente)
    const meses = [];
    const hoje = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
      meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const totalPorMes = {};
    meses.forEach(m => totalPorMes[m] = 0);

    lancs.forEach(l => {
      const parcelas = l.parcelado ? l.numParcelas : 1;
      const valorParcela = l.valorTotal / parcelas;
      const mesBase = monthRefFromDate(l.data);
      const [ano, mes] = mesBase.split('-').map(Number);
      for (let p = 0; p < parcelas; p++) {
        const d = new Date(ano, (mes - 1) + p, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (totalPorMes[key] !== undefined) totalPorMes[key] += valorParcela;
      }
    });

    tabContent.innerHTML = `
      <div class="card">
        <h3>Comprometimento futuro (todos os cartões)</h3>
        <div class="grid grid-3" style="margin-top:16px">
          ${meses.map(m => `
            <div class="ledger-figure">
              <div class="value">${formatBRL(totalPorMes[m])}</div>
              <div class="label">${m}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  renderTab();
  return unsubs;
}
