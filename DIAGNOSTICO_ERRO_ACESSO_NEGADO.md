# Diagnóstico: “Acesso negado para esta experiência”

## Resumo executivo

A causa raiz foi confirmada: a tela “Grupos de Hosts” e a GlobalSearch chamavam `GET /grupos/com-hosts`, então restrita a `normal` em `routes/grupo.routes.ts:85` antes da correção. O middleware que gerou exatamente a mensagem observada é `requireExperience`, em `middlewares/experience.middleware.ts:18`; a rota agora está em `routes/grupo.routes.ts:90` e aplica o filtro secondary.

Na execução local, `GET /api/grupos/com-hosts` respondeu `403` com `Acesso negado para esta experiência`. A experiência da sessão em `/auth/me` era `secondary`. A verificação da experiência ocorre antes da validação JWT e antes da consulta do handler. Também são chamadas por HostGroup outras rotas ainda restritas a `normal`: `GET /grupo/:chave/hosts-full` e `GET /hosts/status-ping-uptime`.

O `/auth/me` observado retornou `user.companyName: "SPS BH"` (sem `scope`), não `"SPS Minas"` como inicialmente esperado. O usuário confirmou que `SPS BH` é um alias oficial para `SPS_BH`, e a configuração foi atualizada. A mensagem original vinha da política da rota, não da divergência de nome. O login precisa ser renovado para que a sessão receba o novo escopo.

Não foi possível confirmar os nomes reais dos grupos na instância Zabbix; nenhuma consulta a uma instância foi realizada.

**Confiança:** alta para a chamada específica, o middleware e o status/mensagem observados localmente.

## A1 — Análise estática

### Origem da mensagem

| Mensagem | Origem identificada | Efeito |
| --- | --- | --- |
| `Acesso negado para esta experiência` | Backend: `middlewares/experience.middleware.ts:18`, dentro de `requireExperience`. | `403` quando existe conta na sessão e a experiência persistida não está entre as experiências exigidas pela rota. |
| `Autenticação e classificação de experiência necessárias` | Backend: `middlewares/experience.middleware.ts:13-14`. | `401` quando a sessão não tem conta Entra ou não tem classificação. |
| `Grupo fora do escopo da empresa` | Backend: `routes/grupo.routes.ts:45,51`. | `403` quando uma sessão `secondary` pede um grupo que não pertence ao seu escopo. É mensagem diferente da observada. |
| Erro exibido na página | O frontend apresenta o campo `error` da resposta HTTP; o literal não é gerado por uma regra local de Hosts/GlobalSearch. | A resposta 403 observada contém a mesma mensagem do middleware backend. |

O literal está no middleware backend; a UI o recebe pela camada HTTP.

### Inventário de endpoints das telas

O frontend está no checkout irmão `..\datacore`. O `API_BASE_URL` padrão é `/api`; o proxy local do Vite remove esse prefixo ao encaminhar para o backend em `localhost:3000`. `SecondaryHosts` e `SecondaryHostGroup` reutilizam as páginas `Hosts` e `HostGroup`; o layout secundário também reutiliza a GlobalSearch.

