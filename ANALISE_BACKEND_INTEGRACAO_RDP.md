# Análise técnica do backend RDP — contrato de integração para o frontend

## Escopo e método

Esta análise considera implementações TypeScript/JavaScript do repositório, configurações versionadas e o arquivo `.env.example`. Não usa a documentação ou arquivos de frontend como prova de implementação. O arquivo `.env` local não foi consultado e nenhum valor secreto é reproduzido.

As classificações usadas abaixo são:

- **CONFIRMADO NO CÓDIGO** — comportamento diretamente implementado.
- **CONFIRMADO EM CONFIGURAÇÃO** — valor, dependência ou opção declarada no código/configuração versionada.
- **HIPÓTESE A VALIDAR** — explicação possível que depende de ambiente ou código não disponível.
- **NÃO ENCONTRADO** — busca na implementação deste repositório sem resultado.
- **DEPENDÊNCIA EXTERNA** — comportamento de outro serviço que não pode ser verificado aqui.

## 1. Resumo executivo

1. **CONFIRMADO NO CÓDIGO:** A API principal é Express, inicia por `index.ts` na porta `PORT` (padrão `3000`) e registra rotas sem prefixo global `/api`. A exceção relevante é `/api/conectado`, cujo caminho já contém `/api`.
2. **CONFIRMADO NO CÓDIGO:** `GET /host/:hostid/com-ip` existe na API principal. A porta retornada em `porta_customizada` é calculada a partir do IP da interface principal do host; não é lida do campo de porta da interface.
3. **NÃO ENCONTRADO:** `POST /guacamole/connect-full` não existe na API principal nem no gateway local examinado. `POST /api/token` também não foi encontrado.
4. **CONFIRMADO NO CÓDIGO:** Há um segundo processo, `server.js`, que oferece `POST /api/guacamole/token`, valida usuário, senha e porta e retorna um token criptografado e `websocketUrl`. O destino RDP é fixo em `ts.datacore.com.br`; o cliente não seleciona um hostname.
5. **CONFIRMADO NO CÓDIGO:** O gateway abre WebSocket usando `guacamole-lite` conectado ao `guacd`; aceita a porta informada no pedido de token. A porta não é validada contra uma lista permitida.
6. **CONFIRMADO NO CÓDIGO:** `/api/conectado` somente consulta a disponibilidade de um portal HTTP configurado. Não emite token nem inicia uma sessão RDP.
7. **NÃO ENCONTRADO:** `/api/auth/photo` não está implementada. Existe um helper para consultar foto no Microsoft Graph, mas não há rota que o exponha.
8. **Lacuna de segurança de integração:** O gateway exige um segredo estático (`API_BEARER_TOKEN`). O backend principal não atua como proxy para esse endpoint. O segredo não deve ser enviado ao navegador; é necessária uma integração servidor-a-servidor ou outro mecanismo autenticado antes de conectar o frontend diretamente ao gateway.

## 2. Arquitetura identificada

### Estrutura relevante

**CONFIRMADO NO CÓDIGO:** O repositório contém a API principal e um serviço de gateway separados:

| Caminho | Função observada |
|---|---|
| [`index.ts`](./index.ts) | Inicialização da API principal, middlewares, registro de rotas e listener HTTP. |
| [`server.js`](./server.js) | Processo independente de API de token, WebSocket e integração com `guacamole-lite`. |
| [`routes/`](./routes) | Rotas Express da API principal. |
| [`middlewares/`](./middlewares) | Autenticação, sessão e controle de experiência. |
| [`services/`](./services) e [`repositories/`](./repositories) | Lógica de aplicação e acesso aos dados/Zabbix. |
| [`config/`](./config) | Configuração de sessão, CORS, ambiente, Microsoft Entra ID e permissões. |
| [`lib/`](./lib) e [`prisma/`](./prisma) | Clientes de banco e schema Prisma. |
| [`public/`](./public) | Recursos estáticos de administração/documentação; não é uma aplicação React do frontend RDP. |
| [`tests/`](./tests) | Testes do projeto. |

O repositório não contém uma pasta de frontend React/Vite identificada nem configuração versionada de proxy reverso.

### Inicialização e versões

