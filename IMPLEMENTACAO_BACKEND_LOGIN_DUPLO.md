# Implementação do login de página dupla — backend

## Resumo do que foi feito

- O callback Entra consulta `companyName` no Microsoft Graph delegado usando o token obtido no fluxo existente. Nenhuma permissão/escopo MSAL foi adicionada.
- Uma allow-list JSON independente foi criada em `config/authorized-companies.json`, com carregador que valida e mantém a configuração em memória. Arquivo ausente, JSON malformado ou estrutura inesperada interrompe a inicialização.
- A classificação usa correspondência exata após `trim().toLowerCase()`: match resulta em `normal`; valor diferente, vazio, nulo ou ausente resulta em `secondary`.
- A decisão e o nome de empresa normalizado são gravados na sessão regenerada pelo callback. O redirect é fixo e usa `FRONTEND_URL`: sempre `/dashboard`, para ambas as experiências; o frontend escolhe a renderização pelo campo `experience` de `/auth/me`, e as APIs mantêm a autorização no servidor.
- Falhas na troca do código/token ou na consulta de perfil ao Graph respondem `502`, sem completar uma sessão autenticada nem conceder a experiência normal. A trilha da decisão registra somente experiência, motivo categorizado, tenant e horário; os logs de payload/perfil bruto do Graph foram removidos.
- `/auth/me` preserva `user`, `groups`, `clientIp` e `source`, inclui `experience` a partir da sessão e retorna `secondary` se a classificação não existir.
- A guarda `requireExperience('normal' | 'secondary')` foi criada. Rotas de dados da experiência normal verificam a sessão Entra. Para preservar os clientes JWT legados, as APIs JWT continuam aceitando um token válido sem sessão Entra; esse caminho é um bypass documentado, não uma autorização completa por experiência.
- A política foi ampliada para aceitar uma lista de experiências. `secondary` acessa somente endpoints de hosts/grupos com filtro server-side, descritos na tabela final abaixo; endpoints de incidentes, dashboard, relatórios e outros dados continuam restritos a `normal`.
- O frontend está no checkout irmão `..\datacore`; nenhuma alteração foi feita nele.
- Divergência encontrada no contrato do frontend: o diagnóstico frontend menciona `GET /auth/photo`, mas não existe essa rota no backend atual; `getGraphPhoto()` existe somente como helper em `services/graph.ts`.
- `config/access-rules.*` e `middlewares/access-control.middleware.ts` não foram alterados nem reutilizados.

## Arquivos criados/alterados

### Criados

- `config/authorized-companies.json`
- `config/authorized-companies.ts`
- `middlewares/experience.middleware.ts`
- `tests/authorized-companies.test.ts`
- `IMPLEMENTACAO_BACKEND_LOGIN_DUPLO.md`

### Alterados

- `routes/entra-auth.routes.ts` — decisão no callback, sessão, redirect, resposta `/auth/me` e remoção do log de perfil normalizado.
- `types/express-session.d.ts` — campos opcionais `companyName` e `experience`.
- `routes/host.routes.ts`, `routes/grupo.routes.ts`, `routes/incidentes.routes.ts`, `routes/relatorio.routes.ts`, `routes/sla.routes.ts`, `routes/services.routes.ts` — guardas da experiência normal conforme a política de compatibilidade JWT.
- `services/graph.ts` — remoção do log do payload integral do Graph.
- `routes/docs.openapi.ts` — atualização das descrições de callback e `/auth/me`.
- `tests/entra-routes.test.ts` — cobertura de classificação, sessão, redirects, erros, acessos cruzados e logout/login com outra empresa.
- `README.md`, `rotas.txt` — configuração, contrato e política de rotas.

Nenhuma dependência foi instalada ou adicionada.

### Correção do erro de acesso negado (secondary)

**Criados/alterados nesta correção**

