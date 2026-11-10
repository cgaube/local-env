// Edits whole sections of an INI file (~/.aws/config) and keeps the rest of
// it as it is: the user's own sections, comments and blank lines.

export type IniSection = {
  // What is between the brackets: `profile acme`, `sso-session acme`
  header: string
  values: Record<string, string>
}

const HEADER = /^\s*\[([^\]]+)\]\s*$/

// The headers of the sections of the file, in order
export const iniHeaders = (content: string) =>
  content.split('\n').flatMap((line) => {
    const match = HEADER.exec(line)
    return match ? [match[1]!.trim()] : []
  })

// The values of one section, or null when the file has none of that name
export const readIniSection = (
  content: string,
  header: string,
): Record<string, string> | null => {
  let inside = false
  let values: Record<string, string> | null = null
  for (const line of content.split('\n')) {
    const match = HEADER.exec(line)
    if (match) {
      inside = match[1]!.trim() === header
      if (inside) values = {}
      continue
    }
    if (!inside || !values) continue
    const pair = /^\s*([^#;=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line)
    if (pair) values[pair[1]!] = pair[2]!
  }
  return values
}

const format = ({ header, values }: IniSection) =>
  [
    `[${header}]`,
    ...Object.entries(values).map(([key, value]) => `${key} = ${value}`),
  ].join('\n')

// The file without these sections (by header): each one up to the next
// header, its trailing blank lines included
export const removeIniSections = (content: string, headers: string[]) => {
  const remove = new Set(headers)
  const kept: string[] = []
  let skipping = false
  for (const line of content.split('\n')) {
    const match = HEADER.exec(line)
    if (match) skipping = remove.has(match[1]!.trim())
    if (!skipping) kept.push(line)
  }
  return kept.join('\n')
}

// The file with these sections in it: each one in place of the section of
// the same header, or added at the end
export const writeIniSections = (content: string, sections: IniSection[]) => {
  let result = content
  for (const section of sections) {
    const lines = result.split('\n')
    const start = lines.findIndex(
      (line) => HEADER.exec(line)?.[1]?.trim() === section.header,
    )
    if (start === -1) {
      const body = result.replace(/\n+$/, '')
      result = `${body}${body ? '\n\n' : ''}${format(section)}\n`
      continue
    }
    let end = lines.findIndex(
      (line, index) => index > start && HEADER.test(line),
    )
    if (end === -1) end = lines.length
    // Keeps the blank lines before the next section
    while (end - 1 > start && lines[end - 1]!.trim() === '') end -= 1
    result = [
      ...lines.slice(0, start),
      format(section),
      ...lines.slice(end),
    ].join('\n')
  }
  return result
}
