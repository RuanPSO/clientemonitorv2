# Análise técnica do portal RDP para integração com o frontend

**Data da análise:** 28/10/2026
**Portal examinado:** `http://10.86.26.18:8410/`
**Escopo:** análise do repositório e leitura HTTP da aplicação publicada. Nenhuma sessão RDP foi iniciada e nenhuma credencial foi enviada.

## Como ler as conclusões

- **Confirmado no código:** localizado diretamente em um arquivo versionado ou no JavaScript/HTML servido pelo portal.
- **Confirmado por teste:** observado em requisição HTTP executada nesta análise ou em teste automatizado executado.
- **Inferido:** interpretação sustentada pela evidência disponível, mas sem implementação do servidor correspondente.
- **Pendente:** requer acesso a código/configuração ausente, ou validação com o responsável pelo serviço.

> **Limite de evidência:** o código-fonte do servidor do portal na porta 8410 não está neste repositório. Foi possível obter a página e seus recursos estáticos por HTTP, mas não inspecionar a implementação de `POST /api/token`, a configuração do WebSocket remoto, nem o processamento do lado servidor. O gateway implementado em [server.js](./server.js) é um serviço separado e não deve ser confundido com o backend observado do portal.

## 1. Resumo executivo

- **Confirmado por teste:** `GET http://10.86.26.18:8410/` respondeu HTTP 200 com uma página HTML intitulada “Portal RDP”. A resposta identificou Express por `X-Powered-By: Express`. Os recursos `/app.js`, `/style.css` e `/guacamole-common.js` também responderam HTTP 200.
- **Confirmado no código (recurso servido):** a página contém os campos `#host`, `#user` e `#pass`. O Host inicial é `ts.datacore.com.br:32245`; usuário e senha são campos separados.
- **Confirmado no código (recurso servido):** ao clicar em **Conectar**, o JavaScript envia `{ hostname, username, password, width, height }` para `POST api/token`; depois usa o `token` retornado para iniciar um cliente Guacamole por WebSocket. O JavaScript não separa `hostname` e `port`.
- **Pendente:** não há código do servidor de `api/token` no repositório. Portanto, não é possível confirmar que ele aceita, separa ou valida `ts-eqnx.datacore.com.br:33165`, nem confirmar os campos obrigatórios do lado servidor.
- **Confirmado no código:** este repositório contém outro gateway RDP, em [server.js](./server.js), cuja rota `POST /api/guacamole/token` recebe `username`, `password` e `port` separadamente, fixa o hostname `ts.datacore.com.br` e retorna `{ token, websocketUrl }`. A rota não é a mesma rota `POST /api/token` que o portal servido chama.
- **Confirmado no código:** `GET /api/conectado` é somente uma verificação de disponibilidade HTTP/HTML do portal; não cria sessão.
- **Recomendação:** não presumir que um `iframe` ou uma nova aba possa preencher o Host. O portal não mostra suporte a parâmetro de prefill e, em origens diferentes, o frontend não pode acessar o DOM do iframe. Reutilize o fluxo de sessão existente por uma integração de mesma origem ou por uma camada de backend autenticada, mas confirme primeiro o contrato real de `api/token` e a discrepância entre `ts.datacore.com.br` e o destino desejado `ts-eqnx.datacore.com.br`.

## 2. Arquitetura identificada

### Portal publicado na porta 8410

- **Confirmado por teste:** o endereço informado serve HTML por HTTP na porta 8410. A página inclui `/style.css`, `guacamole-common.js` e `/app.js`.
- **Confirmado no código (recursos servidos):** o cliente do navegador usa a API JavaScript Guacamole (`Guacamole.Client`, `Guacamole.WebSocketTunnel`, `Guacamole.Keyboard` e `Guacamole.Mouse`) para exibir a sessão e encaminhar teclado/mouse.
- **Inferido:** o portal publicado tem um servidor Express e um serviço Guacamole/WebSocket na mesma origem, pois o cliente usa rotas relativas (`api/token`, `api/evento`) e abre WebSocket usando `location.host` e o diretório da página.
- **Pendente:** não foi possível confirmar se o processo que aceita o WebSocket é `guacamole-lite`, um servidor próprio, ou outro componente. A resposta HTTP e o JavaScript não identificam essa implementação.

### Aplicação principal deste repositório

- **Confirmado no código:** o backend principal é Node.js + TypeScript + Express. A entrada é [index.ts](./index.ts); a porta padrão é `3000` via `PORT`. A configuração de bibliotecas está em [package.json](./package.json).
- **Confirmado no código:** o backend monta a rota `GET /api/conectado` e as rotas de hosts, mas não serve a página do portal RDP.
- **Confirmado no código:** a configuração `GUACAMOLE_BASE_URL` usada para verificar o portal tem como padrão `http://10.86.26.18:8410/`, em [routes/conectado.routes.ts](./routes/conectado.routes.ts) e [.env.example](./.env.example).
- **Confirmado no código:** há ainda um gateway Node.js separado em [server.js](./server.js), iniciado por `npm run start:guacamole`, que usa Express, `guacamole-lite` e `guacd`. A porta padrão do gateway é `8190`; a porta padrão de `guacd` é `4822`.
- **Pendente:** não há frontend React ou componente React neste repositório, e não há código aqui que sirva `/api/token` na porta 8410.

