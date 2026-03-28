export async function copyToClipboard(text: string): Promise<void> {
  const platform = process.platform;
  let command: string[];

  if (platform === "darwin") {
    command = ["pbcopy"];
  } else if (platform === "win32") {
    command = ["clip.exe"];
  } else {
    // Linux - try xclip first, fallback to xsel
    command = ["xclip", "-selection", "clipboard"];
  }

  const proc = Bun.spawn(command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.stdin.write(text);
  proc.stdin.end();

  await proc.exited;

  if (proc.exitCode !== 0 && platform !== "darwin" && platform !== "win32") {
    // Try xsel as fallback on Linux
    const proc2 = Bun.spawn(["xsel", "--clipboard", "--input"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc2.stdin.write(text);
    proc2.stdin.end();
    await proc2.exited;
  }
}

export function escapeCsvValue(value: string): string {
  // If value contains comma, newline, or double quote, wrap in quotes and escape quotes
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function formatRowAsCsv(row: string[]): string {
  return row.map(escapeCsvValue).join(",");
}
