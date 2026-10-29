# Relatório de validação do Portal RDP

**Data:** 27/10/2026

## 1. Objetivo e escopo

Atualizar a URL usada pelo backend para consultar diretamente o Portal RDP e validar a integração, as rotas/documentação da API e as verificações de qualidade disponíveis. A consulta continua sendo somente de disponibilidade; não inicia uma sessão RDP.

## 2. URL anterior e URL nova

- **Anterior encontrada:** `https://guac.datacore.com.br/`; o fluxo antigo também consultava `/token.html`.
- **Nova:** `http://10.86.26.18:8410/`.
- A rota agora usa `GUACAMOLE_BASE_URL`, com a nova URL como padrão. A variável já estava listada no ambiente local e no exemplo, mas a rota anterior não a consumia.
- A consulta não exige nem envia autenticação do Portal RDP.

## 3. Arquivos modificados

- `.env` — atualizada localmente a URL `GUACAMOLE_BASE_URL`; este arquivo contém configuração local e não é versionado.
- `.env.example` — atualizado o valor de exemplo e removida a variável de token antiga da integração do Portal.
- `routes/conectado.routes.ts` — consulta direta ao endereço configurado; remove o fluxo da página de token, cookie e autenticação antiga.
- `tests/conectado.routes.test.ts` — testes da consulta direta, resposta de sucesso, erros HTTP, resposta não HTML, falha de rede, timeout e método não permitido.
- `README.md` — atualizadas as variáveis e a descrição de `GET /api/conectado`.
- `routes/docs.openapi.ts` — atualizada a descrição OpenAPI da rota, sem alterar seu caminho nem exemplo de sucesso.
- `GUIA_MODAL_CONEXAO_RDP.md` — corrigida a descrição da verificação de disponibilidade do portal.
- `GUACAMOLE_FLUXO.md` — removida a descrição obsoleta de `POST /api/conectado` como HTTP 501 e descrito o GET existente, com a ressalva sobre testes simulados.
- `RELATORIO_VALIDACAO_PORTAL_RDP.md` — este relatório.

## 4. Comportamento preservado

- A rota permanece `GET /api/conectado`; nenhum endpoint foi removido, renomeado ou criado.
- O sucesso continua retornando HTTP 200 e `{"status":"conectado"}`.
- A requisição remota continua sendo GET, não segue redirecionamentos e mantém o timeout configurável (`GUACAMOLE_TIMEOUT_MS`, padrão de 10 segundos).
- Respostas remotas inesperadas/falhas de rede continuam resultando em HTTP 502; timeout resulta em HTTP 504; timeout local inválido resulta em HTTP 500.
- As rotas da documentação permanecem `/docs` e `/docs/openapi.json`, com interface e recursos estáticos sob `/docs`.
- Não foram alteradas autenticações gerais do backend, outros endpoints, frontend ou Portal RDP.

## 5. Validação de conectividade

**Estado: INCONCLUSIVO.**

Comando executado no ambiente de desenvolvimento:

```text
curl.exe -sS -o NUL -w "HTTP_STATUS=%{http_code} TIME_TOTAL=%{time_total}s REMOTE_IP=%{remote_ip}\n" --connect-timeout 5 --max-time 10 http://10.86.26.18:8410/
```

Resultado observado: `curl` encerrou com código 28 por timeout após aproximadamente 5,016 segundos; status HTTP `000`, sem IP remoto. O tempo total medido pelo processo foi aproximadamente 5,038 segundos. Não houve resposta HTTP.

Esse ambiente não conseguiu estabelecer a conexão dentro do limite configurado. O resultado não comprova indisponibilidade do Portal RDP; o acesso pode depender da VPN ou da rota da rede interna. A conectividade real a partir do ambiente do backend permanece pendente.

## 6. Validação da API

- `npx tsx --test tests/conectado.routes.test.ts tests/docs.test.ts` — **APROVADO**: 8 testes passaram, 0 falharam.
- A rota foi exercitada em Express de teste com respostas remotas simuladas. Houve validação de HTTP 200/HTML e do corpo de sucesso, além de respostas remotas 401, 403, 500, 503 e 302, conteúdo JSON inesperado, falha de rede, timeout e recusa de POST.
- As falhas simuladas resultaram nos status esperados (502 para falhas/respostas remotas inválidas, 504 para timeout e 404 para POST).
- Esses testes não fazem uma chamada real ao Portal RDP; a validação de rede real está inconclusiva conforme a seção 5.

## 7. Validação da documentação

Os caminhos foram confirmados no código:

- Página: `/docs`
- Especificação OpenAPI JSON: `/docs/openapi.json`
- Recursos estáticos: `/docs/docs.css` e `/docs/docs.js`

**Estado: APROVADO no ambiente de teste Express.** O teste `Express serve a página, os recursos estáticos e OpenAPI sem autenticação` confirmou HTTP 200 e os tipos/conteúdos esperados para a página, CSS, JavaScript e JSON OpenAPI. O teste também validou a versão OpenAPI `3.0.3` e sua consistência com o catálogo de operações.

A validação foi feita com o router de documentação em um servidor Express de teste; a aplicação completa não foi iniciada para esta verificação.

## 8. Testes de qualidade

- `npm test` — **APROVADO**: 60 testes passaram, 0 falharam.
- `npm run typecheck` — **APROVADO**: `tsc --noEmit` concluiu sem erros.
- `git diff --check` — **APROVADO**: sem erros de whitespace; o Git emitiu avisos de conversão CRLF/LF para arquivos já modificados no worktree.
- Não há scripts `lint` ou `build` declarados em `package.json`; esses comandos não foram executados.

## 9. Pendências

- **INCONCLUSIVO:** repetir o teste de conectividade em um ambiente com acesso à VPN/rede `10.86.26.0`.
- **NÃO EXECUTADO:** confirmação de sucesso/falha por meio de uma chamada real do endpoint da API ao Portal; os cenários da rota foram testados com respostas simuladas.
- **NÃO EXECUTADO:** inicialização da aplicação completa para testar a documentação; os routers da documentação foram servidos e validados no ambiente Express de teste.
- O valor antigo de `BEARER_TOKEN` que já existia no `.env` local não é lido pela rota atual; seu valor não é reproduzido neste relatório.

## 10. Conclusão

- **APROVADO:** configuração do backend e do exemplo apontam para `http://10.86.26.18:8410/`; a rota consulta a URL diretamente, sem autenticação do Portal.
- **APROVADO:** contrato do endpoint e caminhos da documentação foram preservados; testes da rota, documentação, suíte completa e typecheck passaram.
- **INCONCLUSIVO:** conectividade real do ambiente de desenvolvimento com o endereço interno; não foi recebido status HTTP.
- **NÃO VERIFICADO:** resposta real do Portal através da API, dependente de conectividade com a rede interna