### Diagrama dos fluxos observados

```text
Portal publicado (HTTP :8410)
  navegador -> POST /api/token -> serviço do portal (implementação não encontrada)
  navegador -> WebSocket para a origem :8410 com token -> sessão Guacamole/RDP

Gateway separado deste repositório (GUAC_PORT, padrão :8190)
  cliente -> POST /api/guacamole/token + bearer -> server.js
  navegador -> WebSocket com token -> guacamole-lite -> guacd (:4822) -> RDP

Backend principal deste repositório (PORT, padrão :3000)
  frontend -> GET /host/:hostid/com-ip -> porta_customizada
  backend -> GET ao portal :8410 via GET /api/conectado (somente disponibilidade)
```

## 3. Componentes e arquivos relevantes

### Arquivos versionados analisados

| Arquivo | Responsabilidade/evidência |
|---|---|
| [package.json](./package.json) | Dependências e comandos: Express, `guacamole-lite`, `start`, `start:guacamole`, testes e typecheck. |
| [index.ts](./index.ts) | Inicialização do backend principal, middleware, montagem das rotas e porta `PORT` (padrão 3000). |
| [server.js](./server.js) | Gateway WebSocket/RDP, endpoint de emissão de token, autenticação bearer, validação de origem, conexão com `guacd` e rotas de arquivos. |
| [routes/conectado.routes.ts](./routes/conectado.routes.ts) | Verificação de disponibilidade por GET à página do portal. |
| [routes/host.routes.ts](./routes/host.routes.ts) | Rota `GET /host/:hostid/com-ip`, validação do ID, autorização e retorno de host/IP/porta. |
| [repositories/host.repository.ts](./repositories/host.repository.ts) | Consulta do host e interface principal do Zabbix; constrói `porta_customizada`. |
| [services/zabbix.service.ts](./services/zabbix.service.ts) | Serviço/cache consultado pela rota de host. |
| [utils/helpers.ts](./utils/helpers.ts) | Regra que deriva a porta customizada do IP. |
| [config/env.ts](./config/env.ts) | Carregamento/validação de ambiente do backend principal. |
| [config/cors.ts](./config/cors.ts) | CORS do backend principal: origem configurada e credenciais habilitadas. |
| [config/session.ts](./config/session.ts) | Opções do cookie de sessão do backend principal. |
| [middlewares/experience.middleware.ts](./middlewares/experience.middleware.ts) | Controle de experiência/sessão e delegação ao JWT legado. |
| [middlewares/auth.middleware.ts](./middlewares/auth.middleware.ts) | Validação do JWT legado por `Authorization: Bearer`. |
| [.env.example](./.env.example) | Nomes de configuração documentados, sem valores de segredos reais. |
| [tests/guacamole-server.test.mjs](./tests/guacamole-server.test.mjs) | Testes da rota de token do gateway, origem e WebSocket. |
| [tests/conectado.routes.test.ts](./tests/conectado.routes.test.ts) | Testes unitários da verificação de disponibilidade, com respostas simuladas. |
| [README.md](./README.md) | Documentação de portas, autenticação, CORS e rota de disponibilidade. |
| [GUACAMOLE_FLUXO.md](./GUACAMOLE_FLUXO.md) | Documentação do gateway e distinção entre health check e emissão de sessão. |
| [GUIA_MODAL_CONEXAO_RDP.md](./GUIA_MODAL_CONEXAO_RDP.md) | Guia de integração existente; contém recomendações, não prova implementação do frontend. |
| [RELATORIO_VALIDACAO_PORTAL_RDP.md](./RELATORIO_VALIDACAO_PORTAL_RDP.md) | Relatório anterior sobre testes da rota e limitações de conectividade observadas naquele momento. |

### Recursos obtidos do portal em execução

- **Confirmado por teste:** HTML em `http://10.86.26.18:8410/`, JavaScript em `/app.js`, CSS em `/style.css` e biblioteca cliente em `/guacamole-common.js`.
- **Pendente:** os recursos acima não são arquivos presentes no repositório; as conclusões sobre eles descrevem a versão servida durante esta consulta, que pode mudar sem alteração no código local.

## 4. Formulário atual e campos de conexão

- **Confirmado no código (HTML servido):** a página tem título “Conectar ao Servidor RDP”, controles independentes e botões **Cancelar** e **Conectar**:

