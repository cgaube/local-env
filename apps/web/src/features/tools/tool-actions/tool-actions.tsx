import { useState } from 'react'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { VariablesButton } from '#ui/features/tools/variables-button'
import { VariablesSheet } from '#ui/features/tools/variables-sheet'
import { InstallButton } from '#ui/features/tools/install-button'
import { toolInputs } from '#ui/features/tools/tools.ts'

// The page header's actions on the Tools and Profiles pages: Variables,
// shown when the tools take values or values are saved, and Install. The
// install dialog opens the same Variables sheet when a value is missing.
export function ToolActions() {
  const { tools } = useLiveData()
  const [open, setOpen] = useState(false)
  const inputs = tools ? toolInputs(tools) : null
  const shown =
    inputs !== null &&
    (inputs.inputs.length > 0 ||
      inputs.secrets.length > 0 ||
      inputs.unused.length > 0)

  return (
    <div className="flex items-center gap-2">
      {shown ? (
        <VariablesButton
          missing={inputs.missing.length + inputs.secrets.length}
          onClick={() => setOpen(true)}
        />
      ) : null}
      <InstallButton onOpenVariables={shown ? () => setOpen(true) : null} />
      {tools ? (
        <VariablesSheet tools={tools} open={open} onOpenChange={setOpen} />
      ) : null}
    </div>
  )
}
