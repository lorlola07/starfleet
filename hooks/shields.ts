// Shields: which Bash commands Tactical refuses. Pure: nothing here touches $.
//
// A seatbelt for the common ways a command destroys work, not a sandbox: the command is split into
// shell words the way the shell would (quotes, escapes, ; && || | and newlines), and only the words
// in command position are judged, so `echo "rm -rf x"` or a commit message naming a forced push is
// left alone. Nested shells (bash -c, sh -c, eval, $(…), `…`, <(…)) and wrappers (sudo, env, xargs…)
// are looked inside, and so is a here-document a shell reads. A script file the command runs is not,
// and a here-document no shell reads is text, like a quoted string.

const MAX_DEPTH = 4

// A here-document: its body, and whether it is only text: every command on its line reads stdin as
// data (cat, tee …) and the line doesn't carry on into the next (a trailing | or &&)
type HereDoc = { body: string; isText: boolean }
type Parsed = { segments: string[][]; nested: string[]; heredocs: HereDoc[]; outside: string }

// Split a command into segments of unquoted words, and collect the text of every $(…), `…` and <(…),
// and every here-document's body. `outside` is the command with the bodies taken out
export function parse(command: string): Parsed {
  const segments: string[][] = []
  const nested: string[] = []
  const heredocs: HereDoc[] = []
  const pending: { delim: string; quoted: boolean; tabs: boolean }[] = []
  let outside = ''
  let copied = 0
  let lineStart = 0
  let lineStartAt = 0
  let seg: string[] = []
  let word: string | null = null
  let i = 0
  const endWord = () => { if (word !== null) seg.push(word); word = null }
  const endSeg = () => { endWord(); if (seg.length) segments.push(seg); seg = [] }
  const add = (s: string) => { word = (word ?? '') + s }

  // From an opening paren at `from`, the index of its closing one, skipping quoted text
  const closeParen = (from: number) => {
    let depth = 0
    for (let j = from; j < command.length; j++) {
      const c = command[j]
      if (c === '\\') { j++; continue }
      if (c === "'") { j = command.indexOf("'", j + 1); if (j < 0) return command.length; continue }
      if (c === '"') { j = skipDouble(j); continue }
      if (c === '(') depth++
      if (c === ')' && --depth === 0) return j
    }
    return command.length
  }
  const skipDouble = (from: number) => {
    for (let j = from + 1; j < command.length; j++) {
      if (command[j] === '\\') { j++; continue }
      if (command[j] === '"') return j
    }
    return command.length
  }
  const substitution = (at: number): number | undefined => {
    const c = command[at]
    if ((c === '$' || c === '<' || c === '>') && command[at + 1] === '(') {
      const end = closeParen(at + 1)
      nested.push(command.slice(at + 2, end))
      add('$(…)')
      return end + 1
    }
    if (c === '`') {
      let end = at + 1
      while (end < command.length && command[end] !== '`') end += command[end] === '\\' ? 2 : 1
      nested.push(command.slice(at + 1, end))
      add('$(…)')
      return end + 1
    }
    return undefined
  }

  // The delimiter word after << (or <<-) at `from`: quotes and escapes are taken off, and any of them
  // makes it a quoted delimiter
  const delimiter = (from: number) => {
    let j = from
    while (command[j] === ' ' || command[j] === '\t') j++
    let delim = ''
    let quoted = false
    while (j < command.length && !/[\s;&|<>()]/.test(command[j]!)) {
      const c = command[j]!
      if (c === "'" || c === '"') {
        const end = command.indexOf(c, j + 1)
        delim += command.slice(j + 1, end < 0 ? undefined : end)
        quoted = true
        j = end < 0 ? command.length : end + 1
      } else if (c === '\\') {
        delim += command[j + 1] ?? ''
        quoted = true
        j += 2
      } else {
        delim += c
        j++
      }
    }
    return { delim, quoted, end: j }
  }

  // At the start of the line after a here-document's command: read each pending body up to its
  // delimiter line. An unquoted body still runs its $(…) and `…`, so those are collected
  const readBodies = () => {
    const line = segments.slice(lineStart)
    const carriesOn = /[|&]$/.test(command.slice(lineStartAt, i - 1).trimEnd())
    const isText = !carriesOn && line.length > 0
      && line.every(words => TEXT_READERS.has(nameOf(words.find(w => !ASSIGNMENT.test(w)) ?? '')))
    for (const doc of pending.splice(0)) {
      const start = i
      const lines: string[] = []
      while (i < command.length) {
        const nl = command.indexOf('\n', i)
        const text = command.slice(i, nl < 0 ? undefined : nl)
        i = nl < 0 ? command.length : nl + 1
        if ((doc.tabs ? text.replace(/^\t+/, '') : text) === doc.delim) break
        lines.push(text)
      }
      if (!doc.quoted) {
        const saved = word
        for (let j = start; j < i; j++) {
          if (command[j] === '\\') { j++; continue }
          const end = substitution(j)
          if (end !== undefined) j = end - 1
        }
        word = saved
      }
      heredocs.push({ body: lines.join('\n'), isText })
      outside += command.slice(copied, start)
      copied = i
    }
    lineStart = segments.length
    lineStartAt = i
  }

  while (i < command.length) {
    const c = command[i]!
    const sub = substitution(i)
    if (sub !== undefined) { i = sub; continue }
    if (c === '\\') { if (command[i + 1] !== '\n') add(command[i + 1] ?? ''); i += 2; continue }
    if (c === '$' && command[i + 1] === "'") {
      // $'…' is ANSI-C quoting: $'\x72\x6d' is rm, and \' does not end it
      let end = i + 2
      while (end < command.length && command[end] !== "'") end += command[end] === '\\' ? 2 : 1
      add(decodeAnsiC(command.slice(i + 2, end)))
      i = end + 1
      continue
    }
    if (c === "'") {
      const end = command.indexOf("'", i + 1)
      add(command.slice(i + 1, end < 0 ? undefined : end))
      i = end < 0 ? command.length : end + 1
      continue
    }
    // ${ … } is one word, kept as written: a << in it is never a here-document. Any $(…) or `…` inside
    // still runs, so those are collected
    if (c === '$' && command[i + 1] === '{') {
      let end = i + 2
      for (let depth = 1; end < command.length; end++) {
        if (command[end] === '\\') { end++; continue }
        if (command[end] === '{') depth++
        if (command[end] === '}' && --depth === 0) break
      }
      const saved = word
      for (let j = i + 2; j < end; j++) {
        if (command[j] === '\\') { j++; continue }
        const after = substitution(j)
        if (after !== undefined) j = after - 1
      }
      word = saved
      add(command.slice(i, end + 1))
      i = end + 1
      continue
    }
    // Arithmetic, (( … )) or $[ … ], is one word: a << in it is a shift, never a here-document. Any
    // $(…) or `…` inside still runs, so those are collected
    if ((c === '(' && command[i + 1] === '(') || (c === '$' && command[i + 1] === '[')) {
      let end = c === '(' ? closeParen(i) : command.indexOf(']', i + 2)
      if (end < 0) end = command.length
      const saved = word
      for (let j = i + 2; j < end; j++) {
        if (command[j] === '\\') { j++; continue }
        const after = substitution(j)
        if (after !== undefined) j = after - 1
      }
      word = saved
      // bash rereads a (( that isn't arithmetic as two subshells, so the inside is judged as commands too
      if (c === '(') nested.push(command.slice(i + 1, end))
      endWord()
      add('((…))')
      i = end + 1
      continue
    }
    // << starts a here-document (<<< is a here-string, an ordinary word)
    if (c === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      endWord()
      const tabs = command[i + 2] === '-'
      const { delim, quoted, end } = delimiter(i + (tabs ? 3 : 2))
      if (delim) pending.push({ delim, quoted, tabs })
      i = end
      continue
    }
    if (c === '"') {
      add('')
      i++
      while (i < command.length && command[i] !== '"') {
        const inner = substitution(i)
        if (inner !== undefined) { i = inner; continue }
        if (command[i] === '\\' && '$`"\\\n'.includes(command[i + 1] ?? '')) { add(command[i + 1]!); i += 2; continue }
        add(command[i]!)
        i++
      }
      i++
      continue
    }
    if (c === '#' && word === null) { while (i < command.length && command[i] !== '\n') i++; continue }
    if (c === '\n') { endSeg(); i++; readBodies(); continue }
    if (';&|()'.includes(c)) { endSeg(); i++; continue }
    if (/\s/.test(c)) { endWord(); i++; continue }
    add(c)
    i++
  }
  endSeg()
  outside += command.slice(copied)
  return { segments, nested, heredocs, outside }
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v' }
function decodeAnsiC(body: string): string {
  return body.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|c.|.)/g, (_, esc: string) => {
    if (/^[xuU]/.test(esc)) return String.fromCodePoint(parseInt(esc.slice(1), 16))
    if (/^[0-7]/.test(esc)) return String.fromCharCode(parseInt(esc, 8))
    if (esc[0] === 'c') return String.fromCharCode(esc.charCodeAt(1) & 31)
    return ESCAPES[esc] ?? esc
  })
}