```html
<input id="host" placeholder="Host ou IP (ex: 192.168.1.10:3389)"
       value="ts.datacore.com.br:32245" required>
<input id="user" placeholder="Usuário ou DOMINIO\usuario"
       autocomplete="username" required>
<input id="pass" type="password" placeholder="Senha"
       autocomplete="current-password">
<button id="btnConectar" type="button" onclick="conectar()">Conectar</button>
```

- **Confirmado no código (JavaScript servido):** a função global `conectar()` lê os controles por `document.getElementById('host'|'user'|'pass')`. O campo Host e usuário são aparados com `trim()`; a senha não é aparada.
- **Confirmado no código (HTML/JavaScript servido):** os campos não têm atributo `name` nem fazem parte de um `<form>` submetido pelo navegador. `required` no HTML não executa validação automática ao clicar, porque o botão é `type="button"` e a ação é uma função JavaScript.
- **Confirmado no código (JavaScript servido):** a validação client-side explícita exige apenas Host e usuário. A senha não é verificada pela função antes da chamada HTTP; o endpoint remoto pode rejeitá-la, mas isso não foi comprovado.
- **Confirmado no código (HTML servido):** o Host padrão é editável; o JavaScript não o marca como somente leitura nem impede alteração pelo usuário.
- **Pendente:** não foi encontrado suporte no cliente para ler Host de query string, fragmento ou outro parâmetro de URL.

## 5. Contrato real de Host, usuário, senha e porta

### Host

- **Confirmado no código (HTML servido):** o campo é `id="host"`; não há `name`. O valor padrão é `ts.datacore.com.br:32245` e o placeholder exemplifica `hostname:3389`.
- **Confirmado no código (JavaScript servido):** o valor é lido como texto completo e enviado sem parse em `hostname`.
- **Confirmado no código (JavaScript servido):** não há validação de formato, extração de porta ou substituição do Host antes do envio.
- **Pendente:** o servidor do portal precisa ser consultado para saber se `hostname` aceita host e porta combinados, se divide `hostname:port`, ou se exige outro formato. O valor pré-preenchido demonstra o formato exibido no campo, mas não comprova o parser do servidor.
- **Pendente:** não há comprovação de que o servidor aceite ou permita alterar o host para `ts-eqnx.datacore.com.br`. O backend separado deste repositório fixa outro hostname, `ts.datacore.com.br`.

### Usuário

- **Confirmado no código (HTML/JavaScript servido):** o campo é `id="user"`, `autocomplete="username"`, sem `name`; é obrigatório no HTML e a função também recusa string vazia após `trim()`.
- **Confirmado no código (JavaScript servido):** enviado como propriedade `username`, com espaços externos removidos.
- **Pendente:** autenticação adicional, usuário padrão, domínio efetivamente aplicado pelo servidor ou eventual política que transforme o nome de usuário não foram encontrados.

### Senha

- **Confirmado no código (HTML/JavaScript servido):** campo `id="pass"`, `type="password"`, `autocomplete="current-password"`; não há `name` nem atributo `required`.
- **Confirmado no código (JavaScript servido):** enviada como propriedade `password` no corpo JSON de `POST api/token`. O campo é limpo ao reiniciar a interface.
- **Pendente:** o servidor de `api/token` é quem pode confirmar se senha vazia é recusada, se há segundo fator ou outro método de autenticação.
- **Confirmado por teste:** a página usa HTTP sem TLS neste endereço. Portanto, o POST relativo à mesma origem também usa HTTP no endereço atualmente observado; credenciais transmitidas no corpo não ficam protegidas por TLS neste caminho. Não foi enviado nenhum dado de autenticação durante esta análise.

### Porta

- **Confirmado no código (JavaScript servido):** não existe propriedade `port` no JSON enviado pelo portal; a porta está, no exemplo atual, junto ao texto do Host.
- **Pendente:** não foi possível comprovar como o servidor de `api/token` interpreta o sufixo `:porta`, se aplica uma porta padrão ou se substitui a porta.
- **Confirmado no código (gateway deste repositório):** `POST /api/guacamole/token` exige `port` separado, aceita número ou string numérica no intervalo 1–65535 e converte o valor em `settings.port`. Ele não recebe Host; usa `RDP_HOSTNAME = 'ts.datacore.com.br'`.
- **Confirmado por teste:** o teste automatizado do gateway decodifica o token de teste e verifica que `hostname` permanece fixo e que portas informadas separadamente chegam a `settings.port`. Isso valida o código do gateway, não o backend do portal na porta 8410.

### Porta customizada no backend principal