| Tela/uso | Método e rota backend | Middleware e ordem efetiva | Política para `secondary` |
| --- | --- | --- | --- |
| Inicialização/autenticação | `GET /auth/me` (`/auth/me` no router montado em `/auth`) | `requireMicrosoftAccount`; exige a sessão Entra, não JWT. | Compartilhada. A resposta inclui `experience` da sessão; não inclui `scope`. |
| Obtenção do JWT legado pelo cliente | `POST /auth/token` | Sem middleware de autenticação na rota. | Não classifica experiência. Em chamadas de dados, o JWT é validado conforme o middleware daquela rota. |
| Hosts e Grupos de Hosts (`src/pages/Hosts.jsx`) | `GET /api/grupos/com-hosts` → `GET /grupos/com-hosts` | Antes: `requireExperienceOrLegacyJwt('normal')`. Agora: `requireExperienceOrLegacyJwt(['normal','secondary'])`. | Antes: 403 observado. Agora: secondary recebe somente grupos e hosts dos IDs de grupo permitidos; normal mantém consulta/payload integral. |
| GlobalSearch (`src/components/GlobalSearch.jsx`) | `GET /api/grupos/com-hosts` → `GET /grupos/com-hosts` | Igual à rota acima. | Mesmo escopo de empresa; o frontend não foi alterado. |
| HostGroup — grupo (`src/pages/HostGroup.jsx`) | `GET /api/grupo/:grupo` → `GET /grupo/:chave` | `requireExperienceOrLegacyJwt(['normal','secondary'])`. | Secondary só consulta grupo permitido; grupo fora do escopo recebe `403` antes da busca de hosts. |
| HostGroup — hosts completos (`src/pages/HostGroup.jsx`) | `GET /api/grupo/:grupo/hosts-full` → `GET /grupo/:chave/hosts-full` | Agora `requireExperienceOrLegacyJwt(['normal','secondary'])`; valida grupo no handler antes de `getHostsFullDoGrupo`. | Grupo fora do escopo ou escopo ausente: 403; sem consulta dos hosts. Normal mantém fluxo atual. |
| HostGroup — status em lote (`src/hooks/useBulkHosts.js`) | `GET /api/hosts/status-ping-uptime` → mesma rota backend | Agora `requireExperienceOrLegacyJwt(['normal','secondary'])`. | Secondary filtra IDs de hosts pelos grupos permitidos antes de serializar; normal mantém resposta integral. |
| HostCard — métricas/fallback (`src/components/HostCard.jsx`) | `GET /api/host/:hostid/metrics`, `GET /api/host/:hostid/basico` | Agora aceitam normal/secondary; secondary valida associação do host a pelo menos um grupo permitido. | Host fora do escopo/escopo vazio: 404, sem buscar detalhes. |
| HostModal — detalhes sob demanda (`src/components/HostModal.jsx`) | `GET /api/host/:hostid/active-services`, `GET /api/host/:hostid/services` | Agora aceitam normal/secondary; secondary valida associação do host. | Host fora do escopo/escopo vazio: 404, sem consultar serviços. |
| HostGroup — conectar a host | `GET /api/host/:hostid/com-ip`, `POST /api/guacamole/connect-full` | `com-ip` aceita normal/secondary e valida associação do host; Guacamole mantém política pública legada e, quando sessão secondary está presente, valida o hostname por grupo permitido. | Dados/ação secondary limitados ao host permitido. Caminho JWT sem sessão em Guacamole não foi alterado. |
| Layout compartilhado | `GET /api/auth/me`, `POST /api/auth/token`, `GET /api/auth/photo` | `/auth/me` exige sessão Entra; `/auth/token` não tem middleware; `/auth/photo` não existe no backend atual. | `/auth/me` e token são compartilhados. `/auth/photo` retornou 404 local e não explica o 403. |
| Outras rotas não usadas por estas telas | `GET /hosts/com-ip-e-so`, `GET /host/:hostid/details`, `/problemas` e relatórios | Continuam restritas a `normal`. | Não foram liberadas para secondary. |
| Dashboard normal — incidentes/contagens | `GET /incidentes/ativos`, `/incidentes/hosts-totais`, `/incidentes/problemas-24h`, `/incidentes/dashboard` | Rotas protegidas pela política de experiência normal. | Continuam restritas a normal; testes preservam 403 para secondary. |

`GET /grupos` e `GET /hosts/com-ip-e-so` não foram encontrados nas chamadas das telas. `GET /hosts/com-ip` também não é chamado pelo fluxo atual de Hosts/HostGroup, embora já seja filtrado para secondary. A captura inicial identificou `/auth/me`, `/auth/token`, `/auth/photo` e `/grupos/com-hosts`; os erros foram 404 e 403, respectivamente.

### JWT, sessão, ordem e cookies

O frontend usa `credentials: "include"` e anexa JWT `Authorization` nas requisições que não são excluídas (`src/services/http.js`). A captura não leu nem registrou headers. O `/auth/me` respondeu 200 na sessão de navegador e as chamadas protegidas chegam à aplicação pela origem local.

No backend, `requireExperienceOrLegacyJwt` (`middlewares/experience.middleware.ts:24-34`) toma esta decisão:

1. Se `req.session.account` existe, executa `requireExperience` primeiro e `validarToken` depois. Assim, numa rota `normal` chamada por uma sessão `secondary`, retorna o `403` observado **antes** de validar o JWT.
2. Se não existe `req.session.account`, ignora a classificação e usa o JWT legado. Esse caminho é um bypass preexistente de experiência, não a mensagem observada.
3. `GET /auth/me` valida a sessão Entra por `requireMicrosoftAccount`; `POST /auth/token` não tem middleware na própria rota.

O CORS configurado pelo backend permite credentials (`config/cors.ts`) e a sessão usa `SameSite=Lax` por padrão (`config/session.ts`). O `/auth/me` 200 com `experience: secondary` e o 403 específico de experiência indicam que a classificação da sessão chegou à rota. Não foram lidos headers.

### Escopo e identidade observada

