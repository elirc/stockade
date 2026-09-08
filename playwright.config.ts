import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',fullyParallel:false,use:{baseURL:'http://127.0.0.1:3000',channel:'chrome',headless:true,screenshot:'only-on-failure',trace:'retain-on-failure'},reporter:[['list'],['html',{open:'never'}]],expect:{timeout:30000},timeout:180000});