- **Confirmado no código:** `GET /host/:hostid/com-ip` retorna `{ hostid, nome, ip, porta_customizada }`. A rota valida `hostid` e exige JWT `Bearer`; quando há sessão Express, também exige experiência permitida e aplica o escopo de hosts da experiência `secondary`. Responde 404 para host ausente/fora desse escopo.
- **Confirmado no código:** sem uma sessão Express com `account`, o middleware segue pelo JWT legado, e o filtro `hostIsInSecondaryScope` não limita o host nesse caminho. Confirme se esse comportamento é compatível com a autorização exigida antes de usar a rota como fonte de destinos RDP.
- **Confirmado no código:** `porta_customizada` é gerada a partir do IP pelo helper em [utils/helpers.ts](./utils/helpers.ts). Por exemplo, a regra documentada no código transforma `10.86.33.165` em `"33165"`.
- **Confirmado no código:** a porta pode ser `null` quando não há IP ou quando o helper não consegue gerar valor; o frontend deverá impedir conexão se não houver uma porta numérica válida.
- **Pendente:** nenhum host real foi consultado durante esta análise; o valor `33165` é exemplo, não resultado obtido do banco.

## 6. Fluxo completo de conexão

### Fluxo do portal observado na porta 8410

1. **Confirmado no código (HTML/JavaScript servido):** o botão chama `conectar()`.
2. **Confirmado no código:** `conectar()` verifica se Host e usuário estão preenchidos, oculta a sobreposição de login e mostra o estado “Autenticando...”.
3. **Confirmado no código:** envia `POST api/token`, relativo à origem do portal, com JSON contendo `hostname`, `username`, `password`, `width` e `height`.
4. **Confirmado no código:** para resposta não-OK, tenta ler `dados.erro` e exibe esse texto ou o status HTTP.
5. **Confirmado no código:** em sucesso, lê `dados.sid`, `dados.token` e `dados.login`, guarda `sid` e chama `iniciar(dados.token, dados.login)`.
6. **Confirmado no código:** `iniciar()` constrói um WebSocket na mesma origem e diretório da página, cria `Guacamole.Client`, instala handlers de display, mouse, teclado e clipboard, e executa `client.connect('token=' + encodeURIComponent(token))`.
7. **Confirmado no código:** o cliente indica “Conectado” quando o estado Guacamole é 3; estado 5 encerra e reinicializa a interface.
8. **Pendente:** o código do servidor que recebe `POST /api/token`, gera `sid`/`token`, aceita o upgrade WebSocket e inicia a conexão RDP não está no repositório. Não é possível confirmar o protocolo interno, a conversão do Host ou o serviço que abre a conexão final.

Trecho curto do cliente servido:

```js
body: JSON.stringify({
  hostname: host, username: user, password: pass,
  width: disp.clientWidth, height: disp.clientHeight
})
```

```js
const base = proto + location.host + location.pathname.replace(/[^/]*$/, '');
const c = client = new Guacamole.Client(new Guacamole.WebSocketTunnel(base));
c.connect('token=' + encodeURIComponent(token));
```

### Fluxo do gateway separado neste repositório

- **Confirmado no código:** o cliente autorizado chama `POST /api/guacamole/token` com `username`, `password`, `port` e `Authorization: Bearer ...`.
- **Confirmado no código:** o gateway valida bearer, usuário, senha e intervalo da porta; monta configuração RDP com hostname fixo `ts.datacore.com.br`; cifra a configuração com AES-256-CBC; e responde `{ token, websocketUrl }` com `Cache-Control: no-store`.
- **Confirmado no código:** o upgrade WebSocket valida caminho, origem quando enviada, validade e uso único do token; então `guacamole-lite` usa `guacd` para a sessão.
- **Pendente:** esse fluxo não é chamado pelo JavaScript da página que foi obtida na porta 8410. Não se deve pressupor que os dois serviços compartilham API, token ou configuração.

## 7. Rotas HTTP, APIs e WebSockets identificados

| Serviço | Método/caminho | O que faz | Evidência e estado |
|---|---|---|---|
| Portal publicado :8410 | `GET /` | Página HTML de login/visualização RDP. | **Confirmado por teste** |
| Portal publicado :8410 | `GET /app.js`, `/style.css`, `/guacamole-common.js` | Recursos usados pela página. | **Confirmado por teste** |
| Portal publicado :8410 | `POST /api/token` | Solicita dados para abrir sessão; envia `hostname`, `username`, `password`, `width`, `height`. | **Confirmado no cliente**; implementação e resposta exata do servidor **pendentes** |
| Portal publicado :8410 | `POST /api/evento` | Cliente envia `{ sid, tipo, codigo, mensagem }` para reportar erro de sessão. | **Confirmado no cliente**; servidor e persistência **pendentes** |
| Portal publicado :8410 | WebSocket na origem/diretório da página | Cliente Guacamole envia `token=...` ao conectar. | **Confirmado no cliente**; servidor, autenticação e protocolo exato **pendentes** |
| Backend principal | `GET /api/conectado` | Busca a URL do portal, exige HTTP 200 e `text/html` para responder `{ "status": "conectado" }`. Não inicia sessão. | **Confirmado no código**; teste unitário usa respostas simuladas |
| Backend principal | `GET /host/:hostid/com-ip` | Busca dados do host e a porta customizada. | **Confirmado no código** |
| Gateway deste repositório | `GET /health` | Health check do gateway. | **Confirmado no código** |
| Gateway deste repositório | `POST /api/guacamole/token` | Emite token curto para iniciar a conexão no WebSocket do gateway. | **Confirmado no código** |
| Gateway deste repositório | `POST /api/files/upload`, `GET /api/files`, `GET /api/files/download/:filename` | Operações de transferência de arquivos da sessão. | **Confirmado no código** |

