// utils/guacamole.ts

export function encodeGuacId(connectionId: string, dataSource: string): string {
  const raw = `${connectionId}\x00c\x00${dataSource}`
  return Buffer.from(raw, 'utf8').toString('base64url')
}

export function gerarUrlConexao(
  publicUrl: string,
  connectionId: string,
  dataSource: string,
  authToken: string,
): string {
  const encoded = encodeGuacId(connectionId, dataSource)
  return `${publicUrl.replace(/\/$/, '')}/#/client/${encoded}?token=${authToken}`
}

export function extrairUsernameDoEmail(email: string): string {
  const parte = email.trim().split('@')[0]
  return (parte ?? '').toLowerCase()
}

export function normalizarNomeHost(name: string): string {
  return name.trim().toLowerCase()
}

export function validarHostname(hostname: string): boolean {
  return /^[a-zA-Z0-9._-]{1,128}$/.test(hostname)
}

export function validarPorta(porta: number | string): boolean {
  const n = Number(porta)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}