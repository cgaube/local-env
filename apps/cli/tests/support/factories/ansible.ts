// What `ansible-playbook` prints with Ansible's ansible.posix.jsonl callback:
// one event a line, as src/core/playbook-output.ts reads them

export type TaskFixture = {
  // The role's folder, as the playbook names a plain role by path, or a
  // collection's role by its full name
  role: string
  task: string
  result: 'ok' | 'changed' | 'skipped' | 'failed'
  msg?: string
  stderr?: string
  // A loop: the result of each item, nested in the task's result
  items?: ItemFixture[]
}

export type ItemFixture = {
  // loop_control.label, else the item
  label: unknown
  result: 'ok' | 'changed' | 'skipped' | 'failed'
  msg?: string
  stderr?: string
}

// As ansible-core 2.19+ sends an item: no `failed` flag, an `exception` on a
// failed one, a `skip_reason` on a skipped one
const itemResult = ({ label, result, msg, stderr }: ItemFixture) => ({
  item: label,
  _ansible_item_label: label,
  ansible_loop_var: 'item',
  changed: result === 'changed',
  ...(result === 'failed' ? { exception: 'Traceback…' } : {}),
  ...(result === 'skipped'
    ? { skip_reason: 'Conditional result was False' }
    : {}),
  ...(msg ? { msg } : {}),
  ...(stderr ? { stderr } : {}),
})

const RESULT_EVENTS = {
  ok: 'v2_runner_on_ok',
  changed: 'v2_runner_on_ok',
  skipped: 'v2_runner_on_skipped',
  failed: 'v2_runner_on_failed',
} as const

export const playbookEvents = (tasks: TaskFixture[]) =>
  [
    { _event: 'v2_playbook_on_play_start', play: { name: 'local-env tools' } },
    // Ansible's own step, before the roles
    { _event: 'v2_playbook_on_task_start', task: { name: 'Gathering Facts' } },
    {
      _event: 'v2_runner_on_ok',
      task: { name: 'Gathering Facts' },
      hosts: { localhost: { changed: false } },
    },
    ...tasks.flatMap(({ role, task, result, msg, stderr, items }) => {
      const name = `../sources/acme/ansible/${role} : ${task}`
      return [
        { _event: 'v2_playbook_on_task_start', task: { name } },
        {
          _event: RESULT_EVENTS[result],
          task: { name },
          hosts: {
            localhost: {
              changed: result === 'changed',
              ...(msg ? { msg } : {}),
              ...(stderr ? { stderr } : {}),
              ...(items ? { results: items.map(itemResult) } : {}),
            },
          },
        },
      ]
    }),
    { _event: 'v2_playbook_on_stats', stats: {} },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n') + '\n'
