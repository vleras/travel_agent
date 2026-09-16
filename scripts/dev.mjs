import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = { ...process.env };
if (process.platform === 'darwin' && !env.NODE_EXTRA_CA_CERTS) {
  const bundle = join(tmpdir(), 'travel-agent-macos-ca.pem');
  try {
    writeFileSync(bundle, execFileSync('security', [
      'find-certificate', '-a', '-p', '/Library/Keychains/System.keychain',
    ]));
    appendFileSync(bundle, execFileSync('security', [
      'find-certificate', '-a', '-p', '/System/Library/Keychains/SystemRootCertificates.keychain',
    ]));
    env.NODE_EXTRA_CA_CERTS = bundle;
  } catch {
    console.warn('Could not load the macOS certificate store; external API requests may fail.');
  }
}

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});
vite.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
