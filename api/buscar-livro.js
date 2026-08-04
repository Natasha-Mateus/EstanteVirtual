// /api/buscar-livro.js
// Função serverless (Vercel) — roda no servidor, nunca no navegador.
// A chave do Gemini fica em process.env.GEMINI_API_KEY (configurada no painel do Vercel).

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ encontrado: false, mensagem: 'Método não permitido.' });
    return;
  }

  const { titulo, autor } = req.body || {};
  if (!titulo || !String(titulo).trim()) {
    res.status(400).json({ encontrado: false, mensagem: 'Informe o título do livro.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ encontrado: false, mensagem: 'Chave da API do Gemini não configurada no servidor (variável GEMINI_API_KEY ausente no Vercel).' });
    return;
  }

  const tituloLimpo = String(titulo).trim();
  const autorLimpo = autor ? String(autor).trim() : '';

  const schema = {
    type: 'object',
    properties: {
      encontrado: {
        type: 'boolean',
        description: 'true somente se houver confiança razoável na identificação exata do livro'
      },
      titulo: { type: 'string', description: 'Título completo e correto do livro' },
      autor: { type: 'string', description: 'Nome do autor principal' },
      paginas: { type: 'integer', description: 'Número total de páginas da edição mais comum/conhecida' },
      genero: {
        type: 'string',
        description: 'Gênero literário principal, em português do Brasil (ex: Ficção, Romance, Fantasia, Suspense, Terror, Biografia, Autoajuda, Não-ficção, História, Poesia, Infantojuvenil)'
      },
      isbn: { type: 'string', description: 'ISBN-13 do livro (apenas números), se souber' }
    },
    required: ['encontrado']
  };

  const prompt =
    `Identifique o livro com o título "${tituloLimpo}"` +
    (autorLimpo ? ` do autor "${autorLimpo}"` : '') +
    `. Se você tiver confiança razoável de qual livro é esse, retorne encontrado=true com os ` +
    `demais campos preenchidos. Se o título for muito genérico, ambíguo, ou você não tiver ` +
    `certeza suficiente, retorne encontrado=false. Responda em português do Brasil, exceto o ` +
    `título e o nome do autor, que devem manter a grafia original da obra.`;

  const callGemini = async () => fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema
        }
      })
    }
  );

  let parsed;
  try {
    let geminiResp = await callGemini();

    // O modelo às vezes fica temporariamente sobrecarregado (503/UNAVAILABLE).
    // Tenta mais 2 vezes, com pequena espera, antes de desistir.
    let attempts = 1;
    while (!geminiResp.ok && geminiResp.status === 503 && attempts < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1200 * attempts));
      geminiResp = await callGemini();
      attempts++;
    }

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      const mensagem = geminiResp.status === 503
        ? 'O modelo de IA está sobrecarregado no momento. Tente novamente em alguns segundos.'
        : 'Erro ao consultar a IA: ' + errText.slice(0, 200);
      res.status(502).json({ encontrado: false, mensagem });
      return;
    }

    const geminiData = await geminiResp.json();
    const text = geminiData && geminiData.candidates && geminiData.candidates[0] &&
      geminiData.candidates[0].content && geminiData.candidates[0].content.parts &&
      geminiData.candidates[0].content.parts[0] && geminiData.candidates[0].content.parts[0].text;

    if (!text) {
      res.status(502).json({ encontrado: false, mensagem: 'A IA não retornou uma resposta válida.' });
      return;
    }

    try {
      parsed = JSON.parse(text);
    } catch (e) {
      res.status(502).json({ encontrado: false, mensagem: 'Não foi possível interpretar a resposta da IA.' });
      return;
    }
  } catch (err) {
    res.status(500).json({ encontrado: false, mensagem: 'Erro ao conectar com a IA: ' + err.message });
    return;
  }

  if (!parsed.encontrado) {
    res.status(200).json({
      encontrado: false,
      mensagem: 'Não encontrei esse livro com confiança. Tente incluir o nome do autor e buscar de novo.'
    });
    return;
  }

  // Busca a capa real (e, como reforço, o número de páginas) na Google Books API.
  // Sem chave, o Google aplica um limite de taxa bem mais agressivo (e como funções do Vercel
  // compartilham faixas de IP com outros projetos, esse limite pode já estar estourado por
  // terceiros). Por isso usamos GOOGLE_BOOKS_API_KEY quando disponível — mas seguimos tentando
  // sem chave como último recurso, caso a variável não esteja configurada.
  //
  // Importante: só aceitamos a capa de um resultado se título/autor baterem de forma razoável
  // com o que foi pedido. Preferimos não trazer nenhuma capa a trazer a de um livro errado.
  function normalizar(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tituloBate(consulta, resultado) {
    const q = normalizar(consulta);
    const r = normalizar(resultado);
    if (!q || !r) return false;
    if (r.includes(q) || q.includes(r)) return true;
    const qWords = q.split(' ').filter((w) => w.length > 2);
    if (qWords.length === 0) return false;
    const rWords = new Set(r.split(' '));
    const bateram = qWords.filter((w) => rWords.has(w)).length;
    return bateram / qWords.length >= 0.6;
  }

  function autorBate(consulta, autoresResultado) {
    const q = normalizar(consulta);
    if (!q) return true; // sem autor pra comparar, não bloqueia
    const lista = autoresResultado || [];
    return lista.some((a) => {
      const na = normalizar(a);
      if (!na) return false;
      if (na.includes(q) || q.includes(na)) return true;
      return q.split(' ').some((w) => w.length > 2 && na.includes(w));
    });
  }

  let capaUrl = '';
  let capaErro = '';
  const booksApiKey = process.env.GOOGLE_BOOKS_API_KEY;
  const tituloBusca = parsed.titulo || tituloLimpo;
  const autorBusca = parsed.autor || autorLimpo || '';
  const tentativas = [];
  if (parsed.isbn) tentativas.push(`isbn:${parsed.isbn}`);
  if (autorBusca) tentativas.push(`intitle:${encodeURIComponent(tituloBusca)}+inauthor:${encodeURIComponent(autorBusca)}`);
  tentativas.push(`intitle:${encodeURIComponent(tituloBusca)}`);

  for (const query of tentativas) {
    if (capaUrl) break;
    try {
      const keyParam = booksApiKey ? `&key=${booksApiKey}` : '';
      const booksResp = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=5${keyParam}`);
      if (!booksResp.ok) {
        const t = await booksResp.text();
        capaErro = `Google Books respondeu ${booksResp.status}: ${t.slice(0, 150)}`;
        continue;
      }
      const booksData = await booksResp.json();
      const items = booksData.items || [];
      for (const item of items) {
        const volumeInfo = item && item.volumeInfo;
        if (!volumeInfo) continue;

        const bateTitulo = tituloBate(tituloBusca, volumeInfo.title || '');
        const bateAutor = autorBate(autorBusca, volumeInfo.authors);
        if (!bateTitulo || !bateAutor) continue; // resultado não confiável o suficiente, pula

        if (!parsed.paginas && volumeInfo.pageCount) parsed.paginas = volumeInfo.pageCount;

        const thumb = volumeInfo.imageLinks &&
          (volumeInfo.imageLinks.thumbnail || volumeInfo.imageLinks.smallThumbnail);
        if (thumb) {
          capaUrl = thumb.replace('http://', 'https://');
          break;
        }
      }
      if (!capaUrl && items.length > 0) capaErro = 'Encontrei resultados, mas nenhum com título/autor correspondentes o suficiente.';
    } catch (e) {
      capaErro = 'Falha ao contatar Google Books: ' + e.message;
    }
  }

  res.status(200).json({
    encontrado: true,
    titulo: parsed.titulo || tituloLimpo,
    autor: parsed.autor || autorLimpo || '',
    paginas: parsed.paginas || '',
    genero: parsed.genero || '',
    capaUrl: capaUrl,
    capaDebug: capaUrl ? undefined : capaErro
  });
}
