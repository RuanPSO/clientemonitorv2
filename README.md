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

Copie `.env.example` para `.env` somente se ainda não houver um `.env`, e preencha localmente. Preserve as configurações locais existentes ao adicionar variáveis novas.

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
| `GUACAMOLE_BASE_URL` | URL base do Portal RDP (padrão `http://10.86.26.18:8410/`) |
| `GUACAMOLE_TIMEOUT_MS` | Timeout em milissegundos da verificação remota (padrão `10000`) |

O carregamento de ambiente usa `dotenv` com `override: true`. A inicialização falha com a lista de variáveis ausentes (sem imprimir valores) ou se `SESSION_SECRET` tiver menos de 32 caracteres. Em produção, `FRONTEND_URL` deve ser definido explicitamente; em desenvolvimento, o padrão permitido é `http://localhost:5173`. Em desenvolvimento, `AZURE_REDIRECT_URI` deve corresponder à porta do backend (padrão `http://localhost:3000/auth/callback`); `http://localhost:5173/auth/callback` é a porta SPA/frontend e não funciona como callback do backend. No startup são registrados o client ID, tenant ID, tamanho do client secret e redirect URI; o segredo em si nunca é registrado.

## Convites de acesso por e-mail

O fluxo de cadastro cria a conta como inativa, mantém o token de uso único válido por 24 horas e envia o convite pelo SMTP. O transporte é inicializado uma vez no startup e reutilizado; o startup valida a configuração, mas não abre conexão SMTP. Configure estas variáveis somente no ambiente do backend, sem substituir outras entradas existentes no `.env`:

```dotenv
EMAIL_SMTP_HOST=
EMAIL_SMTP_PORT=
EMAIL_SMTP_USER=
EMAIL_SMTP_PASSWORD=
EMAIL_USE_TLS=true
EMAIL_USE_SSL=false
CLIENTMONITOR_URL=http://ENDERECO_INTERNO_CLIENTMONITOR
```

O remetente é sempre `EMAIL_SMTP_USER`. `EMAIL_USE_SSL=true` habilita TLS implícito e tem prioridade se ambas as opções estiverem ativadas; `EMAIL_USE_TLS=true` com SSL desativado exige STARTTLS. Quando ambas são falsas, TLS é desativado. `CLIENTMONITOR_URL` deve ser a URL real do ClientMonitor acessível pelo destinatário; não use o endereço do painel administrativo. O endereço precisa ser definido pelo ambiente de implantação.
Se `CLIENTMONITOR_URL` estiver ausente ou inválida, o cadastro e o reenvio respondem HTTP 503 antes de criar ou atualizar o token.

### Enviar e-mail sem autenticação

`POST /send-email` é uma rota pública para envio de e-mail em texto simples. Não requer token, cookie, sessão ou cabeçalho de autenticação. Use a URL completa `http://localhost:3000/send-email` (ou substitua host e porta conforme o ambiente), com `Content-Type: application/json` e **Body → raw → JSON**:

```json
{
  "to": "ruan.oliveira@spsgroup.com.br",
  "subject": "teste e-mail",
  "text": "Conteúdo em texto simples"
}
```

Os três campos são obrigatórios; `to` deve conter um endereço de e-mail válido e campos adicionais são rejeitados. Em sucesso, responde HTTP 200:

```json
{
  "success": true,
  "messageId": "<id>",
  "accepted": ["ruan.oliveira@spsgroup.com.br"],
  "rejected": []
}
```

Erros de validação ou JSON malformado retornam HTTP 400; falhas SMTP retornam HTTP 500 sem expor dados sensíveis.

### Cadastro e reenvio públicos de convites

As rotas abaixo não exigem token, cookie, sessão ou cabeçalho de autenticação. O cadastro cria uma conta inativa e envia o convite para o endereço informado. O reenvio é acionado pelo ID do cliente e emite um novo token, invalidando o anterior. Como são rotas públicas que enviam e-mails e podem criar contas, exponha-as somente se isso for intencional no ambiente.

### Criar e enviar um convite

```http
POST /clientes/cadastrar
Content-Type: application/json
```

```json
{
  "nome": "João da Silva",
  "cargo": "Operações",
  "email": "joao.silva@empresa.com.br",
  "id_grupo": "10084"
}
```

No body, `id_grupo` deve conter o identificador do grupo retornado pelo Zabbix (`groupid`), correspondente à coluna `grupos_hosts.groupid_zabbix` — não ao ID interno `grupos_hosts.id`. Durante o cadastro, a API procura o grupo por `groupid_zabbix` e grava em `usuarios.id_grupo` o ID interno (`grupos_hosts.id`) da linha encontrada. O identificador pode ser enviado como string para preservar todos os dígitos de IDs grandes.

