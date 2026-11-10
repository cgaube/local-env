import { useId } from 'react'
import { inputText, type WantedInput } from '#services/dashboard/role-graph.ts'
import { Badge } from '#ui/components/ui/badge'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '#ui/components/ui/field'
import { Input } from '#ui/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#ui/components/ui/select'
import { Switch } from '#ui/components/ui/switch'

// What a control gets: the value saved, or undefined for none (the role's
// default applies), and the text typed and not saved yet, if any. A select
// or a switch saves at once (onChange); a text field keeps its text as a
// draft (onDraft) and saves it when it loses the focus or on Enter
// (onCommit), or when the sheet closes.
type ControlProps = {
  id: string
  labelId: string
  input: WantedInput
  value: unknown
  draft: string | undefined
  invalid: boolean
  onChange: (value: unknown) => void
  onDraft: (text: string) => void
  onCommit: () => void
}

const placeholderOf = (input: WantedInput) =>
  input.default === undefined ? undefined : inputText(input, input.default)

function TextControl({
  id,
  input,
  value,
  draft,
  invalid,
  onDraft,
  onCommit,
}: ControlProps) {
  return (
    <Input
      id={id}
      value={draft ?? inputText(input, value)}
      placeholder={placeholderOf(input)}
      aria-invalid={invalid || undefined}
      onChange={(event) => onDraft(event.currentTarget.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit()
      }}
    />
  )
}

function NumberControl({
  id,
  input,
  value,
  draft,
  invalid,
  onDraft,
  onCommit,
}: ControlProps) {
  const whole = input.type === 'int'
  return (
    <Input
      id={id}
      type="number"
      inputMode={whole ? 'numeric' : 'decimal'}
      step={whole ? 1 : 'any'}
      value={draft ?? inputText(input, value)}
      placeholder={placeholderOf(input)}
      aria-invalid={invalid || undefined}
      onChange={(event) => onDraft(event.currentTarget.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit()
      }}
    />
  )
}

// Choices can be numbers: the select holds their text
function SelectControl({
  labelId,
  input,
  value,
  invalid,
  onChange,
}: ControlProps) {
  const choices = input.choices ?? []
  return (
    <Select
      value={value === undefined ? null : String(value)}
      onValueChange={(text) =>
        onChange(choices.find((choice) => String(choice) === text))
      }
    >
      <SelectTrigger
        className="w-full sm:w-64"
        aria-labelledby={labelId}
        aria-invalid={invalid || undefined}
      >
        <SelectValue placeholder={placeholderOf(input) ?? 'Pick one'} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {choices.map((choice) => (
            <SelectItem key={String(choice)} value={String(choice)}>
              {String(choice)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

// Without a value, it shows the default
function SwitchControl({ id, labelId, input, value, onChange }: ControlProps) {
  return (
    <Switch
      id={id}
      aria-labelledby={labelId}
      checked={(value ?? input.default) === true}
      onCheckedChange={(checked) => onChange(checked)}
    />
  )
}

// A value a role including it gives (`vars:` of its dependency entry):
// shown in the control of the spec, disabled. A template, or a value that
// does not fit the control, shows as written, in a text field.
function GivenControl({ id, labelId, input }: ControlProps) {
  const given = input.given
  const text =
    typeof given === 'string'
      ? given
      : given === undefined
        ? ''
        : JSON.stringify(given)
  if (input.choices?.some((choice) => choice === given)) {
    return (
      <Select value={String(given)} disabled>
        <SelectTrigger className="w-full sm:w-64" aria-labelledby={labelId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={String(given)}>{String(given)}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    )
  }
  if (input.type === 'bool' && typeof given === 'boolean') {
    return <Switch id={id} aria-labelledby={labelId} checked={given} disabled />
  }
  return (
    <Input
      id={id}
      value={input.type === 'list' ? inputText(input, given) : text}
      disabled
      readOnly
    />
  )
}

// A value the vault of the source gives (`secrets` of its manifest):
// local-env reads it at install, and the dashboard never sees it
function VaultControl({ id }: ControlProps) {
  return (
    <Input id={id} value="" placeholder="From the vault" disabled readOnly />
  )
}

// The control of the spec: a select for choices, a switch for a bool, a
// number for an int or a float, else text: a list as "a, b", a dict as
// JSON
const controlOf = (input: WantedInput) =>
  input.provided
    ? GivenControl
    : input.vault
      ? VaultControl
      : input.choices
        ? SelectControl
        : input.type === 'bool'
          ? SwitchControl
          : input.type === 'int' || input.type === 'float'
            ? NumberControl
            : TextControl

// What the field says besides its description: who sets its value, which
// other roles share the variable, and whether they declare it differently
const notes = (
  { roles, setBy, provided, vault, conflict }: WantedInput,
  group: string,
) => {
  // The roles that use it, besides the one whose group it is in
  const others = roles.filter((role) => role !== group)
  return [
    provided ? `Set by ${setBy.join(', ')}.` : null,
    vault
      ? 'From the secrets of the source: local-env reads it from the vault at install.'
      : null,
    others.length > 0
      ? `${roles.includes(group) ? 'Also used' : 'Used'} by ${others.join(', ')}.`
      : null,
    conflict
      ? `Declared differently by ${roles.join(' and ')}: one value goes to all of them.`
      : null,
  ]
}

// One input of a role (meta/argument_specs.yml): its control, from the spec,
// its description, and what is wrong with it. The sheet groups them by the
// first role that declares it.
export function InputField({
  input,
  group,
  value,
  draft,
  error,
  missing,
  onChange,
  onDraft,
  onCommit,
}: {
  input: WantedInput
  // The role of the sheet's group it is in: the field names the others
  group: string
  value: unknown
  // Typed, not saved yet
  draft: string | undefined
  // Why the text typed can't be saved: not a whole number, not JSON
  error: string | null
  // Required, without a value, for a tool the install runs
  missing: boolean
  onChange: (value: unknown) => void
  onDraft: (text: string) => void
  onCommit: () => void
}) {
  const id = useId()
  const labelId = `${id}-label`
  const Control = controlOf(input)
  return (
    <Field data-invalid={missing || error !== null || undefined}>
      <div className="flex items-center gap-2">
        {/* A variable name, to copy: shadcn's label can't be selected */}
        <FieldLabel id={labelId} htmlFor={id} className="font-mono select-text">
          {input.name}
        </FieldLabel>
        {input.required ? <Badge variant="outline">Required</Badge> : null}
      </div>
      <Control
        id={id}
        labelId={labelId}
        input={input}
        value={value}
        draft={draft}
        invalid={missing || error !== null}
        onChange={onChange}
        onDraft={onDraft}
        onCommit={onCommit}
      />
      {input.description || notes(input, group).some(Boolean) ? (
        <FieldDescription>
          {[input.description, ...notes(input, group)]
            .filter(Boolean)
            .join(' ')}
        </FieldDescription>
      ) : null}
      {error ? (
        <FieldError>{error}</FieldError>
      ) : missing ? (
        <FieldError>
          Required: set it here, or the install asks for it in the terminal.
        </FieldError>
      ) : null}
    </Field>
  )
}