// The reason Tactical refuses the command, or undefined when it may run
export function hostileReason(command: string, depth = 0): string | undefined {
  if (depth > MAX_DEPTH) return 'a command nested too deep to read'
  const { segments, nested, heredocs, outside } = parse(command)
  for (const words of segments) {
    const reason = judge(words, depth)
    if (reason) return reason
  }
  for (const inner of nested) {
    const reason = hostileReason(inner, depth + 1)
    if (reason) return reason
  }
  // A here-document's body is judged as commands (fail closed) unless it is only text: a shell, eval,
  // a wrapper or a pipe on its line could run it
  for (const doc of heredocs) {
    const reason = doc.isText ? undefined : hostileReason(doc.body, depth + 1)
    if (reason) return reason
  }
  // Each line outside the here-documents on its own too, so a stray quote can't hide the lines after
  // it: fail closed, at the cost of judging a multi-line string's lines
  if (outside.includes('\n')) {
    for (const line of outside.split('\n')) {
      const reason = line.trim() ? hostileReason(line, depth + 1) : undefined
      if (reason) return reason
    }
  }
  return undefined
}

export function isHostile(command: string): boolean {
  return hostileReason(command) !== undefined
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
// Wrappers that run the command after them, and their options that take a value
const WRAPPERS: Record<string, string[]> = {
  sudo: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U'],
  doas: ['-u', '-C'],
  env: ['-u', '-C', '-S'],
  nice: ['-n'],
  nohup: [],
  time: [],
  command: [],
  builtin: [],
  exec: ['-a'],
  timeout: ['-s', '-k'],
  xargs: ['-n', '-I', '-L', '-P', '-d', '-s', '-E', '-a'],
  watch: ['-n', '-d'],
  caffeinate: ['-t', '-w'],
  stdbuf: ['-i', '-o', '-e'],
  ionice: ['-c', '-n', '-p'],
  chronic: [],
  unbuffer: [],
  strace: ['-e', '-o', '-p', '-s', '-u'],
  ltrace: ['-e', '-o', '-p', '-s', '-u'],
  gtimeout: ['-s', '-k'],
}
// Commands that run a command given as a string after -c
const RUNS_STRING = new Set(['su', 'runuser', 'script'])
// Commands whose arguments are only text: a word like rm among them is never run
const TEXT_ONLY = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'cat', 'less', 'more', 'head', 'tail', 'man', 'which', 'type', 'whatis', 'apropos', 'tldr', 'gh', 'jq', 'sed', 'awk', 'wc', 'sort', 'uniq', 'tr', 'cut', 'diff', 'test', '['])
const JUDGED = new Set(['rm', 'find', 'git'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'])
// Commands that read a here-document as data, never as shell commands. Code piped into another
// language (python3 - <<EOF) is like a script file: Shields can't see inside it
const TEXT_READERS = new Set([...TEXT_ONLY, 'tee', 'python', 'python3', 'node', 'ruby', 'perl'])

function nameOf(word: string): string {
  return word.split('/').pop() ?? word
}

function judge(input: string[], depth: number): string | undefined {
  let words = input.filter(w => w !== '{' && w !== '}' && w !== '!')
  // Leading VAR=value, then any wrappers and their options
  for (;;) {
    while (words.length && ASSIGNMENT.test(words[0]!)) words = words.slice(1)
    const wrapper = WRAPPERS[nameOf(words[0] ?? '')]
    if (!wrapper) break
    const which = nameOf(words[0]!)
    let at = 1
    while (at < words.length && (words[at]!.startsWith('-') || (which === 'env' && ASSIGNMENT.test(words[at]!)))) {
      // env -S splits its value into a command line of its own
      if (which === 'env' && words[at]!.startsWith('-S')) {
        const line = words[at] === '-S' ? words.slice(at + 1).join(' ') : `${words[at]!.slice(2)} ${words.slice(at + 1).join(' ')}`
        return hostileReason(line, depth + 1)
      }
      at += wrapper.includes(words[at]!) ? 2 : 1
    }
    if (which === 'timeout' || which === 'gtimeout') at += 1 // the duration
    words = words.slice(at)
  }
  if (!words.length) return undefined
  // A whole command handed over as one word (watch "…") is read as a command line
  if (/\s/.test(words[0]!)) return hostileReason(words.join(' '), depth + 1)
  const name = nameOf(words[0]!)
  const args = words.slice(1)

  if (SHELLS.has(name)) {
    const c = args.findIndex(a => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a))
    return c >= 0 && args[c + 1] !== undefined ? hostileReason(args[c + 1]!, depth + 1) : undefined
  }
  if (name === 'eval') return hostileReason(args.join(' '), depth + 1)
  if (name === 'rm') return rmReason(args)
  if (name === 'find') return findReason(args)
  if (name === 'git') return gitReason(args, depth)
  // A command named by a variable ($x -rf ~) could be anything: judge its flags as rm's
  if (name.includes('$')) return rmReason(args)
  if (RUNS_STRING.has(name)) {
    const c = args.findIndex(a => a === '-c' || a === '--command')
    if (c >= 0 && args[c + 1] !== undefined) return hostileReason(args[c + 1]!, depth + 1)
  }
  // Fail closed for a command Shields doesn't know (flock, parallel, ssh host …): an rm, find or git
  // among its words, or a word that is a whole such command line, is judged from there
  if (!TEXT_ONLY.has(name)) {
    for (let j = 0; j < args.length; j++) {
      const word = args[j]!
      if (JUDGED.has(nameOf(word))) return judge(args.slice(j), depth)
      if (/\s/.test(word) && JUDGED.has(nameOf(word.trim().split(/\s+/)[0]!))) {
        const reason = hostileReason(word, depth + 1)
        if (reason) return reason
      }
    }
  }
  return undefined
}

// Short flags as one string (-rf -v → "rfv"), long flags as a list, the rest as operands
function flagsOf(args: string[]) {
  const end = args.indexOf('--')
  const opts = end < 0 ? args : args.slice(0, end)
  const short = opts.filter(a => /^-[^-]/.test(a)).map(a => a.slice(1)).join('')
  const long = opts.filter(a => a.startsWith('--') && a.length > 2).map(a => a.split('=')[0]!)
  const operands = [...opts.filter(a => !a.startsWith('-')), ...(end < 0 ? [] : args.slice(end + 1))]
  return { short, long, operands }
}

// Places a recursive delete should never be pointed at, forced or not
const PRECIOUS = new Set(['/', '/*', '~', '~/*', '$HOME', '${HOME}', '$HOME/*', '*', '.', './*', '..', '../*'])

function rmReason(args: string[]): string | undefined {
  const { short, long, operands } = flagsOf(args)
  const isRecursive = /[rR]/.test(short) || long.includes('--recursive')
  if (!isRecursive) return undefined
  if (short.includes('f') || long.includes('--force')) return 'a forced recursive delete'
  const target = operands.map(o => o.replace(/(.)\/+$/, '$1')).find(o => PRECIOUS.has(o))
  return target ? `a recursive delete of ${target}` : undefined
}

function findReason(args: string[]): string | undefined {
  if (args.includes('-delete')) return 'find -delete'
  const exec = args.findIndex(a => a === '-exec' || a === '-execdir' || a === '-ok' || a === '-okdir')
  if (exec >= 0 && ['rm', 'rmdir', 'shred', 'unlink'].includes(nameOf(args[exec + 1] ?? ''))) return 'find running a delete on every match'
  return undefined
}

// git's own options before the subcommand, and those that take a value
const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])

