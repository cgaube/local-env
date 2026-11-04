import { buildPortSetting } from '#cli/core/settings/build-port.js'
import { domainSetting } from '#cli/core/settings/domain.js'
import type { Setting } from '#cli/core/settings/types.js'

// In the order the setup wizard asks for them
export const settings: Setting[] = [domainSetting, buildPortSetting]

export const findSetting = (key: string) =>
  settings.find((setting) => setting.key === key)
