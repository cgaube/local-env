import { TriangleAlertIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import {
  inputText,
  parseInputText,
  type WantedInput,
} from '#services/dashboard/role-graph.ts'
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert'
import { Badge } from '#ui/components/ui/badge'
import { Button } from '#ui/components/ui/button'
import { FieldGroup } from '#ui/components/ui/field'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#ui/components/ui/sheet'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#ui/components/ui/tabs'
import type { Tools } from '#ui/features/live-data/live-data.ts'
import { InputField } from '#ui/features/tools/input-field'
import { RoleInputPanel } from '#ui/features/tools/role-input-panel'
import { currentProfile, toolInputs } from '#ui/features/tools/tools.ts'
import { useVariables } from '#ui/features/tools/use-variables.ts'

// The fields by role. The profile's group is first, and holds all its
// values: the inputs it declares and the ones it sets for its tools. Any
// other input is a field of the first role that declares it. Each field
// names the other roles that use it.
const groupInputs = (inputs: WantedInput[], profile: string | null) => {
  const groupOf = ({ roles, setBy }: WantedInput) =>
    profile !== null && (roles.includes(profile) || setBy.includes(profile))
      ? profile
      : roles[0]!
  const labels = [...new Set(inputs.map(groupOf))].sort(
    (a, b) => Number(b === profile) - Number(a === profile),
  )
  return labels.map((label) => ({
    label,
    inputs: inputs.filter((input) => groupOf(input) === label),
  }))
}

// The group of saved values whose role left the sources
const NO_ROLE = 'No role declares them'

// A saved value as one line of text
const valueText = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value)