function gitReason(args: string[], depth: number): string | undefined {
  let at = 0
  let alias: string | undefined
  while (at < args.length && args[at]!.startsWith('-')) {
    const opt = args[at]!
    if (opt === '-c' && /^alias\./i.test(args[at + 1] ?? '')) alias = args[at + 1]
    if (/^-calias\./i.test(opt)) alias = opt.slice(2)
    at += GIT_VALUED.has(opt) ? 2 : 1
  }
  let sub = args[at]
  let rest = args.slice(at + 1)
  // git -c alias.p=push p -f: judge what the alias stands for
  if (alias && sub && alias.toLowerCase().startsWith(`alias.${sub.toLowerCase()}=`)) {
    const body = alias.slice(alias.indexOf('=') + 1)
    if (body.startsWith('!')) return hostileReason(`${body.slice(1)} ${rest.join(' ')}`, depth + 1)
    const expanded = parse(body).segments[0] ?? []
    sub = expanded[0]
    rest = [...expanded.slice(1), ...rest]
  }
  const { short, long, operands } = flagsOf(rest)

  switch (sub) {
    case 'push': {
      if (/f/.test(short) || long.some(l => l.startsWith('--force'))) return 'a forced git push'
      if (long.includes('--mirror')) return 'git push --mirror'
      if (/d/.test(short) || long.includes('--delete') || long.includes('--prune')) return 'a git push that deletes remote branches'
      if (operands.some(o => o.startsWith('+'))) return 'a forced git push'
      if (operands.slice(1).some(o => o.startsWith(':'))) return 'a git push that deletes a remote branch'
      return undefined
    }
    case 'reset':
      return long.includes('--hard') ? 'git reset --hard' : undefined
    case 'clean':
      return /f/.test(short) || long.includes('--force') ? 'git clean, which deletes untracked files' : undefined
    case 'checkout':
    case 'switch':
      if (/f/.test(short) || long.includes('--force') || long.includes('--discard-changes')) return `a forced git ${sub}, which discards changes`
      return sub === 'checkout' && rest.includes('--') && operands.includes('.') ? 'git checkout -- ., which discards every change' : undefined
    case 'restore':
      return operands.includes('.') || operands.includes(':/') ? 'git restore of every file, which discards changes' : undefined
    case 'branch':
      return /D/.test(short) || (long.includes('--delete') && long.includes('--force')) ? 'a forced branch delete' : undefined
    default:
      return undefined
  }
}
