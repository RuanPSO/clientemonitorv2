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
| `SESSION_COOKIE_SAME_SITE` | `lax` por padrão; use `none` em produção somente para frontend/backend realmente cross-site (exige HTTPS) |
| `SESSION_COOKIE_DOMAIN` | Opcional; deixe vazio para um cookie host-only, ou defina o domínio compartilhado entre subdomínios |
| `DEBUG` | Use `true` somente em desenvolvimento para habilitar logs de depuração sem tokens |

O carregamento de ambiente usa `dotenv` com `override: true`. A inicialização falha com a lista de variáveis ausentes (sem imprimir valores) ou se `SESSION_SECRET` tiver menos de 32 caracteres. Em produção, `FRONTEND_URL` deve ser definido explicitamente; em desenvolvimento, o padrão permitido é `http://localhost:5173`. Em desenvolvimento, `AZURE_REDIRECT_URI` deve corresponder à porta do backend (padrão `http://localhost:3000/auth/callback`); `http://localhost:5173/auth/callback` é a porta SPA/frontend e não funciona como callback do backend. No startup são registrados o client ID, tenant ID, tamanho do client secret e redirect URI; o segredo em si nunca é registrado.

### Instalação e execução

```bash
npm install
npm run dev
```

O backend escuta em IPv4 e IPv6 e pode ser acessado por `http://localhost:3000` ou `http://127.0.0.1:3000`. Se um processo antigo estiver usando a porta, encerre apenas a instância antiga do ClientMonitor antes de iniciar outra. Inicie o frontend existente em outro terminal. Para o frontend, configure `VITE_API_URL=http://localhost:3000` no ambiente dele, sem sobrescrever configuração local existente. Não há arquivos React neste repositório para editar; a integração de UI futura deve:

1. Navegar para `${VITE_API_URL}/auth/login` ao iniciar o login.
2. O callback consulta `companyName` no Microsoft Graph e sempre redireciona para `/dashboard` sob `FRONTEND_URL`. O frontend consulta `/auth/me` para renderizar a experiência indicada pelo backend.
3. Carregar `${VITE_API_URL}/auth/me` usando `fetch(..., { credentials: 'include' })` e confirmar a experiência recebida antes de montar uma página.
4. Em `401` com `{ "needsLogin": true }`, navegar para `/auth/login`; outras respostas não-OK devem ser tratadas como erro explícito.
5. Usar o JSON de `/auth/me` já carregado para exibir o usuário, grupos, IP, origem e `experience`; não chamar Graph no navegador.
6. Navegar para `${VITE_API_URL}/auth/logout` ao sair. O retorno contém `signedOut=1`; mostrar “Sessão encerrada” e oferecer o botão de login, sem iniciar login automaticamente.

### Rotas Microsoft e validação

| Método e rota | O que faz / como validar |
| --- | --- |
| `GET /health` | Smoke test: deve responder JSON com `status: "ok"`. |
| `GET /auth/login` | Abra no navegador; inicia o redirect para a Microsoft com `prompt=select_account`. |
| `GET /auth/callback` | Callback Web configurado no Entra. Valida code/state, consulta `companyName` via Graph e sempre redireciona a `/dashboard`; falha de token/Graph responde `502` sem autenticar a sessão. |
| `GET /auth/silent` | Com cookie de sessão, tenta renovar/adquirir token sem redirecionar; sem sessão retorna `401 { "needsLogin": true }`. |
| `GET /auth/me` | Com sessão, consulta `/me` e `/memberOf` no Graph e responde `{ user, groups, clientIp, source: "graph", experience }`; `experience` vem da sessão e, se ausente, é `secondary`. Sem sessão retorna `401 { "needsLogin": true }`. |
| `GET /auth/logout` | Destrói a sessão e redireciona para logout Microsoft; o retorno configurado é `FRONTEND_URL/?signedOut=1`. |

Para validar sessão e Graph em funcionamento é necessário completar o login real usando um tenant com callback, segredo e permissões configurados. Não envie tokens à aplicação frontend. O endpoint de foto de perfil está disponível internamente em `getGraphPhoto(accessToken)` e retorna um `Buffer`; não faz parte do JSON de `/auth/me`.

### Experiência normal e secundária

A allow-list é carregada uma vez no startup a partir de `config/authorized-companies.json`, separada de `config/access-rules.json`. O arquivo é obrigatório e inválido/ausente impede a inicialização. Exemplo:

```json
{
  "companies": [
    { "companyname": "datacore" }
  ]
}
```

A comparação é exata após `trim().toLowerCase()`. Match resulta em `experience: "normal"`; empresa diferente, vazia, nula ou ausente resulta em `"secondary"`. O backend salva a empresa normalizada e a experiência na sessão. Alterar a allow-list requer reiniciar/reimplantar cada instância.

As rotas de dados de hosts, grupos, incidentes, relatórios, SLA e serviços verificam a experiência normal quando a requisição tem sessão Entra. Para manter compatibilidade, uma chamada autenticada apenas por JWT legado continua funcionando sem a verificação de experiência; isso é um bypass pendente que deve ser resolvido antes de considerar toda a API protegida por página. A rota `GET /host/by-name/:hostname/relatorio` exige diretamente sessão Entra normal. Ainda não existem endpoints de dados específicos da experiência secundária neste backend.

