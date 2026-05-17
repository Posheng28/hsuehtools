// Arithmetic expression evaluator for computed chart series
// Supports: + - * /  parentheses  numeric literals  series-ID variables
// Series IDs can contain letters, digits, underscores (e.g. US10Y, custom_AAPL_123)

type TokType = 'num' | 'id' | 'plus' | 'minus' | 'star' | 'slash' | 'lparen' | 'rparen' | 'eof'

interface Tok { type: TokType; raw: string }

function tokenize(expr: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(expr[i + 1] ?? ''))) {
      let s = ''
      while (i < expr.length && /[\d.]/.test(expr[i])) s += expr[i++]
      toks.push({ type: 'num', raw: s })
    } else if (/[a-zA-Z_]/.test(ch)) {
      let s = ''
      while (i < expr.length && /[\w]/.test(expr[i])) s += expr[i++]
      toks.push({ type: 'id', raw: s })
    } else {
      const map: Record<string, TokType> = { '+': 'plus', '-': 'minus', '*': 'star', '/': 'slash', '(': 'lparen', ')': 'rparen' }
      if (map[ch]) toks.push({ type: map[ch], raw: ch })
      i++
    }
  }
  toks.push({ type: 'eof', raw: '' })
  return toks
}

type Expr =
  | { k: 'num'; v: number }
  | { k: 'id'; name: string }
  | { k: 'binop'; op: string; left: Expr; right: Expr }
  | { k: 'neg'; child: Expr }

class Parser {
  private i = 0
  constructor(private toks: Tok[]) {}
  private peek() { return this.toks[this.i] }
  private eat() { return this.toks[this.i++] }

  parse(): Expr { return this.addSub() }

  private addSub(): Expr {
    let node = this.mulDiv()
    while (this.peek().type === 'plus' || this.peek().type === 'minus') {
      const op = this.eat().raw
      node = { k: 'binop', op, left: node, right: this.mulDiv() }
    }
    return node
  }

  private mulDiv(): Expr {
    let node = this.unary()
    while (this.peek().type === 'star' || this.peek().type === 'slash') {
      const op = this.eat().raw
      node = { k: 'binop', op, left: node, right: this.unary() }
    }
    return node
  }

  private unary(): Expr {
    if (this.peek().type === 'minus') {
      this.eat()
      return { k: 'neg', child: this.primary() }
    }
    return this.primary()
  }

  private primary(): Expr {
    const t = this.peek()
    if (t.type === 'num') { this.eat(); return { k: 'num', v: parseFloat(t.raw) } }
    if (t.type === 'id') { this.eat(); return { k: 'id', name: t.raw } }
    if (t.type === 'lparen') {
      this.eat()
      const node = this.parse()
      this.eat() // rparen
      return node
    }
    throw new Error(`Unexpected: ${t.raw}`)
  }
}

function evalExpr(node: Expr, vars: Record<string, number | null>): number | null {
  switch (node.k) {
    case 'num': return node.v
    case 'id': return vars[node.name] ?? null
    case 'neg': {
      const v = evalExpr(node.child, vars)
      return v == null ? null : -v
    }
    case 'binop': {
      const l = evalExpr(node.left, vars)
      const r = evalExpr(node.right, vars)
      if (l == null || r == null) return null
      if (node.op === '+') return l + r
      if (node.op === '-') return l - r
      if (node.op === '*') return l * r
      if (node.op === '/') return r === 0 ? null : l / r
    }
  }
  return null
}

// Cache parsed ASTs so we don't re-parse on every data point
const astCache = new Map<string, Expr>()

export function evaluateFormula(formula: string, vars: Record<string, number | null>): number | null {
  try {
    if (!astCache.has(formula)) {
      const toks = tokenize(formula)
      const ast = new Parser(toks).parse()
      astCache.set(formula, ast)
    }
    return evalExpr(astCache.get(formula)!, vars)
  } catch {
    return null
  }
}

// Return all series IDs referenced in a formula
export function extractIds(formula: string): string[] {
  try {
    const toks = tokenize(formula)
    return toks.filter((t) => t.type === 'id').map((t) => t.raw)
  } catch {
    return []
  }
}

// Validate formula — returns error string or null if OK
export function validateFormula(formula: string, knownIds: Set<string>): string | null {
  try {
    const toks = tokenize(formula)
    new Parser([...toks]).parse()
    const ids = extractIds(formula)
    const missing = ids.filter((id) => !knownIds.has(id))
    if (missing.length > 0) return `找不到指標：${missing.join(', ')}`
    return null
  } catch (e) {
    return `語法錯誤：${e instanceof Error ? e.message : '未知'}`
  }
}
