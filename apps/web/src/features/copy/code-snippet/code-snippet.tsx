import { CopyButton } from '../copy-button'

// Copies the code without its explanatory `# …` comments
const withoutComments = (code: string) => code.replace(/ +#.*$/gm, '').trimEnd()

export function CodeSnippet({ code }: { code: string }) {
  return (
    <div className="bg-muted relative rounded-md">
      <pre className="overflow-x-auto p-3 pr-24 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton text={withoutComments(code)} />
      </div>
    </div>
  )
}
