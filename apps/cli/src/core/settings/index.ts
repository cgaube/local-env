import { buildPortSetting } from './build-port.js'
import { domainSetting } from './domain.js'
import type { Setting } from './types.js'

// In the order the setup wizard asks for them
export const settings: Setting[] = [domainSetting, buildPortSetting]

export const findSetting = (key: string) =>
  settings.find((setting) => setting.key === key)
