import {createApp} from './app.mjs';
try{process.loadEnvFile('.env.local');}catch(error){if(error.code!=='ENOENT')throw error;}
const port=Number(process.env.PORT||process.env.ESTIMATE_API_PORT||4180);
const host=process.env.BIND_HOST||'127.0.0.1';
const server=createApp();
server.listen(port,host,()=>console.log(JSON.stringify({service:'revive-quote-assistant',host,port,production:process.env.NODE_ENV==='production',aiConfigured:!!process.env.OPENAI_API_KEY,aiRoute:new URL(process.env.OPENAI_BASE_URL||'http://127.0.0.1:8790/v1').origin})));
const stop=()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
