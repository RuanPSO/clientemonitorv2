# Guia: botão Conectar e sessão RDP dentro de um modal

Este guia descreve como ligar o formulário do Portal RDP a um modal da aplicação e renderizar a sessão remota dentro dele. É um guia de integração; não altera a interface do frontend nem cria novas rotas.

## Fluxo e componentes existentes

Há dois fluxos diferentes:

1. `GET /api/conectado` valida no backend o acesso direto ao Portal RDP, sem autenticação. A resposta `{ "status": "conectado" }` indica que o backend recebeu uma página HTML com HTTP 200. Isso **não** cria uma sessão RDP.
2. `POST /api/guacamole/token`, no gateway separado (`GUAC_PORT`, padrão `8190`), recebe as credenciais do usuário e a porta RDP. Retorna `{ token, websocketUrl }`; o navegador usa a URL WebSocket para abrir e mostrar a sessão.

O gateway atual fixa o host remoto como `ts.datacore.com.br`. Ele recebe apenas `username`, `password` e `port`; o endereço exibido no campo Host não deve permitir escolher outro host. O usuário deve ser informado sem domínio (por exemplo, `usuario`, e não `DOMINIO\usuario`).

## Segurança antes da integração

O gateway protege `POST /api/guacamole/token` com `API_BEARER_TOKEN`. **Não coloque esse segredo no JavaScript, HTML, armazenamento do navegador ou bundle do frontend.** O `.env` do servidor não pode ser acessado pelo browser.

Para uma integração de produção, o frontend deve enviar usuário, senha e porta a um endpoint autenticado do backend principal (BFF). Esse endpoint intermediário deve validar a sessão/permissão do usuário e chamar o gateway acrescentando `Authorization: Bearer ${API_BEARER_TOKEN}` no servidor. O BFF ainda precisa ser implementado: não existe atualmente uma rota proxy na API principal para o gateway.

O exemplo frontend abaixo usa `/api/remote-session/token` como nome ilustrativo para esse BFF futuro. Não é uma rota existente. Não substitua esse fluxo expondo `API_BEARER_TOKEN` ao browser.

## Estrutura sugerida do modal

O conteúdo inicial do modal pode usar o formulário existente. O display remoto ocupa a mesma janela depois que a conexão WebSocket for estabelecida.

```html
<dialog id="remote-modal" aria-labelledby="remote-title">
  <section class="remote-modal-content">
    <header>
      <h2 id="remote-title">Conectar ao Servidor RDP</h2>
      <button id="remote-close" type="button" aria-label="Fechar">×</button>
    </header>

    <form id="remote-login">
      <label>
        Host
        <input id="host" value="ts.datacore.com.br:32245" readonly>
      </label>
      <label>
        Usuário
        <input id="user" autocomplete="username" required>
      </label>
      <label>
        Senha
        <input id="pass" type="password" autocomplete="current-password" required>
      </label>
      <p id="login-mensagem" role="status" aria-live="polite"></p>
      <button id="btnCancelar" type="button">Cancelar</button>
      <button id="btnConectar" type="submit">Conectar</button>
    </form>

    <div id="remote-view" hidden>
      <p id="remote-status" role="status" aria-live="polite">Conectando…</p>
      <div id="remote-display" tabindex="0" aria-label="Tela da sessão RDP"></div>
    </div>
  </section>
</dialog>
```

Carregue uma cópia aprovada de `guacamole-common-js` no frontend. O pacote `guacamole-lite` do backend é o servidor WebSocket e não fornece, por si só, o cliente JavaScript para renderizar a tela no navegador.

Exemplo mínimo de estilos para manter a tela dentro do modal:

```css
#remote-modal {
  width: min(96vw, 1200px);
  height: min(92vh, 850px);
  padding: 0;
  border: 0;
  border-radius: 8px;
}

.remote-modal-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
}

#remote-view {
  flex: 1;
  min-height: 0;
}

#remote-display {
  width: 100%;
  height: calc(100% - 32px);
  overflow: auto;
  background: #111;
}

#remote-display > div {
  margin: auto;
}
```

## Ação do botão Conectar

1. Abrir o modal e mostrar o formulário.
2. Validar usuário e senha; extrair a porta do host fixo (`32245` no exemplo).
3. Enviar `{ username, password, port }` ao BFF do backend principal.
4. O BFF chama o gateway `POST /api/guacamole/token`, usando o `API_BEARER_TOKEN` guardado no servidor, e devolve somente a resposta `{ token, websocketUrl }` ao usuário autenticado. Configure a resposta como `Cache-Control: no-store`.
5. Limpar o campo de senha e substituir o formulário pelo display.
6. Criar o cliente Guacamole com `websocketUrl`. Quando receber o estado conectado, informar o sucesso. Em erro, mostrar mensagem genérica e permitir nova tentativa.

Exemplo de código do lado do navegador. Ele pressupõe o BFF ilustrativo mencionado acima:

```js
const modal = document.querySelector('#remote-modal')
const form = document.querySelector('#remote-login')
const loginMessage = document.querySelector('#login-mensagem')
const passwordInput = document.querySelector('#pass')
const remoteView = document.querySelector('#remote-view')
const remoteDisplay = document.querySelector('#remote-display')
const remoteStatus = document.querySelector('#remote-status')
const connectButton = document.querySelector('#btnConectar')

let remoteClient = null
let remoteKeyboard = null
let remoteMouse = null

function getFixedRdpPort() {
  const host = document.querySelector('#host').value.trim()
  const match = /^ts\.datacore\.com\.br:(\d{1,5})$/i.exec(host)
  const port = match ? Number(match[1]) : NaN

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Host ou porta RDP inválidos.')
  }

  return port
}

function disconnectRemote() {
  remoteKeyboard?.reset()
  remoteMouse = null
  remoteKeyboard = null
  remoteClient?.disconnect()
  remoteClient = null
  remoteDisplay.replaceChildren()
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  loginMessage.textContent = ''
  connectButton.disabled = true

  const username = document.querySelector('#user').value.trim()
  const password = passwordInput.value

  try {
    if (!username || !password) {
      throw new Error('Informe usuário e senha.')
    }

    const response = await fetch('/api/remote-session/token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        port: getFixedRdpPort(),
      }),
    })

    const result = await response.json()
    if (!response.ok) {
      throw new Error(result.error || 'Não foi possível iniciar a conexão RDP.')
    }
    if (typeof result.websocketUrl !== 'string') {
      throw new Error('Resposta inválida do serviço de conexão.')
    }

    passwordInput.value = ''
    form.hidden = true
    remoteView.hidden = false
    remoteStatus.textContent = 'Conectando…'

    const tunnel = new Guacamole.WebSocketTunnel(result.websocketUrl)
    const client = new Guacamole.Client(tunnel)
    remoteClient = client
    remoteDisplay.replaceChildren(client.getDisplay().getElement())

    client.onerror = () => {
      remoteStatus.textContent = 'Falha na conexão remota.'
    }

    client.onstatechange = (state) => {
      if (state === Guacamole.Client.State.CONNECTED) {
        remoteStatus.textContent = 'Conectado'
      } else if (state === Guacamole.Client.State.DISCONNECTED) {
        remoteStatus.textContent = 'Conexão encerrada.'
      }
    }

    remoteMouse = new Guacamole.Mouse(client.getDisplay())
    remoteMouse.onmousedown = remoteMouse.onmouseup = remoteMouse.onmousemove =
      (mouseState) => client.sendMouseState(mouseState)

    remoteKeyboard = new Guacamole.Keyboard(remoteDisplay)
    remoteKeyboard.onkeydown = (keysym) => client.sendKeyEvent(1, keysym)
    remoteKeyboard.onkeyup = (keysym) => client.sendKeyEvent(0, keysym)

    client.connect()
  } catch (error) {
    passwordInput.value = ''
    loginMessage.textContent = error instanceof Error
      ? error.message
      : 'Não foi possível iniciar a conexão RDP.'
    disconnectRemote()
    remoteView.hidden = true
    form.hidden = false
  } finally {
    connectButton.disabled = false
  }
})

document.querySelector('#btnCancelar').addEventListener('click', () => {
  disconnectRemote()
  modal.close()
})

document.querySelector('#remote-close').addEventListener('click', () => {
  disconnectRemote()
  modal.close()
})

modal.addEventListener('close', disconnectRemote)
```

O valor `websocketUrl` já contém o token curto de sessão emitido pelo gateway. Não o registre em logs nem o persista em `localStorage` ou `sessionStorage`. O gateway atual usa tokens de uso único com validade de 60 segundos para iniciar o WebSocket.

## Verificação opcional de disponibilidade

Antes de abrir o modal, o frontend pode chamar `GET /api/conectado`. Essa rota verifica se o backend consegue acessar diretamente o Portal RDP. Use o resultado para exibir disponibilidade/indisponibilidade; não use essa verificação como substituta do POST de criação de token do gateway, que é a etapa necessária para iniciar uma sessão RDP.

## Checklist

- [ ] Implementar no backend principal o BFF autenticado para `/api/remote-session/token`.
- [ ] Guardar `API_BEARER_TOKEN` apenas no ambiente do gateway/backend.
- [ ] Garantir que o campo Host permaneça fixo em `ts.datacore.com.br` e que somente a porta permitida seja enviada.
- [ ] Validar autorização do usuário antes de encaminhar credenciais.
- [ ] Carregar `guacamole-common-js` de origem aprovada.
- [ ] Mostrar o elemento de display dentro do modal, com teclado, mouse, estado de conexão e encerramento ao fechar.
- [ ] Usar HTTPS e WSS em produção.
- [ ] Não gravar senha, tokens de integração, tokens de sessão ou URLs WebSocket com token em logs.
