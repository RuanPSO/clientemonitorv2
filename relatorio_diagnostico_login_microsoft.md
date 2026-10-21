# Relatório de diagnóstico do login Microsoft e autorização por filial

## 6.1. Identificação do projeto

- **Data da análise:** 16/10/2026.
- **Escopo:** leitura do backend, configuração Microsoft/Graph, autenticação, rotas de grupos e hosts, cache, testes existentes e superfície de frontend presente neste repositório. Nenhum código funcional foi alterado.
- **Backend:** Node.js, TypeScript, Express 5, MSAL Node, `express-session`, Prisma 7 e PostgreSQL. Há dois clientes Prisma: um para dados do Zabbix e outro para os dados do portal.
- **Frontend:** este repositório é o backend. O `README.md` declara que não contém o frontend React; aqui existe somente a interface estática de documentação da API em `public/docs/` (HTML/CSS/JavaScript).
- **Estrutura relevante:** `config/` (MSAL, sessão e ambiente), `routes/`, `middlewares/`, `services/`, `repositories/`, `mappers/`, `lib/` e `tests/`.
- **Limitação de execução:** não foi realizada autenticação interativa nem consulta a um tenant Microsoft. Não foi usado nem exposto conteúdo de `.env`, tokens, cookies, segredos ou credenciais. Os testes executados usam sessões, contas e respostas Graph simuladas.
- **Local do relatório:** raiz do repositório, ao lado do `README.md`. Não há diretório de documentação de engenharia; `public/docs/` contém os recursos servidos pela interface pública da documentação da API, então não foi usado para este relatório interno de diagnóstico.

## 6.2. Fluxo atual de autenticação

### Tecnologias e etapas

1. `index.ts` instala `express-session` antes das rotas, com cookie `clientemonitor.sid`. O armazenamento configurado é o `MemoryStore` padrão; o próprio startup alerta que ele não é adequado a produção escalada.
2. `GET /auth/login`, em `routes/entra-auth.routes.ts`, gera um `state` aleatório, guarda-o na sessão e redireciona ao Entra ID.
3. `config/msal.ts` cria `ConfidentialClientApplication` com client ID, client secret e tenant do ambiente. O fluxo de código de autorização solicita `SCOPES` e usa o callback configurado.
4. `GET /auth/callback` valida `state` em tempo constante, troca o código por tokens via MSAL, exige uma conta retornada, regenera a sessão e guarda `account` e o cache serializado do MSAL. Em seguida, redireciona para `/dashboard` no frontend.
5. `GET /auth/silent` e `GET /auth/me` exigem que `req.session.account` exista (`requireMicrosoftAccount`). `/auth/me` adquire silenciosamente um access token e consulta em paralelo o perfil e os grupos no Graph.
6. `GET /auth/logout` destrói a sessão local e redireciona para o logout do Entra ID.

### Origem e transporte das informações

- A conta (`AccountInfo`) é resultado da troca do código pelo MSAL e fica na sessão.
- O cache serializado de tokens do MSAL também é guardado na sessão via cache plugin. O access token é usado pelo backend no header de autorização das chamadas ao Graph; não é devolvido como campo da resposta de `/auth/me`.
- O perfil não é extraído de claims do ID token: os campos usados vêm de `GET https://graph.microsoft.com/v1.0/me`, chamado por `services/graph.ts`. `/me/memberOf` fornece os grupos. A identidade da sessão não é escolhida por e-mail enviado pelo cliente.
- `mappers/userMapper.ts` normaliza o perfil, usando `mail` ou `userPrincipalName` para o e-mail e `account.tenantId` como fallback do tenant. O restante da aplicação não recebe automaticamente o objeto de sessão: a rota `/auth/me` entrega JSON ao cliente.
- A resposta atual de `/auth/me` é `{ user, groups, clientIp, source: "graph" }`. `user` inclui `companyName` e `jobTitle`, mas também outros dados selecionados e o perfil bruto em `raw`.
- O código de `/auth/me` executa as consultas de perfil e grupos com `Promise.all`. Se qualquer uma falhar, a rota não retorna o perfil; falhas Graph com status conhecido são devolvidas com esse status.

### Escopos

`config/msal.ts` define `User.Read`, `GroupMember.Read.All` e `AuditLog.Read.All`. O README documenta essas permissões como delegadas e alerta que as duas últimas podem requerer consentimento administrativo conforme a política do tenant.

