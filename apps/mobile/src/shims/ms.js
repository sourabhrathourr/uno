const units = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
  ['s', 1_000],
  ['ms', 1],
];

function format(milliseconds) {
  const absolute = Math.abs(milliseconds);

  for (const [suffix, size] of units) {
    if (absolute >= size || suffix === 'ms') {
      return `${Math.round(milliseconds / size)}${suffix}`;
    }
  }
}

function parse(value) {
  const match = /^(-?(?:\\d+)?(?:\\.\\d+)?)\\s*(ms|s|m|h|d)?$/i.exec(value.trim());
  if (!match) return undefined;

  const unit = (match[2] || 'ms').toLowerCase();
  const size = units.find(([suffix]) => suffix === unit)?.[1];
  return size ? Number(match[1]) * size : undefined;
}

function ms(value) {
  if (typeof value === 'number') return format(value);
  if (typeof value === 'string') return parse(value);
  throw new Error('ms expects a number or string');
}

module.exports = ms;
