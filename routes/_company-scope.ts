import { isHostGroupAllowed } from '../config/company-host-groups.js'
import { ZabbixService } from '../services/zabbix.service.js'

export async function getAllowedCompanyGroups(allowedHostGroups: readonly string[]) {
  if (allowedHostGroups.length === 0) return []
  const groups = await ZabbixService.listarGrupos()
  return groups.filter((group) => isHostGroupAllowed(group.name, allowedHostGroups))
}

export async function isCompanyGroupKeyAllowed(
  key: string,
  allowedHostGroups: readonly string[],
): Promise<boolean> {
  if (allowedHostGroups.length === 0) return false
  const normalizedKey = key.trim()
  if (!/^\d+$/.test(normalizedKey)) {
    return isHostGroupAllowed(normalizedKey, allowedHostGroups)
  }

  const groups = await ZabbixService.listarGrupos()
  const group = groups.find((item) => item.groupid === BigInt(normalizedKey).toString())
  return group !== undefined && isHostGroupAllowed(group.name, allowedHostGroups)
}