- `User.Read` é o escopo usado pelo fluxo para consultar o próprio perfil.
- `GroupMember.Read.All` está relacionado à consulta de `/me/memberOf`.
- `AuditLog.Read.All` está configurado, mas não foi encontrado uso nas chamadas Graph examinadas.
- A configuração no código não prova que o consentimento foi concedido no tenant, nem que o perfil do usuário contém valores preenchidos.

## 6.3. Resultado da verificação dos atributos

| Atributo | Resultado | Origem identificada | Evidência ou pendência |
|---|---|---|---|
| `jobTitle` | **Não verificado em execução. Confirmado no código como solicitado e mapeado.** | Microsoft Graph `GET /me`, campo selecionado no Graph e copiado pelo mapper | `services/graph.ts:48-55`; `mappers/userMapper.ts:5-6, 23-24`. Nenhum teste com tenant retornou um valor real. |
| `companyName` | **Não verificado em execução. Confirmado no código como solicitado e mapeado.** | Microsoft Graph `GET /me`, campo selecionado no Graph e copiado pelo mapper | `services/graph.ts:48-55`; `mappers/userMapper.ts:5-6, 23-24`. Um teste automatizado simulado retornou `"Example Co"`, mas isso não confirma o tenant. |

O mapper converte ausência (`undefined`/`null`) em string vazia; assim, o JSON normalizado atual não diferencia ausência de campo, valor nulo e string vazia. O `raw` na resposta permite inspecionar o payload recebido, mas carrega outros dados do perfil e não é um formato mínimo de diagnóstico. O relatório não classifica esses atributos como “ausentes”, pois nenhum teste real demonstrou essa condição.

## 6.4. Resultados dos testes

### Procedimento executado

Foi executado:

```text
node --import tsx --test tests\graph.test.ts tests\entra-routes.test.ts tests\entra-auth.test.ts
```

**Resultado: 11 testes aprovados, 0 falhas.** Os testes usam adaptadores HTTP, sessão, conta, tokens e respostas Graph simulados; não acessam Microsoft nem um tenant real.

### Observações dos testes

- `tests/entra-routes.test.ts` simula login/callback e verifica que `/auth/me` autenticado responde HTTP 200 e mapeia `companyName: "Example Co"`. Essa fixture omite `jobTitle`, que aparece como string vazia pelo fallback do mapper; isto é somente o resultado da fixture, não evidência de que o campo esteja ausente no tenant.
- O mesmo arquivo verifica `/auth/me` sem sessão com HTTP 401 e um erro Graph simulado com HTTP 403.
- `tests/graph.test.ts` verifica timeout, paginação de grupos e que a seleção Graph inclui `companyName`; não há uma consulta real nem assertiva específica de valor retornado para `jobTitle`.
- `tests/entra-auth.test.ts` verifica os escopos configurados, cache MSAL associado à sessão e fallback de normalização. São testes unitários, não validações de permissões no tenant.
- Não foi executado procedimento no navegador ou ferramenta HTTP autenticada, pois não havia sessão Microsoft real disponível nesta análise.

### Como executar a validação real depois

1. Iniciar backend e frontend de acordo com a configuração local, sem copiar credenciais para relatório, chat ou comandos compartilhados.
2. Abrir o fluxo do backend em `/auth/login`, concluir o login com a conta de teste autorizada e deixar o navegador conservar o cookie de sessão.
3. Na mesma sessão do navegador, consultar `GET /auth/me` (ou chamar a URL da API com `credentials: 'include'`). Não enviar um e-mail de identidade na requisição.
4. Registrar apenas status HTTP e se `user.jobTitle` e `user.companyName` têm valor não vazio. Não salvar a resposta completa, `raw`, IP, cookies, tokens ou outros atributos.
5. Se houver falha, registrar se ocorreu antes de autenticar (401), ao adquirir token silencioso (401), ou na consulta ao Graph (status Graph, por exemplo 403). Confirmar consentimentos/permissões com o administrador do tenant, sem compartilhar segredos.

Não é necessário criar uma rota de diagnóstico nesta etapa: `/auth/me` já exige sessão Microsoft e consulta o perfil do próprio usuário. Ela permite uma verificação manual básica dos dois campos. Não fornece estados explícitos por atributo (“encontrado”, “ausente” ou “não consultado”) e, devido ao `Promise.all`, a falha de `/memberOf` também impede receber o perfil. Se for necessário um diagnóstico de formato controlado, especificar e aprovar uma resposta mínima antes de alterar a rota; não foi criado script ou endpoint adicional.

## 6.5. Mapeamento dos arquivos relevantes