- `routes/_company-scope.ts:4,10` — resolve os IDs de grupos Zabbix permitidos e valida chaves de grupo.
- `config/company-host-groups.json:9,13` — inclui `SPS BH` como alias explícito aprovado para `SPS_BH`, além de `SPS Minas`.
- `routes/grupo.routes.ts:62,90` — filtra `/grupos/com-hosts` e protege `/grupo/:chave/hosts-full` antes da consulta de hosts.
- `routes/host.routes.ts:11,176,204,223,282` — filtra status/uptime e protege detalhes por host usados pelo HostCard e HostModal.
- `routes/guacamole.routes.ts:48,55` — sessão secondary só conecta a hostname associado a grupo permitido; JWT legado sem sessão preserva o comportamento existente.
- `repositories/host.repository.ts:110,140,160,177` e `services/zabbix.service.ts:153,601,605,609` — consulta de hosts/IDs de grupos selecionados e verificação de associação de host.
- `routes/docs.openapi.ts:324,405,414`, `tests/experience-routes.test.ts`, `tests/company-host-groups.test.ts`, `tests/secondary-scope-routes.test.ts:81` — documentação e regressões/mocks.
- `DIAGNOSTICO_ERRO_ACESSO_NEGADO.md` e este documento — causa confirmada, contrato e resultados.

## Contrato final

### `GET /auth/me`

Com sessão Microsoft válida, mantém os campos existentes e adiciona:

```json
{
  "user": {},
  "groups": [],
  "clientIp": "127.0.0.1",
  "source": "graph",
  "experience": "normal"
}
```

`experience` é lido da sessão, sem recálculo a partir de dados do cliente. Se o valor não estiver gravado, a resposta usa `"secondary"`. A allow-list e os tokens não são enviados ao frontend.

- Sem sessão Microsoft: `401 { "needsLogin": true }`.
- Erro ao adquirir token silencioso ou consultar Graph em `/auth/me`: o endpoint mantém o tratamento de erro existente; a classificação retornada continua sendo a armazenada na sessão quando uma resposta de perfil é concluída.

### Callback e redirects

`GET /auth/callback` valida o código e o `state`, troca o código pelo token, consulta `/me` no Graph, classifica a empresa, regenera a sessão e salva `account`, cache MSAL, `companyName` normalizado e `experience`.

- Para `experience === "normal"` ou `"secondary"` → `302` para `FRONTEND_URL/dashboard`.
- O frontend lê `experience` em `/auth/me` e escolhe a página a renderizar; a URL não altera a política de acesso das APIs.
- O callback ignora qualquer parâmetro de destino; apenas caminhos constantes são usados.
- Código ausente: `400`.
- `state` inválido/expirado: `400`.
- Erro retornado pelo Entra ou ausência de conta: `401`.
- Falha na troca do código/token ou consulta de perfil do Graph: `502` com mensagem genérica; não retorna payload do Graph nem salva nova sessão autenticada/classificada.

O código mantém a permissão delegada existente `User.Read` e os demais scopes existentes sem alteração.

## Política aplicada às rotas

`requireExperience` aceita uma experiência ou lista de experiências. Sem sessão Microsoft/classificação responde `401`; uma classificação que não pertença à lista permitida responde `403`. As rotas com `requireExperienceOrLegacyJwt` preservam a validação JWT preexistente quando não há sessão Entra; com sessão Entra, aplicam a política da tabela.

As chamadas foram confirmadas no frontend irmão `..\datacore` (`src/pages/Hosts.jsx`, `src/pages/HostGroup.jsx`, `src/secondary/`, `src/components/GlobalSearch.jsx`, `src/components/HostCard.jsx`, `src/components/HostModal.jsx` e `src/hooks/useBulkHosts.js`). `/api` é encaminhado localmente ao backend sem o prefixo. Política final:

| Endpoint backend (método) | Middleware / filtro para `secondary` | Normal |
| --- | --- | --- |
| `GET /grupos/com-hosts` | `requireExperienceOrLegacyJwt(['normal','secondary'])`; busca apenas grupos autorizados e só hosts desses grupos. Escopo vazio → `[]`. | Consulta e payload atuais, sem filtro. |
| `GET /grupo/:chave` | Middleware compartilhado existente; chave de grupo validada contra `allowedHostGroups`. Grupo fora do escopo → 403 antes da busca de hosts. | Resposta atual, sem filtro. |
| `GET /grupo/:chave/hosts-full` | `requireExperienceOrLegacyJwt(['normal','secondary'])`; valida chave antes de `getHostsFullDoGrupo`. | Resposta atual, sem filtro. |
| `GET /hosts/status-ping-uptime` | `requireExperienceOrLegacyJwt(['normal','secondary'])`; filtra por host IDs associados aos grupos autorizados antes de serializar. Escopo vazio → `[]`. | Consulta e payload atuais, sem filtro. |
| `GET /host/:hostid/metrics`, `/basico`, `/services`, `/active-services`, `/com-ip` | Middleware permite normal/secondary; secondary verifica associação com ao menos um grupo permitido; fora do escopo/sem escopo → 404 antes da consulta de detalhes. | Resposta atual, sem filtro. |
| `POST /guacamole/connect-full` | Para sessão secondary, valida o hostname do payload e sua associação aos grupos permitidos antes da operação. O caminho sem sessão não foi alterado. | Comportamento atual. |
| `GET /hosts/com-ip`, `GET /grupos` | Já aceitavam normal/secondary; filtro server-side existente. Não são chamadas pelas telas rastreadas desta versão. | Resposta atual, sem filtro. |
| `GET /hosts/com-ip-e-so`, `GET /host/:hostid/details`, `/problemas`, relatórios, séries, SLA e histórico | Permanecem `normal`; não foram encontrados no caminho das telas secundárias rastreadas. | Sem alteração. |
| `GET /incidentes/ativos`, `/incidentes/hosts-totais`, `/incidentes/problemas-24h`, `/incidentes/dashboard` | Incidentes, totais e dashboard seguem restritos a normal. | Sem alteração. |
| `/auth/me`, `/auth/token`, callback e logout | Fluxo de sessão compartilhado; classificação permanece a decisão persistida no login. | Sem alteração. |
| Rotas de dados com JWT válido e sem sessão Entra | Bypass JWT legado preexistente; não ganha classificação/filtro por empresa. | Comportamento legado preservado. |
| Outras rotas Guacamole, admin e diagnóstico | Fora das telas de listagem/grupo tratadas nesta correção. | Política preexistente; revisar separadamente. |

O payload de `/grupos/com-hosts` mantém o contrato atual de grupos com `groupid`, nome do grupo e hosts; para secondary, tanto grupos quanto hosts são filtrados no servidor. `/hosts/status-ping-uptime` não inclui nomes de grupos e seus IDs são limitados aos hosts associados a grupos permitidos. Endpoint por host retorna 404 antes de buscar dados se não houver associação permitida. Sessões normais mantêm chamadas/respostas existentes.

## Escopo atual dos endpoints liberados

O escopo por empresa foi implementado para as rotas secondary listadas na seção **Escopo por empresa (secondary)** ao final deste documento. As descrições históricas abaixo foram substituídas por esse contrato: uma sessão secondary sem grupo associado recebe resultados vazios e não uma listagem global. As rotas que aceitam JWT legado sem sessão Entra continuam fora dessa classificação para preservar compatibilidade.

## Riscos pendentes

1. **Bypass JWT:** as APIs de dados continuam acessíveis a qualquer cliente com JWT válido emitido pelo fluxo legado, sem sessão Entra e sem classificação de empresa. Isso preserva explicitamente o comportamento solicitado para clientes existentes, mas permite contornar a política de página dupla. Remover o bypass requer migração coordenada dos clientes JWT e decisão explícita sobre como classificar essas identidades.
2. **Nomes de grupos Zabbix:** se um grupo for renomeado ou removido no Zabbix, a correspondência configurada deixa de retornar hosts/grupos até que o arquivo seja atualizado e a aplicação reiniciada.
3. **MemoryStore:** `express-session` ainda usa o store em memória padrão. Ele perde sessões em reinícios e não atende bem escala horizontal; configurar store persistente e proteção de cookie/proxy conforme deployment antes de produção.
4. **Endpoints públicos/fora da política:** outras operações Guacamole, o cache admin em desenvolvimento e o diagnóstico de empresa ainda precisam de revisão independente. `connect-full` aplica checagem de escopo somente quando encontra sessão secondary; não altera seu caminho sem sessão.
5. **APIs compartilhadas:** não há API exclusiva da experiência secundária; as telas reutilizam rotas compartilhadas com filtro condicionado à sessão.
6. **Sessão baseada em snapshot:** o `companyName` e a experiência são decididos no callback; mudanças no diretório/allow-list só afetam uma nova autenticação e reinício/deploy da configuração, respectivamente.
7. **Graph em `/auth/me`:** perfil e grupos continuam sendo consultados no Graph nesse endpoint; falha dessas chamadas pode impedir a carga do frontend mesmo que a decisão já esteja salva.
8. **Configuração por instância:** a lista carregada fica em memória e é estática até reinício; todos os ambientes/instâncias devem receber o mesmo JSON.

