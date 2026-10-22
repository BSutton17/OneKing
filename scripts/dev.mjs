// Runs the server (:3001) and the client (:5173) together for local play.
import { spawn, spawnSync } from 'node:child_process';

const run = (name, dir, color) => {
  const child = spawn('npm run dev', { cwd: new URL(`../${dir}/`, import.meta.url), shell: true });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => stream.on('data', (d) => out.write(d.toString().replace(/^(?=.)/gm, tag)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
};

const children = [run('server', 'Server', 33), run('client', 'Client', 36)];
// on Windows, killing the shell leaves node running underneath: kill each whole tree
const kill = (c) => (process.platform === 'win32' ? spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F']) : c.kill());
const stop = () => {
  children.forEach(kill);
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