| Arquivo | Responsabilidade atual | Possível alteração futura | Situação |
|---|---|---|---|
| `index.ts:57-66, 80-84` | Sessão HTTP, cookie, montagem das rotas Microsoft e de negócio | Integrar o modelo de sessão escolhido às rotas de negócio e avaliar armazenamento persistente de sessão | Não alterado |
| `config/msal.ts:10-12, 50-79` | Escopos, cliente MSAL, fluxo de autorização e aquisição silenciosa | Revisar escopos somente após confirmar as chamadas Graph necessárias e o consentimento real | Não alterado |
| `routes/entra-auth.routes.ts:53-159` | Login, callback, silent, perfil/grupos `/auth/me` e logout | Eventual resposta mínima de diagnóstico; não há necessidade de nova rota para o teste básico | Não alterado |
| `middlewares/entra-auth.middleware.ts:4-12` | Exige conta Microsoft presente na sessão | Reutilizar/estender para proteger operações com a identidade Microsoft validada | Não alterado |
| `services/graph.ts:45-108` | Consulta `/me`, `/me/memberOf` e foto do Graph | Manter a obtenção de perfil e tratar permissões/erros confirmados; limitar dados/logs conforme necessidade | Não alterado |
| `mappers/userMapper.ts:1-32` | Define e normaliza perfil Graph, incluindo ambos os atributos | Tipar/normalizar com estado explícito quando o contrato de diagnóstico ou autorização for definido | Não alterado |
| `middlewares/auth.middleware.ts:14-60` | Verifica JWT assinado e claim `origem: "portal"` | Decidir como Microsoft se relaciona com autenticação JWT e aplicar autorização por filial no servidor | Não alterado |
| `routes/grupo.routes.ts:11-69` | Grupos Zabbix e hosts por grupo | Filtrar cada consulta usando identidade/filial autorizada no backend | Não alterado |
| `routes/host.routes.ts:12-246` | Detalhes, serviços, problemas, métricas e relatórios de hosts | Aplicar o mesmo escopo a cada host solicitado e avaliar a rota de relatório pública | Não alterado |
| `routes/services.routes.ts:13-45`, `routes/sla.routes.ts:13-31`, `routes/relatorio.routes.ts:16-93` | Serviços, SLA e relatórios por um ou vários IDs de host | Autorizar IDs de host no servidor, incluindo listas enviadas pelo cliente | Não alterado |
| `services/zabbix.service.ts:88-150, 340-365` | Fachada de grupos/hosts e agregação | Reutilizar consultas atuais e integrar filtros de escopo sem confiar em parâmetros do cliente | Não alterado |
| `repositories/host.repository.ts:18-119` | Consultas SQL para grupos e hosts do Zabbix | Acrescentar consultas seguras/eficientes a partir do mapeamento de filial confirmado | Não alterado |
| `lib/cache.ts:1-80` | Cache LRU em memória, global, por chave e TTL | Evitar compartilhar dados já filtrados entre escopos; definir chave/ordem de cache compatível com autorização | Não alterado |
| `routes/incidentes.routes.ts:12-61`, `routes/guacamole.routes.ts:12-121` | Incidentes/dashboard e listagem/conexão/manutenção Guacamole | Auditar e proteger/filtrar operações que exponham ou alterem recursos de host | Não alterado |
| `repositories/cliente/usuario.repository.ts:8-145`, `prisma-cliente/schema.prisma:10-58` | Modelo separado de usuário local relacionado a grupo e `groupid_zabbix` | Avaliar se é fonte válida de mapeamento, sem presumir relação com `companyName` | Não alterado |
| `routes/docs.openapi.ts:227-245`, `public/docs/` | Catálogo e interface estática da documentação de API | Atualizar a documentação após definir contrato e proteções finais | Não alterado |
| `tests/graph.test.ts`, `tests/entra-routes.test.ts`, `tests/entra-auth.test.ts` | Testes simulados Graph/MSAL/rotas | Estender com campos presentes/ausentes, permissões e restrições por filial depois da implementação | Não alterado |

## 6.6. Análise da filtragem por filial

### Dados e mapeamentos atuais

