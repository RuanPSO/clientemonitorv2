# Fluxo de conexão remota com Guacamole Lite

Este documento descreve o gateway RDP atual, executado separadamente da API principal com `npm run start:guacamole`.

## Arquitetura atual

```text
Aplicação cliente
   │ POST /api/guacamole/token (Authorization: Bearer ...)
   ▼
server.js — Express + WebSocket, porta 8190
   │ token AES-256-CBC de uso único
   ▼
guacamole-lite ─── TCP/4822 ───► guacd ─── RDP ───► host permitido
```

`POST /api/guacamole/token` recebe `{ username, password, port }` e retorna `{ token, websocketUrl }`. O backend fixa `hostname` e `domain` em `ts.datacore.com.br`; o cliente não envia hostname nem domínio. O token contém a configuração RDP criptografada; credenciais são enviadas diretamente ao `guacd` pela camada `guacamole-lite`. Nenhum usuário ou conexão é criado pela REST API do Apache Guacamole.

Os endpoints `POST /api/files/upload`, `GET /api/files` e `GET /api/files/download/:filename` também exigem o bearer token estático configurado em `API_BEARER_TOKEN`. Uploads são gravados em `GUAC_DRIVE_PATH` (padrão `/var/lib/guacamole/drives`), que deve ser compartilhado com o `guacd` quando ele estiver em outro container ou host.

O upgrade WebSocket exige um token emitido pelo backend, não expirado nem já utilizado, e valida a origem quando o header `Origin` está presente. Os eventos `open` e `close` do `guacamole-lite` registram o início e o término das sessões sem registrar credenciais nem tokens. Tokens expiram em 60 segundos e só podem iniciar uma conexão.

### Configuração

| Variável | Uso |
| --- | --- |
| `GUAC_PORT` | Porta do Express e WebSocket (8190 por padrão). |
| `API_BEARER_TOKEN` | Segredo estático para proteger todas as rotas HTTP `/api/*`; mínimo 32 bytes. |
| `GUAC_KEY` | Chave UTF-8 de exatamente 32 bytes para AES-256-CBC. |
| `GUACD_HOST`, `GUACD_PORT` | Endereço e porta de `guacd` (padrão `127.0.0.1:4822`). |
| `GUAC_DRIVE_PATH` | Diretório de transferência (padrão `/var/lib/guacamole/drives`). |
| `GUAC_WS_PUBLIC_URL` | URL pública `ws://` ou `wss://` devolvida ao cliente. Use `wss://` em produção. |
| `CORS_ORIGINS` | Origens exatas separadas por vírgula; padrão `FRONTEND_URL` ou `http://localhost:5173`. |
| `GUAC_MAX_UPLOAD_BYTES` | Limite de upload em bytes (50 MiB por padrão). |

Inicie `guacd` antes do gateway. A API principal continua na porta configurada por `PORT` (3000 por padrão); o gateway independente usa `GUAC_PORT`.

## Verificação HTTP do serviço remoto

Na página pública do portal, o JavaScript observado envia `POST api/evento` com Bearer e o JSON `{ sid, tipo, codigo, mensagem }`. Esse envio reporta eventos associados a uma sessão e não fornece um contrato de health check nem uma resposta de sucesso que a API possa validar. O pacote `guacamole-lite` disponível neste projeto documenta um servidor WebSocket para o protocolo Guacamole, não uma API HTTP POST de verificação. Usar a página inicial ou o endpoint de eventos como health check presumiria comportamento não documentado e poderia gerar um evento sem sessão válida.

O endpoint `GET /api/conectado` consulta diretamente `GUACAMOLE_BASE_URL` (padrão `http://10.86.26.18:8410/`) com o timeout configurado em `GUACAMOLE_TIMEOUT_MS`. O portal não exige a autenticação anterior, portanto a requisição não envia bearer token nem cookie. A rota retorna conectado quando recebe HTTP 200 com conteúdo HTML; testes unitários usam respostas simuladas e não comprovam conectividade com a rede interna.