- `config/company-host-groups.json` mapeia `SPS Minas` e, por decisão confirmada pelo usuário, o alias `SPS BH` para `SPS_BH`; `SPS CWB` continua mapeado para `SPS_CURITIBA`.
- `config/company-host-groups.ts:26-34` aplica `trim`, lowercase, decomposição Unicode, remoção de diacríticos e colapso de espaços internos. Para `SPS CWB`, o resultado é `sps cwb`; espaços extras também são colapsados.
- A comparação do mapeamento é exata após normalização (`config/company-host-groups.ts:103-123`), não por substring.
- O callback (`routes/entra-auth.routes.ts:137-160`) decide `experience` com a allow-list existente, calcula o mapeamento somente para `secondary` e grava `experience` e `allowedHostGroups` na sessão regenerada.
- O `companyName` que aparece em `/auth/me` vem do perfil Graph normalizado; `experience` vem da sessão e `scope` não é incluído (`routes/entra-auth.routes.ts:197-225`).
- Na sessão assistida, `/auth/me` retornou `companyName: "SPS BH"` e não apresentou `scope`. O usuário confirmou que esse nome deve ser um alias explícito para `SPS_BH`; o JSON foi atualizado. A sessão já aberta continua com o escopo salvo no login anterior, então é necessário novo logout/login manual para testar a configuração atualizada.

### Sessões anteriores e grupos Zabbix

- Sessão antiga com `account`, mas sem `experience`: `401` e mensagem “Autenticação e classificação de experiência necessárias”; não gera o `403` exato.
- Sessão `secondary` sem `allowedHostGroups`: listas agregadas retornam vazias; busca de grupo/host por chave retorna 403/404 sem consultar hosts/detalhes. Não gera “Acesso negado para esta experiência”.
- O código consulta nomes de grupo da tabela Zabbix `hstgrp`; o filtro aceita igualdade após `trim` ou subgrupo prefixado por `NOME/`. A configuração esperada contém o nome exato `SPS_CURITIBA`.
- Não há acesso/dados de uma instância Zabbix neste checkout para verificar se o nome real é exatamente `SPS_CURITIBA` ou se há nomes hierárquicos. Nenhuma consulta Zabbix foi feita neste diagnóstico.

## A2 — Verificação assistida em tempo de execução

- Antes da correção, o navegador integrado abriu a SPA local em `http://localhost:5173`; “Grupos de Hosts” mostrou o erro.
- Captura sanitizada anterior à correção: `GET /auth/me` → 200, `experience: secondary`, `user.companyName: SPS BH`, sem `scope`; `POST /auth/token` → 200; `GET /auth/photo` → 404; `GET /grupos/com-hosts` → 403, `error: Acesso negado para esta experiência`. A chamada também foi observada na GlobalSearch.
- O perfil não corresponde ao `SPS Minas` solicitado. Não foram registrados tokens, cookies, JWT, headers, códigos OAuth/MFA ou payload integral.
- Serviços locais: o frontend respondeu em `http://localhost:5173`; backend local respondeu `/health` com 200. Nenhuma chamada ao Zabbix real ou a produção foi realizada.
- **Validação funcional pós-correção:** o usuário informou que atualizou novamente a filial e validou a alteração e a exibição dos dados. A ferramenta ainda tinha capturado `SPS RJ` imediatamente antes dessa confirmação; não foi feita nova captura sanitizada independente depois dela.

### Ajustes sugeridos no frontend

Nenhum ajuste é necessário para a listagem/escopo: Hosts, HostGroup e GlobalSearch já reutilizam os contratos que foram filtrados no backend, e HostGroup já trata respostas 403/404. Como melhoria opcional, a tela Hosts pode mostrar um estado vazio explícito para empresa sem grupos. O fluxo “Conectar” tem uma incompatibilidade preexistente a revisar separadamente: `HostGroup.jsx` envia `hostname`, `ip` e `port`, enquanto `POST /guacamole/connect-full` exige `hostname`, `porta` e `email`; não foi alterado nem validado esse fluxo.

### Registro da validação assistida

A fonte local não produtiva foi confirmada pelo usuário. A validação final de exibição também foi reportada pelo usuário após atualizar a filial. O status/rotas da nova sessão não foram registrados independentemente, pois a aba integrada ainda apresentava a sessão anterior quando a ferramenta fez sua última leitura.

## A3 — Hipóteses