Em caso de sucesso, responde HTTP 201 com os dados públicos do usuário (`ativo: false`), destinatário e validade do token, sem expor o token. A resposta mostra `usuario.id_grupo` como o ID interno gravado e `usuario.groupid_zabbix` como o identificador do Zabbix recebido. O token só pode ser incluído para testes quando `NODE_ENV=test` e `EMAIL_INCLUDE_ACTIVATION_TOKEN_IN_RESPONSE=true`. Se o SMTP falhar depois da criação, responde HTTP 502 com `cadastro_criado: true` e `email_enviado: false`; o usuário permanece inativo e o token atual continua válido.

Resposta de sucesso:

```json
{
  "sucesso": true,
  "mensagem": "Cadastro criado e convite enviado com sucesso.",
  "usuario": {
    "id": 123,
    "nome": "João da Silva",
    "email": "joao.silva@empresa.com.br",
    "id_grupo": 2,
    "groupid_zabbix": "10084",
    "ativo": false
  },
  "email": {
    "enviado": true,
    "destinatario": "joao.silva@empresa.com.br"
  },
  "token_expira": "2026-11-04T15:00:00.000Z"
}
```

Falha de envio após a criação (HTTP 502):

```json
{
  "sucesso": false,
  "cadastro_criado": true,
  "email_enviado": false,
  "mensagem": "O cadastro foi criado, mas não foi possível enviar o convite. Tente novamente."
}
```

### Reenviar convite e testar SMTP

- `POST /clientes/:id/reenviar-convite` emite um novo token de uso único, invalida o anterior, renova a validade para 24 horas e tenta enviar o e-mail. Contas já ativadas não podem receber convite.
- `POST /email/testar` usa `transporter.verify()` para testar a conexão e não envia mensagem.
- `POST /email/testar-envio` envia uma mensagem de teste com destinatário, assunto e corpo definidos na requisição.

Estas rotas pertencem à API iniciada com `npm start` (arquivo `index.ts`) e não usam o prefixo `/api`. `npm run start:guacamole` inicia um serviço separado, que não registra as rotas administrativas de e-mail.

Exemplos de chamadas administrativas:

```http
POST /clientes/123/reenviar-convite

POST /email/testar
Cookie: clientemonitor.sid=...
```

O reenvio responde HTTP 200 com `sucesso: true`, dados públicos do usuário, destinatário e a nova expiração; não retorna o token. Se o SMTP falhar, responde HTTP 502 e mantém a conta inativa.

### Ativar a conta pelo convite

A ativação também é pública e não exige token de autenticação, cookie ou sessão. O token de ativação é enviado no link do convite e vale por 24 horas. O link usa `GET /ativar?token=...` para validar o convite; depois, envie a senha escolhida com `POST /ativar`:

```http
POST /ativar
Content-Type: application/json
```

```json
{
  "token": "TOKEN_RECEBIDO_NO_LINK_DO_CONVITE",
  "senha": "SenhaForte!123",
  "confirmarSenha": "SenhaForte!123"
}
```

`confirmarSenha` pode ser omitido na chamada à API; se enviado, precisa corresponder a `senha`. A senha deve ter no mínimo 8 caracteres e incluir letra maiúscula, minúscula, número e caractere especial. Em caso de sucesso, responde HTTP 200:

```json
{
  "message": "Conta ativada com sucesso"
}
```

Token inválido retorna HTTP 404, expirado retorna HTTP 410, e token já utilizado ou conta já ativada retorna HTTP 409. Não compartilhe o token: após a ativação ele é invalidado.

#### Enviar e-mail de teste pelo Postman (somente desenvolvimento)

`POST /email/testar-envio` só fica disponível quando o backend está em execução com `NODE_ENV=development`. Em qualquer outro ambiente, inclusive produção, responde HTTP 403 sem tentar enviar. Em desenvolvimento, a rota não exige login, sessão Microsoft Entra, cookie `clientemonitor.sid`, JWT ou cabeçalho `Authorization`.

No Postman, crie uma requisição **POST** para `{{baseUrl}}/email/testar-envio`, onde `baseUrl` é a URL do backend (por exemplo, `http://localhost:3000`). Não configure cabeçalhos ou cookies de autenticação.

Em **Headers**, defina `Content-Type: application/json`. Em **Body**, escolha **raw** e **JSON** e envie:

```json
{
  "destinatario": "seu.email@empresa.com.br",
  "assunto": "Teste de envio SMTP",
  "corpo": "Este é um e-mail de teste enviado pelo Postman.\nSe você recebeu esta mensagem, o envio SMTP está funcionando."
}
```

O corpo é enviado como texto simples e HTML escapado. Destinatário e assunto são validados; o corpo aceita até 10.000 caracteres. Campos adicionais, incluindo credenciais SMTP, são rejeitados. Em caso de envio confirmado pelo servidor SMTP, a API responde HTTP 200:

```json
{
  "sucesso": true,
  "mensagem": "E-mail de teste enviado com sucesso.",
  "email": {
    "enviado": true,
    "destinatario": "seu.email@empresa.com.br"
  }
}
```

Se o SMTP rejeitar ou não conseguir enviar a mensagem, a API responde HTTP 502 com `sucesso: false` e `email.enviado: false`. Erros de validação retornam HTTP 400. A resposta de sucesso confirma que o servidor SMTP aceitou a mensagem para envio, não garante a entrega na caixa de entrada; confira spam/quarentena e logs do provedor se a mensagem não chegar.

Após configurar corretamente a conexão SMTP, a rota de teste responde HTTP 200:

```json
{
  "sucesso": true,
  "mensagem": "Conexão SMTP estabelecida com sucesso."
}
```

`POST /email/testar` continua protegido por autenticação e autorização. Cadastro e reenvio de convites são públicos. Não envie senha SMTP ou token de ativação na requisição de teste. Erros SMTP são registrados somente por categoria técnica, sem credenciais, endereço do destinatário ou token.

Para verificar se o cadastro foi persistido e segue inativo, consulte o banco de clientes:

```sql
SELECT id, nome, email, ativo, token_expira
FROM usuarios
WHERE email = 'joao.silva@empresa.com.br';
```

Uma resposta 502 significa que o cadastro existe, mas o envio falhou. Confira host, porta, autenticação e política TLS no ambiente do backend; valide a conexão com `POST /email/testar` e, depois de corrigir SMTP, use o endpoint de reenvio. A conta só fica ativa depois de definir a senha com um token válido.

### Verificar conectividade do Portal RDP

`GET /api/conectado` consulta diretamente a URL configurada em `GUACAMOLE_BASE_URL` (padrão `http://10.86.26.18:8410/`) com `GET`, sem autenticação. Responde `{"status":"conectado"}` quando o Portal RDP retorna HTTP 200 com conteúdo HTML. Não inicia uma sessão RDP. Redirecionamentos não são seguidos.

```bash
curl http://localhost:3000/api/conectado
```

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

Login/callback/logout/`/auth/me`, health check e documentação são compartilhados. O gateway Guacamole Lite é um processo independente na porta 8190; suas rotas exigem um bearer token estático próprio, sem depender da sessão web desta API.

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

A página e a especificação são públicas. As rotas administrativas e de depuração da API principal ficam fora do catálogo. As rotas REST legadas de Guacamole foram removidas; o gateway independente exige seu bearer estático e está documentado acima.

Os arquivos da interface ficam em `public/docs/`, sem biblioteca adicional ou servidor separado. A instalação do gateway Guacamole Lite adiciona `guacamole-lite` e `multer` ao lockfile sem alterar Prisma, migrations, adapters ou as demais rotas de negócio.

- Atualização - parametro de desenvolvimento ativos para adicionar novas funções e novas rotas para aplicações

- Endpoints para rotas publicas e privadas validadas e para uso

### Gateway RDP com Guacamole Lite

O gateway remoto é iniciado separadamente por `npm run start:guacamole` e usa `GUAC_PORT` (8190 por padrão). Ele emite tokens compatíveis com `guacamole-lite` em `POST /api/guacamole/token`, conecta diretamente ao `guacd` (`GUACD_HOST:GUACD_PORT`) e não chama a API REST do Apache Guacamole nem cria usuários por e-mail.

O endpoint recebe somente `{ username, password, port }`; o backend fixa o destino e o domínio RDP em `ts.datacore.com.br`. Configure `API_BEARER_TOKEN` com pelo menos 32 bytes aleatórios e `GUAC_KEY` com exatamente 32 bytes UTF-8. Não coloque esses segredos no controle de versão. Em produção, configure `GUAC_WS_PUBLIC_URL` como `wss://...`, `CORS_ORIGINS` para as origens exatas autorizadas e exponha o serviço somente por HTTPS/WSS. Um bearer estático incluído em código JavaScript público pode ser extraído; use essa chamada somente através de um backend intermediário confiável ou proteja a borda do gateway.

As rotas autenticadas são `POST /api/guacamole/token`, `POST /api/files/upload` (multipart, campo `file`), `GET /api/files` e `GET /api/files/download/:filename`. O token de conexão é de uso único e expira em 60 segundos. O diretório padrão de transferência é `/var/lib/guacamole/drives`; quando `guacd` estiver em outro container/host, compartilhe esse diretório por volume com o `guacd`. Para ambiente local, use `GUAC_DRIVE_PATH` apontando para um diretório gravável.

O WebSocket compartilha a porta Express 8190. O gateway valida token e origem antes de aceitar o upgrade e registra eventos de sessão sem gravar senha ou token nos logs. Consulte [GUACAMOLE_FLUXO.md](./GUACAMOLE_FLUXO.md) para o contrato e o fluxo completo.
> Sugestão principal: portal-interno-backend