- Os grupos e hosts Zabbix são consultados diretamente nas tabelas `hstgrp`, `hosts_groups` e `hosts` via `HostRepository`; o serviço `ZabbixService` agrega e cacheia os resultados.
- `GET /grupos`, `/grupos/com-hosts`, `/grupo/:chave` e `/grupo/:chave/hosts-full` expõem grupos ou hosts e exigem atualmente JWT.
- As rotas de host em `routes/host.routes.ts` consultam dados por `hostid`; a maioria exige JWT, mas `GET /host/by-name/:hostname/relatorio` não aplica middleware.
- `routes/services.routes.ts`, `routes/sla.routes.ts` e `routes/relatorio.routes.ts` também buscam dados por `hostid`/lista de `hostids` e atualmente exigem JWT.
- Os quatro endpoints de `routes/incidentes.routes.ts` não aplicam middleware. Os endpoints em `routes/guacamole.routes.ts` também não aplicam autenticação.
- Não foi encontrado filtro por `companyName`, `jobTitle` ou filial nas rotas, serviços, repositórios e middlewares examinados. Não foram encontrados os identificadores `SPS_RJ` e `SPS_BH`; neste relatório, eles são apenas exemplos.
- Existe uma associação diferente no banco do portal: usuário local → `grupos_hosts` → `groupid_zabbix`, com `cargo`. Isso não comprova que o nome do grupo seja uma filial, nem relaciona essa conta ao login Microsoft.
- O pacote usa `lru-cache`; não há dependência Redis identificada. O cache do serviço usa chaves compartilhadas como `grupos:all`, `grupos:com-hosts`, `grupo:<id>:hosts` e `host:<id>:details`, sem componente de usuário/filial.

### Autorização e riscos de contorno a considerar

- A autenticação Microsoft por sessão e o middleware JWT atual são fluxos distintos. `/auth/me` não cria JWT nem injeta a identidade Microsoft em `req.user`; as rotas de negócio protegidas usam `validarToken`, que valida assinatura e origem `portal`, não filial.
- O `/auth/me` Microsoft não protege automaticamente as rotas de grupos/hosts. Portanto, antes da autorização por filial, deve-se decidir qual identidade e mecanismo protegerão todas as rotas de negócio.
- Filtros somente no frontend ou baseados em parâmetros `groupid`, `hostid`, nome de grupo ou lista de IDs enviada pelo cliente podem ser contornados por chamadas diretas. A autorização precisa verificar no backend a associação de cada recurso ao escopo concedido.
- Além das rotas protegidas citadas, revisar explicitamente as rotas públicas de host, incidentes e Guacamole. Também verificar operações não-GET/administração e a emissão de JWT já existente antes de declarar que o acesso entre filiais está isolado.
- O cache existente é compartilhado e independente de identidade. Se armazenar dados já filtrados, as chaves e invalidações precisarão respeitar o escopo autorizado; alternativa a avaliar é manter no cache dados não filtrados e aplicar autorização em cada resposta.

### Frontend

O repositório não contém as telas de produto para consultar usuário ou renderizar grupos/hosts. O README descreve a integração futura: login redirecionado ao backend, `/auth/me` com credenciais de sessão e uso do JSON no cliente. No frontend a identificar, será necessário tratar carregamento, 401/erros e atributos vazios; os grupos/hosts deverão vir já autorizados pelo backend. Ocultar menus ou páginas é apenas comportamento de interface, não controle de acesso.

## 6.7. Plano de implementação futura

1. **Confirmar os atributos em execução:** executar o procedimento autenticado da seção 6.4, registrar status e presença dos campos sem dados sensíveis.
2. **Corrigir a obtenção, se necessário:** se o perfil Graph falhar ou os atributos não vierem, separar falhas de perfil e grupos, confirmar permissões/consentimento no tenant e então ajustar a consulta ou resposta. Não inferir ausência do tenant a partir de fixtures.
3. **Validar mapeamento `companyName` → filial:** definir fonte autoritativa, normalização, valores válidos e comportamento para filial não mapeada/ausente. A tabela local de grupos de usuários só deve ser reutilizada se a regra de negócio confirmar que corresponde à filial.
4. **Implementar autorização no backend:** primeiro decidir compatibilidade entre sessão Microsoft e autenticação JWT legada; depois aplicar escopo no serviço/repositório e em todas as rotas de consulta/operação que usam grupos, hosts ou IDs informados pelo cliente. Rever cache global e rotas públicas em conjunto.
5. **Adaptar o frontend:** localizar o repositório/interface efetivamente usada, carregar a identidade e consumir resultados já filtrados; tratar estados de carregamento/erro/atributos ausentes e regras visuais após definição funcional.
6. **Executar regressões e testes entre filiais:** incluir acesso permitido/negado para IDs manipulados, chamadas diretas, rotas agregadas e públicas, sem regressão das consultas Zabbix/cache.

