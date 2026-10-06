# Portal Interno Backend

Backend responsável por fornecer APIs para os projetos internos, centralizando autenticação, regras de negócio, integrações e acesso aos dados necessários para o funcionamento do portal e dos sistemas conectados.

Esta branch representa a evolução da solução em migração de Python para TypeScript, com foco em maior organização, manutenção, tipagem, performance e padronização do código. O objetivo é manter o mesmo funcionamento do backend atual, porém com uma arquitetura mais moderna, escalável e adequada ao ecossistema atual da aplicação.

## Objetivo
- Expor endpoints para consumo por outros projetos e aplicações;
- Centralizar integrações com bancos de dados, autenticação e serviços externos;
- Suportar o portal interno com acesso via Microsoft Entra ID;
- Modernizar a base de código em TypeScript durante a migração do backend.

## Stack principal
- Node.js + TypeScript
- Express
- Prisma
- PostgreSQL
- JWT / autenticação
- Microsoft Entra ID

## Nome sugerido para a branch ou projeto
- portal-interno-backend
- portal-interno-api
- backend-portal-interno

## Autenticação Microsoft (Microsoft Entra ID)

O fluxo Microsoft é executado pelo backend Express com MSAL Node e sessão HTTP. Ele é separado da autenticação JWT e senha já existente: as rotas atuais não foram removidas nem renomeadas. Este repositório contém o backend; não há frontend React nesta pasta. Quando o frontend for integrado, ele deve navegar para o login do backend e usar `credentials: 'include'`, sem inicializar MSAL Browser.

### Requisitos e configuração Entra

- Node.js 20 ou superior e npm 10 ou superior.
- Crie ou escolha um registro de aplicativo no Microsoft Entra ID.
- Em **Authentication**, adicione uma plataforma **Web** com o callback exato `http://localhost:3000/auth/callback`. O callback SPA `http://localhost:5173/auth/callback` não substitui o callback Web do backend confidencial.
- Crie um client secret para uso pelo backend. Guarde o valor fora do código e não o envie em logs, commits ou mensagens.
- Em **API permissions**, adicione as permissões delegadas Microsoft Graph `User.Read`, `GroupMember.Read.All` e `AuditLog.Read.All`. Dependendo das políticas do tenant, `GroupMember.Read.All` e `AuditLog.Read.All` podem exigir consentimento de administrador.

Copie `.env.example` para `.env` somente se ainda não houver um `.env`, e preencha localmente. Esta API já possui variáveis próprias para bancos, JWT e Guacamole; preserve essas configurações locais ao adicionar os campos Microsoft (o `.env.example` documenta o fluxo novo, não substitui os valores existentes):

| Variável | Uso |
| --- | --- |
| `PORT` | Porta HTTP do backend (padrão `3000`) |
| `NODE_ENV` | `development` ou `production` |
| `AZURE_CLIENT_ID` | ID do aplicativo Entra |
| `AZURE_CLIENT_SECRET` | Segredo do aplicativo; nunca versionar |
| `AZURE_TENANT_ID` | ID do tenant Entra |
| `AZURE_REDIRECT_URI` | Callback Web do backend |
| `FRONTEND_URL` | Origem frontend permitida pelo CORS (padrão `http://localhost:5173`) |
| `SESSION_SECRET` | Segredo aleatório com no mínimo 32 caracteres |
| `DEBUG` | Use `true` somente em desenvolvimento para habilitar logs de depuração sem tokens |

O carregamento de ambiente usa `dotenv` com `override: true`. A inicialização falha com a lista de variáveis ausentes (sem imprimir valores) ou se `SESSION_SECRET` tiver menos de 32 caracteres. Em desenvolvimento, `AZURE_REDIRECT_URI` deve corresponder à porta do backend (padrão `http://localhost:3000/auth/callback`); `http://localhost:5173/auth/callback` é a porta SPA/frontend e não funciona como callback do backend. No startup são registrados o client ID, tenant ID, tamanho do client secret e redirect URI; o segredo em si nunca é registrado.

### Instalação e execução

```bash
npm install
npm run dev
```

