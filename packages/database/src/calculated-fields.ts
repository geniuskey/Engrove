export type FormulaValue = null | boolean | number | string | FormulaValue[];

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'reference'; value: string }
  | { kind: 'identifier'; value: string }
  | { kind: 'symbol'; value: string }
  | { kind: 'end'; value: '' };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const rest = expression.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const reference = rest.match(/^\{([a-z][a-z0-9-]{1,63})\}/i);
    if (reference) {
      tokens.push({ kind: 'reference', value: reference[1]! });
      index += reference[0].length;
      continue;
    }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      let value = '';
      index += 1;
      while (index < expression.length && expression[index] !== quote) {
        if (expression[index] === '\\' && index + 1 < expression.length) index += 1;
        value += expression[index++];
      }
      if (expression[index] !== quote) throw new Error('Formula contains an unterminated string.');
      index += 1;
      tokens.push({ kind: 'string', value });
      continue;
    }
    const identifier = rest.match(/^[a-z_][a-z0-9_]*/i);
    if (identifier) {
      tokens.push({ kind: 'identifier', value: identifier[0]!.toUpperCase() });
      index += identifier[0].length;
      continue;
    }
    const operator = rest.match(/^(?:<=|>=|<>|!=|==|[()+\-*/&,=<>])/);
    if (!operator)
      throw new Error(`Formula contains an unsupported token near '${rest.slice(0, 8)}'.`);
    tokens.push({ kind: 'symbol', value: operator[0]! });
    index += operator[0].length;
  }
  tokens.push({ kind: 'end', value: '' });
  return tokens;
}

function scalar(value: FormulaValue | undefined): null | boolean | number | string {
  if (Array.isArray(value)) return value.length ? scalar(value[0]) : null;
  return value ?? null;
}

function numeric(value: FormulaValue | undefined): number {
  const item = scalar(value);
  if (item === null || item === '') return 0;
  if (typeof item === 'boolean') return item ? 1 : 0;
  const converted = Number(item);
  if (!Number.isFinite(converted)) throw new Error(`'${String(item)}' is not numeric.`);
  return converted;
}

function comparable(value: FormulaValue): number | string {
  const item = scalar(value);
  if (typeof item === 'number') return item;
  if (item === null) return '';
  return String(item);
}

function flatten(values: FormulaValue[]): FormulaValue[] {
  return values.flatMap((value) => (Array.isArray(value) ? flatten(value) : [value]));
}

export function evaluateFormula(
  expression: string,
  values: Record<string, FormulaValue | undefined>,
): FormulaValue {
  if (!expression.trim() || expression.length > 2_000)
    throw new Error('Formula is empty or too long.');
  const tokens = tokenize(expression);
  let position = 0;
  const current = () => tokens[position]!;
  const symbol = (value: string) => current().kind === 'symbol' && current().value === value;
  const consume = (value: string) => {
    if (!symbol(value)) throw new Error(`Formula expected '${value}'.`);
    position += 1;
  };

  const primary = (): FormulaValue => {
    const token = current();
    if (token.kind === 'number' || token.kind === 'string') {
      position += 1;
      return token.value;
    }
    if (token.kind === 'reference') {
      position += 1;
      return values[token.value] ?? null;
    }
    if (symbol('(')) {
      position += 1;
      const result = comparison();
      consume(')');
      return result;
    }
    if (token.kind === 'identifier') {
      position += 1;
      if (token.value === 'TRUE') return true;
      if (token.value === 'FALSE') return false;
      if (token.value === 'NULL') return null;
      consume('(');
      const args: FormulaValue[] = [];
      if (!symbol(')')) {
        do {
          args.push(comparison());
          if (!symbol(',')) break;
          position += 1;
        } while (!symbol(')'));
      }
      consume(')');
      const flat = flatten(args);
      switch (token.value) {
        case 'SUM':
          return flat.reduce<number>((total, value) => total + numeric(value), 0);
        case 'AVG':
          return flat.length
            ? flat.reduce<number>((total, value) => total + numeric(value), 0) / flat.length
            : 0;
        case 'MIN':
          return flat.length ? Math.min(...flat.map(numeric)) : 0;
        case 'MAX':
          return flat.length ? Math.max(...flat.map(numeric)) : 0;
        case 'ABS':
          return Math.abs(numeric(args[0]));
        case 'ROUND':
          return Number(numeric(args[0]).toFixed(Math.max(0, Math.min(12, numeric(args[1])))));
        case 'CONCAT':
          return flat.map((value) => String(scalar(value) ?? '')).join('');
        case 'IF':
          return scalar(args[0]) ? (args[1] ?? null) : (args[2] ?? null);
        default:
          throw new Error(`Formula function '${token.value}' is not supported.`);
      }
    }
    throw new Error('Formula contains an incomplete expression.');
  };

  const unary = (): FormulaValue => {
    if (symbol('-')) {
      position += 1;
      return -numeric(unary());
    }
    if (symbol('+')) {
      position += 1;
      return numeric(unary());
    }
    return primary();
  };
  const product = (): FormulaValue => {
    let value = unary();
    while (symbol('*') || symbol('/')) {
      const operator = current().value;
      position += 1;
      const right = numeric(unary());
      if (operator === '/' && right === 0) throw new Error('Formula cannot divide by zero.');
      value = operator === '*' ? numeric(value) * right : numeric(value) / right;
    }
    return value;
  };
  const sum = (): FormulaValue => {
    let value = product();
    while (symbol('+') || symbol('-') || symbol('&')) {
      const operator = current().value;
      position += 1;
      const right = product();
      value =
        operator === '&'
          ? `${String(scalar(value) ?? '')}${String(scalar(right) ?? '')}`
          : operator === '+'
            ? numeric(value) + numeric(right)
            : numeric(value) - numeric(right);
    }
    return value;
  };
  const comparison = (): FormulaValue => {
    let value = sum();
    if (['=', '==', '!=', '<>', '<', '<=', '>', '>='].some(symbol)) {
      const operator = current().value;
      position += 1;
      const right = sum();
      const leftValue = comparable(value);
      const rightValue = comparable(right);
      value =
        operator === '=' || operator === '=='
          ? leftValue === rightValue
          : operator === '!=' || operator === '<>'
            ? leftValue !== rightValue
            : operator === '<'
              ? leftValue < rightValue
              : operator === '<='
                ? leftValue <= rightValue
                : operator === '>'
                  ? leftValue > rightValue
                  : leftValue >= rightValue;
    }
    return value;
  };

  const result = comparison();
  if (current().kind !== 'end') throw new Error('Formula contains unexpected trailing input.');
  return result;
}

export function formulaReferences(expression: string): string[] {
  return [
    ...new Set([...expression.matchAll(/\{([a-z][a-z0-9-]{1,63})\}/gi)].map((match) => match[1]!)),
  ];
}
