import {useEffect,useState} from 'react';
import AIApp from './AIApp';
import PortalConnection from './PortalConnection';
export default function AppGate(){
  const [required,setRequired]=useState<boolean|null>(null),[signedIn,setSignedIn]=useState(false),[error,setError]=useState('');
  const check=async()=>{try{const r=await fetch('/api/app/config');if(!r.ok)throw new Error();const config=await r.json();setRequired(config.requiresLogin!==false);setError('');}catch{setError('Could not connect to Revive. Check your connection and retry.');}};
  useEffect(()=>{void check();},[]);
  useEffect(()=>{const expired=()=>setSignedIn(false);window.addEventListener('revive-session-expired',expired);return()=>window.removeEventListener('revive-session-expired',expired);},[]);
  if(required===false||signedIn)return <AIApp/>;
  return <><header className="header"><div className="brand"><span><b>REVIVE</b><small>QUOTE ASSISTANT</small></span></div></header><main className="sign-in-shell"><h1>Revive Quote Assistant</h1><p>Sign in to prepare roofing, renovation and contracting estimates.</p>{error?<><p role="alert">{error}</p><button className="primary" onClick={()=>void check()}>Retry connection</button></>:required===null?<p>Connecting…</p>:<PortalConnection onStatus={status=>setSignedIn(status.user?.role==='ADMIN')}/>}</main></>;
}