O backend inicia em `http://localhost:3000`. Inicie o frontend existente em outro terminal. Para o frontend, configure `VITE_API_URL=http://localhost:3000` no ambiente dele, sem sobrescrever configuração local existente. Não há arquivos React neste repositório para editar; a integração de UI futura deve:

1. Navegar para `${VITE_API_URL}/auth/login` ao iniciar o login.
2. Após o retorno para `/dashboard`, carregar `${VITE_API_URL}/auth/me` usando `fetch(..., { credentials: 'include' })`.
3. Em `401` com `{ "needsLogin": true }`, navegar para `/auth/login`; outras respostas não-OK devem ser tratadas como erro explícito.
4. Usar o JSON de `/auth/me` já carregado para exibir o usuário, grupos, IP e origem; não chamar Graph no navegador.
5. Navegar para `${VITE_API_URL}/auth/logout` ao sair. O retorno contém `signedOut=1`; mostrar “Sessão encerrada” e oferecer o botão de login, sem iniciar login automaticamente.

### Rotas Microsoft e validação

| Método e rota | O que faz / como validar |
| --- | --- |
| `GET /health` | Smoke test: deve responder JSON com `status: "ok"`. |
| `GET /auth/login` | Abra no navegador; inicia o redirect para a Microsoft com `prompt=select_account`. |
| `GET /auth/callback` | Callback Web configurado no Entra. É chamado pela Microsoft; código ausente ou estado inválido é rejeitado. |
| `GET /auth/silent` | Com cookie de sessão, tenta renovar/adquirir token sem redirecionar; sem sessão retorna `401 { "needsLogin": true }`. |
| `GET /auth/me` | Com sessão, consulta `/me` e `/memberOf` no Graph e responde `{ user, groups, clientIp, source: "graph" }`; sem sessão retorna `401 { "needsLogin": true }`. |
| `GET /auth/logout` | Destrói a sessão e redireciona para logout Microsoft; o retorno configurado é `FRONTEND_URL/?signedOut=1`. |

Para validar sessão e Graph em funcionamento é necessário completar o login real usando um tenant com callback, segredo e permissões configurados. Não envie tokens à aplicação frontend. O endpoint de foto de perfil está disponível internamente em `getGraphPhoto(accessToken)` e retorna um `Buffer`; não faz parte do JSON de `/auth/me`.

### Fluxo e segurança

O navegador inicia `/auth/login`; o backend salva estado OAuth e redireciona à Microsoft; `/auth/callback` troca o código, salva conta/cache MSAL por sessão e redireciona a `/dashboard`; o navegador envia o cookie de sessão em `/auth/me`; o backend adquire token silenciosamente e consulta Microsoft Graph. Códigos OAuth, tokens, cookies e headers de autorização não devem ser registrados. O log HTTP usa somente `req.path`, sem query string.

O cache MSAL é serializado dentro da sessão de cada usuário e cada chamada usa um cliente MSAL com cache plugin associado àquela sessão, sem cache global compartilhado. IP encaminhado é processado na ordem informada; em produção, configure `trust proxy` somente se a aplicação estiver atrás de proxy confiável, pois cabeçalhos `x-forwarded-for` podem ser falsificados quando expostos diretamente.

O `MemoryStore` padrão do `express-session` serve apenas para desenvolvimento e perde sessões ao reiniciar ou escalar instâncias. Antes de produção, configure um session store persistente, HTTPS, cookies `secure` e proxy confiável conforme a topologia real. As rotas Microsoft restringem CORS a `FRONTEND_URL` com `credentials: true`; as rotas legadas mantêm o comportamento CORS anterior. O cookie usa `HttpOnly`, `SameSite=Lax` e `secure` em produção.

### Verificações locais

```bash
npm test
npm run typecheck
npm audit
```

Testes unitários não precisam de login, tokens reais nem chamadas externas. O build/teste local não comprova o login real: ele depende do cadastro e consentimento corretos no tenant Entra.

- Atualização - parametro de desenvolvimento ativos para adicionar novas funções e novas rotas para aplicações

- Endpoints para rotas publicas e privadas validadas e para uso
> Sugestão principal: portal-interno-backend
