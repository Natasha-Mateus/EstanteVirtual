# Gestão Financeira

App pessoal de gestão financeira para o casal, com 5 módulos: Dashboard, Contas Fixas, Mercado, Cartão de Crédito, Renda e Reservas.

## Configuração necessária antes de usar

### 1. Regras do Firestore
No Firebase Console → Firestore Database → Regras, cole o conteúdo do arquivo `firestore.rules` deste projeto e publique. Isso garante que só quem estiver logado acessa os dados.

### 2. Criar os usuários (você e seu esposo)
No Firebase Console → Authentication → Users → "Add user", crie um e-mail/senha para cada um de vocês. Não existe cadastro público no app — só quem for criado manualmente ali consegue entrar.

### 3. Ativar o GitHub Pages
No repositório do GitHub → Settings → Pages → Source: selecione a branch `main` e a pasta `/ (root)`. Depois de salvar, o GitHub gera uma URL tipo:
`https://seu-usuario.github.io/gestao-financeira/`

Essa é a URL que vocês vão acessar direto do celular ou computador, sem precisar abrir arquivo local.

## Estrutura do projeto
```
index.html
css/styles.css
js/app.js              -> autenticação e navegação entre módulos
js/firebase-config.js  -> credenciais do Firebase
js/helpers.js          -> funções utilitárias (formatação de moeda, datas)
js/modules/
  dashboard.js
  contasFixas.js
  mercado.js
  cartao.js
  renda.js
firestore.rules
```

## Próximos passos sugeridos
- Filtro de data/mês nos submódulos de Mercado (ainda não implementado, ficou pendente de decisão)
- Autocomplete de itens já cadastrados na tela de Mercado
- Comparação de preço entre mercados/marcas