Login/callback/logout/`/auth/me`, health check e documentação são compartilhados. As rotas de Guacamole permanecem fora da política de experiência e algumas continuam sem autenticação; não devem ser consideradas protegidas pela separação de páginas. A autenticação JWT/senha não foi alterada nesta etapa.

### Diagnóstico de mapeamento empresa-Zabbix

Com o backend reiniciado, abra `http://localhost:3000/admin/company-zabbix-test`. A página consulta `/auth/me` na mesma origem e usa o cookie de sessão Microsoft existente; sem sessão, mostra o link para `/auth/login`. O perfil apresentado vem da resposta de `/auth/me`, e o resultado real do diagnóstico é calculado no backend com o `companyName` guardado na sessão. A configuração fica em `config/company-zabbix-mapping.json`; empresas preenchidas sem mapeamento, incluindo `Cloud Core`, usam `all_groups` e retornam todos os `availableGroups`. Empresa vazia ou nula usa `no_group` e retorna uma lista vazia.

O campo de simulação é enviado separadamente e só calcula um resultado diagnóstico. A rota protegida `POST /admin/company-zabbix-test/result` continua usando a identidade da sessão para o resultado real, não concede permissões nem consulta hosts. Os grupos `SPS_BOLIVIA` e `SPS_INNO` estão disponíveis para configurações futuras.

### Fluxo e segurança

O navegador inicia `/auth/login`; o backend salva estado OAuth e redireciona à Microsoft; `/auth/callback` troca o código, consulta `companyName` no Graph, salva conta/cache MSAL, empresa normalizada e decisão por sessão e sempre redireciona para `/dashboard`; o navegador envia o cookie de sessão em `/auth/me`; o backend consulta perfil e grupos, e o frontend renderiza a experiência informada. A auditoria da classificação registra somente experiência, motivo categorizado, tenant e horário. Códigos OAuth, tokens, cookies, headers de autorização e payloads completos do Graph não devem ser registrados. O log HTTP usa somente `req.path`, sem query string.

O cache MSAL é serializado dentro da sessão de cada usuário e cada chamada usa um cliente MSAL com cache plugin associado àquela sessão, sem cache global compartilhado. IP encaminhado é processado na ordem informada; em produção, configure `trust proxy` somente se a aplicação estiver atrás de proxy confiável, pois cabeçalhos `x-forwarded-for` podem ser falsificados quando expostos diretamente.

O `MemoryStore` padrão do `express-session` serve apenas para desenvolvimento e perde sessões ao reiniciar ou escalar instâncias. Antes de produção, configure um session store persistente, HTTPS, cookies `secure` e proxy confiável conforme a topologia real. Todas as rotas aplicam CORS antes dos endpoints, permitindo somente a origem exata de `FRONTEND_URL`, com credenciais, métodos `GET`, `HEAD` e `POST` e headers `Authorization` e `Content-Type`. O cookie é `HttpOnly`, `SameSite=Lax` por padrão, `Secure` em produção e host-only por padrão (sem `Domain`). `localhost:5173` e `localhost:3000` são same-site apesar das portas diferentes; se o frontend e backend de produção forem realmente cross-site, configure `SESSION_COOKIE_SAME_SITE=none` e use HTTPS. Configure `SESSION_COOKIE_DOMAIN` apenas se precisar compartilhar o cookie entre subdomínios do mesmo domínio.

### Verificações locais

```bash
npm test
npm run typecheck
npm audit
```

Testes unitários não precisam de login, tokens reais nem chamadas externas. O build/teste local não comprova o login real: ele depende do cadastro e consentimento corretos no tenant Entra.

### Documentação da API

Com o backend em execução, acesse `/docs` na mesma origem da API. A página é servida pelo Express e carrega a especificação OpenAPI 3.0.3 em `/docs/openapi.json`. O catálogo tipado fica em `routes/docs.openapi.ts`; a versão vem de `package.json`, a base é a origem que serve a página e o ambiente vem de `NODE_ENV`. Atualize o catálogo somente após confirmar o router, o middleware de autenticação e os parâmetros/corpos no código. As respostas sem schema declarado são indicadas como não especificadas, em vez de inventar contratos.

A página e a especificação são públicas, assim como a rota raiz existente. Isso não remove nem substitui a autenticação das operações protegidas: rotas JWT continuam exigindo um header `Authorization` com esquema Bearer e o perfil Microsoft exige o cookie de sessão existente. `POST /auth/token`, `POST /admin/cache/clear`, `GET /guacamole/debug/:connectionId`, `POST /guacamole/fix-domain/:connectionId` e `POST /guacamole/fix-target/:connectionId` foram intencionalmente omitidas do catálogo por emitirem tokens sem credenciais, serem administrativas ou exporem/alterarem configuração. As rotas Guacamole documentadas não aplicam middleware de autenticação no código atual.

Os arquivos da interface ficam em `public/docs/`, sem biblioteca adicional ou servidor separado. Não foi necessário alterar Prisma, migrations, adapters, rotas de negócio ou o lockfile.

- Atualização - parametro de desenvolvimento ativos para adicionar novas funções e novas rotas para aplicações

- Endpoints para rotas publicas e privadas validadas e para uso
> Sugestão principal: portal-interno-backend
