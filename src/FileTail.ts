import * as fs from 'fs';

export function readUtf8Tail(file: string, maxBytes = 4 * 1024 * 1024): string {
  const size = fs.statSync(file).size;
  const length = Math.min(size, Math.max(1, maxBytes));
  const start = size - length;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try {
    let read = 0;
    while (read < length) {
      const count = fs.readSync(fd, buffer, read, length - read, start + read);
      if (count === 0) { break; }
      read += count;
    }
    let text = buffer.subarray(0, read).toString('utf8');
    if (start > 0) {
      const newline = text.indexOf('\n');
      text = newline >= 0 ? text.slice(newline + 1) : '';
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}