## Documentação histórica do fluxo legado (removido)

Este documento descreve o comportamento implementado pela API deste repositório. O objetivo é permitir a avaliação do percurso dos dados entre a aplicação, o backend e o Guacamole, inclusive deixando claros os limites do que está presente no código.

## Visão geral

```text
Frontend / navegador
       │
       │ GET /guacamole/hosts
       │ POST /guacamole/connect
       │ ou POST /guacamole/connect-full
       ▼
API Express
  routes/guacamole.routes.ts
       │
       ▼
GuacamoleService
  services/guacamole.service.ts
       │
       ▼
GuacamoleRepository ─── REST /api/... ───► Apache Guacamole
  repositories/guacamole.repository.ts     autentica, lista/cria
       │                                    conexões e usuários
       │ resposta { url, hostname, porta,
       │            connectionId, username }
       ▼
Frontend / navegador ───► URL do Guacamole ───► conexão RDP com o host
```

O backend prepara ou localiza uma conexão e retorna os dados necessários ao consumidor, principalmente `url`. A comunicação interativa da sessão remota acontece no Guacamole, acessado pelo navegador; a API deste repositório não transmite vídeo, teclado ou mouse.

**Limite do repositório:** não foi encontrado um cliente frontend nem código que abra a URL, crie um `iframe` ou use o cliente JavaScript do Guacamole. Portanto, este documento explica o contrato que o backend entrega, mas não presume como a aplicação consumidora exibe a sessão.

## Componentes

- [`routes/guacamole.routes.ts`](./routes/guacamole.routes.ts): define os endpoints HTTP, valida campos obrigatórios e aplica a verificação de host para sessões secundárias no fluxo completo.
- [`services/guacamole.service.ts`](./services/guacamole.service.ts): contém a orquestração de autenticação, usuário, conexão, permissão e geração da URL.
- [`repositories/guacamole.repository.ts`](./repositories/guacamole.repository.ts): chama a API REST do Guacamole para autenticação e operações de usuários/conexões.
- [`lib/guacamole-client.ts`](./lib/guacamole-client.ts): faz as chamadas `fetch`, com timeout e repetição em falhas de rede.
- [`utils/guacamole.ts`](./utils/guacamole.ts): valida host e porta, deriva o nome de usuário e monta a URL de sessão.
- [`index.ts`](./index.ts): monta as rotas `/guacamole/*` na aplicação Express.

## Fluxo recomendado: `POST /guacamole/connect-full`

Este é o caminho que reúne a preparação de usuário/permissão com a emissão de uma URL para o navegador.

### 1. Solicitação do frontend

O frontend envia JSON para a API:

```http
POST /guacamole/connect-full
Content-Type: application/json

{
  "hostname": "servidor-exemplo",
  "porta": 3389,
  "email": "usuario@exemplo.com"
}
```

Os três campos são obrigatórios. A rota verifica que `hostname` e `email` não estejam vazios e que `porta` tenha sido enviada. A validação de formato do host, faixa da porta e e-mail ocorre depois, no serviço. A porta precisa ser um inteiro entre 1 e 65535; o hostname aceita letras, números, ponto, hífen e sublinhado, com até 128 caracteres. O usuário é derivado da parte anterior ao `@`, removendo espaços externos e convertendo para minúsculas. Não é o endereço de e-mail completo que vira o nome de usuário Guacamole.

### 2. Restrição para sessão `secondary`

Se a sessão Express da solicitação tiver `experience === 'secondary'`, a rota:

1. resolve os grupos de hosts permitidos registrados na sessão;
2. consulta o Zabbix para confirmar que o hostname pertence a esses grupos;
3. responde `404` com `Host não encontrado` se não houver grupo permitido ou se o host não pertencer a eles;
4. só então chama o serviço Guacamole.

Essa verificação está condicionada à sessão ser reconhecida como `secondary`. As rotas Guacamole não instalam por si mesmas um middleware de autenticação obrigatório. Assim, a ausência de uma sessão `secondary` não equivale a uma negação automática: o fluxo continua sem essa verificação. Ver também a documentação OpenAPI em [`routes/docs.openapi.ts`](./routes/docs.openapi.ts).

