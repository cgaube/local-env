export type DockhandStepResult = 'created' | 'updated' | 'unchanged'

// Each step must be idempotent: setup can run any number of times
export type DockhandStep = {
  name: string
  run: () => Promise<DockhandStepResult>
}
