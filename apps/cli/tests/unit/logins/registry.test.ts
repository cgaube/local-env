import { ecrRegion, fixedUsername } from '#cli/logins/registry.js'

const ECR = '123456789012.dkr.ecr.us-east-1.amazonaws.com'

describe('ecrRegion', () => {
  test('reads the region of an ECR host', () => {
    expect(ecrRegion(ECR)).toBe('us-east-1')
    expect(
      ecrRegion('123456789012.dkr.ecr-fips.us-gov-west-1.amazonaws.com'),
    ).toBe('us-gov-west-1')
    expect(ecrRegion('123456789012.dkr.ecr.cn-north-1.amazonaws.com.cn')).toBe(
      'cn-north-1',
    )
  })

  test('is undefined for other hosts', () => {
    expect(ecrRegion('ghcr.io')).toBeUndefined()
    expect(ecrRegion('public.ecr.aws')).toBeUndefined()
    expect(ecrRegion('12345.dkr.ecr.us-east-1.amazonaws.com')).toBeUndefined()
  })
})

describe('fixedUsername', () => {
  test('is AWS for an ECR host', () => {
    expect(fixedUsername(ECR)).toBe('AWS')
  })

  test('is undefined for other hosts: the user gives one', () => {
    expect(fixedUsername('ghcr.io')).toBeUndefined()
  })
})
