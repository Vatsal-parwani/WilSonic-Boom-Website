// `npm run dev`: the Astro dev server, plus a pull from GitHub every 15 seconds
// so edits saved in the admin appear on localhost without running `git pull`.
// Only fast-forwards: if you have local commits or edits that clash, it leaves
// everything alone and says so once.
import { spawn, execFile } from 'node:child_process';

const EVERY = 15_000;
let warned = false;

const git = (...args) =>
  new Promise((resolve) =>
    execFile('git', args, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })),
  );

async function pull() {
  const fetched = await git('fetch', '--quiet');
  if (!fetched.ok) return;
  const behind = await git('rev-list', '--count', 'HEAD..@{upstream}');
  if (!behind.ok || behind.out === '0') return;
  const res = await git('pull', '--ff-only', '--quiet');
  if (res.ok) {
    warned = false;
    console.log(`\n[auto-pull] pulled ${behind.out} new commit(s) from GitHub (admin edits)\n`);
  } else if (!warned) {
    warned = true;
    console.log('\n[auto-pull] new commits on GitHub, but they clash with local changes. Commit or stash, then `git pull`.\n');
  }
}

const astro = spawn('npx', ['astro', 'dev', ...process.argv.slice(2)], { stdio: 'inherit' });
astro.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => astro.kill(sig));

pull();
setInterval(pull, EVERY);