## Resultado de typecheck e testes

- `npm run typecheck` — **aprovado** (`tsc --noEmit`).
- `npm test` — **53 testes aprovados, 0 falhas** na verificação final.
- A suíte usa mocks para o Zabbix e cobre escopo por empresa, hierarquia, grupo alheio sem consulta de hosts, escopo vazio/ausente, filtros por host, callback, sessão antiga e regressão normal.
- A captura assistida pré-correção confirmou a chamada `/grupos/com-hosts` e o 403. A validação manual pós-correção aguarda nova sessão e confirmação de que o backend local usa somente fonte de dados não produtiva.

## Passos de deploy

1. Incluir `config/authorized-companies.json` e `config/company-host-groups.json` no artefato/imagem do backend, cada um ao lado do respectivo módulo carregador em `config/`. Ambos são obrigatórios no startup; o carregador resolve o caminho a partir do próprio módulo, não do diretório de trabalho do processo.
2. Instalar em cada ambiente uma cópia válida da allow-list aprovada. Exemplo inicial:

   ```json
   {
     "companies": [
       { "companyname": "datacore" }
     ]
   }
   ```

3. Tratar o arquivo como configuração obrigatória: validar o conteúdo antes de iniciar serviço. JSON ausente, inválido, chave extra, item com campo extra, nome vazio/tipo inválido ou nome duplicado impede o startup.
4. Em desenvolvimento local, manter o arquivo no diretório `config/` do projeto antes de executar `npm run dev`.
5. Em CI/staging/produção, copiar/montar o JSON no mesmo diretório `config/` distribuído junto ao código TypeScript (ou junto ao módulo compilado mantendo a estrutura de pastas). Não presumir que `.env` substitui este arquivo.
6. Atualizar a allow-list com deploy/restart de todas as instâncias; não há hot reload.
7. Implantar coordenadamente com o frontend, que recebe sempre o redirect `/dashboard`, consulta `/auth/me` com cookie e aplica `experience` antes de renderizar telas.
8. Antes de produção, configurar um store de sessão persistente e decidir como eliminar o bypass JWT e proteger as rotas Guacamole/admin fora desta política.

## Escopo por empresa (secondary)

### Arquivos criados e alterados

**Criados**

- `config/company-host-groups.json` — mapeamento independente; `SPS_BOLIVIA` omitido intencionalmente.
- `config/company-host-groups.ts` — validação, normalização e resolução fail-closed.
- `routes/_company-scope.ts` — resolve grupos e valida chaves no contexto das rotas.
- `tests/company-host-groups.test.ts`, `tests/secondary-scope-routes.test.ts` — testes com mocks, sem Zabbix real.

**Alterados**

- `config/company-host-groups.json` — inclui `SPS BH` como alias explícito de `SPS_BH`, aprovado pelo usuário; `SPS Minas` permanece mapeado ao mesmo grupo.
- `routes/grupo.routes.ts` — lista agregada e hosts-full com filtros secondary.
- `routes/host.routes.ts` — status/uptime e detalhes por host com validação de associação ao escopo.
- `routes/guacamole.routes.ts` — checagem por hostname somente para sessão secondary no endpoint chamado pelo HostGroup.
- `repositories/host.repository.ts`, `services/zabbix.service.ts` — consultas por group IDs e associação host-grupo.
- `routes/docs.openapi.ts`, `tests/experience-routes.test.ts`, `DIAGNOSTICO_ERRO_ACESSO_NEGADO.md` — política, regressão e diagnóstico.

`config/authorized-companies.json`, `config/access-rules.json`, classificação de experiência, JWT/senha, callback/redirect/logout e rotas normais não foram alterados para aplicar filtros.

### Normalização e contrato

O `companyName` para escopo é normalizado com `trim`, lowercase, colapso de espaços consecutivos e remoção de diacríticos; a comparação é exata, nunca substring. A validação do JSON exige objeto com `companies` array, `companyname` e nomes de grupos não vazios, e rejeita colisões de empresas após normalização. Ausência ou erro no arquivo interrompe a carga do módulo/startup com mensagem clara.

