import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import { formatBRL, todayISO, currentMonthRef } from '../helpers.js';
import { getContas } from './renda.js';

const contasFixasCol = collection(db, 'contasFixas');

export function renderContasFixas(container) {
  const unsubs = [];

  container.innerHTML = `
    <h2 class="module-title">Contas Fixas</h2>
    <div id="content-area"></div>
  `;

  init();

  async function init() {
    const contas = await getContas();
    const el = document.getElementById('content-area');
    el.innerHTML = `
      <div class="card" style="margin-bottom:24px">
        <h3>Nova conta fixa</h3>
        <div class="grid grid-4" style="margin-top:12px">
          <div><label>Nome</label><input type="text" id="cf-nome" placeholder="Ex: Aluguel"></div>
          <div><label>Valor</label><input type="number" step="0.01" id="cf-valor"></div>
          <div><label>Dia de vencimento</label><input type="number" id="cf-vencimento" min="1" max="31"></div>
          <div><label>Responsável</label>
            <select id="cf-responsavel"><option>Natasha</option><option>Daniel</option><option>Dividido</option></select>
          </div>
        </div>
        <button class="btn" id="btn-add-cf">Adicionar conta fixa</button>
      </div>
      <div id="lista-cf"></div>
    `;

    document.getElementById('btn-add-cf').addEventListener('click', async () => {
      const nome = document.getElementById('cf-nome').value;
      if (!nome) return;
      await addDoc(contasFixasCol, {
        nome,
        valor: parseFloat(document.getElementById('cf-valor').value) || 0,
        diaVencimento: parseInt(document.getElementById('cf-vencimento').value) || null,
        responsavel: document.getElementById('cf-responsavel').value,
        status: 'pendente',
        mesReferencia: currentMonthRef(),
        contaPagamentoId: null
      });
      document.getElementById('cf-nome').value = '';
      document.getElementById('cf-valor').value = '';
    });

    const unsub = onSnapshot(query(contasFixasCol), (snap) => {
      const contasFixas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const listaEl = document.getElementById('lista-cf');
      if (!contasFixas.length) {
        listaEl.innerHTML = '<div class="empty-state">Nenhuma conta fixa cadastrada ainda.</div>';
        return;
      }
      listaEl.innerHTML = `
        <table>
          <thead><tr><th>Nome</th><th>Valor</th><th>Vencimento</th><th>Responsável</th><th>Status</th><th>Pago com</th><th></th></tr></thead>
          <tbody>
            ${contasFixas.map(c => `
              <tr>
                <td>${c.nome}</td>
                <td>${formatBRL(c.valor)}</td>
                <td>dia ${c.diaVencimento || '-'}</td>
                <td>${c.responsavel}</td>
                <td><span class="tag" style="${c.status === 'pago' ? 'color:var(--olive)' : 'color:var(--terracota)'}">${c.status}</span></td>
                <td>
                  ${c.status === 'pago'
                    ? (contas.find(cc => cc.id === c.contaPagamentoId)?.nome || '-')
                    : `<select class="select-conta-pagamento" data-id="${c.id}">
                        <option value="">Selecione a conta</option>
                        ${contas.map(cc => `<option value="${cc.id}">${cc.nome}</option>`).join('')}
                       </select>`
                  }
                </td>
                <td>
                  ${c.status === 'pago'
                    ? `<button class="btn-ghost" data-reabrir="${c.id}">Reabrir</button>`
                    : `<button class="btn" data-pagar="${c.id}">Marcar como pago</button>`
                  }
                  <button class="btn-danger" data-del="${c.id}">Remover</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      listaEl.querySelectorAll('[data-pagar]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const select = listaEl.querySelector(`.select-conta-pagamento[data-id="${btn.dataset.pagar}"]`);
          const contaId = select.value;
          if (!contaId) { alert('Selecione de qual conta saiu o pagamento.'); return; }
          const contaFixa = contasFixas.find(c => c.id === btn.dataset.pagar);
          const conta = contas.find(c => c.id === contaId);
          await updateDoc(doc(db, 'contasFixas', contaFixa.id), { status: 'pago', contaPagamentoId: contaId });
          await updateDoc(doc(db, 'contasBancarias', contaId), {
            saldoAtual: (conta.saldoAtual || 0) - contaFixa.valor,
            saldoAtualizadoEm: todayISO()
          });
        });
      });

      listaEl.querySelectorAll('[data-reabrir]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const contaFixa = contasFixas.find(c => c.id === btn.dataset.reabrir);
          const conta = contas.find(c => c.id === contaFixa.contaPagamentoId);
          if (conta) {
            await updateDoc(doc(db, 'contasBancarias', conta.id), {
              saldoAtual: (conta.saldoAtual || 0) + contaFixa.valor,
              saldoAtualizadoEm: todayISO()
            });
          }
          await updateDoc(doc(db, 'contasFixas', contaFixa.id), { status: 'pendente', contaPagamentoId: null });
        });
      });

      listaEl.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Remover esta conta fixa?')) await deleteDoc(doc(db, 'contasFixas', btn.dataset.del));
        });
      });
    });
    unsubs.push(unsub);
  }

  return unsubs;
}