### 3. Preparação no Guacamole

O serviço executa as operações abaixo em sequência:

1. valida hostname, porta e e-mail;
2. autentica a conta administrativa na API do Guacamole (`POST /api/tokens`) com as credenciais do servidor;
3. garante a existência do usuário derivado do e-mail;
4. redefine a senha desse usuário para a senha temporária configurada, inclusive quando ele já existia;
5. procura uma conexão existente cujo **nome** corresponda ao hostname, sem diferenciar maiúsculas/minúsculas;
6. se não encontrar, solicita a criação de uma conexão RDP;
7. concede ao usuário a permissão `READ` para a conexão;
8. autentica o usuário Guacamole com o nome derivado e a senha temporária;
9. usa o token do usuário autenticado para montar a URL.

Uma resposta HTTP `409` ao conceder permissão é aceita pelo repositório como resultado não fatal, assim como sucesso ou `204`. As demais respostas não exitosas das operações relevantes geram erro e são propagadas à rota.

### 4. Resposta que o backend envia ao frontend

Em caso de sucesso, o endpoint retorna um objeto deste formato:

```json
{
  "url": "https://guacamole.exemplo/#/client/<CLIENTE_CODIFICADO>?token=<TOKEN_DO_USUARIO>",
  "hostname": "servidor-exemplo",
  "porta": "3389",
  "connectionId": "<ID_DA_CONEXAO>",
  "username": "usuario"
}
```

- `url`: URL pública do Guacamole com o cliente/identificador codificado e o token de autenticação do usuário.
- `hostname` e `porta`: valores recebidos pela API (a porta é serializada como string).
- `connectionId`: identificador da conexão no Guacamole.
- `username`: nome derivado do e-mail.

O identificador codificado é Base64 URL-safe do texto `connectionId`, seguido dos separadores nulos e dos componentes `c` e `dataSource`. A URL final é formada como `GUAC_PUBLIC_URL/#/client/<identificador>?token=<authToken>`.

O frontend deve tratar `url` como dado sensível: contém um token de sessão na query string. O token não deve ser registrado em logs, analytics ou mensagens de erro. A decisão de abrir a URL em nova aba, navegar para ela ou incorporá-la precisa ser feita pelo cliente frontend, que não está implementado neste repositório.

## Outros endpoints

| Endpoint | Comportamento |
|---|---|
| `GET /guacamole/hosts` | Lista conexões disponíveis com `connectionId`, nome, protocolo, hostname e porta. O resultado é cacheado por 60 segundos no backend. |
| `POST /guacamole/connect` | Recebe `{ "connectionId": "..." }`, localiza a conexão e retorna o mesmo formato geral de resposta. Neste caminho, a API usa o token administrativo para montar a URL; não cria usuário nem concede permissão individual. |
| `GET /guacamole/debug/:connectionId` | Retorna os dados completos da conexão, incluindo parâmetros. É uma rota de depuração, não deve ser exposta a usuários comuns. |
| `POST /guacamole/fix-domain/:connectionId` | Define o parâmetro `domain` como string vazia e invalida o cache de hosts. |
| `POST /guacamole/fix-target/:connectionId` | Atualiza hostname, porta e opções RDP (`ignore-cert`, `security`, `domain`) e invalida o cache. Requer hostname; a porta padrão é 3389. |

As rotas de manutenção modificam conexões do servidor e devem ser tratadas como operações administrativas. Os endpoints `/guacamole/hosts`, `/guacamole/connect` e `/guacamole/connect-full` também não aplicam middleware de autenticação geral no código atual; o teste de escopo de host é apenas a condição descrita para sessões `secondary`.

## Configuração e comunicação com o Guacamole

O backend exige estas variáveis no ambiente:

| Variável | Uso |
|---|---|
| `GUAC_PUBLIC_URL` | Base usada tanto nas chamadas REST do backend quanto na URL entregue ao navegador; precisa ser alcançável pelo servidor e pelo cliente conforme o ambiente. |
| `GUAC_ADMIN_USER` | Usuário administrativo usado nas chamadas de gerenciamento. |
| `GUAC_ADMIN_PASSWORD` | Senha administrativa; deve permanecer somente no ambiente do backend. |
| `GUAC_TEMP_PASSWORD` | Senha temporária comum usada para criar/redefinir usuários e autenticá-los para obter o token de sessão. Deve permanecer somente no backend. |
| `GUAC_TIMEOUT_MS` | Timeout de chamada REST; padrão de 5000 ms. |
| `GUAC_RETRY` | Número de tentativas adicionais após falha de rede; padrão de 2, com espera exponencial. |

As quatro primeiras variáveis são verificadas durante a inicialização dos módulos do Guacamole. A API do Guacamole usa `POST /api/tokens` para autenticar e endpoints `/api/session/data/<dataSource>/...` para consultar e alterar dados. As credenciais administrativas e temporárias não são incluídas intencionalmente no JSON de resposta do fluxo completo; o token do usuário, por outro lado, está embutido em `url`.

## Observação importante sobre o destino RDP

Há uma diferença entre o hostname informado e o destino atualmente usado quando o serviço precisa **criar** uma conexão nova:

- o hostname informado é usado como nome da conexão e retornado em `hostname`;
- em [`repositories/guacamole.repository.ts`](./repositories/guacamole.repository.ts), `criarConexaoRdp` configura o parâmetro de destino `hostname` com o valor fixo `ts.datacore.com.br`, em vez de usar o hostname recebido;
- a porta configurada continua sendo a porta recebida.

Consequentemente, a resposta de sucesso pode apresentar o hostname solicitado mesmo quando uma conexão recém-criada aponta para outro destino. Conexões já existentes são localizadas pelo nome e preservam os parâmetros que já estejam configurados. A rota `fix-target` pode alterar manualmente o destino, mas não corrige automaticamente a criação normal. Esse comportamento deve ser avaliado antes de considerar confiável a associação entre host selecionado e máquina remota.

## Erros esperados

- `400`: campo obrigatório ausente na solicitação.
- `404`: host fora dos grupos permitidos quando a sessão é `secondary`.
- `500`: falha ao autenticar, consultar ou alterar o Guacamole, hostname/porta/e-mail inválidos no serviço, conexão inexistente no fluxo por `connectionId` ou outro erro interno. As rotas registram o erro no console e enviam `{ "erro": "<mensagem>" }`.

No fluxo completo, o `404` de host fora do escopo não chama o serviço Guacamole. Os testes de rotas secundárias cobrem essa distinção em [`tests/secondary-scope-routes.test.ts`](./tests/secondary-scope-routes.test.ts).

## Pontos para avaliação

1. **Autorização:** definir autenticação/autorização obrigatória também para listagem, conexão direta e rotas de manutenção; não depender somente de um atributo opcional da sessão.
2. **Escopo de hosts:** verificar se a restrição deve valer para todos os usuários e todos os modos de login, não apenas quando `experience` é `secondary`.
3. **Token na URL:** avaliar exposição por histórico, logs e cabeçalho `Referer`; restringir a origem de acesso e o tempo de vida conforme a configuração do Guacamole.
4. **Senha compartilhada:** a senha temporária única, redefinida a cada conexão, permite que usuários Guacamole compartilhem a mesma credencial. Avaliar credencial individual ou autenticação delegada.
5. **Destino RDP:** substituir/validar o hostname fixo usado na criação e garantir que o host permitido pelo Zabbix seja o mesmo destino alcançado no Guacamole.
6. **Resposta e falhas:** distinguir conexão inexistente (`404`) de erro inesperado (`500`) e evitar devolver mensagens internas detalhadas para clientes externos.
7. **Observabilidade:** não registrar tokens ou credenciais; revisar a exposição dos dados retornados pelo endpoint `debug`.
