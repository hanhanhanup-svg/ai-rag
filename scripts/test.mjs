import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const tests = ['server', 'tests'].flatMap(dir => readdirSync(dir).filter(name => name.endsWith('.test.mjs')).sort().map(name => dir + '/' + name));
if (!tests.length) throw new Error('No verification suites were found.');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...tests], { stdio: 'inherit', windowsHide: true, env: { ...process.env, DEEPSEEK_API_KEY: '', AI_API_KEY: '', OPENAI_API_KEY: '', EMBEDDING_API_KEY: '' } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
