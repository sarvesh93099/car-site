import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databaseDir=mkdtempSync(join(tmpdir(),'v31-browser-'));
process.env.V31_BROWSER_TEST_DIR=databaseDir;
export default defineConfig({
 testDir:'./tests/browser',
 workers:1,
 timeout:60000,
 reporter:'list',
 globalTeardown:'./tests/browser-teardown.js',
 use:{baseURL:'http://127.0.0.1:3107',channel:'chrome',headless:true,viewport:{width:1440,height:1000},screenshot:'only-on-failure'},
 webServer:{command:'node server.js',url:'http://127.0.0.1:3107',reuseExistingServer:false,env:{PORT:'3107',HOST:'127.0.0.1',DB_PATH:join(databaseDir,'studio.sqlite'),ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:'browser-admin-password-2026',WHATSAPP_ACCESS_TOKEN:'',WHATSAPP_PHONE_NUMBER_ID:'',WHATSAPP_API_VERSION:'',WHATSAPP_BILL_TEMPLATE:'',WHATSAPP_TEMPLATE_LANGUAGE:''},timeout:15000}
});