**Distinção importante:** `GET /api/conectado` é apenas a verificação de disponibilidade do portal; não aceita credenciais, não cria token e não inicia RDP. O portal chama `POST /api/token`; o gateway versionado oferece outra operação de sessão, `POST /api/guacamole/token`.

## 8. Mecanismo de autenticação e geração de tokens

### Portal publicado

- **Confirmado no código (cliente servido):** as credenciais são enviadas em JSON para `api/token`; o token e `sid` retornados são usados no fluxo da sessão.
- **Pendente:** não há fonte do servidor nem contrato publicado para determinar se `api/token` exige cookie, autenticação prévia, token de integração, proteção CSRF ou outro fator.
- **Confirmado por teste:** a resposta `GET /` não enviou `Set-Cookie`; isso não comprova que a rota POST não define cookie ou não exige autenticação.
- **Confirmado no código:** o cliente envia o token no argumento de conexão do WebSocket; não foi observado mecanismo de autenticação adicional no código cliente além desse token.

### Gateway em `server.js`

- **Confirmado no código:** as rotas sob `/api/*` são protegidas por `API_BEARER_TOKEN`, comparado em tempo constante; o segredo deve permanecer no servidor.
- **Confirmado no código:** a configuração RDP é cifrada com chave `GUAC_KEY`, com chave de 32 bytes e IV aleatório, usando AES-256-CBC. O token pendente expira após 60 segundos e é consumido uma única vez no upgrade.
- **Confirmado no código:** o gateway não grava explicitamente senha ou token nos logs estruturados de abertura/fechamento; esses logs incluem hostname, username e IDs. O conteúdo de logs de bibliotecas dependentes não foi validado.
- **Confirmado no código:** o token aparece como parâmetro de query na URL WebSocket que o gateway retorna.
- **Risco confirmado no código:** a configuração do gateway define `security: 'any'` e `'ignore-cert': true`. Isso não foi alterado; é necessário confirmar se essa política está intencionalmente aprovada para o serviço efetivamente utilizado.

### Transporte de credenciais

- **Confirmado por teste:** o portal examinado está publicado em `http://`, não `https://`. O formulário envia a senha em corpo JSON, mas HTTP não oferece confidencialidade em trânsito.
- **Pendente:** confirmar TLS/WSS na URL efetivamente usada pelo frontend e pelos serviços finais, incluindo proxy reverso, se houver.
- **Recomendação de segurança:** não transportar credenciais por URL, query string ou logs. Exigir transporte protegido por TLS e limitar o acesso a um endpoint autenticado e autorizado.

## 9. Possibilidades de integração com o frontend

### `iframe`

- **Confirmado por teste:** nas respostas verificadas para `/`, `/app.js` e `/guacamole-common.js` não apareceram `X-Frame-Options` nem `Content-Security-Policy`.
- **Inferido:** essas respostas observadas não anunciam bloqueio explícito de frame por esses dois headers.
- **Pendente:** não foi executado teste de navegador com iframe; proxy, cabeçalhos em outros caminhos, política do browser, origem e HTTPS podem mudar o resultado.
- **Confirmado no código:** não há parâmetro ou rotina observada que leia o Host da URL e preencha o campo. Se portal e frontend tiverem origens diferentes, a política de mesma origem impede que o frontend altere o DOM do iframe.
- **Conclusão:** um iframe pode ser avaliado para exibição, mas não é uma solução comprovada para preencher o Host real usado na conexão. Não recomendável como mecanismo de prefill.

### Nova aba

- **Confirmado no código:** a página do portal existe em `/`; não foi encontrado deep link de sessão nem leitura de parâmetros de query/fragmento para definir Host.
- **Inferido:** abrir a página inicial em nova aba mostra o valor padrão, mas não preenche dinamicamente a porta consultada pelo frontend.
- **Conclusão:** não atende sozinho ao requisito de prefill. Não colocar Host, credenciais ou token na URL como alternativa.

### API/WebSocket ou reutilização do mecanismo atual

