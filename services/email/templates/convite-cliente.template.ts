export const ASSUNTO_CONVITE_CLIENTE = 'Solicitação de acesso ao Portal de Monitoramento — DataCore'

export interface ConviteClienteParams {
  nome: string
  email: string
  grupo: string
  urlAtivacao: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character]!
  })
}

export function renderConviteCliente({ nome, email, grupo, urlAtivacao }: ConviteClienteParams): {
  html: string
  texto: string
} {
  const safeName = escapeHtml(nome)
  const safeEmail = escapeHtml(email)
  const safeGroup = escapeHtml(grupo)
  const safeUrl = escapeHtml(urlAtivacao)

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Convite DataCore</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#243247;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f5f8;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:26px 32px;background-color:#12345a;color:#ffffff;font-size:22px;font-weight:bold;">DataCore <span style="font-size:14px;font-weight:normal;">| Portal de Monitoramento</span></td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 20px;font-size:22px;line-height:1.35;color:#12345a;">Solicitação de acesso</h1>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Prezado(a), ${safeName},</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Você recebeu uma solicitação de acesso ao Portal de Monitoramento da DataCore. Seu cadastro foi criado e está aguardando ativação.</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">Para concluir a configuração do seu acesso, clique no botão abaixo e defina sua senha pessoal.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px;">
                <tr>
                  <td align="center" bgcolor="#087a63" style="border-radius:4px;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 26px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">ATIVAR MEU ACESSO</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#526174;">Se o botão não funcionar, copie e cole este link no navegador:</p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${safeUrl}" style="color:#087a63;">${safeUrl}</a></p>
              <p style="margin:0 0 22px;padding:14px;background-color:#f4f7fa;border-left:3px solid #e4a126;font-size:13px;line-height:1.6;">Este link é exclusivo, de uso único e possui validade de 24 horas a partir da emissão do convite. Após acessá-lo, você deverá cadastrar e confirmar sua senha para habilitar sua conta.</p>
              <h2 style="margin:0 0 12px;font-size:16px;color:#12345a;">Informações do acesso</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:1.6;">
                <tr><td style="padding:5px 0;font-weight:bold;">Nome:</td><td style="padding:5px 0;">${safeName}</td></tr>
                <tr><td style="padding:5px 0;font-weight:bold;">E-mail:</td><td style="padding:5px 0;">${safeEmail}</td></tr>
                <tr><td style="padding:5px 0;font-weight:bold;">Grupo de monitoramento:</td><td style="padding:5px 0;">${safeGroup}</td></tr>
              </table>
              <p style="margin:24px 0 0;font-size:14px;line-height:1.6;">Caso o link expire antes da ativação, solicite ao administrador o envio de um novo convite.<br>Se você não reconhece esta solicitação, entre em contato com o administrador responsável.</p>
              <p style="margin:22px 0 0;font-size:14px;line-height:1.6;">Atenciosamente,<br><strong>Equipe DataCore</strong><br>Portal de Monitoramento</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background-color:#f3f5f8;color:#68778a;font-size:12px;line-height:1.5;">Mensagem automática do Portal de Monitoramento DataCore. Não responda diretamente a este e-mail.</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const texto = `Prezado(a), ${nome},

Você recebeu uma solicitação de acesso ao Portal de Monitoramento da DataCore.
Seu cadastro foi criado e está aguardando ativação.

Para concluir a configuração do seu acesso, defina sua senha neste link:
${urlAtivacao}

Este link é exclusivo, de uso único e possui validade de 24 horas a partir da emissão do convite.
Após acessar o link, você deverá cadastrar e confirmar sua senha para habilitar sua conta.

Informações do acesso
- Nome: ${nome}
- E-mail: ${email}
- Grupo de monitoramento: ${grupo}

Caso o link expire antes da ativação, solicite ao administrador o envio de um novo convite.
Se você não reconhece esta solicitação, entre em contato com o administrador responsável.

Atenciosamente,
Equipe DataCore
Portal de Monitoramento`

  return { html, texto }
}