O callback preserva a lógica atual de `experience`. Para `normal`, não calcula nem grava escopo. Para `secondary`, grava na sessão somente os grupos mapeados; empresa ausente/vazia ou não mapeada recebe `allowedHostGroups: []`. O `/auth/me` não retorna o mapeamento nem o escopo — o backend usa apenas a sessão.

| Endpoint backend usado ou exposto às telas | Middleware/filtro para secondary | Normal |
| --- | --- | --- |
| `GET /grupos/com-hosts` | Só grupos permitidos e seus hosts; query scoped por IDs de grupo. Escopo vazio → `[]`. | Consulta e payload atuais, sem filtro. |
| `GET /grupos` | Só grupos permitidos; escopo vazio → `[]`. | Lista atual, sem filtro. |
| `GET /hosts/com-ip` | Hosts associados a pelo menos um grupo permitido; sem grupos → `[]`. | Consulta e payload atuais, sem filtro. |
| `GET /grupo/:chave` | Valida chave e retorna hosts só de grupo permitido; fora do escopo → 403 antes da consulta de hosts. | Consulta e payload atuais, sem filtro. |
| `GET /grupo/:chave/hosts-full` | Valida chave antes de buscar detalhes; fora do escopo/ausente → 403 sem buscar hosts. | Consulta e payload atuais, sem filtro. |
| `GET /hosts/status-ping-uptime` | IDs de host filtrados pela associação aos grupos permitidos antes da serialização; vazio → `[]`. | Consulta e payload atuais, sem filtro. |
| `GET /host/:hostid/metrics`, `/basico`, `/services`, `/active-services`, `/com-ip` | Requer host associado a algum grupo permitido; fora do escopo/ausente → 404 antes da consulta do recurso. | Resposta atual, sem filtro. |
| `POST /guacamole/connect-full` | Com sessão secondary, valida hostname e associação a grupo permitido; sem sessão mantém caminho existente. | Comportamento atual. |
| Incidentes, totais, problemas, `/hosts/com-ip-e-so`, detalhes não chamados e relatórios | Continuam restritos a normal ou fora da política. | Sem alteração. |

`/hosts/status-ping-uptime` filtra o conjunto retornado pelo serviço antes de serializar, usando IDs de host consultados por grupos permitidos. Não inclui grupos no payload. Hosts em múltiplos grupos aparecem em `/grupos/com-hosts` somente dentro dos grupos permitidos; dados de relações externas não são serializados.

### Hierarquia dos grupos Zabbix

O código consulta a tabela `hstgrp` e usa o valor de `name` como nome simples de grupo; não foi encontrado no repositório um dado real de Zabbix nem evidência de que os grupos existentes sejam hierárquicos. Não foi feita chamada a uma instância Zabbix. Para compatibilidade caso existam grupos hierárquicos, o filtro implementado aceita o nome exato após `trim` e subgrupos cujo nome comece por `NOME/`; não usa `includes`, evitando colisões como `SPS_RJ`/`SPS_RJX`.

### Verificação e riscos pendentes

- `npm run typecheck` — **aprovado** após as alterações.
- `npm test` — **53 testes, 0 falhas**; os testes usam mocks e não fazem chamadas reais ao Zabbix.
- Um host vinculado a vários grupos aparece uma vez na lista se ao menos um vínculo estiver no escopo; como a resposta atual não lista grupos, nenhum outro vínculo é exposto.
- Renomeação de grupo no Zabbix exige atualizar o JSON e reiniciar a aplicação; até lá o grupo/host renomeado não será encontrado por esse escopo.
- O arquivo é estático em memória e obrigatório em cada instância/artefato de deploy. Falta, JSON inválido ou colisão impede startup.
- JWT legado sem sessão Entra preserva o bypass existente de experiência e, portanto, não recebe filtro por empresa. Outras rotas fora da política (admin/Guacamole) seguem pendentes de revisão; a rota `connect-full` só acrescenta filtro quando há sessão secondary.
- Não existe campo de grupo em `/hosts/com-ip`; se esse contrato mudar futuramente para incluir grupos, deverá retornar somente os grupos permitidos para a sessão.
- O usuário confirmou que atualizou a filial e validou a exibição pós-correção. A última leitura automatizada anterior à confirmação ainda mostrava `SPS RJ`; não houve captura sanitizada independente posterior.