- **Confirmado no código (portal):** o cliente existente já faz `POST /api/token` e estabelece WebSocket Guacamole. Reaproveitar esse mecanismo evita duplicar a sessão RDP, mas o servidor e seu contrato ainda precisam ser disponibilizados e confirmados.
- **Confirmado no código (gateway local):** o gateway oferece emissão de token e WebSocket independentes, mas exige bearer secreto e fixa `ts.datacore.com.br`; não é um endpoint seguro para chamada direta por bundle do frontend e, como está, não alcança `ts-eqnx.datacore.com.br`.
- **Confirmado no código:** o backend principal não tem BFF/proxy para `POST /api/token` do portal nem para `POST /api/guacamole/token`.
- **Conclusão:** a arquitetura compatível é reutilizar a sessão já implementada, com uma chamada autenticada servidor-a-servidor ou integração de mesma origem. Antes de escolher entre o endpoint do portal e o gateway local, o responsável deve confirmar qual backend é o de produção e qual destino RDP ele autoriza.

### Recomendação baseada nas evidências

- **Recomendação:** o frontend deverá obter `porta_customizada` de `GET /host/:hostid/com-ip`, montar e exibir o Host como valor controlado e não editável `ts-eqnx.datacore.com.br:${porta_customizada}`, e então iniciar a sessão pelo mecanismo existente do portal/gateway somente através de um contrato de conexão confirmado e protegido.
- **Pendente antes de implementar:** obter o código/contrato de `POST /api/token`, confirmar se aceita destino e porta combinados, confirmar se o destino `ts-eqnx.datacore.com.br` é permitido, e resolver o transporte HTTP atual.
- **Pendente:** se o serviço escolhido for o gateway `server.js`, ele precisa suportar explicitamente o host pretendido e ter uma integração server-side autorizada; a implementação presente não aceita Host como entrada.

## 10. Restrições de rede, iframe, CORS e segurança

- **Confirmado por teste:** a URL privada `10.86.26.18` foi acessível do ambiente desta análise, mas isso não garante acesso pelo browser de cada usuário ou pelo ambiente de produção.
- **Inferido:** clientes fora da rede interna podem precisar de VPN ou rota de rede privada; isso deve ser validado na rede e no dispositivo do usuário.
- **Confirmado por teste:** as respostas consultadas não apresentaram `Access-Control-Allow-Origin`. Isso impede chamadas `fetch` cross-origin do frontend diretamente ao portal, salvo se origem/proxy/configuração forem diferentes. O `fetch` do portal para `api/token` é relativo e same-origin.
- **Confirmado no código:** o CORS do backend principal permite somente `FRONTEND_URL`, com credenciais, e aceita `GET`, `HEAD`, `POST`, `Authorization` e `Content-Type`.
- **Confirmado no código:** o gateway tem sua própria lista de origens `CORS_ORIGINS`/`FRONTEND_URL`; o upgrade WebSocket rejeita origem não autorizada quando o header `Origin` está presente.
- **Confirmado por teste:** as respostas consultadas não apresentaram CSP nem `X-Frame-Options`; isso não substitui teste real de iframe e não autoriza relaxar outras proteções.
- **Inferido:** por ser HTTP, a página não deve ser embutida em frontend HTTPS sem resolver mixed content. Um WebSocket `ws://` numa página HTTPS também pode ser bloqueado pelo navegador.
- **Pendente:** confirmar origem e protocolo HTTPS do frontend, URL pública do WebSocket, proxy reverso, VPN, regras de firewall e CORS efetivo do ambiente implantado.
- **Confirmado no código:** o Host do portal é editável e não tem allowlist visível no cliente. Se a política exigir destino fixo, a validação e autorização devem ocorrer no servidor, não apenas no campo do frontend.

## 11. Recomendação de integração baseada nas evidências

1. **Confirmado no código:** usar a rota já existente `GET /host/:hostid/com-ip` para obter `porta_customizada`, em vez de recalcular a porta no frontend.
2. **Recomendação:** validar no frontend que a resposta contém uma porta de 1 a 65535; tratar `404`, `401`, `403`, falhas de rede e valor `null` impedindo conexão.
3. **Recomendação:** construir `ts-eqnx.datacore.com.br:${porta_customizada}` somente como o valor do campo Host utilizado pelo formulário, visualmente não editável se esse destino for fixo. Não o mostrar apenas numa caixa informativa.
4. **Pendente:** confirmar se o backend do portal aceita esse texto em `hostname`. O cliente o envia inteiro sem parse, mas isso não revela o processamento do servidor.
5. **Recomendação:** reaproveitar um único fluxo de sessão já existente (Portal `api/token` ou gateway `server.js`), sem duplicar o cliente Guacamole nem abrir uma conexão RDP alternativa.
6. **Recomendação:** manter segredos de integração no servidor. Se a sessão utilizar o gateway local, chamar seu endpoint por uma camada server-side autenticada; nunca colocar `API_BEARER_TOKEN` no frontend.
7. **Pendente:** a implementação local do gateway fixa `ts.datacore.com.br`; confirme o destino autorizado antes de considerar esse gateway compatível com `ts-eqnx.datacore.com.br`.
8. **Recomendação de segurança:** usar HTTPS/WSS e garantir autorização server-side do host associado ao `hostid`/usuário antes de emitir token ou abrir WebSocket.

