// Stands in for the dashboard agent's /api/terminal WebSocket: a test says
// what the agent sends, and reads what the page sent
import type {
  ClientMessage,
  ServerMessage,
} from '#services/dashboard/agent-protocol.ts'

export class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  // Every socket the page opened, the last one last
  static sockets: FakeWebSocket[] = []

  url: string
  readyState = FakeWebSocket.CONNECTING
  binaryType = 'blob'
  sent: ClientMessage[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.sockets.push(this)
  }

  static last() {
    return FakeWebSocket.sockets.at(-1)!
  }

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }

  // The agent's side
  accept() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  print(text: string) {
    this.onmessage?.({ data: new TextEncoder().encode(text).buffer })
  }

  // The dashboard restarts during `update`
  drop() {
    this.close()
  }
}
