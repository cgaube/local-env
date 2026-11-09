import { RefreshCwIcon } from 'lucide-react'
import { Badge } from '#ui/components/ui/badge'
import { Button } from '#ui/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import { Skeleton } from '#ui/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import {
  kindLabel,
  loginsSummary,
  stateLabel,
  useLogins,
} from '#ui/features/logins/logins.ts'
import type { LoginRow } from '#services/dashboard/agent-protocol.ts'

const StateBadge = ({ state }: { state: LoginRow['state'] }) => (
  <Badge
    variant={
      state === 'logged-in'
        ? 'secondary'
        : state === 'unknown'
          ? 'outline'
          : 'destructive'
    }
  >
    {stateLabel(state)}
  </Badge>
)

// What to do about a login: as whom when logged in, else the command to run
// in a terminal and the help of the source
const LoginDetail = ({ login }: { login: LoginRow }) => (
  <div className="flex flex-col gap-2">
    {login.detail ? (
      <span className="text-muted-foreground text-xs break-all">
        {login.detail}
      </span>
    ) : null}
    {login.command ? <CodeSnippet code={login.command} /> : null}
    {login.help ? (
      <span className="text-muted-foreground text-xs">{login.help}</span>
    ) : null}
  </div>
)

// On the overview: the accounts that the sources need (registries, AWS,
// Vault) and whether you are logged in. The dashboard logs in to nothing: a
// login opens a browser or asks for a password, in your own terminal.
export function LoginsCard() {
  const { data, isPending, isFetching, refetch } = useLogins()

  // No source needs a login: nothing to show
  if (data?.available && data.logins.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logins</CardTitle>
        <CardDescription>
          {isPending
            ? 'Checking your logins…'
            : !data?.available
              ? 'The dashboard agent checks them on your Mac: start it'
              : loginsSummary(data.logins)}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {isFetching ? 'Checking…' : 'Refresh'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-6" />
        ) : !data?.available ? (
          <CodeSnippet code="local-env start" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Login</TableHead>
                <TableHead>Sources</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="w-1/2">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.logins.map((login) => (
                <TableRow key={`${login.type}:${login.title}:${login.name}`}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{login.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {kindLabel(login.type)} · {login.title}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{login.sources.join(', ')}</TableCell>
                  <TableCell>
                    <StateBadge state={login.state} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <LoginDetail login={login} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