// The values of the variables of every tool the next install runs, in one
// form: Ansible's variables are global, so a variable is one field, which
// says which roles use it, and whether they declare it differently. A value
// that a role which runs sets for another (`vars:` of its dependency entry)
// shows disabled: its owner chose it. Saved values that no wanted tool
// takes are in the Saved tab, by role: kept for a later profile or pick. A select or a
// switch saves at once; a text field when it loses the focus, on Enter, or
// when the sheet closes. Only Save or Escape closes it, not a click outside:
// a value can't go unsaved by a stray click.
export function VariablesSheet({
  tools,
  open,
  onOpenChange,
}: {
  tools: Tools
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { variables, setValues, error } = useVariables(tools.variables)
  // With the values just set, before the stream sends them back
  const { inputs, missing, secrets, unused } = toolInputs({
    ...tools,
    variables,
  })
  // The text typed in each field and not saved yet, and why one can't be
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  // The panels folded or not, by role, as the user left them
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const byName = new Map(inputs.map((input) => [input.name, input]))

  // The drafts of these fields as values, or the errors that stop them. A
  // draft that is the saved text changes nothing.
  const parseDrafts = (names: string[]) => {
    const changes: Record<string, unknown> = {}
    const refused: Record<string, string> = {}
    for (const name of names) {
      const input = byName.get(name)
      const text = drafts[name]
      if (!input || text === undefined) continue
      if (text === inputText(input, variables[name])) continue
      const parsed = parseInputText(input, text)
      if ('error' in parsed) refused[name] = parsed.error
      else changes[name] = parsed.value
    }
    return { changes, refused }
  }

  // Saves these drafts. false when one can't be saved: it says why.
  const commit = (names: string[]) => {
    const { changes, refused } = parseDrafts(names)
    const others = (map: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(map).filter(([name]) => !names.includes(name)),
      )
    setErrors({ ...others(errors), ...refused })
    setDrafts({
      ...others(drafts),
      ...Object.fromEntries(
        Object.keys(refused).map((name) => [name, drafts[name]!]),
      ),
    })
    setValues(changes)
    return Object.keys(refused).length === 0
  }

  // Save or Escape: every draft saved first. One that can't be keeps the
  // sheet open.
  const close = () => {
    if (!commit(Object.keys(drafts))) return
    setDrafts({})
    setErrors({})
    onOpenChange(false)
  }

  // A required value typed and not saved yet is no longer missing
  const typed = parseDrafts(Object.keys(drafts)).changes
  const missingNames = new Set(
    missing
      .filter(({ name }) => typed[name] === undefined)
      .map(({ name }) => name),
  )
  const groups = groupInputs(inputs, currentProfile(tools)?.label ?? null)
  // The values no wanted role takes, by the role that declares them: the
  // profiles first, as on the other tab, and the roles gone from the
  // sources last
  const profiles = new Set(
    tools.roles.filter((role) => role.isProfile).map(({ label }) => label),
  )
  const rank = (label: string) =>
    label === NO_ROLE ? 2 : profiles.has(label) ? 0 : 1
  const unusedGroups = [...new Set(unused.map(({ role }) => role ?? NO_ROLE))]
    .sort((a, b) => rank(a) - rank(b))
    .map((label) => ({
      label,
      values: unused.filter(({ role }) => (role ?? NO_ROLE) === label),
    }))

  const fieldsOf = (group: ReturnType<typeof groupInputs>[number]) => (
    <FieldGroup>
      {group.inputs.map((input) => (
        <InputField
          key={input.name}
          input={input}
          group={group.label}
          value={variables[input.name]}
          draft={drafts[input.name]}
          error={errors[input.name] ?? null}
          missing={missingNames.has(input.name)}
          onChange={(value) => setValues({ [input.name]: value })}
          onDraft={(text) => setDrafts({ ...drafts, [input.name]: text })}
          onCommit={() => commit([input.name])}
        />
      ))}
    </FieldGroup>
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      disablePointerDismissal
    >
      {/* With the sheet's own modifiers, so it replaces its narrow width */}
      <SheetContent className="data-[side=right]:sm:max-w-3xl">
        {/* Lines between the title, the fields and Save: the fields scroll */}
        <SheetHeader className="border-b">
          <SheetTitle>Variables</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-4">
          {/* In the body, under the title's line: it scrolls with the fields */}
          <SheetDescription>
            The values your tools need. local-env install gives them to Ansible.
            Without a value, a role uses its own default. A variable is shared
            by every role that uses it.
          </SheetDescription>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Your value wasn't saved</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}
          {secrets.length > 0 ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Secrets that no source gives</AlertTitle>
              <AlertDescription>
                {secrets
                  .map(({ name, roles }) => `${name} (${roles.join(', ')})`)
                  .join(', ')}
                . The install stops before it runs. Their source can give them
                from a vault, in the secrets of its local-env.yml.
              </AlertDescription>
            </Alert>
          ) : null}
          <Tabs defaultValue="used">
            <TabsList>
              <TabsTrigger value="used">
                Your tools
                <Badge variant="secondary">{inputs.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="unused">
                Saved
                <Badge variant="secondary">{unused.length}</Badge>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="used" className="flex flex-col gap-2 pt-2">
              {inputs.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  The tools you install take no values.
                </p>
              ) : (
                groups.map((group, index) => {
                  const names = group.inputs.map(({ name }) => name)
                  const missingHere = names.filter((name) =>
                    missingNames.has(name),
                  ).length
                  const refused = names.some((name) => name in errors)
                  return (
                    <RoleInputPanel
                      key={group.label}
                      label={group.label}
                      count={group.inputs.length}
                      missing={missingHere}
                      // A value it can't save shows, even folded before
                      open={
                        refused ||
                        (openGroups[group.label] ??
                          (index === 0 || missingHere > 0))
                      }
                      onOpenChange={(next) =>
                        setOpenGroups({ ...openGroups, [group.label]: next })
                      }
                    >
                      {fieldsOf(group)}
                    </RoleInputPanel>
                  )
                })
              )}
            </TabsContent>
            <TabsContent value="unused" className="flex flex-col gap-2 pt-2">
              <p className="text-muted-foreground text-sm">
                Saved for a profile or a tool you no longer install. They come
                back when you install it again.
              </p>
              {unusedGroups.map((group) => (
                <RoleInputPanel
                  key={group.label}
                  label={group.label}
                  count={group.values.length}
                  missing={0}
                  open={openGroups[`unused:${group.label}`] ?? false}
                  onOpenChange={(next) =>
                    setOpenGroups({
                      ...openGroups,
                      [`unused:${group.label}`]: next,
                    })
                  }
                >
                  <ul className="flex flex-col gap-1">
                    {group.values.map(({ name, value }) => (
                      <li
                        key={name}
                        className="flex items-center gap-2 text-sm"
                      >
                        <code className="font-mono select-text">{name}</code>
                        <span className="text-muted-foreground truncate">
                          {valueText(value)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="ml-auto"
                          aria-label={`Remove ${name}`}
                          onClick={() => setValues({ [name]: undefined })}
                        >
                          <XIcon />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </RoleInputPanel>
              ))}
            </TabsContent>
          </Tabs>
        </div>
        {/* Its column stretches the button to the full width */}
        <SheetFooter className="border-t">
          <Button onClick={close}>Save</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
