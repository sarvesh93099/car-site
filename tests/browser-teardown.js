import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
export default async function(){
 const path=process.env.V31_BROWSER_TEST_DIR;
 // Playwright stops its webServer after global teardown. On Windows SQLite's
 // open files cannot be removed until that server has exited.
 if(path&&dirname(resolve(path))===resolve(tmpdir())&&basename(path).startsWith('v31-browser-'))process.once('exit',()=>rmSync(path,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
}