## 12. Informações que o frontend precisará enviar

### Para consultar o host

- **Confirmado no código:** `GET /host/:hostid/com-ip`; o `hostid` vai no caminho. A rota exige JWT `Bearer`. Se houver sessão Express autenticada, também valida a experiência `normal`/`secondary` e aplica filtro de escopo para `secondary`; sem essa sessão, o caminho JWT legado não aplica esse filtro de grupo.
- **Confirmado no código:** para sessão Express, o frontend precisa observar CORS com credenciais/cookie; a rota também exige o JWT lido do header `Authorization: Bearer ...`.
- **Confirmado no código:** a resposta inclui `hostid`, `nome`, `ip` e `porta_customizada`.

### Para iniciar a sessão

- **Confirmado no código (portal):** o cliente atual envia `hostname`, `username`, `password`, `width`, `height` para `POST /api/token`.
- **Pendente:** confirmar quais desses campos são obrigatórios no servidor e se o payload deve incluir Host completo ou `hostname` e `port` separados.
- **Confirmado no código (gateway separado):** o contrato atual de `POST /api/guacamole/token` é `username`, `password`, `port`, além de `Authorization` com segredo de servidor. Não inclui hostname. O frontend não deve receber nem enviar esse segredo.
- **Recomendação:** o frontend deve enviar credenciais somente pelo fluxo de autenticação aprovado, por HTTPS, sem persistir senha, token ou URL WebSocket em armazenamento local.

## 13. Informações que o portal retorna ao frontend

- **Confirmado no código (portal):** em resposta de sucesso a `api/token`, o JavaScript lê `sid`, `token` e `login` do objeto JSON retornado.
- **Pendente:** não é possível atestar se esses são todos os campos, seus tipos, validade ou semântica sem a implementação do endpoint.
- **Confirmado no código (portal):** o `sid` é usado em `POST /api/evento`; o `token` é usado para abrir o WebSocket; o valor `login` é passado à função `iniciar()`, mas não é usado no trecho de cliente analisado.
- **Confirmado no código (gateway separado):** a rota local retorna exatamente `{ token, websocketUrl }` no código. Este formato não deve ser atribuído ao endpoint `/api/token` do portal.
- **Confirmado no código (backend principal):** `GET /api/conectado` retorna `{ status: "conectado" }` apenas para disponibilidade; não retorna dados de sessão.

## 14. Tratamento de erros

- **Confirmado no código (portal):** erros HTTP no pedido de token são apresentados como `dados.erro` ou `Erro HTTP <status>`.
- **Confirmado no código (portal):** o cliente mapeia códigos Guacamole: `519/520` para falha de acesso ao servidor; `514/515` para autenticação; `521` para conflito de sessão; `522` para expiração por inatividade; `523` para sessão encerrada; `769/771` para acesso negado. Outros códigos mostram mensagem do cliente ou “Erro desconhecido”.
- **Confirmado no código (portal):** ao erro Guacamole, o navegador registra `erro.code` e `erro.message` no console e envia `sid`, tipo, código e mensagem para `api/evento`; falha nessa chamada é ignorada pelo cliente.
- **Pendente:** política de retenção, sanitização e controle de acesso do servidor de eventos não foi localizada.
- **Confirmado no código (gateway separado):** erros de validação de token retornam 400, falta/invalidade do bearer retorna 401, limite de tokens pendentes retorna 503, e falhas não tratadas retornam 500 sem expor o erro ao cliente.
- **Confirmado no código (health check):** `GET /api/conectado` retorna 502 para resposta remota inesperada/falha de rede, 504 em timeout, e 200 `{status:"conectado"}` somente para HTTP 200 com HTML. Seus testes usam respostas simuladas.

## 15. Riscos e pontos pendentes