A validação real dos atributos precede qualquer regra baseada em `companyName`; o mapeamento da filial precede a implementação de filtros. A autorização de backend deve estar implementada antes de considerar concluída a adaptação visual.

## 6.8. Pendências e riscos

- **Tenant/permissões:** não se verificou o consentimento efetivo de `User.Read`, `GroupMember.Read.All` ou `AuditLog.Read.All`; o último não aparenta ser necessário para as chamadas de perfil/grupos atualmente examinadas.
- **Valores reais:** `jobTitle` e `companyName` têm suporte no código, mas valores e preenchimento dependem do diretório/usuário e continuam sem confirmação em execução.
- **Erros combinados:** consulta de perfil e grupos está acoplada por `Promise.all`; erro de permissão de grupos pode ocultar um perfil que, de outro modo, estaria disponível.
- **Dados/logs:** `/auth/me` inclui `raw` e mais propriedades do que os dois campos necessários; `services/graph.ts` e a rota também registram payload/perfil em nível debug. Não habilitar ou coletar esses logs com dados reais sem revisar a necessidade e a proteção dos logs.
- **Mapeamento:** não há regra identificada que associe `companyName` a uma filial ou grupo Zabbix. Nomes e aliases oficiais precisam ser definidos; `SPS_RJ` e `SPS_BH` não foram achados no código analisado.
- **Autorização:** regras formais por filial não existem no fluxo Microsoft examinado; `jobTitle` não deve ser usado para autorização sem definição explícita. Autenticação Microsoft e JWT atual são independentes.
- **Rotas e operações:** endpoints públicos de host/incidentes/Guacamole e rotas com parâmetros de host/grupo precisam de decisão explícita antes de ativar filtragem.
- **Cache:** as chaves atuais não são isoladas por filial; cache global de resultados filtrados pode misturar escopos se reutilizado sem adaptação.
- **Frontend:** o frontend da aplicação precisa ser localizado e revisado em seu repositório próprio.
- **Ambiente real:** falta uma sessão de teste autenticada e autorizada no tenant, além de confirmação de que o backend está acessível ao navegador que mantém a sessão.

## 6.9. Conclusão objetiva

1. **O login coleta `jobTitle`?** O fluxo consulta o Microsoft Graph e solicita `jobTitle` em `/me`, depois o normaliza. Valor real do tenant: **não verificado**.
2. **O login coleta `companyName`?** O fluxo consulta e normaliza `companyName`. Valor real do tenant: **não verificado**. Testes simulados incluem um valor, mas não validam a Microsoft.
3. **É necessário criar/ajustar rota de diagnóstico?** Não para uma verificação manual básica: `GET /auth/me` já requer a sessão Microsoft existente e consulta o perfil do próprio usuário. Uma resposta diagnóstica com estados explícitos e dados mínimos exigiria ajuste posterior, mas não foi feita nesta etapa.
4. **Alterações futuras de backend:** confirmar Graph/consentimentos; definir e validar o mapa de filial; escolher o vínculo entre sessão Microsoft e rotas JWT; restringir grupos, hosts, relatórios, incidentes e operações no servidor; revisar cache e endpoints públicos.
5. **Alterações futuras de frontend:** localizar o projeto de interface, buscar `/auth/me` com cookie, tratar estados e apresentar somente grupos/hosts filtrados pelo backend. Não há componentes de produto neste repositório.
6. **Arquivos a analisar primeiro na próxima etapa:** `routes/entra-auth.routes.ts`, `services/graph.ts`, `mappers/userMapper.ts` (contrato/origem dos atributos); em seguida `middlewares/auth.middleware.ts`, `middlewares/entra-auth.middleware.ts`, `routes/grupo.routes.ts`, `routes/host.routes.ts`, `services/zabbix.service.ts`, `repositories/host.repository.ts` e `lib/cache.ts` (identidade e autorização dos recursos). Identificar também o repositório do frontend.
7. **Testes ainda necessários:** login em tenant real com sessão autorizada; leitura dos dois campos em `/auth/me`; confirmação do status/permissões Graph; definição e teste do mapeamento de filial; testes negativos de acesso cruzado/manipulação de IDs em todas as rotas relevantes; regressões dos serviços Zabbix e cache.

**Nenhuma alteração funcional foi implementada.** Os testes automatizados simulados passaram, mas não substituem a validação no tenant. A próxima etapa depende da confirmação dos atributos e da definição formal do mapeamento e das regras de acesso.
