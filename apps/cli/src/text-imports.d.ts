// Files imported as text (`with { type: 'text' }`): Bun inlines them, in the
// compiled binary too
declare module '*.py' {
  const text: string
  export default text
}
