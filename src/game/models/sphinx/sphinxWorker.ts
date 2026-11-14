// Web worker: sculpts and meshes the Sphinx, its eyes and the river gate off the
// main thread and hands back the raw geometry buffers (transferred, no copies).
// See bosses/sphinx/SphinxGeo.ts for the main-thread side.
import { buildSphinxMsg } from './sphinxBuild';

const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t: Transferable[]): void };
ctx.onmessage = () => {
  const transfer: Transferable[] = [];
  const msg = buildSphinxMsg(transfer);
  ctx.postMessage(msg, transfer);
};
