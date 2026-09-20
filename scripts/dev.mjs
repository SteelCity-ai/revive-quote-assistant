import {spawn} from 'node:child_process';
const children=[spawn(process.execPath,['server/index.mjs'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','0.0.0.0'],{stdio:'inherit'})];
const stop=()=>children.forEach(c=>c.kill());process.on('SIGINT',()=>{stop();process.exit();});process.on('SIGTERM',()=>{stop();process.exit();});children.forEach(c=>c.on('exit',code=>{stop();process.exit(code??0);}));