| Tema | Estado | Risco/ação necessária |
|---|---|---|
| Servidor de `POST /api/token` | **Pendente** | Obter o código/contrato; não presumir aceitação ou parsing de `host:port`. |
| Destino RDP | **Pendente** | Portal e gateway local mostram `ts.datacore.com.br`; o requisito indica `ts-eqnx.datacore.com.br`. Confirmar destino aprovado e mecanismo que aplica a troca. |
| Credenciais em trânsito | **Confirmado por teste** | Portal publicado em HTTP; exigir HTTPS antes de enviar senhas. |
| TLS do WebSocket | **Pendente** | Confirmar `wss://` no ambiente frontend de produção. |
| Host editável | **Confirmado no código** | Cliente permite troca arbitrária do texto; exigir autorização/allowlist no servidor caso destino fixo seja uma regra. |
| Autenticação de `api/token` | **Pendente** | Não há código de servidor; confirmar autenticação, autorização, CSRF, limites e abuso. |
| Token em query do WebSocket | **Confirmado no código** | Tratar como segredo curto: não registrar nem persistir; confirmar expiração e uso único do backend do portal. |
| Porta nula/inválida | **Confirmado no código** | O endpoint de host pode retornar `porta_customizada: null`; validar e bloquear conexão. |
| CORS e conectividade dos usuários | **Pendente** | Resposta direta sem ACAO; validar origem real, VPN, firewall, DNS e proxy. |
| Incorporação iframe | **Inferido** | Headers observados não anunciam bloqueio, mas iframe não foi testado e não permite prefill cross-origin. |
| Gateway local ignora certificado RDP | **Confirmado no código** | `ignore-cert: true` e `security: 'any'`; confirmar política do serviço usado antes de reutilizá-lo. |
| Logs do portal | **Pendente** | O cliente envia mensagem de erro a `api/evento`; revisar retenção e garantir que senha/token não apareçam em logs. |
| Código versionado versus serviço publicado | **Pendente** | Confirmar que os artefatos consultados pertencem à versão implantada e obter versão/hash/release do portal. |

## 16. Checklist para a implementação futura

- [ ] Confirmar com o responsável pelo Portal RDP o repositório/versão de servidor que atende `10.86.26.18:8410`.
- [ ] Inspecionar o contrato e código do `POST /api/token`, incluindo autenticação, validação e resposta.
- [ ] Confirmar se `hostname: "ts-eqnx.datacore.com.br:33165"` é aceito e como o servidor converte Host/porta em parâmetros Guacamole/RDP.
- [ ] Confirmar se o destino fixo deve ser `ts-eqnx.datacore.com.br`; resolver a diferença em relação a `ts.datacore.com.br` usado pelo portal/gateway observado.
- [ ] Validar no backend principal, via `GET /host/:hostid/com-ip`, o host, seu escopo de autorização e a porta retornada; não confiar em `hostid`/porta arbitrários enviados pelo browser.
- [ ] Montar o Host exatamente no campo de conexão: `ts-eqnx.datacore.com.br:${porta_customizada}`; exibir o campo como somente leitura se destino arbitrário não for permitido.
- [ ] Validar porta presente, numérica e dentro da faixa; bloquear conexão se resposta ausente, `null` ou inválida.
- [ ] Reutilizar somente o mecanismo de sessão confirmado; não criar segunda implementação de Guacamole nem confundir `GET /api/conectado` com criação de sessão.
- [ ] Manter bearer/chaves exclusivamente no servidor; não expor `API_BEARER_TOKEN`, `GUAC_KEY` ou token de sessão em código, URL navegável, logs ou armazenamento persistente.
- [ ] Usar HTTPS para formulário/API e WSS para sessão em produção; validar CORS, cookies, VPN, proxy e conectividade do navegador.
- [ ] Testar erros de autorização, credenciais inválidas, porta inválida, host fora do escopo, falha/timeout de WebSocket, encerramento de sessão e cancelamento.
- [ ] Confirmar em teste de navegador se iframe é necessário; mesmo se permitido, não depender de acesso cross-origin ao DOM para preencher Host.
- [ ] Verificar que senha e token são removidos da interface/memória acessível após início ou falha da sessão e que não são gravados em logs.
- [ ] Executar teste controlado com usuário autorizado e destino aprovado, sem usar credenciais reais em logs ou documentação.

## Testes efetivamente executados nesta análise

- **Confirmado por teste:** requisição HTTP GET à página do portal: HTTP 200, `text/html`, HTML de login RDP.
- **Confirmado por teste:** GET ao JavaScript do portal e HEAD aos recursos verificados: HTTP 200.
- **Confirmado por teste:** foram observados os headers de resposta da página e recursos; sem `Content-Security-Policy`, `X-Frame-Options`, `Access-Control-Allow-Origin` ou `Set-Cookie` nas respostas consultadas.
- **Confirmado por teste:** foi executado `npm test -- --test-name-pattern="gateway autentica|GET local consulta"`; o processo encerrou com código 0. Os testes da aplicação exercitam o gateway e a rota de disponibilidade com serviço local/respostas simuladas; não iniciam sessão contra o RDP real.
- **Não executado:** envio de credenciais, POST real a `api/token`, conexão WebSocket real, teste de login RDP, teste de iframe em navegador ou verificação de CORS a partir da origem de produção.
- **Não executado:** consulta a host real no banco/Zabbix para verificar a porta `33165`.
