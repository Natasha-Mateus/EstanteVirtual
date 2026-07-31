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

  // Busca a capa real (e, como reforço, o número de páginas) na Google Books API — pública, sem chave.
  let capaUrl = '';
  try {
    const query = parsed.isbn
      ? `isbn:${parsed.isbn}`
      : `intitle:${encodeURIComponent(parsed.titulo || tituloLimpo)}+inauthor:${encodeURIComponent(parsed.autor || autorLimpo || '')}`;
    const booksResp = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`);
    if (booksResp.ok) {
      const booksData = await booksResp.json();
      const item = booksData.items && booksData.items[0];
      const volumeInfo = item && item.volumeInfo;
      const thumb = volumeInfo && volumeInfo.imageLinks &&
        (volumeInfo.imageLinks.thumbnail || volumeInfo.imageLinks.smallThumbnail);
      if (thumb) capaUrl = thumb.replace('http://', 'https://');
      if (!parsed.paginas && volumeInfo && volumeInfo.pageCount) parsed.paginas = volumeInfo.pageCount;
    }
  } catch (e) {
    // Capa é opcional — se a Google Books falhar, seguimos sem ela.
  }

  res.status(200).json({
    encontrado: true,
    titulo: parsed.titulo || tituloLimpo,
    autor: parsed.autor || autorLimpo || '',
    paginas: parsed.paginas || '',
    genero: parsed.genero || '',
    capaUrl: capaUrl
  });
}