| Hipótese | Status | Evidência |
| --- | --- | --- |
| H1. Algum endpoint usado pela tela ainda exige `normal`. | **Confirmada e corrigida.** | `GET /grupos/com-hosts` foi observado com 403 e mensagem exata; antes da correção `routes/grupo.routes.ts:85` limitava a rota a `normal`. |
| H2. Sessão antiga sem `experience`/escopo está sendo negada. | **Descartada como causa da mensagem exata; estado atual pendente.** | Conta em sessão sem `experience` retorna `401` com mensagem diferente. Sessão `secondary` sem `allowedHostGroups` resulta em listas vazias nas rotas liberadas. |
| H3. `companyName`/grupo não bate após normalização e o backend nega por experiência. | **Identidade divergente confirmada; causa da mensagem descartada; alias aplicado.** | `/auth/me` retornou `SPS BH`; o usuário aprovou o alias explícito `SPS BH` → `SPS_BH`. A mensagem original vinha da política da rota, não do resolvedor de escopo. |
| H4. Cookie de sessão não chega por CORS/credentials/SameSite. | **Descartada para a resposta observada.** | `/auth/me` retornou `secondary` e `/grupos/com-hosts` retornou o 403 que só ocorre quando `req.session.account` existe e a experiência não é permitida. |
| H5. Conflito entre JWT e sessão. | **Descartada como causa direta mais provável.** | Com sessão presente, o middleware verifica experiência antes do JWT. A rota `normal` bloqueia `secondary` antes de validar JWT; isso explica a mensagem sem conflito de tokens. Falha JWT após experiência permitida tem resposta diferente. |
| H6. Grupo Zabbix hierárquico ou com nome diferente. | **Inconclusiva quanto aos dados; descartada como causa da mensagem exata.** | A instância não foi consultada. Um nome não correspondente resulta em lista vazia ou erro de escopo, não na mensagem do middleware de experiência. |
| H7. Tela chama endpoint agregado ainda não liberado para secondary. | **Confirmada e corrigida.** | `GET /grupos/com-hosts` foi a chamada exata do 403; as outras rotas secundárias identificadas foram liberadas somente com filtro por grupo/host. |

## Fase B — correção aplicada

Após a confirmação explícita do usuário de que `SPS BH` é alias de `SPS_BH`, foram ajustados os endpoints utilizados pelas telas secundárias. O callback, cálculo de `experience`, middleware compartilhado, JWT/login/logout, allow-list e frontend não foram alterados.

- `GET /grupos/com-hosts`: secondary recebe somente grupos permitidos e hosts associados a eles; a consulta de hosts usa somente os IDs permitidos.
- `GET /grupo/:chave/hosts-full`: a chave é verificada antes de buscar detalhes; grupo fora do escopo retorna `403` com `Grupo fora do escopo da empresa`.
- `GET /hosts/status-ping-uptime`: retorna somente host IDs associados aos grupos permitidos; filtra antes da serialização. Normal mantém chamada/resposta original.
- Endpoints por host chamados pelo HostCard/HostModal (`/metrics`, `/basico`, `/services`, `/active-services`, `/com-ip`): secondary só acessa host pertencente a algum grupo permitido; caso contrário recebe `404`.
- `POST /guacamole/connect-full`: com sessão secondary, confere hostname e grupo antes de executar a conexão; o caminho sem sessão/JWT legado não foi alterado.
- Escopo vazio/ausente: listagens vazias e recursos por chave/host negados sem buscar detalhes.
- Incidentes, totais, problemas e outros endpoints não usados por essas telas continuam restritos a normal.

**Impacto esperado em `normal`: nenhum.** Os caminhos normais mantêm suas consultas e payloads; o JWT legado sem sessão mantém seu comportamento. Riscos pendentes: nomes reais/renomeações/hierarquia Zabbix ainda não foram verificados em fonte não produtiva; hosts em múltiplos grupos; bypass JWT legado; rotas Guacamole fora de uma política geral de experiência; a validação final foi confirmada pelo usuário, mas não houve captura sanitizada independente após a troca da filial.

### Arquivos e validação da correção

- Rotas/filtro: `routes/grupo.routes.ts`, `routes/host.routes.ts`, `routes/guacamole.routes.ts`, `routes/_company-scope.ts`.
- Consulta por grupo/host: `repositories/host.repository.ts`, `services/zabbix.service.ts`.
- Mapeamento e documentação: `config/company-host-groups.json`, `routes/docs.openapi.ts`, `IMPLEMENTACAO_BACKEND_LOGIN_DUPLO.md`.
- Testes com mocks: `tests/secondary-scope-routes.test.ts`, `tests/experience-routes.test.ts`, `tests/company-host-groups.test.ts`.
- `npm run typecheck` — aprovado. `npm test` — 53 aprovados, 0 falhas. `git diff --check` — aprovado (com avisos de normalização CRLF em arquivos preexistentes).
- Os testes automatizados usam mocks; nenhuma chamada real ao Zabbix foi feita por esta implementação. O usuário confirmou a validação manual pós-correção; a última leitura automatizada anterior à confirmação ainda mostrava outra filial, então não se registrou novo payload/status de rede.
