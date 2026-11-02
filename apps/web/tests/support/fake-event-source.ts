// Stands in for the server's /api/events stream: a test sends the lists
type Handler = (event: MessageEvent<string>) => void

export class FakeEventSource {
  handlers = new Map<string, Handler[]>()
  closed = false

  addEventListener(type: string, handler: Handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler])
  }

  close() {
    this.closed = true
  }

  emit(type: string, data?: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) })
    for (const handler of this.handlers.get(type) ?? []) handler(event)
  }
}
