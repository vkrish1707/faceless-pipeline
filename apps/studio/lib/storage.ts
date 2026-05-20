import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

function workspaceRoot(): string {
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export function pdfPathFor(bookId: string): string {
  return resolve(workspaceRoot(), "assets/pdfs", `${bookId}.pdf`);
}

export async function writePdfFile(bookId: string, buffer: Buffer): Promise<string> {
  const path = pdfPathFor(bookId);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, buffer);
  return path;
}

export async function deletePdfFile(bookId: string): Promise<void> {
  const path = pdfPathFor(bookId);
  try {
    await fs.unlink(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