- **CONFIRMADO NO CÓDIGO:** `npm start` executa `node --import tsx index.ts`; `npm run dev` executa `tsx watch index.ts`; `index.ts` cria o Express principal e chama `app.listen(PORT)`. Evidência: [`package.json`](./package.json) e [`index.ts`](./index.ts#L11-L18), [`index.ts`](./index.ts#L134-L155).
- **CONFIRMADO NO CÓDIGO:** O gateway é iniciado separadamente com `npm run start:guacamole` (`node server.js`). A API principal não importa nem inicia `server.js`. Evidência: [`package.json`](./package.json) e [`server.js`](./server.js#L1-L12), [`server.js`](./server.js#L376-L390).
- **CONFIRMADO EM CONFIGURAÇÃO:** O manifesto declara Express `^5.2.1`, `guacamole-lite` `^1.2.0`, `express-session` `^1.19.0`, `cors` `^2.8.6` e TypeScript `^7.0.2`. O projeto não declara uma versão mínima/máxima de Node no `package.json`.
- **CONFIRMADO NO CÓDIGO:** `PORT` define a porta da API principal, com fallback `3000`; `GUAC_PORT` define a porta do gateway, com fallback `8190`. O gateway escuta em `0.0.0.0`; o listener principal não especifica host. Evidência: [`index.ts`](./index.ts#L134-L155), [`server.js`](./server.js#L20-L28), [`server.js`](./server.js#L376-L390).
- **CONFIRMADO EM CONFIGURAÇÃO:** `.env.example` documenta `FRONTEND_URL`, configurações Entra ID e sessão, e variáveis `GUAC_PORT`, `GUACD_HOST`, `GUACD_PORT`, `GUAC_WS_PUBLIC_URL`, `API_BEARER_TOKEN`, `GUAC_KEY`, `GUAC_DRIVE_PATH`, `GUAC_MAX_UPLOAD_BYTES`, `CORS_ORIGINS`, `GUACAMOLE_BASE_URL` e `GUACAMOLE_TIMEOUT_MS`. Apenas os nomes e finalidades são relevantes; valores secretos não são incluídos. Evidência: [`.env.example`](./.env.example).

### Registro de rotas Express

**CONFIRMADO NO CÓDIGO:** `index.ts` registra os routers diretamente, sem `app.use('/api', ...)` global. `server.js` cria outro Express e registra `/api` apenas como prefixo de middleware de autenticação, seguido por rotas próprias do gateway. Evidência: [`index.ts`](./index.ts#L80-L90), [`server.js`](./server.js#L110-L147).

| Processo / arquivo | Caminhos implementados (métodos conforme código) |
|---|---|
| API principal — `routes/auth.routes.ts` | `POST /auth/token`, `POST /login`, `GET /me`, `POST /users`, `GET /ativar`, `POST /ativar`. |
| API principal — `routes/entra-auth.routes.ts`, montado em `/auth` | `GET /auth/login`, `/auth/callback`, `/auth/silent`, `/auth/me`, `/auth/logout`. |
| API principal — `routes/host.routes.ts` | `GET /host/:hostid/details`, `/basico`, `/services`, `/problemas`, `/host/by-name/:hostname/relatorio`, `/hosts/com-ip`, `/hosts/com-ip-e-so`, `/hosts/status-ping-uptime`, `/host/:hostid/com-ip`, `/active-services`, `/relatorio-periodo`, `/serie`, `/metrics`. |
| API principal — `routes/grupo.routes.ts` | `GET /grupos`, `/grupo/:chave`, `/grupo/:chave/hosts-full`, `/grupos/com-hosts`. |
| API principal — demais routers | `routes/relatorio.routes.ts`: `GET` e `POST /host/:hostid/relatorio`, `GET /relatorio/disponibilidade`; `routes/sla.routes.ts`: `GET /host/:hostid/sla`; `routes/services.routes.ts`: `GET /host/:hostid/services/history` e `/timeline`; `routes/incidentes.routes.ts`: quatro rotas `/incidentes/*`. |
| API principal — suporte | `GET /`, `/health`, `/docs`, `/docs/openapi.json`, recursos estáticos `/docs/*`; `/admin/*` inclui recursos de teste e, fora de produção, `POST /admin/cache/clear`; `/api/conectado`. |
| Gateway separado — `server.js` | `GET /health`; `POST /api/guacamole/token`; `POST /api/files/upload`; `GET /api/files`; `GET /api/files/download/:filename`; WebSocket no caminho definido por `GUAC_WS_PUBLIC_URL` (padrão `/`). |

Referências: [`index.ts`](./index.ts#L71-L110), [`routes/host.routes.ts`](./routes/host.routes.ts#L30-L281), [`routes/auth.routes.ts`](./routes/auth.routes.ts#L26-L220), [`routes/entra-auth.routes.ts`](./routes/entra-auth.routes.ts#L58-L237), [`server.js`](./server.js#L143-L281).

### Middlewares, CORS e proxy

- **CONFIRMADO NO CÓDIGO:** A API principal instala `helmet`, CORS, JSON, Morgan e `express-session`. O CORS da API permite a origem `FRONTEND_URL` (padrão `http://localhost:5173`), credenciais, métodos `GET`, `HEAD`, `POST` e headers `Authorization`/`Content-Type`. Evidência: [`index.ts`](./index.ts#L54-L66), [`config/cors.ts`](./config/cors.ts).
- **CONFIRMADO NO CÓDIGO:** O gateway tem configuração CORS própria, restringe origins a `CORS_ORIGINS` ou `FRONTEND_URL` e valida também a origem no upgrade WebSocket quando o header `Origin` está presente. Evidência: [`server.js`](./server.js#L41-L51), [`server.js`](./server.js#L119-L129), [`server.js`](./server.js#L303-L317).
- **NÃO ENCONTRADO:** Não foi encontrada configuração versionada de Nginx, Apache, Caddy, Traefik, Docker/Compose ou outro proxy reverso. Portanto, encaminhamento de `/api`, terminação TLS e proxy WebSocket no ambiente de execução não podem ser confirmados.
- **HIPÓTESE A VALIDAR:** Em produção, a implantação pode fornecer um proxy externo não armazenado neste repositório. É preciso confirmar domínios, prefixos e encaminhamento de `Upgrade`/`Connection` antes de configurar o frontend.

## 3. Inventário das rotas relevantes ao RDP

| Endpoint | Implementação | Autenticação | Responsabilidade real |
|---|---|---|---|
| `GET /host/:hostid/com-ip` | API principal, `routes/host.routes.ts` | `requireExperienceOrLegacyJwt(['normal', 'secondary'])` | Consulta dados do host e calcula `porta_customizada` a partir do IP. |
| `GET /api/conectado` | API principal, `routes/conectado.routes.ts` | Sem middleware de autenticação | Consulta a resposta HTTP do portal configurado; não cria sessão. |
| `POST /api/guacamole/token` | Gateway separado, `server.js` | Bearer estático `API_BEARER_TOKEN` | Emite token criptografado usando host RDP fixo, credenciais e porta informada. |
| WebSocket do gateway | `server.js` + `guacamole-lite` | Token temporário de uso único na query `token` | Transporta a conexão interativa Guacamole/ RDP. |
| `POST /guacamole/connect-full` | **NÃO ENCONTRADO** | — | Não existe no backend analisado. |
| `POST /api/token` | **NÃO ENCONTRADO** | — | Não existe nesta API nem no gateway local analisado. O endpoint do portal externo não foi verificado. |
| `GET /api/auth/photo` | **NÃO ENCONTRADO** | — | Não existe; há somente helper interno para Graph, sem rota correspondente. |

## 4. Análise da consulta da porta customizada

### `GET /host/:hostid/com-ip`

- **CONFIRMADO NO CÓDIGO — rota e prefixo:** implementada em `router.get('/host/:hostid/com-ip', ...)` e montada diretamente com `app.use(hostRoutes)`. O caminho da API é `/host/:hostid/com-ip`, sem `/api`. Evidência: [`routes/host.routes.ts`](./routes/host.routes.ts#L200-L218), [`index.ts`](./index.ts#L81-L86).
- **Entrada:** um parâmetro de caminho `hostid`; não há body nem query exigidos. `parseHostid` aceita somente dígitos e converte para `BigInt`. Evidência: [`routes/_helpers.ts`](./routes/_helpers.ts#L7-L13).
- **Autenticação:** `requireExperienceOrLegacyJwt(['normal', 'secondary'])`. Sem conta Entra na sessão, o middleware delega para `validarToken`, que exige `Authorization: Bearer <JWT>` e origem `portal`. Com conta Entra, exige experiência `normal` ou `secondary` e, em seguida, também chama `validarToken`. Evidência: [`middlewares/experience.middleware.ts`](./middlewares/experience.middleware.ts#L7-L34), [`middlewares/auth.middleware.ts`](./middlewares/auth.middleware.ts#L50-L72).
- **Autorização por host:** para sessão `secondary`, a função `hostIsInSecondaryScope` verifica o host contra grupos permitidos e responde `404` se estiver fora do escopo. A implementação não faz essa verificação para experiência `normal`; o caminho legado JWT também não verifica vínculo do host com usuário/empresa nesta rota. Evidência: [`routes/host.routes.ts`](./routes/host.routes.ts#L11-L25), [`routes/_company-scope.ts`](./routes/_company-scope.ts).
- **Origem do campo:** `HostRepository.getHostComIp` seleciona `hostid`, nome e IP da interface principal (`interface.main = 1`); não seleciona o campo `interface.port`. A camada de serviço usa cache e delega ao repositório. Evidência: [`repositories/host.repository.ts`](./repositories/host.repository.ts#L418-L449), [`services/zabbix.service.ts`](./services/zabbix.service.ts#L613-L620).
- **Cálculo:** `porta_customizada` vem de `gerarPortaDoIp(ip)`. O algoritmo combina o terceiro e quarto componentes do IP para formar uma string de até cinco dígitos; exemplo documentado no código: `10.86.23.168` resulta em `"23168"`. Portanto, não é uma porta configurada/lida do Zabbix, e também não é necessariamente uma porta TCP convencional. Evidência: [`utils/helpers.ts`](./utils/helpers.ts#L235-L269).
- **Nulo/inválido:** IP nulo/vazio, formato com quantidade de componentes diferente de quatro ou quarto componente fora do intervalo `0..255` resulta em `null`. O helper não valida completamente os quatro octetos como IPv4 nem valida a saída como porta TCP; não há erro HTTP específico por a porta calculada ser nula. O endpoint ainda retorna `200` se o host existir e `ip`/`porta_customizada` forem nulos.
- **Resposta confirmada:** objeto com `hostid`, `nome`, `ip` e `porta_customizada`. Host inexistente retorna `404 { "erro": "Host não encontrado" }`; `hostid` inválido e erros capturados retornam `400 { "erro": ... }`. Não há tratamento específico `401`/`403` na função da rota; esses status podem vir do middleware de autenticação/escopo.

Exemplo fictício compatível com o formato:

```json
{
  "hostid": "12345",
  "nome": "servidor-exemplo",
  "ip": "10.86.23.168",
  "porta_customizada": "23168"
}
```

## 5. Análise do endpoint de conexão RDP

### `POST /guacamole/connect-full`

**NÃO ENCONTRADO:** Não há implementação dessa rota na API principal nem em `server.js`. A busca de código não encontrou rota, handler ou serviço chamado por ela. O arquivo `rotas.txt` contém uma listagem legada que menciona o nome, mas esse arquivo não é implementação e não confirma o contrato.

Consequentemente, payload, campos obrigatórios, autenticação, autorização do host, validação de hostname, formato da resposta e erros de `connect-full` não podem ser especificados. Não se deve enviar esse payload presumido do frontend.

### Mecanismo que existe no gateway local

**CONFIRMADO NO CÓDIGO:** O endpoint implementado é `POST /api/guacamole/token` no servidor separado `server.js`, não `/guacamole/connect-full`.

- **Payload efetivamente lido:** `username`, `password` e `port`; os três são obrigatórios. `port` aceita número inteiro ou string composta de dígitos e deve estar entre `1` e `65535`. `username` após `trim` deve ter de 1 a 256 caracteres e não pode conter `\`; `password` deve ter de 1 a 512 caracteres. `hostname` enviado pelo cliente não é lido.
- **Autenticação efetiva:** Bearer estático comparado com a configuração `API_BEARER_TOKEN`. O middleware é aplicado a `/api` no gateway, exceto que `/health` é registrado antes dele. Evidência: [`server.js`](./server.js#L131-L147), [`server.js`](./server.js#L20-L28).
- **Host e domínio:** a constante `RDP_HOSTNAME` é `ts.datacore.com.br`. Ela é usada como `connection.settings.hostname` e `domain`; não há seleção dinâmica do destino. Evidência: [`server.js`](./server.js#L12-L12), [`server.js`](./server.js#L166-L193).
- **Credenciais/porta:** usuário, senha e porta são colocados em `connection.settings`; a porta é serializada como string. Esse objeto é cifrado com AES-256-CBC usando a chave `GUAC_KEY`. Evidência: [`server.js`](./server.js#L72-L89), [`server.js`](./server.js#L166-L193).
- **Criação/identificação:** o gateway emite token criptografado, armazena-o temporariamente em `pendingTokens` por 60 segundos e retorna o token e a URL WebSocket. O token pendente é consumido uma única vez na verificação de upgrade. Não é retornado um `connectionId` nesse endpoint; os identificadores da conexão Guacamole só aparecem nos logs de eventos do serviço. Evidência: [`server.js`](./server.js#L14-L15), [`server.js`](./server.js#L194-L209), [`server.js`](./server.js#L303-L335), [`server.js`](./server.js#L346-L366).
- **Erros HTTP conhecidos:** `400` para porta/credenciais inválidas; `401` para ausência ou invalidade do Bearer; `503` quando o limite de tokens pendentes é atingido; `404` para caminhos inexistentes; erros internos do handler podem resultar em `500`. No upgrade WebSocket, o código produz `400`, `401`, `403` ou `404` para os casos de URL inválida, token ausente/inválido, origem recusada ou caminho não reconhecido.

**Conclusão sobre o destino solicitado:** `ts-eqnx.datacore.com.br` **não pode ser selecionado pelo contrato atual**. O código usa hostname fixo `ts.datacore.com.br` e só permite informar a porta. Não existe evidência no código que autorize enviar `ts-eqnx.datacore.com.br` por campo alternativo ou codificá-lo na porta.

## 6. Análise do portal, token e WebSocket

### Portal externo e `POST /api/token`

- **NÃO ENCONTRADO:** Não há handler local `POST /api/token`.
- **CONFIRMADO NO CÓDIGO:** `/api/conectado` consulta uma URL de portal por `fetch(GET)`; o default configurado no código é `http://10.86.26.18:8410/`, substituível por `GUACAMOLE_BASE_URL`. O endpoint apenas exige status `200` e `Content-Type` HTML e retorna `{ "status": "conectado" }`. Evidência: [`routes/conectado.routes.ts`](./routes/conectado.routes.ts#L1-L56), [`.env.example`](./.env.example).
- **DEPENDÊNCIA EXTERNA:** O código-fonte do portal HTTP configurado não está neste repositório. Não é possível determinar se esse serviço implementa `POST /api/token`, qual payload/retorno usa, ou como cria sessões.
- **Distinção de contrato:** O gateway implementado localmente usa `POST /api/guacamole/token`; não há evidência para renomeá-lo ou tratá-lo como endpoint `/api/token` do portal.

### WebSocket, serviço Guacamole e encerramento

- **CONFIRMADO EM CONFIGURAÇÃO:** O gateway conecta `guacamole-lite` ao serviço `guacd` por `GUACD_HOST` e `GUACD_PORT` (defaults `127.0.0.1:4822`). A implementação usa a biblioteca `guacamole-lite` e o servidor HTTP criado em conjunto com Express. Evidência: [`server.js`](./server.js#L1-L12), [`server.js`](./server.js#L20-L28), [`server.js`](./server.js#L328-L344).
- **CONFIRMADO NO CÓDIGO:** O endereço público do WebSocket vem de `GUAC_WS_PUBLIC_URL` (default `ws://localhost:<GUAC_PORT>`), que pode usar `ws:` ou `wss:`; o pathname dessa URL é usado no upgrade. O gateway escuta em `0.0.0.0:<GUAC_PORT>`. Evidência: [`server.js`](./server.js#L41-L51), [`server.js`](./server.js#L110-L117), [`server.js`](./server.js#L376-L390).
- **CONFIRMADO NO CÓDIGO:** A resposta do token fornece `websocketUrl` com o token na query. O cliente abre essa URL; o token pendente é validado no upgrade e consumido uma vez. `guacamole-lite` é associado ao mesmo servidor HTTP e faz a ponte para `guacd`. Evidência: [`server.js`](./server.js#L194-L209), [`server.js`](./server.js#L303-L344).
- **Sessão e eventos:** handlers `open` e `close` registram `connectionId`, `guacamoleConnectionId`, hostname/usuário e, no fechamento, `errorCode`. Esses eventos são logs do backend, não um endpoint REST de status nem contrato de eventos de negócio separado para o frontend. Evidência: [`server.js`](./server.js#L346-L366).
- **Encerramento:** não foi encontrado endpoint REST para finalizar uma sessão por ID. O código registra o evento `close` do `guacamole-lite` e oferece `close()` para desligar o servidor no ciclo de vida do processo. O encerramento interativo esperado ocorre no transporte WebSocket/cliente Guacamole; não há contrato próprio adicional exposto pela API.
- **Limite de evidência:** não há configuração ou código de container do `guacd` neste repositório. A disponibilidade real de `guacd`, seu host/porta de produção, regras de rede e comportamento do servidor remoto dependem do ambiente.

## 7. Análise da autenticação e autorização

### API principal

- **CONFIRMADO NO CÓDIGO:** O middleware JWT exige `Authorization: Bearer <JWT>`, verifica assinatura usando `SECRET_KEY` ou `APIKEY` e exige `origem: "portal"`. Valores dessas variáveis não são reproduzidos. Evidência: [`middlewares/auth.middleware.ts`](./middlewares/auth.middleware.ts#L5-L10), [`middlewares/auth.middleware.ts`](./middlewares/auth.middleware.ts#L50-L72).
- **CONFIRMADO NO CÓDIGO:** O login Entra ID usa `express-session` e cookie `clientemonitor.sid`; `config/session.ts` define `httpOnly`, `secure` em produção, `SameSite` configurável e domínio opcional. Evidência: [`index.ts`](./index.ts#L59-L66), [`config/session.ts`](./config/session.ts).
- **CONFIRMADO NO CÓDIGO:** O fluxo Entra guarda a conta/experiência na sessão e o middleware `requireMicrosoftAccount` protege `/auth/silent` e `/auth/me`. As rotas de dados usam `requireExperienceOrLegacyJwt`; como implementado, essa função exige experiência e em seguida executa também `validarToken` quando há conta Entra na sessão. Evidência: [`routes/entra-auth.routes.ts`](./routes/entra-auth.routes.ts#L58-L180), [`middlewares/experience.middleware.ts`](./middlewares/experience.middleware.ts#L7-L34).
- **Autorização por empresa/host:** o login Entra classifica a experiência e pode restringir `secondary` a grupos de hosts permitidos. Na rota da porta, esse escopo é verificado para `secondary`; não há verificação específica de host no fluxo de `normal` nem no caminho JWT legado. Não há middleware de autorização aplicado ao endpoint de token do gateway que compare o usuário/empresa ao host escolhido.
- **CONFIRMADO NO CÓDIGO:** `GET /api/conectado` não tem middleware de autenticação. O gateway exige credencial estática compartilhada, não o JWT ou cookie da API principal.

### Segredos, CORS, HTTPS e exposição ao navegador

- `API_BEARER_TOKEN` autentica chamadas ao gateway; `GUAC_KEY` cifra o token Guacamole; `SESSION_SECRET` assina a sessão; `SECRET_KEY`/`APIKEY` assinam JWT legado; credenciais Entra são lidas de variáveis `AZURE_*`. São nomes e finalidades, não valores.
- **CONFIRMADO NO CÓDIGO:** A API principal não chama `/api/guacamole/token` nem oferece uma rota proxy para ele. O gateway fica em processo/porta distintos e seu endpoint depende de um Bearer estático.
- **Avaliação:** se o navegador chamar diretamente o gateway, teria de receber o `API_BEARER_TOKEN` estático para autenticar. Isso exporia um segredo compartilhado; não é uma integração adequada para o frontend. Não expor credenciais privadas do gateway ao navegador.
- **HIPÓTESE A VALIDAR:** É possível que a implantação externa tenha um proxy ou camada de backend não versionada que encaminhe os pedidos. Não há evidência disso neste repositório.
- **HTTPS/CORS:** a API permite CORS para `FRONTEND_URL` e credenciais; o gateway limita CORS por origins. `GUAC_WS_PUBLIC_URL` permite `wss:`, mas o default é `ws:`. Nenhuma regra de terminação TLS/proxy está versionada. Em deployment HTTPS, confirmar que API e WebSocket usam URLs seguras e que o proxy suporta WebSocket.

## 8. Análise do erro `/api/auth/photo`

- **NÃO ENCONTRADO:** não há `GET /api/auth/photo` nem `GET /auth/photo` nos routers registrados.
- **CONFIRMADO NO CÓDIGO:** A API principal usa `/auth` para o router Entra e registra o router sem prefixo `/api`; as rotas Entra implementadas incluem `/auth/login`, `/auth/callback`, `/auth/silent`, `/auth/me` e `/auth/logout`. Nenhuma delas é foto. Evidência: [`index.ts`](./index.ts#L81-L83), [`routes/entra-auth.routes.ts`](./routes/entra-auth.routes.ts#L58-L237).
- **CONFIRMADO NO CÓDIGO:** Existe `getGraphPhoto(accessToken)` em `services/graph.ts`, que consulta Microsoft Graph, mas não foi encontrada chamada a esse helper nem rota que o exponha. `GET /auth/me` retorna perfil e grupos, não implementa endpoint de imagem. Evidência: [`services/graph.ts`](./services/graph.ts#L94-L105), [`routes/entra-auth.routes.ts`](./routes/entra-auth.routes.ts#L197-L235).
- **404 se chegar à API principal:** o handler final da API retorna `404` JSON `{"erro":"Rota não encontrada: <método> <caminho>"}` para caminho sem rota. Evidência: [`index.ts`](./index.ts#L111-L114).
- **Diagnóstico do navegador:** o erro observado para `GET /api/auth/photo` quando a origem é `http://localhost:5173` confirma apenas o URL/origem reportado. O backend confirma que o caminho não existe nele; não confirma se o 404 observado foi produzido pelo Vite, por um proxy, por outro servidor ou pela API principal.
- **HIPÓTESE A VALIDAR:** se o frontend envia URL relativa `/api/auth/photo` e não há proxy configurado no frontend para a API na porta `3000`, o pedido pode ser atendido pelo servidor na porta `5173`. Não há configuração React/Vite/proxy neste repositório para confirmar ou excluir isso.
- Não há evidência que associe esse 404 à criação ou falha de uma sessão RDP.

## 9. Contrato real disponível para o frontend

Os exemplos são fictícios e ilustram apenas formas confirmadas pelo código.

| Método e caminho | Serviço/base | Autenticação | Contrato confirmado / resposta |
|---|---|---|---|
| `GET /host/:hostid/com-ip` | API principal; porta `PORT` (padrão `3000`); sem prefixo `/api` | Middleware `requireExperienceOrLegacyJwt`; ver seção 4 | Sem body. Exemplo: `GET /host/12345/com-ip`. Retorna `{ "hostid": "12345", "nome": "servidor-exemplo", "ip": "10.86.23.168", "porta_customizada": "23168" }`. `porta_customizada` pode ser `null`. `400` hostid inválido, `404` host inexistente/fora do escopo secundário, `401`/`403` conforme autenticação/autorização, `400` para exceções capturadas pela rota. |
| `GET /api/conectado` | API principal; porta `PORT` | Nenhuma | Consulta disponibilidade do portal; retorna `{ "status": "conectado" }` apenas se portal responder HTTP 200 com HTML. Erros conhecidos: `500` timeout configurado inválido; `502` recusa, status/conteúdo inesperado ou falha de rede; `504` timeout da chamada. Não inicia sessão. |
| `POST /api/guacamole/token` | Processo gateway; porta `GUAC_PORT` (padrão `8190`) | `Authorization: Bearer <API_BEARER_TOKEN>` estático | Payload necessário: `username`, `password`, `port`; ver abaixo. Retorna token temporário e `websocketUrl`. Host fixo `ts.datacore.com.br`. Não enviar esse segredo ao browser; o endpoint só é utilizável pelo frontend de forma segura após existir integração servidor-a-servidor autenticada. |
| WebSocket `websocketUrl` retornada pelo gateway | Processo gateway; URL definida por `GUAC_WS_PUBLIC_URL` | Token temporário de uso único na query `token` | Transporte interativo de Guacamole criado por `guacamole-lite` para `guacd`. O caminho depende de `GUAC_WS_PUBLIC_URL`; o default é `/`. Erros de upgrade incluem `400`, `401`, `403` e `404`. |
| `POST /guacamole/connect-full` | — | — | **NÃO ENCONTRADO. CONTRATO NÃO CONFIRMADO.** |
| `POST /api/token` (portal) | Serviço externo não disponível | **DEPENDÊNCIA EXTERNA** | **CONTRATO NÃO CONFIRMADO.** Não inventar payload nem resposta. |
| `GET /api/auth/photo` | — | — | **NÃO ENCONTRADO.** A API principal responde pelo seu handler 404 se o pedido chegar a ela. |

Payload demonstrativo do endpoint confirmado no **gateway separado**, não do portal externo:

```http
POST /api/guacamole/token
Authorization: Bearer <segredo-do-gateway>
Content-Type: application/json
```

```json
{
  "username": "usuario-exemplo",
  "password": "<senha-ficticia>",
  "port": 3389
}
```

Resposta demonstrativa:

```json
{
  "token": "<token-ficticio>",
  "websocketUrl": "wss://gateway.exemplo.invalid/?token=<token-ficticio>"
}
```

Fluxo confirmado neste gateway: backend/gateway valida bearer e campos → cria token cifrado com `hostname` fixo, `port` recebido e credenciais → mantém token pendente por 60 segundos → devolve token e URL WebSocket → cliente abre WebSocket com token de uso único → `guacamole-lite` encaminha a conexão para `guacd`. O fluxo **não** verifica a autorização do usuário para um host selecionado e **não** permite selecionar `ts-eqnx.datacore.com.br`.

## 10. Dependências externas não verificadas

1. **DEPENDÊNCIA EXTERNA — portal RDP:** o serviço em `GUACAMOLE_BASE_URL` é consultado somente para disponibilidade. Seu código, autenticação, `POST /api/token`, contrato de criação de sessão e eventual WebSocket não estão disponíveis.
2. **DEPENDÊNCIA EXTERNA — `guacd`:** o backend configura host e porta, mas não contém container/serviço de `guacd` nem comprovação de que o processo esteja acessível no ambiente.
3. **DEPENDÊNCIA EXTERNA — implantação/proxy:** domínios, TLS, encaminhamento de `/api`, proxy WebSocket e URLs públicas não são definidos em arquivos de proxy versionados.
4. **DEPENDÊNCIA EXTERNA — destino remoto:** o código indica `ts.datacore.com.br` no token; disponibilidade, DNS, regras de rede, aceitação da porta customizada e validade das credenciais no destino não podem ser testadas ou inferidas apenas por essa implementação.
5. **DEPENDÊNCIA EXTERNA — frontend:** não há código React/Vite que permita confirmar a URL atualmente construída, eventual proxy local, formato esperado pelo componente Guacamole ou armazenamento de credenciais.

## 11. Lacunas que impedem a conexão RDP pelo contrato pedido

- O endpoint solicitado `POST /guacamole/connect-full` não existe.
- O endpoint de portal `POST /api/token` não existe no código disponível e seu contrato externo não foi verificado.
- O endpoint de token que existe é separado e requer segredo estático, sem proxy autenticado da API principal; não é seguro entregar o segredo ao browser.
- O gateway seleciona sempre `ts.datacore.com.br`, não o hostname do host escolhido e não `ts-eqnx.datacore.com.br`.
- O endpoint de porta retorna valor calculado a partir do IP; não comprova que a porta seja permitida ou que corresponda a uma sessão daquele host. A rota não valida o hostname/destino que consumirá essa porta.
- Não existe autorização por host/empresa ligada ao endpoint de token no gateway.
- Não há configuração confirmada de URL pública real, TLS, proxy WebSocket ou instância `guacd` no deployment.
- Não há endpoint próprio para encerrar sessão por ID nem contrato para consultar estado/eventos da sessão.

## 12. Recomendações técnicas para a próxima etapa

1. Confirmar com o responsável pelo portal externo se ele fornece `POST /api/token`, sua autenticação, payload, resposta, validade do token, WebSocket e política de encerramento; obter documentação/implementação, não inferir do `/api/conectado`.
2. Decidir qual serviço é a autoridade de conexão: portal externo ou gateway local. Não misturar o health check do portal com o mecanismo local `server.js`.
3. Antes do frontend, definir um endpoint servidor-a-servidor autenticado que aceite uma identidade autenticada e uma referência de host, aplique autorização por empresa/host e resolva hostname/porta em fonte confiável. Não aceitar hostname arbitrário nem enviar `API_BEARER_TOKEN`/`GUAC_KEY` ao navegador.
4. Definir explicitamente se `ts-eqnx.datacore.com.br` é um destino permitido e como host/porta são vinculados e validados. O código atual não suporta seleção de hostname.
5. Corrigir/confirmar a origem da porta: estabelecer se deve ser porta real de interface/serviço, valor derivado do IP ou regra de roteamento documentada. Validar faixa TCP e autorização no servidor.
6. Definir URLs efetivas de API e WebSocket por ambiente, CORS, cookies, HTTPS/WSS e configuração de proxy com suporte a upgrade WebSocket.
7. Especificar ciclo de vida da sessão, expiração, fechamento explícito, mensagens de erro e comportamento do cliente RDP antes de implementar o componente React.
8. Para foto, decidir se a UI deve usar outra fonte ou se a API deve expor foto em etapa posterior; não assumir que `getGraphPhoto` já é endpoint.

## 13. Checklist de informações necessárias para a implementação frontend

- [ ] URL/base da API principal e confirmação se o frontend deve chamar `/host/...` sem `/api`.
- [ ] Fluxo de autenticação usado no frontend: cookie Entra, JWT Bearer, ou ambos conforme o middleware real.
- [ ] Para sessões Entra, como obter/renovar o JWT Bearer que as rotas protegidas também exigem.
- [ ] Contrato real do portal externo, caso ele seja o responsável pela conexão: URL, método, autenticação, payload, resposta e erros.
- [ ] Decisão sobre uso do gateway local versus portal; URL e porta públicas de cada serviço.
- [ ] Mecanismo server-to-server para não expor `API_BEARER_TOKEN` nem `GUAC_KEY` no navegador.
- [ ] Relação entre host selecionado, ID, hostname autorizado e porta; confirmação se a porta derivada de IP é realmente a esperada.
- [ ] Confirmação de destinos aceitos, especialmente se `ts-eqnx.datacore.com.br` deve ser usado.
- [ ] Autorização efetiva por usuário, empresa e host, inclusive experiência `secondary`.
- [ ] URL final do WebSocket, uso de `wss://`, pathname e encaminhamento de upgrade pelo proxy.
- [ ] Contrato de expiração/uso do token e política de renovação se o upgrade falhar.
- [ ] Eventos/mensagens que o cliente deve tratar, erros de conexão e encerramento da sessão.
- [ ] Endpoint e formato da foto do usuário; o caminho `/api/auth/photo` não está disponível no backend atual.
- [ ] Configuração do proxy de desenvolvimento (porta `5173`) e de produção para API e WebSocket.

---

**Conclusão:** a implementação disponível permite confirmar a consulta de porta e um gateway Guacamole Lite separado com alvo RDP fixo e WebSocket. Ela não confirma o contrato `connect-full`, não permite selecionar dinamicamente o hostname a partir do host escolhido e não oferece uma chamada segura do frontend ao gateway sem uma camada servidor-a-servidor adicional.
